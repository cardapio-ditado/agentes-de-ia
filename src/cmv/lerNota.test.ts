import { test } from "node:test";
import assert from "node:assert/strict";
import { converter, somaConfere, tipoAceito } from "./lerNota.js";

test("transcrição normal vira linhas aproveitáveis", () => {
  const nota = converter({
    fornecedor: "  Açougue Central  ",
    documento: "12345",
    data_emissao: "2026-08-19",
    valor_total: 472,
    linhas: [
      { descricao: "PICANHA RESF KG", codigo: "7891", quantidade: 4.9, unidade: "KG", valor_unitario: 80 },
      { descricao: "REFRIG LATA 350ML", quantidade: 20, unidade: "UN", valor_unitario: 4 },
    ],
    avisos: [],
  });

  assert.equal(nota.fornecedor, "Açougue Central");
  assert.equal(nota.linhas.length, 2);
  assert.equal(nota.linhas[0]!.codigo, "7891");
  // Sem código na segunda linha: null, e não string vazia — o casamento por
  // código precisa distinguir "não tem" de "tem e é vazio".
  assert.equal(nota.linhas[1]!.codigo, null);
  assert.deepEqual(nota.avisos, []);
});

test("linha sem descrição é descartada e vira aviso", () => {
  // Linha inventada que passa despercebida na conferência entra no estoque.
  const nota = converter({
    linhas: [
      { descricao: "  ", quantidade: 3, valor_unitario: 10 },
      { descricao: "ARROZ 5KG", quantidade: 2, valor_unitario: 25 },
    ],
    avisos: [],
  });
  assert.equal(nota.linhas.length, 1);
  assert.equal(nota.linhas[0]!.descricao, "ARROZ 5KG");
  assert.equal(nota.avisos.length, 1);
});

test("quantidade ou valor ilegível vira aviso nominal, não linha", () => {
  const nota = converter({
    linhas: [
      { descricao: "OLEO SOJA 900ML", quantidade: 0, valor_unitario: 8 },
      { descricao: "FARINHA 1KG", quantidade: 5, valor_unitario: -1 },
      { descricao: "SAL 1KG", quantidade: "abc", valor_unitario: 3 },
    ],
    avisos: [],
  });
  assert.equal(nota.linhas.length, 0);
  assert.equal(nota.avisos.length, 3);
  // O aviso nomeia o item: quem está na doca precisa saber ONDE olhar na nota.
  assert.ok(nota.avisos.some((a) => a.includes("OLEO SOJA 900ML")));
  assert.ok(nota.avisos.some((a) => a.includes("FARINHA 1KG")));
});

test("avisos do modelo são preservados junto com os nossos", () => {
  const nota = converter({
    linhas: [{ descricao: "", quantidade: 1, valor_unitario: 1 }],
    avisos: ["A foto está cortada na parte de baixo."],
  });
  assert.equal(nota.avisos.length, 2);
  assert.ok(nota.avisos.includes("A foto está cortada na parte de baixo."));
});

test("data só é aceita em AAAA-MM-DD", () => {
  // "19/08/2026" lido como americano viraria lançamento em outro mês.
  assert.equal(converter({ linhas: [], avisos: [], data_emissao: "19/08/2026" }).dataEmissao, null);
  assert.equal(converter({ linhas: [], avisos: [], data_emissao: "2026-08-19" }).dataEmissao, "2026-08-19");
});

test("resposta vazia ou malformada não quebra", () => {
  const nota = converter({});
  assert.deepEqual(nota.linhas, []);
  assert.equal(nota.fornecedor, null);
  assert.equal(nota.valorTotal, null);
});

// ---------- conferência da soma ----------

test("soma das linhas batendo com o total confere", () => {
  const nota = converter({
    valor_total: 472,
    linhas: [
      { descricao: "PICANHA", quantidade: 4.9, valor_unitario: 80 },
      { descricao: "REFRI", quantidade: 20, valor_unitario: 4 },
    ],
    avisos: [],
  });
  const r = somaConfere(nota);
  assert.equal(r.confere, true);
  assert.equal(r.soma, 472);
});

test("linha inteira faltando é pega pela soma", () => {
  // O erro mais perigoso da transcrição: quantidade errada alguém nota na
  // doca olhando a mercadoria; linha faltando ninguém nota, porque não há o
  // que olhar.
  const nota = converter({
    valor_total: 472,
    linhas: [{ descricao: "PICANHA", quantidade: 4.9, valor_unitario: 80 }],
    avisos: [],
  });
  const r = somaConfere(nota);
  assert.equal(r.confere, false);
  assert.equal(r.diferenca, -80);
});

test("diferença de centavos passa — é arredondamento, não erro de leitura", () => {
  const nota = converter({
    valor_total: 100,
    linhas: [{ descricao: "X", quantidade: 3, valor_unitario: 33.34 }],
    avisos: [],
  });
  assert.equal(somaConfere(nota).confere, true);
});

test("sem total na nota, não há o que conferir", () => {
  const nota = converter({ linhas: [{ descricao: "X", quantidade: 1, valor_unitario: 5 }], avisos: [] });
  const r = somaConfere(nota);
  assert.equal(r.confere, true);
  assert.equal(r.diferenca, null);
});

test("PDF e formatos não suportados são recusados antes de gastar chamada", () => {
  assert.equal(tipoAceito("image/jpeg"), true);
  assert.equal(tipoAceito("IMAGE/PNG"), true);
  assert.equal(tipoAceito("application/pdf"), false);
  assert.equal(tipoAceito("text/plain"), false);
});
