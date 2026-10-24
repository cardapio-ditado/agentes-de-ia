import assert from "node:assert/strict";
import test from "node:test";
import { chaveDaImportacao, diaOperacional, linhasDaZig } from "./vendasZig.js";

const FUSO = "America/Cuiaba";

test("o dia operacional é o do evento; sem evento, a madrugada pertence à noite anterior", () => {
  // 02:30 de Cuiabá de 07/10 = 06:30 UTC de 07/10
  assert.equal(diaOperacional({ eventDate: "2026-10-06T21:29:17.182", transactionDate: "2026-10-07T06:30:00.000" }, FUSO), "2026-10-06");
  assert.equal(diaOperacional({ transactionDate: "2026-10-07T06:30:00.000" }, FUSO), "2026-10-06");
  // 10:00 de Cuiabá = 14:00 UTC: já é o dia 7
  assert.equal(diaOperacional({ transactionDate: "2026-10-07T14:00:00.000" }, FUSO), "2026-10-07");
  assert.equal(diaOperacional({ transactionDate: "nada" }, FUSO), null);
});

test("as saídas viram linhas por produto, só o que é mercadoria, com o dia certo", () => {
  const evento = "2026-10-06T21:29:17.182";
  const r = linhasDaZig(
    [
      { transactionId: "t1", transactionDate: "2026-10-07T01:00:00", eventDate: evento, productSku: "7J", productName: "Chopp 300ml", unitValue: 1700, count: 2, type: "Normal" },
      { transactionId: "t2", transactionDate: "2026-10-07T02:00:00", eventDate: evento, productSku: "7J", productName: "CHOPP 300ML", unitValue: 1700, count: 1, discountValue: 200, type: "Normal" },
      { transactionId: "t2", transactionDate: "2026-10-07T02:00:00", eventDate: evento, productSku: null, productName: "Porção de fritas", unitValue: 3500, count: 1, type: "Normal" },
      { transactionId: "t3", transactionDate: "2026-10-07T02:10:00", eventDate: evento, productName: "Entrada", unitValue: 2000, count: 3, type: "Entrance" },
      { transactionId: "t3", transactionDate: "2026-10-07T02:10:00", eventDate: evento, productName: "Gorjeta", unitValue: 500, count: 1, type: "Tip" },
      // Outra noite: fica de fora desta importação.
      { transactionId: "t9", transactionDate: "2026-10-08T01:00:00", eventDate: "2026-10-07T21:00:00", productSku: "7J", productName: "Chopp 300ml", unitValue: 1700, count: 5, type: "Normal" },
    ],
    FUSO,
    "2026-10-06",
  );

  assert.deepEqual(r.linhas, [
    { produto: "Chopp 300ml", codigo: "7J", quantidade: 3, valorTotal: 49, data: "2026-10-06" },
    { produto: "Porção de fritas", codigo: null, quantidade: 1, valorTotal: 35, data: "2026-10-06" },
  ]);
  assert.equal(r.faturamento, 84);
  assert.deepEqual(r.foraDoEstoque, { Entrance: 60, Tip: 5 });
  assert.equal(r.transacoes, 2);
});

test("a chave da importação é por casa e por dia, e sempre a mesma", () => {
  assert.equal(chaveDaImportacao("casa", "2026-10-06"), chaveDaImportacao("casa", "2026-10-06"));
  assert.notEqual(chaveDaImportacao("casa", "2026-10-06"), chaveDaImportacao("casa", "2026-10-07"));
  assert.notEqual(chaveDaImportacao("casa", "2026-10-06"), chaveDaImportacao("outra", "2026-10-06"));
  assert.match(chaveDaImportacao("casa", "2026-10-06"), /^[0-9a-f]{64}$/);
});
