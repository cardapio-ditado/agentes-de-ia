import { db } from "./supabase.js";
import { hojeNaCasa } from "./fuso.js";
import { chamarZig, configZig, diaAnterior } from "./pesquisaZig.js";
import { casasComZig } from "./historicoZig.js";
import type { Json } from "./database.types.js";

/**
 * A CASA AO VIVO, PELA ZIG.
 *
 * A API da Zig entrega o movimento do dia enquanto ele acontece: a venda
 * mais nova tem segundos, o check-in traz hora de entrada, de saída e da
 * última compra. Confirmado com a casa cheia em 06/10/2026 (docs/zig-api.md).
 *
 * Este módulo tira um RETRATO da casa de tanto em tanto tempo — quem está
 * aqui, quem está consumindo, quanto já entrou, por garçom — e grava numa
 * linha por casa. A planta ("A casa agora") lê a linha e desenha os
 * bonequinhos dos clientes no salão.
 *
 * Retrato, e não consulta ao vivo da tela: a planta pergunta a cada quinze
 * segundos, e cada pergunta à Zig são quatro chamadas. Uma por casa a cada
 * dois minutos é o que a API aguenta sem ninguém reclamar.
 */

/** Sem compra nem check-in há tanto tempo, a pessoa foi embora sem passar na porta. */
export const MINUTOS_PARA_IR_EMBORA = 90;
/** Compra mais nova que isto: a pessoa está consumindo agora. */
export const MINUTOS_CONSUMINDO = 30;
/** Um evento aberto há mais do que isto já acabou, mesmo sem fechar na Zig. */
export const HORAS_DE_EVENTO = 20;
/** Quantos clientes a planta desenha, no máximo. O resto vira "+N". */
export const MAXIMO_DE_BONECOS = 80;

// ---- O que a Zig devolve (só o que lemos) ----

export interface EventoDaZig {
  id: string;
  name?: string | null;
  beginAt: string;
  peopleCapacity?: number | null;
}

export interface SaidaDaZig {
  transactionId: string;
  transactionDate: string;
  unitValue?: number | null;
  count?: number | null;
  discountValue?: number | null;
  employeeName?: string | null;
  type?: string | null;
  productName?: string | null;
  eventId?: string | null;
}

export interface CheckinAoVivo {
  id?: string | null;
  checkinTime: string;
  checkoutTime?: string | null;
  name?: string | null;
  phone?: string | null;
  lastTransactionTime?: string | null;
}

export interface CompradorAoVivo {
  transactionId: string;
  date?: string | null;
  userPhone?: string | null;
  userName?: string | null;
  productsValue?: number | null;
}

// ---- O retrato ----

export interface ClienteNaCasa {
  id: string;
  nome: string | null;
  telefone: string | null;
  chegou_em: string;
  ultima_compra_em: string | null;
  gasto_centavos: number;
  /** Comprou nos últimos minutos. */
  consumindo: boolean;
}

export interface GarcomNoRetrato {
  nome: string;
  vendas_centavos: number;
  itens: number;
}

export interface Retrato {
  atualizado_em: string;
  evento: { id: string; nome: string | null; inicio: string; capacidade: number | null } | null;
  pessoas_na_casa: number;
  consumindo_agora: number;
  checkins_hoje: number;
  /** Quem já saiu pela porta (tem checkout). */
  sairam: number;
  vendas_hoje_centavos: number;
  transacoes_hoje: number;
  pessoas_que_compraram: number;
  ticket_medio_centavos: number;
  vendas_15min_centavos: number;
  garcons: GarcomNoRetrato[];
  /** Quem está na casa agora, do mais recente para o mais antigo. */
  clientes: ClienteNaCasa[];
  /** Clientes na casa que não couberam em `clientes`. */
  clientes_a_mais: number;
}

