import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicConfig } from "./config.js";
import { db } from "./supabase.js";

/**
 * O modelo da pesquisa: as perguntas que a casa faz.
 *
 * Antes era um formulário fixo — nota de 0 a 10 e umas etiquetas. Isso diz SE
 * está bom; não diz O QUE está bom. Um bar que quer saber se o problema é a
 * cozinha ou o salão precisa de nota separada por assunto, e cada casa tem os
 * seus: quem tem estacionamento pergunta do estacionamento, quem tem palco
 * pergunta do som.
 *
 * A montagem segue o mesmo caminho do checklist, inclusive na IA que
 * entrevista quem está criando antes de propor as perguntas. O motivo é o
 * mesmo lá e aqui: uma tela em branco com "adicione uma pergunta" produz
 * pesquisa de três perguntas genéricas, e pesquisa genérica não muda decisão
 * nenhuma.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const cliente = () => db() as any;

const MODELO_IA = "claude-sonnet-5";

/** Quantas perguntas cabem antes de o cliente desistir no meio. */
const MAXIMO_DE_ITENS = 20;

export type TipoDePergunta = "nota" | "estrelas" | "sim_nao" | "texto";

const TIPOS = new Set<string>(["nota", "estrelas", "sim_nao", "texto"]);

export interface ItemDaPesquisa {
  id: string;
  /** O assunto que esta pergunta mede: "Comida", "Atendimento", "Ambiente". */
  categoria: string;
  pergunta: string;
  tipo: TipoDePergunta;
  obrigatorio: boolean;
}

/** Sugestões de categoria na tela. Texto livre, porque cada casa tem as suas. */
export const CATEGORIAS_SUGERIDAS = [
  "Atendimento",
  "Comida",
  "Bebidas",
  "Ambiente",
  "Música",
  "Preço",
  "Tempo de espera",
  "Limpeza",
] as const;

export class ErroDeModelo extends Error {
  constructor(readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

/**
 * Converte a resposta do cliente para a escala única de 0 a 10.
 *
 * É esta função que permite somar "Comida" quando uma pergunta é em estrelas e
 * a outra em nota. Sem uma escala só, a média por categoria seria a média de
 * unidades diferentes — um número que parece certo e não é.
 */
export function notaNormalizada(tipo: TipoDePergunta, valor: unknown): number | null {
  if (tipo === "texto") return null;

  if (tipo === "nota") {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 && n <= 10 ? n : null;
  }
  if (tipo === "estrelas") {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 1 || n > 5) return null;
    // 1 estrela é o pior possível, e o pior possível é zero — não 2. Mapear
    // 1..5 direto para 2..10 daria média 6 para uma casa que só toma uma
    // estrela, e o dono acharia que está mediano.
    return ((n - 1) / 4) * 10;
  }
  if (tipo === "sim_nao") {
    const s = String(valor).toLowerCase();
    if (s === "sim" || s === "true") return 10;
    if (s === "nao" || s === "não" || s === "false") return 0;
    return null;
  }
  return null;
}

/**
 * Valida a lista de perguntas.
 *
 * Serve à tela e à IA: o que a IA devolve passa exatamente pela mesma porta
 * que o que uma pessoa digitou. Sem isso, um modelo alucinando um tipo novo
 * gravaria uma pergunta que a tela do cliente não sabe desenhar.
 */
export function validarItens(bruto: unknown): ItemDaPesquisa[] {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    throw new ErroDeModelo(400, "A pesquisa precisa de ao menos uma pergunta.");
  }
  if (bruto.length > MAXIMO_DE_ITENS) {
    throw new ErroDeModelo(
      400,
      `Máximo de ${MAXIMO_DE_ITENS} perguntas — acima disso o cliente abandona no meio.`,
    );
  }

