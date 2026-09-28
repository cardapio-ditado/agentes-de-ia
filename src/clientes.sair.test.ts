import assert from "node:assert/strict";
import test from "node:test";
import { despedidaDoDescadastro, pediuParaSair } from "./clientes.js";

test("reconhece o pedido de sair como gente escreve", () => {
  for (const t of ["SAIR", "sair", "Sair.", "  parar ", "PARE!", "stop", "cancelar", "não quero receber mais", "nao quero mensagem", "Remover"]) {
    assert.equal(pediuParaSair(t), true, t);
  }
});

test("não confunde conversa normal com descadastro", () => {
  // "sair" no meio da frase é gente falando da vida, não do WhatsApp.
  for (const t of ["quero sair cedo hoje, tem mesa?", "vou parar aí depois do trabalho", "oi", "", null, "cancelar minha reserva de sábado"]) {
    assert.equal(pediuParaSair(t), false, String(t));
  }
});

test("a despedida usa o primeiro nome e não tenta segurar", () => {
  assert.equal(despedidaDoDescadastro("Bruno Camargo"), "Pronto, Bruno. Você não vai mais receber mensagens da casa por aqui. Se mudar de ideia, é só escrever.");
  assert.match(despedidaDoDescadastro(null), /^Pronto\. /);
});
