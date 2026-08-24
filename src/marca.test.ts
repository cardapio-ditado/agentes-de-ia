import assert from "node:assert/strict";
import test from "node:test";
import {
  TEXTO_CLARO,
  TEXTO_ESCURO,
  corLegivelNoEscuro,
  corValida,
  extensaoDaLogo,
  fundoDaCasa,
  luminancia,
  textoSobre,
} from "./marca.js";

/* ---------- a cor que a casa digitou ---------- */

test("a cerquilha é opcional — ninguém decora isso", () => {
  assert.equal(corValida("#f4a100"), "#f4a100");
  assert.equal(corValida("f4a100"), "#f4a100");
  assert.equal(corValida("  #F4A100  "), "#f4a100");
});

test("a forma curta vira a longa", () => {
  assert.equal(corValida("#fa1"), "#ffaa11");
  assert.equal(corValida("000"), "#000000");
});

test("o que não é cor vira null, não vira cor inventada", () => {
  // Null significa "usa o padrão da Brasa". Chutar uma cor a partir de um
  // texto qualquer pintaria a pesquisa de uma cor que a casa nunca escolheu.
  for (const lixo of ["azul", "#12345", "#gggggg", "", null, undefined, "rgb(1,2,3)"]) {
    assert.equal(corValida(lixo), null, String(lixo));
  }
});

/* ---------- o contraste: onde personalizar vira estragar ---------- */

test("cor escura pede letra clara", () => {
  for (const cor of ["#191110", "#1a2b4c", "#7d1128", "#c1121f", "#004400"]) {
    assert.equal(textoSobre(cor), TEXTO_CLARO, cor);
  }
});

test("cor clara pede letra ESCURA — este é o teste que importa", () => {
  // O bar que escolhe amarelo-ouro ganharia um botão amarelo com letra branca
  // por cima: invisível ao sol da varanda, que é justamente onde o cliente
  // responde a pesquisa. A casa não tem como saber disso; o sistema tem.
  for (const cor of ["#ffc857", "#f4e04d", "#ffffff", "#e8f5a2", "#c9f0d8"]) {
    assert.equal(textoSobre(cor), TEXTO_ESCURO, cor);
  }
});

test("o laranja da Brasa continua com letra escura, como sempre foi", () => {
  // O caso que denunciou o limiar errado. #ff6b35 tem luminância 0,32: um
  // corte "no meio da faixa" pediria letra branca por cima, que dá 2,8:1 e é
  // ilegível. O botão laranja deste sistema sempre teve texto escuro, e uma
  // conta razoável-por-fora teria invertido isso na primeira casa que
  // escolhesse uma cor quente.
  assert.equal(textoSobre("#ff6b35"), TEXTO_ESCURO);
  assert.ok(luminancia("#ff6b35") > 0.179);
});

test("as cores quentes escuras seguem com letra clara", () => {
  // O outro lado do mesmo corte: vinho e fogo são quentes mas escuros.
  assert.equal(textoSobre("#7d1128"), TEXTO_CLARO);
  assert.equal(textoSobre("#c1121f"), TEXTO_CLARO);
});

test("o verde e o azul de mesma intensidade não recebem o mesmo tratamento", () => {
  // A média simples dos canais diria que sim. O olho enxerga muito mais verde
  // que azul, e é por isso que a conta é a do WCAG e não uma média.
  assert.ok(luminancia("#00ff00") > luminancia("#0000ff"));
  assert.equal(textoSobre("#00ff00"), TEXTO_ESCURO);
  assert.equal(textoSobre("#0000ff"), TEXTO_CLARO);
});

test("sem cor escolhida, o texto é o claro do tema da pesquisa", () => {
  assert.equal(textoSobre(null), TEXTO_CLARO);
  assert.equal(textoSobre("nao é cor"), TEXTO_CLARO);
});

test("preto e branco são os extremos e não podem errar", () => {
  assert.equal(textoSobre("#000000"), TEXTO_CLARO);
  assert.equal(textoSobre("#ffffff"), TEXTO_ESCURO);
});

/* ---------- a cor como traço sobre o escuro ---------- */

