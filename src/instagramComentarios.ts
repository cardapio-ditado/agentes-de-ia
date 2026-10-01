import Anthropic from "@anthropic-ai/sdk";
import { anthropicConfig } from "./config.js";
import { modeloDaTarefa } from "./modelos.js";
import { db } from "./supabase.js";
import type { ConexaoInstagram } from "./instagramOficial.js";

/**
 * COMENTÁRIOS NOS POSTS — o "quero!" vira direct, e o direct vira reserva.
 *
 * Um post de promoção enche de comentário e nada acontece: ninguém lê os
 * quarenta "quero", e quem comentou não foi atendido. Aqui cada comentário
 * passa por uma peneira (elogio, emoji, marcação de amigo e spam ficam de
 * fora) e o que sobra vai para o AGENTE, que responde por mensagem privada
 * — a Meta permite responder um comentário no direct por 7 dias, sem a
 * pessoa ter escrito antes. Dali em diante é a conversa de sempre.
 *
 * No post, público, sai só uma frase fixa da casa ("te chamei no direct"),
 * e só se a casa quiser. O agente nunca fala em público: resposta pública
 * errada é vista por todo mundo, e a privada é corrigível.
 */

export type ModoDeComentarios = "desligado" | "privado" | "publico_e_privado";

export const MODOS_DE_COMENTARIOS: Array<{ id: ModoDeComentarios; nome: string; dica: string }> = [
  { id: "desligado", nome: "Não responder", dica: "Comentário fica como comentário." },
  { id: "privado", nome: "Chamar no direct", dica: "O agente responde a pessoa por mensagem privada. Nada aparece no post." },
  { id: "publico_e_privado", nome: "Responder no post e chamar no direct", dica: "Além do direct, deixa a frase fixa abaixo no post, para quem lê ver que a casa responde." },
];

export const AVISO_PUBLICO_PADRAO = "Te chamei no direct 😉";

export function modoValido(valor: unknown): ModoDeComentarios | null {
  return MODOS_DE_COMENTARIOS.some((m) => m.id === valor) ? (valor as ModoDeComentarios) : null;
}

// ============================================================
// O webhook: os comentários que vieram no lote
// ============================================================

export interface ComentarioRecebido {
  id: string;
  texto: string;
  autor_id: string | null;
  autor: string | null;
  media_id: string | null;
  /** Resposta a outro comentário (e não ao post). */
  parent_id: string | null;
}

/** Os comentários de um `entry` do webhook. Puro, testável. */
export function comentariosDoEntry(entry: { changes?: unknown[] } | undefined): ComentarioRecebido[] {
  const lista: ComentarioRecebido[] = [];
  for (const mudanca of (entry?.changes ?? []) as Array<Record<string, any>>) {
    if (mudanca?.field !== "comments") continue;
    const v = mudanca.value ?? {};
    if (!v.id || typeof v.text !== "string") continue;
    lista.push({
      id: String(v.id),
      texto: v.text,
      autor_id: v.from?.id ? String(v.from.id) : null,
      autor: typeof v.from?.username === "string" ? v.from.username : null,
      media_id: v.media?.id ? String(v.media.id) : null,
      parent_id: v.parent_id ? String(v.parent_id) : null,
    });
  }
  return lista;
}

// ============================================================
// A peneira — barata, sem modelo
// ============================================================

const SO_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s!.?❤️♥️]+$/u;
const SO_MARCACOES = /^(\s*@[\w.]+\s*)+$/;

/** O que fazer com um comentário: direct do agente, agradecer no post, ou nada. */
export type DestinoDoComentario = "direct" | "agradecer" | "ignorar";

/**
 * A peneira barata, sem modelo. Puro, testável.
 *
 * Só emoji: agradece com emoji (é o "curtir" que a API não dá). Só
 * marcação de amigo ("@fulano olha isso"): é conversa entre eles, não com a
 * casa — nada. Curto demais para dizer algo: nada. O resto vai ao modelo.
 */
export function peneiraBarata(texto: string): DestinoDoComentario | null {
  const limpo = texto.trim();
  if (!limpo) return "ignorar";
  if (SO_EMOJI.test(limpo)) return "agradecer";
  if (SO_MARCACOES.test(limpo)) return "ignorar";
  if (limpo.length < 3) return "ignorar";
  return null;
}

/** Compatibilidade: o que NÃO merece direct de jeito nenhum. */
export function comentarioDescartavel(texto: string): boolean {
  return peneiraBarata(texto) !== null;
}

// ============================================================
// O modelo decide o resto: direct, agradecer ou ignorar
// ============================================================

