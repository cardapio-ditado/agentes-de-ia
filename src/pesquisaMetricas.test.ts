import assert from "node:assert/strict";
import test from "node:test";
import {
  MINIMO_PARA_RANKING,
  classificar,
  contarEtiquetas,
  montarPainel,
  porCategoria,
  porDia,
  ranking,
  resumoNps,
} from "./pesquisaMetricas.js";
import type { RespostaBruta } from "./pesquisaMetricas.js";

const CUIABA = "America/Cuiaba";

let sequencia = 0;
function resposta(over: Partial<RespostaBruta> = {}): RespostaBruta {
  sequencia += 1;
  return {
    id: `r${sequencia}`,
    nota: 10,
    elogios: [],
    criticas: [],
    comentario: null,
    atendente_id: null,
    atendente_nota: null,
    mesa: null,
    origem: "qrcode",
    cliente_nome: null,
    cliente_contato: null,
    created_at: "2026-08-20T23:00:00.000Z",
    ...over,
  };
}

/* ---------- NPS ---------- */

test("a faixa do NPS é a do mercado, para o número ser comparável", () => {
  assert.equal(classificar(10), "promotor");
  assert.equal(classificar(9), "promotor");
  assert.equal(classificar(8), "neutro");
  assert.equal(classificar(7), "neutro");
  assert.equal(classificar(6), "detrator");
  assert.equal(classificar(0), "detrator");
});

test("NPS de exemplo bate com a conta feita à mão", () => {
  // 6 promotores, 2 neutros, 2 detratores em 10 → 60% − 20% = 40.
  const r = resumoNps([
    ...Array.from({ length: 6 }, () => resposta({ nota: 10 })),
    ...Array.from({ length: 2 }, () => resposta({ nota: 8 })),
    ...Array.from({ length: 2 }, () => resposta({ nota: 3 })),
  ]);
  assert.equal(r.nps, 40);
  assert.equal(r.promotores, 6);
  assert.equal(r.detratores, 2);
  assert.equal(r.respostas, 10);
});

test("NPS pode ser negativo, e é assim que tem que aparecer", () => {
  // Esconder o sinal seria mentir para o dono justamente quando ele precisa
  // saber.
  const r = resumoNps([resposta({ nota: 2 }), resposta({ nota: 3 }), resposta({ nota: 10 })]);
  assert.ok(r.nps < 0, `esperava negativo, veio ${r.nps}`);
});

test("o arredondamento é só no fim", () => {
  // 1 promotor e 2 detratores em 3: 33,33% − 66,67% = −33. Arredondar cada
  // percentual antes daria −34, e o número não bateria com nenhuma outra
  // ferramenta.
  assert.equal(resumoNps([resposta({ nota: 9 }), resposta({ nota: 5 }), resposta({ nota: 5 })]).nps, -33);
});

test("sem resposta nenhuma o resumo é zero, não divisão por zero", () => {
  const r = resumoNps([]);
  assert.equal(r.respostas, 0);
  assert.equal(r.nps, 0);
  assert.ok(Number.isFinite(r.media));
});

/* ---------- ranking ---------- */

const EQUIPE = [
  { id: "a1", nome: "Ana Paula", apelido: "Ana" },
  { id: "a2", nome: "Carlos" },
];

test("uma avaliação 5 não põe ninguém acima de quem tem quarenta", () => {
  // O ranking existe para reconhecer trabalho. Sem mínimo, ele vira sorteio.
  const r = ranking(
    [
      resposta({ atendente_id: "a1", atendente_nota: 5 }),
      ...Array.from({ length: 40 }, () =>
        resposta({ atendente_id: "a2", atendente_nota: 5 }),
      ),
      resposta({ atendente_id: "a2", atendente_nota: 4 }),
    ],
    EQUIPE,
  );
  assert.equal(r[0]!.nome, "Carlos");
  assert.equal(r[0]!.classificado, true);
  assert.equal(r[1]!.classificado, false);
});

test("quem ainda não tem avaliações suficientes aparece marcado, não some", () => {
  const r = ranking([resposta({ atendente_id: "a1", atendente_nota: 5 })], EQUIPE);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.classificado, false);
  assert.equal(r[0]!.avaliacoes, 1);
});

test("o mínimo é atingido exatamente no número, não depois dele", () => {
  const r = ranking(
    Array.from({ length: MINIMO_PARA_RANKING }, () =>
      resposta({ atendente_id: "a1", atendente_nota: 4 }),
    ),
    EQUIPE,
  );
  assert.equal(r[0]!.classificado, true);
});

test("o ranking usa o apelido — é como o cliente conhece a pessoa", () => {
  const r = ranking([resposta({ atendente_id: "a1", atendente_nota: 5 })], EQUIPE);
  assert.equal(r[0]!.nome, "Ana");
});

test("avaliação de atendente já removido não some nem quebra", () => {
  const r = ranking([resposta({ atendente_id: "sumiu", atendente_nota: 5 })], EQUIPE);
  assert.equal(r[0]!.nome, "Atendente removido");
});

