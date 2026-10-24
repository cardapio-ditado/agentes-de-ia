import { db, ehMigracaoPendente } from "./supabase.js";
import { ErroDoRh } from "./rh.js";
import { listarGorjetas, listarPesos, ratear, type Participante } from "./rhGorjeta.js";
import { resumoDoDia } from "./rhPonto.js";

/**
 * RH — o acerto da gorjeta, semana a semana.
 *
 * Bar não paga gorjeta de um jeito só, e essa era a confusão: a tela pedia o
 * bolo do turno mesmo na casa que paga comissão sobre a venda de cada um.
 * Agora a casa escolhe o método UMA VEZ, em Regras, e a tela inteira passa a
 * falar a língua dela.
 *
 *   INDIVIDUAL — cada um recebe um percentual sobre o que ELE vendeu.
 *                É a comissão de garçom. A conta de cada um se explica
 *                sozinha: vendi tanto, levo tanto.
 *
 *   GLOBAL     — a casa arrecada sobre a venda inteira e reparte entre a
 *                equipe, por um critério: igual, por peso da função (a
 *                pontuação da casa) ou pelas horas trabalhadas.
 *
 * Nos dois casos vale a mesma régua: nem tudo que é arrecadado é repassado.
 * A diferença cobre taxa de cartão e quebra, e aparece na tela — porque
 * "cadê o resto?" é a pergunta que azeda equipe.
 *
 * A unidade é a SEMANA porque é assim que bar acerta gorjeta. Os lançamentos
 * continuam sendo por dia e turno; a semana só soma.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

function falhar(status: number, contexto: string, mensagem: string): never {
  if (ehMigracaoPendente(mensagem)) {
    throw new ErroDoRh(
      503,
      `${contexto}: o banco ainda não recebeu a migração do acerto da gorjeta. Rode o SQL e tente de novo.`,
    );
  }
  throw new ErroDoRh(status, `${contexto}: ${mensagem}`);
}

export const METODOS = [
  { id: "individual", nome: "Comissão individual", explicacao: "Cada um recebe um percentual sobre o que ele mesmo vendeu." },
  { id: "global", nome: "Bolo da casa", explicacao: "O serviço da casa inteira é repartido entre a equipe pelo critério escolhido." },
] as const;

export const CRITERIOS_DE_RATEIO = [
  { id: "igual", nome: "Igual para todos" },
  { id: "peso", nome: "Por peso da função (pontuação)" },
  { id: "horas", nome: "Pelas horas trabalhadas" },
] as const;

const IDS_DE_METODO = new Set<string>(METODOS.map((m) => m.id));
const IDS_DE_CRITERIO = new Set<string>(CRITERIOS_DE_RATEIO.map((c) => c.id));

// ============================================================
// Semana ISO
// ============================================================

function comoData(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? ""))) {
    throw new ErroDoRh(400, `Data inválida: "${iso}".`);
  }
  return new Date(`${iso}T12:00:00Z`);
}

const emIso = (d: Date) => d.toISOString().slice(0, 10);

export function somarDias(iso: string, dias: number): string {
  const d = comoData(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return emIso(d);
}

/**
 * A semana ISO de um dia: começa na segunda e pertence ao ano da quinta.
 *
 * Parece preciosismo, mas é o que faz a virada de ano não gerar uma "semana
 * 53" fantasma que ninguém encontra depois.
 */
export function semanaDoDia(iso: string): { ano: number; numero: number } {
  const d = comoData(iso);
  // Domingo é 0 no JavaScript e 7 na ISO.
  const diaDaSemana = d.getUTCDay() || 7;
  // Anda até a quinta-feira da mesma semana: é ela que decide o ano.
  d.setUTCDate(d.getUTCDate() + 4 - diaDaSemana);
  const ano = d.getUTCFullYear();
  const primeiroDeJaneiro = new Date(Date.UTC(ano, 0, 1, 12));
  const numero = Math.ceil(((d.getTime() - primeiroDeJaneiro.getTime()) / 86_400_000 + 1) / 7);
  return { ano, numero };
}

