import { randomUUID } from "node:crypto";
import { db, ehMigracaoPendente } from "./supabase.js";
import { hojeNaCasa } from "./fuso.js";

/**
 * Financeiro — Rodada 1: cadastros e contas a pagar e a receber.
 *
 * Feito para a casa que não tem sistema financeiro: o boleto na gaveta, o
 * caderno do caixa e o "vê aí no app do banco". Cada conta vira uma linha
 * com vencimento; a compra parcelada vira parcelas com a data que a casa
 * quiser (não "todo dia 10" à força — o fornecedor que dá 28/56/84 dias
 * cabe do mesmo jeito); e a baixa diz de qual banco o dinheiro saiu.
 *
 * O plano de contas já nasce com o desenho de restaurante (CMV, pessoal,
 * ocupação…), porque é esse o desenho do resultado do mês que a mentoria
 * cobra. A casa renomeia, cria subcategoria e arquiva o que não usa.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

export class ErroDoFinanceiro extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDoFinanceiro";
  }
}

function falhar(contexto: string, mensagem: string): never {
  if (ehMigracaoPendente(mensagem)) {
    throw new ErroDoFinanceiro(503, `${contexto}: o banco ainda não recebeu a migração do Financeiro. Rode o SQL e tente de novo.`);
  }
  throw new ErroDoFinanceiro(500, `${contexto}: ${mensagem}`);
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const ehData = (v: unknown): v is string => typeof v === "string" && DATA.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const texto = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max) || null;
const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) => Math.round(c) / 100;
const idOuNulo = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/** "1.234,56", "1234.56" e 1234.56 viram 1234.56. */
export function lerValor(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  const s = String(v ?? "").trim().replace(/[R$\s]/g, "");
  if (!s) return NaN;
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

const DIA_MS = 86_400_000;
export const somarDias = (iso: string, dias: number) =>
  new Date(new Date(`${iso}T12:00:00Z`).getTime() + dias * DIA_MS).toISOString().slice(0, 10);

/** Mesmo dia N meses depois; 31/01 + 1 mês = 28/02 (ou 29), e não 03/03. */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number) as [number, number, number];
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

// ============================================================
// O padrão de restaurante
// ============================================================

export type Grupo =
  | "receita" | "deducao" | "cmv" | "pessoal" | "ocupacao" | "operacao"
  | "administrativo" | "marketing" | "financeiro" | "investimento" | "retirada" | "outros";

/** A ordem é a do resultado do mês: o que entra, o que sai, o que sobra. */
export const GRUPOS: { id: Grupo; nome: string; tipo: "receita" | "despesa" }[] = [
  { id: "receita", nome: "Receitas", tipo: "receita" },
  { id: "deducao", nome: "Impostos e taxas sobre a venda", tipo: "despesa" },
  { id: "cmv", nome: "Custo da mercadoria (CMV)", tipo: "despesa" },
  { id: "pessoal", nome: "Pessoal", tipo: "despesa" },
  { id: "ocupacao", nome: "Ocupação", tipo: "despesa" },
  { id: "operacao", nome: "Operação", tipo: "despesa" },
  { id: "administrativo", nome: "Administrativo", tipo: "despesa" },
  { id: "marketing", nome: "Marketing", tipo: "despesa" },
  { id: "financeiro", nome: "Despesas financeiras", tipo: "despesa" },
  { id: "investimento", nome: "Investimentos", tipo: "despesa" },
  { id: "retirada", nome: "Retirada dos sócios", tipo: "despesa" },
  { id: "outros", nome: "Outros", tipo: "despesa" },
];
const GRUPO_VALIDO = new Set(GRUPOS.map((g) => g.id));

export const PLANO_PADRAO: { nome: string; tipo: "receita" | "despesa"; grupo: Grupo; subs: string[] }[] = [
  { nome: "Vendas", tipo: "receita", grupo: "receita", subs: ["Salão", "Delivery", "Eventos", "Couvert e entrada"] },
  { nome: "Outras receitas", tipo: "receita", grupo: "receita", subs: ["Rendimentos", "Patrocínio", "Outras"] },
  { nome: "Impostos sobre a venda", tipo: "despesa", grupo: "deducao", subs: ["Simples Nacional", "ICMS / ISS"] },
  { nome: "Taxas de venda", tipo: "despesa", grupo: "deducao", subs: ["Maquininha de cartão", "Aplicativos de delivery"] },
  { nome: "Mercadoria", tipo: "despesa", grupo: "cmv", subs: ["Alimentos", "Bebidas", "Descartáveis e embalagens"] },
  { nome: "Pessoal", tipo: "despesa", grupo: "pessoal", subs: ["Salários", "Extras e freelas", "Encargos (INSS, FGTS)", "Vale-transporte e alimentação", "Férias e 13º", "Rescisões", "Gorjeta repassada"] },
  { nome: "Ocupação", tipo: "despesa", grupo: "ocupacao", subs: ["Aluguel", "Condomínio e IPTU", "Energia", "Água", "Gás", "Internet e telefone"] },
  { nome: "Operação", tipo: "despesa", grupo: "operacao", subs: ["Manutenção e reparos", "Limpeza e higiene", "Utensílios e enxoval", "Dedetização", "Música e atrações"] },
  { nome: "Administrativo", tipo: "despesa", grupo: "administrativo", subs: ["Contabilidade", "Sistemas e assinaturas", "Tarifas bancárias", "Serviços de terceiros", "Material de escritório"] },
  { nome: "Marketing", tipo: "despesa", grupo: "marketing", subs: ["Anúncios", "Influenciadores e produção", "Material gráfico"] },
  { nome: "Despesas financeiras", tipo: "despesa", grupo: "financeiro", subs: ["Juros e multas", "Parcela de empréstimo", "Antecipação de recebíveis"] },
  { nome: "Investimentos", tipo: "despesa", grupo: "investimento", subs: ["Equipamentos", "Reforma e obra"] },
  { nome: "Retirada dos sócios", tipo: "despesa", grupo: "retirada", subs: ["Pró-labore", "Distribuição de lucro"] },
];

