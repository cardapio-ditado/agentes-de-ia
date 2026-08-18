import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { contextoDeAgora, runAgent, type AgentStreamEvent } from "./agent.js";
import { authenticateApiKey, hasScope } from "./apikeys.js";
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
  entrar,
  ErroDeAcesso,
  pedirTrocaDeSenha,
  renovar,
  sessaoDoToken,
  trocarSenha,
} from "./auth.js";
import {
  adicionarAvaliacaoManual,
  aprovarResposta,
  avaliacaoComOrg,
  descartarResposta,
  filaDeAprovacao,
  historicoDeAvaliacoes,
  perfilDoVenue,
  salvarPerfil,
} from "./avaliacoes.js";
import { extratoDePontos, PlanoBloqueadoError } from "./pontos.js";
import {
  atualizarComercial,
  criarCliente,
  listarClientes,
  resumirPlataforma,
  type DadosDoCliente,
} from "./tenants.js";
import {
  addTrainingFile,
  addTrainingText,
  LIMITE_ARQUIVO_BYTES,
  listTraining,
  removeTraining,
} from "./training.js";
import {
  assinaturaValida,
  estadoInstagram,
  processarWebhookInstagram,
  verificarWebhook,
} from "./channels/instagram.js";
import {
  LIMITE_FOTO_BYTES,
  concluirRun,
  conversarGeracao,
  createChecklist,
  deleteChecklist,
  dispararChecklist,
  getChecklistInVenue,
  getRunByToken,
  getRunInVenue,
  itensDe,
  listChecklists,
  listRuns,
  marcarEmAndamento,
  salvarFotoDeItem,
  updateChecklist,
  urlAssinadaDaFoto,
  validarAgenda,
  validarItens,
  type MensagemGeracao,
  type RespostaItem,
} from "./checklists.js";
import { criarComandoPonte, lerEstadoPonte } from "./ponteWhatsapp.js";
import { db } from "./supabase.js";
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

/**
 * O banco responde, e responde com o poder certo?
 *
 * Existe porque uma falha específica é invisível de fora: com a chave `anon`
 * no lugar da `service_role`, o RLS (ligado em todas as tabelas, sem policy
 * permissiva) devolve ZERO LINHAS em vez de erro. A API sobe, o login
 * funciona, e todo o resto simplesmente parece vazio — o que se manifesta
 * como "chave inválida" e "conta sem estabelecimento" mesmo com os dados
 * todos lá. Descobrir isso por eliminação custa horas; aqui custa uma URL.
 *
 * Não expõe nada sensível: só contagens de linhas que o painel já mostra.
 */
async function diagnosticoDoBanco(): Promise<Record<string, unknown>> {
  // Referência do projeto: o "abcdefg" de https://abcdefg.supabase.co. Não é
  // segredo — vai em qualquer app cliente — e responde a pergunta que já custou
  // caro nesta base: o app fala com o MESMO projeto onde o SQL foi rodado?
  // Com duas contas Supabase, o SQL acerta um banco e o app lê o outro, e o
  // sintoma é dado que "existe" mas o sistema não encontra.
  const projeto = (process.env.SUPABASE_URL ?? "").match(/https?:\/\/([^.]+)\./)?.[1] ?? "?";

  try {
    const contar = (tabela: "organizations" | "api_keys" | "org_members" | "platform_admins") =>
      db().from(tabela).select("*", { count: "exact", head: true });

    const [orgs, chaves, membros, admins] = await Promise.all([
      contar("organizations"),
      contar("api_keys"),
      contar("org_members"),
      contar("platform_admins"),
    ]);

    const erroGrave = orgs.error ?? chaves.error;
    if (erroGrave) return { projeto, alcancavel: false, erro: erroGrave.message };

    const total = (orgs.count ?? 0) + (chaves.count ?? 0);
    return {
      projeto,
      alcancavel: true,
      organizacoes: orgs.count ?? 0,
      chaves_de_api: chaves.count ?? 0,
      // Tabelas do login por e-mail e senha. Erro aqui (e não zero) significa
      // que a migração não rodou NESTE projeto, ou que o PostgREST ainda não
      // recarregou o schema.
      vinculos: membros.error ? `erro: ${membros.error.message}` : (membros.count ?? 0),
      admins_da_plataforma: admins.error ? `erro: ${admins.error.message}` : (admins.count ?? 0),
      // Zero nas duas primeiras num banco em uso é o sintoma do RLS bloqueando
      // tudo. Nunca é o estado normal: sem organização e sem chave, ninguém
      // teria conseguido usar o sistema para chegar até aqui.
      credencial:
        total === 0
          ? "SUSPEITA: leituras vazias. SUPABASE_SERVICE_ROLE_KEY pode não ser a service_role (RLS bloqueando)."
          : "service_role ok",
    };
  } catch (e) {
    return { projeto, alcancavel: false, erro: e instanceof Error ? e.message : "falha desconhecida" };
  }
}

