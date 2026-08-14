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

const DIAS_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];

export interface DadosVenue {
  name?: string;
  description?: string | null;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  capacity?: number | null;
  timezone?: string;
  opening_hours?: Record<string, string>;
  /** Link do Google Maps que o agente manda ao cliente. Vive em settings. */
  maps_url?: string | null;
}

/** Link do Maps guardado em settings, validado ao salvar. */
export function mapsUrl(venue: Venue): string | null {
  const settings = venue.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const valor = (settings as Record<string, Json | undefined>).maps_url;
  return typeof valor === "string" && valor ? valor : null;
}

/**
 * Atualiza os dados cadastrais do estabelecimento.
 *
 * `opening_hours` é um mapa dia → texto livre ("18h às 00h", "fechado") —
 * texto porque bar tem horário que não cabe em hora de abrir/fechar: "só
 * eventos", "até o último cliente". O agente lê como está.
 */
export async function updateVenue(
  orgId: string,
  slug: string,
  dados: DadosVenue,
): Promise<Venue> {
  const mudancas: Partial<TablesInsert<"venues">> = {};

  if (dados.name !== undefined) {
    if (!dados.name.trim()) throw new Error("O nome não pode ficar vazio.");
    mudancas.name = dados.name.trim();
  }
  if (dados.description !== undefined) mudancas.description = dados.description?.trim() || null;
  if (dados.address !== undefined) mudancas.address = dados.address?.trim() || null;
  if (dados.phone !== undefined) mudancas.phone = dados.phone?.trim() || null;
  if (dados.whatsapp !== undefined) mudancas.whatsapp = dados.whatsapp?.trim() || null;
  if (dados.email !== undefined) mudancas.email = dados.email?.trim() || null;
  if (dados.timezone !== undefined) mudancas.timezone = dados.timezone;
  if (dados.capacity !== undefined) {
    if (dados.capacity !== null && (!Number.isInteger(dados.capacity) || dados.capacity <= 0)) {
      throw new Error("Capacidade precisa ser um número inteiro positivo.");
    }
    mudancas.capacity = dados.capacity;
  }
  if (dados.opening_hours !== undefined) {
    const horarios: Record<string, string> = {};
    for (const dia of DIAS_SEMANA) {
      const valor = dados.opening_hours[dia];
      if (typeof valor === "string" && valor.trim()) horarios[dia] = valor.trim();
    }
    mudancas.opening_hours = horarios as Json;
  }
  if (dados.maps_url !== undefined) {
    const url = dados.maps_url?.trim() || null;
    if (url && !/^https:\/\/(www\.google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[a-z.]+)/.test(url)) {
      throw new Error(
        "O link precisa ser do Google Maps (google.com/maps ou maps.app.goo.gl). " +
          'Use o botão "Compartilhar" no Maps e cole o link aqui.',
      );
    }
    // settings guarda outras chaves (regras de reserva): mesclar, não substituir.
    const atual = await findVenueBySlugInOrg(orgId, slug);
    const settings = {
      ...((atual.settings ?? {}) as Record<string, unknown>),
      maps_url: url,
    };
    mudancas.settings = settings as Json;
  }
  if (Object.keys(mudancas).length === 0) throw new Error("Nada para atualizar.");

  const { data, error } = await db()
    .from("venues")
    .update(mudancas)
    .eq("org_id", orgId)
    .eq("slug", slug)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Falha ao atualizar o estabelecimento: ${error.message}`);
  if (!data) throw new Error(`Estabelecimento "${slug}" não encontrado.`);
  return data;
}

export async function createVenueInfo(params: {
  venueId: string;
  topic: string;
  content: string;
}): Promise<VenueInfo> {
  const topic = params.topic.trim();
  const content = params.content.trim();
  if (!topic) throw new Error("A informação precisa de um tópico (ex.: Estacionamento).");
  if (!content) throw new Error("O conteúdo não pode ficar vazio.");

  // upsert: o par (venue_id, topic) é único — reescrever um tópico atualiza.
  const { data, error } = await db()
    .from("venue_info")
    .upsert(
      { venue_id: params.venueId, topic, content, active: true },
      { onConflict: "venue_id,topic" },
    )
    .select()
    .single();

  if (error) throw new Error(`Falha ao salvar a informação: ${error.message}`);
  return data;
}

export async function deleteVenueInfo(infoId: string, venueId: string): Promise<void> {
  const { error } = await db()
    .from("venue_info")
    .delete()
    .eq("id", infoId)
    .eq("venue_id", venueId);

  if (error) throw new Error(`Falha ao remover a informação: ${error.message}`);
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

export interface DadosReserva {
  customer_name?: string;
  customer_phone?: string;
  party_size?: number;
  reserved_for?: string;
  area_preference?: string | null;
  occasion?: string | null;
  notes?: string | null;
}

/**
 * Edita uma reserva que ainda vai acontecer (pendente ou aprovada).
 *
 * Recusada, cancelada ou já atendida não se edita — se o cliente mudou de
 * ideia depois, é uma reserva nova.
 */
export async function updateReservation(
  reservationId: string,
  dados: DadosReserva,
): Promise<Reservation> {
  const mudancas: Partial<TablesInsert<"reservations">> = {};

  if (dados.customer_name !== undefined) {
    if (!dados.customer_name.trim()) throw new Error("O nome não pode ficar vazio.");
    mudancas.customer_name = dados.customer_name.trim();
  }
  if (dados.customer_phone !== undefined) {
    if (!dados.customer_phone.trim()) throw new Error("O telefone não pode ficar vazio.");
    mudancas.customer_phone = dados.customer_phone.trim();
  }
  if (dados.party_size !== undefined) {
    if (!Number.isInteger(dados.party_size) || dados.party_size <= 0) {
      throw new Error("Quantidade de pessoas precisa ser um inteiro positivo.");
    }
    mudancas.party_size = dados.party_size;
  }
  if (dados.reserved_for !== undefined) {
    const quando = new Date(dados.reserved_for);
    if (Number.isNaN(quando.getTime())) throw new Error("Data e hora inválidas.");
    mudancas.reserved_for = quando.toISOString();
  }
  if (dados.area_preference !== undefined) {
    mudancas.area_preference = dados.area_preference?.trim() || null;
  }
  if (dados.occasion !== undefined) mudancas.occasion = dados.occasion?.trim() || null;
  if (dados.notes !== undefined) mudancas.notes = dados.notes?.trim() || null;
  if (Object.keys(mudancas).length === 0) throw new Error("Nada para atualizar.");

  const { data, error } = await db()
    .from("reservations")
    .update(mudancas)
    .eq("id", reservationId)
    .in("status", ["pending", "approved"])
    .select()
    .maybeSingle();

  if (error) throw new Error(`Falha ao editar a reserva: ${error.message}`);
  if (!data) {
    throw new Error("Só reservas pendentes ou aprovadas podem ser editadas.");
  }
  return data;
}

/**
 * Cancela uma reserva pendente ou aprovada.
 *
 * O trigger de histórico registra a mudança. O cliente NÃO é avisado
 * automaticamente — cancelamento pela casa merece uma mensagem humana.
 */
export async function cancelReservation(reservationId: string): Promise<Reservation> {
  const { data, error } = await db()
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("id", reservationId)
    .in("status", ["pending", "approved"])
    .select()
    .maybeSingle();

  if (error) throw new Error(`Falha ao cancelar a reserva: ${error.message}`);
  if (!data) throw new Error("Só reservas pendentes ou aprovadas podem ser canceladas.");
  return data;
}

/**
 * Apaga a reserva de vez — para dados de teste ou lançamento errado.
 *
 * O histórico de status cai em cascata; a notificação já enviada mantém o
 * registro dela (vínculo anulado). Cancelamento operacional é `cancelled`,
 * que preserva a história — exclusão é exceção, não rotina.
 */
export async function deleteReservation(reservationId: string): Promise<void> {
  const { error } = await db().from("reservations").delete().eq("id", reservationId);
  if (error) throw new Error(`Falha ao excluir a reserva: ${error.message}`);
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

/**
 * Reservas confirmadas que ainda vão acontecer — o mapa de mesas do dia.
 *
 * A janela começa 6 horas atrás: a reserva de hoje às 20h continua na lista
 * durante a noite inteira, em vez de sumir no minuto seguinte ao horário.
 */
export async function listUpcomingApproved(venueId: string): Promise<Reservation[]> {
  const corte = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from("reservations")
    .select("*")
    .eq("venue_id", venueId)
    .eq("status", "approved")
    .gte("reserved_for", corte)
    .order("reserved_for", { ascending: true });

  if (error) throw new Error(`Falha ao carregar as reservas confirmadas: ${error.message}`);
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
