import assert from "node:assert/strict";
import test from "node:test";
import { classificarCardapio, type PratoVendido } from "./engenharia.js";

const prato = (
  nome: string,
  vendidos: number,
  custo: number,
  preco: number,
  faturamento: number | null = null,
): PratoVendido => ({
  nome,
  vendidos,
  faturamento,
  custoUnitario: custo,
  precoDeTabela: preco,
});

/**
 * Um cardápio de bar reconhecível:
 *  - Isca de tilápia: vende muito, margem alta   → estrela
 *  - Picanha na chapa: vende muito, margem baixa → burro de carga
 *  - Risoto: vende pouco, margem alta            → enigma
 *  - Salada: vende pouco, margem baixa           → peso morto
 */
const CARDAPIO = [
  prato("Isca de tilápia", 100, 12, 45),
  prato("Picanha na chapa", 90, 52, 60),
  prato("Risoto", 12, 14, 52),
  prato("Salada", 8, 15, 22),
];

function quadranteDe(nome: string) {
  return classificarCardapio(CARDAPIO).pratos.find((p) => p.nome === nome)?.quadrante;
}

test("os quatro quadrantes clássicos saem certos", () => {
  assert.equal(quadranteDe("Isca de tilápia"), "estrela");
  assert.equal(quadranteDe("Picanha na chapa"), "burro_de_carga");
  assert.equal(quadranteDe("Risoto"), "enigma");
  assert.equal(quadranteDe("Salada"), "peso_morto");
});

test("o burro de carga vem primeiro na lista — é o problema que parece sucesso", () => {
  const { pratos } = classificarCardapio(CARDAPIO);
  assert.equal(pratos[0]!.quadrante, "burro_de_carga");
});

test("o preço REAL do relatório vence o preço de tabela", () => {
  // O PDV está cobrando 30 num prato cuja ficha diz 45: promoção que ninguém
  // atualizou. A margem verdadeira é a do preço cobrado.
  const { pratos } = classificarCardapio([
    prato("Em promoção", 50, 20, 45, 50 * 30),
    prato("Normal", 50, 20, 45),
  ]);
  const promo = pratos.find((p) => p.nome === "Em promoção")!;
  assert.equal(Math.round(promo.precoMedio), 30);
  assert.equal(promo.margemUnitaria, 10);
});

test("item sem preço nenhum não é classificado — é listado como pendência", () => {
  // Classificar com preço zero daria margem negativa do tamanho do custo, e o
  // prato apareceria como o pior do cardápio por falta de cadastro.
  const r = classificarCardapio([prato("Sem preço", 30, 10, 0), ...CARDAPIO]);
  assert.equal(r.pratos.find((p) => p.nome === "Sem preço"), undefined);
  assert.deepEqual(r.semPreco, [{ nome: "Sem preço", vendidos: 30 }]);
});

test("o corte de popularidade é 70% da fatia justa, não a média", () => {
  // Com a média como corte, metade do cardápio seria sempre "impopular" por
  // definição. O 0,7 é o que faz o método do mercado funcionar.
  const r = classificarCardapio(CARDAPIO);
  const fatiaJusta = (100 + 90 + 12 + 8) / 4;
  assert.equal(r.corteDePopularidade, 0.7 * fatiaJusta);
});

test("a margem média é ponderada pelo volume", () => {
  // Sem ponderar, um prato que vende 3 unidades com margem alta puxaria o
  // corte para cima e rebaixaria os campeões de venda injustamente.
  const r = classificarCardapio([
    prato("Campeão", 100, 10, 20), // margem 10, vende 100
    prato("Raro", 2, 10, 60), // margem 50, vende 2
  ]);
  // (10*100 + 50*2) / 102 ≈ 10,78 — perto do campeão, não do raro.
  assert.ok(Math.abs(r.margemMediaPonderada - 1100 / 102) < 0.01);
});

test("margem total do período acompanha cada prato", () => {
  const { pratos } = classificarCardapio(CARDAPIO);
  const tilapia = pratos.find((p) => p.nome === "Isca de tilápia")!;
  assert.equal(tilapia.margemTotal, (45 - 12) * 100);
});

test("cardápio vazio não explode", () => {
  const r = classificarCardapio([]);
  assert.deepEqual(r.pratos, []);
  assert.deepEqual(r.semPreco, []);
});

test("item com zero vendas fica de fora em silêncio", () => {
  const r = classificarCardapio([prato("Nunca vendeu", 0, 10, 30), ...CARDAPIO]);
  assert.equal(r.pratos.find((p) => p.nome === "Nunca vendeu"), undefined);
});
