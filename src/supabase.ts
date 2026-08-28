import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config.js";
import type { Database } from "./database.types.js";

export type Db = SupabaseClient<Database>;

let cached: Db | undefined;

/**
 * Cliente Supabase com a service_role key.
 *
 * A service_role ignora RLS — este cliente só pode ser usado no servidor.
 * Nunca importe este módulo em código que roda no navegador.
 */
export function db(): Db {
  if (!cached) {
    const { url, serviceRoleKey } = supabaseConfig();
    cached = createClient<Database>(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/**
 * Cliente SEPARADO e descartável para operações de login.
 *
 * Existe por causa de um comportamento do supabase-js que já custou caro
 * aqui: o cliente escolhe o token das consultas PostgREST em `_getAccessToken`,
 * que devolve a sessão do cliente quando existe uma, e só cai na chave de
 * serviço quando não existe. `signInWithPassword` grava essa sessão.
 *
 * Resultado, se o login rodasse no cliente de `db()`: a partir da primeira
 * pessoa que entrasse, TODAS as consultas daquele processo passariam a rodar
 * como aquele usuário em vez de service_role — batendo no RLS, que aqui não
 * tem policy nenhuma e devolve zero linhas SEM erro. O sintoma é dado que
 * existe no banco e o sistema jura não encontrar.
 *
 * Um cliente novo a cada chamada mantém a sessão contida nele. Não há custo
 * de conexão: o supabase-js é só HTTP.
 */
export function dbAuth(): Db {
  const { url, serviceRoleKey } = supabaseConfig();
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Este erro é "a migração ainda não rodou" — ou é um problema de verdade?
 *
 * O CÓDIGO SOBE ANTES DO SQL, SEMPRE: a Vercel publica a cada push e a
 * migração é um SQL que alguém cola no Supabase depois. Por isso cada leitura
 * de tabela nova precisa aguentar a ausência dela, e o jeito de fazer isso
 * era testar o nome da tabela na mensagem de erro:
 *
 *     if (/clientes|42P01|PGRST/i.test(error.message)) return;   // NÃO
 *
 * O problema é que "clientes" aparece em TODO erro daquela tabela — falha de
 * permissão, coluna trocada, relação que o PostgREST não resolveu. O filtro
 * que existia para tolerar a migração pendente passou a engolir o defeito
 * real, e a varredura ficou muda enquanto a base ficava vazia. Aconteceu
 * duas vezes; a segunda custou uma tarde de investigação.
 *
 * Aqui o teste é pela CAUSA: só passa o que de fato significa "este objeto
 * não existe no banco ainda". Qualquer outra coisa volta a ser erro, e erro
 * aparece no log.
 *
 *   42P01 / PGRST205 — tabela não existe
 *   42703 / PGRST204 — coluna não existe
 */
export function ehMigracaoPendente(mensagem: string | null | undefined): boolean {
  const m = mensagem ?? "";
  return (
    /\b42P01\b|\b42703\b|PGRST20[45]/.test(m) ||
    /does not exist/i.test(m) ||
    /schema cache/i.test(m) ||
    /could not find the .+ (column|table)/i.test(m)
  );
}
