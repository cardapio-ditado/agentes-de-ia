import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIANCA_AUTOMATICA,
  casarPorTexto,
  normalizar,
  pendentes,
  semelhanca,
  type Apelido,
  type InsumoConhecido,
} from "./casarInsumo.js";

function insumo(nome: string, extra: Partial<InsumoConhecido> = {}): InsumoConhecido {
  return {
    id: `id-${nome}`,
    nome,
    nomeNormalizado: normalizar(nome),
    codigo: null,
    unidade: "kg",
    ...extra,
  };
}

const ESTOQUE = [
  insumo("Tilápia congelada", { codigo: "7891", id: "tilapia" }),
  insumo("Tiras de frango", { id: "frango" }),
  insumo("Óleo de soja", { id: "oleo" }),
  insumo("Farinha de trigo", { id: "farinha" }),
];

test("código do fornecedor casa com certeza absoluta", () => {
  const r = casarPorTexto("QUALQUER COISA ESCRITA AQUI", "7891", ESTOQUE, []);
  assert.equal(r.insumoId, "tilapia");
  assert.equal(r.como, "codigo");
  assert.equal(r.confianca, 1);
});

test("apelido aprendido vence a parecença — é o degrau que se paga", () => {
  // Alguém casou "FGO TIRAS CX" à mão uma vez. Da segunda nota em diante,
  // aquele fornecedor entra sozinho.
  const apelidos: Apelido[] = [{ insumoId: "frango", apelidoNormalizado: normalizar("FGO TIRAS CX") }];
  const r = casarPorTexto("FGO TIRAS CX", null, ESTOQUE, apelidos);
  assert.equal(r.insumoId, "frango");
  assert.equal(r.como, "apelido");
  assert.equal(r.confianca, 1);
});

test("grafia diferente do mesmo insumo casa como nome exato", () => {
  // O caso que virou dois saldos separados no Gorjeta.
  const r = casarPorTexto("  TIRAS   DE  FRANGO ", null, ESTOQUE, []);
  assert.equal(r.insumoId, "frango");
  assert.equal(r.como, "nome_exato");
});

test("ordem trocada e ruído de embalagem ainda casam", () => {
  // "TILAPIA CONG FILE CX 10KG" é como o fornecedor escreve; "Tilápia
  // congelada" é como a casa cadastrou.
  const r = casarPorTexto("TILAPIA CONG CX 10KG", null, ESTOQUE, []);
  assert.equal(r.insumoId, "tilapia");
  assert.equal(r.como, "nome_parecido");
});

test("parecença NUNCA entra sozinha, por melhor que seja a nota", () => {
  // Entrada de mercadoria no insumo errado não dá erro na tela: aparece na
  // contagem semanas depois como "sumiu frango e sobrou peixe".
  const r = casarPorTexto("TILAPIA CONG CX 10KG", null, ESTOQUE, []);
  assert.ok(r.confianca < CONFIANCA_AUTOMATICA, `confiança ${r.confianca} não pode ser automática`);
});

test("coincidência de palavra genérica não vira casamento", () => {
  // "de" e "soja" — só "soja" é útil, e ela não está em nenhum insumo.
  const r = casarPorTexto("EXTRATO DE SOJA FERMENTADO", null, ESTOQUE, []);
  assert.equal(r.insumoId, null);
  assert.equal(r.como, "nenhum");
});

test("descrição que não lembra nada devolve nenhum", () => {
  const r = casarPorTexto("GUARDANAPO PAPEL 20X20", null, ESTOQUE, []);
  assert.equal(r.insumoId, null);
});

test("estoque vazio não quebra — o primeiro insumo nasce da própria nota", () => {
  const r = casarPorTexto("TILAPIA", null, [], []);
  assert.equal(r.insumoId, null);
  assert.equal(r.como, "nenhum");
});

test("semelhança divide pelo menor: cadastro enxuto não é punido", () => {
  // A nota é sempre mais verbosa que o cadastro. Dividir pelo maior faria
  // "Tilápia congelada" perder para uma descrição cheia de embalagem.
  const nota = semelhanca("TILAPIA CONGELADA IQF CAIXA 10KG", "Tilápia congelada");
  assert.equal(nota, 1);
});

test("pendentes separa só o que precisa de olho humano", () => {
  const linhas = ["a", "b", "c"];
  const casamentos = [
    { insumoId: "x", como: "codigo" as const, confianca: 1 },
    { insumoId: "y", como: "nome_parecido" as const, confianca: 0.7 },
    { insumoId: null, como: "nenhum" as const, confianca: 0 },
  ];
  const fila = pendentes(linhas, casamentos);
  assert.deepEqual(
    fila.map((f) => f.linha),
    ["b", "c"],
  );
});

test("lista de casamentos menor que a de linhas manda tudo para conferência", () => {
  // Descompasso de tamanho é bug. Tratar a linha faltante como resolvida
  // daria entrada silenciosa no estoque errado.
  const fila = pendentes(["a", "b"], [{ insumoId: "x", como: "codigo", confianca: 1 }]);
  assert.deepEqual(
    fila.map((f) => f.linha),
    ["b"],
  );
});
