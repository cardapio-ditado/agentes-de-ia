import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { runAgent, type AgentStreamEvent } from "./agent.js";
import { authenticateApiKey, hasScope, type ApiKey } from "./apikeys.js";
import {
  createAgent,
  getAgentInOrg,
  listAgentsInOrg,
  listAllAgentsInOrg,
  updateAgent,
  type DadosAgente,
} from "./repository.js";
import { decidirReserva } from "./reservationFlow.js";
import { listNotificationsForReservation } from "./notifications.js";
import {
  apagarConversa,
  atendimentoDe,
  definirAtendimento,
  definirStatusConversa,
  getConversationInOrg,
  listConversations,
  metricasDoVenue,
  registrarMensagemHumana,
} from "./inbox.js";
import {
  addTrainingFile,
  addTrainingText,
  LIMITE_ARQUIVO_BYTES,
  listTraining,
  removeTraining,
} from "./training.js";
import { versaoDoCodigo } from "./version.js";
import {
  cancelReservation,
  createVenueEvent,
  createVenueEventSeries,
  createVenueInfo,
  deleteReservation,
  deleteVenueEvent,
  deleteVenueEventSeries,
  deleteVenueInfo,
  findVenueBySlugInOrg,
  getReservationWithVenue,
  listAllEvents,
  listPendingReservations,
  listUpcomingApproved,
  listVenueInfo,
  listVenuesInOrg,
  mapsUrl,
  renewVenueEventSeries,
  updateReservation,
  updateVenue,
  type DadosReserva,
  type DadosVenue,
} from "./venues.js";

/**
 * Roteamento da API, sem servidor.
 *
 * O mesmo handler serve os dois destinos: `src/server.ts` monta um servidor
 * Node de verdade (local, VPS, container), e `api/index.ts` é a função
 * serverless da Vercel. A diferença é só quem serve os arquivos estáticos —
 * na Vercel, o CDN cuida disso.
 */

// Relativo ao cwd, não ao módulo: compilado, este arquivo vive em dist/src/,
// e um caminho relativo ao módulo apontaria para dist/public (inexistente).
const PUBLIC_DIR = resolve(process.cwd(), "public");

// ============================================================
// Conector WhatsApp — registrado, não importado
// ============================================================

/**
 * Interface mínima do conector, para este módulo não importar o Baileys.
 *
 * Importar direto arrastaria 9 MB de dependência para dentro da função
 * serverless, que nunca conseguiria usá-la: o Baileys precisa de WebSocket
 * aberto e de disco. Quem roda num servidor de verdade registra o conector;
 * na Vercel ele fica nulo e as rotas respondem 501.
 */
export interface ConectorWhatsapp {
  estado(): unknown;
  iniciar(opcoes: { agentSlug: string; venueSlug: string }): Promise<void>;
  parar(): Promise<void>;
}

let conectorWhatsapp: ConectorWhatsapp | null = null;

export function registrarConectorWhatsapp(conector: ConectorWhatsapp | null): void {
  conectorWhatsapp = conector;
}

// ============================================================
// Envelope de resposta (padrão do PRD)
// ============================================================
interface ErroHttp {
  status: number;
  code: string;
  message: string;
}

function erro(status: number, code: string, message: string): ErroHttp {
  return { status, code, message };
}

