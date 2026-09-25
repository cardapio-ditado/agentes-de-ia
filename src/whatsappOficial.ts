import { db, ehMigracaoPendente } from "./supabase.js";

/**
 * A CONEXÃO OFICIAL DO WHATSAPP, POR CASA.
 *
 * O canal oficial (Cloud API da Meta) nasceu preso às variáveis de ambiente:
 * um token, um telefone, um agente — para o sistema inteiro. Servia para a
 * primeira casa e para mais nenhuma. Aqui a conexão vira dado da casa: cada
 * uma cola o seu token e os seus IDs na tela de Ajustes, escolhe quem
 * responde, e o mesmo webhook atende todas.
 *
 * AS VARIÁVEIS DE AMBIENTE CONTINUAM VALENDO como conexão da casa que elas
 * nomeiam (`WHATSAPP_CLOUD_VENUE`). É o que mantém a primeira casa no ar
 * enquanto a linha dela não existe no banco — e o que faz este módulo
 * funcionar num banco sem a migração.
 *
 * OS DOIS IDs DA META não são intercambiáveis, e a Meta não avisa quando se
 * troca um pelo outro: o envio com o ID da conta falha em silêncio, e o
 * webhook ignora tudo. Foi exatamente isso que calou a primeira casa por
 * dias. Daí o teste: ele pergunta à Meta quem é o telefone (o ID do telefone
 * responde com o número; o da conta, com erro) e inscreve a conta no app —
 * o passo que ninguém sabe que existe até faltar.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

const VERSAO_PADRAO = "v21.0";

export class ErroDaConexao extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDaConexao";
  }
}

export interface ConexaoOficial {
  venue_id: string;
  token: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  agent_slug: string | null;
  telefone: string | null;
  nome_verificado: string | null;
  inscrita_em: string | null;
  testada_em: string | null;
}

export function conexaoVazia(venueId: string): ConexaoOficial {
  return {
    venue_id: venueId,
    token: null,
    phone_number_id: null,
    waba_id: null,
    agent_slug: null,
    telefone: null,
    nome_verificado: null,
    inscrita_em: null,
    testada_em: null,
  };
}

// ============================================================
// As regras — puras, testáveis sem banco
// ============================================================

/** O que ainda falta preencher para a conexão servir para alguma coisa. */
export function faltaOQue(c: ConexaoOficial): string[] {
  const falta: string[] = [];
  if (!c.token) falta.push("o token de acesso");
  if (!c.phone_number_id) falta.push("o ID do telefone");
  if (!c.waba_id) falta.push("o ID da conta");
  return falta;
}

/** Dá para ENVIAR por ela? Token e telefone bastam. */
export function prontaParaEnviar(c: ConexaoOficial | null): c is ConexaoOficial & { token: string; phone_number_id: string } {
  return Boolean(c?.token && c.phone_number_id);
}

/** Dá para ATENDER por ela? Enviar, e alguém do outro lado. */
export function prontaParaAtender(c: ConexaoOficial | null): c is ConexaoOficial & { token: string; phone_number_id: string; agent_slug: string } {
  return prontaParaEnviar(c) && Boolean(c.agent_slug);
}

export type SituacaoDaConexao = "nao_configurada" | "incompleta" | "falta_testar" | "ativa";

/**
 * Em que pé está a conexão, para a tela.
 *
 * "Ativa" exige o teste: preenchida mas nunca testada pode ter o ID trocado,
 * e a tela dizer "ativa" nesse estado é mentir justamente sobre o erro mais
 * comum.
 */
export function situacaoDa(c: ConexaoOficial): SituacaoDaConexao {
  const falta = faltaOQue(c);
  if (falta.length === 3) return "nao_configurada";
  if (falta.length > 0) return "incompleta";
  if (!c.testada_em || !c.inscrita_em) return "falta_testar";
  return "ativa";
}

/** "…k3Qa" — o bastante para reconhecer o token, nunca para usá-lo. */
export function mascarar(token: string | null): string | null {
  if (!token) return null;
  return `…${token.slice(-4)}`;
}

