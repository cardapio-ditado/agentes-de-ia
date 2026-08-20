import assert from "node:assert/strict";
import test from "node:test";
import { converter, jogosConfigurados, tituloDoJogo, COMPETICOES } from "./jogos.js";

/** Uma partida como a API-Football devolve. */
const jogoCru = (extra: Record<string, unknown> = {}) => ({
  fixture: {
    id: 1198234,
    date: "2026-08-22T21:30:00+00:00",
    venue: { name: "Arena Pantanal", city: "Cuiabá" },
    status: { short: "NS" },
  },
  league: { id: 71, name: "Serie A", round: "Regular Season - 20", season: 2026 },
  teams: {
    home: { name: "Cuiaba", logo: "https://x/cuiaba.png" },
    away: { name: "Palmeiras", logo: "https://x/palmeiras.png" },
  },
  ...extra,
});

test("partida completa vira jogo aproveitável", () => {
  const [jogo] = converter([jogoCru()]);
  assert.equal(jogo!.id, 1198234);
  assert.equal(jogo!.mandante, "Cuiaba");
  assert.equal(jogo!.visitante, "Palmeiras");
  assert.equal(jogo!.estadio, "Arena Pantanal");
  assert.equal(jogo!.rodada, "Regular Season - 20");
});

test("o título é o que o agente vai falar", () => {
  const [jogo] = converter([jogoCru()]);
  assert.equal(tituloDoJogo(jogo!), "Cuiaba x Palmeiras");
});

test("partida sem os dois times é descartada", () => {
  // Importar isso criaria um evento que o agente leria em voz alta para o
  // cliente — pior que não ter o jogo.
  const semVisitante = jogoCru({ teams: { home: { name: "Cuiaba" }, away: {} } });
  assert.equal(converter([semVisitante]).length, 0);
});

test("partida sem data ou sem id é descartada", () => {
  assert.equal(converter([jogoCru({ fixture: { id: 1, venue: {} } })]).length, 0);
  assert.equal(
    converter([jogoCru({ fixture: { date: "2026-08-22T21:30:00+00:00", venue: {} } })]).length,
    0,
  );
});

test("a lista sai do jogo mais próximo para o mais distante", () => {
  const jogos = converter([
    jogoCru({ fixture: { id: 3, date: "2026-09-01T20:00:00+00:00", venue: {} } }),
    jogoCru({ fixture: { id: 1, date: "2026-08-22T21:30:00+00:00", venue: {} } }),
    jogoCru({ fixture: { id: 2, date: "2026-08-25T18:00:00+00:00", venue: {} } }),
  ]);
  assert.deepEqual(
    jogos.map((j) => j.id),
    [1, 2, 3],
  );
});

test("resposta vazia ou estranha não quebra a tela", () => {
  assert.deepEqual(converter([]), []);
  assert.deepEqual(converter([null as unknown as object, {} as object]), []);
});

test("campos ausentes viram nulo em vez de 'undefined' na tela", () => {
  const magro = {
    fixture: { id: 9, date: "2026-08-22T21:30:00+00:00" },
    league: {},
    teams: { home: { name: "A" }, away: { name: "B" } },
  };
  const [jogo] = converter([magro]);
  assert.equal(jogo!.estadio, null);
  assert.equal(jogo!.rodada, null);
  assert.equal(jogo!.escudoMandante, null);
  assert.equal(jogo!.competicao, "—");
});

test("sem chave configurada, a busca se declara indisponível", () => {
  const antes = process.env.API_FOOTBALL_KEY;
  delete process.env.API_FOOTBALL_KEY;
  assert.equal(jogosConfigurados(), false);
  process.env.API_FOOTBALL_KEY = "   ";
  assert.equal(jogosConfigurados(), false, "chave em branco não conta como configurada");
  process.env.API_FOOTBALL_KEY = "abc123";
  assert.equal(jogosConfigurados(), true);
  if (antes === undefined) delete process.env.API_FOOTBALL_KEY;
  else process.env.API_FOOTBALL_KEY = antes;
});

test("as competições oferecidas cobrem o que um bar brasileiro passa", () => {
  const nomes = COMPETICOES.map((c) => c.nome).join(" ");
  for (const esperado of ["Brasileirão Série A", "Copa do Brasil", "Libertadores"]) {
    assert.ok(nomes.includes(esperado), `falta ${esperado}`);
  }
  // Ids não podem repetir: dois itens com o mesmo id fariam a tela consultar
  // a mesma competição duas vezes e gastar cota à toa.
  assert.equal(new Set(COMPETICOES.map((c) => c.id)).size, COMPETICOES.length);
});
