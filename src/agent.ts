import Anthropic from "@anthropic-ai/sdk";
import { anthropicConfig } from "./config.js";
import {
  getAgentBySlug,
  getOrCreateConversation,
  insertMessage,
  insertToolCall,
  listMessages,
  logEvent,
  type Agent,
  type Message,
} from "./repository.js";
import { resolveTools, type AgentTool, type ToolContext } from "./tools/index.js";
import { findVenueBySlug } from "./venues.js";
import type { Json } from "./database.types.js";

/** Trava de segurança: impede loop infinito de chamadas de ferramenta. */
const MAX_ITERACOES = 12;

let cachedClient: Anthropic | undefined;

function anthropic(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: anthropicConfig().apiKey });
  }
  return cachedClient;
}

export interface RunAgentParams {
  /** Slug do agente na tabela `agents`. */
  agentSlug: string;
  /** Texto enviado pelo usuário. */
  userMessage: string;
  /** Canal de origem: api, web, whatsapp... Padrão: "api". */
  channel?: string;
  /** Identificador do interlocutor no canal — o que dá continuidade à conversa. */
  externalId?: string;
  /** Slug do estabelecimento atendido. Necessário para as ferramentas de restaurante. */
  venueSlug?: string;
}

export interface RunAgentResult {
  conversationId: string;
  text: string;
  stopReason: string | null;
}

/**
 * Executa um turno completo do agente: carrega histórico, chama o modelo,
 * executa as ferramentas que ele pedir e persiste tudo.
 */
export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const { agentSlug, userMessage, channel = "api", externalId, venueSlug } = params;

  const agent = await getAgentBySlug(agentSlug);
  const venue = venueSlug ? await findVenueBySlug(venueSlug) : null;
  const conversation = await getOrCreateConversation({
    agentId: agent.id,
    channel,
    externalId,
    venueId: venue?.id ?? null,
  });

  const toolContext: ToolContext = {
    agentId: agent.id,
    conversationId: conversation.id,
    venueId: conversation.venue_id ?? venue?.id ?? null,
    channel,
  };

  const historico = await listMessages(conversation.id);
  const messages: Anthropic.MessageParam[] = historico.map(toMessageParam);

  messages.push({ role: "user", content: userMessage });
  await insertMessage({
    conversation_id: conversation.id,
    role: "user",
    content: userMessage,
  });

  const tools = resolveTools(readToolNames(agent));
  let stopReason: string | null = null;
  let textoFinal = "";

  for (let iteracao = 0; iteracao < MAX_ITERACOES; iteracao++) {
    const inicio = Date.now();
    const response = await anthropic().messages.create(
      buildRequest(agent, messages, tools),
    );
    const latencia = Date.now() - inicio;
    stopReason = response.stop_reason;

    const assistantMessage = await insertMessage({
      conversation_id: conversation.id,
      role: "assistant",
      content: extractText(response.content) || null,
      blocks: response.content as unknown as Json,
      model: response.model,
      stop_reason: response.stop_reason,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? null,
      cache_creation_tokens: response.usage.cache_creation_input_tokens ?? null,
      latency_ms: latencia,
    });

    // Sempre devolve os blocos completos ao modelo — thinking e tool_use inclusos.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      await logEvent({
        agentId: agent.id,
        conversationId: conversation.id,
        level: "warn",
        event: "modelo_recusou",
        payload: { stop_reason: response.stop_reason },
      });
      return {
        conversationId: conversation.id,
        text: "O modelo recusou esta solicitação por política de uso.",
        stopReason,
      };
    }

    // Ferramenta do lado do servidor atingiu o limite de iterações: reenviar retoma.
    if (response.stop_reason === "pause_turn") continue;

    const toolUses = response.content.filter(
      (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use",
    );

    if (toolUses.length === 0) {
      textoFinal = extractText(response.content);
      if (response.stop_reason === "max_tokens") {
        await logEvent({
          agentId: agent.id,
          conversationId: conversation.id,
          level: "warn",
          event: "resposta_truncada",
          payload: { max_tokens: agent.max_tokens },
        });
      }
      return { conversationId: conversation.id, text: textoFinal, stopReason };
    }

    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      resultados.push(
        await executeTool({
          toolUse,
          tools,
          messageId: assistantMessage.id,
          ctx: toolContext,
        }),
      );
    }

    // Todos os resultados vão numa única mensagem — separá-los ensina o modelo
    // a parar de pedir ferramentas em paralelo.
    messages.push({ role: "user", content: resultados });
    await insertMessage({
      conversation_id: conversation.id,
      role: "tool",
      blocks: resultados as unknown as Json,
    });
  }

  await logEvent({
    agentId: agent.id,
    conversationId: conversation.id,
    level: "error",
    event: "limite_de_iteracoes",
    payload: { max: MAX_ITERACOES },
  });

  throw new Error(
    `O agente "${agentSlug}" excedeu ${MAX_ITERACOES} rodadas de ferramentas sem concluir.`,
  );
}

