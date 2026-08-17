import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Guarda contra um bug que já aconteceu e é invisível em teste normal.
 *
 * O supabase-js escolhe o token das consultas PostgREST em `_getAccessToken`:
 * devolve a sessão do cliente quando existe uma, e só cai na chave de serviço
 * quando não existe. Como `signInWithPassword` grava essa sessão no cliente,
 * fazer login no MESMO cliente usado para ler tabelas transforma, a partir do
 * primeiro login, todas as consultas daquele processo em consultas com o
 * poder do usuário logado — batendo no RLS, que aqui não tem policy nenhuma
 * e devolve zero linhas SEM erro.
 *
 * O sintoma é dado que existe no banco e o sistema jurando não encontrar.
 * Nenhum teste de unidade pega isso, e em produção só aparece depois que
 * alguém loga — por isso a checagem é sobre o código-fonte.
 */

const DIR = new URL(".", import.meta.url).pathname;

function arquivosTs(): string[] {
  const achados: string[] = [];
  const varrer = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name);
      if (entrada.isDirectory()) varrer(caminho);
      else if (entrada.name.endsWith(".ts") && !entrada.name.endsWith(".test.ts")) {
        achados.push(caminho);
      }
    }
  };
  varrer(DIR);
  return achados;
}

describe("isolamento do cliente Supabase", () => {
  it("nenhuma operação de auth roda no cliente compartilhado db()", () => {
    const culpados: string[] = [];

    for (const arquivo of arquivosTs()) {
      const conteudo = readFileSync(arquivo, "utf8");
      // Pega db().auth.qualquerCoisa — inclusive db().auth.admin.*
      if (/\bdb\(\)\s*\.\s*auth\b/.test(conteudo)) {
        culpados.push(arquivo.replace(DIR, ""));
      }
    }

    assert.deepEqual(
      culpados,
      [],
      `Use dbAuth() para operações de autenticação. Fazer login no cliente de ` +
        `db() faz as consultas seguintes rodarem como o usuário logado, e o RLS ` +
        `devolve zero linhas sem erro. Arquivos: ${culpados.join(", ")}`,
    );
  });

  it("dbAuth devolve um cliente novo a cada chamada", async () => {
    // Se devolvesse o mesmo objeto, a sessão de um login vazaria para o
    // próximo — que é exatamente o problema que a separação evita.
    process.env.SUPABASE_URL ??= "https://exemplo.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "chave-de-teste";
    const { dbAuth } = await import("./supabase.js");
    assert.notEqual(dbAuth(), dbAuth());
  });
});
