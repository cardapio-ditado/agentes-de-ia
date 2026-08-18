import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { anthropicConfig } from "./config.js";
import { db } from "./supabase.js";
import type { Json, Tables } from "./database.types.js";
import type { Venue } from "./venues.js";

export type GooglePerfil = Tables<"google_perfis">;
export type Avaliacao = Tables<"google_avaliacoes">;

/**
 * Traduz "a tabela não existe" para uma resposta que diz o que fazer.
 *
 * Sem isto, esquecer de rodar a migração vira "Erro interno, consulte o
 * trace-id no log" — que manda a pessoa caçar log na Vercel para descobrir
 * algo que o próprio sistema já sabe. O formato {status, code, message} é o
 * que o tratador de erros repassa ao cliente em vez de engolir.
 *
 * 42P01 é o Postgres ("relation does not exist"); PGRST205 é o PostgREST
 * respondendo pelo cache de schema, que é o caso mais comum logo depois de
 * uma migração.
 */
export function traduzirFalha(mensagem: string, contexto: string): never {
  if (/42P01|PGRST205|does not exist|schema cache/i.test(mensagem)) {
    throw {
      status: 503,
      code: "modulo_nao_instalado",
      message:
        "O módulo de Avaliações ainda não foi instalado no banco. " +
        "Rode a migração 20260818000000_create_avaliacoes_google.sql no Supabase.",
    };
  }
  throw new Error(`${contexto}: ${mensagem}`);
}

/**
 * Avaliações do Google: lê o que os clientes escreveram, redige a resposta e
 * segura na fila o que não pode sair sozinho.
 *
 * Este arquivo não sabe COMO as avaliações chegam nem como a resposta é
 * publicada. Hoje isso é feito por navegação na interface, com uma conta
 * gerente que o dono autoriza no próprio perfil; quando o acesso à API oficial
 * sair, troca-se o motor e nada aqui muda. Por isso a regra de negócio mora
 * neste módulo, e não no conector.
 */

const MODELO_IA = "claude-sonnet-5";

/**
 * Nota a partir da qual a resposta pode ser publicada sem ninguém olhar.
 * O estabelecimento pode subir este número (ficar mais conservador).
 */
const NOTA_AUTOMATICA_PADRAO = 4;

/**
 * Piso que configuração nenhuma derruba.
 *
 * Nota 1 e 2 sempre passam por gente. Não é preferência: avaliação ruim é a
 * que vira print e a que mais custa quando a resposta sai fria, genérica ou
 * prometendo o que a casa não vai cumprir. Se este piso fosse configurável,
 * bastaria um cliente afobado marcando "responder tudo" para transformar o
 * pior caso em automático — e o estrago apareceria no perfil dele, em público.
 */
export const NOTA_MINIMA_PARA_AUTOMATICO = 3;

export type Liberacao = "automatica" | "humana";

export interface ConfiguracaoPerfil {
  /** Nota a partir da qual publica sozinho. Nunca abaixo do piso. */
  nota_automatica: number;
  /** Como a casa assina as respostas. */
  assinatura: string;
  /** Instrução de tom, escrita pelo estabelecimento. */
  tom: string;
}

export function lerConfiguracao(perfil: Pick<GooglePerfil, "configuracao">): ConfiguracaoPerfil {
  const bruto = (perfil.configuracao ?? {}) as Record<string, unknown>;
  const nota = Number(bruto.nota_automatica);
  return {
    nota_automatica: Number.isInteger(nota) ? nota : NOTA_AUTOMATICA_PADRAO,
    assinatura: typeof bruto.assinatura === "string" ? bruto.assinatura : "",
    tom: typeof bruto.tom === "string" ? bruto.tom : "",
  };
}

/**
 * Quem libera esta resposta: o sistema ou uma pessoa.
 *
 * Função pura de propósito — é a regra mais importante do módulo e a que
 * precisa continuar valendo quando o motor de publicação mudar.
 */
export function politicaDeResposta(nota: number, config: ConfiguracaoPerfil): Liberacao {
  if (nota < NOTA_MINIMA_PARA_AUTOMATICO) return "humana";
  return nota >= config.nota_automatica ? "automatica" : "humana";
}

// ============================================================
// Perfil
// ============================================================

export async function perfilDoVenue(venueId: string): Promise<GooglePerfil | null> {
  const { data, error } = await db()
    .from("google_perfis")
    .select("*")
    .eq("venue_id", venueId)
    .maybeSingle();

  if (error) traduzirFalha(error.message, "Falha ao carregar o perfil do Google");
  return data;
}

