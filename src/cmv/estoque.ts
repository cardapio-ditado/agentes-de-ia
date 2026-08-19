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
  fornecedorId: string | null;
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
      "id, nome, nome_normalizado, unidade, categoria, codigo, custo_medio, estoque_minimo, tolerancia_divergencia_pct, fornecedor_id, estoque_saldos(quantidade, local_id)",
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
      fornecedorId: linha.fornecedor_id ?? null,
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
      fornecedorId: null,
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
  /** Destino DESTA linha; nulo herda o local da compra. */
  localId?: string | null;
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
  fornecedorId?: string | null;
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
      fornecedor_id: params.fornecedorId ?? null,
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
      local_id: i.localId ?? null,
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

/**
 * Cria um local de estoque.
 *
 * Marcar como principal desmarca o anterior na mesma transação de quem
 * chama? Não: o índice único parcial recusaria o segundo principal. Por isso
 * o desmarque acontece aqui, antes do insert — a regra "um principal por
 * casa" mora no banco, e este é o jeito de respeitá-la sem stacktrace.
 */
export async function criarLocal(params: {
  venueId: string;
  nome: string;
  principal?: boolean;
}): Promise<Local> {
  if (params.principal) {
    const { error } = await cliente()
      .from("estoque_locais")
      .update({ principal: false })
      .eq("venue_id", params.venueId)
      .eq("principal", true);
    if (error) throw traduzir(error);
  }
  const { data, error } = await cliente()
    .from("estoque_locais")
    .insert({ venue_id: params.venueId, nome: params.nome.trim(), principal: params.principal ?? false })
    .select("id, nome, principal")
    .single();
  if (error) throw traduzir(error);
  return data as Local;
}

/**
 * Desativa um local sem apagar: os movimentos históricos apontam para ele, e
 * apagar quebraria o razão — que é justamente o que nunca se quebra.
 */
export async function desativarLocal(venueId: string, localId: string): Promise<void> {
  const { error } = await cliente()
    .from("estoque_locais")
    .update({ ativo: false, principal: false })
    .eq("venue_id", venueId)
    .eq("id", localId);
  if (error) throw traduzir(error);
}

export async function atualizarInsumo(params: {
  venueId: string;
  insumoId: string;
  nome?: string;
  unidade?: string;
  categoria?: string | null;
  codigo?: string | null;
  estoqueMinimo?: number | null;
  toleranciaPct?: number;
  fornecedorId?: string | null;
  ativo?: boolean;
}): Promise<void> {
  const mudancas: Record<string, unknown> = {};
  if (params.nome !== undefined) mudancas.nome = params.nome.trim();
  if (params.unidade !== undefined) mudancas.unidade = params.unidade.trim() || "un";
  if (params.categoria !== undefined) mudancas.categoria = params.categoria?.trim() || null;
  if (params.codigo !== undefined) mudancas.codigo = params.codigo?.trim() || null;
  if (params.estoqueMinimo !== undefined) mudancas.estoque_minimo = params.estoqueMinimo;
  if (params.toleranciaPct !== undefined) mudancas.tolerancia_divergencia_pct = params.toleranciaPct;
  if (params.fornecedorId !== undefined) mudancas.fornecedor_id = params.fornecedorId;
  if (params.ativo !== undefined) mudancas.ativo = params.ativo;
  if (Object.keys(mudancas).length === 0) return;

  const { error } = await cliente()
    .from("insumos")
    .update(mudancas)
    .eq("venue_id", params.venueId)
    .eq("id", params.insumoId);
  if (error) throw traduzir(error);
}

/* ---------- compras: listagem ---------- */

export async function listarCompras(params: {
  venueId: string;
  status?: string;
}): Promise<unknown[]> {
  let consulta = cliente()
    .from("compras")
    .select("id, fornecedor, documento, data_compra, data_prevista, valor_total, status, origem, created_at, recebida_em, estoque_locais(nome)")
    .eq("venue_id", params.venueId)
    .order("created_at", { ascending: false })
    .limit(60);
  if (params.status) consulta = consulta.eq("status", params.status);
  const { data, error } = await consulta;
  if (error) throw traduzir(error);
  return data ?? [];
}

export async function obterCompra(venueId: string, compraId: string): Promise<unknown> {
  const { data, error } = await cliente()
    .from("compras")
    .select("*, compra_itens(*, insumos(nome, unidade))")
    .eq("venue_id", venueId)
    .eq("id", compraId)
    .maybeSingle();
  if (error) throw traduzir(error);
  if (!data) throw new ErroDoEstoque(404, "Compra não encontrada.");
  return data;
}

