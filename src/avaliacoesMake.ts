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
  /** A resposta que está no Google, como está lá. */
  resposta_google: string | null;
  respondida_em: string | null;
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
  const respostaGoogle = resposta && typeof resposta.comment === "string" && resposta.comment.trim() ? resposta.comment.trim() : null;
  return {
    name,
    autor: autor?.trim() || null,
    nota,
    comentario: limparComentario(corpo.comment),
    avaliada_em: typeof corpo.createTime === "string" ? corpo.createTime : null,
    ja_respondida: respostaGoogle !== null,
    resposta_google: respostaGoogle,
    respondida_em: respostaGoogle && typeof resposta?.updateTime === "string" && resposta.updateTime.trim() ? resposta.updateTime.trim() : null,
  };
}

/**
 * O Google manda o comentário traduzido quando a conta que leu está em
 * outro idioma: "(Translated by Google) ...\n\n(Original)\n...". O painel
 * mostra o que a pessoa escreveu, não a tradução.
 */
export function limparComentario(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  if (!texto) return null;
  const original = texto.match(/\(Original\)\s*([\s\S]+)$/);
  if (original?.[1]?.trim()) return original[1].trim();
  return texto.replace(/^\(Translated by Google\)\s*/i, "").trim() || null;
}

/** Uma página da lista de avaliações do Google, como a API devolve. */
export interface PaginaDoGoogle {
  avaliacoes: AvaliacaoDoMake[];
  nota_media: number | null;
  total: number | null;
  proxima_pagina: string | null;
}

