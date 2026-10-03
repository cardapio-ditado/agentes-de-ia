import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  lerConfiguracao,
  marcarPublicada,
  perfilDoVenue,
  prepararResposta,
  registrarAvaliacoes,
  type Avaliacao,
  type GooglePerfil,
} from "./avaliacoes.js";
import { db } from "./supabase.js";

/**
 * AVALIAÇÕES DO GOOGLE PELA API OFICIAL, VIA MAKE.
 *
 * O Make tem o acesso à API do Perfil da Empresa já aprovado pelo Google.
 * O dono faz login com a conta que gerencia o perfil, e pronto — sem
 * projeto no Cloud, sem o pedido de acesso que a Google segura por semanas,
 * sem navegador automatizado. O cenário do Make só carrega e descarrega:
 *
 *   Google → Make (Watch Reviews) → POST aqui → o Brasa Food grava, escreve
 *   a resposta e aplica a regra de nota → volta {responder, texto} → o Make
 *   publica (Create/Update a Review Reply) → POST aqui "publicada".
 *
 *   Painel (aprovou uma resposta) → POST no webhook do Make → o Make
 *   publica → POST aqui "publicada".
 *
 * Quem escreve continua sendo o Brasa Food, com o tom, a assinatura e a
 * regra que já estão no painel. O Make nunca vê o modelo nem o prompt.
 */

/** Como a API do Google escreve a nota. */
const ESTRELAS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export function notaDaEstrela(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isInteger(valor) && valor >= 1 && valor <= 5) return valor;
  if (typeof valor === "string") {
    const n = ESTRELAS[valor.trim().toUpperCase()];
    if (n) return n;
    const numero = Number(valor);
    if (Number.isInteger(numero) && numero >= 1 && numero <= 5) return numero;
  }
  return null;
}

export class ErroDoMake extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDoMake";
  }
}

type PerfilComMake = GooglePerfil & { webhook_segredo?: string | null; make_webhook_url?: string | null; local_nome?: string | null };

