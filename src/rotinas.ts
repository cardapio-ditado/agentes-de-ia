import { createHash, timingSafeEqual } from "node:crypto";
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
    // dia, e só de vez em quando (em média uma vez por hora) — a cada vez
    // era uma requisição a mais por minuto. Nunca estoura.
    if (Math.random() < 1 / 60) void cliente()
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

// ============================================================
// A batida dos ciclos — "a rotina rodou, e quando"
// ============================================================
//
// A trava acima diz quem COMEÇOU. Para quem vigia de fora, o que importa é
// outra pergunta: o ciclo chegou ao FIM, e chegou sem falha? Sem isto, o VPS
// cair de madrugada só aparecia quando o gerente reclamava que o checklist
// não chegou.
//
// Mora na mesma tabela, de propósito: o formato (rotina, janela, quando)
// serve, e não pede migração nova. A linha é sempre a mesma — rotina
// "batida:minuto", janela "ok" ou "falha" — regravada a cada volta.
//
// Detalhe que quem lê precisa saber: a limpeza de passagem apaga o que tem
// mais de um dia. Batida que some (idade `null` no /health) quer dizer "não
// roda há mais de um dia, ou nunca rodou" — é alarme, não é silêncio.

export type QualCiclo = "minuto" | "hora";
const CICLOS: QualCiclo[] = ["minuto", "hora"];
const PREFIXO_DA_BATIDA = "batida:";

/** Grava que o ciclo terminou agora — inteiro (`ok`) ou com alguma falha. */
export async function registrarBatida(qual: QualCiclo, semFalha: boolean, agora = new Date()): Promise<void> {
  try {
    const { error } = await cliente()
      .from("rotinas_reivindicadas")
      .upsert(
        { rotina: `${PREFIXO_DA_BATIDA}${qual}`, janela: semFalha ? "ok" : "falha", reivindicada_em: agora.toISOString() },
        { onConflict: "rotina,janela" },
      );
    // Sem a tabela não há onde bater; a trava já avisou disso uma vez.
    if (error && !ehMigracaoPendente(String(error.message))) {
      console.error(`[rotinas] não consegui registrar a batida de "${qual}": ${error.message}`);
    }
  } catch (e) {
    // A batida nunca derruba o ciclo que ela mede.
    console.error(`[rotinas] batida de "${qual}" falhou:`, e instanceof Error ? e.message : e);
  }
}

export interface IdadeDaBatida {
  /** Há quantos segundos o ciclo terminou inteiro pela última vez. `null`: mais de um dia, ou nunca. */
  ok_ha_segundos: number | null;
  /** Há quantos segundos terminou com alguma rotina falhando. `null`: nenhuma falha no último dia. */
  falha_ha_segundos: number | null;
}

/** As linhas da tabela viradas em idades, para o /health. Pura: o relógio vem de fora. */
export function idadesDasBatidas(
  linhas: Array<{ rotina?: unknown; janela?: unknown; reivindicada_em?: unknown }>,
  agora: Date,
): Record<QualCiclo, IdadeDaBatida> {
  const idades = Object.fromEntries(
    CICLOS.map((c) => [c, { ok_ha_segundos: null, falha_ha_segundos: null }]),
  ) as Record<QualCiclo, IdadeDaBatida>;
  for (const linha of linhas) {
    const qual = String(linha.rotina ?? "").slice(PREFIXO_DA_BATIDA.length) as QualCiclo;
    if (!String(linha.rotina ?? "").startsWith(PREFIXO_DA_BATIDA) || !CICLOS.includes(qual)) continue;
    const quando = Date.parse(String(linha.reivindicada_em ?? ""));
    if (!Number.isFinite(quando)) continue;
    // Relógio do banco um pouco adiantado não vira idade negativa.
    const segundos = Math.max(0, Math.round((agora.getTime() - quando) / 1000));
    if (linha.janela === "ok") idades[qual].ok_ha_segundos = segundos;
    else if (linha.janela === "falha") idades[qual].falha_ha_segundos = segundos;
  }
  return idades;
}

/**
 * As idades das batidas, lidas do banco. Nunca estoura: no /health, um banco
 * fora do ar já aparece em `banco`, e aqui vira `{ erro }` em vez de derrubar
 * a resposta inteira.
 */
export async function ultimasBatidas(agora = new Date()): Promise<Record<QualCiclo, IdadeDaBatida> | { erro: string }> {
  try {
    const { data, error } = await cliente()
      .from("rotinas_reivindicadas")
      .select("rotina, janela, reivindicada_em")
      .in("rotina", CICLOS.map((c) => `${PREFIXO_DA_BATIDA}${c}`));
    if (error) return { erro: ehMigracaoPendente(String(error.message)) ? "migração pendente" : "leitura falhou" };
    return idadesDasBatidas(data ?? [], agora);
  } catch {
    return { erro: "leitura falhou" };
  }
}

// ============================================================
// Quem pode mandar um ciclo rodar
// ============================================================

/**
 * O cabeçalho `Authorization` traz o segredo do cron?
 *
 * O cron da Vercel manda `Authorization: Bearer <CRON_SECRET>` quando a
 * variável existe no projeto. Sem segredo configurado a resposta é sempre
 * NÃO: rota que dispara rotina para todas as casas nunca fica aberta por
 * esquecimento de variável.
 *
 * A comparação é em tempo constante, e sobre o SHA-256 dos dois lados —
 * `timingSafeEqual` exige tamanhos iguais, e comparar o tamanho antes
 * contaria ao curioso quantos caracteres o segredo tem.
 */
export function segredoDoCronConfere(autorizacao: string | undefined, segredo: string | undefined): boolean {
  const esperado = (segredo ?? "").trim();
  if (!esperado) return false;
  const cabecalho = autorizacao ?? "";
  if (!cabecalho.startsWith("Bearer ")) return false;
  const resumo = (texto: string) => createHash("sha256").update(texto).digest();
  return timingSafeEqual(resumo(cabecalho.slice(7).trim()), resumo(esperado));
}

/** "minuto" ou "hora" — qualquer outra coisa não é ciclo. */
export function cicloValido(valor: string | null | undefined): QualCiclo | null {
  return valor === "minuto" || valor === "hora" ? valor : null;
}
