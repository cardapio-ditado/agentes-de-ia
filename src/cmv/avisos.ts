import { createHash } from "node:crypto";
import { db } from "../supabase.js";

/**
 * Os avisos do CMV: o módulo deixa de ser mudo.
 *
 * O CMV já sabe as três coisas que mais custam dinheiro num bar — o
 * fornecedor que subiu o preço, o estoque que divergiu na contagem, o insumo
 * que vai faltar no sábado — e só contava para quem abrisse o painel. Dono de
 * bar não abre tela de estoque na terça de manhã; lê WhatsApp.
 *
 * Três avisos, três momentos:
 *
 *   PREÇO      → no recebimento da compra. Descobrir o aumento na primeira
 *                nota custa uma conversa com o fornecedor; descobrir no
 *                fechamento do mês custa três compras pagas no preço novo.
 *   DIVERGÊNCIA → ao processar a contagem. É o único instante em que o desvio
 *                tem tamanho conhecido e história fresca.
 *   VAI FALTAR  → depois da baixa de vendas, no máximo uma vez por dia.
 *
 * Como todo aviso do sistema: enfileira (quem entrega é o conector), nunca
 * lança (a compra JÁ entrou, a contagem JÁ processou — derrubar a operação
 * porque o aviso tropeçou seria trocar o essencial pelo acessório), e a trava
 * de "um aviso por evento" é índice único no banco, não memória de processo.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const cliente = () => db() as any;

export interface ConfigDoCmv {
  /** Quem gerencia o estoque: recebe preço, divergência e "vai faltar". */
  avisar_whatsapp: string | null;
  /**
   * Quem FAZ a contagem: recebe o lembrete de contar. Vazio = o lembrete vai
   * para o número de cima.
   *
   * São funções diferentes na mesma casa: o lembrete é tarefa de quem conta;
   * a divergência é assunto de quem gerencia — vai de propósito para o
   * gestor, e não para o contador, porque contagem que audita a si mesma não
   * audita nada.
   */
  contagem_whatsapp: string | null;
  aumento_preco_pct: number;
  divergencia_reais: number;
  avisar_estoque: boolean;
  /** A cada quantos dias lembrar de contar. 0 desliga. */
  lembrete_contagem_dias: number;
}

export const CONFIG_CMV_PADRAO: ConfigDoCmv = {
  avisar_whatsapp: null,
  contagem_whatsapp: null,
  aumento_preco_pct: 10,
  divergencia_reais: 100,
  avisar_estoque: true,
  lembrete_contagem_dias: 0,
};

/** A configuração da casa, ou o padrão — inclusive antes de a migração rodar. */
export async function configDoCmv(venueId: string): Promise<ConfigDoCmv> {
  const { data, error } = await cliente()
    .from("cmv_config")
    .select("*")
    .eq("venue_id", venueId)
    .maybeSingle();

  if (error) {
    // Tabela ainda não existe (42P01): o CMV segue mudo, como sempre foi.
    if (/cmv_config|42P01|PGRST/i.test(error.message)) return { ...CONFIG_CMV_PADRAO };
    throw new Error(`Falha ao ler os avisos do CMV: ${error.message}`);
  }
  if (!data) return { ...CONFIG_CMV_PADRAO };

  const linha = data as Record<string, unknown>;
  return {
    avisar_whatsapp: (linha.avisar_whatsapp as string) || null,
    contagem_whatsapp: (linha.contagem_whatsapp as string) || null,
    aumento_preco_pct: Number(linha.aumento_preco_pct) || CONFIG_CMV_PADRAO.aumento_preco_pct,
    divergencia_reais:
      linha.divergencia_reais == null
        ? CONFIG_CMV_PADRAO.divergencia_reais
        : Number(linha.divergencia_reais),
    avisar_estoque: linha.avisar_estoque !== false,
    lembrete_contagem_dias: Number(linha.lembrete_contagem_dias) || 0,
  };
}

