import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agoraLocal, estaNaHora, validarItens, type AgendaChecklist } from "./checklists.js";

const TZ = "America/Cuiaba"; // UTC-4, sem horário de verão

const agenda = (dias: string[], hora: string): AgendaChecklist => ({
  dias,
  hora,
  responsavel_nome: "João",
  responsavel_telefone: "65999999999",
  avisar_telefone: "",
});

describe("agoraLocal", () => {
  it("converte o instante para o dia e a hora da casa", () => {
    // 2026-08-13 22:00 UTC = quinta 18:00 em Cuiabá
    const local = agoraLocal(new Date("2026-08-13T22:00:00Z"), TZ);
    assert.equal(local.dia, "qui");
    assert.equal(local.data, "2026-08-13");
    assert.equal(local.hhmm, "18:00");
  });

  it("vira o dia da semana no fuso local, não no UTC", () => {
    // 2026-08-14 01:00 UTC ainda é quinta 21:00 em Cuiabá
    const local = agoraLocal(new Date("2026-08-14T01:00:00Z"), TZ);
    assert.equal(local.dia, "qui");
    assert.equal(local.data, "2026-08-13");
  });
});

describe("estaNaHora", () => {
  it("dispara quando o dia bate e a hora já passou", () => {
    const quinta18h = new Date("2026-08-13T22:00:00Z");
    assert.equal(estaNaHora(agenda(["qui"], "17:30"), quinta18h, TZ), true);
    assert.equal(estaNaHora(agenda(["qui"], "18:00"), quinta18h, TZ), true);
  });

  it("não dispara antes da hora nem em dia errado", () => {
    const quinta18h = new Date("2026-08-13T22:00:00Z");
    assert.equal(estaNaHora(agenda(["qui"], "19:00"), quinta18h, TZ), false);
    assert.equal(estaNaHora(agenda(["sex"], "09:00"), quinta18h, TZ), false);
  });

  it("agenda sem dias nunca dispara sozinha (só manual)", () => {
    assert.equal(estaNaHora(agenda([], "09:00"), new Date(), TZ), false);
  });
});

describe("validarItens", () => {
  it("aceita os três tipos e preenche id e obrigatório", () => {
    const itens = validarItens([
      { tipo: "sim_nao", pergunta: "Freezer ligado?" },
      { tipo: "texto", pergunta: "Temperatura da câmara fria", obrigatorio: false },
      { tipo: "foto", pergunta: "Foto da área do bar" },
    ]);
    assert.equal(itens.length, 3);
    assert.ok(itens[0]!.id.length > 0);
    assert.equal(itens[0]!.obrigatorio, true);
    assert.equal(itens[1]!.obrigatorio, false);
  });

  it("recusa lista vazia e tipo desconhecido", () => {
    assert.throws(() => validarItens([]));
    assert.throws(() => validarItens([{ tipo: "nota", pergunta: "x" }]));
  });
});
