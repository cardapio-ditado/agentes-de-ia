import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "./supabase.js";
import type { Tables } from "./database.types.js";

export type ApiKey = Tables<"api_keys">;

const PREFIXO = "sk_ditado_";

/**
 * Guardamos apenas o SHA-256 da chave. Um vazamento do banco não expõe
 * nenhuma chave utilizável, e por isso a chave crua só aparece uma vez.
 */
function hash(chave: string): string {
  return createHash("sha256").update(chave).digest("hex");
}

export interface ChaveCriada {
  /** Só existe neste retorno — não é possível recuperá-la depois. */
  chave: string;
  registro: ApiKey;
}

export async function createApiKey(params: {
  orgId: string;
  name: string;
  scopes?: string[];
  expiresAt?: Date;
}): Promise<ChaveCriada> {
  const chave = PREFIXO + randomBytes(24).toString("hex");

  const { data, error } = await db()
    .from("api_keys")
    .insert({
      org_id: params.orgId,
      name: params.name,
      key_prefix: chave.slice(0, PREFIXO.length + 6),
      key_hash: hash(chave),
      scopes: params.scopes ?? ["runs:write", "reservations:read", "reservations:write"],
      expires_at: params.expiresAt?.toISOString() ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Falha ao criar a chave: ${error.message}`);
  return { chave, registro: data };
}

/**
 * Valida a chave enviada na requisição.
 *
 * Devolve `null` para qualquer falha — chave inexistente, revogada ou
 * expirada — sem distinguir os casos, para não dar pistas a quem tenta adivinhar.
 */
export async function authenticateApiKey(chave: string | undefined): Promise<ApiKey | null> {
  if (!chave || !chave.startsWith(PREFIXO)) return null;

  const { data, error } = await db()
    .from("api_keys")
    .select("*")
    .eq("key_hash", hash(chave))
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Comparação em tempo constante, mesmo o lookup já sendo por hash.
  const esperado = Buffer.from(data.key_hash, "hex");
  const recebido = Buffer.from(hash(chave), "hex");
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
    return null;
  }

  // Registro de uso é best-effort: não bloqueia a requisição.
  void db()
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(({ error: erroUso }) => {
      if (erroUso) console.error(`[api_keys] last_used_at: ${erroUso.message}`);
    });

  return data;
}

export function hasScope(chave: ApiKey, escopo: string): boolean {
  return chave.scopes.includes(escopo);
}