test("cor escura demais é clareada até dar para enxergar", () => {
  // O bar de identidade azul-marinho pintaria a trilha de progresso de uma cor
  // quase idêntica ao fundo. A trilha é o que diz à pessoa que a pesquisa está
  // andando; sumida, a pesquisa parece travada.
  const contraste = (a: string, b: string) => {
    const la = luminancia(a);
    const lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  for (const cor of ["#1a2b4c", "#0b3d2e", "#191110", "#000000", "#2b0a0a"]) {
    const legivel = corLegivelNoEscuro(cor)!;
    assert.ok(legivel, cor);
    assert.ok(
      contraste(legivel, "#191110") >= 2.9,
      `${cor} virou ${legivel}, contraste ${contraste(legivel, "#191110").toFixed(2)}`,
    );
  }
});

test("cor que já dá contraste não é mexida", () => {
  // Clarear o que já está bom desbotaria a marca da casa sem motivo.
  assert.equal(corLegivelNoEscuro("#ff6b35"), "#ff6b35");
  assert.equal(corLegivelNoEscuro("#ffc857"), "#ffc857");
});

test("o tom é preservado ao clarear", () => {
  // Azul tem que continuar azul. Clarear até o cinza resolveria o contraste e
  // apagaria a identidade da casa, que é o motivo de o campo existir.
  const claro = corLegivelNoEscuro("#0b1d4c")!;
  const azul = parseInt(claro.slice(5, 7), 16);
  const vermelho = parseInt(claro.slice(1, 3), 16);
  assert.ok(azul > vermelho, `esperava azul dominante, veio ${claro}`);
});

test("sem cor, não há cor clareada", () => {
  assert.equal(corLegivelNoEscuro(null), null);
  assert.equal(corLegivelNoEscuro("verde"), null);
});

/* ---------- o fundo tingido ---------- */

test("o fundo continua escuro mesmo com cor clara da casa", () => {
  // A pesquisa é respondida à noite, num salão de luz baixa. Tela branca na
  // cara do cliente é agressiva — a cor da casa tinge, não clareia.
  const fundo = fundoDaCasa("#ffffff");
  assert.ok(luminancia(fundo) < 0.2, `fundo ficou claro demais: ${fundo}`);
});

test("o fundo muda de verdade quando há cor", () => {
  assert.notEqual(fundoDaCasa("#00ff00"), fundoDaCasa(null));
});

test("sem cor, o fundo é exatamente o padrão", () => {
  assert.equal(fundoDaCasa(null), "#191110");
  assert.equal(fundoDaCasa("banana"), "#191110");
});

test("o fundo é sempre hexadecimal de 6 dígitos", () => {
  // Um canal que vire "f" em vez de "0f" produz "#f1110" — cor inválida que o
  // navegador ignora em silêncio, e a página aparece sem fundo nenhum.
  for (const cor of ["#000000", "#ffffff", "#010203", "#00ff00"]) {
    assert.match(fundoDaCasa(cor), /^#[0-9a-f]{6}$/, cor);
  }
});

/* ---------- o arquivo da logo ---------- */

test("os formatos de imagem que servem", () => {
  assert.equal(extensaoDaLogo("image/png"), "png");
  assert.equal(extensaoDaLogo("image/jpeg"), "jpg");
  assert.equal(extensaoDaLogo("image/webp"), "webp");
  assert.equal(extensaoDaLogo("image/svg+xml"), "svg");
});

test("o content-type com charset ainda é aceito", () => {
  // O navegador manda "image/svg+xml; charset=utf-8" e recusar isso seria
  // recusar SVG na prática.
  assert.equal(extensaoDaLogo("image/svg+xml; charset=utf-8"), "svg");
  assert.equal(extensaoDaLogo("IMAGE/PNG"), "png");
});

test("o que não é logo é recusado", () => {
  // GIF fora: logo animada numa pesquisa é distração. PDF fora porque é o que
  // a pessoa manda quando confunde "logo" com o arquivo que o designer mandou.
  for (const tipo of ["image/gif", "application/pdf", "text/html", "", null, undefined]) {
    assert.equal(extensaoDaLogo(tipo), null, String(tipo));
  }
});