/**
 * Cria ou atualiza a ligação com o perfil do Google.
 *
 * Upsert por venue, e não insert: o dono vai reconectar — trocar de conta
 * gerente, refazer depois de uma sessão expirada — e cada tentativa criando
 * uma linha nova daria duas respostas na mesma avaliação.
 */
export async function salvarPerfil(params: {
  venueId: string;
  contaGerente: string;
  localId?: string | null;
  configuracao?: Partial<ConfiguracaoPerfil>;
}): Promise<GooglePerfil> {
  const atual = await perfilDoVenue(params.venueId);
  const configuracao = {
    ...(atual ? lerConfiguracao(atual) : { nota_automatica: NOTA_AUTOMATICA_PADRAO, assinatura: "", tom: "" }),
    ...params.configuracao,
  };

  // O piso vale também na gravação: configuração fora da regra não deve nem
  // chegar ao banco, para o painel nunca exibir uma promessa que o código não
  // vai cumprir.
  configuracao.nota_automatica = Math.max(
    NOTA_MINIMA_PARA_AUTOMATICO,
    Math.min(5, configuracao.nota_automatica),
  );

  const linha = {
    venue_id: params.venueId,
    conta_gerente: params.contaGerente,
    local_id: params.localId ?? atual?.local_id ?? null,
    configuracao: configuracao as unknown as Json,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = atual
    ? await db().from("google_perfis").update(linha).eq("id", atual.id).select().single()
    : await db().from("google_perfis").insert(linha).select().single();

  if (error) traduzirFalha(error.message, "Falha ao salvar o perfil do Google");
  return data;
}

// ============================================================
// Entrada de avaliações
// ============================================================

export interface AvaliacaoRecebida {
  /** Id da avaliação no Google — é o que garante idempotência. */
  avaliacao_id: string;
  autor: string | null;
  nota: number;
  comentario: string | null;
  avaliada_em: string | null;
}

/**
 * Grava as avaliações que chegaram e devolve só as novas.
 *
 * Devolve as novas, e não todas, porque quem chama vai gerar resposta para
 * cada uma — e gerar de novo para avaliação já respondida significaria pagar
 * o modelo duas vezes e, pior, sobrescrever um texto que uma pessoa já leu e
 * aprovou. O índice único em (venue_id, avaliacao_id) é a rede de segurança.
 */
export async function registrarAvaliacoes(
  venueId: string,
  recebidas: AvaliacaoRecebida[],
): Promise<Avaliacao[]> {
  if (recebidas.length === 0) return [];

  const ids = recebidas.map((a) => a.avaliacao_id);
  const { data: existentes, error: erroBusca } = await db()
    .from("google_avaliacoes")
    .select("avaliacao_id")
    .eq("venue_id", venueId)
    .in("avaliacao_id", ids);

  if (erroBusca) traduzirFalha(erroBusca.message, "Falha ao conferir as avaliações já gravadas");
  const jaTemos = new Set((existentes ?? []).map((e) => e.avaliacao_id));

  const novas = recebidas.filter((a) => !jaTemos.has(a.avaliacao_id));
  if (novas.length === 0) return [];

  const { data, error } = await db()
    .from("google_avaliacoes")
    .insert(
      novas.map((a) => ({
        venue_id: venueId,
        avaliacao_id: a.avaliacao_id,
        autor: a.autor,
        nota: a.nota,
        comentario: a.comentario,
        avaliada_em: a.avaliada_em,
      })),
    )
    .select();

  if (error) traduzirFalha(error.message, "Falha ao gravar as avaliações");
  return data ?? [];
}

// ============================================================
// Redação da resposta
// ============================================================

let cachedClient: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic({ apiKey: anthropicConfig().apiKey });
  return cachedClient;
}

/**
 * Monta a instrução do modelo.
 *
 * Separada da chamada para poder ser lida e testada. O texto é longo de
 * propósito: resposta a avaliação pública é escrita curta com muita regra por
 * trás, e cada linha aqui existe para evitar um erro que já vi em respostas
 * automáticas por aí.
 */
