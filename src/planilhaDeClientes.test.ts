import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { interpretarLinhas, lerPlanilhaDeClientes } from "./planilhaDeClientes.js";

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
    assert.equal(r.pessoas.length, 2);
    assert.equal(r.pessoas[0]!.nome, "João Silva");
    assert.equal(r.pessoas[0]!.telefone, "65999990001");
    assert.equal(r.recusadas.length, 0);
  });

  it("aceita os apelidos do cabeçalho: whatsapp, celular, contato", () => {
    for (const cabecalho of ["WhatsApp", "Celular", "Contato"]) {
      const r = interpretarLinhas([[cabecalho], ["65 99999-0003"]]);
      assert.equal(r.pessoas.length, 1, cabecalho);
    }
  });

  it("recusa telefone sem DDD e DIZ a linha e o motivo", () => {
    const r = interpretarLinhas([
      ["nome", "telefone"],
      ["Ana", "9999-0001"],
      ["Bia", "65 99999-0004"],
    ]);
    assert.equal(r.pessoas.length, 1);
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
    assert.equal(r.pessoas.length, 1);
  });

  it("sem cabeçalho, encontra a coluna com cara de telefone sozinha", () => {
    const r = interpretarLinhas([
      ["João Silva", "65 99999-0006"],
      ["Maria Souza", "65 99999-0007"],
    ]);
    assert.equal(r.pessoas.length, 2);
    assert.equal(r.pessoas[0]!.telefone, "65999990006");
  });

  it("sem coluna nenhuma de telefone, explica em vez de importar zero em silêncio", () => {
    const r = interpretarLinhas([["nome", "email"], ["Ana", "ana@x.com"]]);
    assert.equal(r.pessoas.length, 0);
    assert.match(r.recusadas[0]!.motivo, /telefone/i);
  });

  it("linha vazia não vira recusa — export de Excel adora linha vazia no fim", () => {
    const r = interpretarLinhas([
      ["nome", "telefone"],
      ["Ana", "65 99999-0008"],
      ["", ""],
    ]);
    assert.equal(r.pessoas.length, 1);
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
    assert.equal(r.pessoas.length, 2);
    assert.equal(r.pessoas[1]!.telefone, "65999990010");
  });

  it("lê CSV com ponto-e-vírgula — o que o Excel brasileiro exporta", async () => {
    const csv = Buffer.from("nome;telefone\nJoão;65 99999-0011\nMaria;65 99999-0012\n", "utf8");
    const r = await lerPlanilhaDeClientes(csv);
    assert.equal(r.pessoas.length, 2);
    assert.equal(r.pessoas[0]!.nome, "João");
  });
});

/**
 * AS COLUNAS QUE A BASE DE CLIENTES QUER A MAIS.
 *
 * O leitor nasceu para os convites da pesquisa, que só precisam de nome e
 * telefone. A base de clientes quer o que mais vier — e o aniversário é o
 * campo que faz a casa ganhar dinheiro com isso, então ele é o que mais
 * merece teste.
 */
describe("colunas da ficha do cliente", () => {
  it("traz aniversário, e-mail e observações quando a planilha tem", () => {
    const r = interpretarLinhas([
      ["nome", "telefone", "aniversário", "e-mail", "observações"],
      ["Ana", "65999990020", "25/12/1990", "ana@exemplo.com", "Gosta da mesa do fundo"],
    ]);
    assert.equal(r.pessoas.length, 1);
    const a = r.pessoas[0]!;
    assert.equal(a.nascimento, "25/12/1990");
    assert.equal(a.email, "ana@exemplo.com");
    assert.equal(a.observacoes, "Gosta da mesa do fundo");
  });

  it("aceita os vários nomes que a coluna de aniversário costuma ter", () => {
    for (const cabecalho of ["nascimento", "aniversario", "Data de Nascimento", "NASC", "birthday"]) {
      const r = interpretarLinhas([
        ["telefone", cabecalho],
        ["65999990021", "03/09"],
      ]);
      assert.equal(r.pessoas[0]?.nascimento, "03/09", cabecalho);
    }
  });

  it("coluna que não existe vira vazio, e não some com a pessoa", () => {
    // Planilha de gente real vem com buraco. Recusar a linha porque faltou o
    // e-mail perderia o cliente junto — que é o oposto de importar.
    const r = interpretarLinhas([
      ["nome", "telefone"],
      ["Ana", "65999990022"],
    ]);
    assert.equal(r.pessoas.length, 1);
    assert.equal(r.pessoas[0]!.nascimento, null);
    assert.equal(r.pessoas[0]!.email, null);
    assert.equal(r.pessoas[0]!.observacoes, null);
  });

  it("célula vazia no meio da coluna vira null, não string vazia", () => {
    // `""` gravado por cima de um aniversário que já estava na ficha seria
    // perda de dado. `null` é o que a base entende por "não sei".
    const r = interpretarLinhas([
      ["nome", "telefone", "aniversario"],
      ["Ana", "65999990023", ""],
      ["Bia", "65999990024", "  "],
    ]);
    assert.equal(r.pessoas[0]!.nascimento, null);
    assert.equal(r.pessoas[1]!.nascimento, null);
  });

  it("sem cabeçalho, NÃO chuta qual coluna é o aniversário", () => {
    // O plano B acha o telefone porque telefone tem cara de telefone. Data
    // não tem cara de nada, e chutar gravaria a data errada na ficha de gente
    // de verdade — a casa só descobriria quando o parabéns saísse no dia
    // errado, para o cliente, sem volta.
    const r = interpretarLinhas([
      ["Ana", "65999990025", "25/12/1990"],
      ["Bia", "65999990026", "03/09/1985"],
    ]);
    assert.equal(r.pessoas.length, 2);
    assert.equal(r.pessoas[0]!.nascimento, null);
    assert.equal(r.pessoas[1]!.nascimento, null);
  });

  it("data que o Excel guardou como data, e não como texto", async () => {
    // Excel converte "25/12/1990" em data sozinho. `textoDaCelula` devolve
    // AAAA-MM-DD, que é justamente um dos formatos que `lerNascimento` lê.
    const livro = new ExcelJS.Workbook();
    const aba = livro.addWorksheet("Clientes");
    aba.addRow(["Nome", "Telefone", "Aniversário"]);
    aba.addRow(["Ana", "65999990027", new Date(Date.UTC(1990, 11, 25))]);
    const buffer = Buffer.from(await livro.xlsx.writeBuffer());

    const r = await lerPlanilhaDeClientes(buffer);
    assert.equal(r.pessoas[0]!.nascimento, "1990-12-25");
  });
});