  const itens = bruto.map((cru, i) => {
    const o = (cru ?? {}) as Record<string, unknown>;

    const tipo = String(o.tipo ?? "");
    if (!TIPOS.has(tipo)) {
      throw new ErroDeModelo(400, `Pergunta ${i + 1}: tipo "${tipo}" não existe.`);
    }
    const pergunta = typeof o.pergunta === "string" ? o.pergunta.trim() : "";
    if (!pergunta) throw new ErroDeModelo(400, `Pergunta ${i + 1}: o texto não pode ficar vazio.`);

    // Categoria vazia viraria um grupo "" no painel, que não diz nada a
    // ninguém. "Geral" é honesto: é onde vai o que não se encaixa.
    const categoria = typeof o.categoria === "string" && o.categoria.trim()
      ? o.categoria.trim()
      : "Geral";

    return {
      id: typeof o.id === "string" && o.id ? o.id : randomUUID(),
      categoria,
      pergunta,
      tipo: tipo as TipoDePergunta,
      obrigatorio: o.obrigatorio === true,
    };
  });

  // Toda pesquisa precisa medir alguma coisa. Uma só de perguntas abertas não
  // produz nota nenhuma, e a tela de "como andam as coisas" ficaria vazia
  // sem ninguém entender por quê.
  if (!itens.some((i) => i.tipo !== "texto")) {
    throw new ErroDeModelo(
      400,
      "Ponha ao menos uma pergunta com nota — só perguntas abertas não geram dado nenhum para acompanhar.",
    );
  }
  return itens;
}

// ============================================================
// As pesquisas da casa
// ============================================================

export interface Pesquisa {
  id: string;
  venue_id: string;
  nome: string;
  descricao: string | null;
  itens: ItemDaPesquisa[];
  ativa: boolean;
  created_at: string;
  updated_at: string;
}

function comoPesquisa(linha: Record<string, unknown>): Pesquisa {
  return {
    id: String(linha.id),
    venue_id: String(linha.venue_id),
    nome: String(linha.nome),
    descricao: (linha.descricao as string) ?? null,
    itens: Array.isArray(linha.itens) ? (linha.itens as ItemDaPesquisa[]) : [],
    ativa: Boolean(linha.ativa),
    created_at: String(linha.created_at),
    updated_at: String(linha.updated_at),
  };
}

