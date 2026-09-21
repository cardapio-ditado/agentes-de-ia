import { db, ehMigracaoPendente } from "./supabase.js";

/**
 * A TRAVA DAS ROTINAS DE FUNDO — um processo por vez.
 *
 * O servidor roda em vários processos no VPS (um conector por número de
 * WhatsApp e por casa), e todos acordam as mesmas rotinas no mesmo minuto.
 * Sem trava, quatro processos leem "1 aviso encalhado" ao mesmo tempo e o
 * dono recebe quatro mensagens iguais.
 *
 * A trava é um insert numa tabela com chave primária (rotina, janela). Só um
 * entra. Não há líder, não há configuração por processo, e não é preciso
 * saber quantos processos existem — ligar um quinto amanhã não muda nada.
 *
 * Banco ainda sem a migração: a trava deixa passar. Uma rotina rodar
 * duplicada por um dia é bem melhor do que não rodar nunca.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

/** A chave da janela: o instante arredondado para baixo, em minutos. */
export function janelaDe(agora: Date, minutos: number): string {
  const passo = Math.max(1, Math.floor(minutos));
  const epoch = Math.floor(agora.getTime() / 60_000);
  const inicio = new Date(Math.floor(epoch / passo) * passo * 60_000);
  return inicio.toISOString().slice(0, 16);
}

/**
 * Tenta reivindicar a rotina para esta janela. `true` = pode rodar.
 *
 * A janela deve ser um pouco MENOR que o intervalo da rotina: uma rotina de
 * hora em hora com janela de 60 min cairia, de vez em quando, com dois
 * processos em janelas vizinhas — o de 14:59:58 e o de 15:00:02 —, e os
 * dois rodariam. Com janela de 50 min isso não acontece.
 */
export async function reivindicar(rotina: string, janelaMinutos: number, agora = new Date()): Promise<boolean> {
  const janela = janelaDe(agora, janelaMinutos);
  const { error } = await cliente()
    .from("rotinas_reivindicadas")
    .insert({ rotina, janela, reivindicada_em: agora.toISOString() });

  if (!error) {
    // Limpeza de passagem: só quem ganhou a vez varre o que tem mais de um
    // dia. Nunca estoura — a rotina em si é o que importa.
    void cliente()
      .from("rotinas_reivindicadas")
      .delete()
      .lt("reivindicada_em", new Date(agora.getTime() - 86_400_000).toISOString())
      .then(() => undefined, () => undefined);
    return true;
  }
  // Chave duplicada: outro processo chegou antes nesta janela.
  if (String(error.code) === "23505" || /duplicate|unique/i.test(String(error.message))) return false;
  // Migração pendente: deixa passar, e avisa uma vez por processo.
  if (ehMigracaoPendente(String(error.message))) {
    if (!avisouMigracao) {
      console.warn("[rotinas] tabela rotinas_reivindicadas ainda não existe — as rotinas podem rodar duplicadas até a migração.");
      avisouMigracao = true;
    }
    return true;
  }
  console.error(`[rotinas] não consegui reivindicar "${rotina}": ${error.message}`);
  return true;
}

let avisouMigracao = false;