export function lerPaginaDoGoogle(corpo: Record<string, unknown>): PaginaDoGoogle {
  const lista = Array.isArray(corpo.reviews) ? corpo.reviews : [];
  const avaliacoes: AvaliacaoDoMake[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    try {
      avaliacoes.push(lerAvaliacaoDoMake(item as Record<string, unknown>));
    } catch {
      // Uma avaliação malformada não derruba a página inteira.
    }
  }
  const media = Number(corpo.averageRating);
  const total = Number(corpo.totalReviewCount);
  return {
    avaliacoes,
    nota_media: Number.isFinite(media) && media > 0 ? Math.round(media * 100) / 100 : null,
    total: Number.isInteger(total) && total >= 0 ? total : null,
    proxima_pagina: typeof corpo.nextPageToken === "string" && corpo.nextPageToken.trim() ? corpo.nextPageToken.trim() : null,
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
  perfil: GooglePerfil,
  entrada: AvaliacaoDoMake,
): Promise<RespostaAoMake> {
  const [nova] = await registrarAvaliacoes(venue.id, [
    { avaliacao_id: entrada.name, autor: entrada.autor, nota: entrada.nota, comentario: entrada.comentario, avaliada_em: entrada.avaliada_em },
  ]);
  await marcarConectado(perfil.id, entrada.name);

  if (!nova) {
    // Já conhecida: o que vale é o estado dela no painel.
    const atual = await avaliacaoPeloNome(venue.id, entrada.name);
    // Alguém respondeu direto no Google enquanto ela esperava aqui: o Google
    // é quem manda, e o painel passa a mostrar o que está lá.
    if (atual && entrada.resposta_google && atual.resposta_status !== "publicada") {
      await marcarPublicada(atual.id, { resposta: entrada.resposta_google, em: entrada.respondida_em });
      return { responder: false, texto: null, name: entrada.name, situacao: "ja_respondida_no_google" };
    }
    if (atual?.resposta_status === "aprovada" && atual.resposta) {
      return { responder: true, texto: atual.resposta, name: entrada.name, situacao: "aprovada_pendente" };
    }
    return { responder: false, texto: null, name: entrada.name, situacao: "ja_tratada" };
  }

  // Alguém já respondeu direto no Google: não escreve por cima.
  if (entrada.resposta_google) {
    await marcarPublicada(nova.id, { resposta: entrada.resposta_google, em: entrada.respondida_em });
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

// ============================================================
// O histórico inteiro, como está no Google
// ============================================================

/** Quantas páginas de 50 o Make busca, no máximo, numa importação. */
export const MAXIMO_DE_PAGINAS = 80;

export interface ResultadoDaPagina {
  recebidas: number;
  novas: number;
  /** Já conhecidas que ganharam a resposta que está no Google. */
  atualizadas: number;
  proxima_pagina: string | null;
  concluida: boolean;
}

/**
 * Uma página do histórico chegou pelo Make. Cada avaliação entra como está
 * no Google: respondida (com o texto de lá) ou sem resposta. Nada é redigido
 * aqui — responder sozinho uma avaliação de meses atrás surpreenderia o dono;
 * ele manda redigir pelo painel, uma a uma, se quiser.
 */
export async function receberPaginaDoGoogle(
  venueId: string,
  perfil: Pick<GooglePerfil, "id">,
  pagina: PaginaDoGoogle,
): Promise<ResultadoDaPagina> {
  const resultado = await gravarComoNoGoogle(venueId, pagina.avaliacoes);
  const primeira = pagina.avaliacoes[0];
  const agora = new Date().toISOString();
  const { error } = await db()
    .from("google_perfis")
    .update({
      status: "conectado",
      ultimo_erro: null,
      ultima_sincronizacao: agora,
      ...(primeira ? { local_nome: primeira.name.replace(/\/reviews\/[^/]+$/, "") } : {}),
      ...(pagina.nota_media !== null ? { nota_media: pagina.nota_media } : {}),
      ...(pagina.total !== null ? { total_avaliacoes: pagina.total } : {}),
      ...(pagina.proxima_pagina ? {} : { importado_em: agora }),
      updated_at: agora,
    })
    .eq("id", perfil.id);
  if (error) throw new ErroDoMake(500, `Falha ao anotar a importação no perfil: ${error.message}`);

  return { ...resultado, recebidas: pagina.avaliacoes.length, proxima_pagina: pagina.proxima_pagina, concluida: !pagina.proxima_pagina };
}

async function gravarComoNoGoogle(venueId: string, entradas: AvaliacaoDoMake[]): Promise<{ novas: number; atualizadas: number }> {
  if (entradas.length === 0) return { novas: 0, atualizadas: 0 };

  const { data: existentes, error } = await db()
    .from("google_avaliacoes")
    .select("id, avaliacao_id, resposta_status")
    .eq("venue_id", venueId)
    .in("avaliacao_id", entradas.map((e) => e.name));
  if (error) throw new ErroDoMake(500, `Falha ao conferir as avaliações já gravadas: ${error.message}`);
  const conhecidas = new Map((existentes ?? []).map((e) => [e.avaliacao_id, e]));

  const novas = entradas.filter((e) => !conhecidas.has(e.name));
  if (novas.length > 0) {
    const { error: erroInsert } = await db().from("google_avaliacoes").insert(
      novas.map((e) => ({
        venue_id: venueId,
        avaliacao_id: e.name,
        autor: e.autor,
        nota: e.nota,
        comentario: e.comentario,
        avaliada_em: e.avaliada_em,
        resposta: e.resposta_google,
        resposta_status: e.resposta_google ? "publicada" : "sem_resposta",
        publicada_em: e.resposta_google ? e.respondida_em ?? e.avaliada_em : null,
      })),
    );
    if (erroInsert) throw new ErroDoMake(500, `Falha ao gravar o histórico: ${erroInsert.message}`);
  }

  // Já conhecida e sem resposta aqui, mas respondida no Google: o Google manda.
  let atualizadas = 0;
  for (const e of entradas) {
    const atual = conhecidas.get(e.name);
    if (!atual || !e.resposta_google || atual.resposta_status === "publicada") continue;
    await marcarPublicada(atual.id, { resposta: e.resposta_google, em: e.respondida_em });
    atualizadas += 1;
  }
  return { novas: novas.length, atualizadas };
}

/**
 * Pede ao Make uma página do histórico. O cenário busca no Google e devolve
 * a página em POST /importar; se houver próxima, o servidor pede de novo —
 * é assim que o laço anda sem o Make precisar saber contar.
 */
export async function pedirPaginaAoMake(
  venueId: string,
  pageToken: string | null,
  numero: number,
): Promise<{ pedido: boolean; motivo?: string }> {
  if (numero > MAXIMO_DE_PAGINAS) return { pedido: false, motivo: `parou na página ${MAXIMO_DE_PAGINAS}` };
  const perfil = await perfilDoVenue(venueId);
  if (!perfil?.make_webhook_url) return { pedido: false, motivo: "a casa não tem o webhook do Make" };
  if (!perfil.local_nome) return { pedido: false, motivo: "a casa ainda não tem o local do Google (accounts/…/locations/…)" };
  try {
    const r = await fetch(perfil.make_webhook_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        acao: "importar",
        venue: venueId,
        local: perfil.local_nome,
        pageToken: pageToken ?? "",
        pagina: numero,
        segredo: perfil.webhook_segredo ?? "",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return { pedido: false, motivo: `o Make respondeu ${r.status}` };
    return { pedido: true };
  } catch (e) {
    return { pedido: false, motivo: (e as Error).message };
  }
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
  const perfil = await perfilDoVenue(venueId);
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
  const perfil = await perfilDoVenue(venueId);
  if (!perfil) throw new ErroDoMake(400, "Salve o perfil do Google (regras) antes de ligar ao Make.");
  const segredo = perfil.webhook_segredo || randomBytes(24).toString("base64url");
  const { error } = await db()
    .from("google_perfis")
    .update({ webhook_segredo: segredo, make_webhook_url: makeWebhookUrl, updated_at: new Date().toISOString() })
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
    .update({ status: "conectado", ultimo_erro: null, ultima_sincronizacao: new Date().toISOString(), local_nome: localNome, updated_at: new Date().toISOString() })
    .eq("id", perfilId);
}
