import { test } from "node:test";
import assert from "node:assert/strict";
import { descreverCardapio, descreverItem, promocaoVigente, type ItemDoCardapio } from "./cardapio.js";

const FUSO = "America/Cuiaba";

function promo(extra: Partial<Parameters<typeof promocaoVigente>[0]> = {}) {
  return {
    is_active: true,
    starts_at: "2026-08-01T00:00:00Z",
    ends_at: "2026-12-31T23:59:59Z",
    weekly_days: null,
    ...extra,
  };
}

test("promoção fora do intervalo de datas não vale", () => {
  const antes = new Date("2026-07-20T18:00:00Z");
  const depois = new Date("2027-01-05T18:00:00Z");

  assert.equal(promocaoVigente(promo(), antes, FUSO), false);
  assert.equal(promocaoVigente(promo(), depois, FUSO), false);
});

test("promoção desativada não vale, mesmo dentro do prazo", () => {
  const agora = new Date("2026-08-18T18:00:00Z");
  assert.equal(promocaoVigente(promo({ is_active: false }), agora, FUSO), false);
});

test("sem dias da semana, vale todo dia do intervalo", () => {
  const agora = new Date("2026-08-18T18:00:00Z");
  assert.equal(promocaoVigente(promo(), agora, FUSO), true);
  assert.equal(promocaoVigente(promo({ weekly_days: [] }), agora, FUSO), true);
});

test("promoção de quarta não vale na segunda", () => {
  // 2026-08-18 é uma terça; 19 é quarta.
  const terca = new Date("2026-08-18T18:00:00Z");
  const quarta = new Date("2026-08-19T18:00:00Z");
  const soQuarta = promo({ weekly_days: [3] });

  assert.equal(promocaoVigente(soQuarta, terca, FUSO), false);
  assert.equal(promocaoVigente(soQuarta, quarta, FUSO), true);
});

test("o dia da semana é lido no fuso da casa, não em UTC", () => {
  // 22h de sexta em Cuiabá (UTC-4) já é sábado 02h em UTC. Lendo em UTC, a
  // promoção de sexta sumiria no melhor horário da própria sexta.
  const sextaTarDaNoite = new Date("2026-08-22T02:00:00Z");
  const soSexta = promo({ weekly_days: [5] });

  assert.equal(promocaoVigente(soSexta, sextaTarDaNoite, FUSO), true);
  assert.equal(promocaoVigente(soSexta, sextaTarDaNoite, "UTC"), false);
});

// ---------- Apresentação ----------

function item(extra: Partial<ItemDoCardapio> = {}): ItemDoCardapio {
  return {
    nome: "Isca de tilápia",
    descricao: null,
    servePessoas: null,
    preco: 62,
    categoria: "Porções",
    grupo: "comida",
    promocao: null,
    variacoes: [],
    ...extra,
  };
}

test("item sem promoção mostra só o preço", () => {
  const texto = descreverItem(item());
  assert.match(texto, /Isca de tilápia — R\$ 62\.00/);
  assert.doesNotMatch(texto, /promoção/);
});

test("item em promoção mostra o preço novo E o cheio", () => {
  // Os dois de propósito: o cliente precisa enxergar o desconto, e a casa
  // precisa que ele saiba o preço normal quando a promoção acabar.
  const texto = descreverItem(item({ promocao: { nome: "Terça da Isca", preco: 45 } }));
  assert.match(texto, /R\$ 45\.00/);
  assert.match(texto, /Terça da Isca/);
  assert.match(texto, /de R\$ 62\.00/);
});

test("variações aparecem com o valor do adicional", () => {
  const texto = descreverItem(
    item({
      variacoes: [
        {
          grupo: "Tamanho",
          obrigatorio: true,
          opcoes: [
            { nome: "Meia", adicional: 0 },
            { nome: "Inteira", adicional: 22 },
          ],
        },
      ],
    }),
  );
  assert.match(texto, /Tamanho \(escolha obrigatória\)/);
  assert.match(texto, /Inteira \(\+R\$ 22\.00\)/);
  // Adicional zero não vira "+R$ 0.00", que confunde mais do que informa.
  assert.doesNotMatch(texto, /Meia \(\+/);
});

test("o cardápio sai agrupado por categoria", () => {
  const texto = descreverCardapio([
    item({ nome: "Isca de tilápia", categoria: "Porções" }),
    item({ nome: "Cerveja", categoria: "Bebidas", preco: 12 }),
    item({ nome: "Batata frita", categoria: "Porções", preco: 35 }),
  ]);

  assert.match(texto, /Porções:/);
  assert.match(texto, /Bebidas:/);
  // As duas porções ficam juntas, antes do cabeçalho de Bebidas.
  const bebidas = texto.indexOf("Bebidas:");
  assert.ok(texto.indexOf("Isca de tilápia") < bebidas);
  assert.ok(texto.indexOf("Batata frita") < bebidas);
});

test("cardápio vazio devolve string vazia, para quem chama decidir o que dizer", () => {
  assert.equal(descreverCardapio([]), "");
});

test('"serve X pessoas" entra na descrição — é a pergunta mais feita numa mesa', () => {
  assert.match(descreverItem(item({ servePessoas: 2 })), /serve 2 pessoas/);
  // Singular sem "1 pessoas".
  assert.match(descreverItem(item({ servePessoas: 1 })), /serve 1 pessoa(?!s)/);
  // Sem o dado, nada é dito — melhor calar que chutar o tamanho da porção.
  assert.doesNotMatch(descreverItem(item()), /serve/i);
});