export async function salvarConfigDoCmv(
  venueId: string,
  campos: Partial<ConfigDoCmv>,
): Promise<ConfigDoCmv> {
  const atual = await configDoCmv(venueId);
  // Campo ausente não é campo apagado — a mesma lição de `salvarConfig` da
  // pesquisa, onde o X de apagar um campo zerava os outros.
  const informados = Object.fromEntries(
    Object.entries(campos).filter(([, v]) => v !== undefined),
  ) as Partial<ConfigDoCmv>;
  const nova = { ...atual, ...informados };

  nova.avisar_whatsapp = nova.avisar_whatsapp?.trim() || null;
  nova.contagem_whatsapp = nova.contagem_whatsapp?.trim() || null;
  nova.aumento_preco_pct = Number(nova.aumento_preco_pct);
  if (!(nova.aumento_preco_pct >= 1 && nova.aumento_preco_pct <= 100)) {
    throw new Error("O aviso de aumento vai de 1% a 100%.");
  }
  nova.divergencia_reais = Number(nova.divergencia_reais);
  if (!(nova.divergencia_reais >= 0)) {
    throw new Error("O limite da divergência precisa ser zero ou mais.");
  }
  nova.lembrete_contagem_dias = Math.trunc(Number(nova.lembrete_contagem_dias) || 0);
  if (!(nova.lembrete_contagem_dias >= 0 && nova.lembrete_contagem_dias <= 90)) {
    throw new Error("O lembrete de contagem vai de 0 (desligado) a 90 dias.");
  }

  const { error } = await cliente()
    .from("cmv_config")
    .upsert(
      { venue_id: venueId, ...nova, updated_at: new Date().toISOString() },
      { onConflict: "venue_id" },
    );
  if (error) throw new Error(`Falha ao salvar os avisos do CMV: ${error.message}`);
  return nova;
}

// ============================================================
// Preço: o julgamento
// ============================================================

export interface ItemComCusto {
  insumo: string;
  unidade: string;
  /** O custo médio ANTES desta compra entrar. */
  custoAnterior: number;
  /** O que foi pago nesta nota. */
  custoNovo: number;
}

export interface Aumento extends ItemComCusto {
  /** Variação em %, arredondada para inteiro. */
  pct: number;
}

/**
 * Quais itens da compra subiram além do que a casa tolera.
 *
 * Item novo (custo anterior zero) fica de fora: não existe "aumento" sobre o
 * que nunca foi comprado, e o primeiro preço de um insumo viraria sempre um
 * falso alarme de +100%.
 */
export function aumentosDePreco(itens: ItemComCusto[], pctMinimo: number): Aumento[] {
  const corte = Number.isFinite(pctMinimo) && pctMinimo >= 1 ? pctMinimo : 10;
  return itens
    .filter((i) => i.custoAnterior > 0 && i.custoNovo > 0)
    .map((i) => ({ ...i, pct: Math.round(((i.custoNovo - i.custoAnterior) / i.custoAnterior) * 100) }))
    .filter((i) => i.pct >= corte)
    .sort((a, b) => b.pct - a.pct);
}

export function textoAumentoDePreco(params: {
  casa: string;
  fornecedor: string | null;
  aumentos: Aumento[];
}): string {
  const { aumentos } = params;
  const titulo =
    aumentos.length === 1
      ? `📈 ${aumentos[0]!.insumo} subiu ${aumentos[0]!.pct}% — ${params.casa}`
      : `📈 ${aumentos.length} insumos subiram de preço — ${params.casa}`;

  const linhas = [titulo];
  if (params.fornecedor) linhas.push(`Nota de ${params.fornecedor}`);
  linhas.push(``);
  for (const a of aumentos.slice(0, 8)) {
    linhas.push(
      `• ${a.insumo}: ${dinheiro(a.custoAnterior)} → ${dinheiro(a.custoNovo)}/${a.unidade} (+${a.pct}%)`,
    );
  }
  linhas.push(
    ``,
    // O aviso aponta a ação, não só o fato: é a diferença entre informação e
    // uma conversa com o fornecedor ainda esta semana.
    `Vale conferir com o fornecedor ou cotar outro. O custo das fichas com estes insumos já mudou.`,
  );
  return linhas.join("\n");
}

