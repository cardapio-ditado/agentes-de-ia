import Anthropic from "@anthropic-ai/sdk";
import { modeloDaTarefa } from "./modelos.js";
import { randomBytes, randomUUID } from "node:crypto";
import { anthropicConfig } from "./config.js";
import { db } from "./supabase.js";
import type { Json, Tables, TablesInsert } from "./database.types.js";
import type { Venue } from "./venues.js";

export type Checklist = Tables<"checklists">;
export type ChecklistRun = Tables<"checklist_runs">;

/**
 * Checklist Inteligente.
 *
 * O modelo (perguntas + agenda) vive em `checklists`; cada dia agendado gera
 * uma execução em `checklist_runs` com um token público — quem preenche
 * recebe o link pelo WhatsApp e abre no celular, sem login e sem instalar
 * nada. Ao concluir, a IA lê as respostas, resume o turno e aponta o que
 * precisa de atenção; o resultado chega no WhatsApp de quem gerencia.
 */

const DIAS_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as const;
const MODELO_IA = () => modeloDaTarefa("checklists");
export const LIMITE_FOTO_BYTES = 8_000_000;

export interface ItemChecklist {
  id: string;
  tipo: "sim_nao" | "texto" | "foto";
  pergunta: string;
  obrigatorio: boolean;
}

export interface AgendaChecklist {
  /** Dias da semana em que roda (DIAS_SEMANA). Vazio = só disparo manual. */
  dias: string[];
  /** Hora local da casa em que o link é enviado, "HH:MM". */
  hora: string;
  responsavel_nome: string;
  /** WhatsApp de quem executa — recebe o link. */
  responsavel_telefone: string;
  /**
   * WhatsApp de quem acompanha o resultado — recebe o resumo da IA.
   *
   * Aceita MAIS DE UM, separados por vírgula: numa casa de verdade quem
   * cobra o checklist não é uma pessoa só — o gerente responde pelo turno e
   * o líder está no salão. Guardado como texto (e não lista) porque é o
   * formato que já está gravado em produção; quem lê usa `telefonesDeAviso`.
   * Vazio = ninguém.
   */
  avisar_telefone: string;
}

/**
 * Os números que recebem o resumo, um por destinatário.
 *
 * Aceita vírgula, ponto-e-vírgula, barra e quebra de linha como separador —
 * quem digita não vai lembrar qual é o certo, e recusar por causa da
 * pontuação seria transformar um detalhe em suporte. Repetido entra uma vez
 * só: o mesmo gerente cadastrado duas vezes receberia a mensagem em dobro.
 */
export function telefonesDeAviso(bruto: string): string[] {
  const vistos = new Set<string>();
  for (const pedaco of (bruto ?? "").split(/[,;/\n]+/)) {
    const limpo = pedaco.trim();
    if (!limpo) continue;
    // Só dígitos para comparar: "(65) 99999-0000" e "65999990000" são a
    // mesma pessoa, e sem isto os dois formatos virariam duas mensagens.
    const digitos = limpo.replace(/\D/g, "");
    if (digitos.length < 10 || digitos.length > 15) continue;
    if (vistos.has(digitos)) continue;
    vistos.add(digitos);
  }
  return [...vistos];
}

export interface RespostaItem {
  item: string;
  valor: string | null;
  foto: string | null;
  observacao: string | null;
}

let cachedClient: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic({ apiKey: anthropicConfig().apiKey });
  return cachedClient;
}

// ============================================================
// Validação
// ============================================================

function comoObjeto(valor: Json | null | undefined): Record<string, Json | undefined> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, Json | undefined>)
    : {};
}