/** A segunda e o domingo de uma semana ISO. */
export function bordasDaSemana(ano: number, numero: number): { inicio: string; fim: string } {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroDoRh(400, "Ano inválido.");
  if (!Number.isInteger(numero) || numero < 1 || numero > 53) throw new ErroDoRh(400, "Semana inválida.");
  // A semana 1 é a que contém o dia 4 de janeiro — definição da ISO 8601.
  const quatroDeJaneiro = new Date(Date.UTC(ano, 0, 4, 12));
  const diaDaSemana = quatroDeJaneiro.getUTCDay() || 7;
  const segundaDaSemana1 = new Date(quatroDeJaneiro);
  segundaDaSemana1.setUTCDate(quatroDeJaneiro.getUTCDate() - diaDaSemana + 1);
  const inicio = new Date(segundaDaSemana1);
  inicio.setUTCDate(segundaDaSemana1.getUTCDate() + (numero - 1) * 7);
  return { inicio: emIso(inicio), fim: somarDias(emIso(inicio), 6) };
}

/** A semana seguinte ou anterior, sem o gestor precisar saber que 52 vira 1. */
export function semanaVizinha(ano: number, numero: number, passo: number): { ano: number; numero: number } {
  const { inicio } = bordasDaSemana(ano, numero);
  return semanaDoDia(somarDias(inicio, passo * 7));
}

// ============================================================
// A regra da casa
// ============================================================

/**
 * Uma faixa de meta: vendeu `a_partir_de` ou mais NA SEMANA, ganha `bonus`
 * pontos percentuais a mais sobre a venda.
 */
export interface FaixaDeMeta {
  a_partir_de: number;
  bonus: number;
}

export interface RegraDaCasa {
  metodo: "individual" | "global";
  percentual_servico: number;
  percentual_repasse: number;
  criterio_rateio: "igual" | "peso" | "horas";
  /** Fatia do repasse separada para quem não vende. Zero desliga. */
  percentual_da_casa_para_apoio: number;
  /**
   * As metas semanais, da menor para a maior. Vale a MAIOR faixa atingida —
   * as faixas não se somam: quem passa de R$ 15 mil não leva o bônus de
   * R$ 10 mil mais o de R$ 15 mil.
   */
  metas: FaixaDeMeta[];
  /**
   * Sobre o que o bônus incide. "tudo": a venda inteira da semana (o mais
   * comum, e o mais fácil de explicar). "excedente": só o que passou da
   * faixa atingida.
   */
  meta_sobre: "tudo" | "excedente";
  /** Falso enquanto a casa não escolheu: a tela pede a escolha antes de tudo. */
  configurada: boolean;
}

const REGRA_PADRAO: RegraDaCasa = {
  metodo: "individual",
  percentual_servico: 10,
  percentual_repasse: 100,
  criterio_rateio: "igual",
  percentual_da_casa_para_apoio: 0,
  metas: [],
  meta_sobre: "tudo",
  configurada: false,
};

const COLUNAS_DA_REGRA =
  "metodo, percentual_servico, percentual_repasse, criterio_rateio, percentual_da_casa_para_apoio, metas, meta_sobre";

