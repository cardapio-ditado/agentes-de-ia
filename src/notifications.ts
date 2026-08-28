import { db } from "./supabase.js";
import type { Tables } from "./database.types.js";
import type { Reservation, Venue } from "./venues.js";
import type { PapelWhatsapp } from "./ponteWhatsapp.js";

export type Notification = Tables<"notifications">;

const MAX_TENTATIVAS = 4;

// ============================================================
// Mensagens
// ============================================================
export type Template = "reserva_aprovada" | "reserva_recusada";

function formatarQuando(reserva: Reservation, venue: Venue): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: venue.timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(reserva.reserved_for));
}

/** Primeiro nome — mais natural em mensagem curta que o nome completo. */
function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

export function montarMensagem(
  template: Template,
  reserva: Reservation,
  venue: Venue,
): string {
  const nome = primeiroNome(reserva.customer_name);
  const quando = formatarQuando(reserva, venue);
  const pessoas = `${reserva.party_size} pessoa${reserva.party_size > 1 ? "s" : ""}`;

  if (template === "reserva_aprovada") {
    const linhas = [
      `Olá, ${nome}! Sua reserva no ${venue.name} está confirmada. ✅`,
      ``,
      `${quando} — ${pessoas}`,
    ];
    if (reserva.area_preference) linhas.push(`Área: ${reserva.area_preference}`);
    linhas.push(``, `Está tudo certo — te aguardamos! 🥂`);
    linhas.push(`Se precisar alterar ou cancelar, é só responder por aqui.`);
    if (venue.phone) linhas.push(`Telefone: ${venue.phone}`);
    return linhas.join("\n");
  }

  const linhas = [
    `Olá, ${nome}. Infelizmente não conseguimos confirmar sua reserva no ${venue.name} para ${quando}.`,
  ];
  if (reserva.review_reason) linhas.push(``, `Motivo: ${reserva.review_reason}`);
  linhas.push(``, `Podemos tentar outro horário? É só responder por aqui.`);
  if (venue.phone) linhas.push(`Telefone: ${venue.phone}`);
  return linhas.join("\n");
}

// ============================================================
// Provedores
// ============================================================
export interface ResultadoEnvio {
  enviado: boolean;
  providerId?: string;
  erro?: string;
}

export type EnvioWhatsapp = (telefone: string, corpo: string) => Promise<ResultadoEnvio>;

/**
 * Um provedor por papel.
 *
 * Com duas conexões vivas (o número administrativo e o do agente), guardar um
 * provedor só faria o ÚLTIMO a conectar virar o remetente de tudo — inclusive
 * dos checklists, que sairiam pelo número do atendimento ao cliente. Quem
 * envia é escolhido por prioridade, não por ordem de chegada.
 */
const provedores: { administrativo: EnvioWhatsapp | null; agente: EnvioWhatsapp | null } = {
  administrativo: null,
  agente: null,
};

/** O administrativo é o remetente natural; o do agente é a rede de segurança. */
function provedorWhatsappAtivo(): EnvioWhatsapp | null {
  return provedores.administrativo ?? provedores.agente;
}

/**
 * O conector Baileys se registra aqui ao conectar.
 *
 * A inversão existe para evitar ciclo de import: o conector já depende deste
 * módulo (e do agente), então este módulo não pode depender dele.
 */
export function registrarProvedorWhatsapp(
  envio: EnvioWhatsapp | null,
  papel: "agente" | "administrativo" = "agente",
): void {
  provedores[papel] = envio;
}

