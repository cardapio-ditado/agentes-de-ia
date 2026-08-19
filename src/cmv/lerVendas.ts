import Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { anthropicConfig } from "./../config.js";

/**
 * Lê o relatório de vendas de qualquer PDV.
 *
 * O problema real: cada casa usa um sistema diferente (Colibri, Consumer,
 * ZIG, Saipos, um Excel feito à mão) e nenhum exporta igual. Padronizar o
 * relatório é impossível — o cliente não troca de PDV para usar o nosso
 * módulo.
 *
 * A saída é padronizar o RESULTADO da leitura. Entra qualquer arquivo; sai
 * sempre a mesma lista: data, produto, quantidade, valor. Depois dessa linha
 * o sistema inteiro é igual para todo cliente.
 *
 * Excel e CSV viram texto aqui mesmo (sem custo, sem IA). PDF e foto vão para
 * o modelo. Em todos os casos quem interpreta a TABELA — qual coluna é o
 * produto, quantas linhas de cabeçalho pular — é o modelo, porque é aí que
 * cada PDV inventa o seu jeito.
 */

export interface LinhaDeVenda {
  produto: string;
  codigo: string | null;
  quantidade: number;
  valorTotal: number | null;
  /** AAAA-MM-DD. É esta data que carimba o movimento no estoque. */
  data: string;
}

export interface VendasLidas {
  linhas: LinhaDeVenda[];
  periodoInicio: string | null;
  periodoFim: string | null;
  /** Como o relatório é montado — guardado para a próxima importação. */
  impressaoDigital: string;
  avisos: string[];
}

/**
 * Volume e tabela: o relatório de um sábado tem centenas de linhas, e trocar
 * um 3 por 8 numa quantidade contamina o estoque. Modelo maior.
 */
const MODELO = "claude-sonnet-5";

/** Acima disto o relatório não cabe no prompt — e vira erro claro, não silêncio. */
const MAX_TEXTO = 120_000;

const TIPOS_TEXTO = new Set(["text/csv", "text/plain", "application/csv", "text/tab-separated-values"]);
const TIPOS_EXCEL = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
const TIPOS_PDF = new Set(["application/pdf"]);
const TIPOS_IMAGEM = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function tipoDeVendasAceito(mediaType: string): boolean {
  const t = mediaType.toLowerCase();
  return TIPOS_TEXTO.has(t) || TIPOS_EXCEL.has(t) || TIPOS_PDF.has(t) || TIPOS_IMAGEM.has(t);
}

/** A impressão digital do arquivo — a trava contra importar duas vezes. */
export function impressaoDoArquivo(arquivo: Buffer): string {
  return createHash("sha256").update(arquivo).digest("hex");
}

const FERRAMENTA = {
  name: "registrar_vendas",
  description: "Registra os produtos vendidos que aparecem no relatório.",
  input_schema: {
    type: "object" as const,
    properties: {
      periodo_inicio: { type: ["string", "null"], description: "Primeiro dia do relatório, AAAA-MM-DD." },
      periodo_fim: { type: ["string", "null"], description: "Último dia do relatório, AAAA-MM-DD." },
      linhas: {
        type: "array",
        description: "Um objeto por produto vendido. Some as repetições do mesmo produto no mesmo dia.",
        items: {
          type: "object",
          properties: {
            produto: {
              type: "string",
              description:
                "O nome EXATAMENTE como está no relatório, com abreviação e erro de digitação. O sistema casa com o cadastro depois, e a grafia original é o que ele usa para aprender.",
            },
            codigo: { type: ["string", "null"], description: "Código/PLU do produto, se houver coluna." },
            quantidade: { type: "number", description: "Quantas unidades foram vendidas." },
            valor_total: { type: ["number", "null"], description: "Valor vendido da linha, se houver." },
            data: {
              type: ["string", "null"],
              description:
                "Dia da venda, AAAA-MM-DD. Se o relatório é de um dia só e a data está no cabeçalho, repita-a em todas as linhas.",
            },
          },
          required: ["produto", "quantidade"],
        },
      },
      avisos: {
        type: "array",
        items: { type: "string" },
        description: "O que ficou ilegível, ambíguo ou foi ignorado. Vazio se o relatório estava claro.",
      },
    },
    required: ["linhas", "avisos"],
  },
};

