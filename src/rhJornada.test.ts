import assert from "node:assert/strict";
import test from "node:test";
import { emHoras, minutosDoTurno, minutosNoturnosDoTurno } from "./rhJornada.js";

test("turno de dia e turno que passa da meia-noite", () => {
  assert.equal(minutosDoTurno("11:00", "15:00"), 240);
  assert.equal(minutosDoTurno("18:00:00", "02:00:00"), 480);
});

test("horário noturno: só o que cai entre 22h e 5h", () => {
  assert.equal(minutosNoturnosDoTurno("11:00", "15:00"), 0);
  assert.equal(minutosNoturnosDoTurno("18:00", "02:00"), 240);
  assert.equal(minutosNoturnosDoTurno("23:00", "06:00"), 360);
  assert.equal(minutosNoturnosDoTurno("03:00", "08:00"), 120);
});

test("horas por extenso", () => {
  assert.equal(emHoras(480), "8h");
  assert.equal(emHoras(495), "8h15");
});
