import { test } from "node:test";
import assert from "node:assert/strict";
import { aVencer, inicioDaSemana, montarFluxo, montarResultado, type CategoriaDoResultado } from "./financeiroFluxo.js";

const contas = [
  { id: "banco", saldo_inicial: 1000, saldo_inicial_em: "2026-10-01" },
  { id: "caixa", saldo_inicial: 200, saldo_inicial_em: "2026-10-01" },
];

test("semana começa na segunda", () => {
  assert.equal(inicioDaSemana("2026-10-26"), "2026-10-26"); // segunda
  assert.equal(inicioDaSemana("2026-11-01"), "2026-10-26"); // domingo
  assert.equal(inicioDaSemana("2026-10-28"), "2026-10-26");
});

test("fluxo: saldo inicial, realizado, previsto e o atrasado caindo hoje", () => {
  const f = montarFluxo({
    contas,
    pagos: [
      { tipo: "receber", conta_id: "banco", pago_em: "2026-10-10", valor_pago: 500, valor: 500 }, // antes do período
      { tipo: "pagar", conta_id: "banco", pago_em: "2026-10-25", valor_pago: 100, valor: 100 },
      { tipo: "pagar", conta_id: "banco", pago_em: "2026-09-20", valor_pago: 999, valor: 999 }, // antes do saldo inicial
    ],
    abertos: [
      { tipo: "pagar", conta_id: null, vencimento: "2026-10-20", valor: 300 }, // atrasado → hoje
      { tipo: "pagar", conta_id: "banco", vencimento: "2026-10-28", valor: 2000 },
      { tipo: "receber", conta_id: "banco", vencimento: "2026-10-30", valor: 1000 },
    ],
    transferencias: [{ de_conta_id: "caixa", para_conta_id: "banco", valor: 150, dia: "2026-10-26" }],
    de: "2026-10-24",
    ate: "2026-10-31",
    hoje: "2026-10-26",
    agrupar: "dia",
  });
  // 1000 + 200 + 500 = 1700 no dia 24.
  assert.equal(f.saldo_inicial, 1700);
  assert.equal(f.atrasado_pagar, 300);
  const dia = (d: string) => f.periodos.find((p) => p.inicio === d)!;
  assert.equal(dia("2026-10-25").saidas, 100);
  assert.equal(dia("2026-10-26").saidas_previstas, 300);
  // Transferência não mexe no total da casa.
  assert.equal(dia("2026-10-26").entradas, 0);
  // 1700 − 100 − 300 − 2000 = −700 no dia 28: é o primeiro negativo.
  assert.deepEqual(f.primeiro_negativo, { dia: "2026-10-28", saldo: -700 });
  assert.deepEqual(f.menor_saldo, { dia: "2026-10-28", saldo: -700 });
  assert.equal(f.saldo_final, 300);
});

test("fluxo de uma conta só: a transferência entra", () => {
  const f = montarFluxo({
    contas,
    pagos: [],
    abertos: [{ tipo: "pagar", conta_id: "caixa", vencimento: "2026-10-27", valor: 50 }],
    transferencias: [{ de_conta_id: "caixa", para_conta_id: "banco", valor: 150, dia: "2026-10-26" }],
    de: "2026-10-26",
    ate: "2026-10-27",
    hoje: "2026-10-26",
    agrupar: "dia",
    contaId: "banco",
  });
  assert.equal(f.saldo_inicial, 1000);
  assert.equal(f.periodos[0]!.entradas, 150);
  // A conta do caixa não entra no fluxo do banco.
  assert.equal(f.periodos[1]!.saidas_previstas, 0);
  assert.equal(f.saldo_final, 1150);
});

test("fluxo agrupado por semana", () => {
  const f = montarFluxo({
    contas,
    pagos: [],
    abertos: [
      { tipo: "pagar", conta_id: "banco", vencimento: "2026-10-27", valor: 100 },
      { tipo: "pagar", conta_id: "banco", vencimento: "2026-11-03", valor: 50 },
    ],
    transferencias: [],
    de: "2026-10-26",
    ate: "2026-11-08",
    hoje: "2026-10-26",
    agrupar: "semana",
  });
  assert.equal(f.periodos.length, 2);
  assert.equal(f.periodos[0]!.saidas_previstas, 100);
  assert.equal(f.periodos[0]!.saldo, 1100);
  assert.equal(f.periodos[1]!.saldo, 1050);
});