// ============================================================
// Autenticação
// ============================================================
/**
 * Quem está do outro lado da requisição.
 *
 * Dois caminhos chegam aqui e é de propósito: pessoas entram com e-mail e
 * senha (token do Supabase Auth), máquinas entram com chave `sk_...` — o
 * conector do WhatsApp roda num PC sem ninguém para digitar senha. As rotas
 * não precisam saber qual dos dois veio; recebem sempre o mesmo formato.
 */
interface Acesso {
  org_id: string;
  /** Assinatura da ação na inbox: nome da chave ou e-mail de quem agiu. */
  name: string;
  scopes: string[];
  plataformaAdmin: boolean;
}

/** Papel de pessoa vira escopo. `viewer` olha, não mexe. */
const ESCOPOS_POR_PAPEL: Record<string, string[]> = {
  owner: ["runs:write", "reservations:read", "reservations:write"],
  admin: ["runs:write", "reservations:read", "reservations:write"],
  member: ["runs:write", "reservations:read", "reservations:write"],
  plataforma: ["runs:write", "reservations:read", "reservations:write"],
  viewer: ["reservations:read"],
};

async function exigirChave(req: IncomingMessage, escopo: string): Promise<Acesso> {
  const header = req.headers.authorization ?? "";
  const credencial = header.startsWith("Bearer ") ? header.slice(7).trim() : undefined;

  if (!credencial) {
    throw erro(401, "unauthorized", "Faça login para continuar.");
  }

  // Chave de máquina: o prefixo torna a distinção inequívoca, sem precisar
  // tentar validar dos dois jeitos e ver qual não explode.
  if (credencial.startsWith("sk_")) {
    const apiKey = await authenticateApiKey(credencial);
    if (!apiKey) {
      throw erro(401, "unauthorized", "Chave de API ausente, inválida, revogada ou expirada.");
    }
    if (!hasScope(apiKey, escopo)) {
      throw erro(403, "forbidden", `Esta chave não tem o escopo "${escopo}".`);
    }
    return {
      org_id: apiKey.org_id,
      name: apiKey.name,
      scopes: apiKey.scopes,
      plataformaAdmin: false,
    };
  }

  // Sessão de pessoa.
  let sessao;
  try {
    sessao = await sessaoDoToken(credencial);
  } catch (e) {
    if (e instanceof ErroDeAcesso) throw erro(e.status, "unauthorized", e.message);
    throw e;
  }

  const scopes = ESCOPOS_POR_PAPEL[sessao.papel] ?? ESCOPOS_POR_PAPEL.viewer!;
  if (!sessao.plataformaAdmin && !scopes.includes(escopo)) {
    throw erro(403, "forbidden", "Seu perfil não permite esta ação.");
  }

  // Admin da plataforma sem organização própria pode olhar a de um cliente
  // passando ?org=slug — é como o suporte enxerga o que o cliente enxerga.
  return {
    org_id: sessao.orgId,
    name: sessao.email ?? "painel",
    scopes,
    plataformaAdmin: sessao.plataformaAdmin,
  };
}

