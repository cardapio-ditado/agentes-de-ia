import { cuidarDasRodadas, dispararChecklistsAgendados } from "./checklists.js";
import { lembrarReservasProximas } from "./lembretes.js";
import { varrerAniversarios } from "./aniversarios.js";
import { varrerAvisosEncalhados } from "./avisosEncalhados.js";
import { cuidarDosDisparos } from "./disparos.js";
import { cuidarDoDelivery } from "./delivery.js";
import { enviarPendentesPeloOficial } from "./filaOficial.js";
import { registrarBatida, reivindicar, type QualCiclo } from "./rotinas.js";
import { renovarTokens as renovarTokensDoInstagram } from "./instagramOficial.js";
import { sincronizarRecentes as sincronizarAvaliacoesDoGoogle } from "./avaliacoesMake.js";
import { cicloDasVendasDaZig } from "./cmv/vendasZig.js";
import { varrerHistorico } from "./historicoZig.js";
import { cicloDiarioDoCmv } from "./cmv/avisos.js";
import { cicloDaExperiencia } from "./rhPessoa.js";
import { cicloDaPesquisaZig, varrerBaseDeClientes } from "./pesquisaZig.js";

/**
 * OS CICLOS DE FUNDO — o que roda de minuto em minuto e de hora em hora.
 *
 * Moravam dentro de `src/server.ts`, presos ao `setInterval` do processo do
 * VPS: se aquele processo morresse, checklist, lembrete de reserva, disparo,
 * delivery e as varreduras da hora paravam todos juntos, sem um aviso. Aqui
 * eles são funções que qualquer um chama — o relógio do VPS (como sempre) e
 * a rota `/v1/rotinas/ciclo/…`, que o cron da Vercel bate. Quem chega
 * primeiro na janela roda; o outro desiste na trava (`reivindicar`).
 *
 * NADA aqui depende do WhatsApp deste processo: as rotinas só leem o banco e
 * ENFILEIRAM avisos (ou mandam pelo número oficial, que é HTTP). O que
 * precisa do socket do Baileys aberto — a ponte com o painel e a entrega da
 * fila de avisos pelo número conectado por QR — continua em `server.ts` e em
 * `channels/whatsapp.ts`, e só existe no processo longo.
 *
 * No fim de cada volta o ciclo bate o ponto (`registrarBatida`), e o /health
 * mostra a idade da batida para um monitor de fora alarmar.
 */

export interface ResultadoDoCiclo {
  /** `false`: outro processo já tinha pegado esta janela (ou este ainda estava na volta anterior). */
  rodou: boolean;
  /** As rotinas que falharam nesta volta, pelo nome que aparece no log. */
  falhas: string[];
}

const mensagemDe = (e: unknown): unknown => (e instanceof Error ? e.message : e);

// ============================================================
// De minuto em minuto
// ============================================================
// Cria as execuções de checklist cujo horário chegou e enfileira o link no
// WhatsApp do responsável, cuida das rodadas, dos lembretes de reserva, dos
// disparos, do delivery e da fila do oficial. Idempotente: rodar de novo no
// mesmo minuto não duplica nada.

let minutoEmAndamento = false;

