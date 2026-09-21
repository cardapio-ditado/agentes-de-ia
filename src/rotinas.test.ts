import assert from "node:assert/strict";
import test from "node:test";
import { janelaDe } from "./rotinas.js";

test("a janela arredonda o instante para baixo, no passo pedido", () => {
  assert.equal(janelaDe(new Date("2026-09-21T15:07:42Z"), 1), "2026-09-21T15:07");

  // A de 50 min não alinha com a hora cheia — alinha com a época do Unix —,
  // e não precisa: o que importa é que fique para trás do instante e a
  // menos de 50 min dele.
  const instante = new Date("2026-09-21T15:07:42Z");
  const inicio = new Date(`${janelaDe(instante, 50)}:00Z`);
  assert.ok(inicio.getTime() <= instante.getTime());
  assert.ok(instante.getTime() - inicio.getTime() < 50 * 60_000);
  assert.equal(inicio.getUTCSeconds(), 0);
});

test("dois processos que acordam com segundos de diferença caem na mesma janela", () => {
  // É o caso real: os quatro processos foram ligados no mesmo instante e
  // acordam juntos, com um ou dois segundos de deriva.
  const a = janelaDe(new Date("2026-09-21T15:00:00Z"), 50);
  const b = janelaDe(new Date("2026-09-21T15:00:03Z"), 50);
  assert.equal(a, b);
});

test("a janela vizinha é outra chave — a rotina roda de novo na próxima hora", () => {
  const agora = janelaDe(new Date("2026-09-21T15:00:00Z"), 50);
  const depois = janelaDe(new Date("2026-09-21T16:00:00Z"), 50);
  assert.notEqual(agora, depois);
});
