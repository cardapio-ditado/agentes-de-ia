import { notificarCliente, type Notification } from "./notifications.js";
import { dispatchWebhooks } from "./webhooks.js";
import { getVenue, reviewReservation, type Reservation, type Venue } from "./venues.js";
import type { Json } from "./database.types.js";
import { db } from "./supabase.js";

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
  // O aviso ao gestor vem ANTES do webhook e com `await`: a fila de aprovação
  // só é vista por quem abre o painel, e reserva que entra às 23h de sexta
  // ficaria esperando até alguém lembrar de olhar — com o cliente esperando
  // resposta do outro lado.
  await avisarGestorDaCasa(reserva, venue);

  await publicar(
    dispatchWebhooks(venue.org_id, "reservation.created", payloadDaReserva(reserva, venue)),
  );
}

/**
 * Enfileira o aviso de reserva nova no WhatsApp de quem analisa.
 *
 * Enfileira em vez de enviar: quem entrega é o conector, que pode estar noutro
 * processo (este pode ser a Vercel, onde o WhatsApp não roda). E nunca lança —
 * a reserva JÁ está gravada, e derrubar o registro dela porque o aviso falhou
 * seria trocar o essencial pelo acessório.
 */
async function avisarGestorDaCasa(reserva: Reservation, venue: Venue): Promise<void> {
  const destino = (venue.reservas_avisar_whatsapp ?? "").trim();
  if (!destino) return;

  try {
    const { error } = await db().from("notifications").insert({
      venue_id: venue.id,
      reservation_id: reserva.id,
      channel: "whatsapp",
      destination: destino,
      template: "reserva_nova_gestor",
      body: textoParaOGestor(reserva, venue),
    } as never);
    // Índice único: o aviso desta reserva já saiu. Não é erro.
    if (error && !/duplicate key|unique/i.test(error.message)) {
      console.error(`[reservas] aviso ao gestor não entrou: ${error.message}`);
    }
  } catch (e) {
    console.error(`[reservas] aviso ao gestor falhou: ${(e as Error).message}`);
  }
}

/**
 * O texto que o gestor recebe.
 *
 * Traz o suficiente para ele decidir SEM abrir o painel — nome, quando,
 * quantas pessoas, área e observação. Um aviso que só diz "entrou uma reserva"
 * obriga a largar o que está fazendo e ir olhar, e é assim que um aviso vira
 * uma coisa que se ignora.
 */
export function textoParaOGestor(reserva: Reservation, venue: Venue): string {
  const quando = new Intl.DateTimeFormat("pt-BR", {
    timeZone: venue.timezone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(reserva.reserved_for));
  const pessoas = `${reserva.party_size} pessoa${reserva.party_size > 1 ? "s" : ""}`;

  const linhas = [
    `📋 Reserva nova esperando aprovação — ${venue.name}`,
    ``,
    `${reserva.customer_name} · ${pessoas}`,
    `${quando}`,
  ];
  if (reserva.area_preference) linhas.push(`Área: ${reserva.area_preference}`);
  if (reserva.notes) linhas.push(`Obs.: ${reserva.notes}`);
  if (reserva.customer_phone) linhas.push(``, `Contato: ${reserva.customer_phone}`);
  linhas.push(``, `Aprove ou recuse em Reservas, no painel.`);
  return linhas.join("\n");
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