const cats: CategoriaDoResultado[] = [
  { id: "vendas", nome: "Vendas", pai_id: null, grupo: "receita", tipo: "receita" },
  { id: "salao", nome: "Salão", pai_id: "vendas", grupo: "receita", tipo: "receita" },
  { id: "merc", nome: "Mercadoria", pai_id: null, grupo: "cmv", tipo: "despesa" },
  { id: "bebidas", nome: "Bebidas", pai_id: "merc", grupo: "cmv", tipo: "despesa" },
  { id: "pessoal", nome: "Pessoal", pai_id: null, grupo: "pessoal", tipo: "despesa" },
  { id: "ocup", nome: "Ocupação", pai_id: null, grupo: "ocupacao", tipo: "despesa" },
  { id: "imp", nome: "Impostos", pai_id: null, grupo: "deducao", tipo: "despesa" },
  { id: "socios", nome: "Retirada", pai_id: null, grupo: "retirada", tipo: "despesa" },
];
const L = (tipo: "pagar" | "receber", categoria_id: string | null, valor: number) => ({ tipo, categoria_id, valor, competencia: "2026-10-01" });

test("resultado do mês, prime cost e ponto de equilíbrio", () => {
  const x = montarResultado(
    [
      L("receber", "salao", 100_000),
      L("pagar", "imp", 6_000),
      L("pagar", "bebidas", 30_000),
      L("pagar", "pessoal", 25_000),
      L("pagar", "ocup", 12_000),
      L("pagar", null, 1_000),
      L("pagar", "socios", 5_000),
    ],
    cats,
  );
  assert.equal(x.receita, 100_000);
  assert.equal(x.receita_liquida, 94_000);
  assert.equal(x.margem_bruta, 64_000);
  assert.equal(x.resultado_operacional, 27_000);
  // − 1.000 sem categoria (outros) − 5.000 de retirada
  assert.equal(x.resultado_final, 21_000);
  assert.equal(x.pct.cmv, 30);
  assert.equal(x.pct.prime_cost, 55);
  assert.deepEqual(x.sem_categoria, { valor: 1000, quantidade: 1 });
  // Fixos 37.000 / margem de contribuição 64% = 57.812,50
  assert.equal(x.margem_de_contribuicao, 64);
  assert.equal(x.ponto_de_equilibrio, 57_812.5);
  assert.equal(x.categorias[0]!.nome, "Vendas");
});

test("sem receita lançada, os percentuais usam as vendas da Zig", () => {
  const x = montarResultado([L("pagar", "bebidas", 3_000), L("pagar", "pessoal", 2_000)], cats, 10_000);
  assert.equal(x.base_dos_percentuais, "vendas");
  assert.equal(x.pct.prime_cost, 50);
  assert.equal(montarResultado([L("pagar", "bebidas", 3_000)], cats).base_dos_percentuais, null);
});

test("a vencer: atrasado, hoje, 7 e 30 dias", () => {
  const v = aVencer(
    [
      { tipo: "pagar", conta_id: null, vencimento: "2026-10-20", valor: 10 },
      { tipo: "pagar", conta_id: null, vencimento: "2026-10-26", valor: 20 },
      { tipo: "pagar", conta_id: null, vencimento: "2026-10-30", valor: 30 },
      { tipo: "pagar", conta_id: null, vencimento: "2026-11-20", valor: 40 },
      { tipo: "receber", conta_id: null, vencimento: "2026-10-27", valor: 5 },
    ],
    "2026-10-26",
  );
  assert.deepEqual(v.pagar, { atrasado: 10, hoje: 20, proximos_7: 30, proximos_30: 70 });
  assert.equal(v.receber.proximos_7, 5);
});
