import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULOS_VENDAVEIS, TIPOS_DE_CASA, fusoDaUf, fusoValido, modulosDoCadastro, promptInicial } from "./tenants.js";

test("fusoDaUf: o estado decide o fuso, e todo fuso da tabela existe", () => {
  assert.equal(fusoDaUf("MT"), "America/Cuiaba");
  assert.equal(fusoDaUf(" sp "), "America/Sao_Paulo");
  assert.equal(fusoDaUf("AC"), "America/Rio_Branco");
  assert.equal(fusoDaUf("XX"), null);
  assert.equal(fusoDaUf(undefined), null);
  const ufs = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
  for (const uf of ufs) {
    const fuso = fusoDaUf(uf);
    assert.ok(fuso && fusoValido(fuso), `sem fuso válido para ${uf}`);
  }
});

test("fusoValido recusa o nome digitado errado", () => {
  assert.equal(fusoValido("America/Cuiaba"), true);
  assert.equal(fusoValido("America/Cuiabá"), false);
  assert.equal(fusoValido("Cuiaba"), false);
});

test("modulosDoCadastro: sem escolha vale o molde; delivery traz o cardápio; módulo estranho é recusado", () => {
  assert.deepEqual(modulosDoCadastro("delivery", undefined), ["agentes-ia", "cardapio-digital", "delivery"]);
  assert.deepEqual(modulosDoCadastro("bar", ["checklist", "checklist", "rh"]), ["checklist", "rh"]);
  assert.deepEqual(modulosDoCadastro("bar", ["delivery"]), ["delivery", "cardapio-digital"]);
  assert.deepEqual(modulosDoCadastro("bar", []), []); // lista vazia é escolha, não esquecimento
  assert.throws(() => modulosDoCadastro("bar", ["plataforma"]), /não existe/);
});

test("todo molde só liga módulo que se vende", () => {
  const vendaveis = new Set<string>(MODULOS_VENDAVEIS);
  for (const [tipo, molde] of Object.entries(TIPOS_DE_CASA)) {
    for (const m of molde.modulos) assert.ok(vendaveis.has(m), `${tipo} liga "${m}", que não se vende`);
  }
});

test("promptInicial: quem só entrega não nasce falando de reserva", () => {
  const bar = promptInicial("bar", "Ditado", "Cuiabá");
  assert.match(bar, /recepcionista virtual do Ditado em Cuiabá/);
  assert.match(bar, /NUNCA confirme uma reserva/);
  const delivery = promptInicial("delivery", "Delliris", "");
  assert.match(delivery, /atendente virtual do Delliris\./);
  assert.ok(!/reserva/i.test(delivery));
  assert.match(delivery, /Não invente informação/);
});