export const FORMAS_PADRAO: { nome: string; tipo: string; prazo_dias: number }[] = [
  { nome: "Pix", tipo: "pix", prazo_dias: 0 },
  { nome: "Dinheiro", tipo: "dinheiro", prazo_dias: 0 },
  { nome: "Boleto", tipo: "boleto", prazo_dias: 0 },
  { nome: "Cartão de débito", tipo: "debito", prazo_dias: 1 },
  { nome: "Cartão de crédito", tipo: "credito", prazo_dias: 30 },
  { nome: "Transferência (TED)", tipo: "transferencia", prazo_dias: 0 },
  { nome: "Vale-refeição", tipo: "voucher", prazo_dias: 30 },
];
const TIPOS_DE_FORMA = new Set(["dinheiro", "pix", "debito", "credito", "boleto", "transferencia", "cheque", "voucher", "outro"]);
const TIPOS_DE_CONTA = new Set(["corrente", "poupanca", "caixa", "digital", "investimento"]);

/** Na primeira vez que a casa abre o Financeiro, o básico já está lá. */
export async function garantirPadroes(venueId: string): Promise<void> {
  const contar = async (tabela: string) => {
    const { count, error } = await cliente().from(tabela).select("id", { count: "exact", head: true }).eq("venue_id", venueId);
    if (error) falhar("Falha ao abrir o Financeiro", error.message);
    return count ?? 0;
  };
  const [categorias, formas, contas] = await Promise.all([contar("fin_categorias"), contar("fin_formas"), contar("fin_contas")]);

  if (contas === 0) {
    const { error } = await cliente().from("fin_contas").insert({ venue_id: venueId, nome: "Caixa da casa", tipo: "caixa", ordem: 0 });
    if (error) falhar("Falha ao criar o caixa", error.message);
  }
  if (formas === 0) {
    const { error } = await cliente().from("fin_formas").insert(FORMAS_PADRAO.map((f, i) => ({ venue_id: venueId, ...f, ordem: i })));
    if (error) falhar("Falha ao criar as formas de pagamento", error.message);
  }
  if (categorias === 0) {
    for (const [i, c] of PLANO_PADRAO.entries()) {
      const { data, error } = await cliente()
        .from("fin_categorias")
        .insert({ venue_id: venueId, nome: c.nome, tipo: c.tipo, grupo: c.grupo, ordem: i })
        .select("id")
        .single();
      // Duas abas abertas ao mesmo tempo: a outra já criou. Segue.
      if (error) {
        if (/duplicate key/i.test(error.message)) return;
        falhar("Falha ao criar o plano de contas", error.message);
      }
      const { error: e2 } = await cliente()
        .from("fin_categorias")
        .insert(c.subs.map((nome, j) => ({ venue_id: venueId, pai_id: data.id, nome, tipo: c.tipo, grupo: c.grupo, ordem: j })));
      if (e2 && !/duplicate key/i.test(e2.message)) falhar("Falha ao criar o plano de contas", e2.message);
    }
  }
}

// ============================================================
// Cadastros
// ============================================================

export interface Lancamento {
  id: string;
  tipo: "pagar" | "receber";
  descricao: string;
  categoria_id: string | null;
  fornecedor_id: string | null;
  pessoa: string | null;
  documento: string | null;
  competencia: string;
  vencimento: string;
  valor: number;
  forma_id: string | null;
  conta_id: string | null;
  situacao: "aberto" | "pago" | "cancelado";
  pago_em: string | null;
  valor_pago: number | null;
  juros: number;
  desconto: number;
  grupo_id: string | null;
  parcela: number | null;
  parcelas: number | null;
  recorrente: boolean;
  observacoes: string | null;
  origem: string;
}

interface Transferencia {
  de_conta_id: string;
  para_conta_id: string;
  valor: number;
  dia: string;
}

/**
 * Saldo de cada conta hoje: o inicial + o que entrou pago − o que saiu pago
 * ± transferências, tudo a partir do dia do saldo inicial.
 */
