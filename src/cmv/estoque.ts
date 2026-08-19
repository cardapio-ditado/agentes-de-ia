import { db } from "../supabase.js";
import { casarPorTexto, normalizar, type Apelido, type InsumoConhecido } from "./casarInsumo.js";
import type { LinhaDaNota } from "./lerNota.js";

/**
 * O estoque, do lado do servidor.
 *
 * Tudo que muda saldo passa por uma função do banco (`cmv_receber_compra`,
 * `cmv_processar_contagem`, `cmv_registrar_producao`). Este arquivo não
 * escreve em `estoque_movimentos` nem em `estoque_saldos` em lugar nenhum —
 * a regra está cravada lá e repeti-la aqui criaria uma segunda verdade, que
 * é exatamente o que produziu 73% de saldos divergentes no Gorjeta.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sem os tipos gerados: as tabelas do CMV são novas e `database.types.ts` só
 * é regerado depois que a migração roda em produção. Tipar à mão aqui criaria
 * uma terceira descrição do mesmo esquema para manter em dia.
 */
const cliente = () => db() as any;

export interface Local {
  id: string;
  nome: string;
  principal: boolean;
}

export interface Insumo extends InsumoConhecido {
  categoria: string | null;
  custoMedio: number;
  estoqueMinimo: number | null;
  toleranciaPct: number;
  saldo: number;
}

export async function listarLocais(venueId: string): Promise<Local[]> {
  const { data, error } = await cliente()
    .from("estoque_locais")
    .select("id, nome, principal")
    .eq("venue_id", venueId)
    .eq("ativo", true)
    .order("principal", { ascending: false })
    .order("nome");
  if (error) throw traduzir(error);
  return (data ?? []) as Local[];
}

/**
 * Os insumos da casa, com o saldo somado de todos os locais.
 *
 * O saldo vem de `estoque_saldos`, o cache que o trigger mantém — nunca de
 * uma soma feita aqui. Somar por conta própria seria a segunda régua.
 */
export async function listarInsumos(params: {
  venueId: string;
  localId?: string;
  busca?: string;
}): Promise<Insumo[]> {
  const { data, error } = await cliente()
    .from("insumos")
    .select(
      "id, nome, nome_normalizado, unidade, categoria, codigo, custo_medio, estoque_minimo, tolerancia_divergencia_pct, estoque_saldos(quantidade, local_id)",
    )
    .eq("venue_id", params.venueId)
    .eq("ativo", true)
    .order("nome");
  if (error) throw traduzir(error);

  let insumos: Insumo[] = (data ?? []).map((linha: any): Insumo => {
    const saldos: Array<{ quantidade: number; local_id: string }> = linha.estoque_saldos ?? [];
    const doLocal = params.localId ? saldos.filter((s) => s.local_id === params.localId) : saldos;
    return {
      id: linha.id,
      nome: linha.nome,
      nomeNormalizado: linha.nome_normalizado,
      codigo: linha.codigo,
      unidade: linha.unidade,
      categoria: linha.categoria,
      custoMedio: Number(linha.custo_medio),
      estoqueMinimo: linha.estoque_minimo === null ? null : Number(linha.estoque_minimo),
      toleranciaPct: Number(linha.tolerancia_divergencia_pct ?? 0),
      saldo: doLocal.reduce((total, s) => total + Number(s.quantidade), 0),
    };
  });

  // A busca é feita aqui e não no banco porque quem digita "acai" precisa
  // achar "Açaí": o filtro do Postgres compararia com acento.
  if (params.busca?.trim()) {
    const alvo = normalizar(params.busca);
    insumos = insumos.filter(
      (i) => i.nomeNormalizado.includes(alvo) || (i.codigo ?? "").includes(alvo),
    );
  }
  return insumos;
}

/**
 * Cria um insumo, ou devolve o que já existe com aquele nome.
 *
 * Devolver em vez de falhar porque quem chama é a tela de recebimento, no
 * meio de uma nota: parar tudo com "esse nome já existe" faria a pessoa
 * inventar "Tilápia 2" — que é como o Gorjeta ganhou dois saldos para o
 * mesmo insumo.
 */
export async function garantirInsumo(params: {
  venueId: string;
  nome: string;
  unidade?: string;
  codigo?: string | null;
  categoria?: string | null;
}): Promise<{ insumo: Insumo; criado: boolean }> {
  const alvo = normalizar(params.nome);
  const existentes = await listarInsumos({ venueId: params.venueId });
  const jaTem = existentes.find((i) => i.nomeNormalizado === alvo);
  if (jaTem) return { insumo: jaTem, criado: false };

  const { data, error } = await cliente()
    .from("insumos")
    .insert({
      venue_id: params.venueId,
      nome: params.nome.trim(),
      unidade: params.unidade?.trim() || "un",
      codigo: params.codigo?.trim() || null,
      categoria: params.categoria?.trim() || null,
    })
    .select("id, nome, nome_normalizado, unidade, categoria, codigo, custo_medio")
    .single();
  if (error) throw traduzir(error);

  return {
    insumo: {
      id: data.id,
      nome: data.nome,
      nomeNormalizado: data.nome_normalizado,
      codigo: data.codigo,
      unidade: data.unidade,
      categoria: data.categoria,
      custoMedio: Number(data.custo_medio),
      estoqueMinimo: null,
      toleranciaPct: 0,
      saldo: 0,
    },
    criado: true,
  };
}

