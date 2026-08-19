import { test } from "node:test";
import assert from "node:assert/strict";
import { ErroDoEstoque, traduzir } from "./estoque.js";

/**
 * As funções do banco levantam exceções com nome curto — boas para casar em
 * código, péssimas para ler numa tela às 22h na doca. Estes testes garantem
 * que ninguém veja "P0001: nada_conferido".
 */

function mensagemDe(bruto: string): { status: number; texto: string } {
  const e = traduzir({ message: bruto });
  assert.ok(e instanceof ErroDoEstoque);
  return { status: e.status, texto: e.message };
}

test("compra recebida duas vezes explica por que não repete", () => {
  const r = mensagemDe('erro: compra_ja_recebida');
  assert.equal(r.status, 409);
  assert.match(r.texto, /não é lançado duas vezes/i);
  assert.doesNotMatch(r.texto, /compra_ja_recebida/);
});

test("receber sem conferir diz o que fazer, não o que falhou", () => {
  const r = mensagemDe("P0001: nada_conferido");
  assert.equal(r.status, 400);
  assert.match(r.texto, /Confira ao menos um item/i);
});

test("ficha da IA sem conferência explica a razão da recusa", () => {
  const r = mensagemDe("ficha_nao_confirmada");
  assert.match(r.texto, /sugestão/i);
  assert.match(r.texto, /antes de produzir/i);
});

test("nome duplicado avisa da consequência, não só do erro", () => {
  // O motivo de não deixar duplicar é o que a pessoa precisa entender: dois
  // cadastros do mesmo insumo viram dois saldos, como aconteceu no Gorjeta.
  const r = mensagemDe('duplicate key value violates unique constraint "insumos_venue_id_nome_normalizado_key"');
  assert.equal(r.status, 409);
  assert.match(r.texto, /dois saldos/i);
});

test("módulo não instalado manda rodar a migração", () => {
  const r = mensagemDe('relation "public.insumos" does not exist');
  assert.equal(r.status, 503);
  assert.match(r.texto, /migração/i);
});

test("pedido já enviado é conflito, não erro de digitação", () => {
  assert.equal(mensagemDe("pedido_nao_esta_em_rascunho").status, 409);
});

test("erro desconhecido não é engolido nem disfarçado", () => {
  // Inventar uma mensagem amigável para o que não se conhece esconde o
  // problema de quem poderia consertá-lo.
  const r = mensagemDe("connection reset by peer");
  assert.equal(r.status, 500);
  assert.equal(r.texto, "connection reset by peer");
});

test("erro sem mensagem ainda produz algo utilizável", () => {
  const r = traduzir({});
  assert.equal(r.status, 500);
  assert.ok(r.message.length > 0);
});
