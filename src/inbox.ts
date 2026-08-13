import { db } from "./supabase.js";
import type { Json, Tables } from "./database.types.js";

/**
 * Caixa de entrada e números do painel.
 *
 * A conversa já existia no banco desde o começo — o que faltava era enxergá-la.
 * Aqui ficam as leituras que o painel precisa e o controle de quem responde:
 * o agente ou uma pessoa.
 */

export type Conversation = Tables<"conversations">;
export type Message = Tables<"messages">;

/** Quantas conversas a lista carrega por vez. */
const LIMITE_CONVERSAS = 100;

/**
 * Quem está respondendo a conversa.
 *
 * Fica em `conversations.metadata`, que já nasceu jsonb justamente para isso.
 * Uma coluna nova exigiria migration, e o ganho não paga o custo: só existem
 * dois estados e nada consulta esse campo em massa.
 */
export interface Atendimento {
  /** `humano` silencia o agente: ele não responde mais nesta conversa. */
  por: "agente" | "humano";
  assumido_em: string | null;
  assumido_por: string | null;
}

export function atendimentoDe(conversa: Conversation): Atendimento {
  const meta = (conversa.metadata ?? {}) as Record<string, unknown>;
  const por = meta.atendimento_por === "humano" ? "humano" : "agente";
  return {
    por,
    assumido_em: typeof meta.assumido_em === "string" ? meta.assumido_em : null,
    assumido_por: typeof meta.assumido_por === "string" ? meta.assumido_por : null,
  };
}

export interface ConversaResumo {
  id: string;
  titulo: string | null;
  canal: string;
  status: string;
  contato: string | null;
  atendimento: Atendimento;
  agente: { slug: string; nome: string } | null;
  ultima_mensagem: { papel: string; texto: string | null; em: string } | null;
  mensagens: number;
  atualizada_em: string;
}

/**
 * Lista as conversas de um estabelecimento com a última mensagem de cada uma.
 *
 * São duas consultas, não N+1: uma traz as conversas, a outra traz as mensagens
 * desse lote inteiro e o agrupamento acontece aqui. Com `LIMITE_CONVERSAS`
 * conversas o segundo select continua sendo uma única ida ao banco.
 */
export async function listConversations(params: {
  venueId: string;
  canal?: string | null;
  status?: string | null;
  apenasHumanas?: boolean;
}): Promise<ConversaResumo[]> {
  let consulta = db()
    .from("conversations")
    .select("*")
    .eq("venue_id", params.venueId)
    .order("updated_at", { ascending: false })
    .limit(LIMITE_CONVERSAS);

  if (params.canal) consulta = consulta.eq("channel", params.canal);
  if (params.status) consulta = consulta.eq("status", params.status);

  const { data, error } = await consulta;
  if (error) throw new Error(`Falha ao listar conversas: ${error.message}`);

  const conversas = data ?? [];
  if (conversas.length === 0) return [];

  const ids = conversas.map((c) => c.id);

  // Os tipos gerados não descrevem as relações entre as tabelas, então o embed
  // do PostgREST (`select("*, agents(...)")`) não tipa. Buscar os agentes do
  // lote numa consulta à parte dá o mesmo resultado com uma ida a mais ao banco.
  const idsAgentes = [...new Set(conversas.map((c) => c.agent_id))];
  const { data: agentes, error: erroAgentes } = await db()
    .from("agents")
    .select("id, slug, name")
    .in("id", idsAgentes);

  if (erroAgentes) throw new Error(`Falha ao carregar os agentes: ${erroAgentes.message}`);
  const porAgente = new Map((agentes ?? []).map((a) => [a.id, a]));
  const { data: msgs, error: erroMsgs } = await db()
    .from("messages")
    .select("conversation_id, role, content, created_at")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false });

  if (erroMsgs) throw new Error(`Falha ao carregar as mensagens: ${erroMsgs.message}`);

  // Ordenado do mais novo para o mais antigo: o primeiro de cada conversa é a
  // última mensagem dela.
  const ultima = new Map<string, { papel: string; texto: string | null; em: string }>();
  const total = new Map<string, number>();
  for (const m of msgs ?? []) {
    const id = m.conversation_id;
    total.set(id, (total.get(id) ?? 0) + 1);
    if (!ultima.has(id)) {
      ultima.set(id, { papel: m.role, texto: m.content, em: m.created_at });
    }
  }

  const resumos = conversas.map((c): ConversaResumo => {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const agente = porAgente.get(c.agent_id);
    return {
      id: c.id,
      titulo: c.title,
      canal: c.channel,
      status: c.status,
      contato: typeof meta.contato === "string" ? meta.contato : c.external_id,
      atendimento: atendimentoDe(c),
      agente: agente ? { slug: agente.slug, nome: agente.name } : null,
      ultima_mensagem: ultima.get(c.id) ?? null,
      mensagens: total.get(c.id) ?? 0,
      atualizada_em: c.updated_at,
    };
  });

  if (params.apenasHumanas) {
    return resumos.filter((c) => c.atendimento.por === "humano");
  }
  return resumos;
}

