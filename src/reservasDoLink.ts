import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { instanteNaCasa } from "./fuso.js";
import { normalizarTelefone } from "./notifications.js";
import { decidirReserva, publicarReservaCriada } from "./reservationFlow.js";
import { db } from "./supabase.js";
import type { Json } from "./database.types.js";
import { cancelReservation, createReservation, type Reservation, type Venue } from "./venues.js";

/**
 * RESERVAS QUE NASCEM FORA DAQUI.
 *
 * A casa pode ter o próprio formulário de reserva, no próprio site e no
 * próprio banco. O cliente reserva lá — e a casa continua querendo o que este
 * sistema já faz bem: avisar quem analisa, confirmar ao cliente e lembrar uma
 * hora antes.
 *
 * Então o outro sistema AVISA este, por webhook, e a reserva entra na mesma
 * fila das que o atendente virtual anota: mesmo aviso ao gestor, mesma
 * aprovação ("aprovo"/"recuso" pelo WhatsApp ou pelo painel), mesma
 * confirmação, mesmo lembrete. Nada do caminho de avisos foi duplicado.
 *
 * Três cuidados moram aqui:
 *
 * 1. IDENTIDADE. Cada pedido traz o `id` do registro de lá. É por ele que o
 *    mesmo aviso entregue duas vezes não vira duas reservas — e é ele que
 *    volta no webhook de saída (`external_id`), para o outro sistema
 *    ATUALIZAR a pré-reserva em vez de criar outra quando a casa aprovar.
 *
 * 2. CHAVE. Quem chama se identifica por um segredo no cabeçalho. Só o
 *    resumo (SHA-256) fica guardado: o painel mostra a chave uma vez, na
 *    hora em que é gerada, e depois nem a Brasa Food consegue lê-la.
 *
 * 3. HORA DA CASA. O formulário manda "dia" e "horário" como o cliente
 *    escolheu; o instante é calculado no fuso da casa, e não no do servidor.
 */

/** Como a reserva fica marcada: é o canal de origem e o filtro de busca. */
export const CANAL_DO_LINK = "link";

/** Onde, nas configurações da casa, fica o resumo da chave. */
const CHAVE_NAS_CONFIGURACOES = "reservas_link";

export type EventoDoLink = "criada" | "confirmada" | "cancelada";

export interface PedidoDoLink {
  evento: EventoDoLink;
  /** O id do registro no sistema de origem. Texto, para servir a uuid e a número. */
  id: string;
  /** Só "criada" precisa dos dados da reserva. */
  dados: {
    nome: string;
    telefone: string;
    reservadoPara: string;
    pessoas: number;
    ambiente: string | null;
    observacao: string | null;
  } | null;
}

/** Erro de quem mandou o pedido: vira 400 com a frase, e não 500. */
export class PedidoInvalido extends Error {}

const EVENTOS: EventoDoLink[] = ["criada", "confirmada", "cancelada"];
/** Preferência que não é preferência: não vale ocupar a linha da recepção. */
const SEM_PREFERENCIA = /^(sem prefer[eê]ncia|tanto faz|qualquer|nenhum[a]?)$/i;

function textoDe(corpo: Record<string, unknown>, campo: string): string {
  const v = corpo[campo];
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/**
 * Lê e confere o que o outro sistema mandou. Pura: não toca no banco.
 *
 * `fuso` é o da casa — "20:00" é oito da noite LÁ.
 */
export function lerPedidoDoLink(corpo: Record<string, unknown>, fuso: string, agora = new Date()): PedidoDoLink {
  const eventoBruto = textoDe(corpo, "evento").toLowerCase() || "criada";
  if (!EVENTOS.includes(eventoBruto as EventoDoLink)) {
    throw new PedidoInvalido(`"evento" precisa ser um de: ${EVENTOS.join(", ")}.`);
  }
  const evento = eventoBruto as EventoDoLink;

  const id = textoDe(corpo, "id");
  if (!id) throw new PedidoInvalido('Faltou "id": o identificador da reserva no sistema de origem.');
  if (id.length > 120) throw new PedidoInvalido('"id" tem mais de 120 caracteres.');

  // Confirmar e cancelar falam de uma reserva que já chegou: basta o id.
  if (evento !== "criada") return { evento, id, dados: null };

  const nome = textoDe(corpo, "nome");
  if (nome.length < 2 || nome.length > 120) throw new PedidoInvalido('"nome" precisa ter de 2 a 120 letras.');

  const telefone = textoDe(corpo, "telefone");
  if (!normalizarTelefone(telefone)) {
    throw new PedidoInvalido('"telefone" precisa ser um número com DDD, como (65) 99999-9999.');
  }

  const pessoasBruto = corpo.pessoas;
  const pessoas = typeof pessoasBruto === "number" ? pessoasBruto : Number(textoDe(corpo, "pessoas"));
  if (!Number.isInteger(pessoas) || pessoas < 1 || pessoas > 500) {
    throw new PedidoInvalido('"pessoas" precisa ser um número inteiro de 1 a 500.');
  }

  const dia = textoDe(corpo, "dia");
  // "20:00:00" (como o banco costuma devolver) vale como "20:00".
  const horario = textoDe(corpo, "horario").slice(0, 5);
  let reservadoPara: string;
  try {
    reservadoPara = instanteNaCasa(dia, horario, fuso);
  } catch {
    throw new PedidoInvalido('"dia" precisa vir como AAAA-MM-DD e "horario" como HH:MM, no horário da casa.');
  }
  // Aviso reapresentado dias depois não vira reserva nem mensagem para ninguém.
  if (new Date(reservadoPara).getTime() < agora.getTime() - 24 * 3_600_000) {
    throw new PedidoInvalido("Esta reserva é para uma data que já passou.");
  }

  const ambienteBruto = textoDe(corpo, "ambiente");
  if (ambienteBruto.length > 80) throw new PedidoInvalido('"ambiente" tem mais de 80 letras.');
  const observacao = textoDe(corpo, "observacao");
  if (observacao.length > 500) throw new PedidoInvalido('"observacao" tem mais de 500 letras.');

  return {
    evento,
    id,
    dados: {
      nome,
      telefone,
      reservadoPara,
      pessoas,
      ambiente: ambienteBruto && !SEM_PREFERENCIA.test(ambienteBruto) ? ambienteBruto : null,
      observacao: observacao || null,
    },
  };
}

/* ============================ A chave ============================ */

function resumoDaChave(chave: string): string {
  return createHash("sha256").update(chave).digest("hex");
}

function comoObjeto(valor: Json | null | undefined): Record<string, Json | undefined> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, Json | undefined>) : {};
}

