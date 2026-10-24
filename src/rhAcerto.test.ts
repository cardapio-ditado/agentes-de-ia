import assert from "node:assert/strict";
import test from "node:test";
import { ErroDoRh } from "./rh.js";
import {
  bonusDaMeta,
  bordasDaSemana,
  lerMetas,
  montarAcerto,
  semanaDoDia,
  semanaVizinha,
  type RegraDaCasa,
} from "./rhAcerto.js";
import type { Participante } from "./rhGorjeta.js";

const pessoa = (id: string, nome: string, funcao: string, peso = 1, minutos = 0): Participante => ({
  atendente_id: id,
  nome,
  funcao,
  peso,
  minutos,
});

const REGRA: RegraDaCasa = {
  metodo: "individual",
  percentual_servico: 10,
  percentual_repasse: 100,
  criterio_rateio: "igual",
  percentual_da_casa_para_apoio: 0,
  metas: [],
  meta_sobre: "tudo",
  configurada: true,
};

// ============================================================
// Semana ISO
// ============================================================

test("a semana começa na segunda e pertence ao ano da quinta", () => {
  // 2026-09-11 é uma sexta-feira.
  assert.deepEqual(semanaDoDia("2026-09-11"), { ano: 2026, numero: 37 });
  assert.deepEqual(bordasDaSemana(2026, 37), { inicio: "2026-09-07", fim: "2026-09-13" });

  // O domingo fecha a semana anterior, não abre a seguinte.
  assert.deepEqual(semanaDoDia("2026-09-13"), { ano: 2026, numero: 37 });
  assert.deepEqual(semanaDoDia("2026-09-14"), { ano: 2026, numero: 38 });
});

test("a virada do ano não inventa semana fantasma", () => {
  // 01/01/2027 é uma sexta: ainda é a semana 53 de 2026 pela regra da quinta.
  assert.deepEqual(semanaDoDia("2027-01-01"), { ano: 2026, numero: 53 });
  assert.deepEqual(bordasDaSemana(2026, 53), { inicio: "2026-12-28", fim: "2027-01-03" });
  assert.deepEqual(semanaDoDia("2027-01-04"), { ano: 2027, numero: 1 });

  // E a semana 1 sempre contém o dia 4 de janeiro.
  for (const ano of [2024, 2025, 2026, 2027, 2028]) {
    const { inicio, fim } = bordasDaSemana(ano, 1);
    assert.ok(inicio <= `${ano}-01-04` && `${ano}-01-04` <= fim, `semana 1 de ${ano} não cobre 4 de janeiro`);
  }
});

test("andar de semana atravessa o ano sozinho", () => {
  assert.deepEqual(semanaVizinha(2026, 53, 1), { ano: 2027, numero: 1 });
  assert.deepEqual(semanaVizinha(2027, 1, -1), { ano: 2026, numero: 53 });
  assert.deepEqual(semanaVizinha(2026, 37, 1), { ano: 2026, numero: 38 });
});

test("semana que não existe não vira conta", () => {
  assert.throws(() => bordasDaSemana(2026, 0), ErroDoRh);
  assert.throws(() => bordasDaSemana(2026, 54), ErroDoRh);
  assert.throws(() => semanaDoDia("11/09/2026"), ErroDoRh);
});

// ============================================================
// Método individual
// ============================================================

test("comissão individual é o percentual sobre a venda de cada um", () => {
  const r = montarAcerto({
    regra: REGRA,
    pessoas: [pessoa("a", "JB", "Garçom"), pessoa("b", "Cida", "Garçom")],
    vendas: new Map([
      ["a", { valor: 20000, comandas: 120 }],
      ["b", { valor: 10000, comandas: 70 }],
    ]),
    cotas: new Map(),
    extras: [],
  });

  const jb = r.linhas.find((l) => l.nome === "JB")!;
  const cida = r.linhas.find((l) => l.nome === "Cida")!;
  assert.equal(jb.comissao, 2000, "10% de 20 mil");
  assert.equal(cida.comissao, 1000, "10% de 10 mil");
  assert.equal(r.totais.arrecadado, 3000);
  assert.equal(r.totais.repassado, 3000);
  assert.equal(r.totais.retido, 0);
  assert.equal(r.totais.a_receber, 3000);
});

