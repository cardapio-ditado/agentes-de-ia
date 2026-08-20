import { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type proto,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { toDataURL } from "qrcode";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { runAgent } from "../agent.js";
import { PlanoBloqueadoError } from "../pontos.js";
import type { PapelWhatsapp } from "../ponteWhatsapp.js";
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

/**
 * A pasta da sessão é POR PAPEL.
 *
 * Duas conexões dividindo a mesma pasta significam uma sobrescrevendo as
 * credenciais da outra — e as duas caem, alternadamente, sem que ninguém
 * entenda por quê.
 */
const RAIZ_SESSAO = resolve(process.cwd(), process.env.WHATSAPP_SESSION_DIR ?? ".whatsapp");
const pastaDaSessao = (papel: PapelWhatsapp) => resolve(RAIZ_SESSAO, papel);

/**
 * Herda a sessão de quando havia UMA conexão só.
 *
 * Antes dos papéis, as credenciais moravam soltas na raiz de `.whatsapp/`.
 * Sem isto, atualizar o código faria toda casa já instalada pedir QR de novo
 * — e reparear exige alguém com o celular do chip na mão, o que numa VPS
 * significa o agente mudo até que alguém perceba e vá até o aparelho.
 *
 * Só o papel `agente` herda: a conexão antiga sempre foi a que atende.
 */
/**
 * Já existe sessão pareada em disco para este papel?
 *
 * É o que permite religar sozinho depois de um reinício, sem QR: as
 * credenciais do WhatsApp continuam válidas até alguém desconectar o
 * aparelho no celular.
 */
export async function temSessaoSalva(papel: PapelWhatsapp): Promise<boolean> {
  const alvo = resolve(pastaDaSessao(papel), "creds.json");
  const raiz = resolve(RAIZ_SESSAO, "creds.json");
  const existe = async (caminho: string) =>
    await stat(caminho).then(
      () => true,
      () => false,
    );
  // A raiz conta para o papel `agente`: é onde mora a sessão das instalações
  // anteriores, que `herdarSessaoAntiga` move na primeira subida.
  return (await existe(alvo)) || (papel === "agente" && (await existe(raiz)));
}

async function herdarSessaoAntiga(papel: PapelWhatsapp, destino: string): Promise<void> {
  if (papel !== "agente") return;

  const temCredenciais = async (pasta: string) =>
    await stat(resolve(pasta, "creds.json")).then(
      () => true,
      () => false,
    );

  if (await temCredenciais(destino)) return;
  if (!(await temCredenciais(RAIZ_SESSAO))) return;

  const arquivos = await readdir(RAIZ_SESSAO, { withFileTypes: true });
  let movidos = 0;
  for (const arquivo of arquivos) {
    // Só arquivos: as pastas da raiz são os próprios papéis.
    if (!arquivo.isFile()) continue;
    await rename(resolve(RAIZ_SESSAO, arquivo.name), resolve(destino, arquivo.name));
    movidos += 1;
  }
  console.log(
    `[whatsapp:agente] sessão herdada da instalação anterior (${movidos} arquivo(s)) — não precisa ler o QR de novo.`,
  );
}

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
  /**
   * O que este número faz: atender com IA ou só enviar.
   *
   * É a única coisa que separa as duas conexões. O administrativo recebe
   * mensagem e não responde — o funcionário que manda "ok" depois do
   * checklist fala com o vazio, em vez de ser atendido pela recepcionista
   * virtual como se fosse cliente novo.
   */
  papel: PapelWhatsapp;
}

const estado: EstadoConector = {
  status: "desconectado",
  qr: null,
  telefone: null,
  ultimoErro: null,
  iniciadoEm: 0,
  agentSlug: null,
  venueSlug: null,
  papel: "agente",
};

let socket: WASocket | null = null;
let parando = false;

export function estadoWhatsapp(): Readonly<EstadoConector> {
  return { ...estado };
}

export interface OpcoesWhatsapp {
  /** Vazio no papel administrativo: lá ninguém responde. */
  agentSlug: string;
  venueSlug: string;
  papel?: PapelWhatsapp;
}

/**
 * Sobe o conector e mantém a conexão. Reconecta sozinho, exceto quando a
 * sessão foi encerrada no celular — aí é preciso parear de novo.
 */
export async function iniciarWhatsapp(opcoes: OpcoesWhatsapp): Promise<void> {
  parando = false;
  const papel = opcoes.papel ?? "agente";
  const pasta = pastaDaSessao(papel);
  await mkdir(pasta, { recursive: true });
  await herdarSessaoAntiga(papel, pasta);
  const { state, saveCreds } = await useMultiFileAuthState(pasta);

  estado.status = "conectando";
  estado.iniciadoEm = Date.now();
  estado.agentSlug = opcoes.agentSlug;
  estado.venueSlug = opcoes.venueSlug;
  estado.papel = papel;

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
    // Notificação sai preferencialmente pelo administrativo — é o número que
    // a equipe conhece e para o qual pode responder sem ser atendida por uma
    // IA. Sem administrativo conectado, o agente serve: melhor a mensagem
    // sair pelo número do atendimento do que não sair.
    registrarProvedorWhatsapp(enviarPeloWhatsapp, estado.papel);
    iniciarFilaDeNotificacoes();
    console.log(
      `[whatsapp:${estado.papel}] conectado como ${estado.telefone ?? "?"}` +
        (estado.papel === "administrativo" ? " — só envia, não responde." : ""),
    );
  }

  if (connection === "close") {
    const codigo = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
    const deslogado = codigo === DisconnectReason.loggedOut;

    estado.status = "desconectado";
    estado.ultimoErro = lastDisconnect?.error?.message ?? null;
    // Sem conexão, as notificações voltam para a fila até reconectar. Com o
    // papel: derrubar o administrativo não pode apagar o provedor do agente,
    // que continua vivo e serve de rede.
    registrarProvedorWhatsapp(null, estado.papel);
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

  // O NÚMERO ADMINISTRATIVO NÃO RESPONDE.
  //
  // Ele existe para enviar: link de checklist, confirmação de reserva, aviso
  // de ruptura. Quem recebe é a equipe, e a equipe responde "ok" — se a IA
  // atendesse, o cozinheiro seria tratado como cliente novo querendo reserva.
  // Registrar em log basta: mensagem importante ("não abre o link") aparece
  // para quem lê o log do conector, e o funcionário fala com o gerente pelo
  // caminho de sempre.
  if ((opcoes.papel ?? "agente") === "administrativo") {
    const de = mensagem.pushName?.trim() || jid.split("@")[0];
    console.log(`[whatsapp:adm] ${de} respondeu — número administrativo não atende.`);
    return;
  }

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
    // Plano travado não é falha técnica: o cliente do restaurante não pode
    // receber "erro" nem ficar no vácuo. Ele é acolhido com uma frase fixa
    // (custo zero, nenhuma chamada de IA) e a conversa já foi marcada para
    // atendimento humano lá no runAgent.
    if (e instanceof PlanoBloqueadoError) {
      console.warn(
        `[whatsapp] pontos esgotados: ${telefoneExibicao} não foi atendido pelo agente. ` +
          `Renove o plano no painel para religar.`,
      );
      await responder(
        jid,
        "Recebi sua mensagem! Em instantes alguém da equipe fala com você por aqui.",
      );
    } else {
      console.error(`[whatsapp] falha ao atender ${telefoneExibicao}:`, e);
      await responder(
        jid,
        "Tive um problema técnico aqui. Pode tentar de novo em instantes?",
      );
    }
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
  registrarProvedorWhatsapp(null, estado.papel);
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
