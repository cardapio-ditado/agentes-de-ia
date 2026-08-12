import { createHmac } from "node:crypto";
import { db } from "./supabase.js";
import type { Json, Tables } from "./database.types.js";

export type Webhook = Tables<"webhooks">;

/** Eventos que a plataforma publica. */
export type WebhookEvent =
  | "reservation.created"
  | "reservation.approved"
  | "reservation.rejected";

const MAX_TENTATIVAS = 5;
const TIMEOUT_MS = 10_000;

/**
 * Assinatura no padrão `t=<timestamp>,v1=<hmac>`.
 *
 * O timestamp entra no conteúdo assinado para que uma entrega capturada não
 * possa ser reenviada mais tarde: o receptor rejeita o que for muito antigo.
 */
export function assinar(segredo: string, timestamp: number, corpo: string): string {
  const hmac = createHmac("sha256", segredo).update(`${timestamp}.${corpo}`).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

/**
 * Publica um evento para todos os webhooks da organização inscritos nele.
 *
 * Nunca lança: uma integração externa fora do ar não pode derrubar a operação
 * do restaurante. As falhas ficam registradas em `webhook_deliveries`.
 */
export async function dispatchWebhooks(
  orgId: string,
  event: WebhookEvent,
  payload: Record<string, Json>,
): Promise<void> {
  try {
    const { data: webhooks, error } = await db()
      .from("webhooks")
      .select("*")
      .eq("org_id", orgId)
      .eq("active", true)
      .contains("events", [event]);

    if (error) throw new Error(error.message);
    if (!webhooks || webhooks.length === 0) return;

    await Promise.all(webhooks.map((webhook) => entregar(webhook, event, payload)));
  } catch (e) {
    console.error(`[webhooks] falha ao publicar "${event}": ${mensagem(e)}`);
  }
}

async function entregar(
  webhook: Webhook,
  event: WebhookEvent,
  payload: Record<string, Json>,
): Promise<void> {
  const corpo = JSON.stringify({ event, created_at: new Date().toISOString(), data: payload });

  const { data: entrega, error } = await db()
    .from("webhook_deliveries")
    .insert({ webhook_id: webhook.id, event, payload })
    .select()
    .single();

  if (error) {
    console.error(`[webhooks] não registrou a entrega: ${error.message}`);
    return;
  }

  const resultado = await tentarComBackoff(webhook, corpo);

  await db()
    .from("webhook_deliveries")
    .update({
      attempts: resultado.tentativas,
      status_code: resultado.status ?? null,
      error: resultado.erro ?? null,
      delivered_at: resultado.entregue ? new Date().toISOString() : null,
    })
    .eq("id", entrega.id);
}

export interface ResultadoEntrega {
  entregue: boolean;
  tentativas: number;
  status?: number;
  erro?: string;
}

/**
 * Backoff exponencial entre as 5 tentativas.
 *
 * Exportada para teste: é a parte com regra de verdade (o que repete e o que
 * não repete), e testá-la não deveria exigir banco.
 */
export async function tentarComBackoff(
  webhook: Pick<Webhook, "url" | "secret">,
  corpo: string,
  baseAtrasoMs = 1000,
): Promise<ResultadoEntrega> {
  let ultimoErro: string | undefined;
  let ultimoStatus: number | undefined;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const resposta = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": assinar(webhook.secret, timestamp, corpo),
        },
        body: corpo,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      ultimoStatus = resposta.status;
      if (resposta.ok) return { entregue: true, tentativas: tentativa, status: resposta.status };

      // 4xx é problema do payload ou da configuração: repetir não resolve.
      if (resposta.status >= 400 && resposta.status < 500) {
        return {
          entregue: false,
          tentativas: tentativa,
          status: resposta.status,
          erro: `HTTP ${resposta.status} — sem nova tentativa (erro do cliente).`,
        };
      }
      ultimoErro = `HTTP ${resposta.status}`;
    } catch (e) {
      ultimoErro = mensagem(e);
    }

    if (tentativa < MAX_TENTATIVAS) {
      await esperar(baseAtrasoMs * 2 ** (tentativa - 1));
    }
  }

  return { entregue: false, tentativas: MAX_TENTATIVAS, status: ultimoStatus, erro: ultimoErro };
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
