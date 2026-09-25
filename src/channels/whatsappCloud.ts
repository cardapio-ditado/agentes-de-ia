import { createHmac, timingSafeEqual } from "node:crypto";
import { runAgent } from "../agent.js";
import { conversaAtendidaPorHumano, registrarRecebidoSemResposta } from "../inbox.js";
import { enviarPelaCloudApi } from "../notifications.js";
import { PlanoBloqueadoError } from "../pontos.js";
import { conexaoPeloNumero, type ConexaoOficial } from "../whatsappOficial.js";
import { contextoDoDisparo, registrarResposta, registrarStatusDaMeta, retratoParaOAgente } from "../disparos.js";
import { obterClientePorTelefone } from "../clientes.js";
import { retratoDe } from "../crm.js";
import { findVenueBySlug } from "../venues.js";
import { hojeNaCasa } from "../fuso.js";

/**
 * Canal WhatsApp oficial — Cloud API da Meta.
 *
 * O Baileys (canal não oficial) precisa de um processo vivo com a sessão do
 * número; aqui não: a Meta entrega cada mensagem por webhook (HTTPS puro,
 * roda na Vercel) e a resposta sai pela Graph API com o token da casa.
 * Sem QR, sem computador ligado, sem risco de banimento.
 *
 * O QUE É DO APP e o que é DA CASA:
 *
 *   do app (variáveis na Vercel, um app da Meta para o sistema inteiro):
 *     WHATSAPP_VERIFY_TOKEN  — string que você inventa e cola no painel da Meta
 *     WHATSAPP_APP_SECRET    — App Secret do app (cai em INSTAGRAM_APP_SECRET)
 *
 *   da casa (tabela whatsapp_oficial, preenchida em Ajustes > WhatsApp da
 *   casa): token, ID do telefone, ID da conta e o agente que responde.
 *   O webhook é um só; ele descobre a casa pelo phone_number_id de cada
 *   mensagem. Ver src/whatsappOficial.ts — inclusive para as variáveis
 *   antigas (WHATSAPP_TOKEN etc.), que seguem valendo como conexão da casa
 *   que WHATSAPP_CLOUD_VENUE nomeia.
 *
 * A janela de 24h da Meta: mensagem livre só é aceita para quem escreveu nas
 * últimas 24 horas. Atendimento é exatamente isso.
 *
 * O externalId da conversa é o número em dígitos ("5565999990000"). O Baileys
 * usa o jid ("5565999990000@s.whatsapp.net"): são conversas diferentes na
 * inbox de propósito — o cliente que falou com o número não oficial e agora
 * fala com o oficial está em outro número da casa.
 */

interface MensagemRecebida {
  id?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  text?: { body?: string };
  image?: unknown;
  video?: unknown;
  audio?: unknown;
  document?: unknown;
  sticker?: unknown;
  location?: unknown;
  contacts?: unknown;
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  /** A mensagem citada — quando a pessoa responde "em cima" de um disparo. */
  context?: { id?: string };
}

interface StatusRecebido {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: Array<{ title?: string; message?: string }>;
}

interface Contato {
  wa_id?: string;
  profile?: { name?: string };
}

interface CorpoWebhook {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Contato[];
        messages?: MensagemRecebida[];
        statuses?: StatusRecebido[];
      };
    }>;
  }>;
}

function config() {
  return {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET || process.env.INSTAGRAM_APP_SECRET,
  };
}

/**
 * O webhook do app está pronto para receber a Meta? É o que a equipe Brasa
 * Food configura uma vez; o resto é de cada casa.
 */
export function estadoWhatsappCloud(): { webhook_pronto: boolean; faltando: string[] } {
  const cfg = config();
  const faltando = (
    [
      ["WHATSAPP_VERIFY_TOKEN", cfg.verifyToken],
      ["WHATSAPP_APP_SECRET", cfg.appSecret],
    ] as const
  )
    .filter(([, valor]) => !valor)
    .map(([nome]) => nome);
  return { webhook_pronto: faltando.length === 0, faltando };
}

/**
 * Etapa de verificação do webhook (GET da Meta ao salvar a URL).
 * Devolve o challenge a ecoar, ou null para recusar.
 */
export function verificarWebhookWhatsapp(params: URLSearchParams): string | null {
  const cfg = config();
  if (!cfg.verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== cfg.verifyToken) return null;
  return params.get("hub.challenge");
}

