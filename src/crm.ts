/**
 * O RETRATO DE UM CLIENTE — o que a lista precisa dizer num relance.
 *
 * A base guarda três números crus por pessoa: quanto gastou no total, quantas
 * vezes veio e quando veio pela última vez. Nenhum dos três, sozinho, responde
 * a pergunta que o dono do bar faz olhando a lista — "de quem eu tenho de
 * cuidar?".
 *
 * R$ 2.000 em quarenta visitas é o freguês da quinta-feira, que vem sempre e
 * gasta pouco. R$ 2.000 em três visitas é quem fecha a mesa dos fundos no
 * aniversário. Os dois têm o mesmo total e não são a mesma pessoa, e a
 * diferença entre eles decide quem ganha o telefonema.
 *
 * Aqui os três viram ticket médio, tempo sem aparecer e um selo — e o selo é
 * o que faz a lista ser lida de relance em vez de estudada.
 *
 * Tudo puro, sem banco: são contas sobre o que a base já tem.
 */

export interface ClienteCru {
  visitas: number | null;
  gasto_total_centavos: number | null;
  ultima_visita: string | null;
}

export type Selo = "vip" | "fiel" | "sumido" | "novo" | "comum";

export interface Retrato {
  visitas: number;
  gasto_centavos: number;
  /** Quanto gasta por visita, em centavos. `null` sem visita registrada. */
  ticket_centavos: number | null;
  /** Dias desde a última visita. `null` = nunca veio (cadastro à mão, etc). */
  dias_sem_vir: number | null;
  selo: Selo;
}

/** Sem vir há mais que isto, quem era de casa virou assunto. */
export const DIAS_PARA_SUMIR = 60;
/** A partir daqui a pessoa é de casa, e não alguém que passou por aqui. */
export const VISITAS_PARA_SER_FIEL = 5;
/** E, com este ticket, ela é das que sustentam a noite. */
export const TICKET_DE_VIP_CENTAVOS = 25_000;

export function diasEntre(de: string, ate: string): number {
  const a = new Date(`${de}T12:00:00Z`).getTime();
  const b = new Date(`${ate}T12:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * O selo de uma pessoa.
 *
 * A ordem das perguntas é a ordem da urgência, e não a da importância:
 *
 *   1. SUMIDO ganha de tudo. Um VIP que não aparece há três meses continua
 *      sendo um VIP — e é exatamente por isso que ele é o mais urgente da
 *      lista. Marcá-lo de "vip" e deixá-lo no meio dos outros vips é perder
 *      o único momento em que dava para trazê-lo de volta.
 *   2. NOVO vem antes de "comum" porque quem veio uma vez ainda não decidiu
 *      se volta, e isso é uma janela que fecha.
 *   3. VIP e FIEL são o retrato de quem já é de casa: gasta muito por visita,
 *      ou vem sempre.
 */
export function seloDe(r: {
  visitas: number;
  ticket_centavos: number | null;
  dias_sem_vir: number | null;
}): Selo {
  if (r.dias_sem_vir !== null && r.dias_sem_vir > DIAS_PARA_SUMIR && r.visitas > 1) return "sumido";
  if (r.visitas <= 1) return "novo";
  if ((r.ticket_centavos ?? 0) >= TICKET_DE_VIP_CENTAVOS) return "vip";
  if (r.visitas >= VISITAS_PARA_SER_FIEL) return "fiel";
  return "comum";
}

export function retratoDe(c: ClienteCru, hoje: string): Retrato {
  const visitas = Math.max(0, Number(c.visitas ?? 0));
  const gasto = Math.max(0, Number(c.gasto_total_centavos ?? 0));
  // Sem visita registrada não há ticket: dividir por zero daria Infinity, e
  // uma tela com "R$ Infinity" é pior que uma tela com um traço.
  const ticket = visitas > 0 ? Math.round(gasto / visitas) : null;
  const dias = c.ultima_visita ? diasEntre(c.ultima_visita, hoje) : null;

  return {
    visitas,
    gasto_centavos: gasto,
    ticket_centavos: ticket,
    dias_sem_vir: dias,
    selo: seloDe({ visitas, ticket_centavos: ticket, dias_sem_vir: dias }),
  };
}

export const SELOS: Array<{ id: Selo; nome: string; explicacao: string }> = [
  { id: "vip", nome: "VIP", explicacao: "Gasta muito por visita — a mesa que sustenta a noite." },
  { id: "fiel", nome: "Fiel", explicacao: `Veio ${VISITAS_PARA_SER_FIEL} vezes ou mais. É de casa.` },
  {
    id: "sumido",
    nome: "Sumido",
    explicacao: `Vinha e parou: mais de ${DIAS_PARA_SUMIR} dias sem aparecer. É a lista de quem chamar de volta.`,
  },
  { id: "novo", nome: "Novo", explicacao: "Veio uma vez. Ainda não decidiu se volta." },
  { id: "comum", nome: "Comum", explicacao: "Aparece de vez em quando." },
];

/** "há 3 dias", "há 2 meses" — como quem fala, não como quem conta dias. */
export function faltaHaQuantoTempo(dias: number | null): string {
  if (dias === null) return "nunca veio";
  if (dias === 0) return "veio hoje";
  if (dias === 1) return "veio ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
  const anos = Math.floor(meses / 12);
  return anos === 1 ? "há 1 ano" : `há ${anos} anos`;
}

/**
 * O resumo da base inteira, para o topo da tela.
 *
 * Quantos são, quantos somem, quanto vale a base. É o que responde "como
 * está minha casa?" antes de o dono descer para uma pessoa específica.
 */
export interface ResumoDaBase {
  total: number;
  por_selo: Record<Selo, number>;
  gasto_total_centavos: number;
  ticket_medio_centavos: number | null;
}

export function resumoDaBase(retratos: Retrato[]): ResumoDaBase {
  const por_selo: Record<Selo, number> = { vip: 0, fiel: 0, sumido: 0, novo: 0, comum: 0 };
  let gasto = 0;
  let visitas = 0;

  for (const r of retratos) {
    por_selo[r.selo] += 1;
    gasto += r.gasto_centavos;
    visitas += r.visitas;
  }

  return {
    total: retratos.length,
    por_selo,
    gasto_total_centavos: gasto,
    // O ticket da casa é gasto ÷ visitas, e não a média dos tickets: a média
    // das médias dá peso igual a quem veio uma vez e a quem veio quarenta.
    ticket_medio_centavos: visitas > 0 ? Math.round(gasto / visitas) : null,
  };
}
