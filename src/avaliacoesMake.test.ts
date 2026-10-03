import assert from "node:assert/strict";
import test from "node:test";
import { lerAvaliacaoDoMake, notaDaEstrela, segredoConfere } from "./avaliacoesMake.js";

test("a nota vem como o Google escreve (FIVE) ou como número", () => {
  assert.equal(notaDaEstrela("FIVE"), 5);
  assert.equal(notaDaEstrela("one"), 1);
  assert.equal(notaDaEstrela(4), 4);
  assert.equal(notaDaEstrela("3"), 3);
  assert.equal(notaDaEstrela("SIX"), null);
  assert.equal(notaDaEstrela(undefined), null);
});

test("o payload do Make vira avaliação: nome completo, autor, nota, comentário, e se já tem resposta", () => {
  const a = lerAvaliacaoDoMake({
    name: "accounts/1/locations/2/reviews/abc",
    starRating: "FOUR",
    reviewer: { displayName: "Renata P.", isAnonymous: false },
    comment: "  Chope gelado, atendimento ok. ",
    createTime: "2026-10-02T23:10:00Z",
    reviewReply: { comment: "" },
  });
  assert.equal(a.nota, 4);
  assert.equal(a.autor, "Renata P.");
  assert.equal(a.comentario, "Chope gelado, atendimento ok.");
  assert.equal(a.ja_respondida, false);

  const respondida = lerAvaliacaoDoMake({ name: "accounts/1/locations/2/reviews/x", starRating: "FIVE", reviewReply: { comment: "Valeu!" } });
  assert.equal(respondida.ja_respondida, true);
  assert.equal(respondida.autor, null);
  assert.equal(respondida.comentario, null);

  assert.throws(() => lerAvaliacaoDoMake({ name: "abc", starRating: "FIVE" }), /name/);
  assert.throws(() => lerAvaliacaoDoMake({ name: "accounts/1/locations/2/reviews/x" }), /nota/);
});

test("o segredo do cabeçalho confere em tempo constante, e vazio nunca passa", () => {
  assert.equal(segredoConfere("abc", "abc"), true);
  assert.equal(segredoConfere(["abc"], "abc"), true);
  assert.equal(segredoConfere("abd", "abc"), false);
  assert.equal(segredoConfere("", ""), false);
  assert.equal(segredoConfere(undefined, "abc"), false);
  assert.equal(segredoConfere("abc", null), false);
});
