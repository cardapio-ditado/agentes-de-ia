import Anthropic from "@anthropic-ai/sdk";
import { anthropicConfig } from "./../config.js";

/**
 * Lê uma nota fiscal fotografada e devolve as linhas.
 *
 * Quem usa isto é o pessoal do estoque, na doca, de pé, com a mão suja e o
 * entregador esperando. Digitar 20 linhas ali não acontece — ou a foto
 * resolve, ou o lançamento é feito de memória depois, que é como o estoque
 * começa a mentir.
 *
 * O modelo NÃO decide nada sobre o estoque: ele transcreve o que está no
 * papel. Casar com insumo é a escada de `casarInsumo.ts`, e dar entrada é a
 * pessoa que conferiu a mercadoria. Essa separação é o que permite errar sem
 * estragar: uma leitura ruim vira uma linha errada na tela de conferência, e
 * não uma entrada errada no estoque.
 */

export interface LinhaDaNota {
  descricao: string;
  codigo: string | null;
  quantidade: number;
  unidade: string | null;
  valorUnitario: number;
}

export interface NotaLida {
  fornecedor: string | null;
  documento: string | null;
  dataEmissao: string | null;
  linhas: LinhaDaNota[];
  valorTotal: number | null;
  /** O que a IA não conseguiu ler com segurança. Vai para a tela. */
  avisos: string[];
}

/**
 * Visão exige o modelo maior.
 *
 * Nota fiscal é papel amassado, fotografado torto, com fonte matricial e
 * carbono desbotado. Um modelo menor troca 8 por 3 e 0,5 por 5 — e um erro
 * de dígito aqui vira preço de custo errado, que contamina o CMV inteiro e
 * só aparece quando o relatório sai estranho semanas depois.
 */
const MODELO = "claude-sonnet-5";

const FERRAMENTA = {
  name: "registrar_nota",
  description: "Registra o que está escrito na nota fiscal fotografada.",
  input_schema: {
    type: "object" as const,
    properties: {
      fornecedor: { type: ["string", "null"], description: "Razão social ou nome fantasia de quem emitiu." },
      documento: { type: ["string", "null"], description: "Número da nota ou do cupom." },
      data_emissao: { type: ["string", "null"], description: "Data de emissão, formato AAAA-MM-DD." },
      valor_total: { type: ["number", "null"], description: "Total da nota, se estiver legível." },
      linhas: {
        type: "array",
        description: "Um objeto por item de mercadoria da nota.",
        items: {
          type: "object",
          properties: {
            descricao: { type: "string", description: "A descrição EXATAMENTE como está na nota, sem corrigir nem completar." },
            codigo: { type: ["string", "null"], description: "Código do produto na nota, se houver." },
            quantidade: { type: "number" },
            unidade: { type: ["string", "null"], description: "KG, UN, CX, L..." },
            valor_unitario: { type: "number" },
          },
          required: ["descricao", "quantidade", "valor_unitario"],
        },
      },
      avisos: {
        type: "array",
        items: { type: "string" },
        description:
          "O que ficou ilegível ou duvidoso, uma frase por problema. Vazio se a nota estava nítida.",
      },
    },
    required: ["linhas", "avisos"],
  },
};

const INSTRUCOES = `Você transcreve notas fiscais e cupons de compra de bares e restaurantes.

Sua única tarefa é ler o que está no papel. Não interprete, não corrija, não complete.

Regras:
- A descrição vai EXATAMENTE como está escrita, com abreviação, erro de digitação e tudo. "FGO TIRAS CX 10KG" fica assim. O sistema casa isso com o cadastro depois, e a grafia original é o que ele usa para aprender como este fornecedor escreve.
- Quantidade e valor unitário são números. Vírgula decimal brasileira vira ponto: "4,900" é 4.9.
- Só mercadoria. Frete, taxa, desconto e impostos NÃO são linhas — se aparecerem, mencione nos avisos.
- Se um dígito estiver ilegível, NÃO CHUTE. Ponha a linha com o que conseguiu ler e descreva o problema nos avisos. Um preço errado contamina o custo de tudo que usa aquele insumo e só aparece semanas depois.
- Se a foto estiver cortada e faltar parte da nota, diga isso nos avisos.
- Nota com nenhum item legível: devolva a lista vazia e explique nos avisos.`;

/** Formatos que o modelo aceita. PDF não passa por aqui. */
const TIPOS_ACEITOS = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function tipoAceito(mediaType: string): boolean {
  return TIPOS_ACEITOS.has(mediaType.toLowerCase());
}