/** Conversa com o histórico completo, já conferida contra a organização. */
export async function getConversationInOrg(
  conversationId: string,
  orgId: string,
): Promise<{ conversa: Conversation; mensagens: Message[] } | null> {
  const { data, error } = await db()
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar a conversa: ${error.message}`);
  if (!data) return null;
  if (!data.venue_id) return null;

  const { data: venue, error: erroVenue } = await db()
    .from("venues")
    .select("org_id")
    .eq("id", data.venue_id)
    .maybeSingle();

  if (erroVenue) throw new Error(`Falha ao conferir o estabelecimento: ${erroVenue.message}`);
  // Mesma resposta para "não existe" e "é de outra organização".
  if (!venue || venue.org_id !== orgId) return null;

  const { data: mensagens, error: erroMsgs } = await db()
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (erroMsgs) throw new Error(`Falha ao carregar o histórico: ${erroMsgs.message}`);
  return { conversa: data as Conversation, mensagens: mensagens ?? [] };
}

/**
 * Assume ou devolve o atendimento.
 *
 * Enquanto estiver com uma pessoa, o agente não responde — quem checa isso é
 * `agenteDeveResponder()`, chamado pelo conector antes de acionar o modelo.
 */
export async function definirAtendimento(params: {
  conversationId: string;
  por: "agente" | "humano";
  quem?: string | null;
}): Promise<Conversation> {
  const { data: atual, error: erroLeitura } = await db()
    .from("conversations")
    .select("metadata")
    .eq("id", params.conversationId)
    .maybeSingle();

  if (erroLeitura) throw new Error(`Falha ao ler a conversa: ${erroLeitura.message}`);
  if (!atual) throw new Error("Conversa não encontrada.");

  const meta: Record<string, Json> = { ...((atual.metadata ?? {}) as Record<string, Json>) };
  if (params.por === "humano") {
    meta.atendimento_por = "humano";
    meta.assumido_em = new Date().toISOString();
    meta.assumido_por = params.quem ?? "painel";
  } else {
    meta.atendimento_por = "agente";
    meta.assumido_em = null;
    meta.assumido_por = null;
  }

  const { data, error } = await db()
    .from("conversations")
    .update({ metadata: meta })
    .eq("id", params.conversationId)
    .select()
    .single();

  if (error) throw new Error(`Falha ao mudar o atendimento: ${error.message}`);
  return data;
}

/**
 * Encerra ou reabre a conversa.
 *
 * Encerrar significa "atendimento resolvido": a conversa sai da lista de
 * abertas e o atendimento volta para o agente — quem encerrou não pode
 * continuar dono de uma conversa que acabou. Se o cliente escrever de novo,
 * `getOrCreateConversation` reabre sozinha.
 */
export async function definirStatusConversa(params: {
  conversationId: string;
  status: "open" | "closed";
}): Promise<Conversation> {
  const mudancas: { status: string; metadata?: Json } = { status: params.status };

  if (params.status === "closed") {
    const { data: atual } = await db()
      .from("conversations")
      .select("metadata")
      .eq("id", params.conversationId)
      .maybeSingle();
    const meta = { ...((atual?.metadata ?? {}) as Record<string, Json>) };
    meta.atendimento_por = "agente";
    meta.assumido_em = null;
    meta.assumido_por = null;
    mudancas.metadata = meta;
  }

  const { data, error } = await db()
    .from("conversations")
    .update(mudancas)
    .eq("id", params.conversationId)
    .select()
    .single();

  if (error) throw new Error(`Falha ao mudar o status da conversa: ${error.message}`);
  return data;
}

/**
 * Conta se o agente deve responder nesta conversa.
 *
 * O conector do WhatsApp chama isto antes de acionar o modelo: uma pessoa que
 * assumiu o atendimento não pode ser atropelada pelo agente no meio da conversa.
 */
export async function agenteDeveResponder(conversationId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();

  // Na dúvida o agente responde: ficar mudo é pior do que responder demais.
  if (error || !data) return true;
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  return meta.atendimento_por !== "humano";
}

/**
 * Grava uma resposta escrita por uma pessoa.
 *
 * Fica em `messages` como `assistant` — para o cliente, e para o histórico que
 * o modelo lê depois, é a mesma voz do estabelecimento. O `blocks` marca a
 * origem para o painel conseguir diferenciar na tela.
 */
export async function registrarMensagemHumana(params: {
  conversationId: string;
  texto: string;
  autor?: string | null;
}): Promise<Message> {
  const { data, error } = await db()
    .from("messages")
    .insert({
      conversation_id: params.conversationId,
      role: "assistant",
      content: params.texto,
      blocks: { origem: "humano", autor: params.autor ?? "painel" },
    })
    .select()
    .single();

  if (error) throw new Error(`Falha ao gravar a mensagem: ${error.message}`);

  // `updated_at` ordena a caixa de entrada; sem isto a conversa não sobe.
  await db()
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", params.conversationId);

  return data;
}

// ============================================================
// Números do painel
// ============================================================

export interface Metricas {
  conversas: { total: number; abertas: number; com_humano: number };
  reservas: { pendentes: number; aprovadas_7d: number; recusadas_7d: number };
  mensagens: { total_7d: number; do_agente_7d: number };
  tokens_7d: { entrada: number; saida: number; cache_lido: number };
  eventos_proximos: number;
  notificacoes_falhas: number;
  serie_7d: Array<{ dia: string; mensagens: number }>;
}

/**
 * Extrai o total de uma consulta com `head: true`.
 *
 * `count: "exact"` + `head: true` pede ao Postgres só o número, sem trazer
 * linha nenhuma — o painel precisa do total, não dos registros.
 */
async function total(
  consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  ondeFalhou: string,
): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(`Falha ao contar ${ondeFalhou}: ${error.message}`);
  return count ?? 0;
}

export async function metricasDoVenue(venueId: string): Promise<Metricas> {
  const agora = new Date();
  const seteDias = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const contagem = { count: "exact", head: true } as const;

  const [conversas, conversasAbertas, pendentes, aprovadas, recusadas, eventos, falhas] =
    await Promise.all([
      total(
        db().from("conversations").select("*", contagem).eq("venue_id", venueId),
        "conversas",
      ),
      total(
        db()
          .from("conversations")
          .select("*", contagem)
          .eq("venue_id", venueId)
          .eq("status", "open"),
        "conversas abertas",
      ),
      total(
        db()
          .from("reservations")
          .select("*", contagem)
          .eq("venue_id", venueId)
          .eq("status", "pending"),
        "reservas pendentes",
      ),
      total(
        db()
          .from("reservations")
          .select("*", contagem)
          .eq("venue_id", venueId)
          .eq("status", "approved")
          .gte("reviewed_at", seteDias),
        "reservas aprovadas",
      ),
      total(
        db()
          .from("reservations")
          .select("*", contagem)
          .eq("venue_id", venueId)
          .eq("status", "rejected")
          .gte("reviewed_at", seteDias),
        "reservas recusadas",
      ),
      total(
        db()
          .from("venue_events")
          .select("*", contagem)
          .eq("venue_id", venueId)
          .gte("starts_at", agora.toISOString()),
        "eventos futuros",
      ),
      total(
        db()
          .from("notifications")
          .select("*", contagem)
          .eq("venue_id", venueId)
          .eq("status", "failed"),
        "notificações falhas",
      ),
    ]);

  // As mensagens não têm venue_id: chega-se a elas pelas conversas do local.
  const { data: idsConversas, error: erroIds } = await db()
    .from("conversations")
    .select("id, metadata")
    .eq("venue_id", venueId);

  if (erroIds) throw new Error(`Falha ao listar conversas: ${erroIds.message}`);

  const ids = (idsConversas ?? []).map((c) => c.id);
  const comHumano = (idsConversas ?? []).filter(
    (c) => ((c.metadata ?? {}) as Record<string, unknown>).atendimento_por === "humano",
  ).length;

  let totalMsgs = 0;
  let doAgente = 0;
  const tokens = { entrada: 0, saida: 0, cache_lido: 0 };
  const porDia = new Map<string, number>();

  if (ids.length > 0) {
    const { data: msgs, error: erroMsgs } = await db()
      .from("messages")
      .select("role, created_at, input_tokens, output_tokens, cache_read_tokens")
      .in("conversation_id", ids)
      .gte("created_at", seteDias);

    if (erroMsgs) throw new Error(`Falha ao somar mensagens: ${erroMsgs.message}`);

    for (const m of msgs ?? []) {
      totalMsgs += 1;
      if (m.role === "assistant") doAgente += 1;
      tokens.entrada += m.input_tokens ?? 0;
      tokens.saida += m.output_tokens ?? 0;
      tokens.cache_lido += m.cache_read_tokens ?? 0;
      const dia = m.created_at.slice(0, 10);
      porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
    }
  }

  // Sete dias sempre presentes, mesmo os vazios: um gráfico com buracos mente
  // sobre o movimento.
  const serie: Array<{ dia: string; mensagens: number }> = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(agora.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    serie.push({ dia: d, mensagens: porDia.get(d) ?? 0 });
  }

  return {
    conversas: { total: conversas, abertas: conversasAbertas, com_humano: comHumano },
    reservas: { pendentes, aprovadas_7d: aprovadas, recusadas_7d: recusadas },
    mensagens: { total_7d: totalMsgs, do_agente_7d: doAgente },
    tokens_7d: tokens,
    eventos_proximos: eventos,
    notificacoes_falhas: falhas,
    serie_7d: serie,
  };
}