test("resposta sem atendente não entra no ranking de ninguém", () => {
  assert.deepEqual(ranking([resposta({ nota: 10 })], EQUIPE), []);
});

test("média e cinco-estrelas são contas diferentes", () => {
  const r = ranking(
    [
      resposta({ atendente_id: "a1", atendente_nota: 5 }),
      resposta({ atendente_id: "a1", atendente_nota: 5 }),
      resposta({ atendente_id: "a1", atendente_nota: 3 }),
    ],
    EQUIPE,
  );
  assert.equal(r[0]!.media, 4.3);
  assert.equal(r[0]!.cincoEstrelas, 2);
  assert.equal(r[0]!.avaliacoes, 3);
});

/* ---------- etiquetas e linha do tempo ---------- */

test("as etiquetas saem da mais marcada para a menos", () => {
  const c = contarEtiquetas(
    [
      resposta({ elogios: ["Atendimento", "Música"] }),
      resposta({ elogios: ["Atendimento"] }),
      resposta({ elogios: ["Comida"] }),
    ],
    "elogios",
  );
  assert.deepEqual(c[0], { etiqueta: "Atendimento", vezes: 2 });
  assert.equal(c.length, 3);
});

test("elogio e crítica não se misturam", () => {
  const dados = [resposta({ elogios: ["Comida"], criticas: ["Demora"] })];
  assert.deepEqual(contarEtiquetas(dados, "criticas"), [{ etiqueta: "Demora", vezes: 1 }]);
});

test("a noite de sábado não vira domingo por causa do fuso", () => {
  // 23h de sábado em Cuiabá já é domingo em UTC. Agrupar pelo dia UTC mostraria
  // movimento no dia em que a casa estava fechada.
  const linha = porDia(
    [
      resposta({ created_at: "2026-08-23T02:00:00.000Z", nota: 10 }),
      resposta({ created_at: "2026-08-23T03:30:00.000Z", nota: 8 }),
    ],
    CUIABA,
  );
  assert.equal(linha.length, 1);
  assert.equal(linha[0]!.dia, "2026-08-22");
  assert.equal(linha[0]!.respostas, 2);
  assert.equal(linha[0]!.media, 9);
});

test("a linha sai em ordem de calendário", () => {
  const linha = porDia(
    [
      resposta({ created_at: "2026-08-25T15:00:00.000Z" }),
      resposta({ created_at: "2026-08-21T15:00:00.000Z" }),
      resposta({ created_at: "2026-08-23T15:00:00.000Z" }),
    ],
    CUIABA,
  );
  assert.deepEqual(linha.map((p) => p.dia), ["2026-08-21", "2026-08-23", "2026-08-25"]);
});

/* ---------- painel inteiro ---------- */

test("o painel destaca os detratores recentes primeiro", () => {
  // É para estes que o dono liga de volta — e o de ontem ainda dá para
  // recuperar, o de três semanas já contou para os amigos.
  const p = montarPainel({
    respostas: [
      resposta({ nota: 3, created_at: "2026-08-10T23:00:00.000Z" }),
      resposta({ nota: 4, created_at: "2026-08-20T23:00:00.000Z" }),
      resposta({ nota: 10, created_at: "2026-08-21T23:00:00.000Z" }),
    ],
    atendentes: EQUIPE,
    fuso: CUIABA,
  });
  assert.equal(p.aBater.length, 2);
  assert.equal(p.aBater[0]!.nota, 4);
});

test("sem período anterior, a comparação vem nula em vez de fingir zero", () => {
  // Zero seria lido como "caiu de 40 para 0" no primeiro mês de uso.
  const p = montarPainel({ respostas: [resposta()], atendentes: EQUIPE, fuso: CUIABA });
  assert.equal(p.anterior, null);
});

test("o painel junta nuvem, ranking e etiquetas da mesma amostra", () => {
  const p = montarPainel({
    respostas: [
      resposta({ nota: 10, comentario: "comida maravilhosa", elogios: ["Comida"], atendente_id: "a1", atendente_nota: 5 }),
      resposta({ nota: 4, comentario: "demorou muito", criticas: ["Demora"] }),
    ],
    anteriores: [resposta({ nota: 7 })],
    atendentes: EQUIPE,
    fuso: CUIABA,
  });
  assert.equal(p.resumo.respostas, 2);
  assert.equal(p.anterior?.respostas, 1);
  assert.ok(p.nuvem.some((t) => t.termo === "demora"));
  assert.equal(p.ranking.length, 1);
  assert.equal(p.elogios[0]!.etiqueta, "Comida");
});

/* ---------- notas por categoria ---------- */

let seqNota = 0;
function nota(over: Partial<import("./pesquisaMetricas.js").NotaBruta> = {}) {
  seqNota += 1;
  return {
    resposta_id: "r1",
    item_id: `i${seqNota}`,
    categoria: "Comida",
    pergunta: "A comida agradou?",
    tipo: "nota",
    nota: 8,
    texto: null,
    created_at: "2026-08-20T23:00:00.000Z",
    ...over,
  };
}