export async function cicloDoMinuto(): Promise<ResultadoDoCiclo> {
  if (minutoEmAndamento) return { rodou: false, falhas: [] };
  minutoEmAndamento = true;
  try {
    // UM processo por minuto faz o minuto inteiro: os quatro conectores do VPS
    // faziam as mesmas leituras no mesmo minuto, e tudo aqui é global e
    // idempotente (nada depende do WhatsApp deste processo).
    let souOAgendador = true;
    try {
      souOAgendador = await reivindicar("minuto", 1);
    } catch {
      // Sem a trava, roda: melhor repetir a leitura do que não disparar.
    }
    if (!souOAgendador) return { rodou: false, falhas: [] };

    const falhas: string[] = [];
    // Cada trabalho no seu próprio try, de propósito: uma falha no checklist
    // não pode impedir o lembrete de reserva de sair, e vice-versa. São
    // trabalhos que só dividem o relógio.
    const passo = async (nome: string, oQueFalhou: string, trabalho: () => Promise<void>): Promise<void> => {
      try {
        await trabalho();
      } catch (e) {
        falhas.push(nome);
        console.error(`[${nome}] ${oQueFalhou}:`, mensagemDe(e));
      }
    };

    await passo("checklists", "agendador falhou", async () => {
      await dispararChecklistsAgendados();
    });
    // As rodadas têm o seu próprio relógio: cutucar quem atrasou e fechar a
    // noite.
    await passo("checklists", "relógio das rodadas falhou", async () => {
      const r = await cuidarDasRodadas();
      if (r.cutucadas || r.fechadas) {
        console.log(`[checklists] rodadas: ${r.cutucadas} cutucada(s), ${r.fechadas} noite(s) fechada(s).`);
      }
    });
    await passo("lembretes", "varredura falhou", async () => {
      const quantos = await lembrarReservasProximas();
      if (quantos > 0) console.log(`[lembretes] ${quantos} lembrete(s) na fila.`);
    });
    // E os disparos pelo número oficial: um lote por disparo por minuto, que
    // é o ritmo que protege o número.
    await passo("disparos", "relógio falhou", async () => {
      const r = await cuidarDosDisparos();
      if (r.concluidos) console.log(`[disparos] ${r.concluidos} disparo(s) concluído(s).`);
    });
    // O delivery: derruba o pedido que ninguém pagou (devolvendo cupom e
    // cashback) e lembra, uma vez, a sacola esquecida no WhatsApp.
    await passo("delivery", "relógio falhou", async () => {
      const r = await cuidarDoDelivery();
      if (r.expirados || r.lembrados) {
        console.log(`[delivery] ${r.expirados} pedido(s) sem pagamento cancelado(s), ${r.lembrados} sacola(s) lembrada(s).`);
      }
    });
    // E os avisos com modelo (parabéns, convite da pesquisa) pelo oficial,
    // sem depender do conector estar conectado.
    await passo("fila-oficial", "relógio falhou", async () => {
      await enviarPendentesPeloOficial();
    });

    await registrarBatida("minuto", falhas.length === 0);
    return { rodou: true, falhas };
  } finally {
    minutoEmAndamento = false;
  }
}

// ============================================================
// De hora em hora
// ============================================================
// A foto diária do estoque, o lembrete de contagem e as varreduras. Pode
// rodar mais de uma vez por dia sem estrago — o snapshot é upsert por dia e
// o lembrete tem índice único; a repetição é a resiliência contra o servidor
// ter estado fora do ar na hora "certa".