/** A conexão como a tela vê: tudo, menos o token. */
export function paraOPainel(c: ConexaoOficial): Record<string, unknown> {
  return {
    phone_number_id: c.phone_number_id,
    waba_id: c.waba_id,
    agent_slug: c.agent_slug,
    telefone: c.telefone,
    nome_verificado: c.nome_verificado,
    inscrita_em: c.inscrita_em,
    testada_em: c.testada_em,
    tem_token: Boolean(c.token),
    token_final: mascarar(c.token),
    situacao: situacaoDa(c),
    falta: faltaOQue(c),
  };
}

export type CamposDaConexao = Partial<Pick<ConexaoOficial, "token" | "phone_number_id" | "waba_id" | "agent_slug">>;

/**
 * Mistura o que veio da tela com o que está salvo.
 *
 * `undefined` não mexe; `""` apaga. É como o campo do token funciona: a
 * tela nunca recebe o token de volta, então "não digitei nada" tem de
 * significar "mantém o que está", senão salvar o agente apagaria o token.
 */
export function mesclar(atual: ConexaoOficial, campos: CamposDaConexao): ConexaoOficial {
  const proxima = { ...atual };
  for (const chave of ["token", "phone_number_id", "waba_id", "agent_slug"] as const) {
    const valor = campos[chave];
    if (valor === undefined) continue;
    const limpo = valor === null ? null : valor.trim() || null;
    if (limpo !== proxima[chave]) {
      proxima[chave] = limpo;
      // Trocou telefone, conta ou token: o teste anterior não vale mais.
      if (chave !== "agent_slug") {
        proxima.telefone = null;
        proxima.nome_verificado = null;
        proxima.inscrita_em = null;
        proxima.testada_em = null;
      }
    }
  }
  return proxima;
}

/**
 * O erro da Meta em português de gente.
 *
 * A Meta responde a tudo com "(#100) Unsupported get request" ou "Invalid
 * OAuth access token", e o dono do bar não tem como saber se colou o ID
 * errado ou se o token venceu. Os códigos dizem; a mensagem, não.
 */
export function explicarErroDaMeta(erro: { code?: number; message?: string; error_subcode?: number } | null | undefined, contexto: "telefone" | "conta"): string {
  const code = erro?.code;
  const msg = erro?.message ?? "";
  if (code === 190) return "O token de acesso não vale mais (venceu ou foi trocado). Gere um novo na Meta e cole aqui.";
  if (code === 10 || code === 200 || /permission/i.test(msg)) {
    return "O token não tem permissão para esta conta. Gere o token com whatsapp_business_management e whatsapp_business_messaging, no app certo.";
  }
  if (code === 100 || /does not exist|unsupported|cannot be loaded/i.test(msg)) {
    return contexto === "telefone"
      ? "A Meta não achou um telefone com este ID. Confira se é o ID do TELEFONE (e não o da conta) — os dois têm o mesmo tamanho."
      : "A Meta não achou uma conta com este ID. Confira se é o ID da CONTA do WhatsApp Business (e não o do telefone).";
  }
  return msg ? `A Meta respondeu: ${msg}` : "A Meta não respondeu como esperado.";
}

// ============================================================
// As variáveis de ambiente como conexão da casa que elas nomeiam
// ============================================================

function daVariaveisDeAmbiente(): (ConexaoOficial & { venue_slug: string }) | null {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const venueSlug = process.env.WHATSAPP_CLOUD_VENUE || process.env.INSTAGRAM_VENUE || process.env.WHATSAPP_VENUE;
  if (!token || !phoneNumberId || !venueSlug) return null;
  return {
    venue_id: "",
    venue_slug: venueSlug,
    token,
    phone_number_id: phoneNumberId,
    waba_id: process.env.WHATSAPP_WABA_ID ?? null,
    agent_slug: process.env.WHATSAPP_CLOUD_AGENT || process.env.INSTAGRAM_AGENT || null,
    telefone: null,
    nome_verificado: null,
    inscrita_em: null,
    testada_em: null,
  };
}

