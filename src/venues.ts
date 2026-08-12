import { db } from "./supabase.js";
import type { Json, Tables, TablesInsert } from "./database.types.js";

export type Venue = Tables<"venues">;
export type VenueEvent = Tables<"venue_events">;
export type VenueInfo = Tables<"venue_info">;
export type Reservation = Tables<"reservations">;

/** Regras operacionais do estabelecimento, guardadas em `venues.settings`. */
export interface VenueSettings {
  /** Maior grupo aceito sem falar com um humano. */
  max_party_size: number;
  /** Antecedência mínima, em minutos, entre agora e o horário reservado. */
  min_advance_minutes: number;
  /** Quantos dias à frente aceitamos reservar. */
  max_advance_days: number;
}

const SETTINGS_PADRAO: VenueSettings = {
  max_party_size: 12,
  min_advance_minutes: 60,
  max_advance_days: 90,
};

export function venueSettings(venue: Venue): VenueSettings {
  const settings = venue.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return SETTINGS_PADRAO;
  }
  const bruto = settings as Record<string, Json | undefined>;
  return {
    max_party_size: numeroOu(bruto.max_party_size, SETTINGS_PADRAO.max_party_size),
    min_advance_minutes: numeroOu(
      bruto.min_advance_minutes,
      SETTINGS_PADRAO.min_advance_minutes,
    ),
    max_advance_days: numeroOu(bruto.max_advance_days, SETTINGS_PADRAO.max_advance_days),
  };
}

function numeroOu(valor: Json | undefined, padrao: number): number {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : padrao;
}

export async function getVenue(venueId: string): Promise<Venue> {
  const { data, error } = await db()
    .from("venues")
    .select("*")
    .eq("id", venueId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar o estabelecimento: ${error.message}`);
  if (!data) throw new Error(`Estabelecimento ${venueId} não encontrado.`);
  return data;
}

export async function findVenueBySlug(slug: string): Promise<Venue> {
  const { data, error } = await db()
    .from("venues")
    .select("*")
    .eq("slug", slug)
    .eq("active", true);

  if (error) throw new Error(`Falha ao buscar o estabelecimento: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`Estabelecimento "${slug}" não encontrado ou inativo.`);
  }
  if (data.length > 1) {
    throw new Error(
      `O slug "${slug}" existe em mais de uma organização — informe o id do estabelecimento.`,
    );
  }
  return data[0]!;
}

/** Busca o estabelecimento dentro de uma organização — o escopo da chave de API. */
export async function findVenueBySlugInOrg(orgId: string, slug: string): Promise<Venue> {
  const { data, error } = await db()
    .from("venues")
    .select("*")
    .eq("org_id", orgId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Falha ao buscar o estabelecimento: ${error.message}`);
  if (!data) throw new Error(`Estabelecimento "${slug}" não encontrado nesta organização.`);
  return data;
}

export async function listVenuesInOrg(orgId: string): Promise<Venue[]> {
  const { data, error } = await db()
    .from("venues")
    .select("*")
    .eq("org_id", orgId)
    .order("name", { ascending: true });

  if (error) throw new Error(`Falha ao listar estabelecimentos: ${error.message}`);
  return data ?? [];
}

/** Programação completa do estabelecimento, para a tela de gestão. */
export async function listAllEvents(venueId: string): Promise<VenueEvent[]> {
  const { data, error } = await db()
    .from("venue_events")
    .select("*")
    .eq("venue_id", venueId)
    .order("starts_at", { ascending: true });

  if (error) throw new Error(`Falha ao carregar a programação: ${error.message}`);
  return data ?? [];
}

export async function createVenueEvent(
  row: TablesInsert<"venue_events">,
): Promise<VenueEvent> {
  const { data, error } = await db().from("venue_events").insert(row).select().single();
  if (error) throw new Error(`Falha ao criar o evento: ${error.message}`);
  return data;
}

/** O `venue_id` no filtro impede apagar evento de outro estabelecimento. */
export async function deleteVenueEvent(eventId: string, venueId: string): Promise<void> {
  const { error } = await db()
    .from("venue_events")
    .delete()
    .eq("id", eventId)
    .eq("venue_id", venueId);

  if (error) throw new Error(`Falha ao remover o evento: ${error.message}`);
}

/** Reserva + estabelecimento, para conferir se pertence à organização da chave. */
export async function getReservationWithVenue(
  reservationId: string,
): Promise<{ reservation: Reservation; venue: Venue } | null> {
  const reservation = await getReservation(reservationId);
  if (!reservation) return null;
  return { reservation, venue: await getVenue(reservation.venue_id) };
}

/** Programação a partir de agora, opcionalmente filtrada por tipo. */
export async function listUpcomingEvents(params: {
  venueId: string;
  kind?: string;
  until?: Date;
  limit?: number;
}): Promise<VenueEvent[]> {
  let query = db()
    .from("venue_events")
    .select("*")
    .eq("venue_id", params.venueId)
    .eq("active", true)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(params.limit ?? 20);

  if (params.kind) query = query.eq("kind", params.kind);
  if (params.until) query = query.lte("starts_at", params.until.toISOString());

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao carregar a programação: ${error.message}`);
  return data ?? [];
}

export async function listVenueInfo(venueId: string): Promise<VenueInfo[]> {
  const { data, error } = await db()
    .from("venue_info")
    .select("*")
    .eq("venue_id", venueId)
    .eq("active", true)
    .order("topic", { ascending: true });

  if (error) throw new Error(`Falha ao carregar as informações: ${error.message}`);
  return data ?? [];
}

export async function createReservation(
  row: TablesInsert<"reservations">,
): Promise<Reservation> {
  const { data, error } = await db()
    .from("reservations")
    .insert(row)
    .select()
    .single();

  if (error) throw new Error(`Falha ao registrar a reserva: ${error.message}`);
  return data;
}

/** Fila do módulo de aprovação: reservas pendentes, mais próximas primeiro. */
export async function listPendingReservations(venueId: string): Promise<Reservation[]> {
  const { data, error } = await db()
    .from("reservations")
    .select("*")
    .eq("venue_id", venueId)
    .eq("status", "pending")
    .order("reserved_for", { ascending: true });

  if (error) throw new Error(`Falha ao carregar a fila de aprovação: ${error.message}`);
  return data ?? [];
}

export async function getReservation(reservationId: string): Promise<Reservation | null> {
  const { data, error } = await db()
    .from("reservations")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar a reserva: ${error.message}`);
  return data;
}

/**
 * Decisão do módulo de aprovação.
 *
 * `reviewedBy` é o usuário que decidiu; o histórico em
 * `reservation_status_history` é gravado por trigger, não por este código.
 */
export async function reviewReservation(params: {
  reservationId: string;
  status: "approved" | "rejected";
  reviewedBy?: string;
  reason?: string;
}): Promise<Reservation> {
  const { data, error } = await db()
    .from("reservations")
    .update({
      status: params.status,
      reviewed_by: params.reviewedBy ?? null,
      reviewed_at: new Date().toISOString(),
      review_reason: params.reason ?? null,
    })
    .eq("id", params.reservationId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error) throw new Error(`Falha ao registrar a decisão: ${error.message}`);
  if (!data) {
    throw new Error(
      `Reserva ${params.reservationId} não está pendente — outra pessoa já decidiu, ou o id está errado.`,
    );
  }
  return data;
}