/* ---------- casamento das linhas da nota ---------- */

export interface LinhaCasada extends LinhaDaNota {
  insumoId: string | null;
  insumoNome: string | null;
  como: string;
  confianca: number;
}

/**
 * Casa as linhas de uma nota lida com os insumos da casa.
 *
 * A escada de `casarInsumo.ts` resolve a maioria; o que sobra vai para a tela
 * com `insumoId` nulo, e quem está na doca escolhe. Não há passo automático
 * de criação: insumo nascendo sozinho no meio de uma nota enche o cadastro de
 * duplicata com nome de fornecedor ("FGO TIRAS CX").
 */
export async function casarLinhas(params: {
  venueId: string;
  linhas: LinhaDaNota[];
}): Promise<LinhaCasada[]> {
  const [insumos, apelidos] = await Promise.all([
    listarInsumos({ venueId: params.venueId }),
    listarApelidos(params.venueId),
  ]);
  const porId = new Map(insumos.map((i) => [i.id, i]));

  return params.linhas.map((linha) => {
    const r = casarPorTexto(linha.descricao, linha.codigo, insumos, apelidos);
    return {
      ...linha,
      insumoId: r.insumoId,
      insumoNome: r.insumoId ? (porId.get(r.insumoId)?.nome ?? null) : null,
      como: r.como,
      confianca: r.confianca,
    };
  });
}

async function listarApelidos(venueId: string): Promise<Apelido[]> {
  const { data, error } = await cliente()
    .from("insumo_apelidos")
    .select("insumo_id, apelido_normalizado")
    .eq("venue_id", venueId);
  if (error) throw traduzir(error);
  return (data ?? []).map((a: any) => ({
    insumoId: a.insumo_id,
    apelidoNormalizado: a.apelido_normalizado,
  }));
}

/**
 * Ensina que esta grafia de nota é este insumo.
 *
 * Chamado quando alguém corrige um casamento na tela. É o que faz a nota
 * seguinte daquele fornecedor entrar sozinha — o degrau que transforma
 * conferência de meia hora em dois minutos, a partir da segunda compra.
 */
export async function aprenderApelido(params: {
  venueId: string;
  insumoId: string;
  descricao: string;
  origem?: "nota" | "pdv" | "manual";
}): Promise<void> {
  const apelido = normalizar(params.descricao);
  if (!apelido) return;

  const { error } = await cliente()
    .from("insumo_apelidos")
    .upsert(
      {
        venue_id: params.venueId,
        insumo_id: params.insumoId,
        apelido_normalizado: apelido,
        origem: params.origem ?? "nota",
      },
      { onConflict: "venue_id,apelido_normalizado,origem" },
    );
  if (error) throw traduzir(error);
}

/* ---------- compras ---------- */

export interface ItemDaCompra {
  insumoId: string | null;
  descricaoNota?: string | null;
  quantidadePedida?: number | null;
  custoUnitarioPedido?: number | null;
  quantidadeRecebida?: number | null;
  custoUnitarioRecebido?: number | null;
  divergenciaMotivo?: string | null;
}

export async function criarCompra(params: {
  venueId: string;
  localId: string;
  origem: "pedido" | "avulsa";
  fornecedor?: string | null;
  documento?: string | null;
  dataCompra?: string | null;
  extracaoIa?: unknown;
  itens: ItemDaCompra[];
  criadoPor?: string | null;
}): Promise<string> {
  const { data, error } = await cliente()
    .from("compras")
    .insert({
      venue_id: params.venueId,
      local_id: params.localId,
      origem: params.origem,
      fornecedor: params.fornecedor?.trim() || null,
      documento: params.documento?.trim() || null,
      data_compra: params.dataCompra || new Date().toISOString().slice(0, 10),
      extracao_ia: params.extracaoIa ?? null,
      criado_por: params.criadoPor ?? null,
    })
    .select("id")
    .single();
  if (error) throw traduzir(error);

  await gravarItens(data.id, params.itens);
  return data.id as string;
}