export function saldosDasContas(
  contas: { id: string; saldo_inicial: number; saldo_inicial_em: string }[],
  pagos: Pick<Lancamento, "tipo" | "conta_id" | "pago_em" | "valor_pago" | "valor" | "situacao">[],
  transferencias: Transferencia[],
): Record<string, number> {
  const saldo: Record<string, number> = {};
  const desde: Record<string, string> = {};
  for (const c of contas) {
    saldo[c.id] = centavos(Number(c.saldo_inicial) || 0);
    desde[c.id] = c.saldo_inicial_em;
  }
  for (const l of pagos) {
    if (l.situacao !== "pago" || !l.conta_id || !(l.conta_id in saldo) || !l.pago_em || l.pago_em < desde[l.conta_id]!) continue;
    const v = centavos(Number(l.valor_pago ?? l.valor));
    saldo[l.conta_id]! += l.tipo === "receber" ? v : -v;
  }
  for (const t of transferencias) {
    const v = centavos(Number(t.valor));
    if (t.de_conta_id in saldo && t.dia >= desde[t.de_conta_id]!) saldo[t.de_conta_id]! -= v;
    if (t.para_conta_id in saldo && t.dia >= desde[t.para_conta_id]!) saldo[t.para_conta_id]! += v;
  }
  return Object.fromEntries(Object.entries(saldo).map(([k, v]) => [k, reais(v)]));
}

export async function cadastrosDoFinanceiro(venueId: string) {
  await garantirPadroes(venueId);
  const [contas, categorias, formas, fornecedores, pagos, transf] = await Promise.all([
    cliente().from("fin_contas").select("*").eq("venue_id", venueId).order("ordem").order("nome"),
    cliente().from("fin_categorias").select("*").eq("venue_id", venueId).order("ordem").order("nome"),
    cliente().from("fin_formas").select("*").eq("venue_id", venueId).order("ordem").order("nome"),
    cliente().from("fornecedores").select("*").eq("venue_id", venueId).order("nome"),
    cliente().from("fin_lancamentos").select("tipo, conta_id, pago_em, valor_pago, valor, situacao").eq("venue_id", venueId).eq("situacao", "pago").limit(50_000),
    cliente().from("fin_transferencias").select("de_conta_id, para_conta_id, valor, dia").eq("venue_id", venueId).limit(10_000),
  ]);
  for (const r of [contas, categorias, formas, fornecedores, pagos, transf]) if (r.error) falhar("Falha ao abrir os cadastros", r.error.message);
  const saldos = saldosDasContas(contas.data ?? [], pagos.data ?? [], transf.data ?? []);
  return {
    contas: (contas.data ?? []).map((c: { id: string }) => ({ ...c, saldo: saldos[c.id] ?? 0 })),
    categorias: categorias.data ?? [],
    formas: formas.data ?? [],
    fornecedores: fornecedores.data ?? [],
    grupos: GRUPOS,
  };
}

export function montarConta(campos: Record<string, unknown>) {
  const nome = texto(campos.nome, 80);
  if (!nome) throw new ErroDoFinanceiro(400, "Dê um nome para a conta (ex.: Itaú, Caixa da casa).");
  const saldo = campos.saldo_inicial === undefined || campos.saldo_inicial === "" ? 0 : lerValor(campos.saldo_inicial);
  if (Number.isNaN(saldo)) throw new ErroDoFinanceiro(400, "Saldo inicial inválido.");
  return {
    nome,
    tipo: TIPOS_DE_CONTA.has(String(campos.tipo)) ? String(campos.tipo) : "corrente",
    banco: texto(campos.banco, 80),
    agencia: texto(campos.agencia, 20),
    numero: texto(campos.numero, 30),
    saldo_inicial: saldo,
    ...(ehData(campos.saldo_inicial_em) ? { saldo_inicial_em: campos.saldo_inicial_em } : {}),
    ...(typeof campos.ativo === "boolean" ? { ativo: campos.ativo } : {}),
  };
}

export function montarCategoria(campos: Record<string, unknown>) {
  const nome = texto(campos.nome, 80);
  if (!nome) throw new ErroDoFinanceiro(400, "Dê um nome para a categoria.");
  const tipo = campos.tipo === "receita" ? "receita" : "despesa";
  const grupo = GRUPO_VALIDO.has(String(campos.grupo) as Grupo) ? String(campos.grupo) : tipo === "receita" ? "receita" : "outros";
  return {
    nome,
    tipo,
    grupo,
    pai_id: idOuNulo(campos.pai_id),
    ...(typeof campos.ativo === "boolean" ? { ativo: campos.ativo } : {}),
  };
}

export function montarForma(campos: Record<string, unknown>) {
  const nome = texto(campos.nome, 60);
  if (!nome) throw new ErroDoFinanceiro(400, "Dê um nome para a forma de pagamento.");
  const prazo = Math.round(Number(campos.prazo_dias ?? 0));
  const taxa = campos.taxa === undefined || campos.taxa === "" ? 0 : lerValor(campos.taxa);
  if (!(prazo >= 0 && prazo <= 120)) throw new ErroDoFinanceiro(400, "O prazo vai de 0 a 120 dias.");
  if (!(taxa >= 0 && taxa < 100)) throw new ErroDoFinanceiro(400, "Taxa inválida (em %).");
  return {
    nome,
    tipo: TIPOS_DE_FORMA.has(String(campos.tipo)) ? String(campos.tipo) : "outro",
    prazo_dias: prazo,
    taxa,
    conta_id: idOuNulo(campos.conta_id),
    ...(typeof campos.ativo === "boolean" ? { ativo: campos.ativo } : {}),
  };
}

