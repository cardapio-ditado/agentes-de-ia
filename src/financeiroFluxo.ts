import { db } from "./supabase.js";
import { hojeNaCasa } from "./fuso.js";
import { ErroDoFinanceiro, GRUPOS, type Grupo, somarDias, somarMeses } from "./financeiro.js";

/**
 * Financeiro — Rodada 2: o fluxo de caixa e o painel.
 *
 * O fluxo responde "vai faltar dinheiro?": o saldo de hoje, mais o que vai
 * entrar, menos o que vai sair, dia a dia. O painel responde "sobrou quanto
 * este mês?": o resultado por competência, na ordem que a mentoria cobra
 * (receita, CMV, pessoal, ocupação…), com o prime cost e o ponto de
 * equilíbrio — quanto a casa precisa vender por dia para pagar as contas.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const ehData = (v: unknown): v is string => typeof v === "string" && DATA.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const c = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const r = (centavos: number) => Math.round(centavos) / 100;
const fimDoMes = (iso: string) => {
  const [a, m] = iso.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

// ============================================================
// Fluxo de caixa
// ============================================================

export interface ContaDoFluxo {
  id: string;
  saldo_inicial: number;
  saldo_inicial_em: string;
}
export interface Pago {
  tipo: "pagar" | "receber";
  conta_id: string | null;
  pago_em: string | null;
  valor_pago: number | null;
  valor: number;
}
export interface Aberto {
  tipo: "pagar" | "receber";
  conta_id: string | null;
  vencimento: string;
  valor: number;
}
export interface TransferenciaDoFluxo {
  de_conta_id: string;
  para_conta_id: string;
  valor: number;
  dia: string;
}
export type Agrupamento = "dia" | "semana" | "mes";

/** Segunda-feira da semana do dia. */
export function inicioDaSemana(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return somarDias(iso, -((dow + 6) % 7));
}

function chaveDoPeriodo(iso: string, agrupar: Agrupamento) {
  if (agrupar === "mes") return `${iso.slice(0, 7)}-01`;
  if (agrupar === "semana") return inicioDaSemana(iso);
  return iso;
}

/**
 * O fluxo é feito dia a dia por dentro (o alerta de "fica negativo" precisa
 * do dia exato) e agrupado por semana ou mês só para mostrar.
 *
 * - Realizado: o que foi pago ou recebido (pela data do pagamento).
 * - Previsto: o que está em aberto, pela data do vencimento; o que já
 *   venceu e não foi pago entra HOJE — ainda vai sair (ou entrar).
 * - Transferência só conta quando se olha UMA conta: no total da casa,
 *   o dinheiro só mudou de lugar.
 * - Movimento antes do dia do saldo inicial da conta já está dentro dele.
 */
