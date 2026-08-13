import { notificarCliente, type Notification } from "./notifications.js";
import { dispatchWebhooks } from "./webhooks.js";
import { getVenue, reviewReservation, type Reservation, type Venue } from "./venues.js";
import type { Json } from "./database.types.js";

export interface DecisaoResultado {
  reserva: Reservation;
  /** Null quando a notificação nem chegou a ser registrada. */
  notificacao: Notification | null;
}

/**
 * Em serverless, a função congela assim que a resposta sai — trabalho
 * disparado sem `await` simplesmente não termina. Num servidor de verdade,
 * não esperar é melhor: quem aprovou não fica preso a um sistema de terceiros.
 */
const SERVERLESS = Boolean(process.env.VERCEL ?? process.env.AWS_LAMBDA_FUNCTION_NAME);

async function publicar(promessa: Promise<void>): Promise<void> {
  if (SERVERLESS) {
    await promessa;
    return;
  }
  void promessa;
}

/**
 * Decisão sobre uma reserva: grava, avisa o cliente e publica o evento.
 *
 * Ponto único usado pelo painel, pela API e pela linha de comando — a ordem
 * importa e não deve ser reimplementada em cada chamador.
 */
export async function decidirReserva(params: {
  reservationId: string;
  status: "approved" | "rejected";
  reviewedBy?: string;
  motivo?: string;
  venue?: Venue;
}): Promise<DecisaoResultado> {
  // 1. Grava a decisão. Se isto falhar, nada mais acontece.
  const reserva = await reviewReservation({
    reservationId: params.reservationId,
    status: params.status,
    reviewedBy: params.reviewedBy,
    reason: params.motivo,
  });

  const venue = params.venue ?? (await getVenue(reserva.venue_id));

  // 2. Avisa o cliente. Aguardamos para poder dizer a quem aprovou se saiu.
  const notificacao = await notificarCliente({
    template: params.status === "approved" ? "reserva_aprovada" : "reserva_recusada",
    reserva,
    venue,
  });

  // 3. Publica para integrações.
  await publicar(
    dispatchWebhooks(
      venue.org_id,
      params.status === "approved" ? "reservation.approved" : "reservation.rejected",
      payloadDaReserva(reserva, venue),
    ),
  );

  return { reserva, notificacao };
}

/** Publica que uma reserva entrou na fila. Chamado quando o agente registra. */
export async function publicarReservaCriada(
  reserva: Reservation,
  venue: Venue,
): Promise<void> {
  await publicar(
    dispatchWebhooks(venue.org_id, "reservation.created", payloadDaReserva(reserva, venue)),
  );
}

function payloadDaReserva(reserva: Reservation, venue: Venue): Record<string, Json> {
  return {
    reservation_id: reserva.id,
    venue: { id: venue.id, slug: venue.slug, name: venue.name },
    status: reserva.status,
    customer_name: reserva.customer_name,
    customer_phone: reserva.customer_phone,
    party_size: reserva.party_size,
    reserved_for: reserva.reserved_for,
    area_preference: reserva.area_preference,
    occasion: reserva.occasion,
    notes: reserva.notes,
    review_reason: reserva.review_reason,
    source_channel: reserva.source_channel,
    created_at: reserva.created_at,
  };
}