export function montarFornecedor(campos: Record<string, unknown>) {
  const nome = texto(campos.nome, 120);
  if (!nome) throw new ErroDoFinanceiro(400, "Informe o nome do fornecedor.");
  const prazo = campos.prazo_dias === undefined || campos.prazo_dias === "" || campos.prazo_dias === null ? null : Math.round(Number(campos.prazo_dias));
  if (prazo !== null && !(prazo >= 0 && prazo <= 180)) throw new ErroDoFinanceiro(400, "Prazo de pagamento inválido.");
  return {
    nome,
    razao_social: texto(campos.razao_social, 160),
    tipo_pessoa: campos.tipo_pessoa === "pf" ? "pf" : "pj",
    cnpj: String(campos.cnpj ?? "").replace(/\D/g, "").slice(0, 14) || null,
    telefone: String(campos.telefone ?? "").replace(/\D/g, "").slice(0, 13) || null,
    email: texto(campos.email, 120),
    contato: texto(campos.contato, 80),
    endereco: texto(campos.endereco, 240),
    chave_pix: texto(campos.chave_pix, 120),
    banco: texto(campos.banco, 60),
    agencia: texto(campos.agencia, 20),
    conta: texto(campos.conta, 30),
    prazo_dias: prazo,
    categoria_id: idOuNulo(campos.categoria_id),
    forma_id: idOuNulo(campos.forma_id),
    observacoes: texto(campos.observacoes, 1000),
    ...(typeof campos.ativo === "boolean" ? { ativo: campos.ativo } : {}),
  };
}

const TABELA_DO_CADASTRO = { contas: "fin_contas", categorias: "fin_categorias", formas: "fin_formas", fornecedores: "fornecedores" } as const;
export type Cadastro = keyof typeof TABELA_DO_CADASTRO;
const MONTAR: Record<Cadastro, (c: Record<string, unknown>) => Record<string, unknown>> = {
  contas: montarConta,
  categorias: montarCategoria,
  formas: montarForma,
  fornecedores: montarFornecedor,
};
export const ehCadastro = (s: string): s is Cadastro => s in TABELA_DO_CADASTRO;

export async function salvarCadastro(params: { venueId: string; qual: Cadastro; id?: string | null; campos: Record<string, unknown> }) {
  const linha = MONTAR[params.qual](params.campos);
  const tabela = TABELA_DO_CADASTRO[params.qual];
  if (params.qual === "categorias" && linha.pai_id) {
    // A subcategoria herda o tipo e o grupo do pai: "Energia" dentro de
    // "Ocupação" não pode cair em outra linha do resultado.
    const { data: pai } = await cliente().from("fin_categorias").select("tipo, grupo, pai_id").eq("venue_id", params.venueId).eq("id", linha.pai_id).maybeSingle();
    if (!pai) throw new ErroDoFinanceiro(400, "Categoria de cima não encontrada.");
    if (pai.pai_id) throw new ErroDoFinanceiro(400, "Só existem dois níveis: categoria e subcategoria.");
    linha.tipo = pai.tipo;
    linha.grupo = pai.grupo;
  }
  const consulta = params.id
    ? cliente().from(tabela).update(linha).eq("venue_id", params.venueId).eq("id", params.id)
    : cliente().from(tabela).insert({ venue_id: params.venueId, ...linha });
  const { data, error } = await consulta.select("*").single();
  if (error) {
    if (/duplicate key/i.test(error.message)) throw new ErroDoFinanceiro(409, "Já existe um cadastro com esse nome.");
    falhar("Falha ao salvar", error.message);
  }
  if (params.qual === "categorias" && params.id && !linha.pai_id) {
    // Mudou o grupo da categoria: as subcategorias vão junto.
    await cliente().from("fin_categorias").update({ tipo: linha.tipo, grupo: linha.grupo }).eq("venue_id", params.venueId).eq("pai_id", params.id);
  }
  return data;
}

/** Cadastro com conta lançada não se apaga: arquiva (some das listas, fica no histórico). */
export async function arquivarCadastro(params: { venueId: string; qual: Cadastro; id: string }) {
  const tabela = TABELA_DO_CADASTRO[params.qual];
  const { error } = await cliente().from(tabela).update({ ativo: false }).eq("venue_id", params.venueId).eq("id", params.id);
  if (error) falhar("Falha ao arquivar", error.message);
  return { arquivado: true };
}

// ============================================================
// Parcelas
// ============================================================

export interface Parcela {
  vencimento: string;
  valor: number;
}

/**
 * A sugestão de parcelas. É só o ponto de partida: na tela, cada parcela
 * tem a data e o valor editáveis. Os centavos que sobram da divisão vão na
 * primeira parcela (R$ 100 em 3 = 33,34 + 33,33 + 33,33).
 */