test("o que a casa retém aparece, e sai do bolso de todo mundo por igual", () => {
  const r = montarAcerto({
    regra: { ...REGRA, percentual_repasse: 90 },
    pessoas: [pessoa("a", "JB", "Garçom"), pessoa("b", "Cida", "Garçom")],
    vendas: new Map([
      ["a", { valor: 20000, comandas: 0 }],
      ["b", { valor: 10000, comandas: 0 }],
    ]),
    cotas: new Map(),
    extras: [],
  });

  assert.equal(r.totais.arrecadado, 3000);
  assert.equal(r.totais.repassado, 2700);
  assert.equal(r.totais.retido, 300, "a casa fica com 10% do serviço");
  assert.equal(r.linhas.find((l) => l.nome === "JB")!.comissao, 1800);
  assert.equal(r.linhas.find((l) => l.nome === "Cida")!.comissao, 900);
});

test("quem não vende só recebe se a casa separar uma fatia para o apoio", () => {
  const equipe = [pessoa("a", "JB", "Garçom"), pessoa("b", "Rose", "Copa"), pessoa("c", "Val", "Cozinha")];
  const vendas = new Map([["a", { valor: 10000, comandas: 0 }]]);

  const semApoio = montarAcerto({ regra: REGRA, pessoas: equipe, vendas, cotas: new Map(), extras: [] });
  assert.equal(semApoio.linhas.find((l) => l.nome === "JB")!.comissao, 1000);
  assert.equal(semApoio.linhas.find((l) => l.nome === "Rose")!.a_receber, 0);

  const comApoio = montarAcerto({
    regra: { ...REGRA, percentual_da_casa_para_apoio: 20 },
    pessoas: equipe,
    vendas,
    cotas: new Map(),
    extras: [],
  });
  // 1000 arrecadados: 200 vão para o apoio, 800 ficam com quem vendeu.
  assert.equal(comApoio.linhas.find((l) => l.nome === "JB")!.comissao, 800);
  assert.equal(comApoio.linhas.find((l) => l.nome === "Rose")!.rateio, 100);
  assert.equal(comApoio.linhas.find((l) => l.nome === "Val")!.rateio, 100);
  assert.equal(comApoio.totais.a_receber, 1000, "nada se perde no caminho");
});

test("a fatia do apoio respeita a pontuação da casa", () => {
  const r = montarAcerto({
    regra: { ...REGRA, percentual_da_casa_para_apoio: 30, criterio_rateio: "peso" },
    pessoas: [
      pessoa("a", "JB", "Garçom"),
      pessoa("b", "Rose", "Copa", 1),
      pessoa("c", "Val", "Cozinha", 3),
    ],
    vendas: new Map([["a", { valor: 10000, comandas: 0 }]]),
    cotas: new Map(),
    extras: [],
  });

  // 300 para o apoio, repartidos 1 para 3.
  assert.equal(r.linhas.find((l) => l.nome === "Rose")!.rateio, 75);
  assert.equal(r.linhas.find((l) => l.nome === "Val")!.rateio, 225);
  assert.equal(r.linhas.find((l) => l.nome === "JB")!.comissao, 700);
});

// ============================================================
// Método global
// ============================================================

