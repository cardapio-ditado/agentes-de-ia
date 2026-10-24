import { createHash } from "node:crypto";
import { db, ehMigracaoPendente } from "../supabase.js";
import { hojeNaCasa, horaNaCasa } from "../fuso.js";
import { chamarZig, configZig, diaAnterior } from "../pesquisaZig.js";
import { horaDaZig, type SaidaDaZig } from "../zigAoVivo.js";
import { lancarFaturamento } from "./estoque.js";
import { type LinhaDeVenda } from "./lerVendas.js";
import { baixarVendas, registrarImportacao } from "./vendas.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// As tabelas do CMV não estão nos tipos gerados — mesma saída do resto do módulo.
const cliente = () => db() as any;

/**
 * AS VENDAS DA ZIG, TODO DIA, NO ESTOQUE.
 *
 * Até aqui as vendas entravam no CMV por arquivo: alguém exportava o
 * relatório do PDV, subia no painel, revisava e baixava. A API da Zig
 * (docs/zig-api.md) dá o mesmo relatório pronto, item a item, com a data do
 * evento — então a importação de ontem se faz sozinha, de manhã.
 *
 * O que muda é só a porta de entrada. Depois da leitura é o tronco comum:
 * casar com o vocabulário da casa, revisar o que não casou, baixar pela
 * função do banco. Quando TUDO casou, a baixa sai sozinha; se sobrou alguma
 * linha sem vínculo, a importação espera na tela de Vendas — o estoque nunca
 * baixa pela metade sem ninguém ver.
 *
 * Trazido do Gorjeta Pro (a sincronização da Zig das 06:00), no vocabulário
 * do Brasa Food.
 */

/** A partir desta hora da casa, a noite de ontem já acabou e pode ser buscada. */
export const HORA_DE_BUSCAR = 6;
/** O dia operacional vira de madrugada: venda às 02h é da noite anterior. */
export const HORA_DA_VIRADA = 5;
/** Só o que é produto baixa estoque. Couvert, entrada e gorjeta são receita, não mercadoria. */
const TIPOS_DE_PRODUTO = new Set(["Normal"]);

export interface SaidaDaZigParaVendas extends SaidaDaZig {
  productSku?: string | null;
  eventDate?: string | null;
}

/** A que dia operacional uma saída pertence, no fuso da casa. */
export function diaOperacional(saida: Pick<SaidaDaZigParaVendas, "eventDate" | "transactionDate">, fuso: string): string | null {
  const doEvento = horaDaZig(saida.eventDate ?? null);
  if (doEvento) return hojeNaCasa(fuso, doEvento);
  const daVenda = horaDaZig(saida.transactionDate);
  if (!daVenda) return null;
  return hojeNaCasa(fuso, new Date(daVenda.getTime() - HORA_DA_VIRADA * 3600_000));
}

export interface VendasDoDia {
  linhas: LinhaDeVenda[];
  /** Soma dos produtos vendidos, em reais — é o faturamento que o CMV quer. */
  faturamento: number;
  /** O que ficou de fora e por quê (couvert, entrada, gorjeta), em reais. */
  foraDoEstoque: Record<string, number>;
  transacoes: number;
}

/**
 * As saídas da Zig viram as linhas de um relatório de vendas: uma linha por
 * produto, com quantidade e valor somados. Pura e testável.
 */