/** Assinatura HMAC-SHA256 do corpo cru, enviada em X-Hub-Signature-256. */
export function assinaturaWhatsappValida(corpoBruto: Buffer, cabecalho: string | undefined): boolean {
  const cfg = config();
  if (!cfg.appSecret || !cabecalho?.startsWith("sha256=")) return false;

  const esperada = createHmac("sha256", cfg.appSecret).update(corpoBruto).digest();
  const recebida = Buffer.from(cabecalho.slice("sha256=".length), "hex");
  return esperada.length === recebida.length && timingSafeEqual(esperada, recebida);
}

/** O texto que o cliente mandou, ou null quando não há texto (mídia, áudio…). */
export function textoDaMensagem(m: MensagemRecebida): string | null {
  const texto =
    m.text?.body ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    null;
  const limpo = texto?.trim();
  return limpo ? limpo : null;
}

/** "[foto recebida]", "[áudio recebido]"… para a inbox e para a resposta de acolhida. */
export function descreverMidia(m: MensagemRecebida): { registro: string; acolhida: string } {
  if (m.image) return { registro: "[foto recebida]", acolhida: "Recebi sua foto! Consigo te ajudar melhor por texto — me conta o que você precisa?" };
  if (m.video) return { registro: "[vídeo recebido]", acolhida: "Recebi seu vídeo! Consigo te ajudar melhor por texto — me conta o que você precisa?" };
  if (m.audio) return { registro: "[áudio recebido]", acolhida: "Por aqui ainda não consigo ouvir áudio. Pode escrever? Respondo na hora." };
  if (m.document) return { registro: "[documento recebido]", acolhida: "Recebi seu arquivo! Me conta por texto o que você precisa?" };
  if (m.location) return { registro: "[localização recebida]", acolhida: "Recebi sua localização! Me conta o que você precisa?" };
  if (m.sticker) return { registro: "[figurinha recebida]", acolhida: "😄 Me conta por texto o que você precisa?" };
  return { registro: "[mensagem sem texto recebida]", acolhida: "Por enquanto consigo ler só mensagens de texto. Pode escrever?" };
}

/**
 * Mensagens já processadas nesta instância.
 *
 * A Meta reenvia o mesmo evento quando não recebe 200 a tempo, e "a tempo"
 * é apertado para uma resposta de agente. Sem isto, a segunda entrega faria
 * o agente responder duas vezes à mesma pergunta. Memória por instância:
 * na Vercel cada instância tem a sua, o que já cobre o caso comum (a
 * reentrega cai na mesma instância ainda quente).
 */
const vistas = new Set<string>();
function jaVista(id: string | undefined): boolean {
  if (!id) return false;
  if (vistas.has(id)) return true;
  vistas.add(id);
  if (vistas.size > 5000) {
    const [primeira] = vistas;
    if (primeira) vistas.delete(primeira);
  }
  return false;
}

/**
 * Processa um lote de eventos do webhook: roda o agente e responde.
 *
 * Sempre resolve — erros são logados, nunca propagados: devolver 5xx à Meta
 * dispara tempestade de reentregas, e a mensagem duplicada é pior que a
 * mensagem perdida (o cliente reenvia sozinho quando não é respondido).
 */
export async function processarWebhookWhatsapp(corpo: CorpoWebhook): Promise<{ mensagens: number }> {
  if (corpo.object !== "whatsapp_business_account") return { mensagens: 0 };

  let mensagens = 0;
  for (const entry of corpo.entry ?? []) {
    for (const mudanca of entry.changes ?? []) {
      if (mudanca.field !== "messages") continue;
      const valor = mudanca.value;

      // "Entregue", "lida", "falhou": a Meta conta o que aconteceu com cada
      // disparo. Chega no mesmo campo, sem mensagem nenhuma junto.
      for (const s of valor?.statuses ?? []) {
        await registrarStatusDaMeta(s).catch((e) => console.error("[whatsapp-cloud] status:", e));
      }
      if (!valor?.messages?.length) continue;

      // De que casa é este número? Um app da Meta tem vários números, e o
      // webhook é um só para todos eles.
      const numero = valor.metadata?.phone_number_id;
      const conexao = await conexaoPeloNumero(numero);
      if (!conexao) {
        console.error(`[whatsapp-cloud] mensagem para o telefone ${numero ?? "?"}, que não é de nenhuma casa.`);
        continue;
      }
      if (!conexao.agent_slug) {
        console.log(`[whatsapp-cloud] ${conexao.venue_slug}: o número oficial só envia — ninguém responde.`);
        continue;
      }

      const nomes = new Map((valor.contacts ?? []).map((c) => [c.wa_id, c.profile?.name?.trim() || null]));
      for (const m of valor.messages) {
        mensagens += 1;
        try {
          await processarMensagem(m, nomes.get(m.from) ?? null, conexao as ConexaoAtendida);
        } catch (e) {
          console.error("[whatsapp-cloud] falha ao processar mensagem:", e);
        }
      }
    }
  }
  return { mensagens };
}

