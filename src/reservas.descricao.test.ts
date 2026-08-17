import { test } from "node:test";
import assert from "node:assert/strict";
import { descreverReservas } from "./tools/restaurante.js";
import type { Reservation } from "./venues.js";

const FUSO = "America/Cuiaba";

function reserva(quando: string, extra: Partial<Reservation> = {}): Reservation {
  return {
    id: "r-" + quando,
    reserved_for: quando,
    party_size: 4,
    status: "approved",
    venue_id: "v1",
    ...extra,
  } as Reservation;
}

test("reserva de dia 14 não aparece como futura no dia 17", () => {
  const texto = descreverReservas(
    [reserva("2026-08-14T23:00:00Z")],
    FUSO,
    new Date("2026-08-17T21:00:00Z"),
  );

  assert.match(texto, /não tem nenhuma reserva futura/);
  assert.match(texto, /JÁ PASSARAM/);
});

test("reserva de amanhã aparece como futura", () => {
  const texto = descreverReservas(
    [reserva("2026-08-18T23:00:00Z")],
    FUSO,
    new Date("2026-08-17T21:00:00Z"),
  );

  assert.match(texto, /AINDA VÃO ACONTECER/);
  assert.doesNotMatch(texto, /JÁ PASSARAM/);
});

test("as duas listas convivem, cada reserva do lado certo", () => {
  const texto = descreverReservas(
    [reserva("2026-08-20T23:00:00Z"), reserva("2026-08-14T23:00:00Z")],
    FUSO,
    new Date("2026-08-17T21:00:00Z"),
  );

  const futuro = texto.indexOf("AINDA VÃO ACONTECER");
  const passado = texto.indexOf("JÁ PASSARAM");
  assert.ok(futuro >= 0 && passado > futuro);
  // A do dia 20 tem que estar antes do cabeçalho do passado; a do 14, depois.
  assert.ok(texto.indexOf("r-2026-08-20T23:00:00Z") < passado);
  assert.ok(texto.indexOf("r-2026-08-14T23:00:00Z") > passado);
});

test("no minuto exato da reserva ela ainda conta como futura", () => {
  const instante = "2026-08-17T23:00:00Z";
  const texto = descreverReservas([reserva(instante)], FUSO, new Date(instante));

  assert.match(texto, /AINDA VÃO ACONTECER/);
});

test("sem reserva nenhuma, a resposta é explícita — não vazia", () => {
  const texto = descreverReservas([], FUSO, new Date("2026-08-17T21:00:00Z"));
  assert.match(texto, /não tem nenhuma reserva registrada/);
});
