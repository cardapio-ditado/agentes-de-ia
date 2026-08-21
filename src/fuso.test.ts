import assert from "node:assert/strict";
import test from "node:test";
import { fimDoEvento, hojeNaCasa, instanteNaCasa } from "./fuso.js";

const CUIABA = "America/Cuiaba";
const SAO_PAULO = "America/Sao_Paulo";

test("20h em Cuiabá vira meia-noite UTC do dia seguinte", () => {
  // O caso que faz o show cair no dia errado do calendário quando se ignora
  // o fuso: a data muda junto com a hora.
  assert.equal(instanteNaCasa("2026-08-22", "20:00", CUIABA), "2026-08-23T00:00:00.000Z");
});

test("meia-noite na casa é 4h UTC do mesmo dia", () => {
  assert.equal(instanteNaCasa("2026-08-22", "00:00", CUIABA), "2026-08-22T04:00:00.000Z");
});

test("o mesmo horário em fusos diferentes dá instantes diferentes", () => {
  const emCuiaba = instanteNaCasa("2026-08-22", "20:00", CUIABA);
  const emSaoPaulo = instanteNaCasa("2026-08-22", "20:00", SAO_PAULO);
  assert.notEqual(emCuiaba, emSaoPaulo);
  // São Paulo está uma hora à frente de Cuiabá, então o mesmo horário de
  // parede acontece uma hora ANTES lá.
  assert.equal(Date.parse(emCuiaba) - Date.parse(emSaoPaulo), 3600_000);
});

test("a volta fecha: o instante relido no fuso dá o horário digitado", () => {
  // A prova real da conversão — vale para qualquer hora do ano.
  for (const data of ["2026-01-15", "2026-06-30", "2026-08-22", "2026-12-31"]) {
    for (const hora of ["00:00", "07:30", "19:00", "23:59"]) {
      const instante = instanteNaCasa(data, hora, CUIABA);
      const lido = new Intl.DateTimeFormat("en-CA", {
        timeZone: CUIABA,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(instante));
      const p = (t: string) => lido.find((x) => x.type === t)?.value;
      assert.equal(`${p("year")}-${p("month")}-${p("day")}`, data, `${data} ${hora}`);
      assert.equal(`${p("hour")}:${p("minute")}`, hora, `${data} ${hora}`);
    }
  }
});

test("data ou hora malformada é recusada em vez de virar lixo", () => {
  // "22/08/2026" no lugar de "2026-08-22" produziria um instante inventado.
  assert.throws(() => instanteNaCasa("22/08/2026", "20:00", CUIABA), /Data inválida/);
  assert.throws(() => instanteNaCasa("2026-08-22", "20h", CUIABA), /Hora inválida/);
});

test("às 22h de Cuiabá ainda é hoje, mesmo já sendo amanhã em UTC", () => {
  // 22h do dia 22 em Cuiabá = 2h do dia 23 em UTC. Ler a data em UTC faria a
  // IA cadastrar a agenda de sábado como se fosse domingo.
  assert.equal(hojeNaCasa(CUIABA, new Date("2026-08-23T02:00:00Z")), "2026-08-22");
});

/* ---------- shows que viram a noite ---------- */

test("show que termina depois da meia-noite fecha no dia seguinte", () => {
  // "20h às 00h" tratado como o mesmo dia daria duração negativa, e o evento
  // sumiria das buscas por período.
  const fim = fimDoEvento("2026-08-19", "20:00", "00:00", CUIABA);
  assert.equal(fim, "2026-08-20T04:00:00.000Z");
  assert.ok(Date.parse(fim) > Date.parse(instanteNaCasa("2026-08-19", "20:00", CUIABA)));
});

test("show da madrugada: 23h às 1h", () => {
  const inicio = instanteNaCasa("2026-08-21", "23:00", CUIABA);
  const fim = fimDoEvento("2026-08-21", "23:00", "01:00", CUIABA);
  assert.equal(Date.parse(fim) - Date.parse(inicio), 2 * 3600_000);
});

test("show que acaba no mesmo dia não é empurrado para o seguinte", () => {
  const fim = fimDoEvento("2026-08-22", "13:00", "16:30", CUIABA);
  assert.equal(fim, instanteNaCasa("2026-08-22", "16:30", CUIABA));
});