export function montarFluxo(params: {
  contas: ContaDoFluxo[];
  pagos: Pago[];
  abertos: Aberto[];
  transferencias: TransferenciaDoFluxo[];
  de: string;
  ate: string;
  hoje: string;
  agrupar: Agrupamento;
  contaId?: string | null;
}) {
  const { de, ate, hoje } = params;
  const contas = params.contaId ? params.contas.filter((x) => x.id === params.contaId) : params.contas;
  const abertura = new Map(contas.map((x) => [x.id, x.saldo_inicial_em]));
  const valeNaConta = (conta: string | null, dia: string) => conta !== null && abertura.has(conta) && dia >= abertura.get(conta)!;

  // Movimento realizado por dia (centavos, + entra / − sai).
  let saldoInicial = contas.reduce((s, x) => s + c(x.saldo_inicial), 0);
  const entra = new Map<string, number>();
  const sai = new Map<string, number>();
  const entraPrev = new Map<string, number>();
  const saiPrev = new Map<string, number>();
  const somar = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const p of params.pagos) {
    if (!p.pago_em || !valeNaConta(p.conta_id, p.pago_em)) continue;
    const v = c(p.valor_pago ?? p.valor);
    if (p.pago_em < de) saldoInicial += p.tipo === "receber" ? v : -v;
    else if (p.pago_em <= ate) somar(p.tipo === "receber" ? entra : sai, p.pago_em, v);
  }
  if (params.contaId) {
    for (const t of params.transferencias) {
      const v = c(t.valor);
      for (const [conta, sinal] of [[t.para_conta_id, 1], [t.de_conta_id, -1]] as const) {
        if (!valeNaConta(conta, t.dia)) continue;
        if (t.dia < de) saldoInicial += sinal * v;
        else if (t.dia <= ate) somar(sinal > 0 ? entra : sai, t.dia, v);
      }
    }
  }
  let atrasadoPagar = 0;
  let atrasadoReceber = 0;
  for (const a of params.abertos) {
    if (params.contaId && a.conta_id !== params.contaId) continue;
    const v = c(a.valor);
    // O atrasado vai para hoje: é dinheiro que ainda vai sair.
    const dia = a.vencimento < hoje ? hoje : a.vencimento;
    if (a.vencimento < hoje) {
      if (a.tipo === "pagar") atrasadoPagar += v;
      else atrasadoReceber += v;
    }
    if (dia < de || dia > ate) continue;
    somar(a.tipo === "receber" ? entraPrev : saiPrev, dia, v);
  }

  const dias = Math.min(diasEntre(de, ate), 400);
  const periodos = new Map<string, { inicio: string; fim: string; entradas: number; saidas: number; entradas_previstas: number; saidas_previstas: number; saldo: number; menor_saldo: number }>();
  let saldo = saldoInicial;
  let primeiroNegativo: { dia: string; saldo: number } | null = null;
  let menor: { dia: string; saldo: number } | null = null;
  for (let i = 0; i <= dias; i++) {
    const dia = somarDias(de, i);
    const e = entra.get(dia) ?? 0;
    const s = sai.get(dia) ?? 0;
    const ep = entraPrev.get(dia) ?? 0;
    const sp = saiPrev.get(dia) ?? 0;
    saldo += e - s + ep - sp;
    if (dia >= hoje && saldo < 0 && !primeiroNegativo) primeiroNegativo = { dia, saldo: r(saldo) };
    if (dia >= hoje && (!menor || saldo < menor.saldo)) menor = { dia, saldo };
    const k = chaveDoPeriodo(dia, params.agrupar);
    const per = periodos.get(k) ?? { inicio: dia, fim: dia, entradas: 0, saidas: 0, entradas_previstas: 0, saidas_previstas: 0, saldo: 0, menor_saldo: saldo };
    per.fim = dia;
    per.entradas += e;
    per.saidas += s;
    per.entradas_previstas += ep;
    per.saidas_previstas += sp;
    per.saldo = saldo;
    per.menor_saldo = Math.min(per.menor_saldo, saldo);
    periodos.set(k, per);
  }

  return {
    de,
    ate,
    hoje,
    agrupar: params.agrupar,
    saldo_inicial: r(saldoInicial),
    saldo_final: r(saldo),
    // O menor saldo daqui para frente (no período): é o dia de mais aperto.
    menor_saldo: menor ? { dia: menor.dia, saldo: r(menor.saldo) } : null,
    primeiro_negativo: primeiroNegativo,
    atrasado_pagar: r(atrasadoPagar),
    atrasado_receber: r(atrasadoReceber),
    periodos: [...periodos.values()].map((p) => ({
      inicio: p.inicio,
      fim: p.fim,
      entradas: r(p.entradas),
      saidas: r(p.saidas),
      entradas_previstas: r(p.entradas_previstas),
      saidas_previstas: r(p.saidas_previstas),
      saldo: r(p.saldo),
      menor_saldo: r(p.menor_saldo),
    })),
  };
}

async function lerTudo(venueId: string) {
  const [contas, pagos, abertos, transf] = await Promise.all([
    cliente().from("fin_contas").select("id, nome, saldo_inicial, saldo_inicial_em, ativo").eq("venue_id", venueId),
    cliente().from("fin_lancamentos").select("tipo, conta_id, pago_em, valor_pago, valor").eq("venue_id", venueId).eq("situacao", "pago").limit(50_000),
    cliente().from("fin_lancamentos").select("tipo, conta_id, vencimento, valor").eq("venue_id", venueId).eq("situacao", "aberto").limit(50_000),
    cliente().from("fin_transferencias").select("de_conta_id, para_conta_id, valor, dia").eq("venue_id", venueId).limit(20_000),
  ]);
  for (const x of [contas, pagos, abertos, transf]) if (x.error) throw new ErroDoFinanceiro(500, `Falha ao montar o fluxo: ${x.error.message}`);
  return { contas: contas.data ?? [], pagos: pagos.data ?? [], abertos: abertos.data ?? [], transferencias: transf.data ?? [] };
}

