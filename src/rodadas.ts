import type { RespostaItem } from "./checklists.js";

/**
 * RODADAS — o mesmo checklist, várias vezes na mesma noite.
 *
 * O checklist comum é "um turno, um preenchimento": abertura, fechamento,
 * câmara fria. O banheiro é outro bicho — as mesmas seis perguntas, doze
 * vezes por noite. Encaixar isso no modelo comum dava duas saídas ruins:
 * doze checklists iguais no cadastro, ou doze execuções por dia entupindo o
 * histórico e mandando doze resumos para o gerente.
 *
 * Aqui é UM checklist, UMA execução por dia, UM link — e dentro dela as
 * rodadas: cada uma com a hora prevista, a hora em que foi feita, quem fez e
 * as respostas. A IA resume a noite inteira uma vez, no fechamento.
 *
 * Tudo puro. As horas são "minutos desde o início da janela", e não
 * "HH:MM", porque a janela do bar atravessa a meia-noite: 18:00 às 02:00 é
 * uma noite só, e comparar "02:00" com "23:00" como texto diria que a
 * madrugada vem antes da noite.
 */

export interface Rodada {
  numero: number;
  /** "HH:MM" no relógio da casa — o que a equipe lê. */
  prevista: string;
  /** Minutos desde o início da janela — o que o código compara. */
  minuto: number;
  iniciada_em: string | null;
  concluida_em: string | null;
  /** Minutos desde o início da janela em que foi concluída — para o atraso. */
  minuto_feita: number | null;
  executor_nome: string | null;
  respostas: RespostaItem[] | null;
  /** A cutucada de atraso já saiu para esta rodada — nunca sai duas vezes. */
  cutucada_em: string | null;
}

export type EstadoDaRodada = "feita" | "atrasada" | "agora" | "futura";

/** Passou disto da hora prevista sem ninguém fazer, a rodada está atrasada. */
export const TOLERANCIA_MINUTOS = 15;

/** Antes disto da hora prevista, uma rodada feita "cedo" ainda é a rodada. */
export const ANTECEDENCIA_MINUTOS = 10;

/** Menor intervalo aceito: abaixo disto não é rotina, é vigia. */
export const INTERVALO_MINIMO = 15;

