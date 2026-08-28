import assert from "node:assert/strict";
import test from "node:test";
import {
  categoriasEmAlerta,
  ehDetrator,
  mediaDaExperiencia,
  mereceAviso,
  perguntasEmAlerta,
  textoDoAlerta,
} from "./pesquisaAlerta.js";
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

test("as categorias em alerta aparecem, da pior para a menos pior", () => {
  const texto = alerta({
    categorias: [
      { categoria: "Ambiente", pergunta: "Como estava o som?", nota: 9 },
      { categoria: "Cozinha", pergunta: "E a comida?", nota: 2 },
      { categoria: "Atendimento", pergunta: "Foi bem atendido?", nota: 5 },
    ],
  });
  assert.match(texto, /Categorias em alerta/);
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
  assert.ok(!/Categorias em alerta/.test(texto), texto);
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
    categorias: [{ categoria: "Cozinha", pergunta: "E a comida?", nota: 5.5 }],
  });
  assert.match(texto, /Cozinha — 5,5/);
  assert.ok(!/5\.50/.test(texto), texto);
});

test("muitas categorias ruins não viram uma parede de texto", () => {
  const categorias = Array.from({ length: 12 }, (_, i) => ({
    categoria: `Cat ${i}`,
    pergunta: "Pergunta?",
    nota: 1,
  }));
  const linhas = alerta({ categorias }).split("\n").filter((l) => l.startsWith("• "));
  assert.equal(linhas.length, 6);
});

/* ---------- a média da experiência ---------- */

const cat = (categoria: string, nota: number | null, pergunta = "Pergunta?") => ({
  categoria,
  pergunta,
  nota,
});

test("a média soma tudo o que o cliente pontuou", () => {
  assert.equal(mediaDaExperiencia([cat("Comida", 8), cat("Bar", 6)]), 7);
});

test("pergunta sem nota não entra na média", () => {
  // A pergunta escrita ("deixe um recado") não pontua. Contá-la como zero
  // afundaria a média de quem escreveu um elogio.
  assert.equal(mediaDaExperiencia([cat("Comida", 8), cat("Comida", null)]), 8);
});

test("sem nota nenhuma, a média é null e não zero", () => {
  // Zero significaria péssimo. Null significa "não há o que medir".
  assert.equal(mediaDaExperiencia([]), null);
  assert.equal(mediaDaExperiencia([cat("Recado", null)]), null);
});

test("a média sai com uma casa decimal", () => {
  assert.equal(mediaDaExperiencia([cat("A", 1), cat("B", 2), cat("C", 2)]), 1.7);
});

/* ---------- quais categorias estão em alerta ---------- */

test("a categoria é julgada pela MÉDIA dela, não por uma pergunta", () => {
  // Duas perguntas de Comida: 2 e 10. A média é 6 — no limite, entra.
  // Julgar pergunta a pergunta avisaria de um assunto que vai bem.
  assert.deepEqual(
    categoriasEmAlerta([cat("Comida", 2), cat("Comida", 10)], 6),
    [{ categoria: "Comida", media: 6 }],
  );
  assert.deepEqual(categoriasEmAlerta([cat("Comida", 4), cat("Comida", 10)], 6), []);
});

test("as piores primeiro — é a ordem em que se resolve", () => {
  const alerta = categoriasEmAlerta([cat("Bar", 5), cat("Cozinha", 1), cat("Salão", 3)], 6);
  assert.deepEqual(alerta.map((c) => c.categoria), ["Cozinha", "Salão", "Bar"]);
});

test("categoria boa não entra no alerta", () => {
  assert.deepEqual(categoriasEmAlerta([cat("Comida", 9), cat("Bar", 10)], 6), []);
});

test("a régua da casa vale para as categorias também", () => {
  assert.equal(categoriasEmAlerta([cat("Comida", 7)], 6).length, 0);
  assert.equal(categoriasEmAlerta([cat("Comida", 7)], 8).length, 1);
});

/* ---------- quem merece aviso ---------- */

test("nota de recomendação no chão avisa, mesmo com categorias boas", () => {
  assert.equal(mereceAviso({ nota: 3, categorias: [cat("Comida", 10)], limite: 6 }), true);
});

