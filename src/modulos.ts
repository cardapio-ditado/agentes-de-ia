import { db } from "./supabase.js";

/**
 * Quais módulos do Brasa Food o cliente contratou.
 *
 * A colmeia mostrava os mesmos favos para todo mundo. Quem não tinha o módulo
 * de agentes via "Agentes de IA" aceso e entrava — usando de graça o que é
 * vendido, ou pior, começando a depender de algo que não comprou.
 *
 * A regra é a mais segura para os dois lados: linha ausente = não tem. Um
 * módulo novo não aparece para ninguém até alguém dizer que aquele cliente o
 * contratou, em vez de aparecer para todos até alguém lembrar de esconder.
 */

export interface ModuloDoCliente {
  modulo: string;
  ativo: boolean;
  /** Endereço externo, para módulo que não é tela do painel. */
  url: string | null;
}

export async function listarModulos(venueId: string): Promise<ModuloDoCliente[]> {
  const { data, error } = await db()
    .from("venue_modulos")
    .select("modulo, ativo, url")
    .eq("venue_id", venueId);

  // A tabela pode não existir ainda num banco que não rodou a migração. Aí o
  // certo é o painel seguir com o que sempre teve, e não abrir uma colmeia
  // vazia que parece conta cancelada.
  if (error) {
    if (/42P01|PGRST205|does not exist|schema cache/i.test(error.message)) {
      return MODULOS_ANTES_DA_MIGRACAO.map((modulo) => ({ modulo, ativo: true, url: null }));
    }
    throw new Error(`Falha ao ler os módulos do cliente: ${error.message}`);
  }

  return (data ?? []) as ModuloDoCliente[];
}

/** O que todo cliente tinha antes de existir controle por módulo. */
const MODULOS_ANTES_DA_MIGRACAO = ["agentes-ia", "checklist", "avaliacoes"];

/**
 * O cliente pode abrir este módulo?
 *
 * Conferido no servidor, e não só escondendo o favo: quem guardou o endereço
 * de uma tela de módulo entraria por ele mesmo com o favo apagado.
 */
export async function temModulo(venueId: string, modulo: string): Promise<boolean> {
  const modulos = await listarModulos(venueId);
  return modulos.some((m) => m.modulo === modulo && m.ativo);
}

/**
 * Liga, desliga ou reendereça um módulo do cliente. Só a equipe Brasa Food.
 *
 * Desligar não apaga a linha: `contratado_em` é a resposta para "desde quando
 * ele paga por isso", e some junto se a linha for removida no primeiro mês em
 * que o cliente pausa.
 */
export async function definirModulo(params: {
  venueId: string;
  modulo: string;
  ativo: boolean;
  url?: string | null;
}): Promise<void> {
  const linha: Record<string, unknown> = {
    venue_id: params.venueId,
    modulo: params.modulo,
    ativo: params.ativo,
  };
  // `undefined` significa "não mexa no endereço"; `null` significa "apague".
  // Sem essa distinção, ligar um módulo apagaria a URL cadastrada antes.
  if (params.url !== undefined) linha.url = params.url;

  const { error } = await db()
    .from("venue_modulos")
    .upsert(linha as never, { onConflict: "venue_id,modulo" });
  if (error) throw new Error(`Falha ao salvar o módulo: ${error.message}`);
}
