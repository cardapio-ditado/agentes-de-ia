import Anthropic from "@anthropic-ai/sdk";
import { modeloDaTarefa } from "./modelos.js";
import ExcelJS from "exceljs";
import { anthropicConfig } from "./config.js";

/**
 * A agenda da casa, do jeito que ela já existe.
 *
 * Toda casa já mantém a programação em algum lugar: a planilha do dono, o
 * cartaz do mês, a mensagem que o produtor manda no WhatsApp. Pedir para
 * alguém digitar de novo, evento por evento, num formulário com sete campos,
 * é pedir para não ser feito — e agenda desatualizada faz o agente responder
 * errado, que é pior que não responder.
 *
 * Aqui entra o que já existe: cola-se o texto, manda-se a foto do cartaz ou o
 * arquivo da planilha, e a IA devolve a lista para conferir. O trabalho vira
 * CONFERIR em vez de DIGITAR.
 *
 * A pessoa confirma antes de gravar. Sempre: um show inventado pela leitura
 * de uma foto ruim viraria promessa ao cliente.
 */

const MODELO = () => modeloDaTarefa("lerProgramacao");

/** Os tipos que a agenda aceita — os mesmos do banco. */
const TIPOS = ["musica", "jogo", "promocao", "evento", "outro"] as const;

export interface EventoLido {
  titulo: string;
  tipo: (typeof TIPOS)[number];
  /** AAAA-MM-DD no calendário da casa. */
  data: string;
  /** HH:MM no relógio da casa. */
  inicio: string;
  /** HH:MM, ou nulo quando não foi dito. Menor que o início = vira a noite. */
  fim: string | null;
  descricao: string | null;
  couvert: number | null;
}

export interface ProgramacaoLida {
  eventos: EventoLido[];
  avisos: string[];
}

const TIPOS_TEXTO = new Set(["text/csv", "text/plain", "application/csv"]);
const TIPOS_EXCEL = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
const TIPOS_PDF = new Set(["application/pdf"]);
const TIPOS_IMAGEM = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function tipoDeAgendaAceito(mediaType: string): boolean {
  const t = mediaType.toLowerCase();
  return TIPOS_TEXTO.has(t) || TIPOS_EXCEL.has(t) || TIPOS_PDF.has(t) || TIPOS_IMAGEM.has(t);
}

const FERRAMENTA = {
  name: "registrar_agenda",
  description: "Registra os eventos da programação que aparecem no material.",
  input_schema: {
    type: "object" as const,
    properties: {
      eventos: {
        type: "array",
        description: "Um objeto por apresentação. Duas atrações no mesmo dia são DOIS eventos.",
        items: {
          type: "object",
          properties: {
            titulo: {
              type: "string",
              description:
                "O nome da atração como está escrito: 'Acústico Berê', 'Grupo Karanova'. Sem inventar sobrenome nem corrigir grafia.",
            },
            tipo: {
              type: "string",
              enum: [...TIPOS],
              description:
                "musica para show e DJ; jogo para transmissão esportiva; promocao para happy hour e desconto; evento para festa, aniversário e data comemorativa; outro para o resto.",
            },
            data: { type: "string", description: "AAAA-MM-DD." },
            inicio: { type: "string", description: "HH:MM em 24 horas." },
            fim: {
              type: ["string", "null"],
              description: "HH:MM em 24 horas, ou nulo se o material não disser. Pode ser menor que o início (vira a madrugada).",
            },
            descricao: { type: ["string", "null"], description: "Detalhe curto, se houver." },
            couvert: { type: ["number", "null"], description: "Valor do couvert em reais, se estiver escrito." },
          },
          required: ["titulo", "tipo", "data", "inicio"],
        },
      },
      avisos: {
        type: "array",
        items: { type: "string" },
        description: "O que ficou ilegível, ambíguo ou foi ignorado. Vazio se estava tudo claro.",
      },
    },
    required: ["eventos", "avisos"],
  },
};

const INSTRUCOES = `Você lê agendas de bares e restaurantes e transforma em registros. O material pode ser uma planilha, um cartaz, uma mensagem de WhatsApp ou um texto digitado às pressas.

Regras:
- O nome da atração vai como está escrito. Não corrija grafia nem complete nome.
- Duas atrações no mesmo dia são DOIS eventos, cada um com seu horário.
- "20h às 23h" tem início e fim. "A partir das 20h" tem só início. Sem horário nenhum, use 20:00 e diga isso nos avisos — é o horário de show mais comum, e um evento sem hora não entra na agenda.
- Hora final menor que a inicial é a madrugada seguinte: "23h às 1h" está certo assim, não corrija.
- IGNORE o que não é apresentação: cabeçalho de planilha, total, telefone, endereço, observação administrativa, valor de cachê.
- Cachê NÃO é couvert. Só registre couvert se estiver escrito que é o que o CLIENTE paga para entrar.
- Se o material não disser o ano, use o que foi informado como ano de referência.
- Se algo estiver ilegível, NÃO CHUTE: deixe o evento de fora e explique nos avisos. Um show inventado vira promessa ao cliente que a casa não vai cumprir.
- Se o material não parecer uma agenda, devolva a lista vazia e diga o que você viu.`;