export async function listarPesquisas(venueId: string): Promise<Pesquisa[]> {
  const { data, error } = await cliente()
    .from("pesquisas")
    .select("*")
    .eq("venue_id", venueId)
    .order("ativa", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new ErroDeModelo(500, `Falha ao listar as pesquisas: ${error.message}`);
  return (data ?? []).map(comoPesquisa);
}

/** A pesquisa que o QR code da mesa abre. Null = a casa ainda não montou. */
export async function pesquisaAtiva(venueId: string): Promise<Pesquisa | null> {
  const { data, error } = await cliente()
    .from("pesquisas")
    .select("*")
    .eq("venue_id", venueId)
    .eq("ativa", true)
    .maybeSingle();
  if (error) throw new ErroDeModelo(500, `Falha ao ler a pesquisa: ${error.message}`);
  return data ? comoPesquisa(data) : null;
}

export async function criarPesquisa(params: {
  venueId: string;
  nome: string;
  descricao?: string | null;
  itens: unknown;
  ativar?: boolean;
}): Promise<Pesquisa> {
  const nome = params.nome.trim();
  if (!nome) throw new ErroDeModelo(400, "Dê um nome à pesquisa.");
  const itens = validarItens(params.itens);

  // A primeira pesquisa da casa nasce ativa, sempre. Criar a pesquisa e
  // descobrir depois que o QR code não abre nada porque faltava "ativar" é o
  // tipo de passo escondido que faz o cliente achar que o módulo não funciona.
  const jaTemAlguma = (await listarPesquisas(params.venueId)).length > 0;
  const ativar = params.ativar ?? !jaTemAlguma;

  if (ativar) await desativarTodas(params.venueId);

  const { data, error } = await cliente()
    .from("pesquisas")
    .insert({
      venue_id: params.venueId,
      nome,
      descricao: params.descricao?.trim() || null,
      itens,
      ativa: ativar,
    } as never)
    .select("*")
    .single();
  if (error) throw new ErroDeModelo(500, `Falha ao criar a pesquisa: ${error.message}`);
  return comoPesquisa(data);
}

export async function atualizarPesquisa(params: {
  venueId: string;
  id: string;
  nome?: string;
  descricao?: string | null;
  itens?: unknown;
  ativa?: boolean;
}): Promise<Pesquisa> {
  const mudancas: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (params.nome !== undefined) {
    const nome = params.nome.trim();
    if (!nome) throw new ErroDeModelo(400, "O nome não pode ficar vazio.");
    mudancas.nome = nome;
  }
  if (params.descricao !== undefined) mudancas.descricao = params.descricao?.trim() || null;
  if (params.itens !== undefined) mudancas.itens = validarItens(params.itens);

  // Ativar esta desativa as outras ANTES do update: o índice único deixa uma
  // só ativa, e sem apagar a anterior primeiro o banco recusaria a troca.
  if (params.ativa === true) {
    await desativarTodas(params.venueId, params.id);
    mudancas.ativa = true;
  } else if (params.ativa === false) {
    mudancas.ativa = false;
  }

  const { data, error } = await cliente()
    .from("pesquisas")
    .update(mudancas as never)
    .eq("id", params.id)
    .eq("venue_id", params.venueId)
    .select("*")
    .maybeSingle();
  if (error) throw new ErroDeModelo(500, `Falha ao salvar a pesquisa: ${error.message}`);
  if (!data) throw new ErroDeModelo(404, "Pesquisa não encontrada nesta casa.");
  return comoPesquisa(data);
}

async function desativarTodas(venueId: string, exceto?: string): Promise<void> {
  let consulta = cliente()
    .from("pesquisas")
    .update({ ativa: false } as never)
    .eq("venue_id", venueId)
    .eq("ativa", true);
  if (exceto) consulta = consulta.neq("id", exceto);
  const { error } = await consulta;
  if (error) throw new ErroDeModelo(500, `Falha ao trocar a pesquisa ativa: ${error.message}`);
}

export async function apagarPesquisa(venueId: string, id: string): Promise<void> {
  // As respostas sobrevivem: `pesquisa_id` é `on delete set null`, e cada
  // linha de nota guarda a pergunta copiada. Apagar a pesquisa de agosto não
  // pode apagar o que os clientes responderam em agosto.
  const { error } = await cliente()
    .from("pesquisas")
    .delete()
    .eq("id", id)
    .eq("venue_id", venueId);
  if (error) throw new ErroDeModelo(500, `Falha ao apagar: ${error.message}`);
}

// ============================================================
// A IA que ajuda a montar
// ============================================================

let clienteIa: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!clienteIa) clienteIa = new Anthropic({ apiKey: anthropicConfig().apiKey });
  return clienteIa;
}

export interface MensagemDaConversa {
  papel: "usuario" | "ia";
  texto: string;
}

export type RespostaDaConversa =
  | { tipo: "pergunta"; texto: string }
  | { tipo: "itens"; itens: ItemDaPesquisa[] };

/**
 * Monta a pesquisa conversando, como o checklist faz.
 *
 * A IA entrevista antes de propor: que tipo de casa é, o que o dono desconfia
 * que está ruim, o que ele já tentou medir. Sem a entrevista, a proposta sai
 * genérica — "como foi a comida?", "como foi o atendimento?" — e uma pesquisa
 * genérica não muda decisão nenhuma.
 *
 * Duas rodadas de perguntas no máximo: quem está montando quer terminar, e um
 * questionário sobre o questionário cansa antes de chegar ao fim.
 */
