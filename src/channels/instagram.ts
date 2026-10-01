import { createHmac, timingSafeEqual } from "node:crypto";
import { runAgent } from "../agent.js";
import { conversaAtendidaPorHumano, registrarRecebidoSemResposta } from "../inbox.js";
import { enviarPorInstagram } from "../notifications.js";
import { conexaoPelaConta, loginDisponivel, type ConexaoInstagram } from "../instagramOficial.js";
import {
  AVISO_PUBLICO_PADRAO,
  anotarComentario,
  comentariosDoEntry,
  contextoDoComentario,
  legendaDoPost,
  mereceDirect,
  modoValido,
  reservarComentario,
  responderNoDirect,
  responderNoPost,
  type ComentarioRecebido,
} from "../instagramComentarios.js";
import { findVenueBySlug } from "../venues.js";

/**
 * Canal Instagram — API oficial de mensagens da Meta (login pelo Instagram).
 *
 * Ao contrário do WhatsApp/Baileys, aqui não há processo persistente nem QR:
 * a Meta entrega cada DM por webhook (HTTPS puro, roda na Vercel) e a
 * resposta sai pela Graph API com o token da casa. Sem risco de banimento —
 * é o caminho sancionado.
 *
 * O webhook é UM para todas as casas. Cada evento diz de qual conta
 * profissional ele é (`entry.id`), e é por ela que se acha a casa, o token
 * e o agente — na tabela `instagram_oficial`, preenchida pelo botão
 * "Conectar Instagram". As variáveis de ambiente (token, agente, casa)
 * seguem valendo como a conexão da casa que elas nomeiam, enquanto a linha
 * dela não existe no banco.
 *
 * Configuração do APP (uma vez, na Vercel):
 *   INSTAGRAM_APP_ID        — o "ID do app do Instagram" (produto Instagram)
 *   INSTAGRAM_APP_SECRET    — o segredo dele: valida os webhooks e troca o código do login
 *   INSTAGRAM_VERIFY_TOKEN  — string qualquer, a mesma colada no painel da Meta
 *
 * A janela de 24h da Meta se aplica: o agente responde quem escreveu por
 * último em até 24 horas — exatamente o caso de uso de atendimento.
 */

interface EventoMensagem {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: unknown[];
  };
}

interface CorpoWebhook {
  object?: string;
  entry?: Array<{ id?: string; messaging?: EventoMensagem[]; changes?: unknown[] }>;
}

function config() {
  return {
    appSecret: process.env.INSTAGRAM_APP_SECRET,
    verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN,
    versao: process.env.INSTAGRAM_API_VERSION ?? "v23.0",
  };
}

/** Para a aba Canais: o que o APP tem (ou não), sem expor segredos. */
export function estadoInstagram(): {
  webhook_pronto: boolean;
  login_disponivel: boolean;
  faltando: string[];
  /** O jeito antigo (uma casa só pelas variáveis), se ainda estiver em uso. */
  casa_das_variaveis: string | null;
  agente_das_variaveis: string | null;
} {
  const cfg = config();
  const faltando = (
    [
      ["INSTAGRAM_APP_ID", process.env.INSTAGRAM_APP_ID],
      ["INSTAGRAM_APP_SECRET", cfg.appSecret],
      ["INSTAGRAM_VERIFY_TOKEN", cfg.verifyToken],
    ] as const
  )
    .filter(([, valor]) => !valor)
    .map(([nome]) => nome);

  return {
    webhook_pronto: Boolean(cfg.appSecret && cfg.verifyToken),
    login_disponivel: loginDisponivel(),
    faltando,
    casa_das_variaveis: process.env.INSTAGRAM_ACCESS_TOKEN ? process.env.INSTAGRAM_VENUE ?? null : null,
    agente_das_variaveis: process.env.INSTAGRAM_ACCESS_TOKEN ? process.env.INSTAGRAM_AGENT ?? null : null,
  };
}

/**
 * Etapa de verificação do webhook (GET da Meta ao salvar a URL).
 * Devolve o challenge a ecoar, ou null para recusar.
 */
export function verificarWebhook(params: URLSearchParams): string | null {
  const cfg = config();
  if (!cfg.verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== cfg.verifyToken) return null;
  return params.get("hub.challenge");
}