/** Faixas válidas, em ordem, sem limiar repetido. O que vier torto é recusado. */
export function lerMetas(valor: unknown): FaixaDeMeta[] {
  if (valor === undefined || valor === null || valor === "") return [];
  if (!Array.isArray(valor)) throw new ErroDoRh(400, "As metas precisam vir numa lista.");
  if (valor.length > 10) throw new ErroDoRh(400, "No máximo 10 faixas de meta.");
  const faixas = valor.map((f) => {
    const linha = (f ?? {}) as Record<string, unknown>;
    const aPartirDe = Number(linha.a_partir_de);
    const bonus = Number(linha.bonus);
    if (!Number.isFinite(aPartirDe) || aPartirDe <= 0) {
      throw new ErroDoRh(400, "Cada meta precisa de um valor de venda maior que zero.");
    }
    if (!Number.isFinite(bonus) || bonus <= 0 || bonus > 100) {
      throw new ErroDoRh(400, "O bônus de cada meta precisa ficar entre 0 e 100%.");
    }
    return { a_partir_de: Math.round(aPartirDe * 100) / 100, bonus: Math.round(bonus * 100) / 100 };
  });
  faixas.sort((a, b) => a.a_partir_de - b.a_partir_de);
  for (let i = 1; i < faixas.length; i++) {
    if (faixas[i]!.a_partir_de === faixas[i - 1]!.a_partir_de) {
      throw new ErroDoRh(400, "Duas metas com o mesmo valor de venda. Deixe uma só.");
    }
  }
  return faixas;
}

export interface ResultadoDaMeta {
  /** O dinheiro a mais, em reais. */
  bonus: number;
  /** A faixa atingida (null = nenhuma). */
  faixa: FaixaDeMeta | null;
  /** A próxima faixa e quanto falta vender para chegar nela. */
  proxima: (FaixaDeMeta & { falta: number }) | null;
}

/** O bônus de meta de uma pessoa, pela venda da semana. Pura. */
export function bonusDaMeta(venda: number, metas: FaixaDeMeta[], sobre: RegraDaCasa["meta_sobre"]): ResultadoDaMeta {
  const ordenadas = [...metas].sort((a, b) => a.a_partir_de - b.a_partir_de);
  const atingidas = ordenadas.filter((f) => venda >= f.a_partir_de);
  const faixa = atingidas[atingidas.length - 1] ?? null;
  const seguinte = ordenadas.find((f) => venda < f.a_partir_de) ?? null;
  const base = !faixa ? 0 : sobre === "excedente" ? venda - faixa.a_partir_de : venda;
  return {
    bonus: faixa ? reais(Math.round(centavos(base) * (faixa.bonus / 100))) : 0,
    faixa,
    proxima: seguinte ? { ...seguinte, falta: reais(centavos(seguinte.a_partir_de) - centavos(venda)) } : null,
  };
}

export async function verRegra(venueId: string): Promise<RegraDaCasa> {
  const { data, error } = await cliente()
    .from("rh_gorjeta_regras")
    .select(COLUNAS_DA_REGRA)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) falhar(500, "Falha ao ler a regra da gorjeta", error.message);
  if (!data) return { ...REGRA_PADRAO };

  const linha = data as Record<string, unknown>;
  return {
    metodo: String(linha.metodo) as RegraDaCasa["metodo"],
    percentual_servico: Number(linha.percentual_servico),
    percentual_repasse: Number(linha.percentual_repasse),
    criterio_rateio: String(linha.criterio_rateio) as RegraDaCasa["criterio_rateio"],
    percentual_da_casa_para_apoio: Number(linha.percentual_da_casa_para_apoio),
    metas: Array.isArray(linha.metas) ? (linha.metas as FaixaDeMeta[]) : [],
    meta_sobre: linha.meta_sobre === "excedente" ? "excedente" : "tudo",
    configurada: true,
  };
}

function percentual(valor: unknown, rotulo: string, padrao: number): number {
  if (valor === undefined || valor === null || valor === "") return padrao;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new ErroDoRh(400, `${rotulo} precisa ser um número entre 0 e 100.`);
  }
  return n;
}

