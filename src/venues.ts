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

const DIAS_SEMANA_RECORRENCIA = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];

/** Regra que gerou uma ocorrência — guardada em cada linha da série. */
export interface RegraRecorrencia {
  freq: "weekly" | "daily";
  /** Dias da semana (DIAS_SEMANA_RECORRENCIA), só para freq "weekly". */
  days?: string[];
  /** Corte inclusivo (YYYY-MM-DD) até onde a série foi materializada. */
  until: string;
  /** true = usuário não escolheu data final; `until` é só o horizonte atual. */
  indefinite: boolean;
}

/** Sem data final, materializamos ~12 semanas por vez — não dá para gerar linhas infinitas. */
const HORIZONTE_INDEFINIDO_MS = 84 * 24 * 60 * 60 * 1000;
/** Trava contra data absurda (ex.: usuário digita 2035 sem querer). */
const HORIZONTE_MAXIMO_MS = 365 * 24 * 60 * 60 * 1000;

/** Deslocamento UTC de um fuso numa data específica, no formato "-04:00". */
export function deslocamentoEm(timezone: string, instante: Date): string {
  const nome = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  })
    .formatToParts(instante)
    .find((p) => p.type === "timeZoneName")?.value;
  return nome?.match(/GMT([+-]\d{2}:\d{2})?/)?.[1] ?? "+00:00";
}

/** Ano, mês, dia, hora e minuto de um instante, lidos no fuso da casa. */
function partesLocais(instante: Date, timezone: string) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(instante).map((p) => [p.type, p.value]),
  );
  return { ano: partes.year!, mes: partes.month!, dia: partes.day!, hora: partes.hour!, minuto: partes.minute! };
}

/**
 * Gera os instantes de uma série recorrente, no fuso da casa.
 *
 * Anda dia a dia (em termos de calendário, não de milissegundos) para não
 * derrapar em fusos com horário de verão, e recalcula o deslocamento UTC a
 * cada data — assim cada ocorrência nasce no horário de parede certo.
 */