export function sugerirParcelas(params: {
  total: number;
  quantidade: number;
  primeiro: string;
  /** "mensal" = mesmo dia todo mês; número = a cada N dias (28, 30, 7…). */
  intervalo: "mensal" | number;
}): Parcela[] {
  const n = Math.round(params.quantidade);
  if (!(n >= 1 && n <= 120)) throw new ErroDoFinanceiro(400, "De 1 a 120 parcelas.");
  if (!ehData(params.primeiro)) throw new ErroDoFinanceiro(400, "Data do primeiro vencimento inválida.");
  const total = centavos(params.total);
  if (!(total > 0)) throw new ErroDoFinanceiro(400, "Valor total inválido.");
  const base = Math.floor(total / n);
  const sobra = total - base * n;
  return Array.from({ length: n }, (_, i) => ({
    vencimento:
      params.intervalo === "mensal"
        ? somarMeses(params.primeiro, i)
        : somarDias(params.primeiro, i * Math.max(1, Math.round(params.intervalo))),
    valor: reais(base + (i === 0 ? sobra : 0)),
  }));
}

/** Confere as parcelas vindas da tela: datas válidas, valores positivos. */
export function conferirParcelas(bruto: unknown): Parcela[] {
  if (!Array.isArray(bruto) || bruto.length === 0) throw new ErroDoFinanceiro(400, "Informe ao menos um vencimento.");
  if (bruto.length > 120) throw new ErroDoFinanceiro(400, "No máximo 120 parcelas.");
  return bruto.map((p, i) => {
    const vencimento = (p as Record<string, unknown>)?.vencimento;
    const valor = lerValor((p as Record<string, unknown>)?.valor);
    if (!ehData(vencimento)) throw new ErroDoFinanceiro(400, `Parcela ${i + 1}: data inválida.`);
    if (!(valor > 0)) throw new ErroDoFinanceiro(400, `Parcela ${i + 1}: valor precisa ser maior que zero.`);
    return { vencimento, valor };
  });
}

// ============================================================
// Lançamentos
// ============================================================

function camposDoLancamento(campos: Record<string, unknown>) {
  const descricao = texto(campos.descricao, 200);
  if (!descricao) throw new ErroDoFinanceiro(400, "Descreva a conta (ex.: Aluguel de novembro, Nota 1234 Ambev).");
  return {
    descricao,
    categoria_id: idOuNulo(campos.categoria_id),
    fornecedor_id: idOuNulo(campos.fornecedor_id),
    pessoa: texto(campos.pessoa, 120),
    documento: texto(campos.documento, 60),
    forma_id: idOuNulo(campos.forma_id),
    conta_id: idOuNulo(campos.conta_id),
    observacoes: texto(campos.observacoes, 1000),
  };
}

/**
 * Lança uma conta com uma ou várias parcelas. A competência (o mês do
 * resultado) é a informada, ou o primeiro vencimento; numa conta recorrente
 * (aluguel), cada mês é a competência dele mesmo.
 */
export async function criarLancamentos(params: {
  venueId: string;
  tipo: "pagar" | "receber";
  campos: Record<string, unknown>;
  parcelas: unknown;
  quem?: string | null;
  origem?: string;
  origemId?: string | null;
}) {
  const base = camposDoLancamento(params.campos);
  const parcelas = conferirParcelas(params.parcelas);
  const recorrente = params.campos.recorrente === true;
  const competencia = ehData(params.campos.competencia) ? params.campos.competencia : null;
  const grupo = parcelas.length > 1 ? randomUUID() : null;
  const linhas = parcelas.map((p, i) => ({
    venue_id: params.venueId,
    tipo: params.tipo,
    ...base,
    competencia: recorrente ? p.vencimento : competencia ?? parcelas[0]!.vencimento,
    vencimento: p.vencimento,
    valor: p.valor,
    grupo_id: grupo,
    parcela: parcelas.length > 1 ? i + 1 : null,
    parcelas: parcelas.length > 1 ? parcelas.length : null,
    recorrente,
    origem: params.origem ?? "manual",
    origem_id: params.origemId && parcelas.length === 1 ? params.origemId : params.origemId ? `${params.origemId}:${i + 1}` : null,
    criado_por: params.quem ?? null,
  }));
  const { data, error } = await cliente().from("fin_lancamentos").insert(linhas).select("*");
  if (error) {
    if (/duplicate key/i.test(error.message)) throw new ErroDoFinanceiro(409, "Esta conta já foi lançada.");
    falhar("Falha ao lançar", error.message);
  }
  // Paga na hora (compra no Pix, no dinheiro): já entra baixada.
  if (params.campos.ja_pago === true && ehData(params.campos.pago_em)) {
    for (const l of data ?? []) {
      await baixarLancamento({ venueId: params.venueId, id: l.id, campos: { pago_em: params.campos.pago_em, conta_id: base.conta_id } });
    }
  }
  return { criados: (data ?? []).length, grupo_id: grupo };
}

export type SituacaoNaTela = "aberto" | "vence_hoje" | "atrasado" | "pago" | "cancelado";

export function situacaoNaTela(l: Pick<Lancamento, "situacao" | "vencimento">, hoje: string): SituacaoNaTela {
  if (l.situacao !== "aberto") return l.situacao;
  if (l.vencimento < hoje) return "atrasado";
  if (l.vencimento === hoje) return "vence_hoje";
  return "aberto";
}

