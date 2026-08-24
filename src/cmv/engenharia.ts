import { db } from "../supabase.js";

/**
 * Engenharia de cardápio: popularidade × margem, prato a prato.
 *
 * O CMV do período diz que a casa gastou 34%. Não diz ONDE. Duas casas com o
 * mesmo percentual podem ter problemas opostos — e a resposta está sempre na
 * mesma matriz, que restaurante nenhum monta à mão:
 *
 *                     vende muito           vende pouco
 *   margem boa     ⭐ estrela (protege)   🧩 enigma (divulga)
 *   margem ruim    🐴 burro de carga      🪦 peso morto (tira)
 *                     (reprecifica)
 *
 * O "burro de carga" é onde a casa mais perde sem perceber: o prato campeão
 * de venda com margem ruim PARECE sucesso — o balcão comemora, o caixa não.
 *
 * Os dados já estão todos no sistema: o custo vem da ficha técnica, o preço
 * e a quantidade vêm do relatório de vendas importado. Este arquivo só junta
 * e classifica — não há IA aqui, porque não há julgamento: é conta.
 *
 * O método é o clássico de Kasavana & Smith: popular é quem vende acima de
 * 70% da fatia justa (total ÷ nº de itens), e margem boa é quem contribui
 * acima da margem média ponderada. Usar o método do mercado, e não um corte
 * inventado, é o que deixa o resultado comparável com qualquer consultoria
 * que o dono contrate depois.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const cliente = () => db() as any;

export type Quadrante = "estrela" | "burro_de_carga" | "enigma" | "peso_morto";

export interface PratoVendido {
  nome: string;
  /** Quantas unidades saíram no período. */
  vendidos: number;
  /** Faturamento do período, quando o relatório trouxe valor. */
  faturamento: number | null;
  /** Custo de UMA porção, pela ficha (ou custo médio, para item direto). */
  custoUnitario: number;
  /** Preço de tabela, para quando o relatório não traz valor. */
  precoDeTabela: number | null;
}

export interface PratoClassificado extends PratoVendido {
  precoMedio: number;
  margemUnitaria: number;
  /** Margem em % do preço. */
  margemPct: number;
  /** Quanto este prato deixou de margem no período. */
  margemTotal: number;
  quadrante: Quadrante;
}

export interface CardapioClassificado {
  pratos: PratoClassificado[];
  /** Itens vendidos sem preço em lugar nenhum — impossíveis de classificar. */
  semPreco: Array<{ nome: string; vendidos: number }>;
  corteDePopularidade: number;
  margemMediaPonderada: number;
}

/**
 * Classifica o cardápio do período.
 *
 * Pura e exportada: é a conta que diz ao dono qual prato reprecificar, e uma
 * troca de sinal aqui aponta a decisão para o prato errado.
 */
export function classificarCardapio(itens: PratoVendido[]): CardapioClassificado {
  const semPreco: Array<{ nome: string; vendidos: number }> = [];
  const validos: Array<PratoVendido & { precoMedio: number }> = [];

  for (const item of itens) {
    if (item.vendidos <= 0) continue;
    // O preço REAL praticado vem na frente do de tabela: promoção e reajuste
    // de PDV aparecem no relatório antes de alguém lembrar de atualizar a
    // ficha — e a margem verdadeira é a do preço cobrado, não a do planejado.
    const precoMedio =
      item.faturamento && item.faturamento > 0
        ? item.faturamento / item.vendidos
        : (item.precoDeTabela ?? 0);
    if (precoMedio <= 0) {
      semPreco.push({ nome: item.nome, vendidos: item.vendidos });
      continue;
    }
    validos.push({ ...item, precoMedio });
  }

  if (validos.length === 0) {
    return { pratos: [], semPreco, corteDePopularidade: 0, margemMediaPonderada: 0 };
  }

  const totalVendido = validos.reduce((s, i) => s + i.vendidos, 0);
  // 70% da fatia justa: com 20 itens, a fatia justa é 5% do volume; quem
  // vende acima de 3,5% é popular. O 0,7 é do método — sem ele, metade do
  // cardápio seria sempre "impopular" por definição de média.
  const corteDePopularidade = 0.7 * (totalVendido / validos.length);

  const margens = validos.map((i) => ({
    ...i,
    margemUnitaria: i.precoMedio - i.custoUnitario,
  }));
  const margemMediaPonderada =
    margens.reduce((s, i) => s + i.margemUnitaria * i.vendidos, 0) / totalVendido;

  const pratos: PratoClassificado[] = margens
    .map((i) => {
      const popular = i.vendidos >= corteDePopularidade;
      const rende = i.margemUnitaria >= margemMediaPonderada;
      return {
        ...i,
        margemPct: Math.round((i.margemUnitaria / i.precoMedio) * 100),
        margemTotal: Math.round(i.margemUnitaria * i.vendidos * 100) / 100,
        quadrante: (popular
          ? rende
            ? "estrela"
            : "burro_de_carga"
          : rende
            ? "enigma"
            : "peso_morto") as Quadrante,
      };
    })
    // A ordem é a da decisão: quem mais deixa dinheiro na mesa primeiro.
    // Burro de carga no topo — é o problema que parece sucesso.
    .sort((a, b) => pesoDoQuadrante(a.quadrante) - pesoDoQuadrante(b.quadrante) || b.margemTotal - a.margemTotal);

  return { pratos, semPreco, corteDePopularidade, margemMediaPonderada };
}

