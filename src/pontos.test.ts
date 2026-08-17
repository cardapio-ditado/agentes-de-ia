import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cicloAtual,
  estadoPelaExaustao,
  MODELO_DE_CORTESIA,
  nomeDoModelo,
  pesoDoModelo,
} from "./pontos.js";

describe("pesos dos motores", () => {
  it("segue a razão real de preço entre os modelos", () => {
    assert.equal(pesoDoModelo("claude-haiku-4-5-20251001"), 1);
    assert.equal(pesoDoModelo("claude-sonnet-5"), 3);
    assert.equal(pesoDoModelo("claude-opus-5"), 5);
  });

  it("reconhece versões futuras pelo prefixo da família", () => {
    // Um "claude-sonnet-6" não pode ser cobrado como desconhecido só porque
    // ainda não existia quando isto foi escrito.
    assert.equal(pesoDoModelo("claude-sonnet-6"), 3);
    assert.equal(pesoDoModelo("claude-opus-4-8"), 5);
    assert.equal(nomeDoModelo("claude-opus-4-8"), "Opus");
  });

  it("cobra o meio-termo quando o modelo é desconhecido ou ausente", () => {
    // Nunca 0: modelo não reconhecido cobrando zero seria consumo grátis
    // silencioso — o pior tipo de erro num medidor de cobrança.
    assert.equal(pesoDoModelo(null), 3);
    assert.equal(pesoDoModelo("gpt-qualquer-coisa"), 3);
  });
});

describe("ciclo de cobrança", () => {
  const TZ = "America/Cuiaba";

  it("começa no dia da assinatura quando o mês já passou dele", () => {
    // 17/08, assinatura vira dia 10 → ciclo corrente é 10/08 a 10/09.
    const c = cicloAtual(10, TZ, new Date("2026-08-17T15:00:00Z"));
    assert.equal(c.inicio.toISOString().slice(0, 10), "2026-08-10");
    assert.equal(c.fim.toISOString().slice(0, 10), "2026-09-10");
    assert.equal(c.diasCorridos, 8);
    assert.equal(c.diasRestantes, 24);
  });

  it("volta para o mês anterior quando ainda não chegou o dia da virada", () => {
    // 05/08, assinatura dia 20 → o ciclo corrente começou em 20/07.
    const c = cicloAtual(20, TZ, new Date("2026-08-05T15:00:00Z"));
    assert.equal(c.inicio.toISOString().slice(0, 10), "2026-07-20");
    assert.equal(c.fim.toISOString().slice(0, 10), "2026-08-20");
  });

  it("atravessa a virada de ano sem se perder", () => {
    const c = cicloAtual(15, TZ, new Date("2026-01-05T15:00:00Z"));
    assert.equal(c.inicio.toISOString().slice(0, 10), "2025-12-15");
    assert.equal(c.fim.toISOString().slice(0, 10), "2026-01-15");
  });

  it("usa o dia do fuso da casa, não o do UTC", () => {
    // 01/09 às 01h UTC ainda é 31/08 às 21h em Cuiabá. Com virada no dia 1,
    // ler pelo UTC daria um ciclo novo que ainda não começou para o cliente.
    const c = cicloAtual(1, TZ, new Date("2026-09-01T01:00:00Z"));
    assert.equal(c.inicio.toISOString().slice(0, 10), "2026-08-01");
    assert.equal(c.fim.toISOString().slice(0, 10), "2026-09-01");
  });

  it("no primeiro dia conta um dia corrido, não zero", () => {
    // Divisão por zero aqui viraria ritmo diário infinito no painel.
    const c = cicloAtual(17, TZ, new Date("2026-08-17T15:00:00Z"));
    assert.equal(c.diasCorridos, 1);
    assert.ok(Number.isFinite(100 / c.diasCorridos));
  });

  it("limita o dia da virada a 28 para não sumir em fevereiro", () => {
    const c = cicloAtual(31, TZ, new Date("2026-03-10T15:00:00Z"));
    assert.equal(c.inicio.toISOString().slice(0, 10), "2026-02-28");
  });
});

describe("estados do plano quando os pontos acabam", () => {
  /** A função de verdade que o agente consulta — sem cópia da regra aqui. */
  function estado(esgotadoEm: string | null, agora: Date) {
    const r = estadoPelaExaustao(esgotadoEm, agora);
    return { estado: r.estado, horas: r.horasDeCortesia };
  }

  it("com saldo, o plano fica ativo", () => {
    assert.equal(estado(null, new Date("2026-08-17T12:00:00Z")).estado, "ativo");
  });

  it("logo após zerar entra em cortesia com 48 horas", () => {
    const r = estado("2026-08-17T12:00:00Z", new Date("2026-08-17T12:00:01Z"));
    assert.equal(r.estado, "cortesia");
    assert.equal(r.horas, 48);
  });

  it("no meio da cortesia continua atendendo", () => {
    const r = estado("2026-08-17T12:00:00Z", new Date("2026-08-18T12:00:00Z"));
    assert.equal(r.estado, "cortesia");
    assert.equal(r.horas, 24);
  });

  it("um minuto antes de fechar 48h ainda é cortesia", () => {
    const r = estado("2026-08-17T12:00:00Z", new Date("2026-08-19T11:59:00Z"));
    assert.equal(r.estado, "cortesia");
  });

  it("exatamente em 48h já está bloqueado", () => {
    // A borda importa: aqui é onde o agente para de responder sozinho.
    const r = estado("2026-08-17T12:00:00Z", new Date("2026-08-19T12:00:00Z"));
    assert.equal(r.estado, "bloqueado");
    assert.equal(r.horas, 0);
  });

  it("muito depois segue bloqueado, sem horas negativas", () => {
    const r = estado("2026-08-17T12:00:00Z", new Date("2026-08-30T12:00:00Z"));
    assert.equal(r.estado, "bloqueado");
    assert.equal(r.horas, 0);
  });

  it("na cortesia o motor é forçado para o mais barato", () => {
    // O combinado com o cliente é continuar atendendo ao custo mínimo — não
    // continuar gastando 5x num plano que já estourou.
    assert.equal(pesoDoModelo(MODELO_DE_CORTESIA), 1);
  });
});
