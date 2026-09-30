import assert from "node:assert/strict";
import test from "node:test";
import { contextoDoAviso, erroDeModelo } from "./notifications.js";

test("o agente recebe o que a casa mandou, com o tipo do aviso e a data", () => {
  const texto = contextoDoAviso(
    { template: "aniversario_2026", body: "Oi, Emerson! 🎉\n\nSeu aniversário tá chegando…", sent_at: "2026-09-29T16:27:00.000Z" },
    "America/Cuiaba",
  );
  assert.match(texto, /RESPONDENDO/);
  assert.match(texto, /29\/09/);
  assert.match(texto, /aniversário/i);
  assert.match(texto, /Emerson/);
  assert.match(texto, /não confunda com outra promoção/);
});

test("sem data de envio, a frase continua de pé", () => {
  const texto = contextoDoAviso({ template: "pesquisa_convite", body: "Como foi ontem?", sent_at: null }, "America/Cuiaba");
  assert.match(texto, /Como foi ontem\?/);
  assert.doesNotMatch(texto, / em undefined/);
});

test("a Meta recusar o MODELO é diferente de recusar o número", () => {
  assert.equal(erroDeModelo("(#132001) Template name does not exist in the translation"), true);
  assert.equal(erroDeModelo("(#132015) Template is paused"), true);
  assert.equal(erroDeModelo("(#132012) Parameter format does not match format in the created template"), true);
  assert.equal(erroDeModelo("(#131026) Message undeliverable"), false);
  assert.equal(erroDeModelo("(#131049) This message was not delivered to maintain healthy ecosystem engagement."), false);
  assert.equal(erroDeModelo("HTTP 500 da API do WhatsApp."), false);
  assert.equal(erroDeModelo(undefined), false);
});