export async function salvarRegra(params: {
  venueId: string;
  metodo?: unknown;
  percentualServico?: unknown;
  percentualRepasse?: unknown;
  criterioRateio?: unknown;
  percentualParaApoio?: unknown;
  metas?: unknown;
  metaSobre?: unknown;
  quem: string;
}): Promise<RegraDaCasa> {
  const atual = await verRegra(params.venueId);

  const metodo = params.metodo === undefined || params.metodo === null || params.metodo === ""
    ? atual.metodo
    : String(params.metodo);
  if (!IDS_DE_METODO.has(metodo)) {
    throw new ErroDoRh(400, "Escolha como a casa paga a gorjeta: comissão individual ou bolo da casa.");
  }

  const criterio = params.criterioRateio === undefined || params.criterioRateio === null || params.criterioRateio === ""
    ? atual.criterio_rateio
    : String(params.criterioRateio);
  if (!IDS_DE_CRITERIO.has(criterio)) throw new ErroDoRh(400, "Critério de rateio desconhecido.");

  // Sem `metas` no corpo, as que já existiam ficam: salvar o percentual não
  // pode apagar a meta que ninguém mexeu.
  const metas = params.metas === undefined ? atual.metas : lerMetas(params.metas);
  const metaSobre = params.metaSobre === undefined ? atual.meta_sobre : params.metaSobre === "excedente" ? "excedente" : "tudo";

  const linha = {
    venue_id: params.venueId,
    metodo,
    percentual_servico: percentual(params.percentualServico, "O percentual de serviço", atual.percentual_servico),
    percentual_repasse: percentual(params.percentualRepasse, "O percentual repassado", atual.percentual_repasse),
    criterio_rateio: criterio,
    percentual_da_casa_para_apoio: percentual(
      params.percentualParaApoio,
      "O percentual separado para o apoio",
      atual.percentual_da_casa_para_apoio,
    ),
    metas,
    meta_sobre: metaSobre,
    atualizado_em: new Date().toISOString(),
    atualizado_por: params.quem,
  };

  const { error } = await cliente()
    .from("rh_gorjeta_regras")
    .upsert(linha as never, { onConflict: "venue_id" });
  if (error) falhar(500, "Falha ao salvar a regra da gorjeta", error.message);

  return {
    metodo: metodo as RegraDaCasa["metodo"],
    percentual_servico: linha.percentual_servico,
    percentual_repasse: linha.percentual_repasse,
    criterio_rateio: criterio as RegraDaCasa["criterio_rateio"],
    percentual_da_casa_para_apoio: linha.percentual_da_casa_para_apoio,
    metas,
    meta_sobre: metaSobre,
    configurada: true,
  };
}

// ============================================================
// A venda de cada pessoa
// ============================================================

export interface VendaGravada {
  id: string;
  dia: string;
  turno_id: string | null;
  atendente_id: string;
  valor: number;
  comandas: number;
  observacao: string | null;
}

const COLUNAS_DA_VENDA = "id, dia, turno_id, atendente_id, valor, comandas, observacao";

function emVenda(linha: Record<string, unknown>): VendaGravada {
  return {
    id: String(linha.id),
    dia: String(linha.dia),
    turno_id: (linha.turno_id as string | null) ?? null,
    atendente_id: String(linha.atendente_id),
    valor: Number(linha.valor),
    comandas: Number(linha.comandas) || 0,
    observacao: (linha.observacao as string | null) ?? null,
  };
}

export async function lancarVenda(params: {
  venueId: string;
  dia: string;
  turnoId?: string | null;
  atendenteId: string;
  valor: unknown;
  comandas?: unknown;
  observacao?: unknown;
  quem: string;
}): Promise<VendaGravada> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(params.dia))) throw new ErroDoRh(400, "Data inválida.");
  const valor = Number(params.valor);
  if (!Number.isFinite(valor) || valor < 0) throw new ErroDoRh(400, "Informe quanto a pessoa vendeu.");
  const comandas = Math.max(0, Math.floor(Number(params.comandas) || 0));

  const { data, error } = await cliente()
    .from("rh_vendas")
    .upsert(
      {
        venue_id: params.venueId,
        dia: params.dia,
        turno_id: params.turnoId ?? null,
        atendente_id: params.atendenteId,
        valor,
        comandas,
        observacao: String(params.observacao ?? "").trim() || null,
        criado_por: params.quem,
      } as never,
      { onConflict: "venue_id,dia,turno_id,atendente_id" },
    )
    .select(COLUNAS_DA_VENDA)
    .single();
  if (error) falhar(500, "Falha ao lançar a venda", error.message);
  return emVenda(data as Record<string, unknown>);
}

