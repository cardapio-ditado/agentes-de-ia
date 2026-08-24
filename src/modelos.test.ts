import assert from "node:assert/strict";
import test from "node:test";
import { modeloDaTarefa } from "./modelos.js";

test("sem variável de ambiente, toda tarefa usa o padrão", () => {
  delete process.env.MODELO_AVALIACOES;
  assert.equal(modeloDaTarefa("avaliacoes"), "claude-sonnet-5");
});

test("a variável de ambiente sobrescreve, por tarefa", () => {
  // O motivo de o arquivo existir: testar um modelo mais barato numa tarefa
  // vira configuração na Vercel, não deploy — e voltar é apagar a variável.
  process.env.MODELO_LER_PROGRAMACAO = "claude-haiku-4-5";
  try {
    assert.equal(modeloDaTarefa("lerProgramacao"), "claude-haiku-4-5");
    // As outras tarefas não mudam junto.
    assert.equal(modeloDaTarefa("checklists"), "claude-sonnet-5");
  } finally {
    delete process.env.MODELO_LER_PROGRAMACAO;
  }
});

test("variável vazia ou só espaço não vale como escolha", () => {
  // Um `MODELO_PESQUISA=` esquecido num .env mandaria "" para a API, que
  // responderia 400 no meio de uma conversa de montagem.
  process.env.MODELO_PESQUISA = "   ";
  try {
    assert.equal(modeloDaTarefa("pesquisa"), "claude-sonnet-5");
  } finally {
    delete process.env.MODELO_PESQUISA;
  }
});

test("a leitura é a cada chamada, não congelada no carregamento", () => {
  // Na Vercel a variável pode mudar sem o processo reiniciar do zero. Um valor
  // lido uma vez faria a troca "não funcionar" sem pista nenhuma.
  assert.equal(modeloDaTarefa("treinamento"), "claude-sonnet-5");
  process.env.MODELO_TREINAMENTO = "claude-haiku-4-5";
  try {
    assert.equal(modeloDaTarefa("treinamento"), "claude-haiku-4-5");
  } finally {
    delete process.env.MODELO_TREINAMENTO;
  }
});