/* ---------- fichas técnicas ---------- */

export interface IngredienteDaFicha {
  insumoId: string;
  quantidade: number;
  observacao?: string | null;
}

export async function listarFichas(venueId: string): Promise<unknown[]> {
  const { data, error } = await cliente()
    .from("fichas_tecnicas")
    .select("id, nome, rendimento, preco_venda, sugerida_por_ia, confirmada_em, ativa, item_id, ficha_insumos(quantidade, insumos(id, nome, unidade, custo_medio))")
    .eq("venue_id", venueId)
    .eq("ativa", true)
    .order("nome");
  if (error) throw traduzir(error);

  // O custo é calculado aqui com os MESMOS dados que a tela mostra, e não
  // pela função do banco em N chamadas: uma ida só, e o número que aparece
  // ao lado dos ingredientes é a soma exata deles.
  return (data ?? []).map((f: any) => {
    const confirmada = f.confirmada_em !== null;
    const custoTotal = (f.ficha_insumos ?? []).reduce(
      (t: number, fi: any) => t + Number(fi.quantidade) * Number(fi.insumos?.custo_medio ?? 0),
      0,
    );
    return {
      ...f,
      // NULL enquanto não confirmada — a mesma regra da função do banco.
      custo_porcao: confirmada ? custoTotal / Number(f.rendimento) : null,
    };
  });
}

export async function salvarFicha(params: {
  venueId: string;
  fichaId?: string | null;
  nome: string;
  rendimento: number;
  precoVenda?: number | null;
  itemId?: string | null;
  ingredientes: IngredienteDaFicha[];
  confirmar?: boolean;
}): Promise<string> {
  if (!params.nome.trim()) throw new ErroDoEstoque(400, "A ficha precisa de um nome.");
  if (!(params.rendimento > 0)) throw new ErroDoEstoque(400, "Rendimento precisa ser maior que zero.");

  const corpo = {
    venue_id: params.venueId,
    nome: params.nome.trim(),
    rendimento: params.rendimento,
    preco_venda: params.precoVenda ?? null,
    item_id: params.itemId ?? null,
    // Editar à mão torna a ficha da pessoa, não da IA. E confirmar registra
    // o instante — é o que libera custo e produção.
    sugerida_por_ia: false,
    ...(params.confirmar ? { confirmada_em: new Date().toISOString() } : {}),
  };

  let fichaId = params.fichaId ?? null;
  if (fichaId) {
    const { error } = await cliente()
      .from("fichas_tecnicas")
      .update(corpo)
      .eq("venue_id", params.venueId)
      .eq("id", fichaId);
    if (error) throw traduzir(error);
  } else {
    const { data, error } = await cliente()
      .from("fichas_tecnicas")
      .insert(corpo)
      .select("id")
      .single();
    if (error) throw traduzir(error);
    fichaId = data.id as string;
  }

  // Regrava o conjunto: a edição pode tirar e pôr ingredientes, e casar
  // linha a linha pelo id daria mais chance de erro do que regravar.
  const { error: erroLimpa } = await cliente().from("ficha_insumos").delete().eq("ficha_id", fichaId);
  if (erroLimpa) throw traduzir(erroLimpa);

  const linhas = params.ingredientes
    .filter((i) => i.insumoId && i.quantidade > 0)
    .map((i) => ({
      ficha_id: fichaId,
      insumo_id: i.insumoId,
      quantidade: i.quantidade,
      observacao: i.observacao?.trim() || null,
    }));
  if (linhas.length > 0) {
    const { error } = await cliente().from("ficha_insumos").insert(linhas);
    if (error) throw traduzir(error);
  }
  return fichaId!;
}

export async function apagarFicha(venueId: string, fichaId: string): Promise<void> {
  // Desativa em vez de apagar: produções passadas apontam para ela.
  const { error } = await cliente()
    .from("fichas_tecnicas")
    .update({ ativa: false })
    .eq("venue_id", venueId)
    .eq("id", fichaId);
  if (error) throw traduzir(error);
}

/* ---------- fornecedores ---------- */

export interface Fornecedor {
  id: string;
  nome: string;
  cnpj: string | null;
  telefone: string | null;
  email: string | null;
  cicloCompraDias: number;
  observacoes: string | null;
}