export async function apagarVenda(params: { venueId: string; id: string }): Promise<{ apagado: boolean }> {
  const { error } = await cliente().from("rh_vendas").delete().eq("venue_id", params.venueId).eq("id", params.id);
  if (error) falhar(500, "Falha ao apagar a venda", error.message);
  return { apagado: true };
}

// ============================================================
// Adicionais e descontos
// ============================================================

export interface ExtraGravado {
  id: string;
  dia: string;
  atendente_id: string;
  tipo: "adicional" | "desconto";
  descricao: string | null;
  valor: number;
}

const COLUNAS_DO_EXTRA = "id, dia, atendente_id, tipo, descricao, valor";

export async function lancarExtra(params: {
  venueId: string;
  dia: string;
  atendenteId: string;
  tipo: string;
  descricao?: unknown;
  valor: unknown;
  quem: string;
}): Promise<ExtraGravado> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(params.dia))) throw new ErroDoRh(400, "Data inválida.");
  if (params.tipo !== "adicional" && params.tipo !== "desconto") {
    throw new ErroDoRh(400, "Um lançamento avulso é adicional ou desconto.");
  }
  const valor = Number(params.valor);
  if (!Number.isFinite(valor) || valor <= 0) throw new ErroDoRh(400, "Informe um valor maior que zero.");

  const { data, error } = await cliente()
    .from("rh_gorjeta_extras")
    .insert({
      venue_id: params.venueId,
      dia: params.dia,
      atendente_id: params.atendenteId,
      tipo: params.tipo,
      descricao: String(params.descricao ?? "").trim() || null,
      valor,
      criado_por: params.quem,
    } as never)
    .select(COLUNAS_DO_EXTRA)
    .single();
  if (error) falhar(500, "Falha ao lançar o adicional", error.message);

  const linha = data as Record<string, unknown>;
  return {
    id: String(linha.id),
    dia: String(linha.dia),
    atendente_id: String(linha.atendente_id),
    tipo: linha.tipo as ExtraGravado["tipo"],
    descricao: (linha.descricao as string | null) ?? null,
    valor: Number(linha.valor),
  };
}

export async function apagarExtra(params: { venueId: string; id: string }): Promise<{ apagado: boolean }> {
  const { error } = await cliente()
    .from("rh_gorjeta_extras")
    .delete()
    .eq("venue_id", params.venueId)
    .eq("id", params.id);
  if (error) falhar(500, "Falha ao apagar o lançamento", error.message);
  return { apagado: true };
}

// ============================================================
// A conta da semana — pura, sem banco
// ============================================================

export interface LinhaDoAcerto {
  atendente_id: string;
  nome: string;
  funcao: string | null;
  peso: number;
  minutos: number;
  vendas: number;
  comandas: number;
  /** O que veio do percentual sobre a venda própria (método individual). */
  comissao: number;
  /** O que veio do bolo repartido (método global, ou a fatia do apoio). */
  rateio: number;
  /** O a mais da meta semanal. Sai do caixa da casa, não da gorjeta. */
  bonus_meta: number;
  /** O bônus (em %) da faixa atingida, ou null. */
  meta_atingida: number | null;
  /** A próxima faixa e quanto falta — o que motiva no meio da semana. */
  meta_proxima: (FaixaDeMeta & { falta: number }) | null;
  adicionais: number;
  descontos: number;
  a_receber: number;
}

export interface TotaisDoAcerto {
  vendas: number;
  arrecadado: number;
  repassado: number;
  retido: number;
  comissoes: number;
  rateio: number;
  bonus_meta: number;
  adicionais: number;
  descontos: number;
  a_receber: number;
}

const centavos = (n: number) => Math.round(n * 100);
const reais = (c: number) => c / 100;

