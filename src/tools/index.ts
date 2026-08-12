import { ferramentasDeRestaurante } from "./restaurante.js";
import type { AgentTool } from "./types.js";

export type { AgentTool, ToolContext } from "./types.js";

/** Todas as ferramentas disponíveis, indexadas por nome. */
export const toolRegistry: Record<string, AgentTool> = Object.fromEntries(
  ferramentasDeRestaurante.map((tool) => [tool.definition.name, tool]),
);

/**
 * Seleciona as ferramentas de um agente.
 *
 * `names` vem de `agents.config.tools` no banco. Sem esse campo, o agente roda
 * sem nenhuma ferramenta — habilitar é sempre uma escolha explícita.
 */
export function resolveTools(names: unknown): AgentTool[] {
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
