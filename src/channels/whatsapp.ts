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
import {
  jidConhecidoDoTelefone,
  listPendingNotifications,
  normalizarTelefone,
  registrarProvedorWhatsapp,
  tentarEnviar,
  variacoesDoTelefone,
} from "../notifications.js";

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
  /** Qual agente e estabelecimento este número está atendendo agora. */
  agentSlug: string | null;
  venueSlug: string | null;
}

const estado: EstadoConector = {
  status: "desconectado",
  qr: null,
  telefone: null,
  ultimoErro: null,
  iniciadoEm: 0,
  agentSlug: null,
  venueSlug: null,
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
  estado.agentSlug = opcoes.agentSlug;
  estado.venueSlug = opcoes.venueSlug;

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
    iniciarFilaDeNotificacoes();
    console.log(`[whatsapp] conectado como ${estado.telefone ?? "?"}`);
  }

  if (connection === "close") {
    const codigo = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
    const deslogado = codigo === DisconnectReason.loggedOut;

    estado.status = "desconectado";
    estado.ultimoErro = lastDisconnect?.error?.message ?? null;
    // Sem conexão, as notificações voltam para a fila até reconectar.
    registrarProvedorWhatsapp(null);
    pararFilaDeNotificacoes();

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

  // Em contas migradas para LID, o jid é um id interno ilegível — o número
  // de verdade vem em remoteJidAlt. O nome vem do perfil (pushName).
  const nomePerfil = mensagem.pushName?.trim() || null;
  const telefoneReal = extrairTelefone(jid, mensagem.key.remoteJidAlt);
  const telefoneExibicao = telefoneReal ?? jid.split("@")[0] ?? jid;
  console.log(`[whatsapp] ${nomePerfil ?? "?"} (${telefoneExibicao}): ${texto.slice(0, 80)}`);

  try {
    await socket?.sendPresenceUpdate("composing", jid);
    const resultado = await runAgent({
      agentSlug: opcoes.agentSlug,
      venueSlug: opcoes.venueSlug,
      userMessage: texto,
      channel: "whatsapp",
      // O jid completo (com "@s.whatsapp.net" ou "@lid") — não só os dígitos.
      // Contas migradas para LID só são alcançáveis por esse endereço exato;
      // reconstruir a partir do número de telefone pode apontar para um jid
      // que o WhatsApp não resolve (ver enviarPeloWhatsapp mais abaixo).
      externalId: jid,
      // A inbox mostra isto no lugar do id técnico.
      contato: { nome: nomePerfil, telefone: telefoneReal },
    });
    await responder(jid, resultado.text || "Desculpe, não consegui responder agora.");
  } catch (e) {
    console.error(`[whatsapp] falha ao atender ${telefoneExibicao}:`, e);
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
 * Telefone legível (+5565...) a partir dos jids da mensagem.
 *
 * Só um jid de número de verdade serve ("@s.whatsapp.net") — o "@lid" é
 * id interno, não telefone. Sem nenhum dos dois, devolve null e a inbox
 * fica só com o nome do perfil.
 */
function extrairTelefone(jid: string, jidAlt: string | null | undefined): string | null {
  for (const candidato of [jid, jidAlt]) {
    if (candidato?.endsWith("@s.whatsapp.net")) {
      const digitos = candidato.split("@")[0]?.split(":")[0]?.replace(/\D/g, "");
      if (digitos) return `+${digitos}`;
    }
  }
  return null;
}

/**
 * Descobre o endereço que realmente entrega a mensagem.
 *
 * Reconstruir "telefone@s.whatsapp.net" só funciona para contas clássicas com
 * o número digitado exatamente como o WhatsApp o registrou. Duas armadilhas
 * derrubam isso em silêncio (o envio "dá certo" e nada chega): contas
 * migradas para LID, que só respondem pelo id interno, e o nono dígito, que
 * muitos números antigos não têm. Por isso a busca é em cascata, da fonte
 * mais confiável para a menos:
 *
 *   1. jid pronto — veio de uma conversa real
 *   2. conversa já existente com esse número — endereço que já funcionou
 *   3. o próprio WhatsApp (onWhatsApp), testando com e sem o nono dígito
 *   4. reconstrução — o palpite de sempre, para contas clássicas
 */
async function resolverJid(destino: string): Promise<string | null> {
  if (destino.includes("@")) return destino;

  const digitos = destino.replace(/\D/g, "");
  // Longo demais para telefone: é um LID gravado sem o sufixo.
  if (digitos.length >= 14) return `${digitos}@lid`;

  const telefone = normalizarTelefone(destino);
  if (!telefone) return null;
  const candidatos = variacoesDoTelefone(telefone);

  const conhecido = await jidConhecidoDoTelefone(candidatos).catch(() => null);
  if (conhecido) {
    console.log(`[whatsapp] ${destino} → ${conhecido} (conversa conhecida)`);
    return conhecido;
  }

  try {
    const achados = await socket?.onWhatsApp(...candidatos);
    const valido = achados?.find((a) => a.exists && a.jid);
    if (valido?.jid) {
      console.log(`[whatsapp] ${destino} → ${valido.jid} (consulta ao WhatsApp)`);
      return valido.jid;
    }
    console.warn(
      `[whatsapp] ${destino}: o WhatsApp não reconheceu ${candidatos.join(" nem ")}.`,
    );
  } catch (e) {
    console.error("[whatsapp] consulta de número falhou:", e);
  }

  // Último recurso, e o mais frágil: se a conta for LID ou o número estiver
  // registrado com outro formato, o envio "dá certo" e não chega a ninguém.
  console.warn(`[whatsapp] ${destino} → ${telefone}@s.whatsapp.net (palpite; pode não chegar)`);
  return `${telefone}@s.whatsapp.net`;
}

/**
 * Envia uma mensagem avulsa — usado pelas notificações de reserva.
 * Devolve o id da mensagem no WhatsApp, para rastrear a entrega.
 */
export async function enviarPeloWhatsapp(
  destino: string,
  texto: string,
): Promise<{ enviado: boolean; providerId?: string; erro?: string }> {
  if (estado.status !== "conectado" || !socket) {
    return { enviado: false, erro: `WhatsApp não conectado (${estado.status}).` };
  }

  const jid = await resolverJid(destino);
  if (!jid) return { enviado: false, erro: `Telefone inválido: "${destino}".` };

  try {
    const resultado = await socket.sendMessage(jid, { text: texto });
    console.log(`[whatsapp] mensagem enviada para ${jid} (id ${resultado?.key?.id ?? "?"})`);
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
  estado.agentSlug = null;
  estado.venueSlug = null;
  registrarProvedorWhatsapp(null);
  pararFilaDeNotificacoes();
}

// ============================================================
// Fila de notificações
// ============================================================

let timerFila: ReturnType<typeof setInterval> | null = null;
let processandoFila = false;

/**
 * Entrega o que outros processos deixaram na fila.
 *
 * Aprovar uma reserva pelo painel na Vercel registra a notificação como
 * `pending` — lá não existe WhatsApp conectado. Este processo, que tem o
 * número pareado, varre a fila a cada 15s e envia. É o que faz a aprovação
 * feita de qualquer lugar chegar no cliente.
 */
function iniciarFilaDeNotificacoes(): void {
  if (timerFila) return;
  timerFila = setInterval(() => void processarFila(), 15_000);
  // Primeira varredura imediata: se algo ficou pendente enquanto o conector
  // estava fora, o cliente não espera os 15s.
  void processarFila();
}

function pararFilaDeNotificacoes(): void {
  if (timerFila) clearInterval(timerFila);
  timerFila = null;
}

async function processarFila(): Promise<void> {
  if (processandoFila || estado.status !== "conectado") return;
  processandoFila = true;
  try {
    const pendentes = await listPendingNotifications();
    for (const notificacao of pendentes) {
      if (notificacao.channel !== "whatsapp") continue;
      const resultado = await tentarEnviar(notificacao);
      if (resultado.status === "sent") {
        console.log(`[whatsapp] notificação ${notificacao.id} entregue pela fila.`);
      }
    }
  } catch (e) {
    console.error("[whatsapp] falha ao processar a fila de notificações:", e);
  } finally {
    processandoFila = false;
  }
}
