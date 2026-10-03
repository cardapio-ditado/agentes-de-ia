import assert from "node:assert/strict";
import test from "node:test";
import { lerAvaliacaoDoMake, lerPaginaDoGoogle, limparComentario, notaDaEstrela, segredoConfere } from "./avaliacoesMake.js";

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

test("a resposta que já está no Google vem junto, com a data dela", () => {
  const a = lerAvaliacaoDoMake({
    name: "accounts/1/locations/2/reviews/3",
    starRating: "FOUR",
    comment: "Boa noite, boa música.",
    createTime: "2026-01-10T20:00:00Z",
    reviewReply: { comment: "  Valeu, Ana! Volte sempre.  ", updateTime: "2026-01-11T09:00:00Z" },
  });
  assert.equal(a.ja_respondida, true);
  assert.equal(a.resposta_google, "Valeu, Ana! Volte sempre.");
  assert.equal(a.respondida_em, "2026-01-11T09:00:00Z");

  const semResposta = lerAvaliacaoDoMake({ name: "accounts/1/locations/2/reviews/4", starRating: "FIVE" });
  assert.equal(semResposta.ja_respondida, false);
  assert.equal(semResposta.resposta_google, null);
  assert.equal(semResposta.respondida_em, null);
});

test("o comentário traduzido pelo Google volta ao que a pessoa escreveu", () => {
  assert.equal(
    limparComentario("(Translated by Google) Great place!\n\n(Original)\nLugar ótimo!"),
    "Lugar ótimo!",
  );
  assert.equal(limparComentario("(Translated by Google) Classic"), "Classic");
  assert.equal(limparComentario("  Só nota  "), "Só nota");
  assert.equal(limparComentario(""), null);
  assert.equal(limparComentario(undefined), null);
});

test("uma página do Google vira lista, nota média, total e cursor da próxima", () => {
  const pagina = lerPaginaDoGoogle({
    reviews: [
      { name: "accounts/1/locations/2/reviews/a", starRating: "FIVE", createTime: "2026-02-01T00:00:00Z" },
      { name: "sem-nome-valido", starRating: "ONE" },
      { name: "accounts/1/locations/2/reviews/b", starRating: "TWO", comment: "Demorou.", reviewReply: { comment: "Desculpe." } },
      null,
    ],
    averageRating: 4.63,
    totalReviewCount: 1234,
    nextPageToken: "  tok-2  ",
  });
  assert.deepEqual(pagina.avaliacoes.map((a) => a.name), ["accounts/1/locations/2/reviews/a", "accounts/1/locations/2/reviews/b"]);
  assert.equal(pagina.avaliacoes[1]?.resposta_google, "Desculpe.");
  assert.equal(pagina.nota_media, 4.63);
  assert.equal(pagina.total, 1234);
  assert.equal(pagina.proxima_pagina, "tok-2");

  const ultima = lerPaginaDoGoogle({ reviews: [], averageRating: "x", totalReviewCount: -1 });
  assert.deepEqual(ultima, { avaliacoes: [], nota_media: null, total: null, proxima_pagina: null });
  assert.deepEqual(lerPaginaDoGoogle({}).avaliacoes, []);
});
