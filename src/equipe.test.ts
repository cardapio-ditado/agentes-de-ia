import assert from "node:assert/strict";
import test from "node:test";
import { PAPEIS, podeGerirEquipe } from "./equipe.js";

/**
 * Quem pode mexer em acessos.
 *
 * A regra parece óbvia até o dia em que um garçom com login de operação
 * consegue se promover a gerente. O servidor confere antes de qualquer
 * escrita; esconder o botão na tela é conveniência, não é a trava.
 */

test("dono e gerente mexem em acessos", () => {
  assert.equal(podeGerirEquipe("owner", false), true);
  assert.equal(podeGerirEquipe("admin", false), true);
});

test("operação e leitura não mexem em acessos", () => {
  assert.equal(podeGerirEquipe("member", false), false);
  assert.equal(podeGerirEquipe("viewer", false), false);
});

test("papel desconhecido não mexe em nada", () => {
  // Papel que não existe é papel que ninguém revisou: negar é o padrão certo.
  assert.equal(podeGerirEquipe("", false), false);
  assert.equal(podeGerirEquipe("garcom", false), false);
});

test("admin da plataforma mexe mesmo sem papel na casa", () => {
  // É como o suporte resolve "perdi o acesso do dono" sem pedir senha.
  assert.equal(podeGerirEquipe("", true), true);
});

test("todo papel tem nome e explicação em português", () => {
  // A tela mostra a descrição embaixo do seletor: papel sem explicação faz o
  // dono escolher no chute e dar acesso demais.
  for (const p of PAPEIS) {
    assert.ok(p.nome.length > 2, `${p.id} sem nome`);
    assert.ok(p.descricao.length > 10, `${p.id} sem descrição`);
  }
});

test("dono existe na lista, mas a tela não o oferece", () => {
  // Promover alguém a dono daria a ele o poder de remover o próprio dono.
  // O papel existe para ser EXIBIDO (a linha do dono na tabela), não escolhido.
  assert.ok(PAPEIS.some((p) => p.id === "owner"));
});
