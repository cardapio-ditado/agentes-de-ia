import { db } from "./supabase.js";
import { FERRAMENTAS_PADRAO } from "./tools/index.js";
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

/** Agentes habilitados de uma organização — o escopo da chave de API. */
export async function listAgentsInOrg(orgId: string): Promise<Agent[]> {
  const { data, error } = await db()
    .from("agents")
    .select("*")
    .eq("org_id", orgId)
    .eq("enabled", true)
    .order("name", { ascending: true });

  if (error) throw new Error(`Falha ao listar agentes: ${error.message}`);
  return data ?? [];
}

/** Todos os agentes da organização, inclusive os desligados — para o painel. */
export async function listAllAgentsInOrg(orgId: string): Promise<Agent[]> {
  const { data, error } = await db()
    .from("agents")
    .select("*")
    .eq("org_id", orgId)
    .order("name", { ascending: true });

  if (error) throw new Error(`Falha ao listar agentes: ${error.message}`);
  return data ?? [];
}

/** Um agente da organização, ligado ou não. Null quando não é dela. */
export async function getAgentInOrg(orgId: string, slug: string): Promise<Agent | null> {
  const { data, error } = await db()
    .from("agents")
    .select("*")
    .eq("org_id", orgId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar o agente "${slug}": ${error.message}`);
  return data;
}

const SLUG_VALIDO = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const MODELOS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"];
const ESFORCOS = ["low", "medium", "high", "xhigh", "max"];

export interface DadosAgente {
  slug?: string;
  name?: string;
  description?: string | null;
  system_prompt?: string;
  model?: string;
  effort?: string;
  max_tokens?: number;
  enabled?: boolean;
}

/** Valida o que veio do painel. Lança com mensagem legível para a tela. */
function validarAgente(dados: DadosAgente, criando: boolean): void {
  if (criando || dados.slug !== undefined) {
    if (!dados.slug || !SLUG_VALIDO.test(dados.slug)) {
      throw new Error(
        'O identificador precisa ter de 3 a 64 caracteres, só letras minúsculas, números e hífens (ex.: "recepcionista").',
      );
    }
  }
  if (criando && !dados.name?.trim()) throw new Error("O agente precisa de um nome.");
  if (dados.model !== undefined && !MODELOS.includes(dados.model)) {
    throw new Error(`Modelo inválido. Opções: ${MODELOS.join(", ")}.`);
  }
  if (dados.effort !== undefined && !ESFORCOS.includes(dados.effort)) {
    throw new Error(`Esforço inválido. Opções: ${ESFORCOS.join(", ")}.`);
  }
  if (
    dados.max_tokens !== undefined &&
    (!Number.isInteger(dados.max_tokens) || dados.max_tokens < 256 || dados.max_tokens > 64000)
  ) {
    throw new Error("max_tokens precisa ser um inteiro entre 256 e 64000.");
  }
}

export async function createAgent(orgId: string, dados: DadosAgente): Promise<Agent> {
  validarAgente(dados, true);

  const { data, error } = await db()
    .from("agents")
    .insert({
      org_id: orgId,
      slug: dados.slug!,
      name: dados.name!.trim(),
      description: dados.description?.trim() || null,
      system_prompt: dados.system_prompt ?? "",
      model: dados.model ?? "claude-opus-5",
      effort: dados.effort ?? "high",
      max_tokens: dados.max_tokens ?? 16000,
      enabled: dados.enabled ?? true,
      // Ferramentas explícitas no banco: quem ler o registro vê o que o
      // agente pode fazer, sem depender do padrão implícito do código.
      config: { tools: FERRAMENTAS_PADRAO },
    })
    .select()
    .single();

  if (error) {
    // 23505 é violação de unique — o slug é único no sistema inteiro.
    if (error.code === "23505") {
      throw new Error(`Já existe um agente com o identificador "${dados.slug}".`);
    }
    throw new Error(`Falha ao criar o agente: ${error.message}`);
  }
  return data;
}

export async function updateAgent(
  orgId: string,
  slug: string,
  dados: DadosAgente,
): Promise<Agent> {
  validarAgente(dados, false);

  const mudancas: Partial<TablesInsert<"agents">> = {};
  if (dados.name !== undefined) mudancas.name = dados.name.trim();
  if (dados.description !== undefined) mudancas.description = dados.description?.trim() || null;
  if (dados.system_prompt !== undefined) mudancas.system_prompt = dados.system_prompt;
  if (dados.model !== undefined) mudancas.model = dados.model;
  if (dados.effort !== undefined) mudancas.effort = dados.effort;
  if (dados.max_tokens !== undefined) mudancas.max_tokens = dados.max_tokens;
  if (dados.enabled !== undefined) mudancas.enabled = dados.enabled;
  if (Object.keys(mudancas).length === 0) throw new Error("Nada para atualizar.");

  const { data, error } = await db()
    .from("agents")
    .update(mudancas)
    .eq("org_id", orgId)
    .eq("slug", slug)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Falha ao atualizar o agente: ${error.message}`);
  if (!data) throw new Error(`Agente "${slug}" não encontrado nesta organização.`);
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
    if (data) {
      // Cliente escreveu numa conversa encerrada: reabre — para ele a conversa
      // nunca deixou de existir.
      if (data.status === "closed") {
        const { data: reaberta, error: erroReabrir } = await db()
          .from("conversations")
          .update({ status: "open" })
          .eq("id", data.id)
          .select()
          .single();
        if (erroReabrir) throw new Error(`Falha ao reabrir a conversa: ${erroReabrir.message}`);
        return reaberta;
      }
      return data;
    }
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