export async function fluxoDeCaixa(params: { venueId: string; timezone: string; de?: string | null; ate?: string | null; agrupar?: string | null; contaId?: string | null }) {
  const hoje = hojeNaCasa(params.timezone);
  const de = ehData(params.de) ? params.de : somarDias(hoje, -7);
  const ate = ehData(params.ate) ? params.ate : somarDias(hoje, 60);
  if (ate < de) throw new ErroDoFinanceiro(400, "A data final vem antes da inicial.");
  if (diasEntre(de, ate) > 400) throw new ErroDoFinanceiro(400, "O período vai até 400 dias.");
  const agrupar: Agrupamento = params.agrupar === "semana" || params.agrupar === "mes" ? params.agrupar : "dia";
  const dados = await lerTudo(params.venueId);
  return {
    ...montarFluxo({ ...dados, de, ate, hoje, agrupar, contaId: params.contaId && /^[0-9a-f-]{36}$/i.test(params.contaId) ? params.contaId : null }),
    contas: dados.contas.filter((x: { ativo: boolean }) => x.ativo).map((x: { id: string; nome: string }) => ({ id: x.id, nome: x.nome })),
  };
}

// ============================================================
// Resultado do mês (competência) e painel
// ============================================================

export interface LancamentoDoResultado {
  tipo: "pagar" | "receber";
  categoria_id: string | null;
  valor: number;
  competencia: string;
}
export interface CategoriaDoResultado {
  id: string;
  nome: string;
  pai_id: string | null;
  grupo: Grupo;
  tipo: "receita" | "despesa";
}

const FIXOS: Grupo[] = ["pessoal", "ocupacao", "operacao", "administrativo", "marketing", "financeiro"];

/**
 * O resultado do mês, por competência: o que é DO mês, pago ou não. A conta
 * sem categoria cai em "Outros" (despesa) ou em Receitas (receita) — e o
 * painel avisa quanto está sem categoria, porque número sem categoria é
 * número que ninguém confere.
 *
 * `baseDeVendas` é o faturamento a usar nos percentuais quando a casa ainda
 * não lança as vendas no Financeiro (o da Zig/caixa, por exemplo).
 */
