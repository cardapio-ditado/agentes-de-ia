import Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { randomUUID } from "node:crypto";
import { anthropicConfig } from "./config.js";
import { db } from "./supabase.js";
import type { Json } from "./database.types.js";
import type { Agent } from "./repository.js";

/**
 * Treinamento do agente: texto digitado, documentos e imagens.
 *
 * Os itens vivem em `agents.config.training` (jsonb). Para a escala de um
 * bar — dezenas de itens, não milhares — isso dispensa migration e tabela
 * nova; quando houver busca semântica, aí sim nasce uma tabela com embeddings.
 *
 * Documento e imagem passam pelo Claude na hora do upload: o que fica salvo
 * é o TEXTO extraído, não o arquivo. Assim cada conversa não paga o custo de
 * reprocessar o PDF, e o conteúdo entra no prompt como bloco cacheável.
 */

export interface ItemTreinamento {
  id: string;
  kind: "texto" | "documento" | "imagem";
  titulo: string;
  arquivo: string | null;
  conteudo: string;
  criado_em: string;
}

/** Limite de texto extraído por item — o prompt inteiro tem que caber no cache. */
const MAX_CONTEUDO = 30_000;

/** Tipos aceitos no upload, com o bloco da API que cada um usa. */
const TIPOS_DOCUMENTO = ["application/pdf"];
const TIPOS_TEXTO = ["text/plain", "text/markdown", "text/csv"];
const TIPOS_IMAGEM = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const TIPOS_WORD = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const TIPOS_EXCEL = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

/** Bytes crus por item — sem o custo de base64, cabe mais antes do limite da Vercel. */
export const LIMITE_ARQUIVO_BYTES = 20_000_000;

let cachedClient: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: anthropicConfig().apiKey });
  }
  return cachedClient;
}

function itensDe(agent: Agent): ItemTreinamento[] {
  const config = (agent.config ?? {}) as Record<string, unknown>;
  return Array.isArray(config.training) ? (config.training as unknown as ItemTreinamento[]) : [];
}

export function listTraining(agent: Agent): ItemTreinamento[] {
  return itensDe(agent);
}

/**
 * Bloco de conhecimento que entra no system prompt do agente.
 *
 * Vazio quando não há treinamento — não vale gastar um bloco de cache com
 * cabeçalho sem conteúdo.
 */
export function blocoDeConhecimento(agent: Agent): string | null {
  const itens = itensDe(agent);
  if (itens.length === 0) return null;

  const partes = itens.map(
    (i) => `## ${i.titulo}${i.arquivo ? ` (fonte: ${i.arquivo})` : ""}\n\n${i.conteudo}`,
  );
  return (
    "# Base de conhecimento do estabelecimento\n\n" +
    "Use as informações abaixo para responder. Elas foram fornecidas pela equipe " +
    "e são a fonte confiável sobre a casa. Não invente nada além delas.\n\n" +
    partes.join("\n\n---\n\n")
  );
}

async function salvar(agent: Agent, itens: ItemTreinamento[]): Promise<void> {
  const config = {
    ...((agent.config ?? {}) as Record<string, unknown>),
    // A interface não tem index signature, então não é atribuível a Json por
    // tipo — mas a estrutura é JSON puro (strings e null).
    training: itens as unknown as Json,
  };
  const { error } = await db()
    .from("agents")
    .update({ config: config as Json })
    .eq("id", agent.id);
  if (error) throw new Error(`Falha ao salvar o treinamento: ${error.message}`);
}

/**
 * Extrai o texto útil de um documento (PDF) ou imagem usando o Claude.
 *
 * A conversão para base64 acontece aqui dentro, na hora de falar com a API —
 * o cliente manda o arquivo cru, sem o custo de ~33% do base64 na rede.
 *
 * O prompt pede transcrição fiel, não resumo: cardápio com preço errado por
 * causa de um resumo criativo é pior do que nenhum treinamento.
 */
async function extrairComModelo(params: {
  mediaType: string;
  arquivo: Buffer;
  titulo: string;
}): Promise<string> {
  const { mediaType, arquivo, titulo } = params;
  const dadosBase64 = arquivo.toString("base64");

  const instrucao =
    `Extraia o conteúdo deste material ("${titulo}") para a base de conhecimento ` +
    "de um agente de atendimento de bar/restaurante. Transcreva fielmente as " +
    "informações úteis — itens, preços, horários, regras, datas — em texto " +
    "estruturado com títulos. Não resuma criativamente, não invente, não omita " +
    "preços ou condições. Se algo estiver ilegível, marque como [ilegível].";

  const bloco: Anthropic.ContentBlockParam = TIPOS_DOCUMENTO.includes(mediaType)
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: dadosBase64 },
      }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: dadosBase64,
        },
      };

  // Streaming: um PDF grande pode levar mais que o timeout HTTP não-streaming.
  const stream = anthropic().messages.stream({
    model: "claude-opus-5",
    max_tokens: 16000,
    messages: [{ role: "user", content: [bloco, { type: "text", text: instrucao }] }],
  });
  const resposta = await stream.finalMessage();

  if (resposta.stop_reason === "refusal") {
    throw new Error("O modelo recusou processar este arquivo.");
  }

  const texto = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!texto) throw new Error("Não consegui extrair conteúdo deste arquivo.");
  return texto.slice(0, MAX_CONTEUDO);
}