function pesoDoQuadrante(q: Quadrante): number {
  return { burro_de_carga: 0, peso_morto: 1, enigma: 2, estrela: 3 }[q];
}

// ============================================================
// Os dados, do banco
// ============================================================

/**
 * Junta vendas baixadas do período com o custo de cada alvo.
 *
 * Só importação BAIXADA entra: a que está em revisão ainda pode estar com o
 * produto casado errado, e classificar cardápio sobre casamento errado
 * apontaria a reprecificação para o prato errado.
 */
export async function engenhariaDoCardapio(params: {
  venueId: string;
  inicio: string;
  fim: string;
}): Promise<CardapioClassificado> {
  const { data, error } = await cliente()
    .from("venda_itens")
    .select(
      "quantidade, valor_total, ficha_id, insumo_id, " +
        "venda_importacoes!inner(status), " +
        "fichas_tecnicas(nome, preco_venda, rendimento, ficha_insumos(quantidade, insumos(custo_medio))), " +
        "insumos(nome, custo_medio)",
    )
    .eq("venue_id", params.venueId)
    .eq("venda_importacoes.status", "baixada")
    .gte("data_venda", params.inicio)
    .lte("data_venda", params.fim)
    .limit(20000);

  if (error) throw new Error(`Falha ao ler as vendas do período: ${error.message}`);

  // Agrupa por alvo (ficha ou insumo). Linhas sem alvo — produto que ninguém
  // casou — ficam de fora: não há custo conhecido para classificar.
  const porAlvo = new Map<string, PratoVendido>();
  for (const linha of (data ?? []) as any[]) {
    const ficha = linha.fichas_tecnicas;
    const insumo = linha.insumos;
    if (!ficha && !insumo) continue;

    const chave = ficha ? `f:${linha.ficha_id}` : `i:${linha.insumo_id}`;
    const atual = porAlvo.get(chave) ?? {
      nome: ficha?.nome ?? insumo?.nome ?? "?",
      vendidos: 0,
      faturamento: 0,
      custoUnitario: ficha ? custoDaFicha(ficha) : Number(insumo?.custo_medio ?? 0),
      precoDeTabela: ficha?.preco_venda == null ? null : Number(ficha.preco_venda),
    };
    atual.vendidos += Number(linha.quantidade) || 0;
    atual.faturamento = (atual.faturamento ?? 0) + (Number(linha.valor_total) || 0);
    porAlvo.set(chave, atual);
  }

  return classificarCardapio(
    [...porAlvo.values()].map((p) => ({
      ...p,
      faturamento: p.faturamento && p.faturamento > 0 ? p.faturamento : null,
    })),
  );
}

/** O custo de uma porção: soma dos insumos da ficha, dividido pelo rendimento. */
function custoDaFicha(ficha: any): number {
  const soma = (ficha.ficha_insumos ?? []).reduce(
    (s: number, fi: any) => s + Number(fi.quantidade) * Number(fi.insumos?.custo_medio ?? 0),
    0,
  );
  const rendimento = Number(ficha.rendimento) || 1;
  return soma / rendimento;
}
