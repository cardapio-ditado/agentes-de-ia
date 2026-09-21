import assert from "node:assert/strict";
import test from "node:test";
import {
  TOLERANCIA_MINUTOS,
  balancoDaNoite,
  concluirRodada,
  duracaoDaJanela,
  estadoDa,
  janelaFechou,
  marcarCutucadas,
  proximaRodada,
  rodadaParaConcluir,
  rodadasParaCutucar,
  rodadasPrevistas,
} from "./rodadas.js";

const AGORA = "2026-09-21T23:00:00.000Z";

test("a janela do bar atravessa a meia-noite", () => {
  // 18:00 às 02:00 é uma noite só, não um número negativo.
  assert.equal(duracaoDaJanela("18:00", "02:00"), 480);
  assert.equal(duracaoDaJanela("09:00", "17:00"), 480);
  // Fim igual ao início: o dia inteiro.
  assert.equal(duracaoDaJanela("18:00", "18:00"), 1440);
});

test("as rodadas previstas cabem na janela, e a que não cabe fica de fora", () => {
  // 18:00 até 02:00 a cada 45 min: 18:00, 18:45, … 01:30. A de 02:15 não
  // entra — o bar já fechou.
  const r = rodadasPrevistas("18:00", "02:00", 45);
  assert.equal(r.length, 11);
  assert.equal(r[0]!.prevista, "18:00");
  assert.equal(r[0]!.minuto, 0);
  assert.equal(r[10]!.prevista, "01:30");
  assert.equal(r[10]!.minuto, 450);
  assert.deepEqual(r.map((x) => x.numero), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("intervalo pequeno demais sobe para o mínimo — rotina, não vigia", () => {
  const r = rodadasPrevistas("18:00", "19:00", 1);
  assert.ok(r.length <= 5, `veio ${r.length} rodadas numa hora`);
});

test("o estado de cada rodada segue o relógio", () => {
  const [r] = rodadasPrevistas("18:00", "02:00", 45);
  const as = (minuto: number) => estadoDa({ ...r!, minuto: 90 }, minuto);
  assert.equal(as(0), "futura", "muito antes");
  assert.equal(as(90 - 10), "agora", "chegando");
  assert.equal(as(90), "agora", "na hora");
  assert.equal(as(90 + TOLERANCIA_MINUTOS), "agora", "no limite da tolerância");
  assert.equal(as(90 + TOLERANCIA_MINUTOS + 1), "atrasada", "passou");
  assert.equal(estadoDa({ ...r!, minuto: 90, concluida_em: AGORA }, 999), "feita");
});

test("o preenchimento vale para o horário em que é feito, como no ponto", () => {
  // Quem faz uma rodada às 21:10 fez a das 21:00. A das 20:15 continua
  // pulada: ninguém conferiu o banheiro às 20:15, e fingir que sim é o que
  // a planilha de papel já fazia.
  const rodadas = rodadasPrevistas("18:00", "02:00", 45);
  const min2110 = 3 * 60 + 10;
  assert.equal(rodadaParaConcluir(rodadas, min2110)!.prevista, "21:00");
});

test("feita a do horário, um preenchimento em seguida adianta a próxima", () => {
  let rodadas = rodadasPrevistas("18:00", "02:00", 45);
  const min2105 = 3 * 60 + 5;
  const agora = rodadaParaConcluir(rodadas, min2105)!;
  assert.equal(agora.prevista, "21:00");
  rodadas = concluirRodada(rodadas, agora.numero, { agoraIso: AGORA, agoraMinuto: min2105, executor: "Zilda", respostas: [] });
  assert.equal(rodadaParaConcluir(rodadas, min2105)!.prevista, "21:45", "a próxima, adiantada");
});

test("antes de a janela abrir, o preenchimento conta como a primeira rodada", () => {
  const rodadas = rodadasPrevistas("18:00", "02:00", 45);
  assert.equal(rodadaParaConcluir(rodadas, -30)!.numero, 1);
});

test("com tudo feito, não há rodada para concluir", () => {
  let rodadas = rodadasPrevistas("18:00", "19:00", 30);
  for (const r of rodadas) {
    rodadas = concluirRodada(rodadas, r.numero, { agoraIso: AGORA, agoraMinuto: r.minuto, executor: "Zilda", respostas: [] });
  }
  assert.equal(rodadaParaConcluir(rodadas, 999), null);
  assert.equal(proximaRodada(rodadas), null);
});

test("cutuca a rodada atrasada uma vez, e nunca de novo", () => {
  let rodadas = rodadasPrevistas("18:00", "02:00", 45);
  // 19:05: a das 18:00 e a das 18:45 passaram da tolerância; a das 19:30 não.
  const min1905 = 65;
  const primeiras = rodadasParaCutucar(rodadas, min1905);
  assert.deepEqual(primeiras.map((r) => r.prevista), ["18:00", "18:45"]);

  rodadas = marcarCutucadas(rodadas, primeiras.map((r) => r.numero), AGORA);
  assert.deepEqual(rodadasParaCutucar(rodadas, min1905), [], "já cutucadas: silêncio");
  // Dez minutos depois, só a nova atrasada entra.
  assert.deepEqual(rodadasParaCutucar(rodadas, 19 * 60 + 46 - 18 * 60).map((r) => r.prevista), ["19:30"]);
});

test("rodada feita não é cutucada, mesmo atrasada no relógio", () => {
  let rodadas = rodadasPrevistas("18:00", "02:00", 45);
  rodadas = concluirRodada(rodadas, 1, { agoraIso: AGORA, agoraMinuto: 5, executor: "Zilda", respostas: [] });
  assert.deepEqual(rodadasParaCutucar(rodadas, 65).map((r) => r.prevista), ["18:45"]);
});

test("a noite fecha quando a janela passa, com a tolerância da última", () => {
  const rodadas = rodadasPrevistas("18:00", "02:00", 45);
  const ultima = rodadas[rodadas.length - 1]!.minuto; // 01:30 = 450
  assert.equal(janelaFechou(rodadas, ultima), false, "01:30 em ponto: ainda dá");
  assert.equal(janelaFechou(rodadas, ultima + TOLERANCIA_MINUTOS), false, "01:45: ainda dentro");
  assert.equal(janelaFechou(rodadas, ultima + TOLERANCIA_MINUTOS + 1), true, "01:46: acabou");
});

test("a noite fecha antes da hora se tudo foi feito", () => {
  let rodadas = rodadasPrevistas("18:00", "19:00", 30);
  for (const r of rodadas) {
    rodadas = concluirRodada(rodadas, r.numero, { agoraIso: AGORA, agoraMinuto: r.minuto, executor: "Zilda", respostas: [] });
  }
  assert.equal(janelaFechou(rodadas, 0), true);
});

test("o balanço da noite conta feitas, puladas e feitas com atraso", () => {
  let rodadas = rodadasPrevistas("18:00", "20:00", 30); // 18:00 18:30 19:00 19:30 20:00
  rodadas = concluirRodada(rodadas, 1, { agoraIso: AGORA, agoraMinuto: 2, executor: "Zilda", respostas: [] });
  // A das 18:30 feita às 19:00: 30 min de atraso, além da tolerância.
  rodadas = concluirRodada(rodadas, 2, { agoraIso: AGORA, agoraMinuto: 60, executor: "Zilda", respostas: [] });
  // A das 19:00 ninguém fez. Agora são 19:40: ela está pulada; a das 19:30
  // ainda está na tolerância; a das 20:00 é futura.
  const b = balancoDaNoite(rodadas, 100);
  assert.deepEqual(b, { previstas: 5, feitas: 2, puladas: 1, com_atraso: 1 });
});

test("concluir não mexe na lista antiga", () => {
  const antes = rodadasPrevistas("18:00", "19:00", 30);
  const depois = concluirRodada(antes, 1, { agoraIso: AGORA, agoraMinuto: 0, executor: "Zilda", respostas: [] });
  assert.equal(antes[0]!.concluida_em, null);
  assert.equal(depois[0]!.concluida_em, AGORA);
  assert.equal(depois[0]!.executor_nome, "Zilda");
});