let clienteIa: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!clienteIa) clienteIa = new Anthropic({ apiKey: anthropicConfig().apiKey });
  return clienteIa;
}

export function promptDaPeneira(params: { casa: string; legenda: string | null }): string {
  return [
    `Você classifica comentários nos posts do Instagram do bar ${params.casa}.`,
    "",
    "DIRECT quando o comentário: faz uma pergunta (horário, preço, reserva, cardápio, estacionamento, evento);",
    "demonstra interesse em ir, reservar ou comprar (\"quero\", \"bora\", \"como faço\", \"tem mesa?\");",
    "reclama de algo (um direct resolve melhor que um post); ou pede contato.",
    "",
    "AGRADECER quando é elogio, carinho ou reação positiva dirigida à casa (\"lindo\", \"top\", \"saudade desse lugar\", \"melhor chope da cidade\").",
    "",
    "IGNORAR quando é marcação de amigo, piada entre amigos, spam, propaganda de outro negócio, ofensa, ou algo que não é dirigido à casa.",
    "",
    params.legenda ? `Legenda do post: """${params.legenda.slice(0, 600)}"""` : "Legenda do post: (desconhecida)",
    "",
    'Responda SÓ com uma palavra: "direct", "agradecer" ou "ignorar".',
  ].join("\n");
}

/** O destino do comentário; qualquer tropeço vira "ignorar" — spam da casa é pior que silêncio. */
export async function destinoDoComentario(params: { casa: string; legenda: string | null; texto: string }): Promise<DestinoDoComentario> {
  const barato = peneiraBarata(params.texto);
  if (barato) return barato;
  try {
    const r = await anthropic().messages.create({
      model: modeloDaTarefa("comentarios"),
      max_tokens: 5,
      system: promptDaPeneira(params),
      messages: [{ role: "user", content: `Comentário: """${params.texto.slice(0, 500)}"""` }],
    });
    const texto = r.content.map((c) => ("text" in c ? c.text : "")).join("").trim().toLowerCase();
    if (texto.startsWith("direct")) return "direct";
    if (texto.startsWith("agradecer")) return "agradecer";
    return "ignorar";
  } catch (e) {
    console.error(`[instagram] a peneira de comentários falhou: ${(e as Error).message}`);
    return "ignorar";
  }
}

/** Compatibilidade com quem só pergunta "vai para o agente?". */
export async function mereceDirect(params: { casa: string; legenda: string | null; texto: string }): Promise<boolean> {
  return (await destinoDoComentario(params)) === "direct";
}

// ============================================================
// O agradecimento público — curto, variado, com teto por dia
// ============================================================

/** Para comentário só de emoji: emoji de volta, sem modelo. */
const EMOJIS_DE_VOLTA = ["🙌", "🔥", "🍻", "❤️", "😍", "🧡"];

/** Agradecimentos públicos por casa por dia. Acima disto, parece robô — e a Meta limita. */
export const TETO_DE_AGRADECIMENTOS_POR_DIA = 60;

export function promptDoAgradecimento(casa: string): string {
  return [
    `Você responde, em público, um elogio deixado num post do Instagram do bar ${casa}.`,
    "Uma frase só, até 10 palavras, em português do Brasil, como gente da casa — nunca como atendimento.",
    "Pode usar um emoji. Não faça pergunta, não prometa nada, não convide para o direct, não repita o comentário.",
    "Varie: cada resposta diferente da anterior.",
    "Responda só com a frase.",
  ].join("\n");
}

/**
 * O texto do agradecimento. Emoji responde emoji; texto responde uma
 * frase curta do modelo. Tropeço vira o emoji — melhor "🙌" que silêncio.
 */
export async function textoDoAgradecimento(params: { casa: string; texto: string }): Promise<string> {
  const emoji = EMOJIS_DE_VOLTA[Math.floor(Math.random() * EMOJIS_DE_VOLTA.length)]!;
  if (SO_EMOJI.test(params.texto.trim())) return emoji;
  try {
    const r = await anthropic().messages.create({
      model: modeloDaTarefa("comentarios"),
      max_tokens: 40,
      system: promptDoAgradecimento(params.casa),
      messages: [{ role: "user", content: `Comentário: """${params.texto.slice(0, 300)}"""` }],
    });
    const frase = r.content.map((c) => ("text" in c ? c.text : "")).join("").trim().replace(/^["“]|["”]$/g, "");
    return frase && frase.length <= 120 ? frase : emoji;
  } catch {
    return emoji;
  }
}

// ============================================================
// O que o agente precisa saber
// ============================================================

