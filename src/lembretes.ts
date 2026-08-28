import { db } from "./supabase.js";
import type { Reservation, Venue } from "./venues.js";
import { inserirAvisos } from "./notifications.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const cliente = () => db() as any;

/**
 * O lembrete da reserva, uma hora antes.
 *
 * Existe por causa do no-show. Quem reserva na terça para o sábado esquece, e
 * a mesa fica vazia numa noite de casa cheia — prejuízo que não aparece em
 * relatório nenhum, porque mesa vazia não gera registro. Uma mensagem pouco
 * antes recupera parte disso, e ainda dá ao cliente a chance de avisar que não
 * vem, o que libera a mesa para outro.
 *
 * A varredura roda a cada minuto no processo longo (o conector), pelo mesmo
 * motivo do agendador de checklists: a Vercel não tem processo de pé.
 */

export const TEMPLATE_LEMBRETE = "reserva_lembrete";

/** Quantas reservas a varredura processa por volta. */
const TETO_POR_VOLTA = 100;

/**
 * Esta reserva merece lembrete agora?
 *
 * Pura e separada do banco porque é aqui que mora o julgamento — e um erro
 * aqui não estoura em lugar nenhum: só produz uma mensagem na hora errada, ou
 * mensagem nenhuma, sem ninguém desconfiar.
 */
export function estaNaHoraDeLembrar(params: {
  /** Quando a reserva acontece, ISO. */
  reservadaPara: string;
  /** Quando a reserva foi criada, ISO. */
  criadaEm: string;
  minutosDeAntecedencia: number;
  agora: Date;
}): boolean {
  const { minutosDeAntecedencia: minutos, agora } = params;
  if (minutos <= 0) return false;

  const quando = Date.parse(params.reservadaPara);
  const criada = Date.parse(params.criadaEm);
  if (!Number.isFinite(quando) || !Number.isFinite(criada)) return false;

  const janela = minutos * 60_000;
  const abre = quando - janela;

  // Já passou da hora. Sem isto, o conector que ficou três horas fora do ar
  // voltaria mandando "lembrete" de reservas que já aconteceram — e a pessoa
  // que já jantou receberia um aviso para vir jantar.
  if (quando <= agora.getTime()) return false;

  // Ainda não chegou a hora.
  if (agora.getTime() < abre) return false;

  // Reserva feita EM CIMA DA HORA não recebe lembrete: quem acabou de
  // combinar às 19h30 para as 20h não precisa ser lembrado às 19h31 de algo
  // que ele fez há um minuto. O lembrete é para quem reservou com
  // antecedência e teve tempo de esquecer.
  if (criada >= abre) return false;

  return true;
}

/**
 * O texto do lembrete.
 *
 * "Se não puder vir, responda" não é gentileza: é o que transforma um no-show
 * silencioso numa mesa liberada a tempo.
 */
export function textoDoLembrete(reserva: Reservation, venue: Venue): string {
  const nome = (reserva.customer_name ?? "").trim().split(/\s+/)[0] || "tudo bem";
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: venue.timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(reserva.reserved_for));
  const pessoas = `${reserva.party_size} pessoa${reserva.party_size > 1 ? "s" : ""}`;

  const linhas = [
    `Oi, ${nome}! Passando só pra lembrar da sua reserva hoje no ${venue.name} 🗓️`,
    ``,
    `Hoje às ${hora} — ${pessoas}`,
  ];
  if (reserva.area_preference) linhas.push(`Área: ${reserva.area_preference}`);
  linhas.push(
    ``,
    `Te esperamos! Se não puder vir, é só responder por aqui que a gente libera a mesa. 🙂`,
  );
  return linhas.join("\n");
}

interface LinhaDaVarredura {
  id: string;
  venue_id: string;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  reserved_for: string;
  area_preference: string | null;
  created_at: string;
  venues: Pick<Venue, "id" | "name" | "timezone" | "reserva_lembrete_minutos"> | null;
}

/**
 * Uma volta da varredura: enfileira o lembrete das reservas que chegaram na
 * hora.
 *
 * Enfileira em vez de enviar: quem entrega é o conector, e a fila já tem
 * retentativa. E grava ANTES de qualquer envio — a trava de "um lembrete por
 * reserva" é o índice único do banco, não uma variável na memória deste
 * processo, que morre a cada reinício.
 */
export async function lembrarReservasProximas(agora = new Date()): Promise<number> {
  // A janela mais larga que qualquer casa pode ter configurado. Buscar por
  // ela e filtrar depois é mais barato que uma consulta por casa.
  const teto = new Date(agora.getTime() + 1440 * 60_000);

  const { data, error } = await cliente()
    .from("reservations")
    .select(
      "id, venue_id, customer_name, customer_phone, party_size, reserved_for, area_preference, created_at, " +
        "venues:venue_id(id, name, timezone, reserva_lembrete_minutos)",
    )
    .eq("status", "approved")
    .gt("reserved_for", agora.toISOString())
    .lte("reserved_for", teto.toISOString())
    .order("reserved_for", { ascending: true })
    .limit(TETO_POR_VOLTA);

  if (error) {
    // A coluna pode não existir num banco que ainda não recebeu a migração.
    // Nesse caso o resto do sistema segue funcionando sem lembrete, em vez de
    // o laço de minuto virar um despejo de erro no log.
    if (/reserva_lembrete_minutos|42703|PGRST/i.test(error.message)) return 0;
    throw new Error(`Falha ao varrer reservas: ${error.message}`);
  }

  let enfileirados = 0;
  for (const linha of (data ?? []) as LinhaDaVarredura[]) {
    const venue = linha.venues;
    if (!venue) continue;

    if (
      !estaNaHoraDeLembrar({
        reservadaPara: linha.reserved_for,
        criadaEm: linha.created_at,
        minutosDeAntecedencia: Number(venue.reserva_lembrete_minutos ?? 0),
        agora,
      })
    ) {
      continue;
    }

    const telefone = (linha.customer_phone ?? "").trim();
    if (!telefone) continue;

    const { error: erroInsert } = await inserirAvisos({
      venue_id: linha.venue_id,
      reservation_id: linha.id,
      channel: "whatsapp",
      destination: telefone,
      template: TEMPLATE_LEMBRETE,
      // O lembrete é sobre a reserva que o cliente fez com o agente, e a
      // resposta provável é "não vou poder ir" ou "dá para mudar a hora?" —
      // conversa, e conversa é com a IA. Sai pelo mesmo número da reserva.
      papel: "agente",
      body: textoDoLembrete(linha as unknown as Reservation, venue as unknown as Venue),
    });

    if (erroInsert) {
      // Índice único: outra volta da varredura chegou primeiro. Não é erro —
      // é a trava fazendo o trabalho dela.
      if (/duplicate key|unique/i.test(erroInsert.message)) continue;
      console.error(`[lembretes] reserva ${linha.id}: ${erroInsert.message}`);
      continue;
    }
    enfileirados += 1;
  }

  return enfileirados;
}