function temCloudApi(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Provedor ativo, na ordem: Baileys conectado, depois Cloud API da Meta.
 *
 * Sem nenhum dos dois, cai no `console`: a mensagem é registrada no banco e
 * impressa no log em vez de sumir silenciosamente.
 */
export function canalAtivo(): "whatsapp" | "console" {
  return provedorWhatsappAtivo() || temCloudApi() ? "whatsapp" : "console";
}

async function enviarPorConsole(destino: string, corpo: string): Promise<ResultadoEnvio> {
  console.log(`\n--- notificação para ${destino} ---\n${corpo}\n---\n`);
  return { enviado: true, providerId: "console" };
}

/** Baileys quando conectado; senão, Cloud API da Meta. */
async function enviarPorWhatsapp(destino: string, corpo: string): Promise<ResultadoEnvio> {
  const provedor = provedorWhatsappAtivo();
  if (provedor) return await provedor(destino, corpo);
  if (!temCloudApi()) {
    return { enviado: false, erro: "Nenhum provedor de WhatsApp configurado." };
  }
  return await enviarPelaCloudApi(destino, corpo);
}

/**
 * WhatsApp Cloud API (Meta).
 *
 * Mensagem livre só é aceita dentro da janela de 24h desde a última mensagem
 * do cliente. Fora dela a Meta exige template aprovado — o envio falha e a
 * notificação fica registrada como `failed` para reenvio ou contato manual.
 */
async function enviarPelaCloudApi(destino: string, corpo: string): Promise<ResultadoEnvio> {
  const token = process.env.WHATSAPP_TOKEN!;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const versao = process.env.WHATSAPP_API_VERSION ?? "v21.0";

  const telefone = normalizarTelefone(destino);
  if (!telefone) return { enviado: false, erro: `Telefone inválido: "${destino}".` };

  try {
    const resposta = await fetch(
      `https://graph.facebook.com/${versao}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: telefone,
          type: "text",
          text: { body: corpo },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    const dados = (await resposta.json().catch(() => null)) as
      | { messages?: { id?: string }[]; error?: { message?: string } }
      | null;

    if (!resposta.ok) {
      return {
        enviado: false,
        erro: dados?.error?.message ?? `HTTP ${resposta.status} da API do WhatsApp.`,
      };
    }
    return { enviado: true, providerId: dados?.messages?.[0]?.id };
  } catch (e) {
    return { enviado: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================
// Instagram (API oficial da Meta, login pelo Instagram)
// ============================================================

export function instagramConfigurado(): boolean {
  return Boolean(process.env.INSTAGRAM_ACCESS_TOKEN);
}

/**
 * Envia um DM pela Graph API do Instagram.
 *
 * Diferente do Baileys, é só HTTPS com token — funciona em qualquer processo,
 * inclusive serverless. A janela de 24h da Meta se aplica: só dá para
 * responder quem mandou mensagem nas últimas 24 horas, que é exatamente o
 * caso das notificações de reserva.
 */
export async function enviarPorInstagram(
  igsid: string,
  corpo: string,
): Promise<ResultadoEnvio> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return { enviado: false, erro: "INSTAGRAM_ACCESS_TOKEN não configurado." };
  const versao = process.env.INSTAGRAM_API_VERSION ?? "v23.0";

  try {
    const resposta = await fetch(`https://graph.instagram.com/${versao}/me/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: igsid },
        message: { text: corpo },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const dados = (await resposta.json().catch(() => null)) as
      | { message_id?: string; error?: { message?: string } }
      | null;

    if (!resposta.ok) {
      return {
        enviado: false,
        erro: dados?.error?.message ?? `HTTP ${resposta.status} da API do Instagram.`,
      };
    }
    return { enviado: true, providerId: dados?.message_id };
  } catch (e) {
    return { enviado: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/** Formato E.164 sem "+", assumindo Brasil quando o país não vem no número. */
export function normalizarTelefone(bruto: string): string | null {
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if (digitos.length === 12 || digitos.length === 13) return digitos;
  return null;
}

/**
 * O mesmo celular brasileiro com e sem o nono dígito.
 *
 * O WhatsApp registrou muitos números antigos sem o 9 que a Anatel acrescentou
 * — quem digita "65 98138-2139" pode estar cadastrado como "65 8138-2139".
 * Errar isso manda a mensagem para um número que não existe, sem erro visível.
 */
export function variacoesDoTelefone(e164: string): string[] {
  const variacoes = [e164];
  if (!e164.startsWith("55")) return variacoes;

  const ddd = e164.slice(2, 4);
  const resto = e164.slice(4);
  if (resto.length === 9 && resto.startsWith("9")) variacoes.push(`55${ddd}${resto.slice(1)}`);
  else if (resto.length === 8) variacoes.push(`55${ddd}9${resto}`);
  return variacoes;
}

/**
 * Endereço de WhatsApp já usado numa conversa com este número.
 *
 * É a fonte mais confiável que existe: se recebemos mensagem dali, dali se
 * responde. Contas migradas para LID só são alcançáveis por esse endereço —
 * reconstruir a partir do telefone aponta para o vazio.
 */
export async function jidConhecidoDoTelefone(
  candidatos: string[],
  venueId?: string | null,
): Promise<string | null> {
  let busca = db()
    .from("conversations")
    .select("external_id, metadata")
    .eq("channel", "whatsapp");
  // Só as conversas DESTA casa: o endereço aprendido no número do Ditado não
  // serve para o conector do The 20 — e olhar a conversa de outro bar é
  // exatamente o "compartilhar" que o multi-casa proíbe.
  if (venueId) busca = busca.eq("venue_id", venueId);
  const { data, error } = await busca.order("updated_at", { ascending: false }).limit(200);
  if (error || !data) return null;

  const alvos = new Set(candidatos);
  for (const conversa of data) {
    if (!conversa.external_id) continue;
    const meta = (conversa.metadata ?? {}) as Record<string, unknown>;
    const contato = typeof meta.contato === "string" ? meta.contato.replace(/\D/g, "") : "";
    const doExternalId = conversa.external_id.split("@")[0]?.replace(/\D/g, "") ?? "";

    for (const digitos of [contato, doExternalId]) {
      if (!digitos) continue;
      const normalizado = normalizarTelefone(digitos);
      if (!normalizado) continue;
      if (variacoesDoTelefone(normalizado).some((v) => alvos.has(v))) {
        return conversa.external_id;
      }
    }
  }
  return null;
}

// ============================================================
// Fila
// ============================================================

/**
 * Prefere o endereço exato da conversa ao telefone que o cliente digitou.
 *
 * O endereço da conversa é garantidamente roteável — acabamos de receber
 * mensagem dali — e carrega o canal certo: reserva feita pelo Instagram é
 * confirmada pelo Instagram, não por um WhatsApp que talvez nem exista. O
 * telefone digitado é texto livre (erro de digitação, contas LID); só é
 * usado quando não há conversa vinculada (reserva lançada manualmente).
 */
async function resolverEntrega(
  reserva: Reservation,
): Promise<{ destino: string; canal: "whatsapp" | "instagram" }> {
  const padrao = { destino: reserva.customer_phone, canal: "whatsapp" as const };
  if (!reserva.conversation_id) return padrao;

  const { data, error } = await db()
    .from("conversations")
    .select("channel, external_id")
    .eq("id", reserva.conversation_id)
    .maybeSingle();

  if (error || !data?.external_id) return padrao;
  if (data.channel === "whatsapp") return { destino: data.external_id, canal: "whatsapp" };
  if (data.channel === "instagram") return { destino: data.external_id, canal: "instagram" };
  return padrao;
}

/**
 * Registra a notificação e tenta enviar na hora.
 *
 * Nunca lança: uma falha de envio não pode desfazer a aprovação já gravada.
 * O que não sair fica como `failed` e o worker de reenvio cuida depois.
 */
export async function notificarCliente(params: {
  template: Template;
  reserva: Reservation;
  venue: Venue;
}): Promise<Notification | null> {
  const { template, reserva, venue } = params;
  const corpo = montarMensagem(template, reserva, venue);
  const entrega = await resolverEntrega(reserva);

  // A notificação sai pelo canal da conversa de origem. O processo que
  // aprovou pode não ter provedor de WhatsApp (painel na Vercel, onde o
  // Baileys não roda) — nesse caso ela NÃO é "enviada" para um console que
  // ninguém lê: fica `pending` na fila, e o conector, onde estiver rodando,
  // entrega em segundos. Instagram é só HTTPS e sai de qualquer processo.
  const { data: notificacao, error } = await db()
    .from("notifications")
    .insert({
      venue_id: venue.id,
      reservation_id: reserva.id,
      channel: entrega.canal,
      destination: entrega.destino,
      template,
      // A CONFIRMAÇÃO VOLTA PELO NÚMERO EM QUE O CLIENTE PEDIU.
      //
      // Ele conversou com o agente para reservar; receber a resposta de um
      // número desconhecido é o mesmo que não reconhecer a reserva. E se ele
      // responder "obrigado, dá para mudar para as 21h?", quem precisa estar
      // do outro lado é justamente a IA.
      papel: "agente",
      body: corpo,
      // `as never` até `database.types.ts` ser regerado com a coluna `papel`.
    } as never)
    .select()
    .single();

  if (error) {
    console.error(`[notifications] não registrou a notificação: ${error.message}`);
    return null;
  }

  if (entrega.canal === "whatsapp" && canalAtivo() === "console") {
    console.log(
      `[notifications] sem provedor de WhatsApp neste processo — ` +
        `notificação ${notificacao.id} aguardando o conector na fila.`,
    );
    return notificacao;
  }

  return await tentarEnviar(notificacao);
}

/** Tenta enviar uma notificação já registrada e atualiza o resultado. */
export async function tentarEnviar(notificacao: Notification): Promise<Notification> {
  const resultado =
    notificacao.channel === "whatsapp"
      ? await enviarPorWhatsapp(notificacao.destination, notificacao.body)
      : notificacao.channel === "instagram"
        ? await enviarPorInstagram(notificacao.destination, notificacao.body)
        : await enviarPorConsole(notificacao.destination, notificacao.body);

  const { data, error } = await db()
    .from("notifications")
    .update({
      status: resultado.enviado ? "sent" : "failed",
      attempts: notificacao.attempts + 1,
      error: resultado.erro ?? null,
      provider_id: resultado.providerId ?? null,
      sent_at: resultado.enviado ? new Date().toISOString() : null,
    })
    .eq("id", notificacao.id)
    .select()
    .single();

  if (error) {
    console.error(`[notifications] não atualizou o status: ${error.message}`);
    return notificacao;
  }
  if (!resultado.enviado) {
    console.error(`[notifications] ${notificacao.id} falhou: ${resultado.erro}`);
  }
  return data;
}

/**
 * Quanto tempo um aviso espera pelo número certo antes de aceitar o outro.
 *
 * O administrativo reinicia (systemd sobe de novo em 5 segundos) e some da
 * ponte por até 45. Sem carência, esses 45 segundos bastavam para o agente
 * assumir um lote inteiro de convites de pesquisa e mandá-los pelo número
 * que responde com IA — dano que não se desfaz, porque mensagem enviada não
 * volta.
 *
 * Dez minutos é a conta: muito mais que qualquer reinício, muito menos que um
 * conector realmente morto. Passado isso, entregar pelo número errado é
 * melhor que não entregar — o checklist das 17h não pode esperar o técnico.
 */
export const CARENCIA_DO_OUTRO_PAPEL_MS = 10 * 60_000;

/**
 * O filtro que decide o que ESTE conector pode entregar agora.
 *
 * Três casos, nesta ordem de leitura: o que é meu; o que não tem dono (tudo
 * que existia antes desta coluna, e o que nenhum produtor marcou); e o que é
 * do outro mas está parado há tempo demais para continuar esperando.
 *
 * Separado da consulta porque é a regra que decide qual número o cliente vê —
 * e regra que decide isso merece teste, não confiança.
 */
export function filtroDePapel(papel: PapelWhatsapp, agora = new Date()): string {
  const corte = new Date(agora.getTime() - CARENCIA_DO_OUTRO_PAPEL_MS).toISOString();
  return `papel.is.null,papel.eq.${papel},created_at.lt.${corte}`;
}

/**
 * Notificações que ainda merecem uma nova tentativa.
 *
 * Com `venueId`, só as DAQUELA casa: cada conector entrega as mensagens do
 * seu estabelecimento e de mais nenhum — sem o filtro, o convite de pesquisa
 * do The 20 sairia pelo número do Ditado, com o nome do bar errado no perfil.
 *
 * Com `papel`, só as que são deste número. Sem ele (scripts de reenvio, testes
 * manuais), a fila inteira, como sempre foi.
 */
export async function listPendingNotifications(
  limite = 50,
  venueId?: string | null,
  papel?: PapelWhatsapp | null,
): Promise<Notification[]> {
  let busca = db()
    .from("notifications")
    .select("*")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_TENTATIVAS);
  if (venueId) busca = busca.eq("venue_id", venueId);
  if (papel) busca = busca.or(filtroDePapel(papel));
  const { data, error } = await busca.order("created_at", { ascending: true }).limit(limite);

  if (error) {
    // Banco sem a migração ainda: a coluna não existe, e a fila volta a ser
    // uma só em vez de parar. Degradar é melhor que emudecer.
    if (papel && /papel|42703|PGRST/i.test(error.message)) {
      return await listPendingNotifications(limite, venueId, null);
    }
    throw new Error(`Falha ao listar notificações: ${error.message}`);
  }
  return data ?? [];
}

export async function listNotificationsForReservation(
  reservationId: string,
): Promise<Notification[]> {
  const { data, error } = await db()
    .from("notifications")
    .select("*")
    .eq("reservation_id", reservationId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Falha ao listar notificações: ${error.message}`);
  return data ?? [];
}