export function promptDeResposta(params: {
  venue: Pick<Venue, "name">;
  config: ConfiguracaoPerfil;
  respostasAnteriores: string[];
}): string {
  const { venue, config, respostasAnteriores } = params;
  const linhas = [
    `Você escreve as respostas públicas do restaurante ${venue.name} às avaliações no Google.`,
    "",
    "Regras:",
    "- Escreva em português do Brasil, no máximo 3 frases.",
    "- Fale como gente da casa, não como atendimento corporativo.",
    "- Agradeça sem bajular. Nada de 'ficamos imensamente lisonjeados'.",
    "- Cite algo específico do que a pessoa escreveu. Resposta genérica é pior que nenhuma.",
    "- NUNCA prometa cortesia, desconto, reembolso ou brinde. Isso é decisão do dono, não sua.",
    "- NUNCA invente fato: se a pessoa reclama de algo que você não sabe, reconheça sem explicar a causa.",
    "- Não peça para a pessoa mudar a nota.",
    "- Não repita a estrutura das respostas anteriores. Avaliação respondida em série é lida como robô — pelo cliente e pelo Google.",
  ];

  if (config.tom) linhas.push("", `Tom desta casa: ${config.tom}`);
  if (config.assinatura) linhas.push(`Assine como: ${config.assinatura}`);

  if (respostasAnteriores.length > 0) {
    linhas.push(
      "",
      "Respostas recentes desta casa — escreva DIFERENTE destas:",
      ...respostasAnteriores.map((r) => `- ${r}`),
    );
  }

  linhas.push("", "Responda apenas com o texto da resposta, sem aspas e sem comentários.");
  return linhas.join("\n");
}

/** Últimas respostas publicadas, para o modelo não repetir a fórmula. */
async function respostasRecentes(venueId: string, limite = 5): Promise<string[]> {
  const { data, error } = await db()
    .from("google_avaliacoes")
    .select("resposta")
    .eq("venue_id", venueId)
    .eq("resposta_status", "publicada")
    .not("resposta", "is", null)
    .order("publicada_em", { ascending: false })
    .limit(limite);

  if (error) return [];
  return (data ?? []).map((d) => d.resposta).filter((r): r is string => Boolean(r));
}

export async function gerarResposta(params: {
  avaliacao: Avaliacao;
  venue: Pick<Venue, "name">;
  config: ConfiguracaoPerfil;
}): Promise<{ texto: string; modelo: string }> {
  const { avaliacao, venue, config } = params;

  const resposta = await anthropic().messages.create({
    model: MODELO_IA,
    max_tokens: 400,
    system: promptDeResposta({
      venue,
      config,
      respostasAnteriores: await respostasRecentes(avaliacao.venue_id),
    }),
    messages: [
      {
        role: "user",
        content: [
          `Avaliação de ${avaliacao.autor ?? "cliente"} — ${avaliacao.nota} estrela(s):`,
          avaliacao.comentario?.trim() || "(sem comentário, só a nota)",
        ].join("\n"),
      },
    ],
  });

  const texto = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!texto) throw new Error("O modelo não devolveu texto para esta avaliação.");
  return { texto, modelo: resposta.model };
}

/**
 * Gera a resposta e a coloca no estado certo: liberada ou esperando gente.
 */
export async function prepararResposta(params: {
  avaliacao: Avaliacao;
  venue: Pick<Venue, "name">;
  config: ConfiguracaoPerfil;
}): Promise<Avaliacao> {
  const { avaliacao, config } = params;
  const liberacao = politicaDeResposta(avaliacao.nota, config);

  try {
    const { texto, modelo } = await gerarResposta(params);
    return await atualizar(avaliacao.id, {
      resposta: texto,
      modelo,
      liberacao,
      // Liberação automática já nasce aprovada; o resto espera uma pessoa.
      resposta_status: liberacao === "automatica" ? "aprovada" : "rascunho",
      ultimo_erro: null,
    });
  } catch (e) {
    // Falha ao redigir não pode sumir: a avaliação continua lá, pública e sem
    // resposta, e alguém precisa ver isso no painel.
    return await atualizar(avaliacao.id, {
      resposta_status: "erro",
      ultimo_erro: e instanceof Error ? e.message : String(e),
    });
  }
}

// ============================================================
// Fila de aprovação
// ============================================================

/** O que espera decisão humana — nota baixa primeiro. */
export async function filaDeAprovacao(venueId: string): Promise<Avaliacao[]> {
  const { data, error } = await db()
    .from("google_avaliacoes")
    .select("*")
    .eq("venue_id", venueId)
    .eq("resposta_status", "rascunho")
    .order("nota", { ascending: true })
    .order("avaliada_em", { ascending: true });

  if (error) traduzirFalha(error.message, "Falha ao carregar a fila de avaliações");
  return data ?? [];
}

