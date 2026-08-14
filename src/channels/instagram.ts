import { createHmac, timingSafeEqual } from "node:crypto";
import { runAgent } from "../agent.js";
import { enviarPorInstagram, instagramConfigurado } from "../notifications.js";

/**
 * Canal Instagram — API oficial de mensagens da Meta (login pelo Instagram).
 *
 * Ao contrário do WhatsApp/Baileys, aqui não há processo persistente nem QR:
 * a Meta entrega cada DM por webhook (HTTPS puro, roda na Vercel) e a
 * resposta sai pela Graph API com um token. Sem risco de banimento — é o
 * caminho sancionado.
 *
 * Configuração (.env / variáveis na Vercel):
 *   INSTAGRAM_ACCESS_TOKEN  — token da conta profissional (gerado no app da Meta)
 *   INSTAGRAM_APP_SECRET    — valida a assinatura dos webhooks
 *   INSTAGRAM_VERIFY_TOKEN  — string qualquer, a mesma colada no painel da Meta
 *   INSTAGRAM_AGENT         — slug do agente que atende este canal
 *   INSTAGRAM_VENUE         — slug do estabelecimento
 *
 * A janela de 24h da Meta se aplica: o agente responde quem escreveu por
 * último em até 24 horas — exatamente o caso de uso de atendimento.
 */

interface EventoMensagem {
  sender?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: unknown[];
  };
}

interface CorpoWebhook {
  object?: string;
  entry?: Array<{ messaging?: EventoMensagem[] }>;
}

function config() {
  return {
    token: process.env.INSTAGRAM_ACCESS_TOKEN,
    appSecret: process.env.INSTAGRAM_APP_SECRET,
    verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN,
    agent: process.env.INSTAGRAM_AGENT,
    venue: process.env.INSTAGRAM_VENUE,
    versao: process.env.INSTAGRAM_API_VERSION ?? "v23.0",
  };
}

/** Para a aba Canais: o que está (ou não) configurado, sem expor segredos. */
export function estadoInstagram(): {
  configurado: boolean;
  faltando: string[];
  agente: string | null;
  venue: string | null;
} {
  const cfg = config();
  const faltando = (
    [
      ["INSTAGRAM_ACCESS_TOKEN", cfg.token],
      ["INSTAGRAM_APP_SECRET", cfg.appSecret],
      ["INSTAGRAM_VERIFY_TOKEN", cfg.verifyToken],
      ["INSTAGRAM_AGENT", cfg.agent],
      ["INSTAGRAM_VENUE", cfg.venue],
    ] as const
  )
    .filter(([, valor]) => !valor)
    .map(([nome]) => nome);

  return {
    configurado: faltando.length === 0,
    faltando,
    agente: cfg.agent ?? null,
    venue: cfg.venue ?? null,
  };
}

/**
 * Etapa de verificação do webhook (GET da Meta ao salvar a URL).
 * Devolve o challenge a ecoar, ou null para recusar.
 */
export function verificarWebhook(params: URLSearchParams): string | null {
  const cfg = config();
  if (!cfg.verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== cfg.verifyToken) return null;
  return params.get("hub.challenge");
}

/** Assinatura HMAC-SHA256 do corpo cru, enviada em X-Hub-Signature-256. */
export function assinaturaValida(corpoBruto: Buffer, cabecalho: string | undefined): boolean {
  const cfg = config();
  if (!cfg.appSecret || !cabecalho?.startsWith("sha256=")) return false;

  const esperada = createHmac("sha256", cfg.appSecret).update(corpoBruto).digest();
  const recebida = Buffer.from(cabecalho.slice("sha256=".length), "hex");
  return esperada.length === recebida.length && timingSafeEqual(esperada, recebida);
}

/** Nome e @usuário do interlocutor, para a inbox. Falha vira null, nunca erro. */
async function buscarPerfil(
  igsid: string,
): Promise<{ nome: string | null; usuario: string | null }> {
  const cfg = config();
  try {
    const resposta = await fetch(
      `https://graph.instagram.com/${cfg.versao}/${igsid}?fields=name,username`,
      {
        headers: { authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!resposta.ok) return { nome: null, usuario: null };
    const dados = (await resposta.json()) as { name?: string; username?: string };
    return { nome: dados.name ?? null, usuario: dados.username ?? null };
  } catch {
    return { nome: null, usuario: null };
  }
}

/**
 * Processa um lote de eventos do webhook: roda o agente e responde o DM.
 *
 * Sempre resolve — erros são logados, nunca propagados: devolver 5xx à Meta
 * dispara tempestade de reentregas, e a mensagem duplicada é pior que a
 * mensagem perdida (o cliente reenvia sozinho quando não é respondido).
 */
export async function processarWebhookInstagram(corpo: CorpoWebhook): Promise<void> {
  if (corpo.object !== "instagram") return;
  const cfg = config();
  if (!cfg.agent || !cfg.venue || !instagramConfigurado()) {
    console.error("[instagram] webhook recebido, mas o canal não está totalmente configurado.");
    return;
  }

  for (const entry of corpo.entry ?? []) {
    for (const evento of entry.messaging ?? []) {
      try {
        await processarEvento(evento, cfg.agent, cfg.venue);
      } catch (e) {
        console.error("[instagram] falha ao processar evento:", e);
      }
    }
  }
}

async function processarEvento(
  evento: EventoMensagem,
  agentSlug: string,
  venueSlug: string,
): Promise<void> {
  const igsid = evento.sender?.id;
  const mensagem = evento.message;
  // Ecos (mensagens enviadas por nós), reações e confirmações de leitura
  // chegam pelo mesmo webhook — só DM de cliente interessa.
  if (!igsid || !mensagem || mensagem.is_echo) return;

  const texto = mensagem.text?.trim();
  if (!texto) {
    if (mensagem.attachments?.length) {
      await enviarPorInstagram(
        igsid,
        "Recebi sua mídia! Consigo te ajudar melhor por texto — me conta o que você precisa?",
      );
    }
    return;
  }

  const perfil = await buscarPerfil(igsid);
  console.log(`[instagram] ${perfil.usuario ?? igsid}: ${texto.slice(0, 80)}`);

  const resultado = await runAgent({
    agentSlug,
    venueSlug,
    userMessage: texto,
    channel: "instagram",
    externalId: igsid,
    contato: {
      nome: perfil.nome ?? perfil.usuario,
      telefone: perfil.usuario ? `@${perfil.usuario}` : null,
    },
  });

  const envio = await enviarPorInstagram(
    igsid,
    resultado.text || "Desculpe, não consegui responder agora. Pode tentar de novo?",
  );
  if (!envio.enviado) {
    console.error(`[instagram] falha ao responder ${igsid}: ${envio.erro}`);
  }
}