function responder(res: ServerResponse, status: number, corpo: unknown): void {
  const json = JSON.stringify(corpo);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

function ok(res: ServerResponse, data: unknown, status = 200): void {
  responder(res, status, { success: true, data });
}

function falha(res: ServerResponse, e: ErroHttp): void {
  responder(res, e.status, {
    success: false,
    error: { code: e.code, message: e.message },
  });
}

// ============================================================
// Autenticação
// ============================================================
async function exigirChave(req: IncomingMessage, escopo: string): Promise<ApiKey> {
  const header = req.headers.authorization ?? "";
  const chave = header.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
  const apiKey = await authenticateApiKey(chave);

  if (!apiKey) {
    throw erro(401, "unauthorized", "Chave de API ausente, inválida, revogada ou expirada.");
  }
  if (!hasScope(apiKey, escopo)) {
    throw erro(403, "forbidden", `Esta chave não tem o escopo "${escopo}".`);
  }
  return apiKey;
}

async function lerJson(
  req: IncomingMessage,
  limite = 1_000_000,
): Promise<Record<string, unknown>> {
  const partes: Buffer[] = [];
  let bytes = 0;
  for await (const parte of req) {
    bytes += (parte as Buffer).length;
    if (bytes > limite) {
      throw erro(
        413,
        "request_too_large",
        `Corpo da requisição acima de ${Math.round(limite / 1_000_000)} MB.`,
      );
    }
    partes.push(parte as Buffer);
  }
  if (partes.length === 0) return {};
  try {
    const corpo: unknown = JSON.parse(Buffer.concat(partes).toString("utf8"));
    if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
      throw erro(400, "invalid_request", "O corpo precisa ser um objeto JSON.");
    }
    return corpo as Record<string, unknown>;
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) throw e;
    throw erro(400, "invalid_request", "JSON inválido.");
  }
}

/**
 * Lê o corpo bruto da requisição — sem JSON, sem base64.
 *
 * Usado para upload de arquivo: mandar o arquivo cru custa ~25% menos bytes
 * na rede do que embrulhar em base64 dentro de um JSON, o que dá mais folga
 * sob qualquer limite de tamanho de corpo imposto por um proxy na frente.
 */
async function lerBinario(req: IncomingMessage, limite: number): Promise<Buffer> {
  const partes: Buffer[] = [];
  let bytes = 0;
  for await (const parte of req) {
    bytes += (parte as Buffer).length;
    if (bytes > limite) {
      throw erro(
        413,
        "request_too_large",
        `Arquivo acima de ${Math.round(limite / 1_000_000)} MB.`,
      );
    }
    partes.push(parte as Buffer);
  }
  return Buffer.concat(partes);
}

function texto(corpo: Record<string, unknown>, campo: string): string {
  const valor = corpo[campo];
  if (typeof valor !== "string" || valor.trim() === "") {
    throw erro(400, "invalid_request", `O campo "${campo}" é obrigatório.`);
  }
  return valor.trim();
}

function textoOpcional(corpo: Record<string, unknown>, campo: string): string | undefined {
  const valor = corpo[campo];
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined;
}

// ============================================================
// Rotas
// ============================================================
async function rotear(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  traceId: string,
  servirEstaticos: boolean,
): Promise<void> {
  const metodo = req.method ?? "GET";
  const caminho = url.pathname.replace(/\/+$/, "") || "/";
  const partes = caminho.split("/").filter(Boolean);

  if (metodo === "GET" && caminho === "/health") {
    return ok(res, { status: "ok", versao: versaoDoCodigo(), trace_id: traceId });
  }

  // Tudo sob /v1 exige chave de API.
  if (partes[0] === "v1") {
    return await roteasApi(req, res, metodo, partes.slice(1), url);
  }

  if (!servirEstaticos) {
    throw erro(404, "not_found", `Rota ${metodo} ${caminho} não existe.`);
  }
  return await servirEstatico(res, caminho);
}

