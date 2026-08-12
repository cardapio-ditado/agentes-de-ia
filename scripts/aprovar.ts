import { parseArgs } from "node:util";
import {
  findVenueBySlug,
  getReservation,
  listPendingReservations,
  reviewReservation,
  type Reservation,
  type Venue,
} from "../src/venues.js";

/**
 * Módulo de aprovação em linha de comando.
 *
 * Fila do estabelecimento:
 *   npm run aprovar -- --venue ditado-popular
 *
 * Decidir:
 *   npm run aprovar -- --aprovar <protocolo>
 *   npm run aprovar -- --recusar <protocolo> --motivo "casa lotada nesse horário"
 *
 * A mesma lógica alimenta a tela web de aprovação — a regra de negócio mora em
 * `src/venues.ts`, não aqui.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      venue: { type: "string" },
      aprovar: { type: "string" },
      recusar: { type: "string" },
      motivo: { type: "string" },
    },
  });

  if (values.aprovar) {
    await decidir(values.aprovar, "approved", values.motivo);
    return;
  }
  if (values.recusar) {
    if (!values.motivo) {
      throw new Error("Recusar exige --motivo: o cliente precisa saber por quê.");
    }
    await decidir(values.recusar, "rejected", values.motivo);
    return;
  }
  if (values.venue) {
    await mostrarFila(await findVenueBySlug(values.venue));
    return;
  }

  console.log(
    [
      "Uso:",
      "  npm run aprovar -- --venue <slug>                          lista a fila",
      "  npm run aprovar -- --aprovar <protocolo> [--motivo ...]    aprova",
      '  npm run aprovar -- --recusar <protocolo> --motivo "..."    recusa',
    ].join("\n"),
  );
}

async function mostrarFila(venue: Venue): Promise<void> {
  const pendentes = await listPendingReservations(venue.id);

  console.log(`\nFila de aprovação — ${venue.name}`);
  if (pendentes.length === 0) {
    console.log("Nenhuma reserva pendente.\n");
    return;
  }

  console.log(`${pendentes.length} reserva(s) aguardando decisão:\n`);
  for (const reserva of pendentes) {
    console.log(descrever(reserva, venue));
    console.log("");
  }
}

async function decidir(
  protocolo: string,
  status: "approved" | "rejected",
  motivo?: string,
): Promise<void> {
  const antes = await getReservation(protocolo);
  if (!antes) throw new Error(`Reserva ${protocolo} não encontrada.`);

  const reserva = await reviewReservation({ reservationId: protocolo, status, reason: motivo });
  const rotulo = status === "approved" ? "APROVADA" : "RECUSADA";

  console.log(`\nReserva ${rotulo}`);
  console.log(`  ${reserva.customer_name} — ${reserva.party_size} pessoa(s)`);
  console.log(`  ${new Date(reserva.reserved_for).toISOString()}`);
  console.log(`  Contato: ${reserva.customer_phone}`);
  if (motivo) console.log(`  Motivo: ${motivo}`);
  console.log(`\nAvise o cliente pelo canal de origem (${reserva.source_channel}).\n`);
}

function descrever(reserva: Reservation, venue: Venue): string {
  const quando = new Intl.DateTimeFormat("pt-BR", {
    timeZone: venue.timezone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(reserva.reserved_for));

  const linhas = [
    `  Protocolo : ${reserva.id}`,
    `  Cliente   : ${reserva.customer_name} (${reserva.customer_phone})`,
    `  Quando    : ${quando}  —  ${reserva.party_size} pessoa(s)`,
    `  Canal     : ${reserva.source_channel}`,
  ];
  if (reserva.area_preference) linhas.push(`  Área      : ${reserva.area_preference}`);
  if (reserva.occasion) linhas.push(`  Ocasião   : ${reserva.occasion}`);
  if (reserva.notes) linhas.push(`  Observação: ${reserva.notes}`);
  return linhas.join("\n");
}

main().catch((erro) => {
  console.error(`\n[erro] ${erro instanceof Error ? erro.message : erro}\n`);
  process.exit(1);
});