export function validarItens(bruto: unknown): ItemChecklist[] {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    throw new Error("O checklist precisa de ao menos uma pergunta.");
  }
  if (bruto.length > 60) throw new Error("Máximo de 60 perguntas por checklist.");

  return bruto.map((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const tipo = o.tipo;
    if (tipo !== "sim_nao" && tipo !== "texto" && tipo !== "foto") {
      throw new Error(`Pergunta ${i + 1}: tipo inválido.`);
    }
    const pergunta = typeof o.pergunta === "string" ? o.pergunta.trim() : "";
    if (!pergunta) throw new Error(`Pergunta ${i + 1}: o texto não pode ficar vazio.`);
    return {
      id: typeof o.id === "string" && o.id ? o.id : randomUUID(),
      tipo,
      pergunta,
      obrigatorio: o.obrigatorio !== false,
    };
  });
}

export function validarAgenda(bruto: unknown): AgendaChecklist {
  const o = comoObjeto(bruto as Json);
  const dias = Array.isArray(o.dias)
    ? o.dias.filter((d): d is string => typeof d === "string" && DIAS_SEMANA.includes(d as never))
    : [];
  const hora = typeof o.hora === "string" && /^\d{2}:\d{2}$/.test(o.hora) ? o.hora : "09:00";
  const texto = (v: Json | undefined) => (typeof v === "string" ? v.trim() : "");

  const agenda: AgendaChecklist = {
    dias,
    hora,
    responsavel_nome: texto(o.responsavel_nome),
    responsavel_telefone: texto(o.responsavel_telefone),
    avisar_telefone: texto(o.avisar_telefone),
  };
  if (dias.length > 0 && !agenda.responsavel_telefone) {
    throw new Error("Checklist agendado precisa do WhatsApp de quem vai executar.");
  }
  return agenda;
}

export function agendaDe(checklist: Checklist): AgendaChecklist {
  return validarAgendaBranda(checklist.schedule);
}

/** Como validarAgenda, mas sem lançar — dados já gravados não podem quebrar leitura. */
function validarAgendaBranda(bruto: Json): AgendaChecklist {
  try {
    return validarAgenda(bruto);
  } catch {
    const o = comoObjeto(bruto);
    return {
      dias: [],
      hora: "09:00",
      responsavel_nome: typeof o.responsavel_nome === "string" ? o.responsavel_nome : "",
      responsavel_telefone:
        typeof o.responsavel_telefone === "string" ? o.responsavel_telefone : "",
      avisar_telefone: typeof o.avisar_telefone === "string" ? o.avisar_telefone : "",
    };
  }
}

export function itensDe(checklist: Checklist): ItemChecklist[] {
  return Array.isArray(checklist.items) ? (checklist.items as unknown as ItemChecklist[]) : [];
}

// ============================================================
// CRUD dos modelos
// ============================================================

export async function listChecklists(venueId: string): Promise<Checklist[]> {
  const { data, error } = await db()
    .from("checklists")
    .select("*")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Falha ao listar checklists: ${error.message}`);
  return data ?? [];
}

export async function createChecklist(params: {
  venueId: string;
  name: string;
  description: string | null;
  items: ItemChecklist[];
  schedule: AgendaChecklist;
}): Promise<Checklist> {
  const { data, error } = await db()
    .from("checklists")
    .insert({
      venue_id: params.venueId,
      name: params.name,
      description: params.description,
      items: params.items as unknown as Json,
      schedule: params.schedule as unknown as Json,
    })
    .select()
    .single();
  if (error) throw new Error(`Falha ao criar o checklist: ${error.message}`);
  return data;
}

export async function updateChecklist(
  checklistId: string,
  venueId: string,
  mudancas: Partial<Pick<TablesInsert<"checklists">, "name" | "description" | "items" | "schedule" | "active">>,
): Promise<Checklist> {
  const { data, error } = await db()
    .from("checklists")
    .update({ ...mudancas, updated_at: new Date().toISOString() })
    .eq("id", checklistId)
    .eq("venue_id", venueId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Falha ao atualizar o checklist: ${error.message}`);
  if (!data) throw new Error("Checklist não encontrado.");
  return data;
}

