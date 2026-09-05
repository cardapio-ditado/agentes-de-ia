import { CONFIANCA_AUTOMATICA, normalizar, semelhanca } from "./casarInsumo.js";

/**
 * Casa o produto do relatório de vendas com o que ele deve baixar.
 *
 * A mesma escada da nota fiscal — código, apelido aprendido, nome exato,
 * parecença — só que o alvo aqui tem duas caras:
 *
 *   - uma FICHA TÉCNICA, quando é prato: vender "Isca de tilápia" baixa os
 *     insumos da receita, proporcionais à porção;
 *   - um INSUMO direto, quando o que se vende é o que se compra: a long neck
 *     vendida é uma long neck a menos na adega.
 *
 * Sem essa dualidade, bebida não funciona — e bebida costuma ser metade do
 * faturamento de um bar.
 *
 * O degrau que carrega o módulo é o APELIDO. Cada PDV escreve do seu jeito
 * ("PORC ISCA TILAPIA G"), e o jeito não muda. Casado uma vez à mão, todo
 * relatório seguinte entra sozinho: é o que faz a primeira importação levar
 * vinte minutos e a terceira, um toque.
 */

export interface FichaConhecida {
  id: string;
  nome: string;
  /** Ficha não confirmada não baixa estoque — o banco recusa. */
  confirmada: boolean;
}

export interface InsumoVendavel {
  id: string;
  nome: string;
  codigo: string | null;
}

export interface ApelidoDeVenda {
  apelidoNormalizado: string;
  fichaId: string | null;
  insumoId: string | null;
  /** A casa ensinou: este item vende no PDV e não baixa estoque. */
  ignorar?: boolean;
}

export type ComoCasouVenda = "codigo" | "apelido" | "nome_exato" | "nome_parecido" | "nenhum";

export interface CasamentoDeVenda {
  fichaId: string | null;
  insumoId: string | null;
  como: ComoCasouVenda;
  confianca: number;
  /** Por que não pode baixar, quando o alvo existe mas está impedido. */
  impedimento: string | null;
  /**
   * "Não baixa estoque", aprendido: o chopp do patrocinador, a cortesia da
   * casa. A linha entra como ignorada de saída, em vez de ficar pendente
   * esperando alguém ignorá-la de novo a cada relatório.
   */
  ignorar?: boolean;
}

const NADA: CasamentoDeVenda = {
  fichaId: null,
  insumoId: null,
  como: "nenhum",
  confianca: 0,
  impedimento: null,
};

export function casarVenda(
  produto: string,
  codigo: string | null,
  fichas: FichaConhecida[],
  insumos: InsumoVendavel[],
  apelidos: ApelidoDeVenda[],
): CasamentoDeVenda {
  const alvo = normalizar(produto);
  if (!alvo) return NADA;

  // 1. Código/PLU do PDV apontando para o código do insumo. Não há como errar.
  if (codigo?.trim()) {
    const porCodigo = insumos.find((i) => i.codigo?.trim() === codigo.trim());
    if (porCodigo) {
      return { fichaId: null, insumoId: porCodigo.id, como: "codigo", confianca: 1, impedimento: null };
    }
  }

  // 2. Apelido aprendido — alguém já disse, uma vez, o que este nome é.
  const apelido = apelidos.find((a) => a.apelidoNormalizado === alvo);
  if (apelido) {
    if (apelido.ignorar) {
      return { ...NADA, como: "apelido", confianca: 1, ignorar: true };
    }
    if (apelido.fichaId) {
      const ficha = fichas.find((f) => f.id === apelido.fichaId);
      return {
        fichaId: apelido.fichaId,
        insumoId: null,
        como: "apelido",
        confianca: 1,
        // O vínculo está certo; o que falta é conferir a ficha. Dizer isso é
        // melhor que devolver "não achei" e fazer a pessoa remapear tudo.
        impedimento: ficha && !ficha.confirmada ? "ficha_nao_confirmada" : null,
      };
    }
    return { fichaId: null, insumoId: apelido.insumoId, como: "apelido", confianca: 1, impedimento: null };
  }

  // 3. Nome idêntico depois de normalizar. Ficha primeiro: se existe um prato
  //    com esse nome, é o prato que foi vendido, não a matéria-prima.
  const fichaExata = fichas.find((f) => normalizar(f.nome) === alvo);
  if (fichaExata) {
    return {
      fichaId: fichaExata.id,
      insumoId: null,
      como: "nome_exato",
      confianca: 0.98,
      impedimento: fichaExata.confirmada ? null : "ficha_nao_confirmada",
    };
  }
  const insumoExato = insumos.find((i) => normalizar(i.nome) === alvo);
  if (insumoExato) {
    return { fichaId: null, insumoId: insumoExato.id, como: "nome_exato", confianca: 0.98, impedimento: null };
  }

  // 4. Parecença. Palpite — e a confiança diz o quanto.
  let melhorFicha: { f: FichaConhecida; nota: number } | null = null;
  for (const f of fichas) {
    const nota = semelhanca(produto, f.nome);
    if (!melhorFicha || nota > melhorFicha.nota) melhorFicha = { f, nota };
  }
  let melhorInsumo: { i: InsumoVendavel; nota: number } | null = null;
  for (const i of insumos) {
    const nota = semelhanca(produto, i.nome);
    if (!melhorInsumo || nota > melhorInsumo.nota) melhorInsumo = { i, nota };
  }

  const notaFicha = melhorFicha?.nota ?? 0;
  const notaInsumo = melhorInsumo?.nota ?? 0;
  const melhorNota = Math.max(notaFicha, notaInsumo);

  // Abaixo de 0.6 é coincidência de uma palavra genérica, não parecença.
  if (melhorNota < 0.6) return NADA;

  // Empate vai para a ficha: "Filé de tilápia" no relatório é o prato do
  // cardápio, não o quilo de peixe cru na câmara fria.
  const confianca = Math.min(melhorNota, 0.85);
  if (notaFicha >= notaInsumo) {
    return {
      fichaId: melhorFicha!.f.id,
      insumoId: null,
      como: "nome_parecido",
      confianca,
      impedimento: melhorFicha!.f.confirmada ? null : "ficha_nao_confirmada",
    };
  }
  return {
    fichaId: null,
    insumoId: melhorInsumo!.i.id,
    como: "nome_parecido",
    confianca,
    impedimento: null,
  };
}

/**
 * O casamento entra sozinho, sem ninguém olhar?
 *
 * Só com confiança alta E sem impedimento. Parecença tem teto de 0.85 de
 * propósito: baixar do estoque o prato errado não dá erro na tela — dá
 * "sumiu frango e sobrou peixe" na contagem, semanas depois.
 */
export function entraSozinho(c: CasamentoDeVenda): boolean {
  return c.confianca >= CONFIANCA_AUTOMATICA && c.impedimento === null && (c.fichaId !== null || c.insumoId !== null);
}
