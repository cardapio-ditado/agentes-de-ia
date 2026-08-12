import type Anthropic from "@anthropic-ai/sdk";

/** Contexto da execução, entregue a toda ferramenta. */
export interface ToolContext {
  agentId: string;
  conversationId: string;
  /** Estabelecimento desta conversa. Null quando o agente não é ligado a um venue. */
  venueId: string | null;
  /** Canal de origem: api, web, whatsapp... */
  channel: string;
}

/**
 * Uma ferramenta que o agente pode chamar.
 *
 * `definition` é o schema enviado à API da Anthropic; `run` é a implementação
 * executada aqui no servidor. Descreva bem *quando* usar a ferramenta — é o
 * fator que mais influencia o modelo a chamá-la na hora certa.
 */
export interface AgentTool {
  definition: Anthropic.Tool;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}
