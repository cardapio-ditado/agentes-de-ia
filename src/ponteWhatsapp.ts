import { db } from "./supabase.js";
import type { Json } from "./database.types.js";
import { versaoDoCodigo } from "./version.js";

/**
 * Ponte WhatsApp: conector e site conversando pelo banco.
 *
 * O QR nasce dentro do processo que roda o Baileys (PC do bar ou VPS) — o
 * painel na Vercel não tem como enxergá-lo diretamente. Em vez de expor o
 * conector na internet, os dois lados trocam tudo pelo Supabase, que já
 * compartilham:
 *
 *   conector -> banco: status, QR, telefone, versão (a cada ~5s)
 *   site     -> banco: comandos "conectar"/"desconectar" (fila de 1)
 *
 * Mesmo padrão da fila de notificações de reserva, que já provou funcionar.
 * Tudo vive em `venues.settings` (jsonb) — nenhuma migração necessária.
 *
 * Limite conhecido: um conector por organização. Ele consome comandos de
 * qualquer venue — com vários estabelecimentos e vários conectores, o consumo
 * precisaria filtrar por venue.
 */

const CHAVE_ESTADO = "whatsapp_ponte";
const CHAVE_COMANDO = "whatsapp_comando";

/** Sem sinal do conector por este tempo, ele é dado como desligado. */
export const SINAL_VELHO_MS = 45_000;
/** Comando mais velho que isto é descartado: ninguém quer conectar 2h depois do clique. */
const COMANDO_VELHO_MS = 120_000;

export interface EstadoPonte {
  status: string;
  qr: string | null;
  telefone: string | null;
  agentSlug: string | null;
  venueSlug: string | null;
  versao: string | null;
  atualizado_em: string;
}

export interface ComandoPonte {
  acao: "conectar" | "desconectar";
  agent?: string;
  criado_em: string;
}

function comoObjeto(valor: Json | null | undefined): Record<string, Json | undefined> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, Json | undefined>)
    : {};
}

async function settingsDoVenue(venueId: string): Promise<Record<string, Json | undefined>> {
  const { data, error } = await db()
    .from("venues")
    .select("settings")
    .eq("id", venueId)
    .single();
  if (error) throw new Error(`Falha ao ler settings do venue: ${error.message}`);
  return comoObjeto(data.settings);
}

/** O conector publica seu estado — o site lê daqui. */
export async function publicarEstadoPonte(
  venueId: string,
  estado: Omit<EstadoPonte, "versao" | "atualizado_em">,
): Promise<void> {
  const settings = await settingsDoVenue(venueId);
  const publicado: EstadoPonte = {
    ...estado,
    versao: versaoDoCodigo(),
    atualizado_em: new Date().toISOString(),
  };
  const { error } = await db()
    .from("venues")
    .update({ settings: { ...settings, [CHAVE_ESTADO]: publicado } as unknown as Json })
    .eq("id", venueId);
  if (error) throw new Error(`Falha ao publicar o estado do WhatsApp: ${error.message}`);
}

/**
 * Estado publicado, lido dos settings de um venue já carregado.
 *
 * Sinal velho vira "sem_conector": o conector morreu (ou o PC desligou) sem
 * ter chance de se despedir — o último estado gravado mente.
 */
export function lerEstadoPonte(settings: Json | null): EstadoPonte | null {
  const bruto = comoObjeto(settings)[CHAVE_ESTADO];
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const estado = bruto as unknown as EstadoPonte;

  const idade = Date.now() - new Date(estado.atualizado_em).getTime();
  if (Number.isNaN(idade) || idade > SINAL_VELHO_MS) {
    return { ...estado, status: "sem_conector", qr: null };
  }
  return estado;
}

/** O site enfileira um comando; o conector consome no próximo ciclo. */
export async function criarComandoPonte(
  venueId: string,
  comando: Omit<ComandoPonte, "criado_em">,
): Promise<void> {
  const settings = await settingsDoVenue(venueId);
  const completo: ComandoPonte = { ...comando, criado_em: new Date().toISOString() };
  const { error } = await db()
    .from("venues")
    .update({ settings: { ...settings, [CHAVE_COMANDO]: completo } as unknown as Json })
    .eq("id", venueId);
  if (error) throw new Error(`Falha ao registrar o comando: ${error.message}`);
}

export interface ComandoRecebido {
  venueId: string;
  venueSlug: string;
  comando: ComandoPonte;
}

/**
 * Pega (e apaga) o próximo comando pendente, de qualquer venue.
 *
 * Apagar antes de executar é deliberado: um comando que falha não pode ficar
 * reexecutando para sempre — quem clicou vê o status e clica de novo.
 */
export async function consumirComandoPonte(): Promise<ComandoRecebido | null> {
  const { data, error } = await db()
    .from("venues")
    .select("id, slug, settings")
    .not(`settings->${CHAVE_COMANDO}`, "is", null)
    .limit(1);
  if (error) throw new Error(`Falha ao buscar comandos: ${error.message}`);

  const venue = data?.[0];
  if (!venue) return null;

  const settings = comoObjeto(venue.settings);
  const comando = settings[CHAVE_COMANDO] as unknown as ComandoPonte;
  const { [CHAVE_COMANDO]: _consumido, ...resto } = settings;

  const { error: erroLimpar } = await db()
    .from("venues")
    .update({ settings: resto as Json })
    .eq("id", venue.id);
  if (erroLimpar) throw new Error(`Falha ao consumir o comando: ${erroLimpar.message}`);

  if (Date.now() - new Date(comando.criado_em).getTime() > COMANDO_VELHO_MS) return null;
  return { venueId: venue.id, venueSlug: venue.slug, comando };
}

/** Para o heartbeat antes do primeiro comando: o único venue da organização. */
export async function primeiroVenueAtivo(): Promise<{ id: string; slug: string } | null> {
  const { data, error } = await db()
    .from("venues")
    .select("id, slug")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Falha ao buscar o venue: ${error.message}`);
  return data?.[0] ?? null;
}
