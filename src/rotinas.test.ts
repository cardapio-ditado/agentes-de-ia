import assert from "node:assert/strict";
import test from "node:test";
import { cicloValido, idadesDasBatidas, janelaDe, segredoDoCronConfere } from "./rotinas.js";

test("a janela arredonda o instante para baixo, no passo pedido", () => {
  assert.equal(janelaDe(new Date("2026-09-21T15:07:42Z"), 1), "2026-09-21T15:07");

  // A de 50 min não alinha com a hora cheia — alinha com a época do Unix —,
  // e não precisa: o que importa é que fique para trás do instante e a
  // menos de 50 min dele.
  const instante = new Date("2026-09-21T15:07:42Z");
  const inicio = new Date(`${janelaDe(instante, 50)}:00Z`);
  assert.ok(inicio.getTime() <= instante.getTime());
  assert.ok(instante.getTime() - inicio.getTime() < 50 * 60_000);
  assert.equal(inicio.getUTCSeconds(), 0);
});

test("dois processos que acordam com segundos de diferença caem na mesma janela", () => {
  // É o caso real: os quatro processos foram ligados no mesmo instante e
  // acordam juntos, com um ou dois segundos de deriva.
  const a = janelaDe(new Date("2026-09-21T15:00:00Z"), 50);
  const b = janelaDe(new Date("2026-09-21T15:00:03Z"), 50);
  assert.equal(a, b);
});

test("a janela vizinha é outra chave — a rotina roda de novo na próxima hora", () => {
  const agora = janelaDe(new Date("2026-09-21T15:00:00Z"), 50);
  const depois = janelaDe(new Date("2026-09-21T16:00:00Z"), 50);
  assert.notEqual(agora, depois);
});

test("as batidas viram idades em segundos, por ciclo", () => {
  const agora = new Date("2026-11-14T12:00:00Z");
  const idades = idadesDasBatidas(
    [
      { rotina: "batida:minuto", janela: "ok", reivindicada_em: "2026-11-14T11:59:30Z" },
      { rotina: "batida:minuto", janela: "falha", reivindicada_em: "2026-11-14T11:00:00Z" },
      { rotina: "batida:hora", janela: "ok", reivindicada_em: "2026-11-14T11:30:00+00:00" },
    ],
    agora,
  );
  assert.deepEqual(idades.minuto, { ok_ha_segundos: 30, falha_ha_segundos: 3600 });
  assert.deepEqual(idades.hora, { ok_ha_segundos: 1800, falha_ha_segundos: null });
});

test("sem batida, a idade é null — e o monitor trata null como alarme", () => {
  const idades = idadesDasBatidas([], new Date("2026-11-14T12:00:00Z"));
  assert.deepEqual(idades.minuto, { ok_ha_segundos: null, falha_ha_segundos: null });
  assert.deepEqual(idades.hora, { ok_ha_segundos: null, falha_ha_segundos: null });
});

test("as linhas da trava e as datas quebradas não se passam por batida", () => {
  const agora = new Date("2026-11-14T12:00:00Z");
  const idades = idadesDasBatidas(
    [
      // A trava de verdade mora na mesma tabela, com outra chave.
      { rotina: "minuto", janela: "2026-11-14T11:59", reivindicada_em: "2026-11-14T11:59:00Z" },
      { rotina: "batida:semana", janela: "ok", reivindicada_em: "2026-11-14T11:59:00Z" },
      { rotina: "batida:hora", janela: "ok", reivindicada_em: "ontem" },
      // Relógio do banco adiantado não dá idade negativa.
      { rotina: "batida:minuto", janela: "ok", reivindicada_em: "2026-11-14T12:00:05Z" },
    ],
    agora,
  );
  assert.equal(idades.minuto.ok_ha_segundos, 0);
  assert.equal(idades.hora.ok_ha_segundos, null);
});

test("o segredo do cron só confere com o Bearer exato", () => {
  assert.equal(segredoDoCronConfere("Bearer s3gredo-comprido", "s3gredo-comprido"), true);
  assert.equal(segredoDoCronConfere("Bearer s3gredo-comprid", "s3gredo-comprido"), false);
  assert.equal(segredoDoCronConfere("Bearer s3gredo-comprido-e-mais", "s3gredo-comprido"), false);
  assert.equal(segredoDoCronConfere("s3gredo-comprido", "s3gredo-comprido"), false);
  assert.equal(segredoDoCronConfere("Basic s3gredo-comprido", "s3gredo-comprido"), false);
  assert.equal(segredoDoCronConfere(undefined, "s3gredo-comprido"), false);
});

test("sem segredo configurado a rota do cron nunca abre", () => {
  // O caso perigoso: variável esquecida e alguém mandando "Bearer " vazio.
  assert.equal(segredoDoCronConfere("Bearer ", undefined), false);
  assert.equal(segredoDoCronConfere("Bearer ", ""), false);
  assert.equal(segredoDoCronConfere("Bearer ", "   "), false);
  assert.equal(segredoDoCronConfere("Bearer undefined", undefined), false);
});

test("só minuto e hora são ciclos", () => {
  assert.equal(cicloValido("minuto"), "minuto");
  assert.equal(cicloValido("hora"), "hora");
  assert.equal(cicloValido("dia"), null);
  assert.equal(cicloValido(null), null);
});