/** O que o publicador deve levar para o Google. */
export async function prontasParaPublicar(venueId: string): Promise<Avaliacao[]> {
  const { data, error } = await db()
    .from("google_avaliacoes")
    .select("*")
    .eq("venue_id", venueId)
    .eq("resposta_status", "aprovada")
    .not("resposta", "is", null)
    .order("avaliada_em", { ascending: true });

  if (error) traduzirFalha(error.message, "Falha ao carregar as respostas aprovadas");
  return data ?? [];
}

/**
 * A avaliação junto com a organização dona dela.
 *
 * Existe para a rota poder responder 404 igual para "não existe" e "é de outra
 * organização" — a diferença entre as duas respostas conta a quem perguntou
 * que o registro existe.
 */
export async function avaliacaoComOrg(
  id: string,
): Promise<{ avaliacao: Avaliacao; orgId: string } | null> {
  const { data, error } = await db()
    .from("google_avaliacoes")
    .select("*, venues!inner(org_id)")
    .eq("id", id)
    .maybeSingle();

  if (error) traduzirFalha(error.message, "Falha ao carregar a avaliação");
  if (!data) return null;

  const { venues, ...avaliacao } = data as Avaliacao & { venues: { org_id: string } };
  return { avaliacao, orgId: venues.org_id };
}

/** Tudo que já passou por aqui, do mais recente para o mais antigo. */
export async function historicoDeAvaliacoes(venueId: string, limite = 50): Promise<Avaliacao[]> {
  const { data, error } = await db()
    .from("google_avaliacoes")
    .select("*")
    .eq("venue_id", venueId)
    .order("avaliada_em", { ascending: false, nullsFirst: false })
    .limit(limite);

  if (error) traduzirFalha(error.message, "Falha ao carregar o histórico de avaliações");
  return data ?? [];
}

/**
 * Lança uma avaliação na mão e já redige a resposta.
 *
 * Existe para o módulo poder ser usado e ajustado ANTES de qualquer automação
 * tocar num perfil de verdade. É assim que se descobre que o tom está errado
 * sem descobrir isso em público.
 */
export async function adicionarAvaliacaoManual(params: {
  venue: Pick<Venue, "id" | "name">;
  autor: string | null;
  nota: number;
  comentario: string | null;
  avaliadaEm?: string | null;
}): Promise<Avaliacao> {
  const { venue } = params;
  const [criada] = await registrarAvaliacoes(venue.id, [
    {
      // Prefixo "manual:" para nunca colidir com um id vindo do Google.
      avaliacao_id: `manual:${randomUUID()}`,
      autor: params.autor,
      nota: params.nota,
      comentario: params.comentario,
      avaliada_em: params.avaliadaEm ?? new Date().toISOString(),
    },
  ]);
  if (!criada) throw new Error("Não foi possível gravar a avaliação.");

  const perfil = await perfilDoVenue(venue.id);
  const config = perfil
    ? lerConfiguracao(perfil)
    : lerConfiguracao({ configuracao: {} as unknown as Json });

  return await prepararResposta({ avaliacao: criada, venue, config });
}

/**
 * Aprova a resposta. `texto` permite ao dono editar antes de liberar — e ele
 * costuma editar justamente nas avaliações que mais importam.
 */
export async function aprovarResposta(params: {
  id: string;
  usuarioId?: string;
  texto?: string;
}): Promise<Avaliacao> {
  return await atualizar(params.id, {
    resposta_status: "aprovada",
    liberacao: "humana",
    aprovada_por: params.usuarioId ?? null,
    ...(params.texto ? { resposta: params.texto } : {}),
  });
}

/** Decisão de não responder. Some da fila sem virar resposta. */
export async function descartarResposta(id: string, usuarioId?: string): Promise<Avaliacao> {
  return await atualizar(id, {
    resposta_status: "descartada",
    aprovada_por: usuarioId ?? null,
  });
}

export async function marcarPublicada(id: string): Promise<Avaliacao> {
  return await atualizar(id, {
    resposta_status: "publicada",
    publicada_em: new Date().toISOString(),
    ultimo_erro: null,
  });
}

export async function marcarErroDePublicacao(id: string, motivo: string): Promise<Avaliacao> {
  return await atualizar(id, { resposta_status: "erro", ultimo_erro: motivo });
}

async function atualizar(id: string, campos: Record<string, Json>): Promise<Avaliacao> {
  const { data, error } = await db()
    .from("google_avaliacoes")
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) traduzirFalha(error.message, "Falha ao atualizar a avaliação");
  return data;
}