/** O segredo que o Make manda no cabeçalho bate com o da casa? Em tempo constante. */
export function segredoConfere(enviado: string | string[] | undefined, esperado: string | null | undefined): boolean {
  const a = Buffer.from(Array.isArray(enviado) ? enviado[0] ?? "" : enviado ?? "");
  const b = Buffer.from(esperado ?? "");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/** O payload que o cenário do Make manda, já saneado. Puro, testável. */
export interface AvaliacaoDoMake {
  /** "accounts/*\/locations/*\/reviews/*" — é com isto que o Make publica a resposta. */
  name: string;
  autor: string | null;
  nota: number;
  comentario: string | null;
  avaliada_em: string | null;
  /** O Google já tem uma resposta nesta avaliação (publicada por alguém). */
  ja_respondida: boolean;
}

export function lerAvaliacaoDoMake(corpo: Record<string, unknown>): AvaliacaoDoMake {
  const name = typeof corpo.name === "string" ? corpo.name.trim() : "";
  if (!/^accounts\/[^/]+\/locations\/[^/]+\/reviews\/[^/]+$/.test(name)) {
    throw new ErroDoMake(400, 'Faltou o "name" da avaliação (accounts/*/locations/*/reviews/*).');
  }
  const nota = notaDaEstrela(corpo.starRating ?? corpo.nota);
  if (!nota) throw new ErroDoMake(400, "Faltou a nota (starRating) da avaliação.");
  const reviewer = (corpo.reviewer ?? {}) as Record<string, unknown>;
  const autor = typeof corpo.autor === "string" ? corpo.autor : typeof reviewer.displayName === "string" ? reviewer.displayName : null;
  const resposta = (corpo.reviewReply ?? null) as Record<string, unknown> | null;
  return {
    name,
    autor: autor?.trim() || null,
    nota,
    comentario: typeof corpo.comment === "string" && corpo.comment.trim() ? corpo.comment.trim() : null,
    avaliada_em: typeof corpo.createTime === "string" ? corpo.createTime : null,
    ja_respondida: Boolean(resposta && typeof resposta.comment === "string" && resposta.comment.trim()),
  };
}

export interface RespostaAoMake {
  /** O Make publica agora? Só quando a regra liberou sozinha. */
  responder: boolean;
  texto: string | null;
  name: string;
  /** Para o log do Make: o que aconteceu. */
  situacao: "nova_automatica" | "nova_para_aprovacao" | "ja_respondida_no_google" | "ja_tratada" | "aprovada_pendente" | "erro";
}

/**
 * Uma avaliação chegou pelo Make. Grava, escreve, aplica a regra, responde.
 *
 * Idempotente: o Make reentrega a mesma avaliação quando ela é editada ou
 * quando o cenário roda de novo "desde o começo". A segunda vez não gera
 * texto novo nem publica por cima do que uma pessoa aprovou — devolve o que
 * já está decidido.
 */
export async function receberAvaliacaoDoMake(
  venue: { id: string; name: string },
  perfil: PerfilComMake,
  entrada: AvaliacaoDoMake,
): Promise<RespostaAoMake> {
  const [nova] = await registrarAvaliacoes(venue.id, [
    { avaliacao_id: entrada.name, autor: entrada.autor, nota: entrada.nota, comentario: entrada.comentario, avaliada_em: entrada.avaliada_em },
  ]);
  await marcarConectado(perfil.id, entrada.name);

  if (!nova) {
    // Já conhecida: o que vale é o estado dela no painel.
    const atual = await avaliacaoPeloNome(venue.id, entrada.name);
    if (atual?.resposta_status === "aprovada" && atual.resposta) {
      return { responder: true, texto: atual.resposta, name: entrada.name, situacao: "aprovada_pendente" };
    }
    return { responder: false, texto: null, name: entrada.name, situacao: "ja_tratada" };
  }

  // Alguém já respondeu direto no Google: não escreve por cima.
  if (entrada.ja_respondida) {
    await marcarPublicada(nova.id);
    return { responder: false, texto: null, name: entrada.name, situacao: "ja_respondida_no_google" };
  }

  const pronta = await prepararResposta({ avaliacao: nova, venue, config: lerConfiguracao(perfil) });
  if (pronta.resposta_status === "aprovada" && pronta.resposta) {
    return { responder: true, texto: pronta.resposta, name: entrada.name, situacao: "nova_automatica" };
  }
  if (pronta.resposta_status === "erro") {
    return { responder: false, texto: null, name: entrada.name, situacao: "erro" };
  }
  return { responder: false, texto: null, name: entrada.name, situacao: "nova_para_aprovacao" };
}

/** O Make publicou: a avaliação sai da lista de prontas. */
export async function confirmarPublicadaPeloMake(venueId: string, name: string): Promise<Avaliacao | null> {
  const atual = await avaliacaoPeloNome(venueId, name);
  if (!atual) return null;
  if (atual.resposta_status === "publicada") return atual;
  return await marcarPublicada(atual.id);
}

/**
 * Uma pessoa aprovou no painel: manda para o webhook do Make publicar.
 *
 * Nunca lança — a aprovação já está gravada, e se o Make estiver fora do
 * ar a resposta fica "aprovada" esperando; o cenário de leitura devolve
 * `aprovada_pendente` na próxima passada e publica.
 */
export async function publicarPeloMake(venueId: string, avaliacao: Avaliacao): Promise<{ enviado: boolean; motivo?: string }> {
  const perfil = (await perfilDoVenue(venueId)) as PerfilComMake | null;
  if (!perfil?.make_webhook_url) return { enviado: false, motivo: "a casa não tem o webhook do Make" };
  if (!avaliacao.resposta || !/^accounts\//.test(avaliacao.avaliacao_id)) {
    return { enviado: false, motivo: "avaliação sem resposta ou sem nome do Google" };
  }
  try {
    const r = await fetch(perfil.make_webhook_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ venue: venueId, name: avaliacao.avaliacao_id, texto: avaliacao.resposta, segredo: perfil.webhook_segredo ?? "" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return { enviado: false, motivo: `o Make respondeu ${r.status}` };
    return { enviado: true };
  } catch (e) {
    return { enviado: false, motivo: (e as Error).message };
  }
}

/** Liga a casa ao Make: gera o segredo (uma vez) e guarda o webhook. */
export async function ligarAoMake(venueId: string, makeWebhookUrl: string | null): Promise<{ segredo: string }> {
  const perfil = (await perfilDoVenue(venueId)) as PerfilComMake | null;
  if (!perfil) throw new ErroDoMake(400, "Salve o perfil do Google (regras) antes de ligar ao Make.");
  const segredo = perfil.webhook_segredo || randomBytes(24).toString("base64url");
  const { error } = await db()
    .from("google_perfis")
    .update({ webhook_segredo: segredo, make_webhook_url: makeWebhookUrl, updated_at: new Date().toISOString() } as never)
    .eq("id", perfil.id);
  if (error) throw new ErroDoMake(500, `Falha ao ligar ao Make: ${error.message}`);
  return { segredo };
}

async function avaliacaoPeloNome(venueId: string, name: string): Promise<Avaliacao | null> {
  const { data } = await db().from("google_avaliacoes").select("*").eq("venue_id", venueId).eq("avaliacao_id", name).maybeSingle();
  return (data as Avaliacao | null) ?? null;
}

async function marcarConectado(perfilId: string, reviewName: string): Promise<void> {
  const localNome = reviewName.replace(/\/reviews\/[^/]+$/, "");
  await db()
    .from("google_perfis")
    .update({ status: "conectado", ultimo_erro: null, ultima_sincronizacao: new Date().toISOString(), local_nome: localNome, updated_at: new Date().toISOString() } as never)
    .eq("id", perfilId);
}
