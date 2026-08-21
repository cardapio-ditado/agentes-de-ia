import assert from "node:assert/strict";
import test from "node:test";
import { ETIQUETAS, etiquetasValidas, telefoneLimpo } from "./pesquisa.js";

test("etiqueta fora da lista não entra no gráfico da casa", () => {
  // A lista fixa é o que permite dizer "as reclamações de espera dobraram".
  // Um POST feito à mão com texto livre estragaria isso em silêncio.
  assert.deepEqual(etiquetasValidas(["Comida", "<script>", "qualquer coisa"]), ["Comida"]);
});

test("etiqueta repetida conta uma vez", () => {
  assert.deepEqual(etiquetasValidas(["Comida", "Comida"]), ["Comida"]);
});

test("corpo estranho não derruba o registro da resposta", () => {
  // A opinião do cliente vale mais que a etiqueta: entra sem ela.
  assert.deepEqual(etiquetasValidas("Comida"), []);
  assert.deepEqual(etiquetasValidas(null), []);
  assert.deepEqual(etiquetasValidas(undefined), []);
  assert.deepEqual(etiquetasValidas({ 0: "Comida" }), []);
});

test("toda etiqueta oferecida é aceita de volta", () => {
  // Se a tela mostra uma opção que o servidor recusa, o cliente marca e some.
  assert.deepEqual(etiquetasValidas([...ETIQUETAS]), [...ETIQUETAS]);
});

test("o telefone perde a formatação e fica só em dígitos", () => {
  assert.equal(telefoneLimpo("(65) 99999-0000"), "65999990000");
  assert.equal(telefoneLimpo("+55 65 9 9999-0000"), "5565999990000");
});
