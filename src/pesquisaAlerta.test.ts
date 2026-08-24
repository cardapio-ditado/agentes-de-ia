import assert from "node:assert/strict";
import test from "node:test";
import { ehDetrator, textoDoAlerta } from "./pesquisaAlerta.js";
import type { DadosDoAlerta } from "./pesquisaAlerta.js";

/* ---------- quem dispara o aviso ---------- */

test("a régua padrão é a do NPS: 0 a 6 avisa, 7 para cima não", () => {
  for (const n of [0, 3, 5, 6]) assert.equal(ehDetrator(n, 6), true, `nota ${n}`);
  for (const n of [7, 8, 9, 10]) assert.equal(ehDetrator(n, 6), false, `nota ${n}`);
});

test("a casa pode apertar ou afrouxar a régua", () => {
  // Casa exigente quer saber de tudo abaixo de 9.
  assert.equal(ehDetrator(8, 8), true);
  // Casa que só quer os casos graves.
  assert.equal(ehDetrator(4, 3), false);
  assert.equal(ehDetrator(3, 3), true);
});

test("limite zero ainda avisa da nota zero", () => {
  // O caso que um `if (!limite)` estragaria: zero é um limite legítimo, e
  // tratá-lo como "não configurado" silenciaria justo a pior nota possível.
  assert.equal(ehDetrator(0, 0), true);
  assert.equal(ehDetrator(1, 0), false);
});

test("limite absurdo cai na régua do mercado em vez de sumir com o aviso", () => {
  for (const limite of [99, -3, Number.NaN]) {
    assert.equal(ehDetrator(6, limite), true, `limite ${limite}`);
    assert.equal(ehDetrator(7, limite), false, `limite ${limite}`);
  }
});

test("nota inválida não vira aviso", () => {
  assert.equal(ehDetrator(Number.NaN, 6), false);
});

/* ---------- o que o dono lê ---------- */

function alerta(over: Partial<DadosDoAlerta> = {}): string {
  return textoDoAlerta({
    casa: "Ditado Popular",
    nota: 3,
    ...over,
  });
}

test("a nota e a casa abrem a mensagem", () => {
  assert.match(alerta(), /^🚨 Nota 3 na pesquisa — Ditado Popular/);
});

test("o comentário do cliente vai inteiro, com as palavras dele", () => {
  // Cortar ou parafrasear a queixa de alguém é como "esperei 40 minutos e a
  // comida chegou fria" vira "o cliente reclamou de alguma coisa".
  const queixa = "Esperei 40 minutos pelo prato e ele chegou frio.";
  assert.ok(alerta({ comentario: queixa }).includes(`"${queixa}"`));
});

test("as categorias fracas aparecem, da pior para a menos pior", () => {
  const texto = alerta({
    categorias: [
      { categoria: "Ambiente", pergunta: "Como estava o som?", nota: 9 },
      { categoria: "Cozinha", pergunta: "E a comida?", nota: 2 },
      { categoria: "Atendimento", pergunta: "Foi bem atendido?", nota: 5 },
    ],
  });
  assert.match(texto, /O que puxou para baixo/);
  assert.ok(texto.indexOf("Cozinha") < texto.indexOf("Atendimento"), texto);
  // Categoria bem avaliada não entra: a lista existe para apontar o problema,
  // e encher ela do que foi bem esconde o que foi mal.
  assert.ok(!texto.includes("Ambiente"), texto);
});

test("resposta sem categoria fraca não inventa seção vazia", () => {
  const texto = alerta({
    nota: 6,
    categorias: [{ categoria: "Cozinha", pergunta: "E a comida?", nota: 10 }],
  });
  assert.ok(!/O que puxou para baixo/.test(texto), texto);
});

test("o texto escrito numa pergunta específica também chega", () => {
  // A pessoa pode não escrever no comentário geral e desabafar numa pergunta.
  const texto = alerta({
    categorias: [
      { categoria: "Cozinha", pergunta: "E a comida?", nota: 2, texto: "Veio salgada demais" },
    ],
  });
  assert.ok(texto.includes('"Veio salgada demais"'), texto);
});

test("o contato vem junto — sem ele não há recuperação", () => {
  assert.match(
    alerta({ clienteNome: "Mariana", clienteContato: "65 99999-8888" }),
    /Falar com: Mariana · 65 99999-8888/,
  );
});

test("sem contato, a mensagem diz isso em vez de omitir", () => {
  // Omitir faria o dono procurar um contato que não existe. Dizer ensina ele
  // a pedir o contato na pesquisa.
  assert.match(alerta(), /sem deixar contato/i);
});

test("a mesa localiza o problema no salão", () => {
  assert.match(alerta({ mesa: "12" }), /Mesa 12/);
});

test("nada de 'undefined' ou 'null' na tela de ninguém", () => {
  const texto = alerta({
    mesa: null,
    comentario: null,
    clienteNome: null,
    clienteContato: null,
    criticas: [],
    categorias: [],
  });
  assert.ok(!/undefined|null/.test(texto), texto);
});

test("nota fracionária de categoria sai legível", () => {
  const texto = alerta({
    categorias: [{ categoria: "Cozinha", pergunta: "E a comida?", nota: 6.5 }],
  });
  assert.match(texto, /Cozinha — 6,5/);
  assert.ok(!/6\.50/.test(texto), texto);
});

test("muitas categorias ruins não viram uma parede de texto", () => {
  const categorias = Array.from({ length: 12 }, (_, i) => ({
    categoria: `Cat ${i}`,
    pergunta: "Pergunta?",
    nota: 1,
  }));
  const linhas = alerta({ categorias }).split("\n").filter((l) => l.startsWith("• "));
  assert.equal(linhas.length, 5);
});
