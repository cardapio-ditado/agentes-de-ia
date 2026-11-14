import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Mercado Pago do delivery: Pix (QR + copia e cola) e link de cartão.
 *
 * A conta é DA CASA — o token mora em `delivery_config`, e o dinheiro cai
 * direto nela. O Brasa não passa pelo caminho do dinheiro.
 *
 * Separado de `delivery.ts` para os testes trocarem a cobrança por uma de
 * mentira sem tocar na rede.
 */

export interface CredenciaisDoMercadoPago {
  accessToken: string;
  /** O Pix exige um e-mail de pagador; o cliente do delivery não informa o dele. */
  emailPagador: string | null;
}

export interface Cobranca {
  ref: string | null;
  /** Checkout do cartão, ou a página do Pix. */
  link: string | null;
  pixCodigo: string | null;
  /** QR code do Pix, PNG em base64. */
  pixQr: string | null;
}

export interface PagamentoDoMercadoPago {
  id: string;
  status: string;
  /** O `external_reference` da cobrança: o id do pedido. */
  pedidoId: string | null;
  centavos: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// As respostas do Mercado Pago são lidas campo a campo, com valor padrão em
// cada um: tipar a API inteira aqui seria manter uma cópia do contrato deles.
const API = "https://api.mercadopago.com";

/** Endereço público do servidor — o mesmo critério do resto do Brasa. */
export function enderecoPublico(): string {
  return (process.env.PUBLIC_URL ?? "https://agentes-de-ia-alpha.vercel.app").replace(/\/$/, "");
}

async function chamar(token: string, caminho: string, opcoes: RequestInit = {}): Promise<Record<string, any>> {
  const resposta = await fetch(API + caminho, {
    ...opcoes,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opcoes.headers ?? {}) },
  });
  const corpo = (await resposta.json().catch(() => ({}))) as Record<string, any>;
  if (!resposta.ok) {
    throw new Error(`Mercado Pago ${resposta.status}: ${JSON.stringify(corpo).slice(0, 300)}`);
  }
  return corpo;
}

/** O corpo da cobrança Pix. Exportado para o teste conferir sem rede. */
export function corpoDoPix(params: {
  pedido: { id: string; numero: number; total_centavos: number; nome: string };
  casa: { nome: string; slug: string };
  emailPagador: string;
  agora?: Date;
}): Record<string, unknown> {
  const vence = new Date((params.agora ?? new Date()).getTime() + 30 * 60_000);
  return {
    transaction_amount: params.pedido.total_centavos / 100,
    description: `Pedido #${params.pedido.numero} - ${params.casa.nome}`,
    payment_method_id: "pix",
    payer: { email: params.emailPagador, first_name: params.pedido.nome },
    external_reference: params.pedido.id,
    notification_url: `${enderecoPublico()}/v1/webhooks/mercadopago/${encodeURIComponent(params.casa.slug)}`,
    // O Mercado Pago quer o deslocamento escrito, e não o "Z".
    date_of_expiration: vence.toISOString().replace("Z", "+00:00"),
  };
}

export async function criarCobranca(
  pedido: { id: string; numero: number; total_centavos: number; nome: string; pagamento: string; token: string },
  credenciais: CredenciaisDoMercadoPago,
  casa: { name: string; slug: string },
): Promise<Cobranca> {
  const dados = { nome: casa.name, slug: casa.slug };

  if (pedido.pagamento === "pix") {
    if (!credenciais.emailPagador) {
      throw new Error("Falta o e-mail de pagador do Pix nos ajustes do delivery.");
    }
    const p = await chamar(credenciais.accessToken, "/v1/payments", {
      method: "POST",
      // A chave é o PEDIDO: um reenvio por timeout devolve a mesma cobrança
      // em vez de criar a segunda. (Chave sorteada a cada chamada não
      // protegeria nada — cada tentativa seria "nova".)
      headers: { "X-Idempotency-Key": pedido.id },
      body: JSON.stringify(corpoDoPix({ pedido, casa: dados, emailPagador: credenciais.emailPagador })),
    });
    const td = p.point_of_interaction?.transaction_data ?? {};
    return { ref: String(p.id), link: td.ticket_url ?? null, pixCodigo: td.qr_code ?? null, pixQr: td.qr_code_base64 ?? null };
  }

  const volta = `${enderecoPublico()}/delivery/${encodeURIComponent(casa.slug)}?pedido=${pedido.token}`;
  const preferencia = await chamar(credenciais.accessToken, "/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [{ title: `Pedido #${pedido.numero} - ${casa.name}`, quantity: 1, unit_price: pedido.total_centavos / 100, currency_id: "BRL" }],
      external_reference: pedido.id,
      notification_url: `${enderecoPublico()}/v1/webhooks/mercadopago/${encodeURIComponent(casa.slug)}`,
      // Boleto compensa em dias; comida não espera.
      payment_methods: { excluded_payment_types: [{ id: "ticket" }] },
      // O link morre junto com o prazo do pedido. Sem isto o cliente pagava
      // uma hora depois um pedido que a rotina já tinha cancelado.
      expires: true,
      expiration_date_to: new Date(Date.now() + 30 * 60_000).toISOString().replace("Z", "+00:00"),
      back_urls: { success: volta, pending: volta, failure: volta },
    }),
  });
  return { ref: String(preferencia.id), link: preferencia.init_point ?? null, pixCodigo: null, pixQr: null };
}

/**
 * O pagamento, consultado direto no Mercado Pago.
 *
 * É a fonte da verdade do webhook: o corpo que chega é só um aviso de "olhe
 * o pagamento X", e qualquer um pode mandar um aviso. O status e o valor
 * valem os que a API responde com o token da casa.
 */
export async function consultarPagamento(accessToken: string, pagamentoId: string): Promise<PagamentoDoMercadoPago> {
  const p = await chamar(accessToken, `/v1/payments/${encodeURIComponent(pagamentoId)}`);
  const ref = typeof p.external_reference === "string" ? p.external_reference : null;
  return {
    id: String(p.id),
    status: String(p.status),
    pedidoId: ref && /^[0-9a-f-]{36}$/i.test(ref) ? ref : null,
    centavos: Math.round(Number(p.transaction_amount) * 100),
  };
}

/**
 * Confere o cabeçalho x-signature do webhook:
 * HMAC-SHA256 de "id:<data.id>;request-id:<x-request-id>;ts:<ts>;".
 */
export function assinaturaConfere(
  segredo: string,
  cabecalho: string | undefined,
  requestId: string | undefined,
  dataId: string,
): boolean {
  if (!cabecalho) return false;
  const partes = Object.fromEntries(
    cabecalho.split(",").map((par) => par.split("=").map((s) => s.trim()) as [string, string]),
  );
  if (!partes.ts || !partes.v1) return false;
  const manifesto = `id:${dataId.toLowerCase()};request-id:${requestId ?? ""};ts:${partes.ts};`;
  const esperado = Buffer.from(createHmac("sha256", segredo).update(manifesto).digest("hex"));
  const recebido = Buffer.from(partes.v1);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