/** Os números do alto da lista: o que está atrasado, vence hoje, na semana. */
export function resumoDosLancamentos(lista: Pick<Lancamento, "situacao" | "vencimento" | "valor" | "valor_pago" | "pago_em">[], hoje: string) {
  const somar = (f: (l: (typeof lista)[number]) => boolean, campo: "valor" | "valor_pago" = "valor") =>
    reais(lista.filter(f).reduce((s, l) => s + centavos(Number(l[campo] ?? l.valor)), 0));
  const em7 = somarDias(hoje, 7);
  const aberto = (l: (typeof lista)[number]) => l.situacao === "aberto";
  return {
    atrasado: somar((l) => aberto(l) && l.vencimento < hoje),
    atrasadas: lista.filter((l) => aberto(l) && l.vencimento < hoje).length,
    hoje: somar((l) => aberto(l) && l.vencimento === hoje),
    proximos_7_dias: somar((l) => aberto(l) && l.vencimento > hoje && l.vencimento <= em7),
    em_aberto: somar(aberto),
    pago: somar((l) => l.situacao === "pago", "valor_pago"),
  };
}

export async function listarLancamentos(params: {
  venueId: string;
  timezone: string;
  tipo?: string | null;
  de?: string | null;
  ate?: string | null;
  situacao?: string | null;
  fornecedorId?: string | null;
  categoriaId?: string | null;
  contaId?: string | null;
  busca?: string | null;
  /** "vencimento" (padrão) ou "pagamento": em qual data o período filtra. */
  por?: string | null;
}) {
  const hoje = hojeNaCasa(params.timezone);
  const de = ehData(params.de) ? params.de : somarDias(hoje, -30);
  const ate = ehData(params.ate) ? params.ate : somarDias(hoje, 60);
  const campoData = params.por === "pagamento" ? "pago_em" : "vencimento";
  let q = cliente().from("fin_lancamentos").select("*").eq("venue_id", params.venueId);
  if (params.tipo === "pagar" || params.tipo === "receber") q = q.eq("tipo", params.tipo);
  if (params.situacao === "atrasado") {
    // Atrasado é atrasado desde sempre — o boleto de março esquecido aparece.
    q = q.eq("situacao", "aberto").lt("vencimento", hoje);
  } else {
    q = q.gte(campoData, de).lte(campoData, ate);
    if (params.situacao === "aberto" || params.situacao === "pago" || params.situacao === "cancelado") q = q.eq("situacao", params.situacao);
    else q = q.neq("situacao", "cancelado");
  }
  const forn = idOuNulo(params.fornecedorId);
  if (forn) q = q.eq("fornecedor_id", forn);
  const conta = idOuNulo(params.contaId);
  if (conta) q = q.eq("conta_id", conta);
  const cat = idOuNulo(params.categoriaId);
  if (cat) {
    // Filtrar pela categoria de cima pega as subcategorias também.
    const { data: filhas } = await cliente().from("fin_categorias").select("id").eq("venue_id", params.venueId).eq("pai_id", cat);
    q = q.in("categoria_id", [cat, ...(filhas ?? []).map((f: { id: string }) => f.id)]);
  }
  const busca = texto(params.busca, 60);
  if (busca) {
    const termo = busca.replace(/[%,()]/g, " ");
    q = q.or(`descricao.ilike.%${termo}%,pessoa.ilike.%${termo}%,documento.ilike.%${termo}%`);
  }
  const { data, error } = await q.order(campoData, { ascending: true }).order("criado_em").limit(3000);
  if (error) falhar("Falha ao listar as contas", error.message);
  const lista = (data ?? []) as Lancamento[];
  return {
    hoje,
    de,
    ate,
    lancamentos: lista.map((l) => ({ ...l, estado: situacaoNaTela(l, hoje) })),
    resumo: resumoDosLancamentos(lista, hoje),
  };
}

async function lerLancamento(venueId: string, id: string): Promise<Lancamento> {
  const { data, error } = await cliente().from("fin_lancamentos").select("*").eq("venue_id", venueId).eq("id", id).maybeSingle();
  if (error) falhar("Falha ao abrir a conta", error.message);
  if (!data) throw new ErroDoFinanceiro(404, "Conta não encontrada.");
  return data as Lancamento;
}

/**
 * Edita uma parcela. Com `nas_proximas`, a descrição, a categoria, o
 * fornecedor e a forma vão também para as parcelas em aberto do mesmo grupo
 * (o valor e a data, não: cada parcela tem a sua).
 */