export async function deleteChecklist(checklistId: string, venueId: string): Promise<void> {
  const { error } = await db()
    .from("checklists")
    .delete()
    .eq("id", checklistId)
    .eq("venue_id", venueId);
  if (error) throw new Error(`Falha ao excluir o checklist: ${error.message}`);
}

export async function getChecklistInVenue(
  checklistId: string,
  venueId: string,
): Promise<Checklist | null> {
  const { data, error } = await db()
    .from("checklists")
    .select("*")
    .eq("id", checklistId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao buscar o checklist: ${error.message}`);
  return data;
}

// ============================================================
// Agendamento
// ============================================================

/** Partes de data/hora de um instante, no fuso da casa. */
export function agoraLocal(instante: Date, timezone: string): {
  dia: string;
  data: string;
  hhmm: string;
} {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    })
      .formatToParts(instante)
      .map((p) => [p.type, p.value]),
  );
  const MAPA_DIA: Record<string, string> = {
    "Mon": "seg", "Tue": "ter", "Wed": "qua", "Thu": "qui",
    "Fri": "sex", "Sat": "sab", "Sun": "dom",
    "Mon.": "seg", "Tue.": "ter", "Wed.": "qua", "Thu.": "qui",
    "Fri.": "sex", "Sat.": "sab", "Sun.": "dom",
  };
  return {
    dia: MAPA_DIA[partes.weekday ?? ""] ?? "",
    data: `${partes.year}-${partes.month}-${partes.day}`,
    hhmm: `${partes.hour}:${partes.minute}`,
  };
}

/** O checklist deve rodar agora? Dia bate e a hora de envio já chegou. */
export function estaNaHora(agenda: AgendaChecklist, instante: Date, timezone: string): boolean {
  if (agenda.dias.length === 0) return false;
  const local = agoraLocal(instante, timezone);
  return agenda.dias.includes(local.dia) && local.hhmm >= agenda.hora;
}

function novoToken(): string {
  return `chk_${randomBytes(18).toString("hex")}`;
}

function linkDaExecucao(token: string): string {
  const base = (process.env.PUBLIC_URL ?? "https://agentes-de-ia-alpha.vercel.app").replace(/\/$/, "");
  return `${base}/checklist?t=${token}`;
}

/**
 * Cria a execução do dia (se ainda não existe) e enfileira o link no
 * WhatsApp do responsável. Idempotente: o índice único por (checklist, dia)
 * segura duplicatas mesmo com o agendador rodando de novo.
 */
export async function dispararChecklist(
  checklist: Checklist,
  venue: Pick<Venue, "id" | "name" | "timezone">,
  dataLocal?: string,
): Promise<{ run: ChecklistRun; criadaAgora: boolean }> {
  const data = dataLocal ?? agoraLocal(new Date(), venue.timezone).data;

  const { data: criada, error } = await db()
    .from("checklist_runs")
    .insert({
      checklist_id: checklist.id,
      venue_id: checklist.venue_id,
      token: novoToken(),
      scheduled_for: data,
    })
    .select()
    .maybeSingle();

  if (error) {
    // Índice único: já existe a execução de hoje — busca e devolve.
    const { data: existente, error: erroBusca } = await db()
      .from("checklist_runs")
      .select("*")
      .eq("checklist_id", checklist.id)
      .eq("scheduled_for", data)
      .single();
    if (erroBusca) throw new Error(`Falha ao disparar o checklist: ${error.message}`);
    return { run: existente, criadaAgora: false };
  }

  const agenda = agendaDe(checklist);
  if (agenda.responsavel_telefone) {
    const nome = agenda.responsavel_nome ? `${agenda.responsavel_nome.split(/\s+/)[0]}, ` : "";
    const corpo = [
      `${nome}chegou a hora do checklist! 📋`,
      ``,
      `${checklist.name} — ${venue.name}`,
      `Preencha por aqui (abre direto no navegador):`,
      linkDaExecucao(criada!.token),
    ].join("\n");

    const { error: erroNotif } = await db().from("notifications").insert({
      venue_id: venue.id,
      channel: "whatsapp",
      destination: agenda.responsavel_telefone,
      template: "checklist_link",
      papel: "administrativo",
      body: corpo,
      // `as never` até `database.types.ts` ser regerado com a coluna `papel`.
    } as never);
    if (erroNotif) console.error(`[checklists] não enfileirou o link: ${erroNotif.message}`);
  }

  return { run: criada!, criadaAgora: true };
}

/**
 * Varre os checklists ativos e dispara os que estão na hora. Chamado pelo
 * processo longo (PC/VPS) a cada minuto — o mesmo lugar que entrega as
 * notificações, então o link sai na sequência.
 */
export async function dispararChecklistsAgendados(): Promise<number> {
  const { data: ativos, error } = await db()
    .from("checklists")
    .select("*, venues:venue_id(id, name, timezone)")
    .eq("active", true);
  if (error) throw new Error(`Falha ao varrer checklists: ${error.message}`);

  let disparados = 0;
  const agora = new Date();
  for (const linha of ativos ?? []) {
    const venue = (linha as unknown as { venues: Pick<Venue, "id" | "name" | "timezone"> }).venues;
    if (!venue) continue;
    const checklist = linha as unknown as Checklist;
    if (!estaNaHora(agendaDe(checklist), agora, venue.timezone)) continue;
    try {
      const { criadaAgora } = await dispararChecklist(checklist, venue);
      if (criadaAgora) {
        disparados += 1;
        console.log(`[checklists] "${checklist.name}" disparado para hoje.`);
      }
    } catch (e) {
      console.error(`[checklists] falha ao disparar "${checklist.name}":`, e);
    }
  }
  return disparados;
}

// ============================================================
// Execuções
// ============================================================

export async function listRuns(venueId: string, limite = 60): Promise<ChecklistRun[]> {
  const { data, error } = await db()
    .from("checklist_runs")
    .select("*")
    .eq("venue_id", venueId)
    .order("scheduled_for", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`Falha ao listar execuções: ${error.message}`);
  return data ?? [];
}

export async function getRunByToken(token: string): Promise<ChecklistRun | null> {
  const { data, error } = await db()
    .from("checklist_runs")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(`Falha ao buscar a execução: ${error.message}`);
  return data;
}

export async function getRunInVenue(
  runId: string,
  venueId: string,
): Promise<ChecklistRun | null> {
  const { data, error } = await db()
    .from("checklist_runs")
    .select("*")
    .eq("id", runId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao buscar a execução: ${error.message}`);
  return data;
}