export async function listarFornecedores(venueId: string): Promise<Fornecedor[]> {
  const { data, error } = await cliente()
    .from("fornecedores")
    .select("id, nome, cnpj, telefone, email, ciclo_compra_dias, observacoes")
    .eq("venue_id", venueId)
    .eq("ativo", true)
    .order("nome");
  if (error) throw traduzir(error);
  return (data ?? []).map((f: any) => ({
    id: f.id,
    nome: f.nome,
    cnpj: f.cnpj,
    telefone: f.telefone,
    email: f.email,
    cicloCompraDias: Number(f.ciclo_compra_dias),
    observacoes: f.observacoes,
  }));
}

export async function salvarFornecedor(params: {
  venueId: string;
  fornecedorId?: string | null;
  nome: string;
  cnpj?: string | null;
  telefone?: string | null;
  email?: string | null;
  cicloCompraDias?: number;
  observacoes?: string | null;
  ativo?: boolean;
}): Promise<string> {
  if (!params.nome.trim()) throw new ErroDoEstoque(400, "O fornecedor precisa de um nome.");
  const corpo: Record<string, unknown> = {
    venue_id: params.venueId,
    nome: params.nome.trim(),
    cnpj: params.cnpj?.trim() || null,
    telefone: params.telefone?.trim() || null,
    email: params.email?.trim() || null,
    ciclo_compra_dias: params.cicloCompraDias ?? 7,
    observacoes: params.observacoes?.trim() || null,
  };
  if (params.ativo !== undefined) corpo.ativo = params.ativo;

  if (params.fornecedorId) {
    const { error } = await cliente()
      .from("fornecedores")
      .update(corpo)
      .eq("venue_id", params.venueId)
      .eq("id", params.fornecedorId);
    if (error) throw traduzir(error);
    return params.fornecedorId;
  }
  const { data, error } = await cliente().from("fornecedores").insert(corpo).select("id").single();
  if (error) throw traduzir(error);
  return data.id as string;
}

/* ---------- movimentos avulsos ---------- */

export async function transferir(params: {
  venueId: string;
  insumoId: string;
  deLocal: string;
  paraLocal: string;
  quantidade: number;
}): Promise<void> {
  const { error } = await cliente().rpc("cmv_transferir", {
    p_venue_id: params.venueId,
    p_insumo_id: params.insumoId,
    p_de_local: params.deLocal,
    p_para_local: params.paraLocal,
    p_quantidade: params.quantidade,
    p_usuario: null,
  });
  if (error) throw traduzir(error);
}

export async function registrarPerda(params: {
  venueId: string;
  insumoId: string;
  localId: string;
  quantidade: number;
  motivo: string;
}): Promise<void> {
  const { error } = await cliente().rpc("cmv_registrar_perda", {
    p_venue_id: params.venueId,
    p_insumo_id: params.insumoId,
    p_local_id: params.localId,
    p_quantidade: params.quantidade,
    p_motivo: params.motivo,
    p_usuario: null,
  });
  if (error) throw traduzir(error);
}

export async function extratoInsumo(insumoId: string, localId?: string | null): Promise<unknown[]> {
  const { data, error } = await cliente().rpc("cmv_extrato_insumo", {
    p_insumo_id: insumoId,
    p_local_id: localId ?? null,
    p_limite: 50,
  });
  if (error) throw traduzir(error);
  return data ?? [];
}

export async function posicaoEstoque(venueId: string): Promise<unknown[]> {
  const { data, error } = await cliente().rpc("cmv_posicao_estoque", { p_venue_id: venueId });
  if (error) throw traduzir(error);
  return data ?? [];
}

export async function sugestaoCompra(venueId: string): Promise<unknown[]> {
  const { data, error } = await cliente().rpc("cmv_sugestao_compra", { p_venue_id: venueId });
  if (error) throw traduzir(error);
  // Só o que tem algo a pedir: mandar a lista inteira com zeros faria a
  // pessoa rolar cem linhas para achar as cinco que importam.
  return (data ?? []).filter((s: any) => Number(s.quantidade_sugerida) > 0);
}

/* ---------- contagem ---------- */

export interface ItemContado {
  insumoId: string;
  quantidade: number;
}

export interface AjusteDaContagem {
  insumo: string;
  unidade: string;
  contado: number;
  sistema: number;
  diferenca: number;
  /** Em reais, ao custo médio: é o número que dói e o que se investiga. */
  valor: number;
}

