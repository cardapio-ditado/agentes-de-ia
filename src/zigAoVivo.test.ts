import assert from "node:assert/strict";
import test from "node:test";
import { eventoAberto, horaDaZig, montarRetrato, MAXIMO_DE_BONECOS } from "./zigAoVivo.js";

const AGORA = new Date("2026-10-07T03:31:00Z");
const EVENTO = { id: "ev1", name: "ditado", beginAt: "2026-10-06T21:29:17.182", peopleCapacity: 500 };

test("a hora da Zig é UTC sem o Z", () => {
  assert.equal(horaDaZig("2026-10-07T03:30:19.631")?.toISOString(), "2026-10-07T03:30:19.631Z");
  assert.equal(horaDaZig("2026-10-07T03:30:19Z")?.toISOString(), "2026-10-07T03:30:19.000Z");
  assert.equal(horaDaZig(""), null);
  assert.equal(horaDaZig("ontem"), null);
});

test("o evento aberto é o mais novo que começou nas últimas 20 horas", () => {
  const velho = { id: "v", beginAt: "2026-10-05T20:53:08.369" };
  assert.equal(eventoAberto([velho, EVENTO], AGORA)?.id, "ev1");
  assert.equal(eventoAberto([velho], AGORA), null);
  assert.equal(eventoAberto([{ id: "f", beginAt: "2026-10-07T10:00:00" }], AGORA), null);
});

test("sem evento aberto, a casa está fechada: retrato vazio e sem bonecos", () => {
  const r = montarRetrato({ eventos: [], saidas: [], checkins: [], compradores: [], agora: AGORA });
  assert.equal(r.evento, null);
  assert.equal(r.pessoas_na_casa, 0);
  assert.deepEqual(r.clientes, []);
});

test("quem está na casa: entrou, não saiu e deu sinal de vida; consumindo se comprou há pouco", () => {
  const r = montarRetrato({
    eventos: [EVENTO],
    saidas: [
      { transactionId: "t1", transactionDate: "2026-10-07T03:20:00", unitValue: 1700, count: 2, employeeName: "Joel" },
      { transactionId: "t2", transactionDate: "2026-10-07T01:00:00", unitValue: 5000, count: 1, discountValue: 500, employeeName: "Adilson" },
      { transactionId: "t3", transactionDate: "2026-10-07T03:29:00", unitValue: 1000, count: 1, employeeName: "" },
      // Antes do evento começar: não é desta noite.
      { transactionId: "t0", transactionDate: "2026-10-06T12:00:00", unitValue: 99999, count: 1, employeeName: "Joel" },
    ],
    checkins: [
      { id: "c1", checkinTime: "2026-10-06T23:00:00", phone: "65999990001", name: "Ana", lastTransactionTime: "2026-10-07T03:20:00" },
      { id: "c2", checkinTime: "2026-10-06T23:30:00", phone: "65999990002", name: "Bruno", lastTransactionTime: "2026-10-07T01:00:00" },
      { id: "c3", checkinTime: "2026-10-06T22:00:00", phone: "65999990003", name: "Carla", checkoutTime: "2026-10-07T01:30:00" },
      { id: "c4", checkinTime: "2026-10-07T03:00:00", phone: "65999990004", name: "Duda" },
      // Mesma pessoa que c1, check-in mais velho: conta uma vez.
      { id: "c5", checkinTime: "2026-10-06T22:30:00", phone: "+55 65 99999-0001", name: "Ana" },
    ],
    compradores: [
      { transactionId: "t1", date: "2026-10-07T03:20:00", userPhone: "5565999990001", userName: "Ana Souza", productsValue: 3400 },
      { transactionId: "t2", date: "2026-10-07T01:00:00", userPhone: "65999990002", productsValue: 4500 },
    ],
    agora: AGORA,
  });

  assert.equal(r.evento?.nome, "ditado");
  assert.equal(r.checkins_hoje, 4);
  assert.equal(r.sairam, 1);
  // Bruno comprou às 01:00 e entrou às 23:30 — sem sinal de vida há mais de 90 min: foi embora.
  assert.deepEqual(r.clientes.map((c) => c.nome), ["Ana", "Duda"]);
  assert.equal(r.pessoas_na_casa, 2);
  assert.equal(r.consumindo_agora, 1);
  assert.equal(r.clientes[0]?.gasto_centavos, 3400);
  assert.equal(r.clientes[0]?.consumindo, true);
  assert.equal(r.clientes[1]?.gasto_centavos, 0);

  assert.equal(r.vendas_hoje_centavos, 3400 + 4500 + 1000);
  assert.equal(r.transacoes_hoje, 3);
  assert.equal(r.vendas_15min_centavos, 3400 + 1000);
  assert.equal(r.pessoas_que_compraram, 2);
  assert.equal(r.ticket_medio_centavos, Math.round(8900 / 2));
  assert.deepEqual(r.garcons, [
    { nome: "Adilson", vendas_centavos: 4500, itens: 1 },
    { nome: "Joel", vendas_centavos: 3400, itens: 2 },
  ]);
});

test("a planta desenha no máximo tantos bonecos; o resto vira contagem", () => {
  const checkins = Array.from({ length: MAXIMO_DE_BONECOS + 7 }, (_, i) => ({
    id: `c${i}`,
    checkinTime: "2026-10-07T03:00:00",
    phone: `659999${String(i).padStart(5, "0")}`,
  }));
  const r = montarRetrato({ eventos: [EVENTO], saidas: [], checkins, compradores: [], agora: AGORA });
  assert.equal(r.pessoas_na_casa, MAXIMO_DE_BONECOS + 7);
  assert.equal(r.clientes.length, MAXIMO_DE_BONECOS);
  assert.equal(r.clientes_a_mais, 7);
});
