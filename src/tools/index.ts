import { ferramentasDeRestaurante } from "./restaurante.js";
import type { AgentTool } from "./types.js";

export type { AgentTool, ToolContext } from "./types.js";

/** Todas as ferramentas disponíveis, indexadas por nome. */
export const toolRegistry: Record<string, AgentTool> = Object.fromEntries(
  ferramentasDeRestaurante.map((tool) => [tool.definition.name, tool]),
);

/** O que todo agente de atendimento precisa para trabalhar. */
export const FERRAMENTAS_PADRAO = ferramentasDeRestaurante.map((t) => t.definition.name);

/**
 * Seleciona as ferramentas de um agente.
 *
 * `names` vem de `agents.config.tools` no banco:
 * - campo ausente → conjunto padrão completo. Agente criado pelo painel não
 *   passa por nenhuma tela de ferramentas; "ausente = nenhuma" produzia um
 *   atendente que não enxergava a programação e — pior — improvisava
 *   confirmação de reserva sem ter como registrá-la.
 * - array explícito (mesmo vazio) → respeitado à risca. Restringir continua
 *   sendo uma escolha deliberada de quem edita o banco.
 */
export function resolveTools(names: unknown): AgentTool[] {
  if (names === undefined || names === null) {
    return FERRAMENTAS_PADRAO.map((name) => toolRegistry[name]!);
  }
  if (!Array.isArray(names)) return [];

  return names.map((name) => {
    if (typeof name !== "string") {
      throw new Error(`config.tools deve conter apenas strings, recebido: ${typeof name}`);
    }
    const tool = toolRegistry[name];
    if (!tool) {
      const disponiveis = Object.keys(toolRegistry).join(", ") || "(nenhuma)";
      throw new Error(`Ferramenta "${name}" não existe. Disponíveis: ${disponiveis}.`);
    }
    return tool;
  });
}
