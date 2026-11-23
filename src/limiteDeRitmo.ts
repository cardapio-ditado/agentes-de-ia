import { createHash } from "node:crypto";
import { LimiteDeRitmo } from "./cardapioDigital.js";
import { db, ehMigracaoPendente } from "./supabase.js";

/**
 * LIMITE DE RITMO QUE VALE NA VERCEL.
 *
 * O `LimiteDeRitmo` do cardápio mora na memória do processo — numa função
 * serverless, cada instância tem a sua, e o limite real vira "N por
 * instância". Para curtida de cardápio serve. Para tentativa de senha, não.
 *
 * Aqui o balde mora no banco (função `limite_de_ritmo_bater`, janela fixa,
 * ver a migração 20261114120500) e todas as instâncias batem no mesmo.
 *
 * A REGRA QUE MANDA: este limite NUNCA tranca ninguém por culpa do banco.
 * Banco lento, fora do ar, ou ainda sem a migração → vale o limite em
 * memória de sempre (que continua contando em paralelo, justamente para
 * estar quente quando for preciso). Um soluço do banco não pode virar
 * "ninguém consegue fazer login".
 */

/** O que o banco respondeu: coube, não coube, ou não deu para saber. */
export type RespostaDoBalde = { permitido: boolean } | { erro: string };

/** Quem bate no balde do banco. Trocável no teste. */
export type BaterNoBanco = (chave: string, maximo: number, janelaSegundos: number) => Promise<RespostaDoBalde>;

/** Quanto esperar pelo banco antes de decidir pela memória. */
const ESPERA_PELO_BANCO_MS = 1500;
/** Depois de um erro qualquer, quanto tempo ficar só na memória antes de tentar o banco de novo. */
const DESCANSO_APOS_ERRO_MS = 30_000;
/** Sem a migração não adianta insistir a cada chamada: tenta de novo de cinco em cinco minutos. */
const DESCANSO_SEM_MIGRACAO_MS = 5 * 60_000;

/**
 * A chave do balde, embaralhada: o nome do limite + quem bate (IP, e-mail,
 * token). O banco guarda só o SHA-256 — IP e e-mail de ninguém ficam numa
 * tabela por causa de um contador.
 */
export function chaveDoBalde(nome: string, quem: string): string {
  return createHash("sha256").update(`${nome}\n${quem.trim().toLowerCase()}`).digest("hex");
}

const baterNoSupabase: BaterNoBanco = async (chave, maximo, janelaSegundos) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- função fora do database.types.ts, como as outras rpc
  const { data, error } = await (db() as any).rpc("limite_de_ritmo_bater", {
    p_chave: chave,
    p_maximo: maximo,
    p_janela_segundos: janelaSegundos,
  });
  if (error) return { erro: String(error.message ?? error) };
  if (typeof data !== "boolean") return { erro: "resposta inesperada do banco" };
  return { permitido: data };
};

// O descanso é um só para todos os limites: o banco que não respondeu para
// um não vai responder para o outro.
let semBancoAte = 0;
let avisouMigracao = false;

/** Só para os testes: esquece o descanso entre um caso e outro. */
export function esquecerDescansoDoBanco(): void {
  semBancoAte = 0;
  avisouMigracao = false;
}

export class LimiteDuravel {
  private readonly memoria: LimiteDeRitmo;

  constructor(
    private readonly nome: string,
    private readonly maximo: number,
    private readonly janelaMs: number,
    private readonly bater: BaterNoBanco = baterNoSupabase,
    private readonly esperaMs: number = ESPERA_PELO_BANCO_MS,
  ) {
    this.memoria = new LimiteDeRitmo(maximo, janelaMs);
  }

