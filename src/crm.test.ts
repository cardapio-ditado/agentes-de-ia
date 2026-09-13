import assert from "node:assert/strict";
import test from "node:test";
import {
  DIAS_PARA_SUMIR,
  diasEntre,
  faltaHaQuantoTempo,
  resumoDaBase,
  retratoDe,
  seloDe,
} from "./crm.js";

const HOJE = "2026-09-13";

test("o ticket médio separa quem gasta de quem frequenta", () => {
  // Os dois gastaram R$ 2.000. Não são a mesma pessoa, e a lista tem de
  // mostrar isso sem ninguém fazer a conta de cabeça.
  const freguês = retratoDe({ visitas: 40, gasto_total_centavos: 200_000, ultima_visita: HOJE }, HOJE);
  const mesaDosFundos = retratoDe({ visitas: 3, gasto_total_centavos: 200_000, ultima_visita: HOJE }, HOJE);

  assert.equal(freguês.ticket_centavos, 5_000);
  assert.equal(mesaDosFundos.ticket_centavos, 66_667);
  assert.equal(freguês.selo, "fiel");
  assert.equal(mesaDosFundos.selo, "vip");
});

test("cliente sem visita não vira R$ Infinity", () => {
  // Cadastro à mão: existe na base e nunca passou pela porta.
  const r = retratoDe({ visitas: 0, gasto_total_centavos: 0, ultima_visita: null }, HOJE);
  assert.equal(r.ticket_centavos, null);
  assert.equal(r.dias_sem_vir, null);
  assert.equal(r.selo, "novo");
});

test("o VIP que sumiu aparece como sumido, não como VIP", () => {
  // É a regra que mais importa da tela: um VIP que não vem há três meses
  // continua VIP — e é justamente por isso que ele é o mais urgente. Se
  // ficar marcado "vip" no meio dos outros vips, ninguém liga para ele.
  const r = retratoDe(
    { visitas: 12, gasto_total_centavos: 600_000, ultima_visita: "2026-06-01" },
    HOJE,
  );
  assert.ok(r.dias_sem_vir! > DIAS_PARA_SUMIR);
  assert.equal(r.selo, "sumido");
});

test("quem veio uma vez só não conta como sumido", () => {
  // Sumir é ter parado de vir. Quem veio uma vez em janeiro nunca teve
  // hábito para perder — é um novo que não voltou, e a conversa é outra.
  assert.equal(seloDe({ visitas: 1, ticket_centavos: 8_000, dias_sem_vir: 200 }), "novo");
});

test("os dias contam do calendário, sem depender de hora", () => {
  assert.equal(diasEntre("2026-09-12", "2026-09-13"), 1);
  assert.equal(diasEntre("2026-09-13", "2026-09-13"), 0);
  assert.equal(diasEntre("2025-09-13", "2026-09-13"), 365);
  // Data no futuro (fuso torto, digitação) não vira número negativo na tela.
  assert.equal(diasEntre("2026-09-20", "2026-09-13"), 0);
});

test("o tempo sem vir é dito como gente fala", () => {
  assert.equal(faltaHaQuantoTempo(null), "nunca veio");
  assert.equal(faltaHaQuantoTempo(0), "veio hoje");
  assert.equal(faltaHaQuantoTempo(1), "veio ontem");
  assert.equal(faltaHaQuantoTempo(12), "há 12 dias");
  assert.equal(faltaHaQuantoTempo(45), "há 1 mês");
  assert.equal(faltaHaQuantoTempo(200), "há 6 meses");
  assert.equal(faltaHaQuantoTempo(400), "há 1 ano");
});

test("o ticket da casa é gasto ÷ visitas, e não a média das médias", () => {
  // A média das médias daria peso igual a quem veio uma vez e a quem veio
  // quarenta, e o número do topo da tela mentiria.
  const resumo = resumoDaBase([
    retratoDe({ visitas: 1, gasto_total_centavos: 100_000, ultima_visita: HOJE }, HOJE),
    retratoDe({ visitas: 99, gasto_total_centavos: 99_000, ultima_visita: HOJE }, HOJE),
  ]);

  assert.equal(resumo.gasto_total_centavos, 199_000);
  assert.equal(resumo.ticket_medio_centavos, 1_990, "199.000 ÷ 100 visitas");
  // A média das médias daria (100.000 + 1.000) ÷ 2 = 50.500. Longe.
  assert.notEqual(resumo.ticket_medio_centavos, 50_500);
});

test("o resumo conta a base por selo", () => {
  const resumo = resumoDaBase([
    retratoDe({ visitas: 12, gasto_total_centavos: 600_000, ultima_visita: "2026-06-01" }, HOJE),
    retratoDe({ visitas: 3, gasto_total_centavos: 200_000, ultima_visita: HOJE }, HOJE),
    retratoDe({ visitas: 1, gasto_total_centavos: 4_000, ultima_visita: HOJE }, HOJE),
  ]);
  assert.equal(resumo.total, 3);
  assert.deepEqual(resumo.por_selo, { vip: 1, fiel: 0, sumido: 1, novo: 1, comum: 0 });
});