export async function editarLancamento(params: { venueId: string; id: string; campos: Record<string, unknown> }) {
  const atual = await lerLancamento(params.venueId, params.id);
  const base = camposDoLancamento({ ...atual, ...params.campos });
  const mudanca: Record<string, unknown> = { ...base, atualizado_em: new Date().toISOString() };
  if (params.campos.vencimento !== undefined) {
    if (!ehData(params.campos.vencimento)) throw new ErroDoFinanceiro(400, "Data inválida.");
    mudanca.vencimento = params.campos.vencimento;
  }
  if (params.campos.competencia !== undefined) {
    if (!ehData(params.campos.competencia)) throw new ErroDoFinanceiro(400, "Competência inválida.");
    mudanca.competencia = params.campos.competencia;
  }
  if (params.campos.valor !== undefined) {
    const v = lerValor(params.campos.valor);
    if (!(v > 0)) throw new ErroDoFinanceiro(400, "Valor precisa ser maior que zero.");
    if (atual.situacao === "pago") throw new ErroDoFinanceiro(409, "Esta conta já foi paga. Estorne o pagamento para mudar o valor.");
    mudanca.valor = v;
  }
  const { data, error } = await cliente().from("fin_lancamentos").update(mudanca).eq("venue_id", params.venueId).eq("id", params.id).select("*").single();
  if (error) falhar("Falha ao salvar", error.message);
  if (params.campos.nas_proximas === true && atual.grupo_id) {
    const { error: e2 } = await cliente()
      .from("fin_lancamentos")
      .update({ ...base, atualizado_em: new Date().toISOString() })
      .eq("venue_id", params.venueId)
      .eq("grupo_id", atual.grupo_id)
      .eq("situacao", "aberto")
      .gt("parcela", atual.parcela ?? 0);
    if (e2) falhar("Falha ao salvar as próximas parcelas", e2.message);
  }
  return data;
}

/**
 * Dá baixa: pagou (ou recebeu). O valor pago é o da conta + juros − desconto,
 * a menos que se diga outro. Pagou SÓ PARTE (`parcial`): a conta fica com o
 * que foi pago e o resto vira uma conta nova em aberto, com o mesmo grupo.
 */
export async function baixarLancamento(params: { venueId: string; id: string; campos: Record<string, unknown>; timezone?: string }) {
  const atual = await lerLancamento(params.venueId, params.id);
  if (atual.situacao === "pago") throw new ErroDoFinanceiro(409, "Esta conta já está paga.");
  if (atual.situacao === "cancelado") throw new ErroDoFinanceiro(409, "Esta conta foi cancelada.");
  const pagoEm = ehData(params.campos.pago_em) ? params.campos.pago_em : hojeNaCasa(params.timezone ?? "America/Cuiaba");
  const juros = params.campos.juros === undefined || params.campos.juros === "" ? 0 : lerValor(params.campos.juros);
  const desconto = params.campos.desconto === undefined || params.campos.desconto === "" ? 0 : lerValor(params.campos.desconto);
  if (!(juros >= 0) || !(desconto >= 0)) throw new ErroDoFinanceiro(400, "Juros e desconto não podem ser negativos.");
  const contaId = idOuNulo(params.campos.conta_id) ?? atual.conta_id;
  if (!contaId) throw new ErroDoFinanceiro(400, "Escolha de qual conta o dinheiro saiu (ou entrou).");

  let principal = Number(atual.valor);
  let resto = 0;
  if (params.campos.parcial === true) {
    const parte = lerValor(params.campos.valor_parcial);
    if (!(parte > 0 && parte < principal)) throw new ErroDoFinanceiro(400, "O valor parcial tem de ser maior que zero e menor que a conta.");
    resto = reais(centavos(principal) - centavos(parte));
    principal = parte;
  }
  const pago = reais(centavos(principal) + centavos(juros) - centavos(desconto));
  if (!(pago > 0)) throw new ErroDoFinanceiro(400, "O desconto é maior que a conta.");

  const { data, error } = await cliente()
    .from("fin_lancamentos")
    .update({
      situacao: "pago",
      pago_em: pagoEm,
      valor: principal,
      valor_pago: pago,
      juros,
      desconto,
      conta_id: contaId,
      forma_id: idOuNulo(params.campos.forma_id) ?? atual.forma_id,
      atualizado_em: new Date().toISOString(),
    })
    .eq("venue_id", params.venueId)
    .eq("id", params.id)
    .eq("situacao", "aberto")
    .select("*")
    .single();
  if (error) falhar("Falha ao dar baixa", error.message);

  if (resto > 0) {
    const { id: _id, criado_em: _c, atualizado_em: _a, pago_em: _p, valor_pago: _vp, ...copia } = atual as unknown as Record<string, unknown>;
    const { error: e2 } = await cliente()
      .from("fin_lancamentos")
      .insert({
        ...copia,
        venue_id: params.venueId,
        descricao: `${atual.descricao} (restante)`,
        valor: resto,
        situacao: "aberto",
        juros: 0,
        desconto: 0,
        origem_id: null,
        grupo_id: atual.grupo_id ?? randomUUID(),
      });
    if (e2) falhar("Falha ao criar o restante", e2.message);
  }
  return data;
}

export async function estornarLancamento(params: { venueId: string; id: string }) {
  const atual = await lerLancamento(params.venueId, params.id);
  if (atual.situacao !== "pago") throw new ErroDoFinanceiro(409, "Esta conta não está paga.");
  const { data, error } = await cliente()
    .from("fin_lancamentos")
    .update({ situacao: "aberto", pago_em: null, valor_pago: null, juros: 0, desconto: 0, atualizado_em: new Date().toISOString() })
    .eq("venue_id", params.venueId)
    .eq("id", params.id)
    .select("*")
    .single();
  if (error) falhar("Falha ao estornar", error.message);
  return data;
}