// ============================================================
// Divergência de contagem: o julgamento
// ============================================================

export interface ItemContadoComCusto {
  insumo: string;
  unidade: string;
  contada: number;
  sistema: number;
  custoMedio: number;
}

export interface ResumoDivergencia {
  /** Soma do valor absoluto das diferenças, em reais. */
  totalReais: number;
  itens: Array<ItemContadoComCusto & { diferenca: number; valor: number }>;
}

/**
 * Quanto a contagem divergiu do sistema, em dinheiro.
 *
 * O corte é sobre o TOTAL da contagem, não sobre o item: dez itens com R$ 15
 * de diferença cada são R$ 150 sumidos, e item a item nenhum passaria.
 * Sobra e falta somam pelo valor absoluto — sobra também é estoque mentindo,
 * só que para o outro lado.
 */
export function resumirDivergencia(itens: ItemContadoComCusto[]): ResumoDivergencia {
  const comValor = itens
    .map((i) => {
      const diferenca = i.contada - i.sistema;
      return { ...i, diferenca, valor: Math.abs(diferenca) * i.custoMedio };
    })
    .filter((i) => i.valor > 0)
    .sort((a, b) => b.valor - a.valor);

  return {
    totalReais: Math.round(comValor.reduce((s, i) => s + i.valor, 0) * 100) / 100,
    itens: comValor,
  };
}

export function textoDivergencia(params: { casa: string; resumo: ResumoDivergencia }): string {
  const { resumo } = params;
  const linhas = [
    `📉 Contagem divergiu ${dinheiro(resumo.totalReais)} do sistema — ${params.casa}`,
    ``,
    `Onde mais sumiu (ou sobrou):`,
  ];
  for (const i of resumo.itens.slice(0, 6)) {
    const sinal = i.diferenca < 0 ? "faltaram" : "sobraram";
    linhas.push(
      `• ${i.insumo}: ${sinal} ${formatarQtd(Math.abs(i.diferenca))} ${i.unidade} (${dinheiro(i.valor)})`,
    );
  }
  linhas.push(
    ``,
    `O saldo já foi corrigido pela contagem. O que merece investigação é o motivo — quebra, desvio ou lançamento esquecido.`,
  );
  return linhas.join("\n");
}

// ============================================================
// Vai faltar: o julgamento
// ============================================================

export interface SugestaoDeCompra {
  insumo: string;
  unidade: string;
  saldo_atual: number;
  demanda_prevista: number;
  quantidade_sugerida: number;
}

/**
 * Os itens que não chegam ao fim do ciclo, do mais crítico para o menos.
 *
 * Só o que tem demanda prevista entra: item parado com saldo baixo não "vai
 * faltar" — ninguém consome. É o que impede o aviso de listar meia adega de
 * itens sazonais e virar ruído.
 */
export function itensParaAcabar(sugestoes: SugestaoDeCompra[]): SugestaoDeCompra[] {
  return sugestoes
    .filter((s) => s.quantidade_sugerida > 0 && s.demanda_prevista > 0)
    .sort((a, b) => a.saldo_atual / a.demanda_prevista - b.saldo_atual / b.demanda_prevista);
}