async function roteasApi(
  req: IncomingMessage,
  res: ServerResponse,
  metodo: string,
  p: string[],
  url: URL,
): Promise<void> {
  // POST /v1/runs
  if (metodo === "POST" && p[0] === "runs" && p.length === 1) {
    const chave = await exigirChave(req, "runs:write");
    return await executarAgente(req, res, chave, url);
  }

  // GET /v1/agents — todos com ?all=1 (painel), só habilitados sem (execução)
  if (metodo === "GET" && p[0] === "agents" && p.length === 1) {
    const chave = await exigirChave(req, "runs:write");
    const agentes =
      url.searchParams.get("all") === "1"
        ? await listAllAgentsInOrg(chave.org_id)
        : await listAgentsInOrg(chave.org_id);
    return ok(
      res,
      agentes.map((a) => ({
        slug: a.slug,
        name: a.name,
        description: a.description,
        model: a.model,
        effort: a.effort,
        enabled: a.enabled,
      })),
    );
  }

  // POST /v1/agents — cria um agente
  if (metodo === "POST" && p[0] === "agents" && p.length === 1) {
    const chave = await exigirChave(req, "runs:write");
    const corpo = await lerJson(req);
    try {
      const agente = await createAgent(chave.org_id, corpo as DadosAgente);
      return ok(res, agente, 201);
    } catch (e) {
      throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
    }
  }

  // ---- Treinamento do agente ----
  if (p[0] === "agents" && p[2] === "training") {
    const chave = await exigirChave(req, "runs:write");
    const agente = await getAgentInOrg(chave.org_id, p[1]!);
    if (!agente) throw erro(404, "not_found", `Agente "${p[1]}" não encontrado.`);

    // GET /v1/agents/:slug/training
    if (metodo === "GET" && p.length === 3) {
      return ok(
        res,
        listTraining(agente).map((i) => ({
          id: i.id,
          kind: i.kind,
          titulo: i.titulo,
          arquivo: i.arquivo,
          tamanho: i.conteudo.length,
          criado_em: i.criado_em,
        })),
      );
    }

    // POST /v1/agents/:slug/training — texto digitado (JSON)
    if (metodo === "POST" && p.length === 3) {
      const corpo = await lerJson(req);
      try {
        const item = await addTrainingText({
          agent: agente,
          titulo: texto(corpo, "titulo"),
          conteudo: texto(corpo, "conteudo"),
        });
        return ok(res, { id: item.id, titulo: item.titulo, tamanho: item.conteudo.length }, 201);
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Falha no treinamento.");
      }
    }

    // POST /v1/agents/:slug/training/upload — arquivo cru no corpo, metadados
    // na query string. Sem JSON e sem base64: o arquivo trafega do jeito que é,
    // ~25% mais leve do que embrulhado em base64 dentro de um JSON — o que
    // importa sob qualquer limite de tamanho de corpo imposto por um proxy.
    if (metodo === "POST" && p[3] === "upload" && p.length === 4) {
      const nomeArquivo = url.searchParams.get("nome_arquivo");
      const mediaType = url.searchParams.get("media_type");
      if (!nomeArquivo || !mediaType) {
        throw erro(400, "invalid_request", 'Informe "nome_arquivo" e "media_type" na URL.');
      }
      const arquivo = await lerBinario(req, LIMITE_ARQUIVO_BYTES);
      if (arquivo.byteLength === 0) {
        throw erro(400, "invalid_request", "O arquivo chegou vazio — tente enviar de novo.");
      }
      try {
        const item = await addTrainingFile({
          agent: agente,
          titulo: url.searchParams.get("titulo") ?? "",
          nomeArquivo,
          mediaType,
          arquivo,
        });
        return ok(res, { id: item.id, titulo: item.titulo, tamanho: item.conteudo.length }, 201);
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Falha no treinamento.");
      }
    }

    // DELETE /v1/agents/:slug/training/:id
    if (metodo === "DELETE" && p.length === 4) {
      try {
        await removeTraining(agente, p[3]!);
        return ok(res, { removido: true });
      } catch (e) {
        throw erro(404, "not_found", e instanceof Error ? e.message : "Item não encontrado.");
      }
    }
  }

  // GET | PATCH /v1/agents/:slug — detalhe (com o prompt) e edição
  if (p[0] === "agents" && p.length === 2) {
    const chave = await exigirChave(req, "runs:write");
    const slug = p[1]!;

    if (metodo === "GET") {
      const agente = await getAgentInOrg(chave.org_id, slug);
      if (!agente) throw erro(404, "not_found", `Agente "${slug}" não encontrado.`);
      return ok(res, agente);
    }

    if (metodo === "PATCH") {
      const corpo = await lerJson(req);
      // O slug identifica a rota; trocá-lo aqui quebraria conversas e o
      // conector do WhatsApp que apontam para ele.
      delete (corpo as Record<string, unknown>).slug;
      try {
        return ok(res, await updateAgent(chave.org_id, slug, corpo as DadosAgente));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Dados inválidos.";
        throw msg.includes("não encontrado")
          ? erro(404, "not_found", msg)
          : erro(400, "invalid_request", msg);
      }
    }
  }

  // GET /v1/venues
  if (metodo === "GET" && p[0] === "venues" && p.length === 1) {
    const chave = await exigirChave(req, "reservations:read");
    const venues = await listVenuesInOrg(chave.org_id);
    return ok(res, venues.map((v) => ({ slug: v.slug, name: v.name, timezone: v.timezone })));
  }

  // GET | PATCH /v1/venues/:slug — dados cadastrais completos e edição
  if (p[0] === "venues" && p.length === 2) {
    const escopo = metodo === "GET" ? "reservations:read" : "reservations:write";
    const chave = await exigirChave(req, escopo);
    const venue = await findVenueBySlugInOrg(chave.org_id, p[1]!);

    if (metodo === "GET") {
      return ok(res, {
        slug: venue.slug,
        name: venue.name,
        description: venue.description,
        address: venue.address,
        phone: venue.phone,
        whatsapp: venue.whatsapp,
        email: venue.email,
        capacity: venue.capacity,
        timezone: venue.timezone,
        opening_hours: venue.opening_hours ?? {},
        maps_url: mapsUrl(venue),
      });
    }

    if (metodo === "PATCH") {
      const corpo = await lerJson(req);
      // O slug identifica a rota e a chave do painel; não muda por aqui.
      delete (corpo as Record<string, unknown>).slug;
      try {
        const atualizado = await updateVenue(chave.org_id, venue.slug, corpo as DadosVenue);
        return ok(res, { slug: atualizado.slug, name: atualizado.name });
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
      }
    }
  }

  // /v1/venues/:slug/...
  if (p[0] === "venues" && p.length >= 3) {
    const slug = p[1]!;
    const recurso = p[2]!;

    // GET /v1/venues/:slug/reservations — pendentes; ?status=approved traz as
    // confirmadas que ainda vão acontecer
    if (metodo === "GET" && recurso === "reservations") {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      if (url.searchParams.get("status") === "approved") {
        return ok(res, await listUpcomingApproved(venue.id));
      }
      return ok(res, await listPendingReservations(venue.id));
    }

    if (metodo === "GET" && recurso === "events" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await listAllEvents(venue.id));
    }

    // POST /v1/venues:slug/events — evento único, ou série se vier "recorrencia"
    if (metodo === "POST" && recurso === "events" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);

      const startsAt = new Date(texto(corpo, "starts_at"));
      if (Number.isNaN(startsAt.getTime())) {
        throw erro(400, "invalid_request", "starts_at precisa ser uma data ISO 8601 válida.");
      }
      const cover = corpo.cover_charge;
      const base = {
        venue_id: venue.id,
        kind: textoOpcional(corpo, "kind") ?? "musica",
        title: texto(corpo, "title"),
        description: textoOpcional(corpo, "description") ?? null,
        starts_at: startsAt.toISOString(),
        cover_charge: typeof cover === "number" ? cover : null,
      };

      const recorrencia = corpo.recorrencia;
      if (recorrencia && typeof recorrencia === "object" && !Array.isArray(recorrencia)) {
        const r = recorrencia as Record<string, unknown>;
        const freq = r.freq;
        if (freq !== "weekly" && freq !== "daily") {
          throw erro(400, "invalid_request", 'recorrencia.freq precisa ser "weekly" ou "daily".');
        }
        const days = Array.isArray(r.days) ? r.days.filter((d): d is string => typeof d === "string") : undefined;
        const until = typeof r.until === "string" && r.until ? new Date(r.until) : undefined;
        if (until && Number.isNaN(until.getTime())) {
          throw erro(400, "invalid_request", "recorrencia.until precisa ser uma data válida.");
        }
        try {
          const eventos = await createVenueEventSeries(base, { freq, days, until }, venue.timezone);
          return ok(res, eventos, 201);
        } catch (e) {
          throw erro(400, "invalid_request", e instanceof Error ? e.message : "Recorrência inválida.");
        }
      }

      const evento = await createVenueEvent(base);
      return ok(res, evento, 201);
    }

    // DELETE /v1/venues:slug/events/series:seriesId — futuras ocorrências da série
    if (metodo === "DELETE" && recurso === "events" && p[3] === "series" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await deleteVenueEventSeries(p[4]!, venue.id);
      return ok(res, { removido: true });
    }

    // POST /v1/venues:slug/events/series:seriesId/renew — mais ~12 semanas
    if (metodo === "POST" && recurso === "events" && p[3] === "series" && p.length === 6 && p[5] === "renew") {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      try {
        const eventos = await renewVenueEventSeries(p[4]!, venue.id, venue.timezone);
        return ok(res, eventos, 201);
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Não foi possível renovar.");
      }
    }

    if (metodo === "GET" && recurso === "info") {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await listVenueInfo(venue.id));
    }

    // POST /v1/venues/:slug/info — cria ou atualiza um tópico (upsert)
    if (metodo === "POST" && recurso === "info" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);
      try {
        const info = await createVenueInfo({
          venueId: venue.id,
          topic: texto(corpo, "topic"),
          content: texto(corpo, "content"),
        });
        return ok(res, info, 201);
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
      }
    }

    // DELETE /v1/venues/:slug/info/:id
    if (metodo === "DELETE" && recurso === "info" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await deleteVenueInfo(p[3]!, venue.id);
      return ok(res, { removido: true });
    }

    // GET /v1/venues/:slug/conversations?canal=&status=&humanas=1
    if (metodo === "GET" && recurso === "conversations") {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(
        res,
        await listConversations({
          venueId: venue.id,
          canal: url.searchParams.get("canal"),
          status: url.searchParams.get("status"),
          apenasHumanas: url.searchParams.get("humanas") === "1",
        }),
      );
    }

    // GET /v1/venues/:slug/metrics — números do painel
    if (metodo === "GET" && recurso === "metrics") {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await metricasDoVenue(venue.id));
    }
  }

  // ---- Conversas ----
  if (p[0] === "conversations" && p.length >= 2) {
    const escopo = metodo === "GET" ? "reservations:read" : "reservations:write";
    const chave = await exigirChave(req, escopo);

    const encontrado = await getConversationInOrg(p[1]!, chave.org_id);
    if (!encontrado) throw erro(404, "not_found", "Conversa não encontrada.");
    const { conversa, mensagens } = encontrado;

    // GET /v1/conversations/:id — conversa com o histórico
    if (metodo === "GET" && p.length === 2) {
      return ok(res, {
        id: conversa.id,
        titulo: conversa.title,
        canal: conversa.channel,
        status: conversa.status,
        contato: conversa.external_id,
        atendimento: atendimentoDe(conversa),
        mensagens: mensagens.map((m) => ({
          id: m.id,
          papel: m.role,
          texto: m.content,
          // Marca posta por registrarMensagemHumana: separa o que a pessoa
          // escreveu do que o agente respondeu.
          origem:
            m.blocks && typeof m.blocks === "object" && !Array.isArray(m.blocks)
              ? ((m.blocks as Record<string, unknown>).origem ?? null)
              : null,
          em: m.created_at,
        })),
      });
    }

    // DELETE /v1/conversations/:id — apaga o histórico; reservas sobrevivem
    if (metodo === "DELETE" && p.length === 2) {
      await apagarConversa(conversa.id);
      return ok(res, { apagada: true });
    }

    // POST /v1/conversations/:id/close — encerra ({"reabrir":true} reabre)
    if (metodo === "POST" && p[2] === "close" && p.length === 3) {
      const corpo = await lerJson(req);
      const atualizada = await definirStatusConversa({
        conversationId: conversa.id,
        status: corpo.reabrir === true ? "open" : "closed",
      });
      return ok(res, { status: atualizada.status });
    }

    // POST /v1/conversations/:id/takeover — assumir ou devolver ao agente
    if (metodo === "POST" && p[2] === "takeover" && p.length === 3) {
      const corpo = await lerJson(req);
      const devolver = corpo.devolver === true;
      const atualizada = await definirAtendimento({
        conversationId: conversa.id,
        por: devolver ? "agente" : "humano",
        quem: textoOpcional(corpo, "quem") ?? chave.name,
      });
      return ok(res, atendimentoDe(atualizada));
    }

    // POST /v1/conversations/:id/messages — resposta escrita por uma pessoa
    if (metodo === "POST" && p[2] === "messages" && p.length === 3) {
      const corpo = await lerJson(req);
      const texto_ = texto(corpo, "texto").trim();
      if (!texto_) throw erro(400, "invalid_request", "A mensagem não pode ser vazia.");

      // Enquanto o agente responde, uma resposta manual sairia junto com a dele
      // e o cliente receberia duas vozes na mesma conversa.
      if (atendimentoDe(conversa).por !== "humano") {
        throw erro(
          409,
          "conflict",
          "Assuma o atendimento antes de responder — o agente ainda está respondendo esta conversa.",
        );
      }

      const msg = await registrarMensagemHumana({
        conversationId: conversa.id,
        texto: texto_,
        autor: textoOpcional(corpo, "autor") ?? chave.name,
      });
      return ok(res, { id: msg.id, em: msg.created_at }, 201);
    }
  }

  // DELETE /v1/events/:id?venue=<slug>
  if (metodo === "DELETE" && p[0] === "events" && p.length === 2) {
    const chave = await exigirChave(req, "reservations:write");
    const slug = url.searchParams.get("venue");
    if (!slug) throw erro(400, "invalid_request", 'Informe o estabelecimento em "?venue=".');
    const venue = await findVenueBySlugInOrg(chave.org_id, slug);
    await deleteVenueEvent(p[1]!, venue.id);
    return ok(res, { removido: true });
  }

  // POST /v1/reservations/:id/approve | /reject | /cancel
  if (metodo === "POST" && p[0] === "reservations" && p.length === 3) {
    const chave = await exigirChave(req, "reservations:write");
    const acao = p[2]!;
    if (acao !== "approve" && acao !== "reject" && acao !== "cancel") {
      throw erro(404, "not_found", `Ação "${acao}" não existe.`);
    }

    const encontrado = await getReservationWithVenue(p[1]!);
    // Mesma resposta para "não existe" e "é de outra organização".
    if (!encontrado || encontrado.venue.org_id !== chave.org_id) {
      throw erro(404, "not_found", "Reserva não encontrada.");
    }

    // Cancelar não passa pelo fluxo de decisão: nenhuma notificação
    // automática — cancelamento pela casa merece uma mensagem humana.
    if (acao === "cancel") {
      try {
        return ok(res, await cancelReservation(encontrado.reservation.id));
      } catch (e) {
        throw erro(409, "conflict", e instanceof Error ? e.message : "Conflito ao cancelar.");
      }
    }

    const corpo = await lerJson(req);
    const motivo = textoOpcional(corpo, "motivo");
    if (acao === "reject" && !motivo) {
      throw erro(400, "invalid_request", 'Recusar exige "motivo": o cliente precisa saber por quê.');
    }

    try {
      const { reserva, notificacao } = await decidirReserva({
        reservationId: encontrado.reservation.id,
        status: acao === "approve" ? "approved" : "rejected",
        motivo,
        venue: encontrado.venue,
      });
      return ok(res, {
        ...reserva,
        // O painel mostra se o cliente foi realmente avisado.
        notificacao: notificacao
          ? { status: notificacao.status, canal: notificacao.channel, erro: notificacao.error }
          : null,
      });
    } catch (e) {
      // reviewReservation só atualiza quando ainda está pendente.
      throw erro(409, "conflict", e instanceof Error ? e.message : "Conflito ao decidir.");
    }
  }

  // PATCH | DELETE /v1/reservations/:id — editar dados ou apagar de vez
  if ((metodo === "PATCH" || metodo === "DELETE") && p[0] === "reservations" && p.length === 2) {
    const chave = await exigirChave(req, "reservations:write");
    const encontrado = await getReservationWithVenue(p[1]!);
    if (!encontrado || encontrado.venue.org_id !== chave.org_id) {
      throw erro(404, "not_found", "Reserva não encontrada.");
    }

    if (metodo === "DELETE") {
      await deleteReservation(encontrado.reservation.id);
      return ok(res, { removido: true });
    }

    const corpo = await lerJson(req);
    const dados: DadosReserva = {};
    if ("customer_name" in corpo) dados.customer_name = texto(corpo, "customer_name");
    if ("customer_phone" in corpo) dados.customer_phone = texto(corpo, "customer_phone");
    if ("party_size" in corpo) {
      if (typeof corpo.party_size !== "number") {
        throw erro(400, "invalid_request", 'O campo "party_size" precisa ser um número.');
      }
      dados.party_size = corpo.party_size;
    }
    if ("reserved_for" in corpo) dados.reserved_for = texto(corpo, "reserved_for");
    // Campos anuláveis: mandar "" ou null limpa o valor.
    if ("area_preference" in corpo) dados.area_preference = textoOpcional(corpo, "area_preference") ?? null;
    if ("occasion" in corpo) dados.occasion = textoOpcional(corpo, "occasion") ?? null;
    if ("notes" in corpo) dados.notes = textoOpcional(corpo, "notes") ?? null;

    try {
      return ok(res, await updateReservation(encontrado.reservation.id, dados));
    } catch (e) {
      throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
    }
  }

  // GET /v1/reservations/:id/notifications
  if (metodo === "GET" && p[0] === "reservations" && p[2] === "notifications" && p.length === 3) {
    const chave = await exigirChave(req, "reservations:read");
    const encontrado = await getReservationWithVenue(p[1]!);
    if (!encontrado || encontrado.venue.org_id !== chave.org_id) {
      throw erro(404, "not_found", "Reserva não encontrada.");
    }
    return ok(res, await listNotificationsForReservation(encontrado.reservation.id));
  }

  // ---- WhatsApp (Baileys) ----
  if (p[0] === "whatsapp" && p.length === 2) {
    const chave = await exigirChave(req, "reservations:write");

    if (!conectorWhatsapp) {
      throw erro(
        501,
        "not_implemented",
        "O conector do WhatsApp não roda neste ambiente. Ele precisa de um " +
          "host sempre ligado, com WebSocket e disco — não funciona em serverless.",
      );
    }

    if (metodo === "GET" && p[1] === "status") {
      const estado = conectorWhatsapp.estado() as Record<string, unknown>;
      return ok(res, { ...estado, versao: versaoDoCodigo() });
    }

    if (metodo === "POST" && p[1] === "conectar") {
      const corpo = await lerJson(req);
      const venueSlug = texto(corpo, "venue");
      const agentSlug = texto(corpo, "agent");

      // O conector responde por esta organização: confira antes de subir.
      await findVenueBySlugInOrg(chave.org_id, venueSlug);
      const agentes = await listAgentsInOrg(chave.org_id);
      if (!agentes.some((a) => a.slug === agentSlug)) {
        throw erro(404, "not_found", `Agente "${agentSlug}" não encontrado nesta organização.`);
      }

      await conectorWhatsapp.iniciar({ agentSlug, venueSlug });
      return ok(res, conectorWhatsapp.estado());
    }

    if (metodo === "POST" && p[1] === "desconectar") {
      await conectorWhatsapp.parar();
      return ok(res, conectorWhatsapp.estado());
    }
  }

  throw erro(404, "not_found", `Rota ${metodo} /v1/${p.join("/")} não existe.`);
}