interface ChaveGuardada {
  resumo: string;
  criada_em: string | null;
}

/** O que está guardado nas configurações da casa. Pura. */
export function chaveGuardada(settings: Json | null | undefined): ChaveGuardada | null {
  const bloco = comoObjeto(comoObjeto(settings)[CHAVE_NAS_CONFIGURACOES]);
  const resumo = typeof bloco.segredo_sha256 === "string" ? bloco.segredo_sha256 : "";
  if (!/^[0-9a-f]{64}$/.test(resumo)) return null;
  return { resumo, criada_em: typeof bloco.criada_em === "string" ? bloco.criada_em : null };
}

/**
 * A chave que veio no cabeçalho é a desta casa?
 *
 * Compara os resumos em tempo constante. Casa sem chave gerada recusa tudo:
 * a porta só existe depois que alguém da casa a abre no painel.
 */
export function chaveDoLinkConfere(settings: Json | null | undefined, enviada: string | string[] | undefined): boolean {
  const guardada = chaveGuardada(settings);
  const recebida = (Array.isArray(enviada) ? enviada[0] : enviada)?.trim() ?? "";
  if (!guardada || !recebida) return false;
  const a = Buffer.from(resumoDaChave(recebida));
  const b = Buffer.from(guardada.resumo);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function lerSettings(venueId: string): Promise<Record<string, Json | undefined>> {
  const { data, error } = await db().from("venues").select("settings").eq("id", venueId).single();
  if (error) throw new Error(`Falha ao ler as configurações da casa: ${error.message}`);
  return comoObjeto(data.settings);
}

/**
 * Grava o bloco da chave nas configurações e CONFERE que ficou.
 *
 * As configurações da casa são um JSON só, e o conector do WhatsApp regrava
 * esse JSON a cada minuto (o "estou vivo"). Uma gravação dele que tenha lido
 * antes desta e escrito depois apagaria a chave recém-criada, sem erro
 * nenhum. Por isso: grava, espera a gravação em curso terminar, relê — e
 * repete se a chave não estiver lá.
 */
async function gravarBlocoDaChave(venueId: string, bloco: Record<string, Json> | null): Promise<void> {
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    const settings = await lerSettings(venueId);
    const novo = { ...settings };
    if (bloco) novo[CHAVE_NAS_CONFIGURACOES] = bloco;
    else delete novo[CHAVE_NAS_CONFIGURACOES];
    const { error } = await db().from("venues").update({ settings: novo as unknown as Json }).eq("id", venueId);
    if (error) throw new Error(`Falha ao gravar a chave: ${error.message}`);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const conferido = comoObjeto((await lerSettings(venueId))[CHAVE_NAS_CONFIGURACOES]);
    const ficou = bloco ? conferido.segredo_sha256 === bloco.segredo_sha256 : !("segredo_sha256" in conferido);
    if (ficou) return;
  }
  throw new Error("A chave não ficou gravada. Tente de novo em instantes.");
}

/**
 * Gera uma chave nova para a casa e devolve o texto dela — a ÚNICA vez em
 * que ele existe fora do sistema de quem vai usá-la. A chave anterior, se
 * havia, deixa de valer na hora.
 */