export async function marcarEmAndamento(run: ChecklistRun): Promise<void> {
  if (run.status !== "pendente") return;
  await db()
    .from("checklist_runs")
    .update({ status: "em_andamento", started_at: new Date().toISOString() })
    .eq("id", run.id)
    .eq("status", "pendente");
}

/** Guarda a foto de um item no bucket e devolve o caminho. */
export async function salvarFotoDeItem(
  run: ChecklistRun,
  itemId: string,
  arquivo: Buffer,
  contentType: string,
): Promise<string> {
  const extensao = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const caminho = `${run.id}/${itemId}.${extensao}`;
  const { error } = await db()
    .storage.from("checklists")
    .upload(caminho, arquivo, { contentType, upsert: true });
  if (error) throw new Error(`Falha ao guardar a foto: ${error.message}`);
  return caminho;
}

/** URL temporária para o painel ver uma foto do bucket privado. */
export async function urlAssinadaDaFoto(caminho: string): Promise<string | null> {
  const { data, error } = await db()
    .storage.from("checklists")
    .createSignedUrl(caminho, 3600);
  if (error) return null;
  return data.signedUrl;
}

export interface ItemRespondido {
  pergunta: string;
  tipo: string;
  valor: string | null;
  observacao: string | null;
  /** URL temporária da foto (1h), pronta para o <img>. Null quando não há foto. */
  foto: string | null;
}

