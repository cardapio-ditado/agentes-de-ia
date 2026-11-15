import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LinkDeAvaliacaoInvalido,
  aniversarioInformado,
  linkDeAvaliacaoDaCasa,
  linkDeAvaliacaoValido,
  linkParaQuemRespondeu,
} from "./pesquisaFim.js";

const LINK = "https://g.page/r/CabcDEF123/review";

test("aceita os links de avaliação que o Google entrega", () => {
  for (const url of [
    LINK,
    "https://search.google.com/local/writereview?placeid=ChIJabc",
    "https://www.google.com/maps/place/Casa/@-15.6,-56.1,17z",
    "https://maps.app.goo.gl/AbCdEf123",
    "https://google.com/maps?cid=123",
  ]) {
    assert.equal(linkDeAvaliacaoValido(url), new URL(url).toString(), url);
  }
});

test("em branco é 'sem link', não erro — é assim que a casa desliga o botão", () => {
  assert.equal(linkDeAvaliacaoValido(""), null);
  assert.equal(linkDeAvaliacaoValido("   "), null);
  assert.equal(linkDeAvaliacaoValido(null), null);
  assert.equal(linkDeAvaliacaoValido(undefined), null);
});

test("recusa o que não é https no Google — inclusive o que só parece", () => {
  for (const url of [
    "http://g.page/r/abc/review",
    "g.page/r/abc/review",
    "https://google.com.golpe.net/review",
    "https://golpe.net/?u=https://google.com",
    "https://golpe.net/google.com",
    "https://google.com@golpe.net/review",
    "https://notgoogle.com/review",
    "https://xg.page/r/abc",
    "https://goo.gl/maps/abc",
    "javascript:alert(1)//google.com",
    "um texto qualquer",
  ]) {
    assert.throws(() => linkDeAvaliacaoValido(url), LinkDeAvaliacaoInvalido, url);
  }
});

test("o link da casa sai de settings, e settings estranho não vira botão", () => {
  assert.equal(linkDeAvaliacaoDaCasa({ google_avaliacao_url: LINK, maps_url: "x" }), LINK);
  assert.equal(linkDeAvaliacaoDaCasa({ google_avaliacao_url: "https://golpe.net" }), null);
  assert.equal(linkDeAvaliacaoDaCasa({ google_avaliacao_url: null }), null);
  assert.equal(linkDeAvaliacaoDaCasa({}), null);
  assert.equal(linkDeAvaliacaoDaCasa(null), null);
  assert.equal(linkDeAvaliacaoDaCasa([LINK]), null);
});

test("só promotor (9 e 10) recebe o link; neutro e detrator nunca", () => {
  const settings = { google_avaliacao_url: LINK };
  assert.equal(linkParaQuemRespondeu(10, settings), LINK);
  assert.equal(linkParaQuemRespondeu(9, settings), LINK);
  for (const nota of [8, 7, 6, 3, 0]) assert.equal(linkParaQuemRespondeu(nota, settings), null, String(nota));
  assert.equal(linkParaQuemRespondeu(null, settings), null);
  assert.equal(linkParaQuemRespondeu(undefined, settings), null);
  assert.equal(linkParaQuemRespondeu(Number.NaN, settings), null);
});

test("sem link configurado, nem o promotor recebe nada — nada muda para a casa", () => {
  assert.equal(linkParaQuemRespondeu(10, {}), null);
  assert.equal(linkParaQuemRespondeu(10, null), null);
});

test("o aniversário da pesquisa é só dia e mês", () => {
  assert.equal(aniversarioInformado("7/3"), "07/03");
  assert.equal(aniversarioInformado("25/12"), "25/12");
  assert.equal(aniversarioInformado("29/02"), "29/02");
  // O ano é descartado mesmo que venha: a tela prometeu não pedir.
  assert.equal(aniversarioInformado("25/12/1990"), "25/12");
});

test("aniversário em branco, pela metade ou impossível não entra", () => {
  for (const bruto of ["", "25", "/12", "32/01", "10/13", "31/04", "30/02", "abc", null, undefined, 2512]) {
    assert.equal(aniversarioInformado(bruto), null, String(bruto));
  }
});