/**
 * A conta da semana inteira, para as duas famílias de pagamento.
 *
 * A ordem importa, e é sempre a mesma:
 *
 *   1. venda da semana  ×  % de serviço   =  ARRECADADO
 *   2. arrecadado       ×  % de repasse   =  REPASSADO (é isto que se divide)
 *   3. repassado        ×  % do apoio     =  a fatia de quem não vende
 *   4. o que sobra vai para quem vendeu, na proporção da venda de cada um
 *
 * No método global os passos 3 e 4 somem: o repassado inteiro se divide pelo
 * critério da casa. E as cotas já lançadas por turno mandam sobre a conta —
 * o que foi pago, foi pago, mesmo que o percentual mude depois.
 */
export function montarAcerto(params: {
  regra: RegraDaCasa;
  pessoas: Participante[];
  /** Venda da semana de cada pessoa. */
  vendas: Map<string, { valor: number; comandas: number }>;
  /** Cotas já rateadas nos fechamentos de turno da semana (método global). */
  cotas: Map<string, number>;
  extras: Array<{ atendente_id: string; tipo: string; valor: number }>;
}): { linhas: LinhaDoAcerto[]; totais: TotaisDoAcerto } {
  const { regra } = params;

  const comVenda = params.pessoas.map((p) => ({
    ...p,
    venda: params.vendas.get(p.atendente_id)?.valor ?? 0,
    comandas: params.vendas.get(p.atendente_id)?.comandas ?? 0,
  }));

  const vendaTotal = comVenda.reduce((s, p) => s + p.venda, 0);
  const arrecadado = reais(Math.round(centavos(vendaTotal) * (regra.percentual_servico / 100)));
  const repassado = reais(Math.round(centavos(arrecadado) * (regra.percentual_repasse / 100)));

  const comissaoDe = new Map<string, number>();
  const rateioDe = new Map<string, number>();

  if (regra.metodo === "individual") {
    const paraApoio = reais(Math.round(centavos(repassado) * (regra.percentual_da_casa_para_apoio / 100)));
    const paraVendedores = reais(centavos(repassado) - centavos(paraApoio));

    const vendedores = comVenda.filter((p) => p.venda > 0);
    for (const c of ratear({ valor: paraVendedores, criterio: "venda", participantes: vendedores })) {
      comissaoDe.set(c.atendente_id, c.valor);
    }

    // Quem não vendeu só entra se a casa separou uma fatia para o apoio.
    const apoio = comVenda.filter((p) => p.venda <= 0);
    if (paraApoio > 0 && apoio.length > 0) {
      for (const c of ratear({ valor: paraApoio, criterio: regra.criterio_rateio, participantes: apoio })) {
        rateioDe.set(c.atendente_id, c.valor);
      }
    }
  }

  // As cotas dos fechamentos de turno entram nos DOIS métodos: a casa que
  // paga por comissão ainda pode ter rateado o serviço de um evento fechado,
  // e esse dinheiro já saiu.
  for (const [id, valor] of params.cotas) {
    rateioDe.set(id, (rateioDe.get(id) ?? 0) + valor);
  }

  const somaExtras = (id: string, tipo: string) =>
    params.extras.filter((e) => e.atendente_id === id && e.tipo === tipo).reduce((s, e) => s + e.valor, 0);

  const linhas: LinhaDoAcerto[] = comVenda.map((p) => {
    const comissao = comissaoDe.get(p.atendente_id) ?? 0;
    const rateio = rateioDe.get(p.atendente_id) ?? 0;
    const adicionais = somaExtras(p.atendente_id, "adicional");
    const descontos = somaExtras(p.atendente_id, "desconto");
    // A meta é da SEMANA: a venda somada de segunda a domingo, e não a de
    // um dia bom. Quem não vendeu nada não tem meta a bater.
    const meta = p.venda > 0 && regra.metas.length
      ? bonusDaMeta(p.venda, regra.metas, regra.meta_sobre)
      : { bonus: 0, faixa: null, proxima: null };
    return {
      atendente_id: p.atendente_id,
      nome: p.nome,
      funcao: p.funcao,
      peso: p.peso,
      minutos: p.minutos,
      vendas: p.venda,
      comandas: p.comandas,
      comissao,
      rateio,
      bonus_meta: meta.bonus,
      meta_atingida: meta.faixa?.bonus ?? null,
      meta_proxima: meta.proxima,
      adicionais,
      descontos,
      // Nunca negativo: consumo maior que a gorjeta da semana é conversa de
      // desconto em folha, não gorjeta a pagar com sinal trocado.
      a_receber: Math.max(
        0,
        reais(centavos(comissao) + centavos(rateio) + centavos(meta.bonus) + centavos(adicionais) - centavos(descontos)),
      ),
    };
  });

  linhas.sort((a, b) => b.a_receber - a.a_receber || a.nome.localeCompare(b.nome, "pt-BR"));

  const soma = (campo: keyof LinhaDoAcerto) =>
    reais(linhas.reduce((s, l) => s + centavos(Number(l[campo])), 0));

  return {
    linhas,
    totais: {
      vendas: soma("vendas"),
      arrecadado,
      repassado,
      retido: reais(centavos(arrecadado) - centavos(repassado)),
      comissoes: soma("comissao"),
      rateio: soma("rateio"),
      bonus_meta: soma("bonus_meta"),
      adicionais: soma("adicionais"),
      descontos: soma("descontos"),
      a_receber: soma("a_receber"),
    },
  };
}