/** Rotas de administração da plataforma exigem mais que estar logado. */
async function exigirAdminDaPlataforma(req: IncomingMessage): Promise<Acesso> {
  const acesso = await exigirChave(req, "reservations:read");
  if (!acesso.plataformaAdmin) {
    throw erro(403, "forbidden", "Esta área é da equipe Brasa Food.");
  }
  return acesso;
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
    return ok(res, {
      status: "ok",
      versao: versaoDoCodigo(),
      // A mesma frase de data que o agente recebe. Serve de teste rápido de
      // três coisas ao mesmo tempo: build atualizado, relógio da máquina certo
      // e fuso horário resolvendo. Um curl responde o que antes era palpite.
      agora: contextoDeAgora("America/Cuiaba"),
      banco: await diagnosticoDoBanco(),
      trace_id: traceId,
    });
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

    // ---- Avaliações do Google ----

    // GET /v1/venues/:slug/avaliacoes — fila + histórico + perfil, numa ida só
    if (metodo === "GET" && recurso === "avaliacoes" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const [perfil, fila, historico] = await Promise.all([
        perfilDoVenue(venue.id),
        filaDeAprovacao(venue.id),
        historicoDeAvaliacoes(venue.id),
      ]);
      return ok(res, { perfil, fila, historico });
    }

    // POST /v1/venues/:slug/avaliacoes — lança uma avaliação na mão e já redige
    if (metodo === "POST" && recurso === "avaliacoes" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);

      const nota = Number(corpo.nota);
      if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
        throw erro(400, "invalid_request", "A nota precisa ser um número inteiro de 1 a 5.");
      }
      return ok(
        res,
        await adicionarAvaliacaoManual({
          venue,
          autor: textoOpcional(corpo, "autor") ?? null,
          nota,
          comentario: textoOpcional(corpo, "comentario") ?? null,
        }),
        201,
      );
    }

    // PUT /v1/venues/:slug/avaliacoes-perfil — conexão e regras do perfil
    if (metodo === "PUT" && recurso === "avaliacoes-perfil" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);
      const nota = Number(corpo.nota_automatica);

      return ok(
        res,
        await salvarPerfil({
          venueId: venue.id,
          contaGerente: texto(corpo, "conta_gerente"),
          localId: textoOpcional(corpo, "local_id") ?? null,
          configuracao: {
            ...(Number.isInteger(nota) ? { nota_automatica: nota } : {}),
            assinatura: textoOpcional(corpo, "assinatura") ?? "",
            tom: textoOpcional(corpo, "tom") ?? "",
          },
        }),
      );
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

    // GET | POST /v1/venues/:slug/checklists — modelos do módulo Checklist
    if (recurso === "checklists" && p.length === 3) {
      if (metodo === "GET") {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        return ok(res, await listChecklists(venue.id));
      }
      if (metodo === "POST") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = await lerJson(req);
        try {
          const checklist = await createChecklist({
            venueId: venue.id,
            name: texto(corpo, "name"),
            description: textoOpcional(corpo, "description") ?? null,
            items: validarItens(corpo.items),
            schedule: validarAgenda(corpo.schedule),
          });
          return ok(res, checklist, 201);
        } catch (e) {
          throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
        }
      }
    }

    // GET /v1/venues/:slug/checklist-runs — histórico de execuções
    if (metodo === "GET" && recurso === "checklist-runs" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const [runs, modelos] = await Promise.all([
        listRuns(venue.id),
        listChecklists(venue.id),
      ]);
      const nomes = new Map(modelos.map((c) => [c.id, c.name]));
      return ok(
        res,
        runs.map((r) => ({ ...r, checklist_nome: nomes.get(r.checklist_id) ?? "—", answers: undefined, token: undefined })),
      );
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
      return ok(res, await metricasDoVenue(venue.id, venue.timezone));
    }

    // GET /v1/venues/:slug/pontos — saldo do plano, consumo por motor e
    // quanto tempo a sobra dura em cada um deles
    if (metodo === "GET" && recurso === "pontos") {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await extratoDePontos(venue));
    }
  }

  // ---- Autenticação de pessoas ----
  // Sem chave de API: são justamente as rotas de quem ainda não tem sessão.
  if (p[0] === "auth") {
    // POST /v1/auth/login — e-mail e senha em troca do par de tokens
    if (metodo === "POST" && p[1] === "login" && p.length === 2) {
      const corpo = await lerJson(req);
      try {
        const tokens = await entrar(texto(corpo, "email"), texto(corpo, "senha"));
        return ok(res, tokens);
      } catch (e) {
        if (e instanceof ErroDeAcesso) throw erro(e.status, "unauthorized", e.message);
        throw e;
      }
    }

    // POST /v1/auth/refresh — troca o token de renovação por um par novo
    if (metodo === "POST" && p[1] === "refresh" && p.length === 2) {
      const corpo = await lerJson(req);
      try {
        return ok(res, await renovar(texto(corpo, "refresh_token")));
      } catch (e) {
        if (e instanceof ErroDeAcesso) throw erro(e.status, "unauthorized", e.message);
        throw e;
      }
    }

    // POST /v1/auth/recuperar — sempre responde igual, exista o e-mail ou não
    if (metodo === "POST" && p[1] === "recuperar" && p.length === 2) {
      const corpo = await lerJson(req);
      const destino = textoOpcional(corpo, "redirect") ?? "";
      await pedirTrocaDeSenha(texto(corpo, "email"), destino);
      return ok(res, { enviado: true });
    }

    // POST /v1/auth/senha — define senha nova (recuperação ou troca voluntária)
    if (metodo === "POST" && p[1] === "senha" && p.length === 2) {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!token) throw erro(401, "unauthorized", "Link de troca de senha inválido.");
      const corpo = await lerJson(req);
      try {
        await trocarSenha(token, texto(corpo, "senha"));
        return ok(res, { trocada: true });
      } catch (e) {
        if (e instanceof ErroDeAcesso) throw erro(e.status, "invalid_request", e.message);
        throw e;
      }
    }

    // GET /v1/auth/me — quem sou eu, para o painel montar o menu
    if (metodo === "GET" && p[1] === "me" && p.length === 2) {
      const acesso = await exigirChave(req, "reservations:read");
      return ok(res, {
        nome: acesso.name,
        org_id: acesso.org_id,
        plataforma_admin: acesso.plataformaAdmin,
        escopos: acesso.scopes,
      });
    }
  }

  // ---- Administração da plataforma (equipe Brasa Food) ----
  // GET /v1/admin/resumo — números da carteira inteira
  if (metodo === "GET" && p[0] === "admin" && p[1] === "resumo" && p.length === 2) {
    await exigirAdminDaPlataforma(req);
    return ok(res, resumirPlataforma(await listarClientes()));
  }

  if (p[0] === "admin" && p[1] === "clientes") {
    // GET /v1/admin/clientes — carteira de clientes
    if (metodo === "GET" && p.length === 2) {
      await exigirAdminDaPlataforma(req);
      return ok(res, await listarClientes());
    }

    // PATCH /v1/admin/clientes/:orgId — dados comerciais (status, mensalidade)
    if (metodo === "PATCH" && p.length === 3) {
      await exigirAdminDaPlataforma(req);
      const corpo = await lerJson(req);
      const dados: { status_pagamento?: string; mensalidade?: number; vencimento_dia?: number } = {};

      const status = textoOpcional(corpo, "status_pagamento");
      if (status) {
        if (!["ativo", "atrasado", "suspenso", "cortesia", "cancelado"].includes(status)) {
          throw erro(400, "invalid_request", "Status de pagamento inválido.");
        }
        dados.status_pagamento = status;
      }
      if (typeof corpo.mensalidade === "number") dados.mensalidade = corpo.mensalidade;
      if (typeof corpo.vencimento_dia === "number") dados.vencimento_dia = corpo.vencimento_dia;

      if (Object.keys(dados).length === 0) {
        throw erro(400, "invalid_request", "Nada para atualizar.");
      }
      await atualizarComercial(p[2]!, dados);
      return ok(res, { atualizado: true });
    }

    // POST /v1/admin/clientes — cria organização, estabelecimento, agente,
    // conta do dono e chave do conector numa tacada
    if (metodo === "POST" && p.length === 2) {
      await exigirAdminDaPlataforma(req);
      const corpo = await lerJson(req);
      const plano = texto(corpo, "plano");
      if (!["essencial", "profissional", "casa_cheia", "cortesia"].includes(plano)) {
        throw erro(400, "invalid_request", "Plano inválido.");
      }
      try {
        const criado = await criarCliente({
          nome: texto(corpo, "nome"),
          slug: textoOpcional(corpo, "slug"),
          cidade: textoOpcional(corpo, "cidade"),
          timezone: texto(corpo, "timezone"),
          plano: plano as DadosDoCliente["plano"],
          emailDono: texto(corpo, "email"),
          telefone: textoOpcional(corpo, "telefone"),
          observacoes: textoOpcional(corpo, "observacoes"),
        });
        return ok(res, criado, 201);
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Não deu para cadastrar.");
      }
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
      const metaConversa = (conversa.metadata ?? {}) as Record<string, unknown>;
      return ok(res, {
        id: conversa.id,
        titulo: conversa.title,
        canal: conversa.channel,
        status: conversa.status,
        // O telefone legível gravado pelo canal; o external_id é o endereço
        // técnico (pode ser um id interno do WhatsApp, ilegível).
        contato:
          typeof metaConversa.contato === "string" ? metaConversa.contato : conversa.external_id,
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
  // POST /v1/avaliacoes/:id/aprovar|descartar
  if (metodo === "POST" && p[0] === "avaliacoes" && p.length === 3) {
    const chave = await exigirChave(req, "reservations:write");
    const acao = p[2]!;
    if (acao !== "aprovar" && acao !== "descartar") {
      throw erro(404, "not_found", `Ação "${acao}" não existe.`);
    }

    const encontrado = await avaliacaoComOrg(p[1]!);
    // Mesma resposta para "não existe" e "é de outra organização".
    if (!encontrado || encontrado.orgId !== chave.org_id) {
      throw erro(404, "not_found", "Avaliação não encontrada.");
    }

    if (acao === "descartar") {
      return ok(res, await descartarResposta(encontrado.avaliacao.id));
    }

    // O texto editado à mão vem junto: o dono corrige a resposta na hora de
    // aprovar, e é justamente nas avaliações que mais importam que ele corrige.
    const corpo = await lerJson(req);
    const editado = textoOpcional(corpo, "texto");
    if (editado !== undefined && editado.trim() === "") {
      throw erro(400, "invalid_request", "A resposta não pode ficar vazia.");
    }
    return ok(
      res,
      await aprovarResposta({
        id: encontrado.avaliacao.id,
        ...(editado ? { texto: editado.trim() } : {}),
      }),
    );
  }

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

  // ---- Checklists (gestão pelo painel) ----

  // POST /v1/checklists/gerar — a IA conversa antes de montar as perguntas.
  // Corpo: {mensagens:[{papel:"usuario"|"ia", texto}]}. Resposta: ou
  // {tipo:"pergunta", texto} (a IA quer saber mais) ou {tipo:"itens", itens}.
  if (metodo === "POST" && p[0] === "checklists" && p[1] === "gerar" && p.length === 2) {
    await exigirChave(req, "reservations:write");
    const corpo = await lerJson(req);
    const brutas = Array.isArray(corpo.mensagens) ? corpo.mensagens : [];
    const mensagens: MensagemGeracao[] = brutas
      .map((m) => {
        const o = (m ?? {}) as Record<string, unknown>;
        return {
          papel: o.papel === "ia" ? ("ia" as const) : ("usuario" as const),
          texto: typeof o.texto === "string" ? o.texto.trim() : "",
        };
      })
      .filter((m) => m.texto)
      .slice(-12);
    // Compatibilidade com o formato antigo ({descricao}).
    const descricaoLegada = textoOpcional(corpo, "descricao");
    if (mensagens.length === 0 && descricaoLegada) {
      mensagens.push({ papel: "usuario", texto: descricaoLegada });
    }
    try {
      return ok(res, await conversarGeracao(mensagens));
    } catch (e) {
      throw erro(400, "invalid_request", e instanceof Error ? e.message : "Não deu para gerar.");
    }
  }

  // PATCH | DELETE /v1/checklists/:id?venue=slug
  if ((metodo === "PATCH" || metodo === "DELETE") && p[0] === "checklists" && p.length === 2) {
    const chave = await exigirChave(req, "reservations:write");
    const slug = url.searchParams.get("venue");
    if (!slug) throw erro(400, "invalid_request", 'Informe o estabelecimento em "?venue=".');
    const venue = await findVenueBySlugInOrg(chave.org_id, slug);

    if (metodo === "DELETE") {
      await deleteChecklist(p[1]!, venue.id);
      return ok(res, { removido: true });
    }

    const corpo = await lerJson(req);
    try {
      const mudancas: Parameters<typeof updateChecklist>[2] = {};
      if ("name" in corpo) mudancas.name = texto(corpo, "name");
      if ("description" in corpo) mudancas.description = textoOpcional(corpo, "description") ?? null;
      if ("items" in corpo) mudancas.items = validarItens(corpo.items) as never;
      if ("schedule" in corpo) mudancas.schedule = validarAgenda(corpo.schedule) as never;
      if ("active" in corpo) mudancas.active = corpo.active === true;
      return ok(res, await updateChecklist(p[1]!, venue.id, mudancas));
    } catch (e) {
      throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
    }
  }

  // POST /v1/checklists/:id/disparar?venue=slug — envia o link agora
  if (metodo === "POST" && p[0] === "checklists" && p[2] === "disparar" && p.length === 3) {
    const chave = await exigirChave(req, "reservations:write");
    const slug = url.searchParams.get("venue");
    if (!slug) throw erro(400, "invalid_request", 'Informe o estabelecimento em "?venue=".');
    const venue = await findVenueBySlugInOrg(chave.org_id, slug);
    const checklist = await getChecklistInVenue(p[1]!, venue.id);
    if (!checklist) throw erro(404, "not_found", "Checklist não encontrado.");
    const { run, criadaAgora } = await dispararChecklist(checklist, venue);
    return ok(res, { run_id: run.id, criada_agora: criadaAgora, token: run.token });
  }

  // GET /v1/checklist-runs/:id?venue=slug — execução completa, com fotos assinadas
  if (metodo === "GET" && p[0] === "checklist-runs" && p.length === 2) {
    const chave = await exigirChave(req, "reservations:read");
    const slug = url.searchParams.get("venue");
    if (!slug) throw erro(400, "invalid_request", 'Informe o estabelecimento em "?venue=".');
    const venue = await findVenueBySlugInOrg(chave.org_id, slug);
    const run = await getRunInVenue(p[1]!, venue.id);
    if (!run) throw erro(404, "not_found", "Execução não encontrada.");
    const checklist = await getChecklistInVenue(run.checklist_id, venue.id);

    const respostas = Array.isArray(run.answers) ? (run.answers as unknown as RespostaItem[]) : [];
    const comFotos = await Promise.all(
      respostas.map(async (r) => ({
        ...r,
        foto_url: r.foto ? await urlAssinadaDaFoto(r.foto) : null,
      })),
    );
    return ok(res, {
      ...run,
      token: undefined,
      answers: comFotos,
      checklist: checklist ? { name: checklist.name, items: itensDe(checklist) } : null,
    });
  }

  // ---- Checklist público (quem executa, via token — sem chave de API) ----
  if (p[0] === "checklist-publico" && p.length >= 2) {
    const run = await getRunByToken(p[1]!);
    if (!run) throw erro(404, "not_found", "Este link de checklist não existe ou foi trocado.");
    const checklist = await getChecklistInVenue(run.checklist_id, run.venue_id);
    if (!checklist) throw erro(404, "not_found", "O checklist deste link foi removido.");
    const { data: venueRow } = await db()
      .from("venues")
      .select("id, name, timezone")
      .eq("id", run.venue_id)
      .single();
    if (!venueRow) throw erro(404, "not_found", "Estabelecimento não encontrado.");

    // GET /v1/checklist-publico/:token — perguntas e estado
    if (metodo === "GET" && p.length === 2) {
      await marcarEmAndamento(run);
      return ok(res, {
        checklist: checklist.name,
        descricao: checklist.description,
        venue: venueRow.name,
        data: run.scheduled_for,
        status: run.status,
        executor: run.executor_nome,
        itens: itensDe(checklist),
      });
    }

    // POST /v1/checklist-publico/:token/foto?item=ID — corpo binário
    if (metodo === "POST" && p[2] === "foto" && p.length === 3) {
      if (run.status === "concluida") {
        throw erro(409, "conflict", "Esta execução já foi concluída.");
      }
      const itemId = url.searchParams.get("item");
      if (!itemId || !itensDe(checklist).some((i) => i.id === itemId)) {
        throw erro(400, "invalid_request", "Item da foto não encontrado neste checklist.");
      }
      const arquivo = await lerBinario(req, LIMITE_FOTO_BYTES);
      if (arquivo.length === 0) throw erro(400, "invalid_request", "Foto vazia.");
      const contentType = req.headers["content-type"] ?? "image/jpeg";
      const caminho = await salvarFotoDeItem(run, itemId, arquivo, String(contentType));
      return ok(res, { foto: caminho }, 201);
    }

    // POST /v1/checklist-publico/:token/concluir — respostas + análise da IA
    if (metodo === "POST" && p[2] === "concluir" && p.length === 3) {
      const corpo = await lerJson(req);
      const brutas = Array.isArray(corpo.respostas) ? corpo.respostas : [];
      const respostas: RespostaItem[] = brutas.map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return {
          item: typeof o.item === "string" ? o.item : "",
          valor: typeof o.valor === "string" ? o.valor : null,
          foto: typeof o.foto === "string" ? o.foto : null,
          observacao: typeof o.observacao === "string" && o.observacao.trim() ? o.observacao.trim() : null,
        };
      });
      try {
        const resultado = await concluirRun({
          run,
          checklist,
          venue: venueRow,
          executorNome: texto(corpo, "executor"),
          respostas,
        });
        return ok(res, { concluida: true, resumo: resultado.resumo, alertas: resultado.alertas });
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Não deu para concluir.");
      }
    }
  }

  // ---- Instagram (API oficial da Meta) ----
  // O webhook NÃO usa chave de API: quem chama é a Meta. A segurança é o
  // verify token (GET de verificação) e a assinatura HMAC do corpo (POST).
  if (p[0] === "instagram" && p[1] === "webhook" && p.length === 2) {
    if (metodo === "GET") {
      const challenge = verificarWebhook(url.searchParams);
      if (challenge === null) {
        throw erro(403, "forbidden", "Verificação do webhook recusada.");
      }
      // A Meta espera o challenge cru, sem envelope JSON.
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(challenge);
      return;
    }

    if (metodo === "POST") {
      const bruto = await lerBinario(req, 1_000_000);
      const assinatura = req.headers["x-hub-signature-256"];
      if (!assinaturaValida(bruto, Array.isArray(assinatura) ? assinatura[0] : assinatura)) {
        throw erro(403, "forbidden", "Assinatura do webhook inválida.");
      }
      let corpo: unknown;
      try {
        corpo = JSON.parse(bruto.toString("utf8"));
      } catch {
        throw erro(400, "invalid_request", "Corpo do webhook não é JSON.");
      }
      // Processa antes de responder: em serverless, o trabalho morre junto
      // com a resposta. O agente responde em segundos; a Meta espera.
      await processarWebhookInstagram(corpo as Parameters<typeof processarWebhookInstagram>[0]);
      return ok(res, { recebido: true });
    }
  }

  // GET /v1/instagram/status — configuração do canal, para a aba Canais
  if (metodo === "GET" && p[0] === "instagram" && p[1] === "status" && p.length === 2) {
    await exigirChave(req, "reservations:write");
    return ok(res, estadoInstagram());
  }

  // ---- WhatsApp (Baileys) ----
  // Com conector no processo (PC/VPS): responde direto, ao vivo. Sem conector
  // (Vercel): ponte pelo banco — o site lê o estado que o conector publica e
  // enfileira comandos que ele consome em ~5s. Ver src/ponteWhatsapp.ts.
  if (p[0] === "whatsapp" && p.length === 2) {
    const chave = await exigirChave(req, "reservations:write");

    if (metodo === "GET" && p[1] === "status") {
      if (conectorWhatsapp) {
        const estado = conectorWhatsapp.estado() as Record<string, unknown>;
        return ok(res, { ...estado, versao: versaoDoCodigo(), fonte: "local" });
      }
      const slug = url.searchParams.get("venue");
      const venue = slug
        ? await findVenueBySlugInOrg(chave.org_id, slug)
        : (await listVenuesInOrg(chave.org_id))[0];
      if (!venue) throw erro(404, "not_found", "Nenhum estabelecimento cadastrado.");
      const estado = lerEstadoPonte(venue.settings ?? null);
      if (!estado) {
        // Nunca houve conector publicando: nem heartbeat velho existe.
        return ok(res, {
          status: "sem_conector",
          qr: null,
          telefone: null,
          agentSlug: null,
          venueSlug: venue.slug,
          versao: null,
          fonte: "ponte",
        });
      }
      return ok(res, { ...estado, fonte: "ponte" });
    }

    if (metodo === "POST" && p[1] === "conectar") {
      const corpo = await lerJson(req);
      const venueSlug = texto(corpo, "venue");
      const agentSlug = texto(corpo, "agent");

      // O conector responde por esta organização: confira antes de subir.
      const venue = await findVenueBySlugInOrg(chave.org_id, venueSlug);
      const agentes = await listAgentsInOrg(chave.org_id);
      if (!agentes.some((a) => a.slug === agentSlug)) {
        throw erro(404, "not_found", `Agente "${agentSlug}" não encontrado nesta organização.`);
      }

      if (conectorWhatsapp) {
        await conectorWhatsapp.iniciar({ agentSlug, venueSlug });
        return ok(res, conectorWhatsapp.estado());
      }
      await criarComandoPonte(venue.id, { acao: "conectar", agent: agentSlug });
      return ok(res, { na_fila: true, acao: "conectar" });
    }

    if (metodo === "POST" && p[1] === "desconectar") {
      if (conectorWhatsapp) {
        await conectorWhatsapp.parar();
        return ok(res, conectorWhatsapp.estado());
      }
      const corpo = await lerJson(req);
      const slug = textoOpcional(corpo, "venue");
      const venue = slug
        ? await findVenueBySlugInOrg(chave.org_id, slug)
        : (await listVenuesInOrg(chave.org_id))[0];
      if (!venue) throw erro(404, "not_found", "Nenhum estabelecimento cadastrado.");
      await criarComandoPonte(venue.id, { acao: "desconectar" });
      return ok(res, { na_fila: true, acao: "desconectar" });
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
  chave: Acesso,
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
    try {
      const resultado = await runAgent({ agentSlug, userMessage, channel, externalId, venueSlug });
      return ok(res, {
        conversation_id: resultado.conversationId,
        output: resultado.text,
        stop_reason: resultado.stopReason,
      });
    } catch (e) {
      // 402 e não 500: não é defeito do sistema, é plano a renovar. O código
      // distingue "quebrou" de "acabou" para quem integra pela API.
      if (e instanceof PlanoBloqueadoError) throw erro(402, "pontos_esgotados", e.message);
      throw e;
    }
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
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  // Sem estes dois, robots.txt e sitemap.xml saem como
  // application/octet-stream e o buscador os ignora — servidos, mas inúteis.
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

// Rotas "bonitas" sem extensão — a mesma coisa que o rewrite faz na Vercel.
// A raiz é a página de vendas: quem chega pela primeira vez não pode cair
// numa caixa pedindo uma chave sem saber o que é o produto.
//
// A landing é o próprio index.html, e não um rewrite de "/" para outro
// arquivo, porque na Vercel os rewrites só valem quando NENHUM arquivo casa
// com a rota — um index.html no diretório público ganharia da regra e a
// landing nunca apareceria. O painel virou app.html pelo mesmo motivo.
const PAGINAS_LIMPAS: Record<string, string> = {
  "/": "index.html",
  "/app": "app.html",
  "/painel": "app.html",
  "/entrar": "app.html",
  "/checklist": "checklist.html",
  "/privacidade": "privacidade.html",
  "/termos": "termos.html",
};

async function servirEstatico(res: ServerResponse, caminho: string): Promise<void> {
  const relativo = PAGINAS_LIMPAS[caminho] ?? caminho.slice(1);

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