test("a média de uma categoria junta as perguntas dela", () => {
  const c = porCategoria([
    nota({ item_id: "a", categoria: "Comida", nota: 8 }),
    nota({ item_id: "b", categoria: "Comida", nota: 6 }),
    nota({ item_id: "c", categoria: "Ambiente", nota: 10 }),
  ]);
  const comida = c.find((x) => x.categoria === "Comida");
  assert.equal(comida?.media, 7);
  assert.equal(comida?.respostas, 2);
});

test("a pior categoria vem primeiro — a tela existe para achar problema", () => {
  // Ordenar por nome poria "Ambiente" antes de "Tempo de espera" mesmo com a
  // espera em 4,2, e o que precisa de ação ficaria embaixo.
  const c = porCategoria([
    nota({ item_id: "a", categoria: "Ambiente", nota: 9 }),
    nota({ item_id: "b", categoria: "Tempo de espera", nota: 4 }),
    nota({ item_id: "c", categoria: "Comida", nota: 7 }),
  ]);
  assert.deepEqual(c.map((x) => x.categoria), ["Tempo de espera", "Comida", "Ambiente"]);
});

test("pergunta de texto não entra na média da categoria", () => {
  const c = porCategoria([
    nota({ item_id: "a", categoria: "Comida", nota: 8 }),
    nota({ item_id: "b", categoria: "Comida", nota: null, tipo: "texto", texto: "faltou sal" }),
  ]);
  assert.equal(c[0]!.media, 8);
  assert.equal(c[0]!.respostas, 1);
});

test("categoria só de texto some da lista em vez de virar média zero", () => {
  // Média zero num assunto que ninguém pontuou seria lida como "está péssimo".
  const c = porCategoria([nota({ categoria: "Geral", nota: null, tipo: "texto", texto: "oi" })]);
  assert.deepEqual(c, []);
});

test("a comparação com o período anterior é por categoria", () => {
  const c = porCategoria(
    [nota({ item_id: "a", categoria: "Comida", nota: 6 })],
    [nota({ item_id: "a", categoria: "Comida", nota: 9 })],
  );
  assert.equal(c[0]!.media, 6);
  assert.equal(c[0]!.antes, 9);
});

test("categoria nova não finge que piorou", () => {
  // Sem base, `antes` é nulo — zero seria lido como despencou.
  const c = porCategoria([nota({ categoria: "Estacionamento", nota: 7 })], []);
  assert.equal(c[0]!.antes, null);
});

test("dentro da categoria, a pior pergunta vem primeiro", () => {
  // A categoria diz ONDE está o problema; a pergunta diz QUAL é.
  const c = porCategoria([
    nota({ item_id: "a", categoria: "Comida", pergunta: "Estava saborosa?", nota: 9 }),
    nota({ item_id: "b", categoria: "Comida", pergunta: "Chegou quente?", nota: 4 }),
  ]);
  assert.deepEqual(c[0]!.perguntas.map((p) => p.pergunta), ["Chegou quente?", "Estava saborosa?"]);
});

test("a mesma pergunta respondida por várias pessoas vira uma linha só", () => {
  const c = porCategoria([
    nota({ resposta_id: "r1", item_id: "a", nota: 10 }),
    nota({ resposta_id: "r2", item_id: "a", nota: 6 }),
  ]);
  assert.equal(c[0]!.perguntas.length, 1);
  assert.equal(c[0]!.perguntas[0]!.media, 8);
  assert.equal(c[0]!.perguntas[0]!.respostas, 2);
});

test("sem nota nenhuma, a lista sai vazia em vez de estourar", () => {
  assert.deepEqual(porCategoria([]), []);
});

test("o painel entrega as categorias junto com o resto", () => {
  const p = montarPainel({
    respostas: [resposta({ nota: 9, id: "r1" })],
    notas: [nota({ resposta_id: "r1", categoria: "Comida", nota: 7 })],
    atendentes: EQUIPE,
    fuso: CUIABA,
  });
  assert.equal(p.categorias.length, 1);
  assert.equal(p.categorias[0]!.categoria, "Comida");
});

test("o texto das perguntas abertas alimenta a nuvem", () => {
  // Quem escreveu em "quer contar mais?" está falando da casa do mesmo jeito;
  // deixar de fora esvaziaria a nuvem nas pesquisas mais bem montadas.
  const p = montarPainel({
    respostas: [resposta({ id: "r1", nota: 4, comentario: null })],
    notas: [
      nota({ resposta_id: "r1", nota: null, tipo: "texto", texto: "demora demais na cozinha" }),
    ],
    atendentes: EQUIPE,
    fuso: CUIABA,
  });
  assert.ok(p.nuvem.some((t) => t.termo === "demora"));
  assert.equal(p.nuvem.find((t) => t.termo === "demora")?.tom, "critica");
});
