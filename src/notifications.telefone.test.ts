import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizarTelefone, soOConectorEntrega, variacoesDoTelefone } from "./notifications.js";

describe("normalizarTelefone", () => {
  it("acrescenta o país quando falta e aceita o que já vem completo", () => {
    assert.equal(normalizarTelefone("65981382139"), "5565981382139");
    assert.equal(normalizarTelefone("(65) 98138-2139"), "5565981382139");
    assert.equal(normalizarTelefone("556581382139"), "556581382139");
    assert.equal(normalizarTelefone("123"), null);
  });
});

describe("variacoesDoTelefone", () => {
  it("oferece a versão sem o nono dígito", () => {
    // O caso real: cadastrado com 9, registrado no WhatsApp sem.
    assert.deepEqual(variacoesDoTelefone("5565981382139"), [
      "5565981382139",
      "556581382139",
    ]);
  });

  it("oferece a versão com o nono dígito", () => {
    assert.deepEqual(variacoesDoTelefone("556581382139"), [
      "556581382139",
      "5565981382139",
    ]);
  });

  it("não inventa variação para número de fixo nem de fora do Brasil", () => {
    assert.deepEqual(variacoesDoTelefone("551133334444"), [
      "551133334444",
      "5511933334444",
    ]);
    assert.deepEqual(variacoesDoTelefone("14155552671"), ["14155552671"]);
  });
});

describe("soOConectorEntrega", () => {
  it("reconhece o LID, que a Cloud API da Meta não sabe rotear", () => {
    // O caso que custou uma confirmação de reserva à casa: o WhatsApp migrou
    // a conta para LID, o aviso foi tentado pela Cloud API — que só roteia
    // telefone — e morreu na fila depois de quatro tentativas inúteis.
    assert.equal(soOConectorEntrega("189554237694113@lid"), true);
    assert.equal(soOConectorEntrega("189554237694113"), true, "LID gravado sem o sufixo");
  });

  it("deixa passar o que é telefone de verdade", () => {
    assert.equal(soOConectorEntrega("(65) 98138-2139"), false);
    assert.equal(soOConectorEntrega("5565981382139"), false);
    assert.equal(soOConectorEntrega("5565981382139@s.whatsapp.net"), false);
    assert.equal(soOConectorEntrega(""), false);
  });
});