/** Assinatura HMAC-SHA256 do corpo cru, enviada em X-Hub-Signature-256. */
export function assinaturaValida(corpoBruto: Buffer, cabecalho: string | undefined): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const recebida = Buffer.from(cabecalho.slice("sha256=".length), "hex");

  // O app da Meta tem DOIS segredos: o do app do Instagram (na tela do
  // produto Instagram) e o do app em si (Configurações → Básico). A Meta
  // assina o webhook com um deles, e qual é muda conforme o app foi
  // montado. Aceitar os dois é o que evita um 403 silencioso na
  // primeira mensagem.
  const segredos = [process.env.INSTAGRAM_APP_SECRET, process.env.WHATSAPP_APP_SECRET].filter((s): s is string => Boolean(s));
  return segredos.some((segredo) => {
    const esperada = createHmac("sha256", segredo).update(corpoBruto).digest();
    return esperada.length === recebida.length && timingSafeEqual(esperada, recebida);
  });
}

/** Nome e @usuário do interlocutor, para a inbox. Falha vira null, nunca erro. */
async function buscarPerfil(
  igsid: string,
  token: string,
): Promise<{ nome: string | null; usuario: string | null }> {
  const cfg = config();
  try {
    const resposta = await fetch(
      `https://graph.instagram.com/${cfg.versao}/${igsid}?fields=name,username`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!resposta.ok) return { nome: null, usuario: null };
    const dados = (await resposta.json()) as { name?: string; username?: string };
    return { nome: dados.name ?? null, usuario: dados.username ?? null };
  } catch {
    return { nome: null, usuario: null };
  }
}

/**
 * Processa um lote de eventos do webhook: acha a casa pela conta, roda o
 * agente dela e responde o DM.
 *
 * Sempre resolve — erros são logados, nunca propagados: devolver 5xx à Meta
 * dispara tempestade de reentregas, e a mensagem duplicada é pior que a
 * mensagem perdida (o cliente reenvia sozinho quando não é respondido).
 */
export async function processarWebhookInstagram(corpo: CorpoWebhook): Promise<void> {
  if (corpo.object !== "instagram") return;

  for (const entry of corpo.entry ?? []) {
    const conexao = await conexaoPelaConta(entry.id).catch((e) => {
      console.error(`[instagram] não achei a casa da conta ${entry.id}: ${(e as Error).message}`);
      return null;
    });
    if (!conexao) {
      console.error(`[instagram] DM para a conta ${entry.id ?? "?"}, que nenhuma casa conectou. Ignorado.`);
      continue;
    }
    if (!conexao.agent_slug) {
      console.log(`[instagram] @${conexao.usuario ?? entry.id}: conta conectada sem agente — ninguém responde.`);
      continue;
    }
    const pronta = conexao as ConexaoInstagram & { venue_slug: string; agent_slug: string };
    for (const evento of entry.messaging ?? []) {
      try {
        await processarEvento(evento, pronta);
      } catch (e) {
        console.error("[instagram] falha ao processar evento:", e);
      }
    }
    // Comentários nos posts vêm no mesmo webhook, em `changes`.
    for (const comentario of comentariosDoEntry(entry)) {
      try {
        await processarComentario(comentario, pronta);
      } catch (e) {
        console.error("[instagram] falha ao processar comentário:", e);
      }
    }
  }
}

/**
 * Um comentário num post: peneira, agente, direct — e, se a casa quiser,
 * uma frase fixa no post.
 *
 * A conversa fica com o id da PESSOA, não do comentário: quando ela
 * responder o direct, é o mesmo fio. O agente sabe que começou num
 * comentário e de qual post, pelo contexto.
 */