export async function conversarMontagem(
  mensagens: MensagemDaConversa[],
): Promise<RespostaDaConversa> {
  const conversa = alternarPapeis(mensagens);
  if (conversa.length === 0) {
    throw new ErroDeModelo(400, "Conte que tipo de casa é a sua para começar.");
  }

  const resposta = await anthropic().messages.create({
    model: MODELO_IA,
    max_tokens: 2000,
    system:
      "Você monta pesquisas de satisfação para bares e restaurantes brasileiros, " +
      "conversando com o dono antes de gerar. O cliente vai responder no celular, " +
      "de pé, esperando a conta — cada pergunta a mais derruba a taxa de resposta. " +
      "Entenda primeiro: que tipo de casa é (bar, restaurante, casa de shows); o que " +
      "o dono desconfia que está ruim; se tem palco, estacionamento, área externa, " +
      "delivery; e se quer medir alguém ou algo específico. " +
      "Faça NO MÁXIMO duas rodadas de perguntas — curtas, agrupadas numa mensagem só, " +
      "no máximo 4 por rodada. Se o contexto já basta (ou o dono pediu para gerar logo), gere. " +
      "REGRAS DAS PERGUNTAS: entre 4 e 8 perguntas, nunca mais; cada uma com uma CATEGORIA " +
      "que é o assunto medido (Comida, Atendimento, Ambiente, Preço, Música, Limpeza, " +
      "Tempo de espera, ou outra que faça sentido para a casa); a maioria do tipo " +
      '"nota" ou "estrelas", porque é delas que sai o acompanhamento; no máximo UMA do ' +
      'tipo "texto", no fim. Pergunta curta, direta, sobre UMA coisa só — "a comida e o ' +
      'atendimento foram bons?" não pode ser respondida com um número. Nada de perguntar ' +
      "o que a casa não tem. " +
      "Responda SEMPRE um único JSON válido, sem texto fora dele, num destes formatos: " +
      '{"tipo":"pergunta","texto":"suas perguntas aqui"} ou ' +
      '{"tipo":"itens","itens":[{"categoria":"Comida","pergunta":"...","tipo":"nota"|"estrelas"|"sim_nao"|"texto","obrigatorio":true|false}]}',
    messages: conversa.map((m) => ({
      role: m.papel === "ia" ? ("assistant" as const) : ("user" as const),
      content: m.texto,
    })),
  });

  const texto = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return interpretarResposta(texto);
}

/**
 * Deixa a conversa alternando entre pessoa e IA.
 *
 * A API recusa dois turnos seguidos do mesmo lado, e é fácil produzir isso sem
 * perceber: bastava a tela esquecer de registrar um turno da IA para a
 * mensagem seguinte da pessoa virar o segundo "usuario" em sequência — e aí
 * TODA continuação da conversa falhava, justamente quando alguém tentava
 * acrescentar uma informação depois de a IA já ter proposto as perguntas.
 *
 * Juntar em vez de descartar: o que a pessoa escreveu em duas mensagens
 * continua valendo como contexto.
 */
export function alternarPapeis(mensagens: MensagemDaConversa[]): MensagemDaConversa[] {
  const limpas = mensagens
    .map((m) => ({ papel: m.papel, texto: String(m.texto ?? "").trim() }))
    .filter((m) => m.texto);

  const saida: MensagemDaConversa[] = [];
  for (const m of limpas) {
    const anterior = saida[saida.length - 1];
    if (anterior && anterior.papel === m.papel) {
      anterior.texto = `${anterior.texto}\n\n${m.texto}`;
    } else {
      saida.push({ ...m });
    }
  }

  // Uma conversa que começa pela IA não existe: o primeiro turno é sempre de
  // quem pediu alguma coisa.
  while (saida.length > 0 && saida[0]!.papel === "ia") saida.shift();
  return saida;
}

/**
 * Traduz o que o modelo devolveu.
 *
 * Exportada para teste: a leitura do JSON e a recusa do que veio torto não
 * deveriam custar uma chamada de API para serem verificadas.
 */
export function interpretarResposta(texto: string): RespostaDaConversa {
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) {
    throw new ErroDeModelo(502, "A IA respondeu num formato inesperado — tente de novo.");
  }

  let bruto: { tipo?: string; texto?: string; itens?: unknown };
  try {
    bruto = JSON.parse(texto.slice(inicio, fim + 1));
  } catch {
    throw new ErroDeModelo(502, "A IA respondeu num formato inesperado — tente de novo.");
  }

  if (bruto.tipo === "itens") return { tipo: "itens", itens: validarItens(bruto.itens) };
  if (bruto.tipo === "pergunta" && typeof bruto.texto === "string" && bruto.texto.trim()) {
    return { tipo: "pergunta", texto: bruto.texto.trim() };
  }
  throw new ErroDeModelo(502, "A IA respondeu num formato inesperado — tente de novo.");
}
