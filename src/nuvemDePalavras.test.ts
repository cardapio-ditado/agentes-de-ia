import assert from "node:assert/strict";
import test from "node:test";
import { nuvemDePalavras, termosDoComentario } from "./nuvemDePalavras.js";

test("palavra vazia não entra na nuvem", () => {
  // Sem isto a nuvem de qualquer bar do Brasil é a mesma: "de", "muito", "foi".
  const t = termosDoComentario("O atendimento foi muito bom e a comida de sempre");
  for (const vazia of ["o", "foi", "muito", "de", "sempre", "a"]) {
    assert.ok(!t.includes(vazia), `"${vazia}" não deveria estar em ${t.join(",")}`);
  }
  assert.ok(t.includes("atendimento"));
  assert.ok(t.includes("comida"));
});

test("formas da mesma reclamação viram um assunto só", () => {
  // Separadas, nenhuma delas fica grande o bastante para o dono reparar.
  for (const forma of ["demorou", "demorado", "lento", "lentidão"]) {
    assert.deepEqual(termosDoComentario(forma), ["demora"]);
  }
  for (const forma of ["garçom", "garcom", "atendente"]) {
    assert.deepEqual(termosDoComentario(forma), ["atendimento"]);
  }
});

test("a mesma palavra repetida no comentário conta uma vez", () => {
  // A nuvem conta PESSOAS falando de um assunto, não teclas: senão um
  // comentário comprido domina a tela sozinho.
  assert.deepEqual(termosDoComentario("bom, muito bom, tudo bom mesmo"), ["bom"]);
});

test("número solto e palavra curta demais ficam de fora", () => {
  const t = termosDoComentario("nota 10, fui às 21h, tá ok");
  assert.ok(!t.includes("10"));
  assert.ok(!t.includes("21"));
});

test("palavra curta que é assunto de bar sobrevive ao corte", () => {
  // "som" tem três letras e é metade das reclamações de uma casa de shows.
  assert.ok(termosDoComentario("o som estava alto").includes("som"));
  assert.ok(termosDoComentario("fila enorme na entrada").includes("fila"));
});

test("acento não separa a mesma palavra em duas", () => {
  const n = nuvemDePalavras([
    { texto: "música ótima", nota: 10 },
    { texto: "musica otima", nota: 10 },
  ]);
  const musica = n.filter((t) => t.termo === "música");
  assert.equal(musica.length, 1);
  assert.equal(musica[0]!.mencoes, 2);
});

test("o tom vem da nota de quem escreveu, não da palavra", () => {
  // O ponto da nuvem: "atendimento" pode ser elogio numa casa e crítica na
  // outra, e o dono precisa ver a diferença sem ler comentário por comentário.
  const n = nuvemDePalavras([
    { texto: "demora demais para trazer", nota: 4 },
    { texto: "muita demora", nota: 3 },
    { texto: "comida maravilhosa", nota: 10 },
    { texto: "comida excelente", nota: 10 },
  ]);
  const demora = n.find((t) => t.termo === "demora");
  const comida = n.find((t) => t.termo === "comida");
  assert.equal(demora?.tom, "critica");
  assert.equal(comida?.tom, "elogio");
  assert.equal(demora?.notaMedia, 3.5);
});

test("com muitos comentários, palavra de uma pessoa só não vira assunto", () => {
  const muitos = Array.from({ length: 10 }, () => ({ texto: "comida boa", nota: 9 }));
  const n = nuvemDePalavras([...muitos, { texto: "estacionamento complicado", nota: 7 }]);
  assert.ok(n.some((t) => t.termo === "comida"));
  assert.ok(!n.some((t) => t.termo === "estacionamento"));
});

test("com poucos comentários, mostra o que tem em vez de nuvem vazia", () => {
  // Casa que acabou de ligar a pesquisa tem três respostas. Exigir duas
  // menções devolveria tela em branco, que parece defeito.
  const n = nuvemDePalavras([{ texto: "ambiente agradável", nota: 9 }]);
  assert.ok(n.length > 0);
});

test("mais falado primeiro, e a ordem não dança entre dois carregamentos", () => {
  const dados = [
    { texto: "música alta", nota: 8 },
    { texto: "música boa", nota: 9 },
    { texto: "ambiente bacana", nota: 9 },
    { texto: "ambiente legal", nota: 9 },
    { texto: "banheiro sujo", nota: 5 },
    { texto: "banheiro limpo", nota: 9 },
    { texto: "comida boa", nota: 9 },
    { texto: "comida ótima", nota: 10 },
  ];
  const a = nuvemDePalavras(dados).map((t) => `${t.termo}:${t.mencoes}`);
  const b = nuvemDePalavras([...dados].reverse()).map((t) => `${t.termo}:${t.mencoes}`);
  assert.deepEqual(a, b);
  assert.ok(a[0]!.endsWith(":2"));
});

test("comentário vazio ou nulo não quebra a nuvem", () => {
  const n = nuvemDePalavras([
    { texto: null, nota: 10 },
    { texto: "   ", nota: 10 },
    { texto: "ambiente ótimo", nota: 10 },
  ]);
  assert.ok(n.some((t) => t.termo === "ambiente"));
});

test("sem comentário nenhum, a nuvem sai vazia em vez de estourar", () => {
  assert.deepEqual(nuvemDePalavras([]), []);
});

test("o limite corta a cauda longa", () => {
  const comentarios = Array.from({ length: 60 }, (_, i) => ({
    texto: `palavra${String.fromCharCode(97 + (i % 26))}${i}`,
    nota: 9,
  }));
  assert.ok(nuvemDePalavras(comentarios, { limite: 10 }).length <= 10);
});
