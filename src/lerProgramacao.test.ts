import assert from "node:assert/strict";
import test from "node:test";
import { converter, tipoDeAgendaAceito } from "./lerProgramacao.js";

test("evento completo vira registro aproveitável", () => {
  const r = converter({
    eventos: [
      {
        titulo: "Acústico Berê",
        tipo: "musica",
        data: "2026-08-17",
        inicio: "20:00",
        fim: "23:00",
        couvert: 15,
      },
    ],
    avisos: [],
  });
  assert.equal(r.eventos.length, 1);
  assert.equal(r.eventos[0]!.titulo, "Acústico Berê");
  assert.equal(r.eventos[0]!.couvert, 15);
});

test("duas atrações no mesmo dia são dois eventos", () => {
  const r = converter({
    eventos: [
      { titulo: "Zé Rodrigo e Alexandre", tipo: "musica", data: "2026-08-21", inicio: "19:30", fim: "22:30" },
      { titulo: "João Ricardo e Juliano", tipo: "musica", data: "2026-08-21", inicio: "23:00", fim: "01:00" },
    ],
    avisos: [],
  });
  assert.equal(r.eventos.length, 2);
  // Fim menor que o início é a madrugada seguinte — preservado como veio,
  // porque quem resolve a virada do dia é quem grava.
  assert.equal(r.eventos[1]!.fim, "01:00");
});

test("data malformada vira aviso, não evento em dia inventado", () => {
  // Show no dia errado é pior que show ausente: o cliente vem e não tem nada.
  const r = converter({
    eventos: [{ titulo: "Samba", tipo: "musica", data: "17/08/2026", inicio: "20:00" }],
    avisos: [],
  });
  assert.equal(r.eventos.length, 0);
  assert.match(r.avisos.join(" "), /data não reconhecida/i);
});

test("data inexistente no calendário é recusada", () => {
  const r = converter({
    eventos: [{ titulo: "X", tipo: "musica", data: "2026-02-31", inicio: "20:00" }],
    avisos: [],
  });
  assert.equal(r.eventos.length, 0);
});

test("horário fora do formato vira aviso", () => {
  const r = converter({
    eventos: [
      { titulo: "A", tipo: "musica", data: "2026-08-17", inicio: "20h" },
      { titulo: "B", tipo: "musica", data: "2026-08-17", inicio: "25:00" },
    ],
    avisos: [],
  });
  assert.equal(r.eventos.length, 0);
  assert.equal(r.avisos.filter((a) => /horário/i.test(a)).length, 2);
});

test("hora com um dígito é normalizada", () => {
  const r = converter({
    eventos: [{ titulo: "A", tipo: "musica", data: "2026-08-17", inicio: "9:30" }],
    avisos: [],
  });
  assert.equal(r.eventos[0]!.inicio, "09:30");
});

test("evento sem nome é descartado", () => {
  const r = converter({
    eventos: [{ titulo: "  ", tipo: "musica", data: "2026-08-17", inicio: "20:00" }],
    avisos: [],
  });
  assert.equal(r.eventos.length, 0);
});

test("tipo desconhecido vira música, o caso comum de um bar", () => {
  const r = converter({
    eventos: [{ titulo: "A", tipo: "karaoke", data: "2026-08-17", inicio: "20:00" }],
    avisos: [],
  });
  assert.equal(r.eventos[0]!.tipo, "musica");
});

test("couvert zero ou negativo não vira cobrança", () => {
  const r = converter({
    eventos: [
      { titulo: "A", tipo: "musica", data: "2026-08-17", inicio: "20:00", couvert: 0 },
      { titulo: "B", tipo: "musica", data: "2026-08-18", inicio: "20:00", couvert: -5 },
    ],
    avisos: [],
  });
  assert.equal(r.eventos[0]!.couvert, null);
  assert.equal(r.eventos[1]!.couvert, null);
});

test("a lista sai em ordem de calendário", () => {
  const r = converter({
    eventos: [
      { titulo: "C", tipo: "musica", data: "2026-08-23", inicio: "19:00" },
      { titulo: "A", tipo: "musica", data: "2026-08-17", inicio: "20:00" },
      { titulo: "B", tipo: "musica", data: "2026-08-22", inicio: "13:00" },
    ],
    avisos: [],
  });
  assert.deepEqual(r.eventos.map((e) => e.titulo), ["A", "B", "C"]);
});

test("material sem evento nenhum avisa em vez de sair vazio em silêncio", () => {
  const r = converter({ eventos: [], avisos: [] });
  assert.match(r.avisos.join(" "), /Nenhum evento/i);
});

test("resposta estranha do modelo não quebra a tela", () => {
  assert.equal(converter({}).eventos.length, 0);
  assert.equal(converter({ eventos: "nada" }).eventos.length, 0);
});

test("formatos aceitos cobrem foto, PDF e planilha", () => {
  for (const t of [
    "image/jpeg",
    "image/png",
    "application/pdf",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]) {
    assert.ok(tipoDeAgendaAceito(t), t);
  }
  assert.equal(tipoDeAgendaAceito("video/mp4"), false);
});