type ConexaoAtendida = ConexaoOficial & { venue_slug: string; agent_slug: string; token: string; phone_number_id: string };

async function processarMensagem(m: MensagemRecebida, nome: string | null, conexao: ConexaoAtendida): Promise<void> {
  const agentSlug = conexao.agent_slug;
  const venueSlug = conexao.venue_slug;
  const telefone = m.from?.replace(/\D/g, "");
  if (!telefone || jaVista(m.id)) return;

  const texto = textoDaMensagem(m);
  if (!texto) {
    const midia = descreverMidia(m);
    // Mesma regra do Baileys: com uma pessoa no comando, o robô não agradece
    // a foto — registra que chegou e fica quieto.
    const humana = await conversaAtendidaPorHumano({ agentSlug, channel: "whatsapp", externalId: telefone });
    if (humana) {
      await registrarRecebidoSemResposta(humana.id, midia.registro).catch(() => undefined);
      console.log(`[whatsapp-cloud] ${telefone}: mídia numa conversa com pessoa — não respondi.`);
      return;
    }
    await enviarPelaCloudApi(telefone, midia.acolhida, conexao);
    return;
  }

  console.log(`[whatsapp-cloud] ${nome ?? "?"} (${telefone}): ${texto.slice(0, 80)}`);

  const contextoExtra = await oQueOSistemaSabe(conexao, telefone, m, texto).catch((e) => {
    console.error("[whatsapp-cloud] contexto:", e);
    return null;
  });

  let resultado;
  try {
    resultado = await runAgent({
      agentSlug,
      venueSlug,
      userMessage: texto,
      channel: "whatsapp",
      externalId: telefone,
      contato: { nome, telefone },
      contextoExtra,
    });
  } catch (e) {
    // Plano travado não é falha técnica: o cliente do bar não pode ficar sem
    // resposta nenhuma, e a conversa já foi passada para atendimento humano.
    if (e instanceof PlanoBloqueadoError) {
      await enviarPelaCloudApi(telefone, "Recebi sua mensagem! Alguém da equipe vai te responder em instantes.", conexao);
      return;
    }
    throw e;
  }

  if (!resultado.respondeu) {
    console.log(`[whatsapp-cloud] ${telefone}: atendimento é humano, não respondi.`);
    return;
  }

  const envio = await enviarPelaCloudApi(telefone, resultado.text || "Desculpe, não consegui responder agora. Pode tentar de novo?", conexao);
  if (!envio.enviado) {
    console.error(`[whatsapp-cloud] falha ao responder ${telefone}: ${envio.erro}`);
  }
}

/**
 * O que o sistema sabe e o cliente não disse.
 *
 * Duas coisas, e as duas mudam a resposta: quem é esta pessoa para a casa
 * (VIP? sumiu?) e se ela está respondendo a um disparo — e a qual. Sem
 * isto, a cliente que responde "quero!" à promoção ouve "Olá! Como posso
 * ajudar?", que é o mesmo que ser atendida por quem não leu o próprio
 * recado.
 */
async function oQueOSistemaSabe(
  conexao: ConexaoAtendida,
  telefone: string,
  m: MensagemRecebida,
  texto: string,
): Promise<string | null> {
  // Pelo slug, e não pelo id: a conexão das variáveis de ambiente não tem
  // o id da casa.
  const venue = await findVenueBySlug(conexao.venue_slug);
  const partes: string[] = [];

  const pessoa = await obterClientePorTelefone(venue.id, telefone);
  if (pessoa) partes.push(retratoParaOAgente(pessoa, retratoDe(pessoa, hojeNaCasa(venue.timezone))));

  const botao = m.button?.text ?? m.interactive?.button_reply?.title ?? null;
  const resposta = await registrarResposta(venue.id, telefone, { contextoId: m.context?.id ?? null, texto, botao });
  if (resposta) {
    partes.push(contextoDoDisparo(resposta.disparo, resposta.envio, venue.name, venue.timezone, botao));
  }
  return partes.length ? partes.join("\n") : null;
}
