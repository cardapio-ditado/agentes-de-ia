import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ErroDoFinanceiro,
  conferirParcelas,
  lerValor,
  montarCategoria,
  montarFornecedor,
  numerosDoFornecedor,
  resumoDosLancamentos,
  saldosDasContas,
  situacaoNaTela,
  somarMeses,
  sugerirParcelas,
} from "./financeiro.js";

test("lerValor entende o jeito brasileiro e o do sistema", () => {
  assert.equal(lerValor("1.234,56"), 1234.56);
  assert.equal(lerValor("R$ 89,90"), 89.9);
  assert.equal(lerValor("1234.5"), 1234.5);
  assert.equal(lerValor(10), 10);
  assert.ok(Number.isNaN(lerValor("")));
  assert.ok(Number.isNaN(lerValor("abc")));
});

test("somarMeses segura o fim do mês", () => {
  assert.equal(somarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(somarMeses("2028-01-31", 1), "2028-02-29");
  assert.equal(somarMeses("2026-10-10", 3), "2027-01-10");
  assert.equal(somarMeses("2026-03-31", -1), "2026-02-28");
});

test("parcelas: os centavos que sobram vão na primeira", () => {
  const p = sugerirParcelas({ total: 100, quantidade: 3, primeiro: "2026-11-10", intervalo: "mensal" });
  assert.deepEqual(p.map((x) => x.valor), [33.34, 33.33, 33.33]);
  assert.deepEqual(p.map((x) => x.vencimento), ["2026-11-10", "2026-12-10", "2027-01-10"]);
});

test("parcelas a cada N dias (28/56/84 do fornecedor)", () => {
  const p = sugerirParcelas({ total: 900, quantidade: 3, primeiro: "2026-11-23", intervalo: 28 });
  assert.deepEqual(p.map((x) => x.vencimento), ["2026-11-23", "2026-12-21", "2027-01-18"]);
  assert.deepEqual(p.map((x) => x.valor), [300, 300, 300]);
});

test("conferirParcelas recusa data e valor ruins, e aceita datas livres", () => {
  assert.throws(() => conferirParcelas([]), ErroDoFinanceiro);
  assert.throws(() => conferirParcelas([{ vencimento: "2026-13-01", valor: 10 }]), /data inválida/);
  assert.throws(() => conferirParcelas([{ vencimento: "2026-11-01", valor: 0 }]), /maior que zero/);
  const ok = conferirParcelas([
    { vencimento: "2026-11-05", valor: "1.000,00" },
    { vencimento: "2026-11-19", valor: 250.5 },
  ]);
  assert.deepEqual(ok, [
    { vencimento: "2026-11-05", valor: 1000 },
    { vencimento: "2026-11-19", valor: 250.5 },
  ]);
});

test("saldo: inicial + entradas − saídas ± transferências, a partir do dia do saldo", () => {
  const contas = [
    { id: "itau", saldo_inicial: 1000, saldo_inicial_em: "2026-10-01" },
    { id: "caixa", saldo_inicial: 0, saldo_inicial_em: "2026-10-01" },
  ];
  const pagos = [
    { tipo: "receber" as const, conta_id: "itau", pago_em: "2026-10-05", valor_pago: 500, valor: 500, situacao: "pago" as const },
    { tipo: "pagar" as const, conta_id: "itau", pago_em: "2026-10-06", valor_pago: 210.5, valor: 200, situacao: "pago" as const },
    // Antes do saldo inicial: já está dentro dele.
    { tipo: "pagar" as const, conta_id: "itau", pago_em: "2026-09-30", valor_pago: 999, valor: 999, situacao: "pago" as const },
  ];
  const transf = [{ de_conta_id: "caixa", para_conta_id: "itau", valor: 300, dia: "2026-10-07" }];
  assert.deepEqual(saldosDasContas(contas, pagos, transf), { itau: 1589.5, caixa: -300 });
});

test("estado na tela: atrasado, vence hoje, aberto", () => {
  assert.equal(situacaoNaTela({ situacao: "aberto", vencimento: "2026-10-20" }, "2026-10-26"), "atrasado");
  assert.equal(situacaoNaTela({ situacao: "aberto", vencimento: "2026-10-26" }, "2026-10-26"), "vence_hoje");
  assert.equal(situacaoNaTela({ situacao: "aberto", vencimento: "2026-10-30" }, "2026-10-26"), "aberto");
  assert.equal(situacaoNaTela({ situacao: "pago", vencimento: "2026-10-20" }, "2026-10-26"), "pago");
});

test("resumo da lista", () => {
  const hoje = "2026-10-26";
  const r = resumoDosLancamentos(
    [
      { situacao: "aberto", vencimento: "2026-10-20", valor: 100, valor_pago: null, pago_em: null },
      { situacao: "aberto", vencimento: "2026-10-26", valor: 50, valor_pago: null, pago_em: null },
      { situacao: "aberto", vencimento: "2026-10-30", valor: 30, valor_pago: null, pago_em: null },
      { situacao: "aberto", vencimento: "2026-11-30", valor: 7, valor_pago: null, pago_em: null },
      { situacao: "pago", vencimento: "2026-10-10", valor: 80, valor_pago: 82, pago_em: "2026-10-11" },
    ],
    hoje,
  );
  assert.deepEqual(r, { atrasado: 100, atrasadas: 1, hoje: 50, proximos_7_dias: 30, em_aberto: 187, pago: 82 });
});

test("categoria: receita cai no grupo receita; grupo inválido vira outros", () => {
  assert.equal(montarCategoria({ nome: "Eventos", tipo: "receita" }).grupo, "receita");
  assert.equal(montarCategoria({ nome: "X", tipo: "despesa", grupo: "inventado" }).grupo, "outros");
  assert.throws(() => montarCategoria({ nome: " " }), /nome/);
});

test("fornecedor: limpa CNPJ e telefone", () => {
  const f = montarFornecedor({ nome: "Ambev", cnpj: "07.526.557/0001-00", telefone: "(65) 99999-0000", prazo_dias: "28" });
  assert.equal(f.cnpj, "07526557000100");
  assert.equal(f.telefone, "65999990000");
  assert.equal(f.prazo_dias, 28);
});

test("números do fornecedor", () => {
  const n = numerosDoFornecedor(
    [
      { tipo: "pagar", situacao: "pago", vencimento: "2026-09-10", valor: 1200, valor_pago: 1200, pago_em: "2026-09-10", categoria_id: "beb" },
      { tipo: "pagar", situacao: "aberto", vencimento: "2026-10-20", valor: 600, valor_pago: null, pago_em: null, categoria_id: "beb" },
      { tipo: "pagar", situacao: "aberto", vencimento: "2026-11-05", valor: 400, valor_pago: null, pago_em: null, categoria_id: "ali" },
      { tipo: "pagar", situacao: "pago", vencimento: "2025-01-10", valor: 5000, valor_pago: 5000, pago_em: "2025-01-10", categoria_id: "beb" },
    ],
    "2026-10-26",
  );
  assert.equal(n.pago_12m, 1200);
  assert.equal(n.media_mensal_12m, 100);
  assert.equal(n.em_aberto, 1000);
  assert.equal(n.atrasado, 600);
  assert.equal(n.proximo_vencimento, "2026-11-05");
  assert.equal(n.categorias[0]!.categoria_id, "beb");
});