test("no método global ninguém recebe comissão: o que vale é o rateio lançado", () => {
  const r = montarAcerto({
    regra: { ...REGRA, metodo: "global", criterio_rateio: "igual" },
    pessoas: [pessoa("a", "JB", "Garçom"), pessoa("b", "Rose", "Copa")],
    vendas: new Map([["a", { valor: 10000, comandas: 0 }]]),
    cotas: new Map([
      ["a", 450],
      ["b", 450],
    ]),
    extras: [],
  });

  assert.equal(r.linhas.find((l) => l.nome === "JB")!.comissao, 0, "venda não vira comissão no global");
  assert.equal(r.linhas.find((l) => l.nome === "JB")!.rateio, 450);
  assert.equal(r.linhas.find((l) => l.nome === "Rose")!.rateio, 450);
  assert.equal(r.totais.a_receber, 900);
  // A venda continua aparecendo: é informação de desempenho, não de pagamento.
  assert.equal(r.linhas.find((l) => l.nome === "JB")!.vendas, 10000);
});

test("cota de turno também entra na casa que paga por comissão", () => {
  // Um evento fechado rateado à parte, numa casa individual: o dinheiro já
  // saiu e tem de aparecer no acerto.
  const r = montarAcerto({
    regra: REGRA,
    pessoas: [pessoa("a", "JB", "Garçom")],
    vendas: new Map([["a", { valor: 10000, comandas: 0 }]]),
    cotas: new Map([["a", 300]]),
    extras: [],
  });
  assert.equal(r.linhas[0]!.comissao, 1000);
  assert.equal(r.linhas[0]!.rateio, 300);
  assert.equal(r.linhas[0]!.a_receber, 1300);
});

// ============================================================
// Adicionais, descontos e centavos
// ============================================================

test("adicional soma e consumo desconta, sem deixar ninguém negativo", () => {
  const r = montarAcerto({
    regra: REGRA,
    pessoas: [pessoa("a", "JB", "Garçom"), pessoa("b", "Rose", "Copa")],
    vendas: new Map([["a", { valor: 1000, comandas: 0 }]]),
    cotas: new Map(),
    extras: [
      { atendente_id: "a", tipo: "adicional", valor: 50 },
      { atendente_id: "a", tipo: "desconto", valor: 30 },
      { atendente_id: "b", tipo: "desconto", valor: 40 },
    ],
  });

  const jb = r.linhas.find((l) => l.nome === "JB")!;
  assert.equal(jb.comissao, 100);
  assert.equal(jb.adicionais, 50);
  assert.equal(jb.descontos, 30);
  assert.equal(jb.a_receber, 120);

  const rose = r.linhas.find((l) => l.nome === "Rose")!;
  assert.equal(rose.a_receber, 0, "consumo sem gorjeta não vira dívida na tela da gorjeta");
  assert.equal(rose.descontos, 40, "mas o consumo continua registrado");
});

test("a divisão fecha no centavo mesmo quando não é exata", () => {
  const r = montarAcerto({
    regra: { ...REGRA, percentual_da_casa_para_apoio: 100, criterio_rateio: "igual" },
    pessoas: [
      pessoa("v", "Vendedor", "Garçom"),
      pessoa("a", "Ana", "Copa"),
      pessoa("b", "Bia", "Copa"),
      pessoa("c", "Cau", "Copa"),
    ],
    vendas: new Map([["v", { valor: 100.03, comandas: 0 }]]),
    cotas: new Map(),
    extras: [],
  });

  // 10% de 100,03 = 10,00 (arredondado), dividido por 3 = 3,33 + 3,33 + 3,34.
  const apoio = r.linhas.filter((l) => l.funcao === "Copa").map((l) => l.rateio).sort();
  assert.equal(apoio.reduce((s, v) => s + v, 0).toFixed(2), r.totais.repassado.toFixed(2));
  assert.equal(r.totais.a_receber, r.totais.repassado, "a soma das linhas é o repassado, sem centavo sumindo");
});

test("semana sem venda nenhuma não quebra nem paga ninguém", () => {
  const r = montarAcerto({
    regra: REGRA,
    pessoas: [pessoa("a", "JB", "Garçom")],
    vendas: new Map(),
    cotas: new Map(),
    extras: [],
  });
  assert.equal(r.totais.arrecadado, 0);
  assert.equal(r.totais.a_receber, 0);
  assert.equal(r.linhas[0]!.comissao, 0);
});