/** A Zig escreve as horas em UTC sem o "Z". Sem isto, o navegador leria como local. */
export function horaDaZig(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const texto = /Z$|[+-]\d\d:?\d\d$/.test(valor) ? valor : `${valor}Z`;
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A chave de uma pessoa pelo telefone: a Zig ora manda com +55, ora sem, e é
 * a mesma pessoa nos check-ins e nos compradores.
 */
export function chaveDoTelefone(bruto: string | null | undefined): string {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  return digitos.length > 11 && digitos.startsWith("55") ? digitos.slice(2) : digitos;
}

function minutosAte(agora: Date, quando: Date | null): number {
  if (!quando) return Infinity;
  return (agora.getTime() - quando.getTime()) / 60_000;
}

/** O evento aberto agora: o mais recente que começou e ainda não "venceu". */
export function eventoAberto(eventos: EventoDaZig[], agora: Date): EventoDaZig | null {
  let melhor: EventoDaZig | null = null;
  for (const e of eventos) {
    const inicio = horaDaZig(e.beginAt);
    if (!inicio || inicio > agora) continue;
    if (minutosAte(agora, inicio) > HORAS_DE_EVENTO * 60) continue;
    if (!melhor || inicio > (horaDaZig(melhor.beginAt) ?? new Date(0))) melhor = e;
  }
  return melhor;
}

function centavos(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Monta o retrato a partir do que a Zig devolveu. Pura e testável.
 *
 * Quem está na casa: entrou, não saiu pela porta e deu sinal de vida
 * (entrada ou compra) nos últimos 90 minutos. A porta nem sempre registra
 * saída — gente vai embora sem passar o cartão — e a última compra é o
 * sinal que resta.
 */
export function montarRetrato(params: {
  eventos: EventoDaZig[];
  saidas: SaidaDaZig[];
  checkins: CheckinAoVivo[];
  compradores: CompradorAoVivo[];
  agora: Date;
}): Retrato {
  const { agora } = params;
  const evento = eventoAberto(params.eventos, agora);
  const inicio = evento ? horaDaZig(evento.beginAt)! : null;
  const desdeOInicio = (quando: Date | null) => !inicio || (quando !== null && quando >= inicio);

  const vazio: Retrato = {
    atualizado_em: agora.toISOString(),
    evento: evento
      ? { id: evento.id, nome: evento.name ?? null, inicio: inicio!.toISOString(), capacidade: evento.peopleCapacity ?? null }
      : null,
    pessoas_na_casa: 0,
    consumindo_agora: 0,
    checkins_hoje: 0,
    sairam: 0,
    vendas_hoje_centavos: 0,
    transacoes_hoje: 0,
    pessoas_que_compraram: 0,
    ticket_medio_centavos: 0,
    vendas_15min_centavos: 0,
    garcons: [],
    clientes: [],
    clientes_a_mais: 0,
  };
  if (!evento) return vazio;

  // ---- Vendas ----
  const saidas = params.saidas.filter((s) => desdeOInicio(horaDaZig(s.transactionDate)));
  let vendas = 0;
  let vendas15 = 0;
  const transacoes = new Set<string>();
  const porGarcom = new Map<string, GarcomNoRetrato>();
  for (const s of saidas) {
    const valor = centavos(s.unitValue) * Math.max(1, centavos(s.count) || 1) - centavos(s.discountValue);
    vendas += valor;
    transacoes.add(s.transactionId);
    if (minutosAte(agora, horaDaZig(s.transactionDate)) <= 15) vendas15 += valor;
    const nome = (s.employeeName ?? "").trim();
    if (nome) {
      const g = porGarcom.get(nome) ?? { nome, vendas_centavos: 0, itens: 0 };
      g.vendas_centavos += valor;
      g.itens += Math.max(1, centavos(s.count) || 1);
      porGarcom.set(nome, g);
    }
  }

  // ---- Quem comprou, e quanto ----
  const gastoPorTelefone = new Map<string, number>();
  const nomePorTelefone = new Map<string, string>();
  for (const c of params.compradores) {
    if (!desdeOInicio(horaDaZig(c.date ?? null)) && c.date) continue;
    const tel = chaveDoTelefone(c.userPhone);
    if (!tel) continue;
    gastoPorTelefone.set(tel, (gastoPorTelefone.get(tel) ?? 0) + centavos(c.productsValue));
    if (c.userName && !nomePorTelefone.has(tel)) nomePorTelefone.set(tel, c.userName.trim());
  }

  // ---- Quem entrou ----
  // Uma pessoa com dois check-ins no dia é a mesma pessoa: fica o mais novo.
  const porPessoa = new Map<string, CheckinAoVivo>();
  let sairam = 0;
  const checkins = params.checkins.filter((c) => desdeOInicio(horaDaZig(c.checkinTime)));
  for (const c of checkins) {
    const chave = chaveDoTelefone(c.phone) || c.id || `${c.name ?? ""}@${c.checkinTime}`;
    const atual = porPessoa.get(chave);
    if (!atual || (horaDaZig(c.checkinTime) ?? new Date(0)) > (horaDaZig(atual.checkinTime) ?? new Date(0))) {
      porPessoa.set(chave, c);
    }
  }
  const presentes: ClienteNaCasa[] = [];
  for (const [chave, c] of porPessoa) {
    const entrada = horaDaZig(c.checkinTime);
    const saida = horaDaZig(c.checkoutTime ?? null);
    const compra = horaDaZig(c.lastTransactionTime ?? null);
    if (saida) {
      sairam += 1;
      continue;
    }
    const sinalDeVida = compra && entrada && compra > entrada ? compra : entrada;
    if (minutosAte(agora, sinalDeVida) > MINUTOS_PARA_IR_EMBORA) continue;
    const tel = chaveDoTelefone(c.phone);
    presentes.push({
      id: c.id || chave,
      nome: (c.name ?? "").trim() || (tel ? nomePorTelefone.get(tel) ?? null : null),
      telefone: tel || null,
      chegou_em: entrada!.toISOString(),
      ultima_compra_em: compra ? compra.toISOString() : null,
      gasto_centavos: tel ? gastoPorTelefone.get(tel) ?? 0 : 0,
      consumindo: minutosAte(agora, compra) <= MINUTOS_CONSUMINDO,
    });
  }
  presentes.sort((a, b) => {
    const ua = a.ultima_compra_em ?? a.chegou_em;
    const ub = b.ultima_compra_em ?? b.chegou_em;
    return ub.localeCompare(ua);
  });

  const compraram = gastoPorTelefone.size;
  return {
    ...vazio,
    pessoas_na_casa: presentes.length,
    consumindo_agora: presentes.filter((p) => p.consumindo).length,
    checkins_hoje: porPessoa.size,
    sairam,
    vendas_hoje_centavos: vendas,
    transacoes_hoje: transacoes.size,
    pessoas_que_compraram: compraram,
    ticket_medio_centavos: compraram ? Math.round(vendas / compraram) : transacoes.size ? Math.round(vendas / transacoes.size) : 0,
    vendas_15min_centavos: vendas15,
    garcons: [...porGarcom.values()].sort((a, b) => b.vendas_centavos - a.vendas_centavos).slice(0, 12),
    clientes: presentes.slice(0, MAXIMO_DE_BONECOS),
    clientes_a_mais: Math.max(0, presentes.length - MAXIMO_DE_BONECOS),
  };
}

// ============================================================
// Buscar na Zig e guardar
// ============================================================

/** Tira o retrato de uma casa agora. Quatro chamadas à Zig quando há evento aberto; uma quando não há. */
export async function tirarRetrato(
  venue: { id: string; timezone: string },
  config: { token: string; loja: string },
  agora = new Date(),
): Promise<Retrato> {
  const hoje = hojeNaCasa(venue.timezone, agora);
  const ontem = diaAnterior(hoje);
  const loja = encodeURIComponent(config.loja);

  const eventos = await chamarZig<EventoDaZig[]>(`/erp/events?loja=${loja}&dtinicio=${ontem}&dtfim=${hoje}`, config.token);
  const evento = eventoAberto(eventos ?? [], agora);
  if (!evento) return montarRetrato({ eventos: eventos ?? [], saidas: [], checkins: [], compradores: [], agora });

  // O evento pode ter começado ontem (a noite vira o dia): a janela vai do
  // dia em que ele começou até hoje — dois dias, dentro do limite de cinco.
  const diaDoEvento = hojeNaCasa(venue.timezone, horaDaZig(evento.beginAt) ?? agora);
  const [saidas, compradores, checkins] = await Promise.all([
    chamarZig<SaidaDaZig[]>(`/erp/saida-produtos?dtinicio=${diaDoEvento}&dtfim=${hoje}&loja=${loja}`, config.token),
    chamarZig<CompradorAoVivo[]>(`/erp/compradores?dtinicio=${diaDoEvento}&dtfim=${hoje}&loja=${loja}`, config.token),
    todosOsCheckins(config, diaDoEvento, hoje),
  ]);

  return montarRetrato({ eventos: eventos ?? [], saidas: saidas ?? [], checkins, compradores: compradores ?? [], agora });
}

async function todosOsCheckins(config: { token: string; loja: string }, desde: string, ate: string): Promise<CheckinAoVivo[]> {
  const loja = encodeURIComponent(config.loja);
  const todos: CheckinAoVivo[] = [];
  // `dtfim` é exclusivo na Zig: o dia seguinte ao último pega a madrugada.
  const fim = diaSeguinte(ate);
  for (let pagina = 1; pagina <= 40; pagina++) {
    const lote = await chamarZig<CheckinAoVivo[]>(
      `/erp/checkins?desde=${desde}&dtfim=${fim}&loja=${loja}&page=${pagina}`,
      config.token,
    );
    todos.push(...(lote ?? []));
    if (!lote || lote.length < 50) break;
  }
  return todos;
}

function diaSeguinte(diaISO: string): string {
  const d = new Date(`${diaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function gravarRetrato(venueId: string, retrato: Retrato): Promise<void> {
  const { error } = await db()
    .from("casa_ao_vivo")
    .upsert({ venue_id: venueId, atualizado_em: retrato.atualizado_em, retrato: retrato as unknown as Json }, { onConflict: "venue_id" });
  if (error) throw new Error(`Falha ao guardar o retrato da casa: ${error.message}`);
}

/** O último retrato gravado, para a planta. Nunca lança: sem retrato, a planta segue sem clientes. */
export async function retratoGravado(venueId: string): Promise<Retrato | null> {
  const { data, error } = await db().from("casa_ao_vivo").select("retrato").eq("venue_id", venueId).maybeSingle();
  if (error || !data) return null;
  return (data as { retrato: Json }).retrato as unknown as Retrato;
}

/**
 * O relógio: um retrato por casa ligada à Zig. Nunca lança — uma casa com
 * token vencido não pode apagar a planta das outras.
 */
export async function cicloAoVivo(agora = new Date()): Promise<{ retratos: number; falhas: string[] }> {
  const casas = await casasComZig();
  let retratos = 0;
  const falhas: string[] = [];
  for (const casa of casas) {
    try {
      const config = await configZig(casa.id);
      if (!config.token || !config.loja) continue;
      const retrato = await tirarRetrato(casa, { token: config.token, loja: config.loja }, agora);
      await gravarRetrato(casa.id, retrato);
      retratos += 1;
    } catch (e) {
      falhas.push(`${casa.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { retratos, falhas };
}