export function montarResultado(lancamentos: LancamentoDoResultado[], categorias: CategoriaDoResultado[], baseDeVendas = 0) {
  const porId = new Map(categorias.map((x) => [x.id, x]));
  const topo = (id: string | null) => {
    const cat = id ? porId.get(id) : undefined;
    if (!cat) return null;
    return cat.pai_id ? porId.get(cat.pai_id) ?? cat : cat;
  };
  const porGrupo = new Map<Grupo, number>();
  const porCategoria = new Map<string, { id: string; nome: string; grupo: Grupo; valor: number }>();
  let semCategoria = 0;
  let semCategoriaQtd = 0;
  for (const l of lancamentos) {
    const v = c(l.valor);
    const cat = l.categoria_id ? porId.get(l.categoria_id) : undefined;
    const pai = topo(l.categoria_id);
    const grupo: Grupo = cat?.grupo ?? (l.tipo === "receber" ? "receita" : "outros");
    // Receita lançada em categoria de despesa (ou o contrário) entra com o sinal certo.
    const sinal = (grupo === "receita") === (l.tipo === "receber") ? 1 : -1;
    porGrupo.set(grupo, (porGrupo.get(grupo) ?? 0) + sinal * v);
    if (!cat) {
      semCategoria += v;
      semCategoriaQtd++;
    }
    const chave = pai?.id ?? `sem-${grupo}`;
    const atual = porCategoria.get(chave) ?? { id: chave, nome: pai?.nome ?? "Sem categoria", grupo, valor: 0 };
    atual.valor += sinal * v;
    porCategoria.set(chave, atual);
  }
  const g = (id: Grupo) => porGrupo.get(id) ?? 0;
  const receita = g("receita");
  const base = receita > 0 ? receita : c(baseDeVendas);
  const pct = (v: number) => (base > 0 ? Math.round((v / base) * 1000) / 10 : null);
  const receitaLiquida = receita - g("deducao");
  const margemBruta = receitaLiquida - g("cmv");
  const operacionais = g("pessoal") + g("ocupacao") + g("operacao") + g("administrativo") + g("marketing");
  const resultadoOperacional = margemBruta - operacionais;
  const antesDosSocios = resultadoOperacional - g("financeiro") - g("outros");
  const resultadoFinal = antesDosSocios - g("investimento") - g("retirada");

  // Ponto de equilíbrio: o custo fixo dividido pela margem de contribuição
  // (o que sobra de cada real vendido depois do imposto, da taxa e do CMV).
  const variaveis = g("deducao") + g("cmv");
  const fixos = FIXOS.reduce((s, x) => s + g(x), 0);
  const margemContribuicao = base > 0 ? 1 - variaveis / base : null;
  const pontoDeEquilibrio = margemContribuicao && margemContribuicao > 0 ? Math.round(fixos / margemContribuicao) : null;

  return {
    base_dos_percentuais: receita > 0 ? "receita" : base > 0 ? "vendas" : null,
    receita: r(receita),
    deducoes: r(g("deducao")),
    receita_liquida: r(receitaLiquida),
    cmv: r(g("cmv")),
    margem_bruta: r(margemBruta),
    linhas: GRUPOS.filter((x) => x.id !== "receita").map((x) => ({ grupo: x.id, nome: x.nome, valor: r(g(x.id)), pct: pct(g(x.id)) })),
    resultado_operacional: r(resultadoOperacional),
    resultado_final: r(resultadoFinal),
    pct: {
      cmv: pct(g("cmv")),
      pessoal: pct(g("pessoal")),
      prime_cost: pct(g("cmv") + g("pessoal")),
      ocupacao: pct(g("ocupacao")),
      resultado_operacional: pct(resultadoOperacional),
      resultado_final: pct(resultadoFinal),
    },
    custos_fixos: r(fixos),
    margem_de_contribuicao: margemContribuicao === null ? null : Math.round(margemContribuicao * 1000) / 10,
    ponto_de_equilibrio: pontoDeEquilibrio === null ? null : r(pontoDeEquilibrio),
    sem_categoria: { valor: r(semCategoria), quantidade: semCategoriaQtd },
    categorias: [...porCategoria.values()]
      .map((x) => ({ ...x, valor: r(x.valor), pct: pct(x.valor) }))
      .sort((a, b) => b.valor - a.valor),
  };
}

/** Quanto vence (e quanto já atrasou) daqui até N dias. */
export function aVencer(abertos: Aberto[], hoje: string) {
  const em = (dias: number) => somarDias(hoje, dias);
  const soma = (tipo: "pagar" | "receber", f: (a: Aberto) => boolean) => r(abertos.filter((a) => a.tipo === tipo && f(a)).reduce((s, a) => s + c(a.valor), 0));
  const bloco = (tipo: "pagar" | "receber") => ({
    atrasado: soma(tipo, (a) => a.vencimento < hoje),
    hoje: soma(tipo, (a) => a.vencimento === hoje),
    proximos_7: soma(tipo, (a) => a.vencimento > hoje && a.vencimento <= em(7)),
    proximos_30: soma(tipo, (a) => a.vencimento > hoje && a.vencimento <= em(30)),
  });
  return { pagar: bloco("pagar"), receber: bloco("receber") };
}

