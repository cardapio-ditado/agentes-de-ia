import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { interpretarLinhas, lerPlanilhaDeClientes } from "./pesquisaPlanilha.js";

/**
 * A planilha de clientes que chega de verdade: coluna fora de ordem,
 * cabeçalho com acento, telefone formatado de três jeitos e linha duplicada.
 */

describe("interpretarLinhas", () => {
  it("acha as colunas pelo cabeçalho, em qualquer ordem", () => {
    const r = interpretarLinhas([
      ["Data", "Nome", "Telefone"],
      ["2026-08-20", "João Silva", "(65) 99999-0001"],
      ["2026-08-20", "Maria", "65 99999-0002"],
    ]);
    assert.equal(r.convidados.length, 2);
    assert.equal(r.convidados[0]!.nome, "João Silva");
    assert.equal(r.convidados[0]!.telefone, "65999990001");
    assert.equal(r.recusadas.length, 0);
  });

  it("aceita os apelidos do cabeçalho: whatsapp, celular, contato", () => {
    for (const cabecalho of ["WhatsApp", "Celular", "Contato"]) {
      const r = interpretarLinhas([[cabecalho], ["65 99999-0003"]]);
      assert.equal(r.convidados.length, 1, cabecalho);
    }
  });

  it("recusa telefone sem DDD e DIZ a linha e o motivo", () => {
    const r = interpretarLinhas([
      ["nome", "telefone"],
      ["Ana", "9999-0001"],
      ["Bia", "65 99999-0004"],
    ]);
    assert.equal(r.convidados.length, 1);
    assert.equal(r.recusadas.length, 1);
    assert.equal(r.recusadas[0]!.linha, 2);
    assert.match(r.recusadas[0]!.motivo, /DDD/);
  });

  it("a mesma pessoa duas vezes na planilha vira UM convite", () => {
    const r = interpretarLinhas([
      ["nome", "telefone"],
      ["João", "(65) 99999-0005"],
      ["João de novo", "65999990005"],
    ]);
    assert.equal(r.convidados.length, 1);
  });

  it("sem cabeçalho, encontra a coluna com cara de telefone sozinha", () => {
    const r = interpretarLinhas([
      ["João Silva", "65 99999-0006"],
      ["Maria Souza", "65 99999-0007"],
    ]);
    assert.equal(r.convidados.length, 2);
    assert.equal(r.convidados[0]!.telefone, "65999990006");
  });

  it("sem coluna nenhuma de telefone, explica em vez de importar zero em silêncio", () => {
    const r = interpretarLinhas([["nome", "email"], ["Ana", "ana@x.com"]]);
    assert.equal(r.convidados.length, 0);
    assert.match(r.recusadas[0]!.motivo, /telefone/i);
  });

  it("linha vazia não vira recusa — export de Excel adora linha vazia no fim", () => {
    const r = interpretarLinhas([
      ["nome", "telefone"],
      ["Ana", "65 99999-0008"],
      ["", ""],
    ]);
    assert.equal(r.convidados.length, 1);
    assert.equal(r.recusadas.length, 0);
  });
});

describe("lerPlanilhaDeClientes", () => {
  it("lê um .xlsx de verdade, com número na célula em vez de texto", async () => {
    const livro = new ExcelJS.Workbook();
    const aba = livro.addWorksheet("Clientes");
    aba.addRow(["Nome", "Telefone"]);
    aba.addRow(["João Silva", "65999990009"]);
    aba.addRow(["Maria", 65999990010]); // número puro — Excel faz isso sozinho
    const buffer = Buffer.from(await livro.xlsx.writeBuffer());

    const r = await lerPlanilhaDeClientes(buffer);
    assert.equal(r.convidados.length, 2);
    assert.equal(r.convidados[1]!.telefone, "65999990010");
  });

  it("lê CSV com ponto-e-vírgula — o que o Excel brasileiro exporta", async () => {
    const csv = Buffer.from("nome;telefone\nJoão;65 99999-0011\nMaria;65 99999-0012\n", "utf8");
    const r = await lerPlanilhaDeClientes(csv);
    assert.equal(r.convidados.length, 2);
    assert.equal(r.convidados[0]!.nome, "João");
  });
});