// ============================================================
// POST /v1/runs — com streaming SSE opcional
// ============================================================
async function executarAgente(
  req: IncomingMessage,
  res: ServerResponse,
  chave: ApiKey,
  url: URL,
): Promise<void> {
  const corpo = await lerJson(req);
  const agentSlug = texto(corpo, "agent");
  const userMessage = texto(corpo, "input");
  const venueSlug = textoOpcional(corpo, "venue");
  const channel = textoOpcional(corpo, "channel") ?? "api";
  const externalId = textoOpcional(corpo, "external_id");

  // O agente precisa pertencer à organização da chave.
  const agentes = await listAgentsInOrg(chave.org_id);
  if (!agentes.some((a) => a.slug === agentSlug)) {
    throw erro(404, "not_found", `Agente "${agentSlug}" não encontrado nesta organização.`);
  }
  if (venueSlug) await findVenueBySlugInOrg(chave.org_id, venueSlug);

  const querStream =
    url.searchParams.get("stream") === "true" ||
    (req.headers.accept ?? "").includes("text/event-stream");

  if (!querStream) {
    const resultado = await runAgent({ agentSlug, userMessage, channel, externalId, venueSlug });
    return ok(res, {
      conversation_id: resultado.conversationId,
      output: resultado.text,
      stop_reason: resultado.stopReason,
    });
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const enviar = (evento: AgentStreamEvent | { type: "error"; message: string }): void => {
    res.write(`event: ${evento.type}\ndata: ${JSON.stringify(evento)}\n\n`);
  };

  try {
    await runAgent({ agentSlug, userMessage, channel, externalId, venueSlug, onEvent: enviar });
  } catch (e) {
    // Cabeçalhos já foram enviados: o erro tem de viajar pelo próprio stream.
    enviar({ type: "error", message: e instanceof Error ? e.message : "Falha na execução." });
  } finally {
    res.end();
  }
}

// ============================================================
// Arquivos estáticos (painel web)
// ============================================================
const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function servirEstatico(res: ServerResponse, caminho: string): Promise<void> {
  const relativo = caminho === "/" ? "index.html" : caminho.slice(1);

  // normalize resolve "..", e o prefixo é conferido depois — sem isso,
  // "/../.env" escaparia do diretório público.
  const alvo = normalize(join(PUBLIC_DIR, relativo));
  if (!alvo.startsWith(PUBLIC_DIR)) {
    throw erro(403, "forbidden", "Caminho fora do diretório público.");
  }

  try {
    const conteudo = await readFile(alvo);
    res.writeHead(200, {
      "content-type": TIPOS[extname(alvo)] ?? "application/octet-stream",
      "content-length": conteudo.length,
      // no-cache (não no-store): o navegador pode guardar, mas revalida a
      // cada uso. Sem isto, um módulo JS importado por outro (api.js, as
      // telas em pages/) fica preso em cache até o usuário limpar na mão —
      // só o arquivo referenciado direto no HTML seria atualizado.
      "cache-control": "no-cache",
    });
    res.end(conteudo);
  } catch {
    throw erro(404, "not_found", "Página não encontrada.");
  }
}

// ============================================================
// Handler
// ============================================================
export interface OpcoesApp {
  /**
   * Servir o painel a partir de `public/`.
   *
   * Ligado no servidor Node; desligado na Vercel, onde o CDN serve os
   * estáticos antes de a função ser chamada.
   */
  servirEstaticos?: boolean;
}

export function criarHandler(opcoes: OpcoesApp = {}) {
  const servirEstaticos = opcoes.servirEstaticos ?? true;

  return function handler(req: IncomingMessage, res: ServerResponse): void {
    const traceId = randomUUID();
    res.setHeader("x-trace-id", traceId);

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    void rotear(req, res, url, traceId, servirEstaticos).catch((e: unknown) => {
      // Streaming já começou: não dá para trocar por uma resposta de erro.
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e && typeof e === "object" && "status" in e && "code" in e) {
        return falha(res, e as ErroHttp);
      }
      console.error(`[${traceId}]`, e);
      falha(res, erro(500, "internal_error", "Erro interno. Consulte o trace-id no log."));
    });
  };
}
