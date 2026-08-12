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