export function gerarOcorrencias(params: {
  primeiraData: Date;
  timezone: string;
  freq: "weekly" | "daily";
  dias?: string[];
  ate: Date;
}): Date[] {
  const { primeiraData, timezone, freq, dias, ate } = params;
  const ancora = partesLocais(primeiraData, timezone);
  const diasAlvo = freq === "weekly" ? new Set(dias) : null;

  const resultado: Date[] = [];
  let cursor = new Date(Date.UTC(Number(ancora.ano), Number(ancora.mes) - 1, Number(ancora.dia)));
  const fim = new Date(Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate()));

  while (cursor.getTime() <= fim.getTime()) {
    const diaSemana = DIAS_SEMANA_RECORRENCIA[(cursor.getUTCDay() + 6) % 7]!;
    if (freq === "daily" || diasAlvo!.has(diaSemana)) {
      const y = cursor.getUTCFullYear();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
      const d = String(cursor.getUTCDate()).padStart(2, "0");
      const offset = deslocamentoEm(timezone, cursor);
      const instante = new Date(`${y}-${m}-${d}T${ancora.hora}:${ancora.minuto}:00${offset}`);
      if (instante.getTime() >= primeiraData.getTime()) resultado.push(instante);
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return resultado;
}

/**
 * Cria uma série de eventos recorrentes (semanal em N dias, ou diária),
 * todos com o mesmo `series_id` para poder gerenciá-los em bloco depois.
 *
 * Sem data final, a série vem com `indefinite: true` e um horizonte de ~12
 * semanas — a tela de Programação avisa quando está acabando para renovar.
 */
export async function createVenueEventSeries(
  base: Omit<TablesInsert<"venue_events">, "series_id" | "recurrence">,
  regra: { freq: "weekly" | "daily"; days?: string[]; until?: Date },
  timezone: string,
): Promise<VenueEvent[]> {
  if (regra.freq === "weekly" && (!regra.days || regra.days.length === 0)) {
    throw new Error("Selecione ao menos um dia da semana.");
  }

  const primeiraData = new Date(base.starts_at);
  if (Number.isNaN(primeiraData.getTime())) throw new Error("Data e hora inválidas.");

  const indefinite = !regra.until;
  const ate = regra.until ?? new Date(primeiraData.getTime() + HORIZONTE_INDEFINIDO_MS);
  if (ate.getTime() > primeiraData.getTime() + HORIZONTE_MAXIMO_MS) {
    throw new Error("A recorrência não pode ir além de 1 ano a partir da primeira data.");
  }
  if (ate.getTime() < primeiraData.getTime()) {
    throw new Error("A data final precisa ser depois da primeira data.");
  }

  return materializarSerie(base, { freq: regra.freq, days: regra.days, indefinite }, primeiraData, ate, timezone);
}

async function materializarSerie(
  base: Omit<TablesInsert<"venue_events">, "series_id" | "recurrence">,
  regra: { freq: "weekly" | "daily"; days?: string[]; indefinite: boolean },
  primeiraData: Date,
  ate: Date,
  timezone: string,
  seriesId?: string,
): Promise<VenueEvent[]> {
  const datas = gerarOcorrencias({ primeiraData, timezone, freq: regra.freq, dias: regra.days, ate });
  if (datas.length === 0) {
    throw new Error("Nenhuma ocorrência cai nos dias escolhidos até a data final.");
  }

  const id = seriesId ?? crypto.randomUUID();
  const recurrence: RegraRecorrencia = {
    freq: regra.freq,
    days: regra.freq === "weekly" ? regra.days : undefined,
    until: ate.toISOString().slice(0, 10),
    indefinite: regra.indefinite,
  };

  const linhas: TablesInsert<"venue_events">[] = datas.map((d) => ({
    ...base,
    starts_at: d.toISOString(),
    series_id: id,
    recurrence: recurrence as unknown as Json,
  }));

  const { data, error } = await db().from("venue_events").insert(linhas).select();
  if (error) throw new Error(`Falha ao criar a série de eventos: ${error.message}`);
  return data ?? [];
}

/**
 * Remove as ocorrências futuras de uma série — as passadas ficam como
 * registro, já que não existe histórico separado para eventos.
 */
export async function deleteVenueEventSeries(seriesId: string, venueId: string): Promise<void> {
  const { error } = await db()
    .from("venue_events")
    .delete()
    .eq("series_id", seriesId)
    .eq("venue_id", venueId)
    .gte("starts_at", new Date().toISOString());

  if (error) throw new Error(`Falha ao remover a série: ${error.message}`);
}

/**
 * Estende uma série indefinida por mais ~12 semanas, a partir do dia
 * seguinte à última ocorrência já materializada.
 */
export async function renewVenueEventSeries(
  seriesId: string,
  venueId: string,
  timezone: string,
): Promise<VenueEvent[]> {
  const { data: ultimas, error } = await db()
    .from("venue_events")
    .select("*")
    .eq("series_id", seriesId)
    .eq("venue_id", venueId)
    .order("starts_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(`Falha ao renovar a série: ${error.message}`);
  const ultima = ultimas?.[0];
  if (!ultima) throw new Error("Série não encontrada.");

  const regra = ultima.recurrence as unknown as RegraRecorrencia | null;
  if (!regra) throw new Error("Este evento não faz parte de uma série recorrente.");
  if (!regra.indefinite) throw new Error("Esta série tem data final definida — não precisa renovar.");

  const novaPrimeira = new Date(new Date(ultima.starts_at).getTime() + 24 * 60 * 60 * 1000);
  const novoAte = new Date(novaPrimeira.getTime() + HORIZONTE_INDEFINIDO_MS);

  const { series_id: _s, recurrence: _r, id: _id, created_at: _c, updated_at: _u, ...base } = ultima;

  return materializarSerie(
    base,
    { freq: regra.freq, days: regra.days, indefinite: true },
    novaPrimeira,
    novoAte,
    timezone,
    seriesId,
  );
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

/**
 * Programação a partir de agora, opcionalmente filtrada por tipo.
 *
 * Um evento sem `ends_at` cadastrado não pode sumir da lista no segundo em
 * que o horário de início passa — o show das 20h ainda está rolando às
 * 20h30. Por isso ele continua "no ar" por até 6h após começar, mesma
 * tolerância usada nas reservas confirmadas. Com `ends_at` definido, o corte
 * é o horário real de término.
 */
export async function listUpcomingEvents(params: {
  venueId: string;
  kind?: string;
  until?: Date;
  limit?: number;
}): Promise<VenueEvent[]> {
  const agora = new Date();
  const corte = new Date(agora.getTime() - 6 * 60 * 60 * 1000);

  let query = db()
    .from("venue_events")
    .select("*")
    .eq("venue_id", params.venueId)
    .eq("active", true)
    .or(`ends_at.gte.${agora.toISOString()},and(ends_at.is.null,starts_at.gte.${corte.toISOString()})`)
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

/**
 * Todas as reservas feitas nesta conversa, da mais recente para a mais antiga.
 *
 * Inclui as que já passaram de propósito. Sem isso o agente só tinha uma fonte
 * sobre as reservas do cliente: o próprio histórico da conversa — onde a
 * confirmação de uma reserva de semanas atrás continua escrita no presente
 * ("sua mesa está reservada"), sem nada indicando que a data já passou. Ler o
 * banco e comparar com o relógio é o que separa "você tem" de "você teve".
 */
export async function listReservationsForConversation(
  conversationId: string,
  limite = 10,
): Promise<Reservation[]> {
  const { data, error } = await db()
    .from("reservations")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("reserved_for", { ascending: false })
    .limit(limite);

  if (error) throw new Error(`Falha ao carregar as reservas da conversa: ${error.message}`);
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