/** O comentário numa frase para o agente. Puro, testável. */
export function contextoDoComentario(params: { autor: string | null; texto: string; legenda: string | null; casa: string }): string {
  const quem = params.autor ? `@${params.autor}` : "esta pessoa";
  return (
    `${quem} COMENTOU num post do Instagram do ${params.casa}` +
    (params.legenda ? ` cuja legenda é: """${params.legenda.slice(0, 600)}"""` : "") +
    `. O comentário foi: """${params.texto.trim()}""". ` +
    `Você está respondendo por MENSAGEM PRIVADA (direct), e esta é a primeira mensagem da conversa: ` +
    `diga em uma linha que viu o comentário no post, responda o que a pessoa perguntou ou mostrou interesse, ` +
    `e, se fizer sentido, conduza para a reserva. Se a legenda descreve uma promoção, valem as regras dela. ` +
    `Não pergunte "como posso ajudar": o comentário já diz.`
  );
}

// ============================================================
// A Meta: responder no post, responder no direct, ler a legenda
// ============================================================

const GRAPH = "https://graph.instagram.com";
const versao = () => process.env.INSTAGRAM_API_VERSION ?? "v23.0";

type RespostaDaMeta<T> = T & { error?: { code?: number; message?: string; error_subcode?: number } };

async function graph<T>(url: string, token: string, init?: RequestInit): Promise<RespostaDaMeta<T>> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const dados = (await r.json().catch(() => null)) as RespostaDaMeta<T> | null;
    return dados ?? ({ error: { message: `HTTP ${r.status} sem corpo` } } as RespostaDaMeta<T>);
  } catch (e) {
    return { error: { message: (e as Error).message } } as RespostaDaMeta<T>;
  }
}

/** A legenda do post comentado. Falha vira null, nunca erro. */
export async function legendaDoPost(conexao: Pick<ConexaoInstagram, "token">, mediaId: string | null): Promise<string | null> {
  if (!mediaId) return null;
  const r = await graph<{ caption?: string }>(`${GRAPH}/${versao()}/${mediaId}?fields=caption`, conexao.token);
  return r.error ? null : (r.caption ?? null);
}

/** Resposta pública, no próprio post, abaixo do comentário. */
export async function responderNoPost(conexao: Pick<ConexaoInstagram, "token">, commentId: string, texto: string): Promise<{ ok: boolean; erro?: string }> {
  const r = await graph<{ id?: string }>(`${GRAPH}/${versao()}/${commentId}/replies`, conexao.token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: texto }),
  });
  return r.error ? { ok: false, erro: r.error.message } : { ok: true };
}

/**
 * A resposta privada ao comentário: um direct que a Meta liga ao
 * comentário, permitido por 7 dias mesmo sem a pessoa ter escrito antes.
 */
export async function responderNoDirect(conexao: Pick<ConexaoInstagram, "token" | "ig_user_id">, commentId: string, texto: string): Promise<{ ok: boolean; erro?: string }> {
  const r = await graph<{ message_id?: string }>(`${GRAPH}/${versao()}/${conexao.ig_user_id}/messages`, conexao.token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: texto } }),
  });
  return r.error ? { ok: false, erro: r.error.message } : { ok: true };
}

// ============================================================
// A trava: cada comentário uma vez
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

/** Reserva o comentário para tratar. `false` = já foi tratado (reentrega da Meta). */
export async function reservarComentario(venueId: string, c: ComentarioRecebido): Promise<boolean> {
  const { error } = await cliente().from("instagram_comentarios").insert({
    comment_id: c.id,
    venue_id: venueId,
    autor_id: c.autor_id,
    autor: c.autor,
    texto: c.texto.slice(0, 2000),
    media_id: c.media_id,
  });
  if (!error) return true;
  if (String(error.code) === "23505") return false;
  // Banco sem a tabela ou fora do ar: melhor tratar (e arriscar repetir)
  // do que calar o canal inteiro.
  console.error(`[instagram] não reservei o comentário ${c.id}: ${error.message}`);
  return true;
}

/** Quantos agradecimentos públicos a casa já fez nas últimas 24 h. */
export async function agradecimentosRecentes(venueId: string): Promise<number> {
  const desde = new Date(Date.now() - 86_400_000).toISOString();
  const { count, error } = await cliente()
    .from("instagram_comentarios")
    .select("comment_id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .eq("acao", "agradecido")
    .gte("created_at", desde);
  if (error) return 0;
  return count ?? 0;
}

export async function anotarComentario(commentId: string, acao: string, erro?: string | null): Promise<void> {
  await cliente().from("instagram_comentarios").update({ acao, erro: erro ?? null }).eq("comment_id", commentId);
}
