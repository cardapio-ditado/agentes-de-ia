import assert from "node:assert/strict";
import test from "node:test";
import { converter, type InsumoDoVocabulario } from "./sugerirFicha.js";

const VOCABULARIO: InsumoDoVocabulario[] = [
  { id: "a", nome: "Tilápia filé", unidade: "kg" },
  { id: "b", nome: "Farinha de trigo", unidade: "kg" },
  { id: "c", nome: "Limão", unidade: "un" },
];

test("casa o número com o insumo do cadastro", () => {
  const r = converter(
    { rendimento: 4, ingredientes: [{ numero: 0, quantidade: 1.2 }], faltando: [], avisos: [] },
    VOCABULARIO,
  );
  assert.equal(r.ingredientes.length, 1);
  assert.equal(r.ingredientes[0]!.insumoId, "a");
  assert.equal(r.ingredientes[0]!.quantidade, 1.2);
  assert.equal(r.rendimento, 4);
});

test("número fora da lista vira aviso, nunca ingrediente", () => {
  // O modelo inventando um índice não pode virar "o mais parecido": isso
  // poria no prato um insumo que ninguém pediu, com custo real.
  const r = converter(
    { rendimento: 2, ingredientes: [{ numero: 99, quantidade: 1 }], faltando: [], avisos: [] },
    VOCABULARIO,
  );
  assert.equal(r.ingredientes.length, 0);
  assert.match(r.avisos.join(" "), /não está no cadastro/i);
});

test("quantidade zero ou negativa não entra na ficha", () => {
  const r = converter(
    {
      rendimento: 1,
      ingredientes: [
        { numero: 0, quantidade: 0 },
        { numero: 1, quantidade: -3 },
      ],
      faltando: [],
      avisos: [],
    },
    VOCABULARIO,
  );
  assert.equal(r.ingredientes.length, 0);
  assert.equal(r.avisos.filter((a) => /quantidade/i.test(a)).length, 2);
});

test("insumo repetido soma em vez de virar duas linhas", () => {
  const r = converter(
    {
      rendimento: 1,
      ingredientes: [
        { numero: 2, quantidade: 2 },
        { numero: 2, quantidade: 3 },
      ],
      faltando: [],
      avisos: [],
    },
    VOCABULARIO,
  );
  assert.equal(r.ingredientes.length, 1);
  assert.equal(r.ingredientes[0]!.quantidade, 5);
});

test("rendimento ausente vira 1 e avisa", () => {
  const r = converter(
    { ingredientes: [{ numero: 0, quantidade: 1 }], faltando: [], avisos: [] },
    VOCABULARIO,
  );
  assert.equal(r.rendimento, 1);
  assert.match(r.avisos.join(" "), /assumi 1/i);
});

test("o que falta no cadastro é devolvido à parte, não descartado", () => {
  const r = converter(
    {
      rendimento: 4,
      ingredientes: [{ numero: 0, quantidade: 1 }],
      faltando: [{ nome: "Creme de leite", unidade: "L", quantidade: 0.5 }],
      avisos: [],
    },
    VOCABULARIO,
  );
  assert.equal(r.faltando.length, 1);
  assert.equal(r.faltando[0]!.nome, "Creme de leite");
  assert.equal(r.faltando[0]!.unidade, "L");
});

test("ingrediente faltante sem unidade recebe 'un'", () => {
  const r = converter(
    {
      rendimento: 1,
      ingredientes: [{ numero: 0, quantidade: 1 }],
      faltando: [{ nome: "Coentro", quantidade: 1 }],
      avisos: [],
    },
    VOCABULARIO,
  );
  assert.equal(r.faltando[0]!.unidade, "un");
});

test("ficha sem nenhum ingrediente cadastrado avisa em vez de sair vazia em silêncio", () => {
  const r = converter({ rendimento: 2, ingredientes: [], faltando: [], avisos: [] }, VOCABULARIO);
  assert.equal(r.ingredientes.length, 0);
  assert.match(r.avisos.join(" "), /Cadastre os que faltam/i);
});

test("observação de preparo é preservada", () => {
  const r = converter(
    {
      rendimento: 1,
      ingredientes: [{ numero: 0, quantidade: 1, observacao: "peso limpo, sem espinha" }],
      faltando: [],
      avisos: [],
    },
    VOCABULARIO,
  );
  assert.equal(r.ingredientes[0]!.observacao, "peso limpo, sem espinha");
});

test("resposta vazia do modelo não quebra a tela", () => {
  const r = converter({}, VOCABULARIO);
  assert.equal(r.ingredientes.length, 0);
  assert.equal(r.faltando.length, 0);
  assert.equal(r.rendimento, 1);
});