/**
 * Cria e processa a contagem numa tacada.
 *
 * Duas etapas no banco (criar aberta, processar depois) existem para o dia em
 * que a contagem for pausável; a tela de hoje conta e fecha, e expor a pausa
 * antes de alguém precisar dela só criaria contagens abertas esquecidas —
 * que envelhecem mal: processar uma contagem de anteontem sobrescreve o
 * estoque de hoje com o de anteontem.
 *
 * Item NÃO contado fica de fora e permanece como está. Não contado é
 * diferente de zero: zerar o que ninguém olhou transformaria toda contagem
 * parcial num massacre de saldos.
 */
export async function registrarContagem(params: {
  venueId: string;
  localId: string;
  itens: ItemContado[];
  observacoes?: string | null;
  criadoPor?: string | null;
}): Promise<{ ajustes: AjusteDaContagem[]; contados: number }> {
  const validos = params.itens.filter((i) => i.insumoId && i.quantidade >= 0);
  if (validos.length === 0) {
    throw new ErroDoEstoque(400, "Conte ao menos um item antes de processar.");
  }

  const { data: contagem, error } = await cliente()
    .from("contagens")
    .insert({
      venue_id: params.venueId,
      local_id: params.localId,
      observacoes: params.observacoes ?? null,
      criado_por: params.criadoPor ?? null,
    })
    .select("id")
    .single();
  if (error) throw traduzir(error);

  const { error: erroItens } = await cliente()
    .from("contagem_itens")
    .insert(validos.map((i) => ({
      contagem_id: contagem.id,
      insumo_id: i.insumoId,
      quantidade_contada: i.quantidade,
    })));
  if (erroItens) throw traduzir(erroItens);

  const { error: erroRpc } = await cliente().rpc("cmv_processar_contagem", {
    p_contagem_id: contagem.id,
    p_usuario: params.criadoPor ?? null,
  });
  if (erroRpc) throw traduzir(erroRpc);

  // O saldo_sistema foi congelado pela função no instante do processamento —
  // é dele que sai a diferença que a tela mostra.
  const { data: resultado, error: erroLeitura } = await cliente()
    .from("contagem_itens")
    .select("quantidade_contada, saldo_sistema, insumos(nome, unidade, custo_medio)")
    .eq("contagem_id", contagem.id);
  if (erroLeitura) throw traduzir(erroLeitura);

  const ajustes: AjusteDaContagem[] = (resultado ?? [])
    .map((r: any) => {
      const diferenca = Number(r.quantidade_contada) - Number(r.saldo_sistema ?? 0);
      return {
        insumo: r.insumos?.nome ?? "?",
        unidade: r.insumos?.unidade ?? "un",
        contado: Number(r.quantidade_contada),
        sistema: Number(r.saldo_sistema ?? 0),
        diferenca,
        valor: diferenca * Number(r.insumos?.custo_medio ?? 0),
      };
    })
    .filter((a: AjusteDaContagem) => a.diferenca !== 0)
    // A maior perda primeiro: é a que merece investigação hoje, não em ordem
    // alfabética.
    .sort((a: AjusteDaContagem, b: AjusteDaContagem) => a.valor - b.valor);

  return { ajustes, contados: validos.length };
}

export async function listarContagens(venueId: string): Promise<unknown[]> {
  const { data, error } = await cliente()
    .from("contagens")
    .select("id, status, created_at, processada_em, observacoes, estoque_locais(nome), contagem_itens(quantidade_contada, saldo_sistema, insumos(custo_medio))")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw traduzir(error);

  return (data ?? []).map((c: any) => {
    // A quebra da contagem em reais: só o que faltou (diferença negativa).
    // Sobra é erro de lançamento; falta é o que se investiga.
    const quebra = (c.contagem_itens ?? []).reduce((t: number, i: any) => {
      const d = Number(i.quantidade_contada) - Number(i.saldo_sistema ?? 0);
      return d < 0 ? t + d * Number(i.insumos?.custo_medio ?? 0) : t;
    }, 0);
    return {
      id: c.id,
      status: c.status,
      created_at: c.created_at,
      local: c.estoque_locais?.nome ?? "",
      itens: (c.contagem_itens ?? []).length,
      quebra,
    };
  });
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
    [/saldo_insuficiente/, 400, "Não há saldo suficiente nesse local para transferir essa quantidade."],
    [/mesmo_local/, 400, "Origem e destino são o mesmo local."],
    [/quantidade_invalida/, 400, "Informe uma quantidade maior que zero."],
    [/motivo_obrigatorio/, 400, "Diga o motivo da perda — é ele que separa quebra conhecida de desvio."],
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
