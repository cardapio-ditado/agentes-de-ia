import assert from "node:assert/strict";
import test from "node:test";
import { contextoDoAviso } from "./notifications.js";

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
