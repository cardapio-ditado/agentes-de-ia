import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pareceSenhaInicial, senhaLegivel } from "./senhaInicial.js";

/**
 * A trava "não repita a senha ditada" vivia num regex solto em auth.ts, e
 * mudar o formato do sorteio quebrou a trava sem nenhum teste reclamar. Este
 * é o teste que faltava: o que o sorteio gera, a trava reconhece.
 */
describe("pareceSenhaInicial", () => {
  it("reconhece tudo que o sorteio de hoje gera", () => {
    for (let i = 0; i < 300; i++) assert.ok(pareceSenhaInicial(senhaLegivel()));
  });

  it("reconhece o formato antigo — ainda tem gente com ele", () => {
    assert.ok(pareceSenhaInicial("brasa-4821"));
    assert.ok(pareceSenhaInicial("  Tempero-1000 "));
  });

  it("não barra senha de verdade", () => {
    for (const s of ["minha-senha-forte", "brasa-forno-12345", "brasa-4821x", "cerveja-gelada-2024", "Xk9#mP2q"]) {
      assert.equal(pareceSenhaInicial(s), false, s);
    }
  });
});

/**
 * Senha inicial tem duas exigências que puxam para lados opostos: ser fácil de
 * DITAR e difícil de ADIVINHAR. Estes testes prendem as duas — porque é fácil
 * "melhorar" uma delas amanhã e quebrar a outra sem perceber.
 */
describe("senhaLegivel", () => {
  it("tem o formato que dá para ditar por telefone", () => {
    for (let i = 0; i < 200; i++) {
      // Duas palavras sem acento e quatro dígitos. Acento ao telefone vira
      // dúvida ("carvão é com til?") e dúvida vira ligação de suporte.
      assert.match(senhaLegivel(), /^[a-z]+-[a-z]+-\d{4}$/);
    }
  });

  it("não repete a mesma palavra duas vezes", () => {
    // "brasa-brasa-4821" é digitado como "brasa-4821" com frequência — e
    // encolhe o sorteio sem que ninguém veja.
    for (let i = 0; i < 500; i++) {
      const [a, b] = senhaLegivel().split("-");
      assert.notEqual(a, b);
    }
  });

  it("o espaço de sorteio é largo — não são 72 mil como antes", () => {
    // O defeito que este arquivo existe para fechar: o sorteio antigo tinha
    // 72 mil combinações, e o novo tem 8,9 milhões.
    //
    // Exigir ZERO repetição seria um teste que falha sozinho de vez em quando
    // (aniversário: em 500 sorteios de 8,9 milhões, ~1,7% das rodadas repetem
    // alguma). Teste que falha à toa é teste que o time aprende a ignorar.
    //
    // A margem é o que separa os dois espaços com folga: em 5.000 sorteios, o
    // antigo repetiria umas 173 vezes e o novo repete ~1. Cortar em 50 reprova
    // o antigo sempre e aprova o novo sempre.
    const vistas = new Set<string>();
    for (let i = 0; i < 5000; i++) vistas.add(senhaLegivel());
    assert.ok(vistas.size >= 4950, `só ${vistas.size} senhas diferentes em 5000 sorteios`);
  });

  it("usa a lista inteira de palavras, e não um cantinho dela", () => {
    // Um erro de índice que sorteie sempre entre as 4 primeiras passaria em
    // todos os testes acima e destruiria a senha em silêncio.
    const palavras = new Set<string>();
    for (let i = 0; i < 800; i++) {
      const [a, b] = senhaLegivel().split("-");
      palavras.add(a!);
      palavras.add(b!);
    }
    assert.ok(palavras.size >= 30, `só ${palavras.size} palavras diferentes em 1600 sorteios`);
  });

  it("usa a faixa inteira dos quatro dígitos", () => {
    // Sem zero à esquerda (senha que começa com 0 some no Excel de quem
    // anota) e sem passar de 9999.
    let menor = 9999;
    let maior = 1000;
    for (let i = 0; i < 800; i++) {
      const n = Number(senhaLegivel().split("-")[2]);
      assert.ok(n >= 1000 && n <= 9999, String(n));
      menor = Math.min(menor, n);
      maior = Math.max(maior, n);
    }
    assert.ok(menor < 2000 && maior > 9000, `faixa curta: ${menor}–${maior}`);
  });
});
