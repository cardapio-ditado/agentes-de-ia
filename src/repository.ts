import { db } from "./supabase.js";
import type { Json, Tables, TablesInsert } from "./database.types.js";

export type Agent = Tables<"agents">;
export type Conversation = Tables<"conversations">;
export type Message = Tables<"messages">;

/** Carrega um agente habilitado pelo slug. */
export async function getAgentBySlug(slug: string): Promise<Agent> {
  const { data, error } = await db()
    .from("agents")
    .select("*")
    .eq("slug", slug)
    .eq("enabled", true)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar o agente "${slug}": ${error.message}`);
  if (!data) throw new Error(`Agente "${slug}" não encontrado ou desabilitado.`);
  return data;
}

/**
 * Retorna a conversa aberta do interlocutor no canal, criando uma se não existir.
 * Sem `externalId` (ex.: execução avulsa via CLI), sempre cria uma conversa nova.
 */
export async function getOrCreateConversation(params: {
  agentId: string;
  channel: string;
  externalId?: string;
  title?: string;
  venueId?: string | null;
}): Promise<Conversation> {
  const { agentId, channel, externalId, title, venueId } = params;

  if (externalId) {
    const { data, error } = await db()
      .from("conversations")
      .select("*")
      .eq("agent_id", agentId)
      .eq("channel", channel)
      .eq("external_id", externalId)
      .maybeSingle();

    if (error) throw new Error(`Falha ao buscar a conversa: ${error.message}`);
    if (data) return data;
  }

  const { data, error } = await db()
    .from("conversations")
    .insert({
      agent_id: agentId,
      channel,
      external_id: externalId ?? null,
      title: title ?? null,
      venue_id: venueId ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Falha ao criar a conversa: ${error.message}`);
  return data;
}

/** Histórico da conversa em ordem cronológica. */
export async function listMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await db()
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Falha ao carregar o histórico: ${error.message}`);
  return data ?? [];
}

export async function insertMessage(
  row: TablesInsert<"messages">,
): Promise<Message> {
  const { data, error } = await db().from("messages").insert(row).select().single();
  if (error) throw new Error(`Falha ao gravar a mensagem: ${error.message}`);
  return data;
}

export async function insertToolCall(
  row: TablesInsert<"tool_calls">,
): Promise<void> {
  const { error } = await db().from("tool_calls").insert(row);
  if (error) throw new Error(`Falha ao gravar a chamada de ferramenta: ${error.message}`);
}

/**
 * Grava um evento operacional. Nunca lança: log não pode derrubar o agente.
 */
export async function logEvent(params: {
  agentId?: string;
  conversationId?: string;
  level?: "debug" | "info" | "warn" | "error";
  event: string;
  payload?: Json;
}): Promise<void> {
  const { error } = await db().from("agent_events").insert({
    agent_id: params.agentId ?? null,
    conversation_id: params.conversationId ?? null,
    level: params.level ?? "info",
    event: params.event,
    payload: params.payload ?? {},
  });
  if (error) {
    console.error(`[agent_events] falha ao gravar "${params.event}": ${error.message}`);
  }
}
