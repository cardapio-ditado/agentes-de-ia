import assert from "node:assert/strict";
import test from "node:test";
import { chaveDoEvento, linhasParaGravar } from "./importarProgramacao.js";
import type { EventoParaGravar } from "./importarProgramacao.js";

const CUIABA = "America/Cuiaba";

function evento(over: Partial<EventoParaGravar> = {}): EventoParaGravar {
  return {
    titulo: "Acústico Berê",
    tipo: "musica",
    data: "2026-08-17",
    inicio: "20:00",
    fim: "23:00",
    descricao: null,
    couvert: null,
    ...over,
  };
}

test("o horário digitado é o do relógio da casa, não o do servidor", () => {
  // 20h em Cuiabá é meia-noite UTC do dia seguinte. Gravar "2026-08-17T20:00Z"
  // poria o show quatro horas cedo — e no dia errado para quem olha a agenda.
  const { linhas } = linhasParaGravar({ venueId: "v", fuso: CUIABA, eventos: [evento()] });
  assert.equal(linhas[0]!.starts_at, "2026-08-18T00:00:00.000Z");
  assert.equal(linhas[0]!.ends_at, "2026-08-18T03:00:00.000Z");
});

test("show que vira a noite termina no dia seguinte", () => {
  const { linhas } = linhasParaGravar({
    venueId: "v",
    fuso: CUIABA,
    eventos: [evento({ inicio: "23:00", fim: "01:00" })],
  });
  const duracao = Date.parse(linhas[0]!.ends_at!) - Date.parse(linhas[0]!.starts_at);
  assert.equal(duracao, 2 * 3600_000);
});

test("sem hora de fim, o show ocupa a noite em vez de ficar sem fim", () => {
  const { linhas } = linhasParaGravar({
    venueId: "v",
    fuso: CUIABA,
    eventos: [evento({ fim: null })],
  });
  const duracao = Date.parse(linhas[0]!.ends_at!) - Date.parse(linhas[0]!.starts_at);
  assert.equal(duracao, 4 * 3600_000);
});

test("o mesmo cartaz mandado duas vezes não vira duas agendas", () => {
  // Acento e espaço a mais são a mesma atração — é assim que o material
  // costuma vir quando alguém redigita.
  const jaExistentes = new Set([chaveDoEvento("Acustico Bere", "2026-08-18T00:00:00.000Z")]);
  const r = linhasParaGravar({ venueId: "v", fuso: CUIABA, eventos: [evento()], jaExistentes });
  assert.equal(r.linhas.length, 0);
  assert.equal(r.repetidos, 1);
});

test("repetido dentro do próprio material também é barrado", () => {
  const r = linhasParaGravar({
    venueId: "v",
    fuso: CUIABA,
    eventos: [evento(), evento({ titulo: "acústico  berê " })],
  });
  assert.equal(r.linhas.length, 1);
  assert.equal(r.repetidos, 1);
});

test("mesmo nome em dia diferente são dois shows, não repetição", () => {
  const r = linhasParaGravar({
    venueId: "v",
    fuso: CUIABA,
    eventos: [evento(), evento({ data: "2026-08-24" })],
  });
  assert.equal(r.linhas.length, 2);
  assert.equal(r.repetidos, 0);
});

test("evento desmarcado na conferência não entra", () => {
  const r = linhasParaGravar({
    venueId: "v",
    fuso: CUIABA,
    eventos: [evento({ escolhido: false }), evento({ titulo: "Karanova" })],
  });
  assert.deepEqual(r.linhas.map((l) => l.title), ["Karanova"]);
});

test("data impossível vira aviso, não linha no banco", () => {
  const r = linhasParaGravar({
    venueId: "v",
    fuso: CUIABA,
    eventos: [evento({ data: "17/08/2026" })],
  });
  assert.equal(r.linhas.length, 0);
  assert.match(r.avisos.join(" "), /não foi gravado/i);
});

test("o que a IA leu fica marcado como tal", () => {
  const { linhas } = linhasParaGravar({ venueId: "v", fuso: CUIABA, eventos: [evento()] });
  assert.deepEqual(linhas[0]!.details, { fonte: "leitura-ia" });
  assert.equal(linhas[0]!.venue_id, "v");
  assert.equal(linhas[0]!.kind, "musica");
});

test("couvert e descrição atravessam sem ser inventados", () => {
  const { linhas } = linhasParaGravar({
    venueId: "v",
    fuso: CUIABA,
    eventos: [evento({ couvert: 15, descricao: "Sertanejo raiz" })],
  });
  assert.equal(linhas[0]!.cover_charge, 15);
  assert.equal(linhas[0]!.description, "Sertanejo raiz");
});
