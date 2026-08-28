import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lerNascimento, telefoneDaBase } from "./clientes.js";

/**
 * As duas peças que decidem se a base de clientes presta.
 *
 * O telefone é a chave: normalizar errado faz a mesma pessoa virar três
 * linhas e receber três parabéns. E a data chega de três jeitos diferentes
 * (Zig, gerente digitando, gerente digitando sem o ano) — recusar por causa
 * do formato transformaria um detalhe em suporte.
 */

describe("telefoneDaBase", () => {
  it("põe o 55 no número nacional, venha como vier", () => {
    assert.equal(telefoneDaBase("(65) 99999-0001"), "5565999990001");
    assert.equal(telefoneDaBase("65999990001"), "5565999990001");
    assert.equal(telefoneDaBase("+55 65 99999-0001"), "5565999990001");
    assert.equal(telefoneDaBase("5565999990001"), "5565999990001");
  });

  it("fixo com DDD também é telefone de cliente", () => {
    assert.equal(telefoneDaBase("(65) 3333-2222"), "556533332222");
  });

  it("recusa o que não dá para mandar mensagem", () => {
    assert.equal(telefoneDaBase("9999"), null);
    assert.equal(telefoneDaBase(""), null);
    assert.equal(telefoneDaBase("não tenho"), null);
    assert.equal(telefoneDaBase("1".repeat(20)), null);
  });
});

describe("lerNascimento", () => {
  it("lê o formato da Zig", () => {
    assert.deepEqual(lerNascimento("1990-12-25"), { dia: 25, mes: 12, ano: 1990 });
    assert.deepEqual(lerNascimento("1990-12-25T00:00:00"), { dia: 25, mes: 12, ano: 1990 });
  });

  it("lê o que o gerente digita", () => {
    assert.deepEqual(lerNascimento("25/12/1990"), { dia: 25, mes: 12, ano: 1990 });
    assert.deepEqual(lerNascimento("5/1/1990"), { dia: 5, mes: 1, ano: 1990 });
  });

  it("aceita só dia e mês — é tudo que o parabéns precisa", () => {
    assert.deepEqual(lerNascimento("25/12"), { dia: 25, mes: 12, ano: null });
  });

  it("dois dígitos de ano viram o século certo", () => {
    // Ninguém cadastra cliente que nasce no futuro.
    assert.equal(lerNascimento("25/12/90").ano, 1990);
    assert.equal(lerNascimento("25/12/05").ano, 2005);
  });

  it("data impossível não vira aniversário", () => {
    assert.deepEqual(lerNascimento("32/12/1990"), { dia: null, mes: null, ano: null });
    assert.deepEqual(lerNascimento("25/13/1990"), { dia: null, mes: null, ano: null });
  });

  it("vazio e lixo não estouram — só não viram data", () => {
    for (const v of ["", "   ", "não sei", null, undefined]) {
      assert.deepEqual(lerNascimento(v), { dia: null, mes: null, ano: null }, String(v));
    }
  });
});