const INSTRUCOES = `Você lê relatórios de venda de bares e restaurantes, exportados de sistemas de PDV diferentes. Cada sistema monta a tabela do seu jeito.

Sua tarefa é achar os PRODUTOS VENDIDOS e as quantidades. Transcreva, não interprete.

Regras:
- O nome do produto vai EXATAMENTE como está escrito: "PORC ISCA TILAPIA G" fica assim. O sistema casa com o cadastro depois, e a grafia original é como ele aprende o jeito deste PDV.
- Quantidade é número. Vírgula decimal brasileira vira ponto.
- IGNORE linhas que não são produto: totais, subtotais, taxa de serviço, gorjeta, couvert artístico, desconto, cabeçalho de grupo, rodapé. Se a tabela tiver uma linha "TOTAL", ela não é uma venda.
- A data: se cada linha tem a sua, use-a. Se o relatório é de um período e não diz o dia de cada venda, repita a data inicial em todas as linhas e diga isso nos avisos.
- Some as repetições do mesmo produto no mesmo dia numa linha só.
- Se um número estiver ilegível, NÃO CHUTE: deixe a linha de fora e explique nos avisos. Quantidade errada tira do estoque uma mercadoria que não saiu.
- Se o arquivo não parecer um relatório de vendas, devolva a lista vazia e diga o que você viu nos avisos.`;

/**
 * Converte o arquivo em texto quando dá — e aí a leitura é grátis.
 *
 * Devolve null para PDF e imagem, que vão para o modelo como anexo.
 */
async function comoTexto(arquivo: Buffer, mediaType: string): Promise<string | null> {
  const tipo = mediaType.toLowerCase();

  if (TIPOS_TEXTO.has(tipo)) return arquivo.toString("utf8");

  if (TIPOS_EXCEL.has(tipo)) {
    const livro = new ExcelJS.Workbook();
    // exceljs declara um `Buffer` global próprio que se funde com o do Node e
    // quebra sob @types/node novo — o valor é um Buffer de verdade, só a
    // declaração é que está errada (mesmo caso de training.ts).
    await livro.xlsx.load(arquivo as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const secoes: string[] = [];
    livro.eachSheet((aba) => {
      const linhas: string[] = [];
      aba.eachRow((linha) => {
        const celulas = (linha.values as ExcelJS.CellValue[])
          .slice(1) // values[0] é sempre vazio — ExcelJS indexa a partir de 1
          .map((v) => {
            if (v === null || v === undefined) return "";
            // Data de célula vem como Date; vira AAAA-MM-DD para o modelo não
            // ter que decifrar "Mon Aug 15 2026 00:00:00 GMT-0400".
            if (v instanceof Date) return v.toISOString().slice(0, 10);
            if (typeof v === "object" && "result" in v) return String(v.result ?? "");
            if (typeof v === "object" && "text" in v) return String(v.text ?? "");
            return String(v);
          });
        if (celulas.some((c) => c !== "")) linhas.push(celulas.join(" | "));
      });
      if (linhas.length > 0) secoes.push(`### Aba: ${aba.name}\n${linhas.join("\n")}`);
    });
    return secoes.join("\n\n");
  }

  return null;
}

/**
 * A impressão digital da ESTRUTURA, não do conteúdo.
 *
 * O relatório de terça e o de quarta têm o mesmo layout e dados diferentes —
 * é o layout que se aprende. Por isso a digital olha só as primeiras linhas
 * (onde mora o cabeçalho) e apaga os números, que são justamente o que muda
 * de um dia para o outro.
 */
export function impressaoDaEstrutura(texto: string): string {
  const cabecalho = texto
    .split("\n")
    .slice(0, 12)
    .map((l) => l.replace(/[\d.,]+/g, "#").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .join("\n");
  return createHash("sha256").update(cabecalho).digest("hex").slice(0, 32);
}

export async function lerVendas(params: {
  arquivo: Buffer;
  mediaType: string;
  /** Usada quando o relatório não traz data nenhuma. */
  dataPadrao: string;
}): Promise<VendasLidas> {
  if (!tipoDeVendasAceito(params.mediaType)) {
    throw new Error(
      `Formato ${params.mediaType} não serve. Mande CSV, Excel, PDF ou uma foto do relatório.`,
    );
  }

  const texto = await comoTexto(params.arquivo, params.mediaType);
  if (texto !== null && texto.trim() === "") {
    throw new Error("O arquivo veio vazio — confira a exportação do seu sistema.");
  }
  if (texto !== null && texto.length > MAX_TEXTO) {
    throw new Error(
      "O relatório é grande demais para uma importação só. Exporte por semana ou por dia.",
    );
  }

  const { apiKey } = anthropicConfig();
  const anthropic = new Anthropic({ apiKey });

  const conteudo: Anthropic.ContentBlockParam[] = [];
  if (texto !== null) {
    conteudo.push({ type: "text", text: `Relatório:\n\n${texto}` });
  } else if (TIPOS_PDF.has(params.mediaType.toLowerCase())) {
    conteudo.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: params.arquivo.toString("base64") },
    });
  } else {
    conteudo.push({
      type: "image",
      source: {
        type: "base64",
        media_type: params.mediaType.toLowerCase() as "image/jpeg",
        data: params.arquivo.toString("base64"),
      },
    });
  }
  conteudo.push({
    type: "text",
    text: `Extraia os produtos vendidos. Se alguma linha não tiver data, use ${params.dataPadrao}.`,
  });

  const resposta = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 8000,
    system: INSTRUCOES,
    tools: [FERRAMENTA],
    tool_choice: { type: "tool", name: "registrar_vendas" },
    messages: [{ role: "user", content: conteudo }],
  });

  const uso = resposta.content.find((b) => b.type === "tool_use");
  if (!uso || uso.type !== "tool_use") {
    throw new Error("Não consegui ler este relatório. Tente exportar em CSV ou Excel.");
  }

  const lido = converter(uso.input as Record<string, unknown>, params.dataPadrao);
  return {
    ...lido,
    impressaoDigital: impressaoDaEstrutura(texto ?? params.mediaType),
  };
}