export async function cicloDaHora(): Promise<ResultadoDoCiclo> {
  // Um processo por hora faz a hora inteira (janela de 50 min: o relógio de
  // cada processo anda um pouco diferente). Antes, os quatro faziam tudo.
  if (!(await reivindicar("hora", 50).catch(() => true))) return { rodou: false, falhas: [] };

  const falhas: string[] = [];
  // Todas partem JUNTAS e cada uma falha sozinha, como sempre foi. A
  // diferença é que agora a função espera todas terminarem: numa função
  // serverless, o que fica rodando depois da resposta é congelado no meio.
  const rotina = (nome: string, oQue: string, trabalho: () => Promise<unknown>): Promise<void> =>
    trabalho().then(
      () => undefined,
      (e: unknown) => {
        falhas.push(nome);
        console.error(`[${nome}] ${oQue}:`, e);
      },
    );

  await Promise.all([
    rotina("cmv", "varredura diária", cicloDiarioDoCmv),
    // No mesmo relógio, em falha separada: quem esteve na casa ontem (segundo
    // a Zig) recebe o convite da pesquisa. `ultimo_dia` + índice único seguram
    // a repetição — rodar de hora em hora é resiliência, não risco.
    rotina("pesquisa-zig", "varredura", cicloDaPesquisaZig),
    // E o parabéns de aniversário, também em falha separada. A trava de um por
    // ano é índice único no banco: rodar de hora em hora não manda de novo.
    rotina("aniversarios", "varredura", varrerAniversarios),
    // E a base de clientes enche sozinha pela Zig, sem mandar nada e sem
    // depender do módulo da pesquisa: a trava (cliente, dia) no banco absorve a
    // repetição, então rodar de hora em hora é resiliência.
    rotina("clientes-zig", "varredura", varrerBaseDeClientes),
    // E o histórico da base de clientes: enquanto há dia faltando na janela de
    // um ano, ela carrega o passado; depois vira a rede de segurança do dia a
    // dia. Antes disto, dia em que o servidor esteve fora do ar era perdido
    // para sempre — a varredura diária só sabe pedir "ontem".
    rotina("historico-zig", "varredura", varrerHistorico),
    // E, no mesmo relógio, a fila de avisos olha para si mesma: o que não
    // chegou ao cliente vira mensagem para o dono. A casa já perdeu uma
    // confirmação de reserva que ficou trinta dias parada sem ninguém saber.
    rotina("encalhados", "varredura", varrerAvisosEncalhados),
    // E os tokens do Instagram conectado por login: a Meta dá 60 dias, e o
    // relógio renova quando faltam 30. Token vencido é agente mudo sem
    // ninguém saber — e o dono só descobre pela reclamação do cliente.
    rotina("instagram", "renovação de tokens", renovarTokensDoInstagram),
    // E as avaliações do Google: a cada tantas horas, pede ao Make a primeira
    // página de cada casa ligada. Avaliação nova entra e é respondida pela
    // regra. O gatilho "vigiar" do Make não serve: percorre o histórico
    // inteiro desde 2014 e come a cota do plano antes de chegar na de hoje.
    rotina("google", "sincronização das recentes", () => cicloDasAvaliacoesDoGoogle({ comTrava: true })),
    // E as vendas de ontem, pela API da Zig, direto no estoque: a partir das 6h
    // da casa, uma importação por dia, casada com o vocabulário da casa e
    // baixada sozinha quando não sobra nada para alguém decidir.
    rotina("vendas-zig", "varredura", cicloDasVendasDaZig),
    // E o contrato de experiência: a partir das 9h da casa, quem vence em até
    // 7 dias vira uma mensagem para o gestor. Uma por dia, trava na fila.
    rotina("rh", "aviso de experiência", cicloDaExperiencia),
  ]);

  await registrarBatida("hora", falhas.length === 0);
  return { rodou: true, falhas };
}

const HORAS_ENTRE_SINCRONIZACOES_DO_GOOGLE = Math.max(1, Number(process.env.GOOGLE_SINCRONIZAR_CADA_HORAS) || 4);
let ultimaSincronizacaoDoGoogle = 0;

/**
 * As avaliações do Google, no máximo uma vez a cada tantas horas.
 *
 * O intervalo era guardado só na memória do processo. No VPS basta; numa
 * função serverless a memória some entre uma chamada e outra, e o ciclo da
 * hora pediria ao Make TODA hora — quatro vezes a cota combinada. Por isso,
 * dentro do ciclo (`comTrava`), além da memória há a trava do banco, com a
 * janela do tamanho do intervalo. A chamada da subida do servidor continua
 * só com a memória, como era: reiniciar o VPS sincroniza na hora.
 */
export async function cicloDasAvaliacoesDoGoogle(opcoes: { comTrava?: boolean } = {}): Promise<void> {
  const agora = Date.now();
  if (agora - ultimaSincronizacaoDoGoogle < HORAS_ENTRE_SINCRONIZACOES_DO_GOOGLE * 60 * 60_000 - 60_000) return;
  if (opcoes.comTrava) {
    const livre = await reivindicar("google-avaliacoes", HORAS_ENTRE_SINCRONIZACOES_DO_GOOGLE * 60).catch(() => true);
    if (!livre) return;
  }
  ultimaSincronizacaoDoGoogle = agora;
  const r = await sincronizarAvaliacoesDoGoogle();
  if (r.pedidas) console.log(`[google] pedi as avaliações recentes de ${r.pedidas} casa(s) ao Make.`);
  for (const f of r.falhas) console.error(`[google] sincronização não pedida — ${f}`);
}

/** O ciclo pelo nome — é o que a rota do cron recebe. */
export function rodarCiclo(qual: QualCiclo): Promise<ResultadoDoCiclo> {
  return qual === "minuto" ? cicloDoMinuto() : cicloDaHora();
}