  /** `true` = pode seguir. Nunca estoura. */
  async permitir(quem: string, agora = Date.now()): Promise<boolean> {
    // A memória conta SEMPRE: é o veredito de reserva, e precisa já estar
    // contando no instante em que o banco faltar.
    const naMemoria = this.memoria.permitir(quem.trim().toLowerCase(), agora);
    if (agora < semBancoAte) return naMemoria;

    let resposta: RespostaDoBalde;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    try {
      resposta = await Promise.race([
        this.bater(chaveDoBalde(this.nome, quem), this.maximo, Math.max(1, Math.round(this.janelaMs / 1000))),
        new Promise<RespostaDoBalde>((resolver) => {
          relogio = setTimeout(() => resolver({ erro: "o banco demorou" }), this.esperaMs);
        }),
      ]);
    } catch (e) {
      resposta = { erro: e instanceof Error ? e.message : String(e) };
    } finally {
      if (relogio) clearTimeout(relogio);
    }

    if ("permitido" in resposta) return resposta.permitido;

    // Daqui para baixo o banco não respondeu: abre para a memória.
    if (ehMigracaoPendente(resposta.erro)) {
      semBancoAte = agora + DESCANSO_SEM_MIGRACAO_MS;
      if (!avisouMigracao) {
        console.warn("[ritmo] função limite_de_ritmo_bater ainda não existe — o limite vale só em memória (por instância) até a migração.");
        avisouMigracao = true;
      }
    } else {
      semBancoAte = agora + DESCANSO_APOS_ERRO_MS;
      console.error(`[ritmo] o banco não respondeu ao limite "${this.nome}" (${resposta.erro}) — valendo o limite em memória.`);
    }
    return naMemoria;
  }
}

/**
 * Os limites das rotas públicas que não tinham nenhum.
 *
 * Os números são folgados para gente e apertados para script: ninguém erra a
 * senha trinta vezes em dez minutos, e a casa inteira atrás do mesmo Wi-Fi
 * (um IP só) não chega perto disso.
 */
export const LIMITES_DURAVEIS = {
  // Login: por IP (um script varrendo e-mails) e por e-mail (muitos IPs
  // tentando a mesma conta). O por e-mail é o que segura a força bruta
  // distribuída; o custo é conhecido — alguém pode trancar a conta de outro
  // por dez minutos errando de propósito.
  loginPorIp: new LimiteDuravel("login:ip", 30, 10 * 60_000),
  loginPorEmail: new LimiteDuravel("login:email", 10, 10 * 60_000),
  // Trabalhe conosco: o link fica no balcão, vários candidatos pelo Wi-Fi da casa.
  vaga: new LimiteDuravel("vaga", 10, 10 * 60_000),
  // Foto do checklist: por execução (o token) e por IP. Um checklist grande
  // tem dezenas de fotos e a equipe toda divide o IP da casa.
  fotoPorExecucao: new LimiteDuravel("checklist-foto:execucao", 80, 10 * 60_000),
  fotoPorIp: new LimiteDuravel("checklist-foto:ip", 300, 10 * 60_000),
  // Documento da ficha: cada um chama a IA para conferir. Uma admissão tem
  // meia dúzia de documentos, com uma ou outra foto refeita.
  documentoPorConvite: new LimiteDuravel("ficha-documento:convite", 20, 10 * 60_000),
  documentoPorIp: new LimiteDuravel("ficha-documento:ip", 60, 10 * 60_000),
  // Webhook do Mercado Pago: cada aviso vira uma consulta à API deles com o
  // token da casa. Folgado para um sábado cheio, apertado para enxurrada.
  mercadoPagoPorIp: new LimiteDuravel("mercadopago:ip", 120, 60_000),
  mercadoPagoPorCasa: new LimiteDuravel("mercadopago:casa", 600, 60_000),
  // Reservas vindas do formulário da casa (outro sistema avisa por webhook).
  // O formulário de lá já limita por telefone; aqui é a trava contra
  // enxurrada e contra quem fica tentando adivinhar a chave.
  reservasDoLinkPorIp: new LimiteDuravel("reservas-link:ip", 60, 60_000),
  reservasDoLinkPorCasa: new LimiteDuravel("reservas-link:casa", 240, 60_000),
};
