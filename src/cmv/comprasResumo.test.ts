import { test } from "node:test";
import assert from "node:assert/strict";
import { montarResumoDasCompras, type CompraDoResumo } from "./comprasResumo.js";

const C = (o: Partial<CompraDoResumo>): CompraDoResumo => ({
  status: "recebida",
  data_compra: "2026-11-10",
  created_at: "2026-11-10T12:00:00Z",
  recebida_em: null,
  data_prevista: null,
  valor_total: 0,
  estoque_locais: { nome: "Cozinha" },
  compra_itens: [],
  ...o,
});

const params = { hoje: "2026-11-15", mes: "2026-11" };

test("comprado no mês é só o recebido, pelo valor da nota", () => {
  const r = montarResumoDasCompras(
    [
      C({ recebida_em: "2026-11-10T14:00:00Z", valor_total: 700 }),
      C({ recebida_em: "2026-11-12T09:00:00Z", valor_total: "2310.40", estoque_locais: { nome: "Bar" } }),
      // Pedido que ainda não chegou: conta como compra do mês, não como comprado.
      C({ status: "pedido", compra_itens: [{ quantidade_pedida: 10, custo_unitario_pedido: 5 }] }),
      // Cancelada do mês: entra na contagem de compras, como a tela já fazia.
      C({ status: "cancelada" }),
      // Mês passado: fora.
      C({ data_compra: "2026-10-20", recebida_em: "2026-10-21T10:00:00Z", valor_total: 999 }),
    ],
    params,
  );
  assert.equal(r.compras_no_mes, 4);
  assert.equal(r.recebidas_no_mes, 2);
  assert.equal(r.comprado_no_mes, 3010.4);
});

test("aguardando: o valor é o estimado pelo pedido enquanto a nota não tem valor", () => {
  const r = montarResumoDasCompras(
    [
      C({ status: "pedido", data_prevista: "2026-11-17", compra_itens: [{ quantidade_pedida: 20, custo_unitario_pedido: 62.5 }, { quantidade_pedida: 6, custo_unitario_pedido: "39.90" }] }),
      C({ status: "pedido", data_prevista: "2026-11-13", valor_total: 500, compra_itens: [{ quantidade_pedida: 1, custo_unitario_pedido: 1 }] }),
      C({ status: "pedido", data_prevista: null }),
      C({ status: "rascunho", compra_itens: [{ quantidade_pedida: 99, custo_unitario_pedido: 99 }] }),
    ],
    params,
  );
  assert.equal(r.aguardando, 3);
  assert.equal(r.valor_aguardando, 1250 + 239.4 + 500);
  assert.equal(r.proxima_entrega, "2026-11-17");
  assert.equal(r.atrasadas, 1);
});

test("últimos 30 dias: uma casa por dia, de 29 dias atrás até hoje", () => {
  const r = montarResumoDasCompras(
    [
      C({ recebida_em: "2026-11-15T23:00:00Z", valor_total: 100 }),
      C({ recebida_em: "2026-11-15T08:00:00Z", valor_total: 50.5 }),
      C({ data_compra: "2026-10-17", recebida_em: "2026-10-17T10:00:00Z", valor_total: 30 }),
      // Um dia antes da janela: fora do gráfico.
      C({ data_compra: "2026-10-16", recebida_em: "2026-10-16T10:00:00Z", valor_total: 9999 }),
      // Recebida sem carimbo de recebimento não tem dia para cair.
      C({ recebida_em: null, valor_total: 77 }),
    ],
    params,
  );
  assert.equal(r.ultimos_30_dias.length, 30);
  assert.equal(r.ultimos_30_dias[0]!.dia, "2026-10-17");
  assert.equal(r.ultimos_30_dias[0]!.valor, 30);
  assert.equal(r.ultimos_30_dias[29]!.dia, "2026-11-15");
  assert.equal(r.ultimos_30_dias[29]!.valor, 150.5);
  assert.equal(r.total_30_dias, 180.5);
});

test("por local: só o recebido no mês, do maior para o menor", () => {
  const r = montarResumoDasCompras(
    [
      C({ recebida_em: "2026-11-03T10:00:00Z", valor_total: 300, estoque_locais: { nome: "Bar" } }),
      C({ recebida_em: "2026-11-04T10:00:00Z", valor_total: 700, estoque_locais: { nome: "Cozinha" } }),
      C({ recebida_em: "2026-11-05T10:00:00Z", valor_total: 100, estoque_locais: { nome: "Bar" } }),
      C({ recebida_em: "2026-11-06T10:00:00Z", valor_total: 40, estoque_locais: null }),
      // Recebida em outubro: aparece nos 30 dias, não no "por local" do mês.
      C({ data_compra: "2026-10-28", recebida_em: "2026-10-28T10:00:00Z", valor_total: 5000, estoque_locais: { nome: "Bar" } }),
    ],
    params,
  );
  assert.deepEqual(r.por_local, [
    { nome: "Cozinha", valor: 700 },
    { nome: "Bar", valor: 400 },
    { nome: "Sem local", valor: 40 },
  ]);
});

test("sem compras, tudo zero e o gráfico continua com 30 casas", () => {
  const r = montarResumoDasCompras([], params);
  assert.equal(r.compras_no_mes, 0);
  assert.equal(r.comprado_no_mes, 0);
  assert.equal(r.proxima_entrega, null);
  assert.equal(r.ultimos_30_dias.length, 30);
  assert.deepEqual(r.por_local, []);
});
