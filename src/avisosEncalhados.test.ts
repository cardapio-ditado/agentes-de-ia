import assert from "node:assert/strict";
import test from "node:test";
import {
  HORAS_PARA_ENCALHAR,
  comoEncalhou,
  encalhados,
  montarAlerta,
  temNovidade,
} from "./avisosEncalhados.js";

const AGORA = new Date("2026-09-13T20:00:00.000Z");

const aviso = (extra: Partial<Parameters<typeof comoEncalhou>[0]> = {}) => ({
  id: "n1",
  status: "pending",
  template: "reserva_aprovada",
  destination: "(65) 98138-2139",
  error: null,
  attempts: 0,
  created_at: "2026-09-13T19:50:00.000Z",
  updated_at: "2026-09-13T19:50:00.000Z",
  ...extra,
});

test("aviso que falhou mas ainda tem tentativa não acorda ninguém", () => {
  // O worker tenta de novo em segundos. Acordar o dono por isso é o caminho
  // curto para ele parar de ler os alertas.
  assert.equal(comoEncalhou(aviso({ status: "failed", attempts: 1 }), AGORA), null);
  assert.equal(comoEncalhou(aviso({ status: "failed", attempts: 3 }), AGORA), null);
});

test("aviso que gastou as tentativas morreu, e é assunto na hora", () => {
  assert.equal(comoEncalhou(aviso({ status: "failed", attempts: 4 }), AGORA), "morreu");
});

test("aviso parado tempo demais vira assunto mesmo sem ter falhado", () => {
  const velho = aviso({ created_at: "2026-09-13T13:00:00.000Z" });
  assert.equal(horasDe(velho.created_at) >= HORAS_PARA_ENCALHAR, true);
  assert.equal(comoEncalhou(velho, AGORA), "parado");
  // Recém-chegado é só a fila andando.
  assert.equal(comoEncalhou(aviso(), AGORA), null);
});

function horasDe(iso: string): number {
  return (AGORA.getTime() - new Date(iso).getTime()) / 3_600_000;
}

test("a lista vem com os mais recentes na frente", () => {
  const lista = encalhados([
    aviso({ id: "velho", status: "failed", attempts: 4, updated_at: "2026-09-13T10:00:00.000Z" }),
    aviso({ id: "novo", status: "failed", attempts: 4, updated_at: "2026-09-13T19:00:00.000Z" }),
    aviso({ id: "ok" }),
  ], AGORA);
  assert.deepEqual(lista.map((a) => a.id), ["novo", "velho"], "o 'ok' nem entra");
});

test("o mesmo punhado de sempre não gera alerta duas vezes", () => {
  const lista = encalhados(
    [aviso({ status: "failed", attempts: 4, updated_at: "2026-09-13T10:00:00.000Z" })],
    AGORA,
  );
  assert.equal(temNovidade(lista, null), true, "nunca avisado: avisa");
  assert.equal(temNovidade(lista, "2026-09-13T11:00:00.000Z"), false, "já avisado depois: cala");
  assert.equal(temNovidade(lista, "2026-09-13T09:00:00.000Z"), true, "avisado antes: avisa de novo");
  assert.equal(temNovidade([], "2026-09-13T09:00:00.000Z"), false, "sem encalhe, sem alerta");
});

test("o texto do alerta diz o que não saiu, para quem e por quê", () => {
  const texto = montarAlerta({
    casa: "Ditado Popular",
    agora: AGORA,
    lista: encalhados([
      aviso({
        status: "failed",
        attempts: 4,
        template: "reserva_aprovada",
        destination: "189554237694113",
        error: 'Telefone inválido: "189554237694113".',
        updated_at: "2026-09-13T19:00:00.000Z",
      }),
    ], AGORA),
  });

  assert.match(texto, /1 aviso\(s\) não chegaram no Ditado Popular/);
  assert.match(texto, /Confirmação de reserva/, "nome de gente, não 'reserva_aprovada'");
  assert.match(texto, /não é um número de WhatsApp/, "o motivo, traduzido");
  assert.match(texto, /desistiu de tentar/, "diz que este não sai mais sozinho");
  assert.match(texto, /A casa agora/, "diz onde olhar");
});

test("alerta de aviso só atrasado não diz que alguém desistiu", () => {
  const texto = montarAlerta({
    casa: "Ditado Popular",
    agora: AGORA,
    lista: encalhados([aviso({ created_at: "2026-09-13T12:00:00.000Z" })], AGORA),
  });
  assert.match(texto, /Nenhum desistiu ainda/);
  assert.match(texto, /parado há 8 h na fila/);
});

test("fila comprida não vira um textão no WhatsApp", () => {
  const muitos = Array.from({ length: 12 }, (_, i) =>
    aviso({ id: `n${i}`, status: "failed", attempts: 4, updated_at: `2026-09-13T1${i % 10}:00:00.000Z` }));
  const texto = montarAlerta({ casa: "Ditado Popular", agora: AGORA, lista: encalhados(muitos, AGORA) });

  assert.equal(texto.split("•").length - 1, 8, "lista até oito");
  assert.match(texto, /e mais 4\./);
});