export async function gerarChaveDoLink(venueId: string): Promise<string> {
  const chave = `brl_${randomBytes(32).toString("hex")}`;
  await gravarBlocoDaChave(venueId, { segredo_sha256: resumoDaChave(chave), criada_em: new Date().toISOString() });
  return chave;
}

/** Fecha a porta: nenhum aviso de fora entra até uma chave nova ser gerada. */
export async function revogarChaveDoLink(venueId: string): Promise<void> {
  await gravarBlocoDaChave(venueId, null);
}

/** O que o painel mostra: se há chave, e o que já chegou por ela. */
export async function situacaoDoLink(venue: Pick<Venue, "id" | "settings">): Promise<{
  tem_chave: boolean;
  chave_criada_em: string | null;
  recebidas: number;
  ultima_recebida_em: string | null;
}> {
  const guardada = chaveGuardada(venue.settings ?? null);
  const { data, count, error } = await db()
    .from("reservations")
    .select("created_at", { count: "exact" })
    .eq("venue_id", venue.id)
    .eq("source_channel", CANAL_DO_LINK)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Falha ao contar as reservas do link: ${error.message}`);
  return {
    tem_chave: Boolean(guardada),
    chave_criada_em: guardada?.criada_em ?? null,
    recebidas: count ?? 0,
    ultima_recebida_em: data?.[0]?.created_at ?? null,
  };
}

/* ========================= Receber o aviso ========================= */

async function acharPeloIdDeFora(venueId: string, idDeFora: string): Promise<Reservation | null> {
  const { data, error } = await db()
    .from("reservations")
    .select("*")
    .eq("venue_id", venueId)
    .eq("source_channel", CANAL_DO_LINK)
    .contains("metadata", { id_externo: idDeFora })
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Falha ao procurar a reserva: ${error.message}`);
  return (data?.[0] as Reservation | undefined) ?? null;
}

export type SituacaoDoRecebido =
  | "criada"
  | "ja_existia"
  | "confirmada"
  | "ja_confirmada"
  | "cancelada"
  | "ja_cancelada"
  | "desconhecida"
  | "nao_cabe";

export interface Recebido {
  situacao: SituacaoDoRecebido;
  reservation_id: string | null;
  status: string | null;
  /** Só quando há o que explicar a quem mandou. */
  detalhe?: string;
}

/**
 * Aplica o aviso que chegou. Repetir o mesmo aviso nunca repete o efeito:
 * "criada" duas vezes é uma reserva e um aviso ao gestor; "confirmada" duas
 * vezes é uma confirmação ao cliente.
 */
export async function receberDoLink(venue: Venue, pedido: PedidoDoLink): Promise<Recebido> {
  const existente = await acharPeloIdDeFora(venue.id, pedido.id);
  const resposta = (situacao: SituacaoDoRecebido, r: Reservation | null, detalhe?: string): Recebido => ({
    situacao,
    reservation_id: r?.id ?? null,
    status: r?.status ?? null,
    ...(detalhe ? { detalhe } : {}),
  });

  if (pedido.evento === "criada") {
    if (existente) return resposta("ja_existia", existente);
    const d = pedido.dados!;
    const reserva = await createReservation({
      venue_id: venue.id,
      customer_name: d.nome,
      customer_phone: d.telefone,
      party_size: d.pessoas,
      reserved_for: d.reservadoPara,
      area_preference: d.ambiente,
      notes: d.observacao,
      source_channel: CANAL_DO_LINK,
      status: "pending",
      metadata: { origem: CANAL_DO_LINK, id_externo: pedido.id },
    });
    // O mesmo passo das reservas do atendente virtual: avisa quem analisa
    // (pelo número de avisos da casa) e publica para as integrações.
    await publicarReservaCriada(reserva, venue);
    return resposta("criada", reserva);
  }

  if (!existente) {
    return resposta("desconhecida", null, 'Nenhuma reserva chegou com este "id". Mande antes o evento "criada".');
  }

  if (pedido.evento === "confirmada") {
    if (existente.status === "approved") return resposta("ja_confirmada", existente);
    if (existente.status !== "pending") {
      return resposta("nao_cabe", existente, `A reserva está "${existente.status}" e não pode mais ser confirmada.`);
    }
    // Confirma e avisa o cliente, pelo mesmo ponto único do painel.
    const { reserva } = await decidirReserva({ reservationId: existente.id, status: "approved", venue });
    return resposta("confirmada", reserva);
  }

  // cancelada
  if (existente.status === "cancelled" || existente.status === "rejected") return resposta("ja_cancelada", existente);
  if (existente.status !== "pending" && existente.status !== "approved") {
    return resposta("nao_cabe", existente, `A reserva está "${existente.status}" e não pode mais ser cancelada.`);
  }
  // Sem mensagem automática ao cliente: quem cancelou foi ele, no outro
  // sistema, ou a casa — que fala com ele do jeito dela. O que importa aqui
  // é o lembrete não sair para quem não vem.
  return resposta("cancelada", await cancelReservation(existente.id));
}