/**
 * O checklist concluído, item por item, pronto para quem NÃO preencheu ler.
 *
 * O resumo da IA no WhatsApp responde "deu tudo certo?" — esta lista responde
 * "certo COMO?". Sem ela, o gerente que quisesse conferir a foto da câmara
 * fria tinha que abrir o painel, achar a execução e caçar o item; com o
 * telefone na mão, no meio do turno, isso não acontece — e a foto que ninguém
 * abre é foto que não valeu o trabalho de tirar.
 *
 * As fotos ganham URL assinada aqui porque o bucket é privado: link direto
 * não abriria, e deixar o bucket público entregaria as fotos de todas as
 * casas a quem adivinhasse um caminho.
 */
export async function respostasDaRun(
  run: ChecklistRun,
  checklist: Checklist,
): Promise<ItemRespondido[]> {
  const respostas = Array.isArray(run.answers) ? (run.answers as unknown as RespostaItem[]) : [];
  const porItem = new Map(respostas.map((r) => [r.item, r]));

  return await Promise.all(
    itensDe(checklist).map(async (item) => {
      const r = porItem.get(item.id);
      return {
        pergunta: item.pergunta,
        tipo: item.tipo,
        valor: r?.valor ?? null,
        observacao: r?.observacao ?? null,
        foto: r?.foto ? await urlAssinadaDaFoto(r.foto) : null,
      };
    }),
  );
}

export interface ResultadoConclusao {
  run: ChecklistRun;
  resumo: string | null;
  alertas: string[];
}

/**
 * Conclui a execução: valida as respostas contra o modelo, grava, pede a
 * análise da IA e avisa quem gerencia. A análise falhar não desfaz a
 * conclusão — o preenchimento da equipe vale por si.
 */