/**
 * Extrai o texto de um .docx diretamente — sem passar pelo modelo.
 *
 * A API do Claude não aceita Word como bloco de documento (só PDF); mammoth
 * lê o XML do próprio arquivo. Mais rápido, mais barato e mais fiel do que
 * pedir pro modelo "ler" um formato que ele não processa nativamente.
 */
async function extrairDocx(arquivo: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: arquivo });
  const texto = value.trim();
  if (!texto) throw new Error("Não encontrei texto neste .docx — ele pode ser só imagens.");
  return texto.slice(0, MAX_CONTEUDO);
}

/** Extrai as planilhas de um .xlsx/.xls como texto em CSV, uma seção por aba. */
async function extrairPlanilha(arquivo: Buffer): Promise<string> {
  const livro = new ExcelJS.Workbook();
  // exceljs declara um `Buffer` global próprio (`extends ArrayBuffer`) que se
  // funde com o Buffer real do Node e quebra sob @types/node novo — o cast
  // para o Buffer do pacote não escapa da mistura, então aqui vale o any:
  // o valor é um Buffer de verdade, só a declaração de tipo é que está errada.
  await livro.xlsx.load(arquivo as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  const secoes: string[] = [];
  livro.eachSheet((aba) => {
    const linhas: string[] = [];
    aba.eachRow((linha) => {
      const celulas = (linha.values as ExcelJS.CellValue[])
        .slice(1) // values[0] é sempre vazio — ExcelJS indexa colunas a partir de 1
        .map((v) => (v === null || v === undefined ? "" : String(v)));
      linhas.push(celulas.join(", "));
    });
    if (linhas.length > 0) secoes.push(`## ${aba.name}\n\n${linhas.join("\n")}`);
  });

  const texto = secoes.join("\n\n").trim();
  if (!texto) throw new Error("Não encontrei dados nesta planilha.");
  return texto.slice(0, MAX_CONTEUDO);
}

export async function addTrainingText(params: {
  agent: Agent;
  titulo: string;
  conteudo: string;
}): Promise<ItemTreinamento> {
  const item: ItemTreinamento = {
    id: randomUUID(),
    kind: "texto",
    titulo: params.titulo.trim(),
    arquivo: null,
    conteudo: params.conteudo.trim().slice(0, MAX_CONTEUDO),
    criado_em: new Date().toISOString(),
  };
  if (!item.titulo) throw new Error("O item precisa de um título.");
  if (!item.conteudo) throw new Error("O conteúdo não pode ser vazio.");

  await salvar(params.agent, [...itensDe(params.agent), item]);
  return item;
}

export async function addTrainingFile(params: {
  agent: Agent;
  titulo: string;
  nomeArquivo: string;
  mediaType: string;
  /** Bytes crus do arquivo — nunca base64: o cliente manda o arquivo como veio. */
  arquivo: Buffer;
}): Promise<ItemTreinamento> {
  const { agent, titulo, nomeArquivo, mediaType, arquivo } = params;

  if (arquivo.byteLength > LIMITE_ARQUIVO_BYTES) {
    throw new Error(
      `Arquivo de ${(arquivo.byteLength / 1_000_000).toFixed(1)} MB acima do limite de ` +
        `${LIMITE_ARQUIVO_BYTES / 1_000_000} MB. Divida o material ou comprima o arquivo.`,
    );
  }

  let conteudo: string;
  let kind: ItemTreinamento["kind"];

  if (TIPOS_TEXTO.includes(mediaType)) {
    // Texto puro não precisa do modelo nem de biblioteca: decodifica e pronto.
    kind = "documento";
    conteudo = arquivo.toString("utf8").trim().slice(0, MAX_CONTEUDO);
    if (!conteudo) throw new Error("O arquivo está vazio.");
  } else if (TIPOS_WORD.includes(mediaType)) {
    kind = "documento";
    conteudo = await extrairDocx(arquivo);
  } else if (TIPOS_EXCEL.includes(mediaType)) {
    kind = "documento";
    conteudo = await extrairPlanilha(arquivo);
  } else if (TIPOS_DOCUMENTO.includes(mediaType)) {
    kind = "documento";
    conteudo = await extrairComModelo({ mediaType, arquivo, titulo });
  } else if (TIPOS_IMAGEM.includes(mediaType)) {
    kind = "imagem";
    conteudo = await extrairComModelo({ mediaType, arquivo, titulo });
  } else {
    throw new Error(
      `Tipo "${mediaType}" não aceito. Envie PDF, Word (.docx), Excel (.xlsx/.xls), ` +
        "imagem (JPEG/PNG/WebP/GIF), .txt, .md ou .csv.",
    );
  }

  const item: ItemTreinamento = {
    id: randomUUID(),
    kind,
    titulo: titulo.trim() || nomeArquivo,
    arquivo: nomeArquivo,
    conteudo,
    criado_em: new Date().toISOString(),
  };

  await salvar(agent, [...itensDe(agent), item]);
  return item;
}

export async function removeTraining(agent: Agent, itemId: string): Promise<void> {
  const itens = itensDe(agent);
  const restantes = itens.filter((i) => i.id !== itemId);
  if (restantes.length === itens.length) throw new Error("Item de treinamento não encontrado.");
  await salvar(agent, restantes);
}
