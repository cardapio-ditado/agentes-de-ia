import { test } from "node:test";
import assert from "node:assert/strict";
import { podeAbrirModulo, type Sessao } from "./auth.js";

function sessao(extra: Partial<Sessao> = {}): Sessao {
  return {
    userId: "u1",
    email: "pessoa@bar.com",
    orgId: "org1",
    papel: "member",
    modulos: null,
    plataformaAdmin: false,
    senhaProvisoria: false,
    ...extra,
  };
}

test("sem restrição, abre qualquer módulo", () => {
  // Null é o padrão e mantém quem já usa o sistema exatamente como estava.
  const eu = sessao({ modulos: null });
  assert.equal(podeAbrirModulo(eu, "agentes-ia"), true);
  assert.equal(podeAbrirModulo(eu, "cmv"), true);
});

test("conferente de doca escreve, mas só no CMV", () => {
  // O caso que motivou tudo isto: precisa de conta para lançar o
  // recebimento, e não pode aprovar reserva nem ler o financeiro.
  const doca = sessao({ papel: "member", modulos: ["cmv"] });
  assert.equal(podeAbrirModulo(doca, "cmv"), true);
  assert.equal(podeAbrirModulo(doca, "agentes-ia"), false);
  assert.equal(podeAbrirModulo(doca, "avaliacoes"), false);
});

test("papel e módulo são perguntas independentes", () => {
  // Contador: só lê, e só o CMV. O papel diz o QUE; a lista diz ONDE.
  const contador = sessao({ papel: "viewer", modulos: ["cmv"] });
  assert.equal(podeAbrirModulo(contador, "cmv"), true);
  assert.equal(podeAbrirModulo(contador, "checklist"), false);
});

test("lista vazia é conta desligada, sem apagar o histórico", () => {
  const afastado = sessao({ modulos: [] });
  assert.equal(podeAbrirModulo(afastado, "cmv"), false);
  assert.equal(podeAbrirModulo(afastado, "agentes-ia"), false);
});

test("admin da plataforma passa por cima da restrição", () => {
  // A equipe Brasa Food precisa entrar em qualquer módulo para dar suporte.
  const suporte = sessao({ plataformaAdmin: true, modulos: [] });
  assert.equal(podeAbrirModulo(suporte, "cmv"), true);
  assert.equal(podeAbrirModulo(suporte, "plataforma"), true);
});

test("módulo novo contratado aparece sozinho para quem tem acesso amplo", () => {
  // O motivo de null em vez de uma lista com tudo dentro: uma lista fixa
  // precisaria ser atualizada em cada membro, e o esquecimento apareceria
  // como "o dono não vê o módulo que acabou de comprar".
  const dono = sessao({ papel: "owner", modulos: null });
  assert.equal(podeAbrirModulo(dono, "modulo-que-nem-existe-ainda"), true);
});