export async function painelFinanceiro(params: { venueId: string; timezone: string; mes?: string | null }) {
  const hoje = hojeNaCasa(params.timezone);
  const mes = typeof params.mes === "string" && /^\d{4}-\d{2}$/.test(params.mes) ? `${params.mes}-01` : `${hoje.slice(0, 7)}-01`;
  const fim = fimDoMes(mes);
  const seisMeses = somarMeses(mes, -5);

  const [cats, competencia, caixa, fatur, dados] = await Promise.all([
    cliente().from("fin_categorias").select("id, nome, pai_id, grupo, tipo").eq("venue_id", params.venueId),
    cliente().from("fin_lancamentos").select("tipo, categoria_id, valor, competencia").eq("venue_id", params.venueId).neq("situacao", "cancelado").gte("competencia", seisMeses).lte("competencia", fim).limit(50_000),
    cliente().from("fin_lancamentos").select("tipo, valor_pago, valor").eq("venue_id", params.venueId).eq("situacao", "pago").gte("pago_em", mes).lte("pago_em", fim).limit(50_000),
    cliente().from("faturamento_diario").select("data_referencia, valor").eq("venue_id", params.venueId).gte("data_referencia", seisMeses).lte("data_referencia", fim).limit(5_000),
    lerTudo(params.venueId),
  ]);
  for (const x of [cats, competencia, caixa]) if (x.error) throw new ErroDoFinanceiro(500, `Falha ao montar o painel: ${x.error.message}`);
  const categorias = (cats.data ?? []) as CategoriaDoResultado[];
  const lanc = (competencia.data ?? []) as LancamentoDoResultado[];
  // O faturamento do estoque (Zig ou digitado) é opcional: casa sem o
  // Custos e estoque simplesmente não tem.
  const vendasPorMes = new Map<string, number>();
  for (const f of (fatur.error ? [] : fatur.data ?? []) as { data_referencia: string; valor: number }[]) {
    const k = `${f.data_referencia.slice(0, 7)}-01`;
    vendasPorMes.set(k, (vendasPorMes.get(k) ?? 0) + c(f.valor));
  }

  const doMes = (m: string) => lanc.filter((l) => l.competencia >= m && l.competencia <= fimDoMes(m));
  const resultado = montarResultado(doMes(mes), categorias, r(vendasPorMes.get(mes) ?? 0));
  const meses = Array.from({ length: 6 }, (_, i) => somarMeses(seisMeses, i)).map((m) => {
    const x = montarResultado(doMes(m), categorias, r(vendasPorMes.get(m) ?? 0));
    const despesas = x.linhas.reduce((s, l) => s + c(l.valor), 0);
    return { mes: m, receita: x.receita, vendas: r(vendasPorMes.get(m) ?? 0), despesas: r(despesas), resultado: x.resultado_final, prime_cost: x.pct.prime_cost };
  });

  const caixaDoMes = { entradas: 0, saidas: 0 };
  for (const l of (caixa.data ?? []) as { tipo: string; valor_pago: number | null; valor: number }[]) {
    caixaDoMes[l.tipo === "receber" ? "entradas" : "saidas"] += c(l.valor_pago ?? l.valor);
  }

  const fluxo = montarFluxo({ ...dados, de: hoje, ate: somarDias(hoje, 30), hoje, agrupar: "dia" });
  const diasNoMes = Number(fim.slice(8, 10));
  return {
    mes,
    hoje,
    // O que já foi pago e recebido hoje conta no saldo de hoje.
    saldo_hoje: r(c(fluxo.saldo_inicial) + c(fluxo.periodos[0]?.entradas) - c(fluxo.periodos[0]?.saidas)),
    saldo_em_30_dias: fluxo.saldo_final,
    menor_saldo_30_dias: fluxo.menor_saldo,
    primeiro_negativo: fluxo.primeiro_negativo,
    a_vencer: aVencer(dados.abertos, hoje),
    resultado,
    vendas_do_mes: r(vendasPorMes.get(mes) ?? 0),
    ponto_de_equilibrio_por_dia: resultado.ponto_de_equilibrio === null ? null : Math.round((resultado.ponto_de_equilibrio / diasNoMes) * 100) / 100,
    caixa_do_mes: { entradas: r(caixaDoMes.entradas), saidas: r(caixaDoMes.saidas), saldo: r(caixaDoMes.entradas - caixaDoMes.saidas) },
    meses,
  };
}