export async function lerNota(params: {
  imagem: Buffer;
  mediaType: string;
}): Promise<NotaLida> {
  if (!tipoAceito(params.mediaType)) {
    throw new Error(
      `Formato ${params.mediaType} não serve. Mande uma foto (JPG, PNG ou WebP).`,
    );
  }

  const { apiKey } = anthropicConfig();
  const anthropic = new Anthropic({ apiKey });

  const resposta = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 4000,
    system: INSTRUCOES,
    tools: [FERRAMENTA],
    // Sem isto o modelo às vezes descreve a nota em prosa, e a tela fica sem
    // o que preencher.
    tool_choice: { type: "tool", name: "registrar_nota" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: params.mediaType as "image/jpeg",
              data: params.imagem.toString("base64"),
            },
          },
          { type: "text", text: "Transcreva esta nota." },
        ],
      },
    ],
  });

  const uso = resposta.content.find((b) => b.type === "tool_use");
  if (!uso || uso.type !== "tool_use") {
    throw new Error("Não consegui ler a nota. Tente outra foto, mais próxima e sem sombra.");
  }

  return converter(uso.input as Record<string, unknown>);
}

/**
 * Traduz a resposta do modelo para o formato do sistema, descartando o que
 * não serve.
 *
 * Exportada para teste: é aqui que mora a regra sobre o que é uma linha
 * aproveitável, e testá-la não deveria custar uma chamada de API.
 */
export function converter(bruto: Record<string, unknown>): NotaLida {
  const linhasBrutas = Array.isArray(bruto.linhas) ? bruto.linhas : [];
  const avisos = Array.isArray(bruto.avisos) ? bruto.avisos.map(String) : [];

  const linhas: LinhaDaNota[] = [];
  for (const cru of linhasBrutas as Array<Record<string, unknown>>) {
    const descricao = typeof cru.descricao === "string" ? cru.descricao.trim() : "";
    const quantidade = Number(cru.quantidade);
    const valorUnitario = Number(cru.valor_unitario);

    // Linha sem descrição ou com quantidade impossível não vai para a tela
    // como se fosse mercadoria: ela vira aviso. Uma linha inventada que
    // passa despercebida na conferência entra no estoque.
    if (!descricao) {
      avisos.push("Uma linha veio sem descrição e foi descartada.");
      continue;
    }
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      avisos.push(`"${descricao}": quantidade ilegível — confira na nota.`);
      continue;
    }
    if (!Number.isFinite(valorUnitario) || valorUnitario < 0) {
      avisos.push(`"${descricao}": valor ilegível — confira na nota.`);
      continue;
    }

    linhas.push({
      descricao,
      codigo: typeof cru.codigo === "string" && cru.codigo.trim() ? cru.codigo.trim() : null,
      quantidade,
      unidade: typeof cru.unidade === "string" && cru.unidade.trim() ? cru.unidade.trim() : null,
      valorUnitario,
    });
  }

  return {
    fornecedor: texto(bruto.fornecedor),
    documento: texto(bruto.documento),
    dataEmissao: data(bruto.data_emissao),
    linhas,
    valorTotal: Number.isFinite(Number(bruto.valor_total)) ? Number(bruto.valor_total) : null,
    avisos,
  };
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** Só AAAA-MM-DD. Data em outro formato viraria lançamento no dia errado. */
function data(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(limpo) ? limpo : null;
}

/**
 * A soma das linhas bate com o total da nota?
 *
 * Conferência barata que pega o erro mais perigoso da transcrição: uma linha
 * inteira que o modelo pulou. Quantidade errada numa linha alguém nota na
 * doca ao olhar a mercadoria; linha faltando ninguém nota, porque não há o
 * que olhar.
 *
 * A folga de 1% cobre arredondamento e desconto de centavos; acima disso é
 * problema de leitura.
 */
export function somaConfere(nota: NotaLida): { confere: boolean; soma: number; diferenca: number | null } {
  const soma = nota.linhas.reduce((total, l) => total + l.quantidade * l.valorUnitario, 0);
  if (nota.valorTotal === null) return { confere: true, soma, diferenca: null };

  const diferenca = soma - nota.valorTotal;
  const folga = Math.max(nota.valorTotal * 0.01, 0.05);
  return { confere: Math.abs(diferenca) <= folga, soma, diferenca };
}
