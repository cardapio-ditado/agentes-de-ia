import assert from "node:assert/strict";
import test from "node:test";
import { interpretarResposta, notaNormalizada, validarItens } from "./pesquisaModelo.js";

/* ---------- a escala única ---------- */

test("estrela vira nota na escala de 0 a 10", () => {
  // É isto que permite somar "Comida" quando uma pergunta é em estrelas e a
  // outra em nota. Sem escala única, a média por categoria seria a média de
  // unidades diferentes — um número que parece certo e não é.
  assert.equal(notaNormalizada("estrelas", 5), 10);
  assert.equal(notaNormalizada("estrelas", 3), 5);
  assert.equal(notaNormalizada("estrelas", 1), 0);
});

test("uma estrela é zero, não dois", () => {
  // Mapear 1..5 direto para 2..10 daria média 6 a uma casa que só toma uma
  // estrela, e o dono acharia que está mediano.
  assert.equal(notaNormalizada("estrelas", 1), 0);
});

test("sim e não viram os extremos da escala", () => {
  assert.equal(notaNormalizada("sim_nao", "sim"), 10);
  assert.equal(notaNormalizada("sim_nao", "nao"), 0);
  assert.equal(notaNormalizada("sim_nao", "não"), 0);
});

test("nota fora da faixa não entra na média", () => {
  // Um POST feito à mão com nota 90 puxaria a média da casa para sempre.
  assert.equal(notaNormalizada("nota", 11), null);
  assert.equal(notaNormalizada("nota", -1), null);
  assert.equal(notaNormalizada("estrelas", 9), null);
  assert.equal(notaNormalizada("sim_nao", "talvez"), null);
  assert.equal(notaNormalizada("nota", "muito bom"), null);
});

test("pergunta de texto não pontua", () => {
  assert.equal(notaNormalizada("texto", "adorei tudo"), null);
});

test("nota nos extremos vale", () => {
  assert.equal(notaNormalizada("nota", 0), 0);
  assert.equal(notaNormalizada("nota", 10), 10);
});

/* ---------- as perguntas ---------- */

const NOTA = { categoria: "Comida", pergunta: "A comida agradou?", tipo: "nota" };

test("pergunta sem categoria cai em Geral, não num grupo sem nome", () => {
  // Categoria vazia viraria um grupo "" no painel, que não diz nada a ninguém.
  const [item] = validarItens([{ pergunta: "Algo a dizer?", tipo: "nota" }]);
  assert.equal(item!.categoria, "Geral");
});

test("cada pergunta ganha um id estável", () => {
  const itens = validarItens([NOTA, { ...NOTA, pergunta: "Voltaria?" }]);
  assert.ok(itens[0]!.id);
  assert.notEqual(itens[0]!.id, itens[1]!.id);
});

test("id que já existe é preservado", () => {
  // Editar a pesquisa não pode trocar o id: as respostas antigas apontam para
  // ele, e o histórico da pergunta se perderia.
  const [item] = validarItens([{ ...NOTA, id: "abc" }]);
  assert.equal(item!.id, "abc");
});

test("tipo inventado é recusado", () => {
  // A IA alucinando um tipo novo gravaria uma pergunta que a tela do cliente
  // não sabe desenhar.
  assert.throws(() => validarItens([{ ...NOTA, tipo: "carinha" }]), /não existe/);
});

test("pergunta em branco é recusada", () => {
  assert.throws(() => validarItens([{ ...NOTA, pergunta: "   " }]), /vazio/);
});

test("pesquisa só de texto é recusada", () => {
  // Sem nenhuma nota não sai dado nenhum para acompanhar, e a tela de "como
  // andam as coisas" ficaria vazia sem ninguém entender por quê.
  assert.throws(
    () => validarItens([{ categoria: "Geral", pergunta: "Conte mais", tipo: "texto" }]),
    /ao menos uma pergunta com nota/i,
  );
});

test("pesquisa vazia é recusada", () => {
  assert.throws(() => validarItens([]), /ao menos uma pergunta/);
  assert.throws(() => validarItens(null), /ao menos uma pergunta/);
});

test("pesquisa longa demais é recusada", () => {
  // Vinte e uma perguntas no celular de quem espera a conta viram abandono.
  const muitas = Array.from({ length: 21 }, (_, i) => ({ ...NOTA, pergunta: `P${i}` }));
  assert.throws(() => validarItens(muitas), /Máximo de 20/);
});

test("obrigatório só quando dito explicitamente", () => {
  // O padrão é opcional: pergunta obrigatória demais faz a pessoa fechar a
  // aba em vez de responder.
  assert.equal(validarItens([NOTA])[0]!.obrigatorio, false);
  assert.equal(validarItens([{ ...NOTA, obrigatorio: true }])[0]!.obrigatorio, true);
});

/* ---------- a resposta da IA ---------- */

test("a IA pedindo mais contexto vira pergunta na tela", () => {
  const r = interpretarResposta('{"tipo":"pergunta","texto":"Sua casa tem palco?"}');
  assert.equal(r.tipo, "pergunta");
  assert.equal(r.tipo === "pergunta" && r.texto, "Sua casa tem palco?");
});

test("o que a IA gera passa pela MESMA porta do que a pessoa digita", () => {
  // Sem isso, a IA seria um caminho para gravar o que a validação recusaria.
  assert.throws(
    () => interpretarResposta('{"tipo":"itens","itens":[{"pergunta":"x","tipo":"emoji"}]}'),
    /não existe/,
  );
});

test("JSON embrulhado em conversa ainda é lido", () => {
  // O modelo às vezes escreve "Claro! Aqui está:" antes do JSON.
  const r = interpretarResposta(
    'Claro, aqui está:\n```json\n{"tipo":"itens","itens":[{"categoria":"Comida","pergunta":"A comida agradou?","tipo":"nota"}]}\n```',
  );
  assert.equal(r.tipo, "itens");
  assert.equal(r.tipo === "itens" && r.itens[0]!.categoria, "Comida");
});

test("resposta sem JSON nenhum vira recado, não erro de servidor", () => {
  assert.throws(() => interpretarResposta("Desculpe, não entendi."), /formato inesperado/);
  assert.throws(() => interpretarResposta("{quebrado"), /formato inesperado/);
  assert.throws(() => interpretarResposta('{"tipo":"outra_coisa"}'), /formato inesperado/);
});