/** "HH:MM" em minutos desde a meia-noite. */
export function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function hhmmDe(minutos: number): string {
  const m = ((minutos % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * A duração da janela em minutos. "18:00 até 02:00" são 480, não -960:
 * fim menor ou igual ao início significa que a janela vira a noite.
 */
export function duracaoDaJanela(hora: string, ate: string): number {
  const inicio = minutosDe(hora);
  const fim = minutosDe(ate);
  return fim > inicio ? fim - inicio : fim + 1440 - inicio;
}

/**
 * As rodadas previstas de uma noite, vazias, prontas para gravar na execução.
 *
 * A última rodada é a última que CABE antes do fim: com "18:00 até 02:00 a
 * cada 45 min" a de 01:30 entra e a de 02:15 não — o bar já fechou.
 */
export function rodadasPrevistas(hora: string, ate: string, aCadaMinutos: number): Rodada[] {
  const intervalo = Math.max(INTERVALO_MINIMO, Math.floor(aCadaMinutos));
  const duracao = duracaoDaJanela(hora, ate);
  const inicio = minutosDe(hora);
  const rodadas: Rodada[] = [];
  for (let minuto = 0; minuto <= duracao; minuto += intervalo) {
    rodadas.push({
      numero: rodadas.length + 1,
      prevista: hhmmDe(inicio + minuto),
      minuto,
      iniciada_em: null,
      concluida_em: null,
      minuto_feita: null,
      executor_nome: null,
      respostas: null,
      cutucada_em: null,
    });
  }
  return rodadas;
}

export function estadoDa(rodada: Rodada, agoraMinuto: number): EstadoDaRodada {
  if (rodada.concluida_em) return "feita";
  if (agoraMinuto > rodada.minuto + TOLERANCIA_MINUTOS) return "atrasada";
  if (agoraMinuto >= rodada.minuto - ANTECEDENCIA_MINUTOS) return "agora";
  return "futura";
}

/**
 * Qual rodada um preenchimento feito AGORA conclui.
 *
 * A regra é a do relógio de ponto: o preenchimento vale para o horário em
 * que está sendo feito, não para o que ficou para trás. Quem faz uma rodada
 * às 21:10 fez a das 21:00 — a das 20:15, que ninguém fez, continua pulada,
 * porque ninguém conferiu o banheiro às 20:15 e fingir que sim é o que a
 * planilha de papel já fazia.
 *
 *   · a rodada do horário atual, se ainda não foi feita;
 *   · senão, a próxima que vem — quem faz de novo em seguida está adiantando;
 *   · senão, nenhuma: a noite acabou.
 */
export function rodadaParaConcluir(rodadas: Rodada[], agoraMinuto: number): Rodada | null {
  const atual = [...rodadas]
    .reverse()
    .find((r) => r.minuto <= agoraMinuto + ANTECEDENCIA_MINUTOS);
  if (atual && !atual.concluida_em) return atual;

  const depois = rodadas.find((r) => !r.concluida_em && r.minuto > (atual?.minuto ?? -1));
  return depois ?? null;
}

/** A próxima rodada ainda por fazer, para a tela dizer "próxima às 21:00". */
export function proximaRodada(rodadas: Rodada[]): Rodada | null {
  return rodadas.find((r) => !r.concluida_em) ?? null;
}

/**
 * As rodadas que merecem uma cutucada agora: atrasadas, não feitas, e que
 * ainda não foram cutucadas. Uma por rodada, nunca em laço — a mensagem
 * repetida a cada minuto é o jeito mais rápido de ensinar alguém a ignorar
 * o WhatsApp da casa.
 */
export function rodadasParaCutucar(rodadas: Rodada[], agoraMinuto: number): Rodada[] {
  return rodadas.filter((r) => estadoDa(r, agoraMinuto) === "atrasada" && !r.cutucada_em);
}

/**
 * A noite acabou?
 *
 * Ou todas as rodadas foram feitas, ou a janela passou (com a tolerância da
 * última). Não se fecha antes: fechar às 02:00 em ponto com a rodada de
 * 01:30 ainda dentro da tolerância seria marcar como pulada a rodada de
 * quem estava a caminho.
 */
export function janelaFechou(rodadas: Rodada[], agoraMinuto: number): boolean {
  if (rodadas.length === 0) return false;
  if (rodadas.every((r) => r.concluida_em)) return true;
  const ultima = rodadas[rodadas.length - 1]!;
  return agoraMinuto > ultima.minuto + TOLERANCIA_MINUTOS;
}

export interface BalancoDaNoite {
  previstas: number;
  feitas: number;
  puladas: number;
  /** Feitas, mas depois da tolerância. */
  com_atraso: number;
}

/** O balanço da noite, para o resumo do gerente e para a linha do histórico. */
export function balancoDaNoite(rodadas: Rodada[], agoraMinuto: number): BalancoDaNoite {
  let feitas = 0;
  let puladas = 0;
  let comAtraso = 0;
  for (const r of rodadas) {
    if (r.concluida_em) {
      feitas += 1;
      if (r.minuto_feita !== null && r.minuto_feita > r.minuto + TOLERANCIA_MINUTOS) comAtraso += 1;
    } else if (estadoDa(r, agoraMinuto) === "atrasada") {
      puladas += 1;
    }
  }
  return { previstas: rodadas.length, feitas, puladas, com_atraso: comAtraso };
}

/**
 * A rodada concluída — o que se grava quando alguém termina o preenchimento.
 *
 * Devolve a lista nova, sem mexer na antiga: quem chama grava o resultado
 * inteiro na execução, e uma lista mutada pela metade num erro de gravação
 * seria uma rodada feita que o banco não conhece.
 */
export function concluirRodada(
  rodadas: Rodada[],
  numero: number,
  feita: { agoraIso: string; agoraMinuto: number; executor: string; respostas: RespostaItem[] },
): Rodada[] {
  return rodadas.map((r) =>
    r.numero === numero
      ? {
          ...r,
          iniciada_em: r.iniciada_em ?? feita.agoraIso,
          concluida_em: feita.agoraIso,
          minuto_feita: feita.agoraMinuto,
          executor_nome: feita.executor,
          respostas: feita.respostas,
        }
      : r,
  );
}

/** As rodadas cutucadas, marcadas — para não cutucar de novo. */
export function marcarCutucadas(rodadas: Rodada[], numeros: number[], agoraIso: string): Rodada[] {
  const alvo = new Set(numeros);
  return rodadas.map((r) => (alvo.has(r.numero) ? { ...r, cutucada_em: agoraIso } : r));
}
