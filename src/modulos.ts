import { db, ehMigracaoPendente } from "./supabase.js";

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

/**
 * Memória curta do contrato da casa.
 *
 * A trava de módulo saiu de "uma rota" para "toda rota de módulo", e sem isto
 * cada clique do painel viraria uma consulta a mais no banco. Contrato muda
 * quando alguém da Brasa Food liga ou desliga um módulo — coisa de minutos em
 * minutos, não de segundo em segundo —, e essa mudança apaga a memória na
 * hora (ver `definirModulo`). Um minuto é folgado para o que sobrar.
 */
const memoria = new Map<string, { quando: number; modulos: ModuloDoCliente[] }>();
const VALIDADE_MS = 60_000;

export function esquecerModulos(venueId: string): void {
  memoria.delete(venueId);
}

export async function listarModulos(venueId: string): Promise<ModuloDoCliente[]> {
  const guardado = memoria.get(venueId);
  if (guardado && Date.now() - guardado.quando < VALIDADE_MS) return guardado.modulos;

  const { data, error } = await db()
    .from("venue_modulos")
    .select("modulo, ativo, url")
    .eq("venue_id", venueId);

  // A tabela pode não existir ainda num banco que não rodou a migração. Aí o
  // certo é o painel seguir com o que sempre teve, e não abrir uma colmeia
  // vazia que parece conta cancelada.
  //
  // Isto é um fail-open consciente, e continua certo depois de a trava ficar
  // de verdade: banco sem a migração é banco NOVO, não casa que perdeu o
  // contrato. O erro é reconhecido pela CAUSA (tabela/coluna que não existe),
  // e não por casar o nome da tabela no texto — que engoliria erro de rede
  // junto e abriria tudo por causa de um soluço do Supabase.
  if (error) {
    if (ehMigracaoPendente(error.message)) {
      return MODULOS_ANTES_DA_MIGRACAO.map((modulo) => ({ modulo, ativo: true, url: null }));
    }
    throw new Error(`Falha ao ler os módulos do cliente: ${error.message}`);
  }

  const modulos = (data ?? []) as ModuloDoCliente[];
  memoria.set(venueId, { quando: Date.now(), modulos });
  return modulos;
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

  // Sem isto, ligar um módulo para um cliente ao telefone teria um minuto de
  // "não apareceu nada aqui" — e é justamente o minuto em que os dois estão
  // olhando a tela juntos.
  esquecerModulos(params.venueId);
}