test("CATEGORIA no chão avisa, mesmo com nota de recomendação alta", () => {
  // O caso que o aviso por nota deixava passar: o cliente que indicaria a casa
  // — "o lugar é bom" — e mesmo assim esperou quarenta minutos. É o mais fácil
  // de recuperar, porque o problema é pontual e tem nome.
  assert.equal(
    mereceAviso({ nota: 9, categorias: [cat("Tempo de espera", 2)], limite: 6 }),
    true,
  );
});

test("tudo bem avaliado não vira aviso", () => {
  // O outro lado: aviso demais é indistinguível de aviso nenhum, porque os
  // dois terminam com a conversa silenciada.
  assert.equal(
    mereceAviso({ nota: 10, categorias: [cat("Comida", 9), cat("Bar", 8)], limite: 6 }),
    false,
  );
});

test("resposta só com a nota, sem categorias, ainda é julgada pela nota", () => {
  assert.equal(mereceAviso({ nota: 4, categorias: [], limite: 6 }), true);
  assert.equal(mereceAviso({ nota: 9, categorias: [], limite: 6 }), false);
});

/* ---------- o aviso conta qual é o caso ---------- */

test("nota alta com categoria ruim abre dizendo a categoria, não a nota", () => {
  // "🚨 Nota 9" faria o dono abrir achando que erramos a conta.
  const texto = textoDoAlerta({
    casa: "Ditado Popular",
    nota: 9,
    limite: 6,
    categorias: [cat("Tempo de espera", 2), cat("Comida", 9)],
  });
  assert.match(texto, /^⚠️ Tempo de espera com nota baixa/);
  assert.match(texto, /deu 9 na recomendação/);
  assert.ok(!texto.startsWith("🚨"), texto);
});

test("nota no chão continua abrindo como alarme", () => {
  const texto = textoDoAlerta({ casa: "Ditado Popular", nota: 2, limite: 6, categorias: [] });
  assert.match(texto, /^🚨 Nota 2 na pesquisa/);
});

test("o aviso nomeia TODAS as categorias em alerta", () => {
  const texto = textoDoAlerta({
    casa: "Ditado Popular",
    nota: 2,
    limite: 6,
    categorias: [cat("Cozinha", 1, "E a comida?"), cat("Salão", 3), cat("Ambiente", 9)],
  });
  assert.match(texto, /Categorias em alerta/);
  assert.match(texto, /• Cozinha — 1 \(E a comida\?\)/);
  assert.match(texto, /• Salão — 3/);
  // A que vai bem não aparece: a lista existe para apontar o problema.
  assert.ok(!texto.includes("Ambiente"), texto);
});

test("a média da experiência vai no aviso", () => {
  const texto = textoDoAlerta({
    casa: "Ditado Popular",
    nota: 2,
    limite: 6,
    categorias: [cat("Cozinha", 2), cat("Bar", 4)],
  });
  assert.match(texto, /Média da experiência: 3 de 10/);
});

test("várias categorias viram um título legível", () => {
  const texto = textoDoAlerta({
    casa: "Ditado Popular",
    nota: 9,
    limite: 6,
    categorias: [cat("Cozinha", 1), cat("Salão", 2), cat("Bar", 3), cat("Música", 4)],
  });
  assert.match(texto, /^⚠️ Cozinha, Salão e mais 2 com nota baixa/);
});

/* ---------- a terceira porta: uma pergunta sozinha no chão ---------- */

/**
 * O CASO DO THIAGO, 28/08/2026.
 *
 * Nota 9 na recomendação, 8,6 de experiência — e, no meio disso, 5 em "a
 * reposição das carnes acompanhou o ritmo da sua mesa?" e 5 em "percebeu um
 * gerente presente no salão?". Escreveu que faltou petisco 35 minutos antes
 * do fim do rodízio e que não conseguiu se divertir.
 *
 * Ninguém foi avisado. A média de Comida deu 7, a de Atendimento deu 8, e as
 * duas passaram longe do corte de 6. O cliente disse exatamente o que estava
 * errado e a média engoliu.
 */