export async function concluirRun(params: {
  run: ChecklistRun;
  checklist: Checklist;
  venue: Pick<Venue, "id" | "name" | "timezone">;
  executorNome: string;
  respostas: RespostaItem[];
}): Promise<ResultadoConclusao> {
  const { run, checklist, venue, executorNome, respostas } = params;
  if (run.status === "concluida") throw new Error("Esta execução já foi concluída.");

  const itens = itensDe(checklist);
  const porItem = new Map(respostas.map((r) => [r.item, r]));
  for (const item of itens) {
    const resposta = porItem.get(item.id);
    if (!item.obrigatorio) continue;
    const temValor =
      item.tipo === "foto"
        ? Boolean(resposta?.foto)
        : Boolean(resposta?.valor && resposta.valor.trim());
    if (!temValor) throw new Error(`Falta responder: "${item.pergunta}"`);
  }

  const analise = await analisarComIA(checklist, itens, respostas, executorNome).catch((e) => {
    console.error("[checklists] análise da IA falhou:", e);
    return null;
  });

  const { data: atualizada, error } = await db()
    .from("checklist_runs")
    .update({
      status: "concluida",
      answers: respostas as unknown as Json,
      executor_nome: executorNome,
      completed_at: new Date().toISOString(),
      resumo_ia: analise?.resumo ?? null,
      alertas_ia: (analise?.alertas ?? []) as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.id)
    .select()
    .single();
  if (error) throw new Error(`Falha ao concluir: ${error.message}`);

  // Resumo no WhatsApp de quem gerencia — com ou sem problemas, saber que
  // o checklist foi feito já vale a mensagem.
  const agenda = agendaDe(checklist);
  const destinatarios = telefonesDeAviso(agenda.avisar_telefone);
  if (destinatarios.length > 0) {
    const alertas = analise?.alertas ?? [];
    const linhas = [
      alertas.length > 0
        ? `⚠️ Checklist "${checklist.name}" concluído com ${alertas.length} ponto(s) de atenção`
        : `✅ Checklist "${checklist.name}" concluído sem pendências`,
      `Por: ${executorNome} — ${venue.name}`,
    ];
    if (analise?.resumo) linhas.push(``, analise.resumo);
    if (alertas.length > 0) linhas.push(``, ...alertas.map((a) => `• ${a}`));

    // O link para conferir item por item, com as fotos.
    //
    // O resumo responde "deu tudo certo?"; o link responde "certo COMO?" —
    // e sem ele a foto da câmara fria só existiria para quem abrisse o
    // painel e caçasse a execução, que no meio do turno é ninguém.
    const base = (process.env.PUBLIC_URL ?? "https://agentes-de-ia-alpha.vercel.app").replace(/\/$/, "");
    linhas.push(``, `Ver as respostas e as fotos:`, `${base}/checklist?t=${run.token}`);

    // Uma notificação POR PESSOA, e não uma com vários destinos: cada uma
    // tem o seu status de entrega, e o gerente receber não pode fazer o
    // sistema achar que o líder também recebeu.
    const { error: erroNotif } = await db()
      .from("notifications")
      .insert(
        destinatarios.map((destino) => ({
          venue_id: venue.id,
          channel: "whatsapp",
          destination: destino,
          template: "checklist_resumo",
          papel: "administrativo",
          body: linhas.join("\n"),
        })) as never,
      );
    if (erroNotif) console.error(`[checklists] não enfileirou o resumo: ${erroNotif.message}`);
  }

  return { run: atualizada, resumo: analise?.resumo ?? null, alertas: analise?.alertas ?? [] };
}

// ============================================================
// IA
// ============================================================

/**
 * O JSON que a IA respondeu — ou um erro que diz o que houve.
 *
 * Recortar do primeiro "{" ao último "}" funciona enquanto a resposta chega
 * inteira. Truncada no limite de tokens, o último "}" é o de um objeto de
 * DENTRO da lista (JSON inválido) — ou não existe nenhum, e o recorte vira
 * texto vazio: `JSON.parse("")` estoura com "Unexpected end of JSON input",
 * que não diz nada a quem só queria montar um checklist.
 *
 * Foi exatamente o que aconteceu com uma rotina grande de limpeza: a
 * resposta passou de 1500 tokens no meio da lista de itens.
 */
export function jsonDaResposta<T>(resposta: Anthropic.Message, oQueEra: string): T {
  const texto = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (resposta.stop_reason === "max_tokens") {
    throw new Error(
      `A resposta da IA ficou grande demais e foi cortada no meio. ` +
        `Tente descrever ${oQueEra} em menos itens, ou divida em dois checklists.`,
    );
  }

  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) {
    throw new Error("A IA respondeu num formato inesperado — tente de novo.");
  }
  try {
    return JSON.parse(texto.slice(inicio, fim + 1)) as T;
  } catch {
    throw new Error("A IA respondeu num formato inesperado — tente de novo.");
  }
}

async function analisarComIA(
  checklist: Checklist,
  itens: ItemChecklist[],
  respostas: RespostaItem[],
  executor: string,
): Promise<{ resumo: string; alertas: string[] }> {
  const porItem = new Map(respostas.map((r) => [r.item, r]));
  const linhas = itens.map((item) => {
    const r = porItem.get(item.id);
    const valor =
      item.tipo === "foto"
        ? r?.foto
          ? "[foto enviada]"
          : "[sem foto]"
        : (r?.valor ?? "[sem resposta]");
    const obs = r?.observacao ? ` — obs: ${r.observacao}` : "";
    return `- ${item.pergunta}: ${valor}${obs}`;
  });

  const resposta = await anthropic().messages.create({
    model: MODELO_IA(),
    // Um checklist de 15 itens com muitos alertas passava dos 800 e a
    // análise vinha cortada — e cortada ela não vira JSON nenhum.
    max_tokens: 2000,
    system:
      "Você analisa checklists operacionais de bares e restaurantes. " +
      "Responda APENAS um JSON válido no formato " +
      '{"resumo": "1-2 frases sobre a execução", "alertas": ["problema acionável", ...]}. ' +
      "Alertas são só o que precisa de ação de um gerente: respostas 'não' em itens críticos, " +
      "observações que relatam defeito/falta/risco, texto que indica problema. " +
      "Execução sem problemas = alertas vazio. Escreva em português, direto, sem rodeios.",
    messages: [
      {
        role: "user",
        content: `Checklist: ${checklist.name}\nPreenchido por: ${executor}\n\nRespostas:\n${linhas.join("\n")}`,
      },
    ],
  });

  const json = jsonDaResposta<{ resumo?: string; alertas?: string[] }>(resposta, "a execução");
  return {
    resumo: typeof json.resumo === "string" ? json.resumo : "",
    alertas: Array.isArray(json.alertas)
      ? json.alertas.filter((a): a is string => typeof a === "string")
      : [],
  };
}

