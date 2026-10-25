import assert from "node:assert/strict";
import test from "node:test";
import { BLOCOS, calcularDisc, descreverPerfil, mapaDaEquipe } from "./rhDisc.js";

test("todo bloco tem quatro palavras, uma por fator", () => {
  assert.equal(BLOCOS.length, 24);
  for (const b of BLOCOS) assert.equal(b.length, 4);
});

test("só D como mais e só C como menos dá D puro, D=100 e C=0", () => {
  const r = calcularDisc(BLOCOS.map(() => ({ mais: 0, menos: 3 })));
  assert.equal(r.d, 100);
  assert.equal(r.c, 0);
  assert.equal(r.i, 50);
  assert.equal(r.perfil, "D");
});

test("dois fatores perto viram perfil duplo", () => {
  const respostas = BLOCOS.map((_, n) => ({ mais: n % 2 === 0 ? 0 : 1, menos: 3 }));
  assert.equal(calcularDisc(respostas).perfil.length, 2);
});

test("resposta incompleta ou repetida é recusada", () => {
  assert.throws(() => calcularDisc([{ mais: 0, menos: 1 }]));
  assert.throws(() => calcularDisc(BLOCOS.map(() => ({ mais: 2, menos: 2 }))));
});

test("descrição e mapa da equipe", () => {
  assert.deepEqual(descreverPerfil("SC").map((d) => d.fator), ["S", "C"]);
  const mapa = mapaDaEquipe([{ perfil: "I" }, { perfil: "IS" }, { perfil: "I" }, { perfil: "S" }]);
  assert.deepEqual(mapa.contagem, { D: 0, I: 3, S: 1, C: 0 });
  assert.ok(mapa.observacoes.some((o) => o.includes("D forte")));
  assert.ok(mapa.observacoes.some((o) => o.includes("C forte")));
});
