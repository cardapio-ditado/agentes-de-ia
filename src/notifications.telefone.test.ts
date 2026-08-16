import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizarTelefone, variacoesDoTelefone } from "./notifications.js";

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