export function textoEstoqueBaixo(params: { casa: string; itens: SugestaoDeCompra[] }): string {
  const linhas = [
    `🛒 ${params.itens.length} ${params.itens.length === 1 ? "insumo vai faltar" : "insumos vão faltar"} — ${params.casa}`,
    ``,
  ];
  for (const i of params.itens.slice(0, 8)) {
    linhas.push(
      `• ${i.insumo}: tem ${formatarQtd(i.saldo_atual)} ${i.unidade}, o consumo pede ${formatarQtd(i.demanda_prevista)}`,
    );
  }
  linhas.push(``, `A sugestão de compra completa está no painel, em Compras.`);
  return linhas.join("\n");
}

// ============================================================
// A entrega
// ============================================================

/**
 * Um id determinístico para "o aviso de estoque do dia".
 *
 * O índice único do banco trava por `cmv_origem_id`; compra e contagem têm o
 * seu id natural, mas "hoje" não tem. Este dá um: mesma casa + mesmo dia =
 * mesmo id, e o segundo insert do dia morre no índice — a trava fica no
 * banco, não num relógio de processo que reinicia.
 */
export function origemDoDia(venueId: string, diaISO: string): string {
  const hex = createHash("md5").update(`${venueId}:${diaISO}:cmv_estoque`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Enfileira um aviso do CMV. Nunca lança; devolve se entrou. */
export async function enfileirarAvisoCmv(params: {
  venueId: string;
  destino: string;
  template: "cmv_preco_subiu" | "cmv_divergencia" | "cmv_estoque_baixo" | "cmv_lembrete_contagem";
  origemId: string;
  corpo: string;
}): Promise<boolean> {
  try {
    const { error } = await cliente().from("notifications").insert({
      venue_id: params.venueId,
      cmv_origem_id: params.origemId,
      channel: "whatsapp",
      destination: params.destino,
      template: params.template,
      body: params.corpo,
    });
    if (error) {
      // Índice único: o aviso deste evento já saiu. É a trava trabalhando.
      if (/duplicate key|unique/i.test(error.message)) return false;
      // Coluna ainda não existe: a migração não rodou, e o CMV segue mudo.
      if (/cmv_origem_id|42703|PGRST/i.test(error.message)) return false;
      console.error(`[cmv] aviso ${params.template} não entrou: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[cmv] aviso ${params.template} falhou: ${(e as Error).message}`);
    return false;
  }
}

// ============================================================
// A orquestração: cada gancho chama uma destas, e nenhuma lança
// ============================================================

interface FotoDosCustos {
  venueId: string;
  casa: string;
  fornecedor: string | null;
  itens: ItemComCusto[];
}

/**
 * Fotografa os custos ANTES de a compra entrar.
 *
 * Tem de ser antes: `cmv_receber_compra` atualiza o custo médio na mesma
 * transação, e depois dela o "preço antigo" não existe mais em lugar nenhum —
 * o aviso compararia o preço novo com ele mesmo e nunca acharia aumento.
 */
export async function fotografarCustosDaCompra(compraId: string): Promise<FotoDosCustos | null> {
  try {
    const { data, error } = await cliente()
      .from("compras")
      .select(
        "venue_id, fornecedores(nome), venues:venue_id(name), " +
          "compra_itens(quantidade_recebida, custo_unitario_recebido, custo_unitario_pedido, insumos(nome, unidade, custo_medio))",
      )
      .eq("id", compraId)
      .maybeSingle();
    if (error || !data) return null;

    const linha = data as any;
    const itens: ItemComCusto[] = (linha.compra_itens ?? [])
      .filter((i: any) => i.insumos)
      .map((i: any) => ({
        insumo: i.insumos.nome,
        unidade: i.insumos.unidade,
        custoAnterior: Number(i.insumos.custo_medio) || 0,
        custoNovo: Number(i.custo_unitario_recebido ?? i.custo_unitario_pedido) || 0,
      }));

    return {
      venueId: linha.venue_id,
      casa: linha.venues?.name ?? "sua casa",
      fornecedor: linha.fornecedores?.nome ?? null,
      itens,
    };
  } catch (e) {
    console.error(`[cmv] foto dos custos falhou: ${(e as Error).message}`);
    return null;
  }
}

/** Depois de a compra entrar: avisa se algo subiu além do que a casa tolera. */
export async function avisarAumentoDePreco(foto: FotoDosCustos | null, compraId: string): Promise<void> {
  if (!foto) return;
  try {
    const config = await configDoCmv(foto.venueId);
    if (!config.avisar_whatsapp) return;

    const aumentos = aumentosDePreco(foto.itens, config.aumento_preco_pct);
    if (aumentos.length === 0) return;

    await enfileirarAvisoCmv({
      venueId: foto.venueId,
      destino: config.avisar_whatsapp,
      template: "cmv_preco_subiu",
      origemId: compraId,
      corpo: textoAumentoDePreco({ casa: foto.casa, fornecedor: foto.fornecedor, aumentos }),
    });
  } catch (e) {
    console.error(`[cmv] aviso de preço falhou: ${(e as Error).message}`);
  }
}

/** Depois de processar a contagem: avisa se a diferença passou do corte. */
export async function avisarDivergenciaDaContagem(params: {
  venueId: string;
  contagemId: string;
  itens: ItemContadoComCusto[];
}): Promise<void> {
  try {
    const config = await configDoCmv(params.venueId);
    if (!config.avisar_whatsapp) return;

    const resumo = resumirDivergencia(params.itens);
    if (resumo.totalReais < config.divergencia_reais || resumo.itens.length === 0) return;

    await enfileirarAvisoCmv({
      venueId: params.venueId,
      destino: config.avisar_whatsapp,
      template: "cmv_divergencia",
      origemId: params.contagemId,
      corpo: textoDivergencia({ casa: await nomeDaCasa(params.venueId), resumo }),
    });
  } catch (e) {
    console.error(`[cmv] aviso de divergência falhou: ${(e as Error).message}`);
  }
}

/**
 * Depois da baixa de vendas: avisa o que vai faltar — no máximo uma vez por
 * dia, e é o índice único quem garante o "uma vez".
 */
export async function avisarEstoqueBaixo(params: {
  venueId: string;
  fuso: string;
  hojeISO: string;
}): Promise<void> {
  try {
    const config = await configDoCmv(params.venueId);
    if (!config.avisar_whatsapp || !config.avisar_estoque) return;

    const { data, error } = await cliente().rpc("cmv_sugestao_compra", {
      p_venue_id: params.venueId,
      p_timezone: params.fuso,
    });
    if (error) return;

    const criticos = itensParaAcabar((data ?? []) as SugestaoDeCompra[]);
    if (criticos.length === 0) return;

    await enfileirarAvisoCmv({
      venueId: params.venueId,
      destino: config.avisar_whatsapp,
      template: "cmv_estoque_baixo",
      origemId: origemDoDia(params.venueId, params.hojeISO),
      corpo: textoEstoqueBaixo({ casa: await nomeDaCasa(params.venueId), itens: criticos }),
    });
  } catch (e) {
    console.error(`[cmv] aviso de estoque falhou: ${(e as Error).message}`);
  }
}

async function nomeDaCasa(venueId: string): Promise<string> {
  const { data } = await cliente().from("venues").select("name").eq("id", venueId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "sua casa";
}

function dinheiro(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarQtd(n: number): string {
  const arredondado = Math.round(n * 100) / 100;
  return Number.isInteger(arredondado)
    ? String(arredondado)
    : arredondado.toFixed(2).replace(".", ",").replace(/0$/, "");
}


// ============================================================
// A varredura diária (roda no conector, que é o processo de pé)
// ============================================================

/**
 * Uma volta por dia, para cada casa com o módulo de CMV:
 *
 *  1. FOTOGRAFA o estoque (`cmv_registrar_snapshot`). O CMV do período
 *     precisa do estoque de cada dia, e até aqui a foto só era tirada quando
 *     alguém abria o painel — casa que ficasse duas semanas sem abrir tinha
 *     um CMV calculado sobre um estoque inicial de duas semanas atrás.
 *  2. LEMBRA de contar, se a casa pediu. Cadência que depende de memória
 *     morre na terceira semana; um lembrete por atraso, e não um por dia —
 *     quem segura a repetição é o par (última contagem × índice único).
 *
 * Idempotente de ponta a ponta: o snapshot é upsert por dia, e o lembrete
 * tem índice único por dia. Rodar duas vezes não duplica nada — por isso o
 * laço pode chamar de hora em hora sem guardar estado.
 */
export async function cicloDiarioDoCmv(agora = new Date()): Promise<void> {
  let casas: any[];
  try {
    const { data, error } = await cliente()
      .from("venue_modulos")
      .select("venue_id, venues:venue_id(id, name, timezone)")
      .eq("modulo", "cmv")
      .eq("ativo", true);
    if (error) {
      if (/venue_modulos|42P01|PGRST/i.test(error.message)) return;
      throw error;
    }
    casas = data ?? [];
  } catch (e) {
    console.error(`[cmv] varredura diária não listou as casas: ${(e as Error).message}`);
    return;
  }

  for (const casa of casas) {
    const venue = casa.venues;
    if (!venue) continue;
    try {
      await cliente().rpc("cmv_registrar_snapshot", { p_venue_id: venue.id });
    } catch (e) {
      console.error(`[cmv] snapshot de ${venue.name} falhou: ${(e as Error).message}`);
    }
    try {
      await lembrarContagemAtrasada(venue, agora);
    } catch (e) {
      console.error(`[cmv] lembrete de contagem de ${venue.name} falhou: ${(e as Error).message}`);
    }
  }
}

async function lembrarContagemAtrasada(
  venue: { id: string; name: string; timezone: string },
  agora: Date,
): Promise<void> {
  const config = await configDoCmv(venue.id);
  const destino = config.contagem_whatsapp || config.avisar_whatsapp;
  if (!destino || config.lembrete_contagem_dias <= 0) return;

  const { data: ultima } = await cliente()
    .from("contagens")
    .select("processada_em")
    .eq("venue_id", venue.id)
    .eq("status", "processada")
    .order("processada_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  const referencia = ultima?.processada_em ? new Date(ultima.processada_em) : null;
  const dias = referencia
    ? Math.floor((agora.getTime() - referencia.getTime()) / 86_400_000)
    : null;
  // Casa que nunca contou também merece o empurrão — mas só depois do prazo
  // configurado a partir de hoje não dá para medir; usa o prazo como piso.
  if (dias !== null && dias < config.lembrete_contagem_dias) return;

  // UM lembrete por atraso, não um por dia: se já existe lembrete mais novo
  // que a última contagem, a casa já sabe. Contou de novo → o ciclo zera.
  const { data: jaLembrado } = await cliente()
    .from("notifications")
    .select("created_at")
    .eq("venue_id", venue.id)
    .eq("template", "cmv_lembrete_contagem")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    jaLembrado?.created_at &&
    (!referencia || new Date(jaLembrado.created_at) > referencia)
  ) {
    return;
  }

  const hojeISO = new Date(agora.getTime()).toISOString().slice(0, 10);
  const corpo = [
    dias === null
      ? `📋 Ainda não houve nenhuma contagem de estoque — ${venue.name}`
      : `📋 Faz ${dias} dias desde a última contagem — ${venue.name}`,
    ``,
    `Sem contagem em cadência, o CMV vira chute: o teórico anda sozinho e ninguém confere. Dez minutos na prateleira principal já seguram o número.`,
    ``,
    `Painel → Contagem.`,
  ].join("\n");

  await enfileirarAvisoCmv({
    venueId: venue.id,
    destino,
    template: "cmv_lembrete_contagem",
    origemId: origemDoDia(venue.id, `${hojeISO}:lembrete`),
    corpo,
  });
}
