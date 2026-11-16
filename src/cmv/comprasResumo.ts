import { db } from "../supabase.js";
import { ErroDoEstoque, traduzir } from "./estoque.js";

/**
 * O resumo das compras: os números do alto da tela e os dois gráficos.
 *
 * Existe porque a lista de compras tem teto (as 60 mais recentes) e uma casa
 * movimentada passa disso num mês. Contar em cima da lista daria número
 * errado com cara de certo; aqui a conta atravessa o período inteiro.
 *
 * As regras são as que a tela já usava, sem mudar nenhuma:
 *  - "do mês" é a compra cuja data (ou, sem ela, o dia em que foi lançada)
 *    começa pelo mês pedido;
 *  - "comprado" é só o que foi RECEBIDO, pelo valor da nota;
 *  - o que ainda não chegou vale pelo pedido (quantidade × custo combinado)
 *    enquanto a nota não tem valor;
 *  - o dia do recebimento é o do carimbo gravado, como na coluna "Recebido".
 */

// O cliente do banco não tem tipos gerados para estas tabelas (como nos vizinhos).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

/** O que a conta precisa de cada compra — e nada além disso. */
export interface CompraDoResumo {
  status: string;
  data_compra: string | null;
  created_at: string | null;
  recebida_em: string | null;
  data_prevista: string | null;
  valor_total: number | string | null;
  estoque_locais?: { nome?: string | null } | null;
  compra_itens?: { quantidade_pedida: number | string | null; custo_unitario_pedido: number | string | null }[] | null;
}

export interface ResumoDasCompras {
  mes: string;
  compras_no_mes: number;
  recebidas_no_mes: number;
  comprado_no_mes: number;
  aguardando: number;
  valor_aguardando: number;
  /** A entrega prevista mais próxima entre os pedidos que aguardam, se houver. */
  proxima_entrega: string | null;
  /** Pedidos aguardando cuja data prevista já passou. */
  atrasadas: number;
  ultimos_30_dias: { dia: string; valor: number }[];
  total_30_dias: number;
  por_local: { nome: string; valor: number }[];
}

const ehDia = (t: unknown): t is string => typeof t === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t);
const ehMes = (t: unknown): t is string => typeof t === "string" && /^\d{4}-\d{2}$/.test(t);

export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const centavos = (v: unknown): number => Math.round(Number(v ?? 0) * 100) || 0;

/** O valor do que ainda não chegou: o da nota, ou o estimado pelo pedido. */
function valorEstimado(c: CompraDoResumo): number {
  const daNota = centavos(c.valor_total);
  if (daNota > 0) return daNota;
  return (c.compra_itens ?? []).reduce(
    (t, it) => t + Math.round(Number(it.quantidade_pedida ?? 0) * Number(it.custo_unitario_pedido ?? 0) * 100),
    0,
  );
}

/** A conta, sem banco: é o que os testes exercitam. */
export function montarResumoDasCompras(compras: CompraDoResumo[], params: { hoje: string; mes: string }): ResumoDasCompras {
  const { hoje, mes } = params;
  const inicio = somarDias(hoje, -29);

  const doMes = compras.filter((c) => (c.data_compra ?? c.created_at ?? "").startsWith(mes));
  const recebidasDoMes = doMes.filter((c) => c.status === "recebida");
  const aguardando = compras.filter((c) => c.status === "pedido");
  const previstas = aguardando.map((c) => c.data_prevista).filter(ehDia).sort();

  const porDia = new Map<string, number>();
  for (let i = 0; i < 30; i++) porDia.set(somarDias(inicio, i), 0);
  const porLocal = new Map<string, number>();
  for (const c of compras) {
    if (c.status !== "recebida" || !c.recebida_em) continue;
    const dia = c.recebida_em.slice(0, 10);
    if (porDia.has(dia)) porDia.set(dia, porDia.get(dia)! + centavos(c.valor_total));
    if (dia.startsWith(mes)) {
      const local = c.estoque_locais?.nome?.trim() || "Sem local";
      porLocal.set(local, (porLocal.get(local) ?? 0) + centavos(c.valor_total));
    }
  }

  const ultimos = [...porDia].map(([dia, v]) => ({ dia, valor: v / 100 }));
  return {
    mes,
    compras_no_mes: doMes.length,
    recebidas_no_mes: recebidasDoMes.length,
    comprado_no_mes: recebidasDoMes.reduce((t, c) => t + centavos(c.valor_total), 0) / 100,
    aguardando: aguardando.length,
    valor_aguardando: aguardando.reduce((t, c) => t + valorEstimado(c), 0) / 100,
    proxima_entrega: previstas.find((d) => d >= hoje) ?? null,
    atrasadas: previstas.filter((d) => d < hoje).length,
    ultimos_30_dias: ultimos,
    total_30_dias: [...porDia.values()].reduce((t, v) => t + v, 0) / 100,
    por_local: [...porLocal]
      .map(([nome, v]) => ({ nome, valor: v / 100 }))
      .filter((l) => l.valor > 0)
      .sort((a, b) => b.valor - a.valor),
  };
}

const PAGINA = 1000;
/** Trava de segurança: nenhuma casa tem isto de compras em dois meses. */
const MAXIMO_DE_PAGINAS = 20;

/**
 * Busca só o que entra na conta — o que aguarda entrega (de qualquer data) e
 * o que foi lançado, comprado ou recebido do começo da janela para cá — e
 * atravessa tudo, página por página, sem o teto da lista.
 */
export async function resumoDasCompras(params: { venueId: string; hoje?: string | null; mes?: string | null }): Promise<ResumoDasCompras> {
  const hoje = ehDia(params.hoje) ? params.hoje : new Date().toISOString().slice(0, 10);
  const mes = ehMes(params.mes) ? params.mes : hoje.slice(0, 7);
  if (Number.isNaN(new Date(`${hoje}T12:00:00Z`).getTime())) throw new ErroDoEstoque(400, "Data inválida.");
  // A janela começa no que vier antes: o primeiro dia do mês ou 30 dias atrás.
  const desde = [`${mes}-01`, somarDias(hoje, -29)].sort()[0]!;

  const compras: CompraDoResumo[] = [];
  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina++) {
    const { data, error } = await cliente()
      .from("compras")
      .select(
        "id, status, data_compra, created_at, recebida_em, data_prevista, valor_total, estoque_locais(nome), compra_itens(quantidade_pedida, custo_unitario_pedido)",
      )
      .eq("venue_id", params.venueId)
      .or(`status.eq.pedido,data_compra.gte.${desde},created_at.gte.${desde},recebida_em.gte.${desde}`)
      .order("id", { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) throw traduzir(error);
    compras.push(...((data ?? []) as CompraDoResumo[]));
    if ((data ?? []).length < PAGINA) break;
  }
  return montarResumoDasCompras(compras, { hoje, mes });
}