/** Apaga a conta; com `grupo`, apaga também as parcelas EM ABERTO do mesmo grupo. */
export async function apagarLancamento(params: { venueId: string; id: string; grupo?: boolean }) {
  const atual = await lerLancamento(params.venueId, params.id);
  if (atual.situacao === "pago") throw new ErroDoFinanceiro(409, "Esta conta já foi paga. Estorne o pagamento antes de apagar.");
  let q = cliente().from("fin_lancamentos").delete().eq("venue_id", params.venueId);
  q = params.grupo && atual.grupo_id ? q.eq("grupo_id", atual.grupo_id).neq("situacao", "pago") : q.eq("id", params.id);
  const { error } = await q;
  if (error) falhar("Falha ao apagar", error.message);
  return { apagado: true };
}

// ============================================================
// Transferências
// ============================================================

export async function transferir(params: { venueId: string; campos: Record<string, unknown>; quem?: string | null; timezone: string }) {
  const de = idOuNulo(params.campos.de_conta_id);
  const para = idOuNulo(params.campos.para_conta_id);
  const valor = lerValor(params.campos.valor);
  if (!de || !para || de === para) throw new ErroDoFinanceiro(400, "Escolha a conta de origem e uma de destino diferente.");
  if (!(valor > 0)) throw new ErroDoFinanceiro(400, "Valor inválido.");
  const { data, error } = await cliente()
    .from("fin_transferencias")
    .insert({
      venue_id: params.venueId,
      de_conta_id: de,
      para_conta_id: para,
      valor,
      dia: ehData(params.campos.dia) ? params.campos.dia : hojeNaCasa(params.timezone),
      descricao: texto(params.campos.descricao, 200),
      criado_por: params.quem ?? null,
    })
    .select("*")
    .single();
  if (error) falhar("Falha ao transferir", error.message);
  return data;
}

export async function listarTransferencias(venueId: string) {
  const { data, error } = await cliente().from("fin_transferencias").select("*").eq("venue_id", venueId).order("dia", { ascending: false }).limit(200);
  if (error) falhar("Falha ao listar as transferências", error.message);
  return data ?? [];
}

export async function apagarTransferencia(params: { venueId: string; id: string }) {
  const { error } = await cliente().from("fin_transferencias").delete().eq("venue_id", params.venueId).eq("id", params.id);
  if (error) falhar("Falha ao apagar", error.message);
  return { apagado: true };
}

// ============================================================
// Ficha do fornecedor
// ============================================================

/** Os números do fornecedor, para negociar com ele sabendo o que se compra. */
export function numerosDoFornecedor(lista: Pick<Lancamento, "situacao" | "vencimento" | "valor" | "valor_pago" | "pago_em" | "tipo" | "categoria_id">[], hoje: string) {
  const ha12m = somarMeses(hoje, -12);
  const pagar = lista.filter((l) => l.tipo === "pagar" && l.situacao !== "cancelado");
  const soma = (f: (l: (typeof pagar)[number]) => boolean, campo: "valor" | "valor_pago" = "valor") =>
    reais(pagar.filter(f).reduce((s, l) => s + centavos(Number(l[campo] ?? l.valor)), 0));
  const pago12 = soma((l) => l.situacao === "pago" && (l.pago_em ?? "") >= ha12m, "valor_pago");
  const porCategoria = new Map<string, number>();
  for (const l of pagar) if (l.categoria_id) porCategoria.set(l.categoria_id, (porCategoria.get(l.categoria_id) ?? 0) + centavos(Number(l.valor)));
  return {
    pago_12m: pago12,
    media_mensal_12m: reais(centavos(pago12) / 12),
    em_aberto: soma((l) => l.situacao === "aberto"),
    atrasado: soma((l) => l.situacao === "aberto" && l.vencimento < hoje),
    proximo_vencimento: pagar.filter((l) => l.situacao === "aberto" && l.vencimento >= hoje).map((l) => l.vencimento).sort()[0] ?? null,
    categorias: [...porCategoria.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, c]) => ({ categoria_id: id, valor: reais(c) })),
  };
}

export async function fichaDoFornecedor(params: { venueId: string; id: string; timezone: string }) {
  const hoje = hojeNaCasa(params.timezone);
  const [forn, lanc, compras] = await Promise.all([
    cliente().from("fornecedores").select("*").eq("venue_id", params.venueId).eq("id", params.id).maybeSingle(),
    cliente().from("fin_lancamentos").select("*").eq("venue_id", params.venueId).eq("fornecedor_id", params.id).order("vencimento", { ascending: false }).limit(500),
    cliente().from("compras").select("id, data_compra, valor_total, status, documento").eq("venue_id", params.venueId).eq("fornecedor_id", params.id).order("data_compra", { ascending: false }).limit(20),
  ]);
  if (forn.error) falhar("Falha ao abrir o fornecedor", forn.error.message);
  if (!forn.data) throw new ErroDoFinanceiro(404, "Fornecedor não encontrado.");
  if (lanc.error) falhar("Falha ao abrir as contas do fornecedor", lanc.error.message);
  const lista = (lanc.data ?? []) as Lancamento[];
  return {
    fornecedor: forn.data,
    numeros: numerosDoFornecedor(lista, hoje),
    lancamentos: lista.slice(0, 60).map((l) => ({ ...l, estado: situacaoNaTela(l, hoje) })),
    // As compras do estoque (se a casa usa o Custos e estoque).
    compras: compras.error ? [] : compras.data ?? [],
  };
}