// ============================================================
// Leitura da semana
// ============================================================

/**
 * Quem entra no acerto da semana.
 *
 * Sai da escala (quem estava previsto) somada a quem bateu ponto — porque em
 * bar entra gente de última hora. A casa que ainda não usa escala nem ponto
 * cai na equipe ativa inteira, senão a tela abriria vazia e pareceria
 * quebrada.
 */
async function quemTrabalhou(params: {
  venueId: string;
  de: string;
  ate: string;
  timezone: string;
}): Promise<Participante[]> {
  const [{ data: pessoas, error }, { data: escala }, { data: pontos }, pesos] = await Promise.all([
    cliente()
      .from("pesquisa_atendentes")
      .select("id, nome, apelido, funcao")
      .eq("venue_id", params.venueId)
      .eq("ativo", true)
      .order("nome", { ascending: true }),
    cliente()
      .from("rh_escala")
      .select("atendente_id, situacao, funcao")
      .eq("venue_id", params.venueId)
      .gte("data", params.de)
      .lte("data", params.ate),
    cliente()
      .from("rh_pontos")
      .select("atendente_id, tipo, momento")
      .eq("venue_id", params.venueId)
      .gte("dia", params.de)
      .lte("dia", params.ate)
      .order("momento", { ascending: true }),
    listarPesos(params.venueId),
  ]);
  if (error) falhar(500, "Falha ao listar a equipe", error.message);

  const pesoDa = new Map(pesos.map((p) => [p.funcao.toLowerCase(), p.peso]));

  const escalados = new Set<string>(
    ((escala ?? []) as Array<{ atendente_id: string; situacao: string }>)
      .filter((e) => e.situacao === "trabalha")
      .map((e) => e.atendente_id),
  );

  const batidasDe = new Map<string, Array<{ tipo: string; momento: string }>>();
  for (const b of (pontos ?? []) as Array<{ atendente_id: string; tipo: string; momento: string }>) {
    const lista = batidasDe.get(b.atendente_id) ?? [];
    lista.push({ tipo: b.tipo, momento: b.momento });
    batidasDe.set(b.atendente_id, lista);
  }

  const equipe = (pessoas ?? []) as Array<{ id: string; nome: string; apelido: string | null; funcao: string | null }>;
  const houveMovimento = escalados.size > 0 || batidasDe.size > 0;

  return equipe
    .filter((p) => !houveMovimento || escalados.has(p.id) || batidasDe.has(p.id))
    .map((p) => ({
      atendente_id: p.id,
      nome: p.apelido || p.nome,
      funcao: p.funcao,
      peso: p.funcao ? (pesoDa.get(p.funcao.toLowerCase()) ?? 1) : 1,
      minutos: (batidasDe.get(p.id) ?? []).length
        ? resumoDoDia(batidasDe.get(p.id)!, params.timezone).minutos_trabalhados
        : 0,
    }));
}

