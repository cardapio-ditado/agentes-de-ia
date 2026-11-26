import { test } from "node:test";
import assert from "node:assert/strict";
import { termoDeBusca } from "./inbox.js";

test("nome vira termo de texto, sem mexer em acento nem em @", () => {
  assert.deepEqual(termoDeBusca("  Roberta Laila "), { texto: "Roberta Laila", digitos: null });
  assert.deepEqual(termoDeBusca("@robertalaila_01"), { texto: "@robertalaila_01", digitos: null });
  assert.deepEqual(termoDeBusca("João"), { texto: "João", digitos: null });
});

test("telefone com máscara vira só os dígitos, que é como o número está guardado", () => {
  assert.deepEqual(termoDeBusca("(65) 99812-3344"), { texto: "65998123344", digitos: "65998123344" });
  assert.deepEqual(termoDeBusca("+55 65 9 9812"), { texto: "556599812", digitos: "556599812" });
});

test("o que é sintaxe de filtro não passa", () => {
  // Vírgula, parêntese, aspas e % separariam ou abririam o filtro do banco.
  assert.deepEqual(termoDeBusca('ana",id.neq.0,(x)%'), { texto: "ana id.neq.0 x", digitos: null });
  assert.equal(termoDeBusca('",()%*'), null);
});

test("busca curta demais não vira consulta", () => {
  assert.equal(termoDeBusca(""), null);
  assert.equal(termoDeBusca(null), null);
  assert.equal(termoDeBusca("a"), null);
  assert.equal(termoDeBusca("65"), null);
  assert.equal(termoDeBusca("   "), null);
});

test("termo enorme é cortado", () => {
  assert.equal(termoDeBusca("a".repeat(200))?.texto.length, 60);
});
