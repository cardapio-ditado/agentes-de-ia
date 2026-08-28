import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ehMigracaoPendente } from "./supabase.js";

/**
 * A REGRA QUE JÁ CUSTOU DUAS DEPURAÇÕES.
 *
 * O código sobe antes do SQL rodar, sempre — a Vercel publica a cada push e a
 * migração é um SQL que alguém cola no Supabase depois. Por isso cada leitura
 * de tabela nova precisa aguentar a ausência dela. O jeito antigo de fazer
 * isso era procurar o nome da tabela na mensagem de erro:
 *
 *     if (/clientes|42P01|PGRST/i.test(error.message)) return;
 *
 * Só que "clientes" aparece em TODO erro daquela tabela. O filtro criado para
 * tolerar migração pendente passou a engolir o defeito real: a varredura da
 * Zig quebrou, não escreveu uma linha no log, e a base ficou vazia por uma
 * tarde inteira enquanto todo mundo procurava no lugar errado.
 *
 * Estes testes existem para que ninguém volte a testar pelo nome.
 */

describe("ehMigracaoPendente", () => {
  it("reconhece tabela que ainda não existe", () => {
    for (const m of [
      'relation "public.clientes_visitas" does not exist',
      'ERRO: 42P01: relation "clientes" does not exist',
      "Could not find the table 'public.clientes_visitas' in the schema cache",
      "PGRST205",
    ]) {
      assert.equal(ehMigracaoPendente(m), true, m);
    }
  });

  it("reconhece coluna que ainda não existe", () => {
    for (const m of [
      'column "papel" of relation "notifications" does not exist',
      "42703",
      "Could not find the 'papel' column of 'notifications' in the schema cache",
      "PGRST204",
    ]) {
      assert.equal(ehMigracaoPendente(m), true, m);
    }
  });

  it("NÃO engole erro que apenas cita a tabela", () => {
    // Este é o caso exato do defeito: uma relação que o PostgREST não
    // resolveu, num erro que fala "pesquisa_zig" — e o filtro antigo,
    // procurando o nome da tabela, calava a varredura inteira.
    for (const m of [
      "Could not embed because more than one relationship was found for 'pesquisa_zig' and 'venues'",
      "new row violates row-level security policy for table \"clientes\"",
      "permission denied for table clientes_visitas",
      'duplicate key value violates unique constraint "clientes_venue_id_telefone_key"',
      "insert or update on table \"clientes\" violates foreign key constraint",
    ]) {
      assert.equal(ehMigracaoPendente(m), false, m);
    }
  });

  it("erro vazio ou ausente não é migração pendente", () => {
    // Na dúvida, é defeito: melhor um log a mais que uma varredura muda.
    assert.equal(ehMigracaoPendente(""), false);
    assert.equal(ehMigracaoPendente(null), false);
    assert.equal(ehMigracaoPendente(undefined), false);
    assert.equal(ehMigracaoPendente("timeout"), false);
  });

  it("o código do erro precisa ser o código, não um pedaço de outro número", () => {
    // "142P019" não é 42P01. Sem a fronteira de palavra, um id qualquer com
    // esses dígitos no meio viraria "tabela não existe".
    assert.equal(ehMigracaoPendente("id 142P019 falhou"), false);
    assert.equal(ehMigracaoPendente("erro 42P01 na consulta"), true);
  });
});
