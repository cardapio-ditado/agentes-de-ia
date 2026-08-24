import assert from "node:assert/strict";
import test from "node:test";
import {
  aumentosDePreco,
  itensParaAcabar,
  origemDoDia,
  resumirDivergencia,
  textoAumentoDePreco,
  textoDivergencia,
  textoEstoqueBaixo,
} from "./avisos.js";

/* ---------- preço ---------- */

const item = (insumo: string, anterior: number, novo: number) => ({
  insumo,
  unidade: "kg",
  custoAnterior: anterior,
  custoNovo: novo,
});

test("aumento acima do corte entra; flutuação não", () => {
  const aumentos = aumentosDePreco(
    [item("Picanha", 42.9, 50.6), item("Alcatra", 30, 31.2)],
    10,
  );
  assert.equal(aumentos.length, 1);
  assert.equal(aumentos[0]!.insumo, "Picanha");
  assert.equal(aumentos[0]!.pct, 18);
});

test("insumo novo não é aumento", () => {
  // Primeiro preço de um item viraria sempre falso alarme: não existe
  // "aumento" sobre o que nunca foi comprado.
  assert.equal(aumentosDePreco([item("Novidade", 0, 25)], 10).length, 0);
});

test("queda de preço não vira aviso de aumento", () => {
  assert.equal(aumentosDePreco([item("Tilápia", 40, 30)], 10).length, 0);
});

test("os maiores aumentos primeiro", () => {
  const aumentos = aumentosDePreco(
    [item("A", 10, 12), item("B", 10, 15), item("C", 10, 13)],
    10,
  );
  assert.deepEqual(aumentos.map((a) => a.insumo), ["B", "C", "A"]);
});

test("corte inválido cai no padrão de 10% em vez de avisar de tudo", () => {
  for (const corte of [0, -5, Number.NaN]) {
    assert.equal(aumentosDePreco([item("A", 10, 10.5)], corte).length, 0, String(corte));
    assert.equal(aumentosDePreco([item("A", 10, 12)], corte).length, 1, String(corte));
  }
});

test("o texto do aumento traz o de → para e a consequência", () => {
  const texto = textoAumentoDePreco({
    casa: "Ditado Popular",
    fornecedor: "Frigorífico X",
    aumentos: aumentosDePreco([item("Picanha", 42.9, 50.6)], 10),
  });
  assert.match(texto, /^📈 Picanha subiu 18% — Ditado Popular/);
  assert.match(texto, /Frigorífico X/);
  assert.match(texto, /50,60/);
  // Aponta a ação, não só o fato.
  assert.match(texto, /fornecedor|cotar/i);
});

/* ---------- divergência ---------- */

const contado = (insumo: string, contada: number, sistema: number, custo: number) => ({
  insumo,
  unidade: "un",
  contada,
  sistema,
  custoMedio: custo,
});

test("a divergência soma FALTA e SOBRA pelo valor absoluto", () => {
  // Sobra também é estoque mentindo — só que para o outro lado.
  const r = resumirDivergencia([
    contado("Long neck", 90, 100, 6), // faltam 10 → R$ 60
    contado("Água", 55, 50, 3), // sobram 5 → R$ 15
  ]);
  assert.equal(r.totalReais, 75);
});

test("o corte é do total, não do item", () => {
  // Dez itens de R$ 15 são R$ 150 sumidos; item a item, nenhum passaria de
  // um corte de R$ 100. É quem decide que o julgamento é pela soma.
  const itens = Array.from({ length: 10 }, (_, i) => contado(`Item ${i}`, 0, 5, 3));
  assert.equal(resumirDivergencia(itens).totalReais, 150);
});

test("item batido não polui a lista", () => {
  const r = resumirDivergencia([contado("Certo", 10, 10, 5), contado("Errado", 8, 10, 5)]);
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0]!.insumo, "Errado");
});

test("o maior rombo primeiro", () => {
  const r = resumirDivergencia([
    contado("Pequeno", 9, 10, 2),
    contado("Grande", 0, 10, 50),
  ]);
  assert.equal(r.itens[0]!.insumo, "Grande");
});

test("o texto da divergência distingue faltou de sobrou", () => {
  const texto = textoDivergencia({
    casa: "Ditado Popular",
    resumo: resumirDivergencia([
      contado("Long neck", 90, 100, 6),
      contado("Água", 55, 50, 3),
    ]),
  });
  assert.match(texto, /Long neck: faltaram 10 un/);
  assert.match(texto, /Água: sobraram 5 un/);
  // O saldo já foi corrigido — o aviso não pode sugerir que ainda há o que
  // consertar no sistema; o que resta é investigar o motivo.
  assert.match(texto, /já foi corrigido/i);
});

/* ---------- vai faltar ---------- */

const sugestao = (insumo: string, saldo: number, demanda: number, sugerida = 1) => ({
  insumo,
  unidade: "un",
  saldo_atual: saldo,
  demanda_prevista: demanda,
  quantidade_sugerida: sugerida,
});

test("só entra quem tem consumo previsto", () => {
  // Item parado com saldo baixo não "vai faltar" — ninguém consome. Sem este
  // filtro o aviso listaria meia adega de itens sazonais e viraria ruído.
  const itens = itensParaAcabar([
    sugestao("Chopp", 5, 40),
    sugestao("Licor parado", 1, 0, 0),
  ]);
  assert.equal(itens.length, 1);
  assert.equal(itens[0]!.insumo, "Chopp");
});

test("o mais crítico primeiro: menor cobertura do consumo", () => {
  const itens = itensParaAcabar([
    sugestao("Meio cheio", 20, 40), // cobre 50%
    sugestao("Vazio", 2, 40), // cobre 5%
  ]);
  assert.equal(itens[0]!.insumo, "Vazio");
});

test("o texto diz o que tem e o que o consumo pede", () => {
  const texto = textoEstoqueBaixo({
    casa: "Ditado Popular",
    itens: itensParaAcabar([sugestao("Chopp", 5, 40)]),
  });
  assert.match(texto, /Chopp: tem 5 un, o consumo pede 40/);
  assert.match(texto, /Compras/);
});

/* ---------- a trava do dia ---------- */

test("mesma casa e mesmo dia dão o mesmo id — é a trava do banco", () => {
  const a = origemDoDia("11111111-1111-1111-1111-111111111111", "2026-08-25");
  const b = origemDoDia("11111111-1111-1111-1111-111111111111", "2026-08-25");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("dia diferente ou casa diferente dão ids diferentes", () => {
  const base = origemDoDia("11111111-1111-1111-1111-111111111111", "2026-08-25");
  assert.notEqual(base, origemDoDia("11111111-1111-1111-1111-111111111111", "2026-08-26"));
  assert.notEqual(base, origemDoDia("22222222-2222-2222-2222-222222222222", "2026-08-25"));
});