export interface MensagemGeracao {
  papel: "usuario" | "ia";
  texto: string;
}

export type RespostaGeracao =
  | { tipo: "pergunta"; texto: string }
  | { tipo: "itens"; itens: ItemChecklist[] };

/**
 * Monta o checklist conversando: antes de gerar, a IA entrevista quem está
 * criando — o que é obrigatório, o que exige foto, o que é registro em
 * texto, a ordem do percurso. Com contexto suficiente (ou depois de no
 * máximo duas rodadas de perguntas), entrega os itens prontos para revisão.
 */
export async function conversarGeracao(mensagens: MensagemGeracao[]): Promise<RespostaGeracao> {
  if (mensagens.length === 0) throw new Error("Descreva a rotina para começar.");

  const resposta = await anthropic().messages.create({
    model: MODELO_IA(),
    // Quinze itens em português, cada um com a pergunta escrita por extenso,
    // não cabiam em 1500: a lista era cortada no meio e o painel recebia
    // "Unexpected end of JSON input" no lugar do checklist. Aconteceu com uma
    // rotina de limpeza de louça e talheres, que é exatamente o tamanho de
    // rotina que mais precisa de checklist.
    max_tokens: 8000,
    system:
      "Você monta checklists operacionais para bares e restaurantes brasileiros, " +
      "conversando com o dono antes de gerar. Entenda primeiro: quais itens são " +
      "obrigatórios e quais opcionais; o que precisa de FOTO como evidência (limpeza, " +
      "organização, validade); o que precisa de registro em TEXTO (temperaturas, valores, " +
      "contagens, ocorrências); a ordem do percurso pelo espaço; e quantos itens fazem sentido. " +
      "Faça NO MÁXIMO duas rodadas de perguntas — curtas, agrupadas numa mensagem só, " +
      "no máximo 4 perguntas por rodada. Se o contexto já basta (ou o usuário já respondeu " +
      "ou pediu para gerar logo), gere. " +
      "Responda SEMPRE um único JSON válido, sem texto fora dele, em um destes formatos: " +
      '{"tipo":"pergunta","texto":"suas perguntas aqui"} ou ' +
      '{"tipo":"itens","itens":[{"tipo":"sim_nao"|"texto"|"foto","pergunta":"...","obrigatorio":true|false}]} ' +
      "com no máximo 15 itens, perguntas curtas e específicas.",
    messages: mensagens.map((m) => ({
      role: m.papel === "ia" ? ("assistant" as const) : ("user" as const),
      content: m.texto,
    })),
  });

  const bruto = jsonDaResposta<{ tipo?: string; texto?: string; itens?: unknown }>(
    resposta,
    "a rotina",
  );

  if (bruto.tipo === "itens") return { tipo: "itens", itens: validarItens(bruto.itens) };
  if (bruto.tipo === "pergunta" && typeof bruto.texto === "string" && bruto.texto.trim()) {
    return { tipo: "pergunta", texto: bruto.texto.trim() };
  }
  throw new Error("A IA respondeu num formato inesperado — tente de novo.");
}