test("a lista sai por quem recebe mais, com desempate pelo nome", () => {
  const r = montarAcerto({
    regra: REGRA,
    pessoas: [pessoa("a", "Zeca", "Garçom"), pessoa("b", "Ana", "Garçom"), pessoa("c", "Bia", "Garçom")],
    vendas: new Map([
      ["a", { valor: 1000, comandas: 0 }],
      ["b", { valor: 5000, comandas: 0 }],
      ["c", { valor: 1000, comandas: 0 }],
    ]),
    cotas: new Map(),
    extras: [],
  });
  assert.deepEqual(r.linhas.map((l) => l.nome), ["Ana", "Bia", "Zeca"]);
});

// ============================================================
// Metas semanais
// ============================================================

const METAS = [
  { a_partir_de: 10000, bonus: 1 },
  { a_partir_de: 15000, bonus: 2 },
];

test("meta: vale a maior faixa atingida, sobre a venda inteira da semana", () => {
  assert.deepEqual(bonusDaMeta(9999.99, METAS, "tudo").bonus, 0);
  assert.equal(bonusDaMeta(12000, METAS, "tudo").bonus, 120);
  // Passou das duas: leva só os 2%, não 1% + 2%.
  assert.equal(bonusDaMeta(16000, METAS, "tudo").bonus, 320);
  assert.equal(bonusDaMeta(16000, METAS, "tudo").faixa?.bonus, 2);
});

test("meta: no modo excedente, o bônus é só sobre o que passou da faixa", () => {
  assert.equal(bonusDaMeta(12000, METAS, "excedente").bonus, 20);
});

test("meta: diz quanto falta para a próxima faixa", () => {
  const r = bonusDaMeta(12345.6, METAS, "tudo");
  assert.deepEqual(r.proxima, { a_partir_de: 15000, bonus: 2, falta: 2654.4 });
  assert.equal(bonusDaMeta(20000, METAS, "tudo").proxima, null);
});

test("meta: entra no a receber, separada da comissão", () => {
  const r = montarAcerto({
    regra: { ...REGRA, metas: METAS },
    pessoas: [pessoa("a", "Ana", "Garçom"), pessoa("b", "Beto", "Garçom")],
    vendas: new Map([
      ["a", { valor: 12000, comandas: 40 }],
      ["b", { valor: 8000, comandas: 30 }],
    ]),
    cotas: new Map(),
    extras: [],
  });
  const ana = r.linhas.find((l) => l.atendente_id === "a")!;
  const beto = r.linhas.find((l) => l.atendente_id === "b")!;
  assert.equal(ana.comissao, 1200);
  assert.equal(ana.bonus_meta, 120);
  assert.equal(ana.a_receber, 1320);
  assert.equal(beto.bonus_meta, 0);
  assert.equal(beto.meta_proxima?.falta, 2000);
  assert.equal(r.totais.bonus_meta, 120);
  // O bônus não sai do serviço: o que a casa retém continua igual.
  assert.equal(r.totais.retido, 0);
});

test("meta: faixa torta é recusada, e a lista sai em ordem", () => {
  assert.deepEqual(lerMetas([{ a_partir_de: 15000, bonus: 2 }, { a_partir_de: 10000, bonus: 1 }]).map((f) => f.a_partir_de), [10000, 15000]);
  assert.throws(() => lerMetas([{ a_partir_de: 0, bonus: 1 }]), ErroDoRh);
  assert.throws(() => lerMetas([{ a_partir_de: 100, bonus: 0 }]), ErroDoRh);
  assert.throws(() => lerMetas([{ a_partir_de: 100, bonus: 1 }, { a_partir_de: 100, bonus: 2 }]), ErroDoRh);
});
