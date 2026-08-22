import assert from "node:assert/strict";
import test from "node:test";
import { estaNaHoraDeLembrar, textoDoLembrete } from "./lembretes.js";
import type { Reservation, Venue } from "./venues.js";

const AGORA = new Date("2026-08-22T22:00:00.000Z");

/** Minutos a partir de agora, em ISO. */
const em = (minutos: number) => new Date(AGORA.getTime() + minutos * 60_000).toISOString();

function caso(over: Partial<Parameters<typeof estaNaHoraDeLembrar>[0]> = {}) {
  return estaNaHoraDeLembrar({
    reservadaPara: em(50),
    criadaEm: em(-2880), // reservou dois dias antes
    minutosDeAntecedencia: 60,
    agora: AGORA,
    ...over,
  });
}

test("reserva daqui a 50 minutos, com lembrete de 60, entra", () => {
  assert.equal(caso(), true);
});

test("reserva daqui a 3 horas ainda não entra", () => {
  assert.equal(caso({ reservadaPara: em(180) }), false);
});

test("a janela abre exatamente no minuto certo", () => {
  // Com 60 de antecedência, a reserva de daqui a 60 minutos está na borda —
  // e a borda tem que entrar, senão o lembrete só sai um minuto depois.
  assert.equal(caso({ reservadaPara: em(60) }), true);
  assert.equal(caso({ reservadaPara: em(61) }), false);
});

test("reserva que já passou não recebe lembrete", () => {
  // O caso que estraga tudo: o conector fica três horas fora do ar e volta
  // mandando "lembrete" para quem já jantou.
  assert.equal(caso({ reservadaPara: em(-30) }), false);
  assert.equal(caso({ reservadaPara: em(0) }), false);
});

test("reserva feita em cima da hora não é lembrada", () => {
  // Combinou às 19h30 para as 20h. Ser lembrado às 19h31 de algo que fez há
  // um minuto é ruído, não serviço.
  assert.equal(caso({ reservadaPara: em(30), criadaEm: em(-1) }), false);
});

test("reserva feita um instante antes da janela ainda é lembrada", () => {
  // Reservou às 20h58 para as 22h, lembrete de 60 min: a janela abre às 21h.
  // Ele reservou ANTES da janela, então recebe.
  assert.equal(caso({ reservadaPara: em(60), criadaEm: em(-1) }), true);
  // Reservou DEPOIS que a janela abriu: não recebe.
  assert.equal(caso({ reservadaPara: em(60), criadaEm: em(1) }), false);
});

test("antecedência zero desliga o lembrete", () => {
  assert.equal(caso({ minutosDeAntecedencia: 0 }), false);
  assert.equal(caso({ minutosDeAntecedencia: -5 }), false);
});

test("antecedência longa funciona igual", () => {
  // Uma casa pode querer lembrar de manhã sobre a noite.
  assert.equal(caso({ reservadaPara: em(400), minutosDeAntecedencia: 480 }), true);
  assert.equal(caso({ reservadaPara: em(500), minutosDeAntecedencia: 480 }), false);
});

test("data inválida não vira lembrete em hora inventada", () => {
  assert.equal(caso({ reservadaPara: "22/08/2026" }), false);
  assert.equal(caso({ criadaEm: "ontem" }), false);
});

/* ---------- o texto ---------- */

const VENUE = { name: "Ditado Popular", timezone: "America/Cuiaba" } as Venue;

function reserva(over: Partial<Reservation> = {}): Reservation {
  return {
    customer_name: "Mariana Prado",
    party_size: 6,
    reserved_for: "2026-08-23T00:00:00.000Z", // 20h em Cuiabá
    area_preference: null,
    ...over,
  } as Reservation;
}

test("a hora sai no relógio da casa, não em UTC", () => {
  // Meia-noite UTC é 20h em Cuiabá. Mandar "às 00:00" faria o cliente achar
  // que a reserva é de madrugada.
  assert.match(textoDoLembrete(reserva(), VENUE), /às 20:00/);
});

test("o lembrete chama a pessoa pelo primeiro nome", () => {
  assert.match(textoDoLembrete(reserva(), VENUE), /^Oi, Mariana!/);
});

test("cliente sem nome não vira 'Oi, undefined'", () => {
  const texto = textoDoLembrete(reserva({ customer_name: "" }), VENUE);
  assert.ok(!/undefined|null/.test(texto), texto);
});

test("o lembrete convida a avisar se não vier — é o que libera a mesa", () => {
  assert.match(textoDoLembrete(reserva(), VENUE), /não puder vir/i);
});

test("a área só aparece quando existe", () => {
  assert.ok(!/Área:/.test(textoDoLembrete(reserva(), VENUE)));
  assert.match(textoDoLembrete(reserva({ area_preference: "Área externa" }), VENUE), /Área: Área externa/);
});

test("uma pessoa não vira '1 pessoas'", () => {
  assert.match(textoDoLembrete(reserva({ party_size: 1 }), VENUE), /1 pessoa\b/);
  assert.match(textoDoLembrete(reserva({ party_size: 2 }), VENUE), /2 pessoas/);
});