export function linhasDaZig(saidas: SaidaDaZigParaVendas[], fuso: string, dia: string): VendasDoDia {
  const porProduto = new Map<string, LinhaDeVenda>();
  const fora: Record<string, number> = {};
  const transacoes = new Set<string>();
  let faturamento = 0;

  for (const s of saidas) {
    if (diaOperacional(s, fuso) !== dia) continue;
    const quantidade = Math.max(0, Number(s.count) || 0);
    const valor = (Math.max(0, Number(s.unitValue) || 0) * quantidade - Math.max(0, Number(s.discountValue) || 0)) / 100;
    const tipo = (s.type ?? "Normal").trim() || "Normal";
    if (!TIPOS_DE_PRODUTO.has(tipo)) {
      fora[tipo] = Math.round(((fora[tipo] ?? 0) + valor) * 100) / 100;
      continue;
    }
    if (quantidade <= 0) continue;
    transacoes.add(s.transactionId);
    faturamento += valor;

    const nome = (s.productName ?? "").trim() || "(sem nome)";
    const codigo = (s.productSku ?? "").trim() || null;
    const chave = codigo ? `sku:${codigo}` : `nome:${nome.toLowerCase()}`;
    const linha = porProduto.get(chave) ?? { produto: nome, codigo, quantidade: 0, valorTotal: 0, data: dia };
    linha.quantidade += quantidade;
    linha.valorTotal = Math.round(((linha.valorTotal ?? 0) + valor) * 100) / 100;
    porProduto.set(chave, linha);
  }

  return {
    linhas: [...porProduto.values()].sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR")),
    faturamento: Math.round(faturamento * 100) / 100,
    foraDoEstoque: fora,
    transacoes: transacoes.size,
  };
}

/** A trava contra a baixa em dobro: um dia da Zig é uma "impressão" só, por casa. */
export function chaveDaImportacao(venueId: string, dia: string): string {
  return createHash("sha256").update(`zig:${venueId}:${dia}`).digest("hex");
}

export type ResultadoDaZig =
  | { situacao: "ja_existia"; importacaoId: string; status: string }
  | { situacao: "sem_vendas" }
  | { situacao: "importada"; importacaoId: string; total: number; casados: number; pendentes: number; baixada: boolean; faturamento: number };

/**
 * Importa as vendas de um dia da Zig para a casa. Idempotente: o mesmo dia
 * não entra duas vezes.
 */
export async function importarVendasDaZig(
  venue: { id: string; name: string; timezone: string },
  dia: string,
): Promise<ResultadoDaZig> {
  const config = await configZig(venue.id);
  if (!config.token || !config.loja) throw new Error("A casa não tem token e loja da Zig.");

  const hash = chaveDaImportacao(venue.id, dia);
  const existente = await cliente()
    .from("venda_importacoes")
    .select("id, status")
    .eq("venue_id", venue.id)
    .eq("arquivo_hash", hash)
    .maybeSingle();
  if (existente.error) throw new Error(existente.error.message);
  if (existente.data) return { situacao: "ja_existia", importacaoId: existente.data.id, status: existente.data.status };

  // Dois dias de janela: a noite de ontem atravessa a meia-noite, e é o
  // eventDate de cada saída que diz a que dia ela pertence.
  const loja = encodeURIComponent(config.loja);
  const saidas = await chamarZig<SaidaDaZigParaVendas[]>(
    `/erp/saida-produtos?dtinicio=${dia}&dtfim=${diaSeguinte(dia)}&loja=${loja}`,
    config.token,
  );
  const vendas = linhasDaZig(saidas ?? [], venue.timezone, dia);
  if (vendas.linhas.length === 0) return { situacao: "sem_vendas" };

  const r = await registrarImportacao({
    venueId: venue.id,
    arquivoNome: `Zig ${dia.split("-").reverse().join("/")}`,
    hash,
    origem: "api",
    periodoInicio: dia,
    periodoFim: dia,
    extracao: {
      origem: "zig",
      transacoes: vendas.transacoes,
      faturamento: vendas.faturamento,
      fora_do_estoque: vendas.foraDoEstoque,
      linhas: vendas.linhas.length,
    },
    linhas: vendas.linhas,
  });

  // Tudo casou: baixa sozinho e lança o faturamento do dia. Sobrou linha sem
  // vínculo: fica em revisão, e a tela de Vendas mostra o que falta decidir.
  let baixada = false;
  if (r.pendentes === 0) {
    await baixarVendas({ venueId: venue.id, importacaoId: r.importacaoId });
    baixada = true;
    await lancarFaturamento({ venueId: venue.id, data: dia, valor: vendas.faturamento, origem: "pdv" }).catch((e) => {
      console.error(`[vendas-zig] ${venue.name}: faturamento de ${dia} não lançado: ${e instanceof Error ? e.message : e}`);
    });
  }

  return { situacao: "importada", importacaoId: r.importacaoId, total: r.total, casados: r.casados, pendentes: r.pendentes, baixada, faturamento: vendas.faturamento };
}

