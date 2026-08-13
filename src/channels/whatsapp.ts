import { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type proto,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { toDataURL } from "qrcode";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { runAgent } from "../agent.js";
import { normalizarTelefone, registrarProvedorWhatsapp } from "../notifications.js";

/**
 * Conector WhatsApp via Baileys (protocolo do WhatsApp Web).
 *
 * NÃO É OFICIAL. Está fora dos termos de uso da Meta e o número pode ser
 * banido. Use um chip separado do número principal da casa: um ban derruba
 * o canal de atendimento inteiro.
 *
 * Em troca: sem burocracia de aprovação e sem a janela de 24h da Cloud API.
 */

const PASTA_SESSAO = resolve(process.cwd(), process.env.WHATSAPP_SESSION_DIR ?? ".whatsapp");

export type ConexaoStatus = "desconectado" | "aguardando_qr" | "conectando" | "conectado";

interface EstadoConector {
  status: ConexaoStatus;
  /** QR em data URL, pronto para <img src>. Só existe enquanto não pareia. */
  qr: string | null;
  telefone: string | null;
  ultimoErro: string | null;
  iniciadoEm: number;
}

const estado: EstadoConector = {
  status: "desconectado",
  qr: null,
  telefone: null,
  ultimoErro: null,
  iniciadoEm: 0,
};

let socket: WASocket | null = null;
let parando = false;

export function estadoWhatsapp(): Readonly<EstadoConector> {
  return { ...estado };
}

export interface OpcoesWhatsapp {
  agentSlug: string;
  venueSlug: string;
}

/**
 * Sobe o conector e mantém a conexão. Reconecta sozinho, exceto quando a
 * sessão foi encerrada no celular — aí é preciso parear de novo.
 */
export async function iniciarWhatsapp(opcoes: OpcoesWhatsapp): Promise<void> {
  parando = false;
  await mkdir(PASTA_SESSAO, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);

  estado.status = "conectando";
  estado.iniciadoEm = Date.now();

  socket = makeWASocket({
    auth: state,
    // O QR vai para o painel; imprimir no terminal aqui poluiria o log.
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  socket.ev.on("creds.update", () => void saveCreds());

  socket.ev.on("connection.update", (update) => {
    void aoAtualizarConexao(update, opcoes);
  });

  socket.ev.on("messages.upsert", (lote) => {
    if (lote.type !== "notify") return;
    for (const mensagem of lote.messages) {
      void aoReceberMensagem(mensagem, opcoes);
    }
  });
}

async function aoAtualizarConexao(
  update: { connection?: string; lastDisconnect?: { error?: Error }; qr?: string },
  opcoes: OpcoesWhatsapp,
): Promise<void> {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    estado.status = "aguardando_qr";
    estado.qr = await toDataURL(qr, { margin: 1, width: 320 });
    console.log("[whatsapp] QR gerado — pareie pelo painel em /whatsapp");
  }

  if (connection === "open") {
    estado.status = "conectado";
    estado.qr = null;
    estado.ultimoErro = null;
    estado.telefone = socket?.user?.id?.split(":")[0] ?? null;
    // A partir daqui as notificações de reserva saem por este número.
    registrarProvedorWhatsapp(enviarPeloWhatsapp);
    console.log(`[whatsapp] conectado como ${estado.telefone ?? "?"}`);
  }

  if (connection === "close") {
    const codigo = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
    const deslogado = codigo === DisconnectReason.loggedOut;

    estado.status = "desconectado";
    estado.ultimoErro = lastDisconnect?.error?.message ?? null;
    // Sem conexão, as notificações voltam para a Cloud API ou para o console.
    registrarProvedorWhatsapp(null);

    if (parando) return;

    if (deslogado) {
      // Sessão encerrada no celular: as credenciais não valem mais.
      estado.qr = null;
      console.error(
        "[whatsapp] sessão encerrada no aparelho. Apague a pasta de sessão e pareie de novo.",
      );
      return;
    }

    console.warn(`[whatsapp] conexão caiu (${codigo ?? "?"}). Reconectando em 3s…`);
    setTimeout(() => void iniciarWhatsapp(opcoes), 3000);
  }
}

async function aoReceberMensagem(
  mensagem: WAMessage,
  opcoes: OpcoesWhatsapp,
): Promise<void> {
  const jid = mensagem.key.remoteJid;
  if (!jid || mensagem.key.fromMe) return;

  // Grupos e status não são atendimento — responder ali seria constrangedor.
  if (jid.endsWith("@g.us") || jid === "status@broadcast") return;

  // Ao conectar, o WhatsApp reentrega mensagens antigas. Sem este corte, o
  // agente responderia conversas de dias atrás como se fossem novas.
  const timestamp = normalizarTimestamp(mensagem.messageTimestamp);
  if (timestamp && timestamp * 1000 < estado.iniciadoEm) return;

  const texto = extrairTexto(mensagem.message);
  if (!texto) {
    // Resposta específica por tipo: "não entendi" genérico soa quebrado.
    // Áudio ainda não é transcrito — a API do Claude não recebe áudio; quando
    // houver um provedor de transcrição configurado, este é o ponto de entrada.
    if (mensagem.message?.audioMessage) {
      await responder(
        jid,
        "Recebi seu áudio! Por enquanto ainda não consigo ouvir mensagens de voz — pode escrever? Prometo que respondo rapidinho. 😊",
      );
    } else if (mensagem.message?.imageMessage || mensagem.message?.videoMessage) {
      await responder(
        jid,
        "Recebi sua mídia! Consigo te ajudar melhor por texto — me conta o que você precisa?",
      );
    } else {
      await responder(jid, "Por enquanto consigo ler só mensagens de texto. Pode escrever?");
    }
    return;
  }

  const telefone = jid.split("@")[0] ?? jid;
  console.log(`[whatsapp] ${telefone}: ${texto.slice(0, 80)}`);

  try {
    await socket?.sendPresenceUpdate("composing", jid);
    const resultado = await runAgent({
      agentSlug: opcoes.agentSlug,
      venueSlug: opcoes.venueSlug,
      userMessage: texto,
      channel: "whatsapp",
      externalId: telefone,
    });
    await responder(jid, resultado.text || "Desculpe, não consegui responder agora.");
  } catch (e) {
    console.error(`[whatsapp] falha ao atender ${telefone}:`, e);
    await responder(
      jid,
      "Tive um problema técnico aqui. Pode tentar de novo em instantes?",
    );
  } finally {
    await socket?.sendPresenceUpdate("paused", jid).catch(() => undefined);
  }
}

/** O timestamp vem como número ou como Long do protobuf, conforme a origem. */
function normalizarTimestamp(valor: WAMessage["messageTimestamp"]): number | null {
  if (typeof valor === "number") return valor;
  if (valor && typeof valor === "object" && "toNumber" in valor) return valor.toNumber();
  return null;
}

/** Texto de uma mensagem simples, de resposta ou de legenda de mídia. */
function extrairTexto(message: proto.IMessage | null | undefined): string | null {
  if (!message) return null;

  if (message.conversation?.trim()) return message.conversation.trim();
  if (message.extendedTextMessage?.text?.trim()) {
    return message.extendedTextMessage.text.trim();
  }

  const legenda =
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.documentMessage?.caption;

  return legenda?.trim() ? legenda.trim() : null;
}

async function responder(jid: string, texto: string): Promise<void> {
  try {
    await socket?.sendMessage(jid, { text: texto });
  } catch (e) {
    console.error(`[whatsapp] falha ao enviar para ${jid}:`, e);
  }
}

/**
 * Envia uma mensagem avulsa — usado pelas notificações de reserva.
 * Devolve o id da mensagem no WhatsApp, para rastrear a entrega.
 */
export async function enviarPeloWhatsapp(
  telefoneBruto: string,
  texto: string,
): Promise<{ enviado: boolean; providerId?: string; erro?: string }> {
  if (estado.status !== "conectado" || !socket) {
    return { enviado: false, erro: `WhatsApp não conectado (${estado.status}).` };
  }

  const telefone = normalizarTelefone(telefoneBruto);
  if (!telefone) return { enviado: false, erro: `Telefone inválido: "${telefoneBruto}".` };

  try {
    const resultado = await socket.sendMessage(`${telefone}@s.whatsapp.net`, { text: texto });
    return { enviado: true, providerId: resultado?.key?.id ?? undefined };
  } catch (e) {
    return { enviado: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

export async function pararWhatsapp(): Promise<void> {
  parando = true;
  socket?.end(undefined);
  socket = null;
  estado.status = "desconectado";
  estado.qr = null;
  registrarProvedorWhatsapp(null);
}