export async function acertoDaSemana(params: {
  venueId: string;
  ano: number;
  semana: number;
  timezone: string;
}): Promise<{
  ano: number;
  semana: number;
  inicio: string;
  fim: string;
  regra: RegraDaCasa;
  linhas: LinhaDoAcerto[];
  totais: TotaisDoAcerto;
  vendas: VendaGravada[];
  extras: ExtraGravado[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fechamentos: any[];
}> {
  const { inicio, fim } = bordasDaSemana(params.ano, params.semana);

  const [regra, pessoas, { data: vendas, error }, { data: extras }, fechamentos] = await Promise.all([
    verRegra(params.venueId),
    quemTrabalhou({ venueId: params.venueId, de: inicio, ate: fim, timezone: params.timezone }),
    cliente()
      .from("rh_vendas")
      .select(COLUNAS_DA_VENDA)
      .eq("venue_id", params.venueId)
      .gte("dia", inicio)
      .lte("dia", fim)
      .order("dia", { ascending: true }),
    cliente()
      .from("rh_gorjeta_extras")
      .select(COLUNAS_DO_EXTRA)
      .eq("venue_id", params.venueId)
      .gte("dia", inicio)
      .lte("dia", fim)
      .order("dia", { ascending: true }),
    listarGorjetas({ venueId: params.venueId, de: inicio, ate: fim }),
  ]);
  if (error) falhar(500, "Falha ao ler as vendas da semana", error.message);

  const lista = ((vendas ?? []) as Array<Record<string, unknown>>).map(emVenda);
  const porPessoa = new Map<string, { valor: number; comandas: number }>();
  for (const v of lista) {
    const atual = porPessoa.get(v.atendente_id) ?? { valor: 0, comandas: 0 };
    porPessoa.set(v.atendente_id, { valor: atual.valor + v.valor, comandas: atual.comandas + v.comandas });
  }

  const cotas = new Map<string, number>();
  for (const g of fechamentos) {
    for (const c of g.cotas) cotas.set(c.atendente_id, (cotas.get(c.atendente_id) ?? 0) + c.valor);
  }

  const extrasDaSemana = ((extras ?? []) as Array<Record<string, unknown>>).map((e) => ({
    id: String(e.id),
    dia: String(e.dia),
    atendente_id: String(e.atendente_id),
    tipo: e.tipo as ExtraGravado["tipo"],
    descricao: (e.descricao as string | null) ?? null,
    valor: Number(e.valor),
  }));

  // Quem recebeu cota, vendeu ou tem um extra na semana entra no acerto mesmo
  // sem escala nem ponto: o dinheiro dele já existe.
  const dentro = new Set(pessoas.map((p) => p.atendente_id));
  const faltantes = [...new Set([...porPessoa.keys(), ...cotas.keys(), ...extrasDaSemana.map((e) => e.atendente_id)])]
    .filter((id) => !dentro.has(id));
  if (faltantes.length > 0) {
    const { data: avulsos } = await cliente()
      .from("pesquisa_atendentes")
      .select("id, nome, apelido, funcao")
      .eq("venue_id", params.venueId)
      .in("id", faltantes);
    for (const p of (avulsos ?? []) as Array<{ id: string; nome: string; apelido: string | null; funcao: string | null }>) {
      pessoas.push({ atendente_id: p.id, nome: p.apelido || p.nome, funcao: p.funcao, peso: 1, minutos: 0 });
    }
  }

  const { linhas, totais } = montarAcerto({ regra, pessoas, vendas: porPessoa, cotas, extras: extrasDaSemana });

  return { ano: params.ano, semana: params.semana, inicio, fim, regra, linhas, totais, vendas: lista, extras: extrasDaSemana, fechamentos };
}