/** Converte planilha em texto. PDF e imagem vão inteiros para o modelo. */
async function comoTexto(arquivo: Buffer, mediaType: string): Promise<string | null> {
  const tipo = mediaType.toLowerCase();
  if (TIPOS_TEXTO.has(tipo)) return arquivo.toString("utf8");
  if (!TIPOS_EXCEL.has(tipo)) return null;

  const livro = new ExcelJS.Workbook();
  // exceljs declara um `Buffer` próprio que conflita com o do Node; o valor é
  // um Buffer de verdade, só a tipagem é que está errada (ver training.ts).
  await livro.xlsx.load(arquivo as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  const secoes: string[] = [];
  livro.eachSheet((aba) => {
    const linhas: string[] = [];
    aba.eachRow((linha) => {
      const celulas = (linha.values as ExcelJS.CellValue[]).slice(1).map((v) => {
        if (v === null || v === undefined) return "";
        // Data de célula vira AAAA-MM-DD: o modelo não deveria ter que
        // decifrar "Mon Aug 17 2026 00:00:00 GMT-0400".
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

export async function lerProgramacao(params: {
  /** Texto colado ou digitado. Um dos dois é obrigatório. */
  texto?: string | null;
  arquivo?: Buffer | null;
  mediaType?: string | null;
  /** Para completar datas sem ano e resolver "sábado que vem". */
  hoje: string;
}): Promise<ProgramacaoLida> {
  const { apiKey } = anthropicConfig();
  const anthropic = new Anthropic({ apiKey });

  const conteudo: Anthropic.ContentBlockParam[] = [];

  if (params.arquivo && params.mediaType) {
    if (!tipoDeAgendaAceito(params.mediaType)) {
      throw new Error(`Formato ${params.mediaType} não serve. Mande foto, PDF, Excel ou CSV.`);
    }
    const texto = await comoTexto(params.arquivo, params.mediaType);
    if (texto !== null) {
      if (!texto.trim()) throw new Error("O arquivo veio vazio.");
      conteudo.push({ type: "text", text: `Material:\n\n${texto}` });
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
  }

  if (params.texto?.trim()) {
    conteudo.push({ type: "text", text: `Material:\n\n${params.texto.trim()}` });
  }

  if (conteudo.length === 0) {
    throw new Error("Cole o texto da agenda ou mande um arquivo.");
  }

  conteudo.push({
    type: "text",
    text: `Hoje é ${params.hoje}. Use este ano quando o material não disser, e resolva referências como "sexta que vem" a partir desta data.`,
  });

  const resposta = await anthropic.messages.create({
    model: MODELO(),
    max_tokens: 8000,
    system: INSTRUCOES,
    tools: [FERRAMENTA],
    tool_choice: { type: "tool", name: "registrar_agenda" },
    messages: [{ role: "user", content: conteudo }],
  });

  const uso = resposta.content.find((b) => b.type === "tool_use");
  if (!uso || uso.type !== "tool_use") {
    throw new Error("Não consegui entender esta agenda. Tente colar o texto em vez do arquivo.");
  }
  return converter(uso.input as Record<string, unknown>);
}

/**
 * Traduz a resposta do modelo, descartando o que não serve.
 *
 * Exportada para teste: a regra do que é um evento aproveitável não deveria
 * custar uma chamada de API para ser verificada.
 */
export function converter(bruto: Record<string, unknown>): ProgramacaoLida {
  const avisos = Array.isArray(bruto.avisos) ? bruto.avisos.map(String) : [];
  const eventos: EventoLido[] = [];

  for (const cru of (Array.isArray(bruto.eventos) ? bruto.eventos : []) as Array<
    Record<string, unknown>
  >) {
    const titulo = typeof cru.titulo === "string" ? cru.titulo.trim() : "";
    const data = typeof cru.data === "string" ? cru.data.trim() : "";
    const inicio = horaValida(cru.inicio);

    if (!titulo) {
      avisos.push("Um evento veio sem nome e foi descartado.");
      continue;
    }
    // Data fora do formato viraria evento em dia inventado — e um show no dia
    // errado é pior que um show ausente: o cliente vem e não tem nada.
    //
    // A volta é conferida porque o JavaScript ACEITA data impossível e a
    // desloca em silêncio: "2026-02-31" vira 3 de março sem erro nenhum. Só
    // comparar o resultado com o que entrou revela isso.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || new Date(`${data}T12:00:00Z`).toISOString().slice(0, 10) !== data) {
      avisos.push(`"${titulo}": data não reconhecida — confira e cadastre à mão.`);
      continue;
    }
    if (!inicio) {
      avisos.push(`"${titulo}": horário de início não reconhecido.`);
      continue;
    }

    const couvert = Number(cru.couvert);
    eventos.push({
      titulo,
      tipo: (TIPOS as readonly string[]).includes(String(cru.tipo))
        ? (cru.tipo as EventoLido["tipo"])
        : "musica",
      data,
      inicio,
      fim: horaValida(cru.fim),
      descricao: typeof cru.descricao === "string" && cru.descricao.trim() ? cru.descricao.trim() : null,
      couvert: Number.isFinite(couvert) && couvert > 0 ? couvert : null,
    });
  }

  if (eventos.length === 0) avisos.push("Nenhum evento foi reconhecido neste material.");

  // Em ordem de calendário: é assim que a pessoa vai conferir contra o
  // material original.
  eventos.sort((a, b) => `${a.data} ${a.inicio}`.localeCompare(`${b.data} ${b.inicio}`));
  return { eventos, avisos };
}

/** HH:MM em 24 horas, ou nulo. "20h" e "8 da noite" não passam daqui. */
function horaValida(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  if (!/^\d{1,2}:\d{2}$/.test(limpo)) return null;
  const [h, m] = limpo.split(":").map(Number);
  if (h! > 23 || m! > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