async function processarComentario(
  c: ComentarioRecebido,
  conexao: ConexaoInstagram & { venue_slug: string; agent_slug: string },
): Promise<void> {
  const modo = modoValido(conexao.comentarios) ?? "privado";
  if (modo === "desligado") return;
  // A própria casa respondendo no post (inclusive a nossa frase fixa)
  // volta pelo webhook como comentário novo.
  if (!c.autor_id || c.autor_id === conexao.ig_user_id) return;
  if (!(await reservarComentario(conexao.venue_id, c))) return;

  const venue = await findVenueBySlug(conexao.venue_slug);
  const legenda = await legendaDoPost(conexao, c.media_id);
  if (!(await mereceDirect({ casa: venue.name, legenda, texto: c.texto }))) {
    await anotarComentario(c.id, "ignorado");
    console.log(`[instagram] comentário de @${c.autor ?? c.autor_id} ignorado: "${c.texto.slice(0, 60)}"`);
    return;
  }

  const resultado = await runAgent({
    agentSlug: conexao.agent_slug,
    venueSlug: conexao.venue_slug,
    userMessage: c.texto,
    channel: "instagram",
    externalId: c.autor_id,
    contato: { nome: c.autor, telefone: c.autor ? `@${c.autor}` : null },
    contextoExtra: contextoDoComentario({ autor: c.autor, texto: c.texto, legenda, casa: venue.name }),
  });
  if (!resultado.respondeu) {
    await anotarComentario(c.id, "ignorado", "conversa com pessoa no comando");
    return;
  }

  const direct = await responderNoDirect(conexao, c.id, resultado.text || "Oi! Vi seu comentário no nosso post — me conta o que você precisa?");
  if (!direct.ok) {
    console.error(`[instagram] direct para o comentário ${c.id} falhou: ${direct.erro}`);
    await anotarComentario(c.id, "falhou", direct.erro);
    return;
  }

  let acao = "direct";
  if (modo === "publico_e_privado") {
    const publico = await responderNoPost(conexao, c.id, conexao.comentarios_aviso?.trim() || AVISO_PUBLICO_PADRAO);
    if (publico.ok) acao = "direct_e_post";
    else console.error(`[instagram] resposta no post ${c.id} falhou: ${publico.erro}`);
  }
  await anotarComentario(c.id, acao);
  console.log(`[instagram] comentário de @${c.autor ?? c.autor_id} → ${acao}`);
}

async function processarEvento(
  evento: EventoMensagem,
  conexao: ConexaoInstagram & { venue_slug: string; agent_slug: string },
): Promise<void> {
  const igsid = evento.sender?.id;
  const mensagem = evento.message;
  // Ecos (mensagens enviadas por nós), reações e confirmações de leitura
  // chegam pelo mesmo webhook — só DM de cliente interessa.
  if (!igsid || !mensagem || mensagem.is_echo) return;
  // A própria conta falando (pelo app do Instagram) também não é cliente.
  if (conexao.ig_user_id && igsid === conexao.ig_user_id) return;

  const agentSlug = conexao.agent_slug;
  const venueSlug = conexao.venue_slug;
  const token = conexao.token;

  const texto = mensagem.text?.trim();
  if (!texto) {
    if (mensagem.attachments?.length) {
      // Mesma regra do WhatsApp: com uma pessoa no comando, o robô não
      // agradece a foto — registra que chegou e fica quieto.
      const humana = await conversaAtendidaPorHumano({ agentSlug, channel: "instagram", externalId: igsid });
      if (humana) {
        await registrarRecebidoSemResposta(humana.id, "[mídia recebida]").catch(() => undefined);
        console.log(`[instagram] ${igsid}: mídia numa conversa com pessoa — não respondi.`);
        return;
      }
      await enviarPorInstagram(
        igsid,
        "Recebi sua mídia! Consigo te ajudar melhor por texto — me conta o que você precisa?",
        token,
      );
    }
    return;
  }

  const perfil = await buscarPerfil(igsid, token);
  console.log(`[instagram] @${conexao.usuario ?? venueSlug} ← ${perfil.usuario ?? igsid}: ${texto.slice(0, 80)}`);

  const resultado = await runAgent({
    agentSlug,
    venueSlug,
    userMessage: texto,
    channel: "instagram",
    externalId: igsid,
    contato: {
      nome: perfil.nome ?? perfil.usuario,
      telefone: perfil.usuario ? `@${perfil.usuario}` : null,
    },
  });

  // Alguém do salão assumiu esta conversa: o agente não fala por cima.
  if (!resultado.respondeu) {
    console.log(`[instagram] ${perfil.usuario ?? igsid}: atendimento é humano, não respondi.`);
    return;
  }

  const envio = await enviarPorInstagram(
    igsid,
    resultado.text || "Desculpe, não consegui responder agora. Pode tentar de novo?",
    token,
  );
  if (!envio.enviado) {
    console.error(`[instagram] falha ao responder ${igsid}: ${envio.erro}`);
  }
}