function buildRequest(
  agent: Agent,
  messages: Anthropic.MessageParam[],
  tools: AgentTool[],
): Anthropic.MessageCreateParamsNonStreaming {
  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: agent.model,
    max_tokens: agent.max_tokens,
    messages,
    // O prompt fica em bloco próprio com cache: é a parte estável do prefixo.
    system: agent.system_prompt
      ? [
          {
            type: "text",
            text: agent.system_prompt,
            cache_control: { type: "ephemeral" },
          },
        ]
      : undefined,
    thinking: { type: "adaptive" },
    output_config: { effort: agent.effort as Anthropic.OutputConfig["effort"] },
  };

  if (tools.length > 0) {
    request.tools = tools.map((tool) => tool.definition);
  }
  return request;
}

async function executeTool(params: {
  toolUse: Anthropic.ToolUseBlock;
  tools: AgentTool[];
  messageId: string;
  ctx: ToolContext;
}): Promise<Anthropic.ToolResultBlockParam> {
  const { toolUse, tools, messageId, ctx } = params;
  const { conversationId, agentId } = ctx;
  const tool = tools.find((t) => t.definition.name === toolUse.name);
  const input = (toolUse.input ?? {}) as Record<string, unknown>;
  const inicio = Date.now();

  if (!tool) {
    const mensagem = `Ferramenta "${toolUse.name}" não está habilitada para este agente.`;
    await insertToolCall({
      conversation_id: conversationId,
      message_id: messageId,
      tool_use_id: toolUse.id,
      tool_name: toolUse.name,
      input: input as Json,
      output: { erro: mensagem } as Json,
      is_error: true,
      duration_ms: 0,
    });
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: mensagem,
      is_error: true,
    };
  }

  try {
    const saida = await tool.run(input, ctx);
    await insertToolCall({
      conversation_id: conversationId,
      message_id: messageId,
      tool_use_id: toolUse.id,
      tool_name: toolUse.name,
      input: input as Json,
      output: { resultado: saida } as Json,
      is_error: false,
      duration_ms: Date.now() - inicio,
    });
    return { type: "tool_result", tool_use_id: toolUse.id, content: saida };
  } catch (erro) {
    // O erro volta como tool_result para o modelo tentar outro caminho —
    // derrubar o turno inteiro por uma ferramenta que falhou seria pior.
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await insertToolCall({
      conversation_id: conversationId,
      message_id: messageId,
      tool_use_id: toolUse.id,
      tool_name: toolUse.name,
      input: input as Json,
      output: { erro: mensagem } as Json,
      is_error: true,
      duration_ms: Date.now() - inicio,
    });
    await logEvent({
      agentId,
      conversationId,
      level: "error",
      event: "ferramenta_falhou",
      payload: { tool: toolUse.name, erro: mensagem } as Json,
    });
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: `Erro: ${mensagem}`,
      is_error: true,
    };
  }
}

/** Reconstrói uma mensagem persistida no formato que a API espera. */
function toMessageParam(row: Message): Anthropic.MessageParam {
  const blocks = row.blocks as Anthropic.ContentBlockParam[] | null;

  // Resultados de ferramenta são persistidos como role "tool", mas a API
  // os espera dentro de um turno de usuário.
  if (row.role === "tool") {
    return { role: "user", content: blocks ?? [] };
  }
  const role = row.role === "assistant" ? "assistant" : "user";
  return { role, content: blocks ?? row.content ?? "" };
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((bloco): bloco is Anthropic.TextBlock => bloco.type === "text")
    .map((bloco) => bloco.text)
    .join("\n")
    .trim();
}

function readToolNames(agent: Agent): unknown {
  const config = agent.config;
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return (config as Record<string, Json | undefined>).tools;
  }
  return undefined;
}
