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
