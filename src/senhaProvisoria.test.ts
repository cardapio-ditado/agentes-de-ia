import assert from "node:assert/strict";
import test from "node:test";
import { semMarcaDeProvisoria } from "./auth.js";

/**
 * O bug que estes testes guardam: a versão anterior fazia `delete` da chave
 * num objeto local e mandava o resto para o Supabase. Como o update do admin
 * MESCLA os metadados em vez de substituí-los, a chave ausente no envio não
 * apagava nada — a marca sobrevivia à troca, e o painel exigia trocar a senha
 * de novo, e de novo, para sempre.
 */

test("a marca sai como null explícito, e não por ausência da chave", () => {
  // Omitir a chave é exatamente o que NÃO funciona num update que mescla.
  const r = semMarcaDeProvisoria({ nome: "Ana", senha_provisoria: true });
  assert.ok("senha_provisoria" in r, "a chave precisa ir no envio para apagar a de lá");
  assert.equal(r.senha_provisoria, null);
});

test("o resultado nunca é lido como provisório", () => {
  // A leitura em todo o sistema é `=== true`. Isto vale tanto se o servidor
  // mesclar (null apaga) quanto se substituir (null não é true).
  for (const antes of [
    { senha_provisoria: true },
    { senha_provisoria: "true" },
    { senha_provisoria: 1 },
    {},
    null,
    undefined,
  ]) {
    assert.equal(semMarcaDeProvisoria(antes).senha_provisoria === true, false);
  }
});

test("o resto dos metadados sobrevive", () => {
  // `user_metadata` guarda o nome da pessoa e o do restaurante; perdê-los na
  // troca de senha apagaria de quem é a conta.
  const r = semMarcaDeProvisoria({
    nome: "Ana Paula",
    nome_do_restaurante: "Ditado Popular",
    senha_provisoria: true,
  });
  assert.equal(r.nome, "Ana Paula");
  assert.equal(r.nome_do_restaurante, "Ditado Popular");
});

test("conta sem metadados nenhum não quebra a troca", () => {
  assert.deepEqual(semMarcaDeProvisoria(null), { senha_provisoria: null });
  assert.deepEqual(semMarcaDeProvisoria(undefined), { senha_provisoria: null });
});

test("não altera o objeto que veio do Supabase", () => {
  // Mexer no objeto original faria a marca sumir da leitura em memória mesmo
  // quando a gravação falhasse — e o servidor passaria a achar que resolveu.
  const original = { nome: "Ana", senha_provisoria: true };
  semMarcaDeProvisoria(original);
  assert.equal(original.senha_provisoria, true);
});