/**
 * Traduz a resposta do modelo, descartando o que não serve.
 *
 * Exportada para teste: a regra do que é uma venda aproveitável não deveria
 * custar uma chamada de API para ser verificada.
 */
export function converter(
  bruto: Record<string, unknown>,
  dataPadrao: string,
): Omit<VendasLidas, "impressaoDigital"> {
  const avisos = Array.isArray(bruto.avisos) ? bruto.avisos.map(String) : [];
  const linhas: LinhaDeVenda[] = [];

  for (const cru of (Array.isArray(bruto.linhas) ? bruto.linhas : []) as Array<Record<string, unknown>>) {
    const produto = typeof cru.produto === "string" ? cru.produto.trim() : "";
    const quantidade = Number(cru.quantidade);

    if (!produto) {
      avisos.push("Uma linha veio sem nome de produto e foi descartada.");
      continue;
    }
    // Quantidade impossível não vira venda: baixaria do estoque uma
    // mercadoria que não saiu, e o erro só apareceria na contagem.
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      avisos.push(`"${produto}": quantidade ilegível — confira no relatório.`);
      continue;
    }

    const valorTotal = Number(cru.valor_total);
    linhas.push({
      produto,
      codigo: typeof cru.codigo === "string" && cru.codigo.trim() ? cru.codigo.trim() : null,
      quantidade,
      valorTotal: Number.isFinite(valorTotal) && valorTotal >= 0 ? valorTotal : null,
      data: dataValida(cru.data) ?? dataPadrao,
    });
  }

  if (linhas.length === 0) {
    avisos.push("Nenhuma venda foi reconhecida neste arquivo.");
  }

  return {
    linhas,
    periodoInicio: dataValida(bruto.periodo_inicio) ?? menorData(linhas),
    periodoFim: dataValida(bruto.periodo_fim) ?? maiorData(linhas),
    avisos,
  };
}

/** Só AAAA-MM-DD. Data em outro formato viraria baixa no dia errado. */
function dataValida(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(limpo) ? limpo : null;
}

function menorData(linhas: LinhaDeVenda[]): string | null {
  return linhas.length === 0 ? null : linhas.map((l) => l.data).sort()[0]!;
}

function maiorData(linhas: LinhaDeVenda[]): string | null {
  return linhas.length === 0 ? null : linhas.map((l) => l.data).sort().at(-1)!;
}
