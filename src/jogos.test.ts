import assert from "node:assert/strict";
import test from "node:test";
import { COMPETICOES, converter, tituloDoJogo } from "./jogos.js";

/**
 * Um jogo como o placar do ESPN devolve.
 *
 * O formato é o da API pública deles: o evento por fora, a partida de verdade
 * em `competitions[0]`, e os times num array onde `homeAway` diz quem é quem —
 * a ordem do array não é garantida, e é por isso que o código procura em vez
 * de pegar [0] e [1].
 */
const evento = (extra: Record<string, unknown> = {}) => ({
  id: "704946",
  date: "2026-08-23T00:00Z",
  name: "Palmeiras at Cuiabá",
  shortName: "CUI vs PAL",
  season: { year: 2026, slug: "brazilian-serie-a" },
  week: { text: "Rodada 20" },
  competitions: [
    {
      id: "704946",
      date: "2026-08-23T00:00Z",
      venue: { fullName: "Arena Pantanal" },
      status: { type: { state: "pre", completed: false, description: "Scheduled" } },
      competitors: [
        { homeAway: "away", team: { displayName: "Palmeiras", logo: "https://x/pal.png" } },
        { homeAway: "home", team: { displayName: "Cuiabá", logo: "https://x/cui.png" } },
      ],
    },
  ],
  ...extra,
});

test("jogo completo vira linha aproveitável", () => {
  const [jogo] = converter([evento()]);
  assert.equal(jogo!.id, "704946");
  assert.equal(jogo!.mandante, "Cuiabá");
  assert.equal(jogo!.visitante, "Palmeiras");
  assert.equal(jogo!.estadio, "Arena Pantanal");
  assert.equal(jogo!.rodada, "Rodada 20");
});

test("mandante e visitante saem de homeAway, não da ordem do array", () => {
  // No exemplo o visitante vem PRIMEIRO. Confiar na posição inverteria o
  // confronto — e "Palmeiras x Cuiabá" num bar de Cuiabá é erro que se nota.
  const [jogo] = converter([evento()]);
  assert.equal(tituloDoJogo(jogo!), "Cuiabá x Palmeiras");
});

test("jogo já encerrado não aparece para escolher", () => {
  const encerrado = evento({
    competitions: [
      {
        date: "2026-08-20T00:00Z",
        status: { type: { state: "post", completed: true } },
        competitors: [
          { homeAway: "home", team: { displayName: "A" } },
          { homeAway: "away", team: { displayName: "B" } },
        ],
      },
    ],
  });
  assert.equal(converter([encerrado]).length, 0);
});

test("jogo sem os dois times é descartado", () => {
  // Importar isso criaria um evento que o agente leria em voz alta.
  const semVisitante = evento({
    competitions: [
      {
        date: "2026-08-23T00:00Z",
        competitors: [{ homeAway: "home", team: { displayName: "Cuiabá" } }],
      },
    ],
  });
  assert.equal(converter([semVisitante]).length, 0);
});

test("jogo sem id ou sem data é descartado", () => {
  assert.equal(converter([evento({ id: undefined })]).length, 0);
  assert.equal(
    converter([
      evento({
        date: undefined,
        competitions: [
          {
            competitors: [
              { homeAway: "home", team: { displayName: "A" } },
              { homeAway: "away", team: { displayName: "B" } },
            ],
          },
        ],
      }),
    ]).length,
    0,
  );
});

test("a data vem da partida, não do evento de fora", () => {
  // Quando os dois divergem, quem manda é a partida — é ela que tem o horário
  // de bola rolando.
  const [jogo] = converter([evento({ date: "2026-01-01T00:00Z" })]);
  assert.equal(jogo!.quando, "2026-08-23T00:00Z");
});

test("a lista sai do jogo mais próximo para o mais distante", () => {
  const em = (id: string, data: string) =>
    evento({
      id,
      competitions: [
        {
          date: data,
          competitors: [
            { homeAway: "home", team: { displayName: "A" } },
            { homeAway: "away", team: { displayName: "B" } },
          ],
        },
      ],
    });
  const jogos = converter([
    em("3", "2026-09-01T20:00Z"),
    em("1", "2026-08-22T21:30Z"),
    em("2", "2026-08-25T18:00Z"),
  ]);
  assert.deepEqual(
    jogos.map((j) => j.id),
    ["1", "2", "3"],
  );
});

test("resposta vazia ou estranha não quebra a tela", () => {
  // Sem contrato com a fonte, o formato pode mudar sem aviso — a tela precisa
  // sobreviver a isso mostrando "nenhum jogo", não um erro.
  assert.deepEqual(converter([]), []);
  assert.deepEqual(converter([null as unknown as object, {} as object, { id: "1" }]), []);
});

test("campos ausentes viram nulo em vez de 'undefined' na tela", () => {
  const magro = {
    id: "9",
    competitions: [
      {
        date: "2026-08-23T00:00Z",
        competitors: [
          { homeAway: "home", team: { displayName: "A" } },
          { homeAway: "away", team: { displayName: "B" } },
        ],
      },
    ],
  };
  const [jogo] = converter([magro]);
  assert.equal(jogo!.estadio, null);
  assert.equal(jogo!.rodada, null);
  assert.equal(jogo!.escudoMandante, null);
});

test("as competições oferecidas cobrem o que um bar brasileiro passa", () => {
  const nomes = COMPETICOES.map((c) => c.nome).join(" ");
  for (const esperado of ["Brasileirão Série A", "Copa do Brasil", "Libertadores"]) {
    assert.ok(nomes.includes(esperado), `falta ${esperado}`);
  }
  // Códigos não podem repetir: dois itens com o mesmo id consultariam a mesma
  // competição duas vezes.
  assert.equal(new Set(COMPETICOES.map((c) => c.id)).size, COMPETICOES.length);
  // O código de liga vai direto na URL; espaço ou barra ali viraria uma
  // requisição para um endereço diferente do pretendido.
  for (const c of COMPETICOES) assert.match(c.id, /^[a-z0-9._]+$/);
});