const THIAGO: DadosDoAlerta["categorias"] = [
  { categoria: "Comida", pergunta: "O quanto a reposição das carnes e do chopp acompanhou o ritmo da sua mesa?", nota: 5 },
  { categoria: "Comida", pergunta: "O quanto a comida entregou o que você esperava?", nota: 8 },
  { categoria: "Comida", pergunta: "O quanto ficou claro a diferença entre o rodízio tradicional e o premium?", nota: 8 },
  { categoria: "Atendimento", pergunta: "O quanto você foi bem recebido e acomodado quando chegou?", nota: 9 },
  { categoria: "Atendimento", pergunta: "O quanto o garçom te ajudou a escolher, em vez de só anotar o pedido?", nota: 10 },
  { categoria: "Atendimento", pergunta: "O quanto você percebeu um gerente ou responsável presente no salão?", nota: 5 },
  { categoria: "Tempo de espera", pergunta: "O quanto sua primeira bebida chegou rápido?", nota: 8 },
  { categoria: "NPS", pergunta: "De 0 a 10, o quanto você indicaria o Ditado Popular?", nota: 9 },
];

test("nenhuma categoria do Thiago cai — é por isso que a terceira porta existe", () => {
  // Comida: (5+8+8)/3 = 7. Atendimento: (9+10+5)/3 = 8. Nenhuma no corte.
  assert.deepEqual(categoriasEmAlerta(THIAGO, 6), []);
});

test("as perguntas no chão aparecem, da pior para a menos pior", () => {
  const ruins = perguntasEmAlerta(THIAGO, 6);
  assert.equal(ruins.length, 2);
  for (const p of ruins) assert.equal(p.nota, 5);
  assert.ok(ruins.every((p) => p.pergunta.length > 10), "a pergunta inteira vem junto");
});

test("o Thiago agora dispara aviso — nota 9, categorias boas, duas perguntas em 5", () => {
  assert.equal(mereceAviso({ nota: 9, categorias: THIAGO, limite: 6 }), true);
});

test("cliente que foi bem em tudo continua sem gerar aviso", () => {
  // A terceira porta não pode virar "avisa sempre": aviso que chega todo dia
  // é aviso que ninguém abre.
  const feliz = THIAGO.map((c) => ({ ...c, nota: 9 }));
  assert.equal(mereceAviso({ nota: 10, categorias: feliz, limite: 6 }), false);
});

test("a régua da pergunta é a mesma da casa", () => {
  const um = [{ categoria: "Comida", pergunta: "O prato saiu no tempo?", nota: 7 }];
  assert.equal(mereceAviso({ nota: 10, categorias: um, limite: 6 }), false);
  // Casa exigente que quer saber de tudo abaixo de 8.
  assert.equal(mereceAviso({ nota: 10, categorias: um, limite: 7 }), true);
});

test("o aviso do Thiago diz QUAL pergunta — senão não dá para agir", () => {
  const texto = textoDoAlerta({ casa: "Ditado Popular", nota: 9, categorias: THIAGO, limite: 6 });

  // O título não pode dizer "nota 9": o dono abriria achando erro de conta.
  assert.ok(texto.includes("2 pontos com nota baixa"), texto);
  assert.ok(texto.includes("Ditado Popular"), texto);
  // E as duas perguntas, com a nota, para o gerente saber o que conferir hoje.
  assert.ok(texto.includes("reposição das carnes"), texto);
  assert.ok(texto.includes("gerente ou responsável presente no salão"), texto);
});

test("categoria no chão não repete a pergunta na lista de baixo", () => {
  // Quando a categoria inteira já aparece em "Categorias em alerta", repetir
  // as perguntas dela embaixo faria o aviso dizer a mesma coisa duas vezes.
  const tudoRuim = [
    { categoria: "Comida", pergunta: "O prato saiu no tempo?", nota: 2 },
    { categoria: "Comida", pergunta: "A comida entregou o que esperava?", nota: 3 },
  ];
  const texto = textoDoAlerta({ casa: "Ditado", nota: 3, categorias: tudoRuim, limite: 6 });
  assert.ok(texto.includes("Categorias em alerta"), texto);
  assert.ok(!texto.includes("Notas baixas em:"), texto);
});