// ============================================================
// Banco
// ============================================================

function daLinha(linha: Record<string, unknown>): ConexaoOficial {
  return {
    venue_id: String(linha.venue_id),
    token: (linha.token as string | null) ?? null,
    phone_number_id: (linha.phone_number_id as string | null) ?? null,
    waba_id: (linha.waba_id as string | null) ?? null,
    agent_slug: (linha.agent_slug as string | null) ?? null,
    telefone: (linha.telefone as string | null) ?? null,
    nome_verificado: (linha.nome_verificado as string | null) ?? null,
    inscrita_em: (linha.inscrita_em as string | null) ?? null,
    testada_em: (linha.testada_em as string | null) ?? null,
  };
}

/**
 * A conexão da casa: a do banco, ou a das variáveis de ambiente se elas
 * nomeiam esta casa, ou vazia.
 */
export async function conexaoDaCasa(venue: { id: string; slug?: string }): Promise<ConexaoOficial> {
  const { data, error } = await cliente()
    .from("whatsapp_oficial")
    .select("*")
    .eq("venue_id", venue.id)
    .maybeSingle();
  if (error && !ehMigracaoPendente(error.message)) {
    throw new ErroDaConexao(500, `Falha ao ler a conexão do WhatsApp oficial: ${error.message}`);
  }
  if (data) return daLinha(data);

  const doAmbiente = daVariaveisDeAmbiente();
  if (doAmbiente) {
    // Quem chama com a notificação na mão só tem o id da casa.
    const slug = venue.slug ?? (await slugDaCasa(venue.id));
    if (slug === doAmbiente.venue_slug) return { ...doAmbiente, venue_id: venue.id };
  }
  return conexaoVazia(venue.id);
}

async function slugDaCasa(venueId: string): Promise<string | null> {
  const { data } = await cliente().from("venues").select("slug").eq("id", venueId).maybeSingle();
  return (data?.slug as string | undefined) ?? null;
}

/**
 * De quem é este telefone? É a pergunta do webhook.
 *
 * Devolve a conexão E o slug da casa, porque é o slug que o agente usa.
 */
export async function conexaoPeloNumero(
  phoneNumberId: string | null | undefined,
): Promise<(ConexaoOficial & { venue_slug: string }) | null> {
  if (!phoneNumberId) return null;

  const { data, error } = await cliente()
    .from("whatsapp_oficial")
    .select("*, venues!inner(slug)")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error && !ehMigracaoPendente(error.message)) {
    console.error(`[whatsapp-oficial] não li a conexão do telefone ${phoneNumberId}: ${error.message}`);
  }
  if (data) {
    const venues = data.venues as { slug: string } | { slug: string }[] | null;
    const slug = Array.isArray(venues) ? venues[0]?.slug : venues?.slug;
    if (slug) return { ...daLinha(data), venue_slug: slug };
  }

  const doAmbiente = daVariaveisDeAmbiente();
  if (doAmbiente && doAmbiente.phone_number_id === phoneNumberId) return doAmbiente;
  return null;
}

export async function salvarConexao(
  venue: { id: string; slug: string },
  campos: CamposDaConexao,
): Promise<ConexaoOficial> {
  const proxima = mesclar(await conexaoDaCasa(venue), campos);
  const { error } = await cliente()
    .from("whatsapp_oficial")
    .upsert(
      {
        venue_id: venue.id,
        token: proxima.token,
        phone_number_id: proxima.phone_number_id,
        waba_id: proxima.waba_id,
        agent_slug: proxima.agent_slug,
        telefone: proxima.telefone,
        nome_verificado: proxima.nome_verificado,
        inscrita_em: proxima.inscrita_em,
        testada_em: proxima.testada_em,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "venue_id" },
    );
  if (error) {
    if (ehMigracaoPendente(error.message)) {
      throw new ErroDaConexao(503, "O banco ainda não tem a tabela da conexão oficial. Aplique a migração e tente de novo.");
    }
    if (String(error.code) === "23505") {
      throw new ErroDaConexao(409, "Este ID de telefone já está conectado em outra casa.");
    }
    throw new ErroDaConexao(500, `Falha ao salvar a conexão: ${error.message}`);
  }
  return proxima;
}