/**
 * Importa ontem se ainda não entrou — chamado quando a tela de Vendas abre.
 * É o que faz a importação aparecer no servidor da Vercel sem esperar o
 * relógio do VPS. Nunca lança: a tela tem de abrir mesmo com a Zig fora.
 */
export async function importarOntemSeFaltar(
  venue: { id: string; name: string; timezone: string },
  agora = new Date(),
): Promise<ResultadoDaZig | null> {
  if (horaNaCasa(venue.timezone, agora) < HORA_DE_BUSCAR) return null;
  try {
    const config = await configZig(venue.id);
    if (!config.token || !config.loja || !config.vendas_no_estoque) return null;
    const r = await importarVendasDaZig(venue, diaAnterior(hojeNaCasa(venue.timezone, agora)));
    if (r.situacao === "importada") {
      console.log(`[vendas-zig] ${venue.name}: ontem importado pela tela — ${r.total} produto(s), ${r.pendentes} para decidir${r.baixada ? ", baixada" : ""}`);
    }
    return r;
  } catch (e) {
    console.error(`[vendas-zig] ${venue.name}: importação de ontem falhou: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function diaSeguinte(diaISO: string): string {
  const d = new Date(`${diaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * O relógio: para cada casa com CMV e Zig, a partir das 6h da casa, importa
 * ontem. Rodar de hora em hora é resiliência — o dia já importado custa uma
 * consulta ao banco e nenhuma chamada à Zig.
 */
export async function cicloDasVendasDaZig(agora = new Date()): Promise<{ importadas: number; baixadas: number; falhas: string[] }> {
  const { data, error } = await cliente()
    .from("venue_modulos")
    .select("venue_id, venues:venue_id(id, name, timezone)")
    .eq("modulo", "cmv")
    .eq("ativo", true);
  if (error) {
    if (ehMigracaoPendente(error.message)) return { importadas: 0, baixadas: 0, falhas: [] };
    throw new Error(error.message);
  }

  let importadas = 0;
  let baixadas = 0;
  const falhas: string[] = [];
  for (const linha of (data ?? []) as Array<{ venues: { id: string; name: string; timezone: string | null } | null }>) {
    const venue = linha.venues;
    if (!venue) continue;
    const fuso = venue.timezone ?? "America/Cuiaba";
    if (horaNaCasa(fuso, agora) < HORA_DE_BUSCAR) continue;
    try {
      const config = await configZig(venue.id);
      // A casa liga isto em Ajustes → Integrações: mexe em saldo, e casa sem
      // ficha cadastrada só encheria a tela de Vendas de linha sem vínculo.
      if (!config.token || !config.loja || !config.vendas_no_estoque) continue;
      const dia = diaAnterior(hojeNaCasa(fuso, agora));
      const r = await importarVendasDaZig({ id: venue.id, name: venue.name, timezone: fuso }, dia);
      if (r.situacao === "importada") {
        importadas += 1;
        if (r.baixada) baixadas += 1;
        console.log(
          `[vendas-zig] ${venue.name}: ${dia} — ${r.total} produto(s), ${r.casados} casados, ${r.pendentes} para decidir, ` +
            (r.baixada ? `baixada sozinha, faturamento R$ ${r.faturamento.toFixed(2)}` : "esperando revisão na tela de Vendas"),
        );
      }
    } catch (e) {
      falhas.push(`${venue.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const f of falhas) console.error(`[vendas-zig] ${f}`);
  return { importadas, baixadas, falhas };
}
