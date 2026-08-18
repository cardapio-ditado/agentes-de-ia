import { test } from "node:test";
import assert from "node:assert/strict";
import { notaDoRotulo } from "./channels/googleAvaliacoes.js";

/**
 * A nota vem de um aria-label em texto livre, que muda com o idioma da conta e
 * com as reformas da interface. Ler errado é grave dos dois lados: nota alta
 * lida como baixa entope a fila, e nota baixa lida como alta publica resposta
 * automática justamente onde isso não pode acontecer.
 */
test("lê a nota nos formatos que o Google usa", () => {
  assert.equal(notaDoRotulo("Classificado como 4 de 5"), 4);
  assert.equal(notaDoRotulo("Rated 2.0 out of 5"), 2);
  assert.equal(notaDoRotulo("5 de 5 estrelas"), 5);
  assert.equal(notaDoRotulo("1 estrela"), 1);
});

test("recusa o que não consegue ler, em vez de chutar", () => {
  // Chutar aqui significaria publicar resposta automática numa avaliação cuja
  // nota ninguém sabe. Sem nota, a avaliação é pulada.
  assert.equal(notaDoRotulo(null), null);
  assert.equal(notaDoRotulo(""), null);
  assert.equal(notaDoRotulo("Muito bom"), null);
  assert.equal(notaDoRotulo("Classificado como 9 de 5"), null);
  assert.equal(notaDoRotulo("0 de 5"), null);
});