export async function apagarConexao(venueId: string): Promise<void> {
  const { error } = await cliente().from("whatsapp_oficial").delete().eq("venue_id", venueId);
  if (error && !ehMigracaoPendente(error.message)) {
    throw new ErroDaConexao(500, `Falha ao remover a conexão: ${error.message}`);
  }
}

// ============================================================
// O teste: perguntar à Meta quem é o telefone, e inscrever a conta
// ============================================================

export interface ResultadoDoTeste {
  telefone: string;
  nome_verificado: string | null;
  qualidade: string | null;
  inscrita: boolean;
}

type RespostaDaMeta<T> = T & { error?: { code?: number; message?: string; error_subcode?: number } };

async function graph<T>(caminho: string, token: string, metodo: "GET" | "POST" = "GET"): Promise<RespostaDaMeta<T>> {
  const versao = process.env.WHATSAPP_API_VERSION ?? VERSAO_PADRAO;
  const resposta = await fetch(`https://graph.facebook.com/${versao}/${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  return ((await resposta.json().catch(() => ({}))) ?? {}) as RespostaDaMeta<T>;
}

/**
 * Testa a conexão contra a Meta e a deixa pronta.
 *
 * Dois passos, e a ordem importa: primeiro o telefone (é onde o ID trocado
 * aparece), depois a inscrição da conta no app. A inscrição é idempotente
 * — repetir não faz mal, e é justamente o "de novo" que salva quando
 * alguém trocou a conta.
 */
export async function testarConexao(c: ConexaoOficial): Promise<ResultadoDoTeste> {
  const falta = faltaOQue(c);
  if (falta.length > 0) {
    throw new ErroDaConexao(400, `Antes de testar, preencha ${falta.join(", ")}.`);
  }

  const telefone = await graph<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
    `${c.phone_number_id}?fields=display_phone_number,verified_name,quality_rating`,
    c.token!,
  );
  if (telefone.error || !telefone.display_phone_number) {
    throw new ErroDaConexao(400, explicarErroDaMeta(telefone.error, "telefone"));
  }

  const inscricao = await graph<{ success?: boolean }>(`${c.waba_id}/subscribed_apps`, c.token!, "POST");
  if (inscricao.error || inscricao.success !== true) {
    throw new ErroDaConexao(400, explicarErroDaMeta(inscricao.error, "conta"));
  }

  return {
    telefone: telefone.display_phone_number,
    nome_verificado: telefone.verified_name ?? null,
    qualidade: telefone.quality_rating ?? null,
    inscrita: true,
  };
}

/** Testa e grava o resultado: é o botão "Testar e ativar". */
export async function testarESalvar(venue: { id: string; slug: string }): Promise<ResultadoDoTeste & { conexao: ConexaoOficial }> {
  const atual = await conexaoDaCasa(venue);
  const r = await testarConexao(atual);
  const agora = new Date().toISOString();
  const pronta: ConexaoOficial = {
    ...atual,
    telefone: r.telefone,
    nome_verificado: r.nome_verificado,
    inscrita_em: agora,
    testada_em: agora,
  };
  const { error } = await cliente()
    .from("whatsapp_oficial")
    .upsert(
      {
        venue_id: venue.id,
        token: pronta.token,
        phone_number_id: pronta.phone_number_id,
        waba_id: pronta.waba_id,
        agent_slug: pronta.agent_slug,
        telefone: pronta.telefone,
        nome_verificado: pronta.nome_verificado,
        inscrita_em: pronta.inscrita_em,
        testada_em: pronta.testada_em,
        updated_at: agora,
      },
      { onConflict: "venue_id" },
    );
  if (error && !ehMigracaoPendente(error.message)) {
    throw new ErroDaConexao(500, `A Meta respondeu bem, mas não consegui gravar: ${error.message}`);
  }
  return { ...r, conexao: pronta };
}

// ============================================================
// Os modelos aprovados da conta
// ============================================================

export interface ModeloDaMeta {
  name: string;
  idioma: string;
  categoria: string;
  status: string;
  corpo: string;
  cabecalho: string | null;
  rodape: string | null;
  botoes: string[];
  /** Quantas lacunas o corpo tem ({{1}}, {{2}}…). */
  lacunas: number;
  /**
   * Dá para mandar daqui? Modelo com lacuna no cabeçalho, ou com cabeçalho
   * de imagem/vídeo, precisa de parâmetro que ainda não montamos.
   */
  suportado: boolean;
  motivo: string | null;
}

interface ComponenteDaMeta {
  type?: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type?: string; text?: string }>;
}

/** O modelo como a Meta devolve, no nosso vocabulário. Puro, testável. */
export function resumirModelo(bruto: {
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  components?: ComponenteDaMeta[];
}): ModeloDaMeta {
  const comps = bruto.components ?? [];
  const corpo = comps.find((c) => c.type === "BODY")?.text ?? "";
  const cab = comps.find((c) => c.type === "HEADER");
  const rodape = comps.find((c) => c.type === "FOOTER")?.text ?? null;
  const botoes = (comps.find((c) => c.type === "BUTTONS")?.buttons ?? []).map((b) => b.text ?? "").filter(Boolean);

  let lacunas = 0;
  for (const m of corpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) lacunas = Math.max(lacunas, Number(m[1]));

  let motivo: string | null = null;
  const FORMATO: Record<string, string> = { IMAGE: "imagem", VIDEO: "vídeo", DOCUMENT: "documento", LOCATION: "localização" };
  if (cab && cab.format && cab.format !== "TEXT") {
    motivo = `cabeçalho de ${FORMATO[cab.format] ?? cab.format.toLowerCase()} ainda não é suportado`;
  }
  else if (cab?.text && /\{\{/.test(cab.text)) motivo = "lacuna no cabeçalho ainda não é suportada";
  else if (bruto.status !== "APPROVED") motivo = "a Meta ainda não aprovou este modelo";

  return {
    name: bruto.name ?? "",
    idioma: bruto.language ?? "pt_BR",
    categoria: bruto.category ?? "",
    status: bruto.status ?? "",
    corpo,
    cabecalho: cab?.text ?? null,
    rodape,
    botoes,
    lacunas,
    suportado: motivo === null,
    motivo,
  };
}

// Um minuto de cache por conta: a tela pede a lista a cada abertura, e a
// Meta não precisa saber disso.
const modelosEmCache = new Map<string, { ate: number; lista: ModeloDaMeta[] }>();

export async function modelosDaConta(c: ConexaoOficial, opcoes: { semCache?: boolean } = {}): Promise<ModeloDaMeta[]> {
  if (!c.token || !c.waba_id) {
    throw new ErroDaConexao(400, "Conecte o WhatsApp oficial (token e ID da conta) para ver os modelos.");
  }
  const chave = c.waba_id;
  const guardado = modelosEmCache.get(chave);
  if (!opcoes.semCache && guardado && guardado.ate > Date.now()) return guardado.lista;

  const r = await graph<{ data?: Array<Parameters<typeof resumirModelo>[0]> }>(
    `${c.waba_id}/message_templates?fields=name,language,category,status,components&limit=200`,
    c.token,
  );
  if (r.error) throw new ErroDaConexao(400, explicarErroDaMeta(r.error, "conta"));

  const lista = (r.data ?? []).map(resumirModelo).sort((a, b) => a.name.localeCompare(b.name));
  modelosEmCache.set(chave, { ate: Date.now() + 60_000, lista });
  return lista;
}