async function gravarItens(compraId: string, itens: ItemDaCompra[]): Promise<void> {
  const linhas = itens
    // Linha sem insumo E sem descrição não tem como virar nada útil depois.
    .filter((i) => i.insumoId || i.descricaoNota?.trim())
    .map((i) => ({
      compra_id: compraId,
      insumo_id: i.insumoId,
      descricao_nota: i.descricaoNota?.trim() || null,
      quantidade_pedida: i.quantidadePedida ?? null,
      custo_unitario_pedido: i.custoUnitarioPedido ?? null,
      quantidade_recebida: i.quantidadeRecebida ?? null,
      custo_unitario_recebido: i.custoUnitarioRecebido ?? null,
      divergencia_motivo: i.divergenciaMotivo?.trim() || null,
    }));
  if (linhas.length === 0) return;

  const { error } = await cliente().from("compra_itens").insert(linhas);
  if (error) throw traduzir(error);
}

/**
 * Substitui os itens de uma compra pelos conferidos na doca.
 *
 * Apaga e regrava em vez de atualizar linha a linha: a conferência pode
 * remover uma linha que não veio e acrescentar uma que veio sem estar no
 * pedido, e casar isso item a item pelo id daria mais chance de erro do que
 * regravar o conjunto. Só vale enquanto a compra não foi recebida — depois
 * disso o estoque já se moveu, e mexer aqui não desfaz movimento.
 */
export async function substituirItens(compraId: string, itens: ItemDaCompra[]): Promise<void> {
  const { data: compra, error: erroCompra } = await cliente()
    .from("compras")
    .select("status")
    .eq("id", compraId)
    .maybeSingle();
  if (erroCompra) throw traduzir(erroCompra);
  if (!compra) throw new ErroDoEstoque(404, "Compra não encontrada.");
  if (compra.status === "recebida") {
    throw new ErroDoEstoque(
      409,
      "Esta compra já entrou no estoque. Para corrigir, faça um ajuste por contagem.",
    );
  }

  const { error } = await cliente().from("compra_itens").delete().eq("compra_id", compraId);
  if (error) throw traduzir(error);
  await gravarItens(compraId, itens);
}

export async function enviarPedido(compraId: string): Promise<void> {
  const { error } = await cliente().rpc("cmv_enviar_pedido", { p_compra_id: compraId });
  if (error) throw traduzir(error);
}

export async function receberCompra(compraId: string, usuario?: string | null): Promise<void> {
  const { error } = await cliente().rpc("cmv_receber_compra", {
    p_compra_id: compraId,
    p_usuario: usuario ?? null,
  });
  if (error) throw traduzir(error);
}

export async function divergenciasDaCompra(compraId: string): Promise<unknown[]> {
  const { data, error } = await cliente().rpc("cmv_divergencias", { p_compra_id: compraId });
  if (error) throw traduzir(error);
  return data ?? [];
}

/* ---------- erros ---------- */

export class ErroDoEstoque extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDoEstoque";
  }
}

/**
 * Traduz o erro cru do banco para algo acionável.
 *
 * As funções do CMV levantam exceções com nome curto (`compra_ja_recebida`),
 * boas para casar em código e péssimas para ler numa tela às 22h na doca.
 * Sem esta camada, "P0001: nada_conferido" é o que a pessoa vê.
 */
export function traduzir(erro: { message?: string; code?: string } | Error): ErroDoEstoque {
  const bruto = "message" in erro ? (erro.message ?? "") : String(erro);

  const conhecidos: Array<[RegExp, number, string]> = [
    [/compra_ja_recebida/, 409, "Esta compra já foi recebida. O estoque não é lançado duas vezes."],
    [/compra_cancelada/, 409, "Esta compra foi cancelada."],
    [/compra_nao_encontrada/, 404, "Compra não encontrada."],
    [/nada_conferido/, 400, "Confira ao menos um item antes de dar entrada."],
    [/pedido_nao_esta_em_rascunho/, 409, "Este pedido já foi enviado ao fornecedor."],
    [/ficha_nao_confirmada/, 400, "Esta ficha ainda é uma sugestão. Confira os ingredientes antes de produzir."],
    [/ficha_nao_encontrada/, 404, "Ficha técnica não encontrada."],
    [/contagem_ja_processada/, 409, "Esta contagem já foi processada."],
    [/lotes_invalidos/, 400, "Informe quantas vezes a receita foi feita."],
    [
      /duplicate key|unique/i,
      409,
      "Já existe um insumo com esse nome. Use o que já está cadastrado — dois cadastros do mesmo item viram dois saldos.",
    ],
    [
      /42P01|PGRST205|does not exist|schema cache/i,
      503,
      "O módulo CMV ainda não foi instalado neste banco. Rode a migração 20260820000000_cmv_estoque_fundacao.",
    ],
  ];

  for (const [padrao, status, mensagem] of conhecidos) {
    if (padrao.test(bruto)) return new ErroDoEstoque(status, mensagem);
  }
  return new ErroDoEstoque(500, bruto || "Falha no estoque.");
}
