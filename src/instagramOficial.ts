import { createHmac, timingSafeEqual } from "node:crypto";
import { db, ehMigracaoPendente } from "./supabase.js";

/**
 * O INSTAGRAM DA CASA, CONECTADO POR LOGIN.
 *
 * Nada de token colado nem de ID copiado de tela em tela: o dono clica em
 * "Conectar Instagram", entra com a conta do bar, autoriza, e volta para o
 * painel conectado. É o "Login do Instagram" da Meta (API do Instagram com
 * login do Instagram): a conta profissional autoriza o NOSSO app a ler e
 * responder os DMs dela, sem precisar estar em Business Manager nenhum.
 *
 * O que fica guardado é o token de longa duração (60 dias), que o relógio
 * renova toda semana — a Meta deixa renovar qualquer token com mais de um
 * dia e menos de 60. Quem esquece de renovar descobre quando o agente para
 * de responder, dois meses depois.
 *
 * AS VARIÁVEIS DE AMBIENTE CONTINUAM VALENDO como conexão da casa que elas
 * nomeiam (`INSTAGRAM_VENUE`), enquanto a linha dela não existe no banco.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

const VERSAO_PADRAO = "v23.0";
const GRAPH = "https://graph.instagram.com";
/** As permissões que o login pede: ler a conta, responder os DMs e os comentários. */
export const PERMISSOES = ["instagram_business_basic", "instagram_business_manage_messages", "instagram_business_manage_comments"];
/** Renova quando faltam menos que isto para vencer. */
export const DIAS_PARA_RENOVAR = 30;
/** O `state` do login vale isto; depois é só um link velho. */
const MINUTOS_DO_STATE = 15;

export class ErroDoInstagram extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDoInstagram";
  }
}

export interface ConexaoInstagram {
  venue_id: string;
  ig_user_id: string;
  usuario: string | null;
  nome: string | null;
  token: string;
  expira_em: string | null;
  renovado_em: string | null;
  agent_slug: string | null;
  /** O que fazer com comentários nos posts: desligado | privado | publico_e_privado. */
  comentarios: string;
  /** A frase fixa que vai no post quando o modo é publico_e_privado. Vazio = padrão. */
  comentarios_aviso: string | null;
  /** Elogio e emoji ganham uma resposta curta e pública. É o "curtir" que a API não dá. */
  comentarios_agradecer: boolean;
  conectado_em: string | null;
}

/** O que o app precisa ter nas variáveis de ambiente para o login existir. */
export function appDoInstagram(): { appId: string | null; appSecret: string | null; versao: string } {
  return {
    appId: process.env.INSTAGRAM_APP_ID || null,
    appSecret: process.env.INSTAGRAM_APP_SECRET || null,
    versao: process.env.INSTAGRAM_API_VERSION ?? VERSAO_PADRAO,
  };
}

/** O login está disponível neste sistema? Sem o app, o botão nem aparece. */
export function loginDisponivel(): boolean {
  const app = appDoInstagram();
  return Boolean(app.appId && app.appSecret);
}

// ============================================================
// As regras — puras, testáveis sem banco nem Meta
// ============================================================

/** A conexão como a tela vê: tudo, menos o token. */
export function paraOPainel(c: ConexaoInstagram | null): Record<string, unknown> {
  if (!c) return { conectado: false, login_disponivel: loginDisponivel() };
  return {
    conectado: true,
    login_disponivel: loginDisponivel(),
    ig_user_id: c.ig_user_id,
    usuario: c.usuario,
    nome: c.nome,
    agent_slug: c.agent_slug,
    comentarios: c.comentarios,
    comentarios_aviso: c.comentarios_aviso,
    comentarios_agradecer: c.comentarios_agradecer,
    expira_em: c.expira_em,
    renovado_em: c.renovado_em,
    conectado_em: c.conectado_em,
    precisa_renovar: precisaRenovar(c),
    vencido: Boolean(c.expira_em && new Date(c.expira_em).getTime() < Date.now()),
  };
}

/** Faltam menos de 30 dias para o token vencer? Puro. */
export function precisaRenovar(c: Pick<ConexaoInstagram, "expira_em">, agora = new Date()): boolean {
  if (!c.expira_em) return true;
  return new Date(c.expira_em).getTime() - agora.getTime() < DIAS_PARA_RENOVAR * 86_400_000;
}

/**
 * O `state` do login: a casa, assinada, com hora.
 *
 * O Instagram devolve a pessoa para o nosso callback com este valor de
 * volta. É por ele que o callback sabe PARA QUAL CASA guardar o token — e a
 * assinatura é o que impede alguém de forjar um callback que conecte a
 * conta dele à casa de outro. Quinze minutos: um login não demora mais.
 */
export function assinarState(venueSlug: string, segredo: string, agora = new Date()): string {
  const corpo = `${venueSlug}|${agora.getTime()}`;
  const assinatura = createHmac("sha256", segredo).update(corpo).digest("base64url");
  return `${Buffer.from(corpo).toString("base64url")}.${assinatura}`;
}

export function lerState(state: string | null | undefined, segredo: string, agora = new Date()): string | null {
  if (!state) return null;
  const [corpoB64, assinatura] = state.split(".");
  if (!corpoB64 || !assinatura) return null;
  const corpo = Buffer.from(corpoB64, "base64url").toString("utf8");
  const esperada = createHmac("sha256", segredo).update(corpo).digest("base64url");
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [slug, quando] = corpo.split("|");
  if (!slug || !quando) return null;
  if (agora.getTime() - Number(quando) > MINUTOS_DO_STATE * 60_000) return null;
  return slug;
}

/** A URL para onde o botão "Conectar Instagram" manda a pessoa. */
export function urlDeLogin(params: { appId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: params.appId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: PERMISSOES.join(","),
    state: params.state,
    // Sempre pede a conta de novo: o dono pode estar logado no Instagram
    // pessoal, e é a conta do BAR que tem de autorizar.
    force_reauth: "true",
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

/** Os erros da Meta em português de gente. */
export function explicarErro(erro: { code?: number; message?: string; error_subcode?: number } | null | undefined): string {
  const code = erro?.code;
  const msg = erro?.message ?? "";
  if (code === 190) return "A autorização do Instagram venceu ou foi revogada. Conecte de novo.";
  if (code === 10 || code === 200 || /permission|not authorized/i.test(msg)) {
    return "A conta não deu as permissões de mensagens. Conecte de novo e aceite tudo o que o Instagram pedir.";
  }
  return msg ? `O Instagram respondeu: ${msg}` : "O Instagram não respondeu como esperado.";
}

// ============================================================
// As variáveis de ambiente como conexão da casa que elas nomeiam
// ============================================================

function daVariaveisDeAmbiente(): (ConexaoInstagram & { venue_slug: string }) | null {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const venueSlug = process.env.INSTAGRAM_VENUE;
  if (!token || !venueSlug) return null;
  return {
    venue_id: "",
    venue_slug: venueSlug,
    ig_user_id: process.env.INSTAGRAM_USER_ID ?? "",
    usuario: null,
    nome: null,
    token,
    expira_em: null,
    renovado_em: null,
    agent_slug: process.env.INSTAGRAM_AGENT || null,
    comentarios: "desligado",
    comentarios_aviso: null,
    comentarios_agradecer: false,
    conectado_em: null,
  };
}

// ============================================================
// Banco
// ============================================================

function daLinha(linha: Record<string, unknown>): ConexaoInstagram {
  return {
    venue_id: String(linha.venue_id),
    ig_user_id: String(linha.ig_user_id ?? ""),
    usuario: (linha.usuario as string | null) ?? null,
    nome: (linha.nome as string | null) ?? null,
    token: String(linha.token ?? ""),
    expira_em: (linha.expira_em as string | null) ?? null,
    renovado_em: (linha.renovado_em as string | null) ?? null,
    agent_slug: (linha.agent_slug as string | null) ?? null,
    comentarios: (linha.comentarios as string | null) ?? "privado",
    comentarios_aviso: (linha.comentarios_aviso as string | null) ?? null,
    comentarios_agradecer: linha.comentarios_agradecer !== false,
    conectado_em: (linha.conectado_em as string | null) ?? null,
  };
}

/** A conexão da casa: a do banco, ou a das variáveis se nomeiam esta casa, ou nada. */
export async function conexaoDaCasa(venue: { id: string; slug?: string }): Promise<ConexaoInstagram | null> {
  const { data, error } = await cliente().from("instagram_oficial").select("*").eq("venue_id", venue.id).maybeSingle();
  if (error && !ehMigracaoPendente(error.message)) {
    throw new ErroDoInstagram(500, `Falha ao ler a conexão do Instagram: ${error.message}`);
  }
  if (data) return daLinha(data);

  const doAmbiente = daVariaveisDeAmbiente();
  if (doAmbiente) {
    const slug = venue.slug ?? (await slugDaCasa(venue.id));
    if (slug === doAmbiente.venue_slug) return { ...doAmbiente, venue_id: venue.id };
  }
  return null;
}

async function slugDaCasa(venueId: string): Promise<string | null> {
  const { data } = await cliente().from("venues").select("slug").eq("id", venueId).maybeSingle();
  return (data?.slug as string | undefined) ?? null;
}

/**
 * De quem é esta conta? É a pergunta do webhook.
 *
 * `entry.id` é o id da conta profissional que recebeu o DM. Devolve a
 * conexão E o slug da casa, porque é o slug que o agente usa. Sem linha no
 * banco, vale a das variáveis de ambiente — para qualquer conta, porque
 * elas nunca souberam o id da própria conta.
 */
export async function conexaoPelaConta(igUserId: string | null | undefined): Promise<(ConexaoInstagram & { venue_slug: string }) | null> {
  if (igUserId) {
    const { data, error } = await cliente()
      .from("instagram_oficial")
      .select("*, venues!inner(slug)")
      .eq("ig_user_id", igUserId)
      .maybeSingle();
    if (error && !ehMigracaoPendente(error.message)) {
      console.error(`[instagram] não li a conexão da conta ${igUserId}: ${error.message}`);
    }
    if (data) {
      const venues = data.venues as { slug: string } | { slug: string }[] | null;
      const slug = Array.isArray(venues) ? venues[0]?.slug : venues?.slug;
      if (slug) return { ...daLinha(data), venue_slug: slug };
    }
  }
  const doAmbiente = daVariaveisDeAmbiente();
  if (doAmbiente && (!doAmbiente.ig_user_id || !igUserId || doAmbiente.ig_user_id === igUserId)) return doAmbiente;
  return null;
}

async function gravar(linha: Record<string, unknown>): Promise<void> {
  const { error } = await cliente()
    .from("instagram_oficial")
    .upsert({ ...linha, updated_at: new Date().toISOString() }, { onConflict: "venue_id" });
  if (error) {
    if (ehMigracaoPendente(error.message)) {
      throw new ErroDoInstagram(503, "O banco ainda não tem a tabela do Instagram. Aplique a migração e tente de novo.");
    }
    if (String(error.code) === "23505") {
      throw new ErroDoInstagram(409, "Esta conta do Instagram já está conectada em outra casa.");
    }
    throw new ErroDoInstagram(500, `Falha ao salvar a conexão do Instagram: ${error.message}`);
  }
}

export interface AjustesDoInstagram {
  agent_slug?: string | null;
  comentarios?: string;
  comentarios_aviso?: string | null;
  comentarios_agradecer?: boolean;
}

/** O que a casa escolhe depois de conectar: quem responde e o que fazer com comentários. */
export async function salvarAjustes(venueId: string, ajustes: AjustesDoInstagram): Promise<ConexaoInstagram> {
  const atual = await conexaoDaCasa({ id: venueId });
  if (!atual || !atual.venue_id) throw new ErroDoInstagram(400, "Conecte o Instagram antes de ajustar quem responde.");
  const proxima: ConexaoInstagram = {
    ...atual,
    agent_slug: ajustes.agent_slug === undefined ? atual.agent_slug : ajustes.agent_slug?.trim() || null,
    comentarios: ajustes.comentarios ?? atual.comentarios,
    comentarios_aviso: ajustes.comentarios_aviso === undefined ? atual.comentarios_aviso : ajustes.comentarios_aviso?.trim() || null,
    comentarios_agradecer: ajustes.comentarios_agradecer ?? atual.comentarios_agradecer,
  };
  await gravar({
    venue_id: venueId,
    ig_user_id: atual.ig_user_id,
    token: atual.token,
    agent_slug: proxima.agent_slug,
    comentarios: proxima.comentarios,
    comentarios_aviso: proxima.comentarios_aviso,
    comentarios_agradecer: proxima.comentarios_agradecer,
  });
  return proxima;
}

export async function apagarConexao(venueId: string): Promise<void> {
  const { error } = await cliente().from("instagram_oficial").delete().eq("venue_id", venueId);
  if (error && !ehMigracaoPendente(error.message)) {
    throw new ErroDoInstagram(500, `Falha ao desconectar o Instagram: ${error.message}`);
  }
}

// ============================================================
// A Meta: trocar o código por token, ler a conta, inscrever, renovar
// ============================================================

type RespostaDaMeta<T> = T & { error?: { code?: number; message?: string; error_subcode?: number; error_message?: string } };

async function graph<T>(url: string, init?: RequestInit): Promise<RespostaDaMeta<T>> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const dados = (await r.json().catch(() => null)) as RespostaDaMeta<T> | null;
    if (!dados) return { error: { message: `HTTP ${r.status} sem corpo` } } as RespostaDaMeta<T>;
    return dados;
  } catch (e) {
    return { error: { message: (e as Error).message } } as RespostaDaMeta<T>;
  }
}

/**
 * O que acontece quando a pessoa volta do login com o `code`.
 *
 * Três idas à Meta: o código vira token curto (1 h), o curto vira longo
 * (60 dias), e o longo pergunta quem é a conta. Depois a conta é inscrita
 * no app para os DMs chegarem pelo webhook — o passo que ninguém sabe que
 * existe até faltar, igual ao do WhatsApp.
 */
export async function concluirLogin(params: {
  venue: { id: string; slug: string };
  code: string;
  redirectUri: string;
  agora?: Date;
}): Promise<ConexaoInstagram> {
  const app = appDoInstagram();
  if (!app.appId || !app.appSecret) throw new ErroDoInstagram(503, "O login do Instagram não está configurado neste sistema.");
  const agora = params.agora ?? new Date();

  type TokenCurto = { access_token?: string; user_id?: string | number; permissions?: string };
  const curto = await graph<TokenCurto & { data?: TokenCurto[] }>("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.appId,
      client_secret: app.appSecret,
      grant_type: "authorization_code",
      redirect_uri: params.redirectUri,
      code: params.code,
    }),
  });
  // O login da empresa devolve o token embrulhado em `data[0]`; o antigo,
  // solto. Os dois existem na documentação da Meta, e o que chega depende
  // de como o app foi montado.
  const primeiro = curto.data?.[0] ?? curto;
  const tokenCurto = primeiro.access_token;
  if (curto.error || !tokenCurto) {
    console.error(`[instagram] a troca do código falhou; a Meta devolveu as chaves ${Object.keys(curto).join(",")}`);
    throw new ErroDoInstagram(400, `Não deu para concluir o login: ${curto.error?.error_message ?? explicarErro(curto.error)}`);
  }
  // O id do app não é segredo; o prefixo do token diz de que família ele é.
  console.log(`[instagram] código trocado pelo app ${app.appId} (chaves: ${Object.keys(curto).join(",")}; user_id: ${primeiro.user_id ?? "?"}; permissões: ${primeiro.permissions ?? "?"}; token ${tokenCurto.slice(0, 4)}…, ${tokenCurto.length} caracteres)`);

  // O curto vira longo (60 dias). A Meta documenta o endereço sem versão;
  // na dúvida, a versão também é tentada — custa um pedido e evita que um
  // detalhe de roteamento deles deixe a casa sem conexão.
  type TokenLongo = { access_token?: string; expires_in?: number };
  const troca = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: app.appSecret, access_token: tokenCurto });
  const comClientId = new URLSearchParams({ ...Object.fromEntries(troca), client_id: app.appId });
  // As variantes que a Meta já aceitou em alguma versão da plataforma. A
  // documentada é a primeira; as outras existem porque a Meta respondeu
  // "Unsupported request" à documentada, e um pedido a mais custa menos
  // que uma casa sem Instagram.
  const tentativas: Array<[string, () => Promise<RespostaDaMeta<TokenLongo>>]> = [
    ["GET /access_token", () => graph<TokenLongo>(`${GRAPH}/access_token?${troca}`)],
    ["GET /access_token + client_id", () => graph<TokenLongo>(`${GRAPH}/access_token?${comClientId}`)],
    [`GET /${app.versao}/access_token`, () => graph<TokenLongo>(`${GRAPH}/${app.versao}/access_token?${troca}`)],
    ["POST /access_token", () => graph<TokenLongo>(`${GRAPH}/access_token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: troca })],
    ["GET /oauth/access_token", () => graph<TokenLongo>(`${GRAPH}/oauth/access_token?${comClientId}`)],
  ];
  let longo: RespostaDaMeta<TokenLongo> = { error: { message: "nenhuma tentativa" } } as RespostaDaMeta<TokenLongo>;
  for (const [nome, tentar] of tentativas) {
    longo = await tentar();
    if (!longo.error && longo.access_token) {
      console.log(`[instagram] token longo obtido por ${nome}`);
      break;
    }
    console.error(`[instagram] troca pelo token longo (${nome}) falhou: ${JSON.stringify(longo.error ?? longo)}`);
  }

  let token: string;
  let expiraEm: string;
  if (!longo.error && longo.access_token) {
    token = longo.access_token;
    expiraEm = new Date(agora.getTime() + (longo.expires_in ?? 60 * 86_400) * 1000).toISOString();
  } else {
    // A Meta recusou a troca de todos os jeitos. Antes de desistir: o token
    // curto serve em graph.instagram.com? Se serve, a conta fica conectada
    // por uma hora — o bastante para testar os DMs hoje e para o log dizer
    // de que lado está o problema. Se nem o /me responde, o token não é
    // desta API, e a mensagem diz isso.
    type Eu = { user_id?: string | number; id?: string; username?: string };
    let prova = await graph<Eu>(`${GRAPH}/${app.versao}/me?${new URLSearchParams({ fields: "user_id,username", access_token: tokenCurto })}`);
    console.error(`[instagram] prova do token curto em graph.instagram.com/me (token na URL): ${JSON.stringify(prova)}`);
    if (prova.error) {
      // O mesmo, com o token no cabeçalho — é como o canal responde os DMs.
      prova = await graph<Eu>(`${GRAPH}/${app.versao}/me?fields=user_id,username`, { headers: { authorization: `Bearer ${tokenCurto}` } });
      console.error(`[instagram] prova do token curto em graph.instagram.com/me (token no cabeçalho): ${JSON.stringify(prova)}`);
    }
    if (prova.error) {
      throw new ErroDoInstagram(
        400,
        `Não deu para guardar a autorização: ${explicarErro(longo.error)} ` +
          `O token que o Instagram deu não é aceito pela API de mensagens (${explicarErro(prova.error)}). ` +
          `No app da Meta, confira se o produto é "API do Instagram com login do Instagram" e se a conta foi adicionada em "Gerar tokens de acesso".`,
      );
    }
    console.warn(`[instagram] ficando com o token curto (1 h) de @${prova.username ?? "?"}; a troca pelo longo precisa ser resolvida.`);
    token = tokenCurto;
    expiraEm = new Date(agora.getTime() + 3_600_000).toISOString();
  }

  const eu = await graph<{ user_id?: string | number; id?: string; username?: string; name?: string }>(
    `${GRAPH}/${app.versao}/me?${new URLSearchParams({ fields: "user_id,username,name", access_token: token })}`,
  );
  if (eu.error) throw new ErroDoInstagram(400, `Não deu para ler a conta: ${explicarErro(eu.error)}`);
  const igUserId = String(eu.user_id ?? eu.id ?? primeiro.user_id ?? "");
  if (!igUserId) throw new ErroDoInstagram(400, "O Instagram não disse qual conta é esta.");

  // Inscreve a conta no app: é o que faz os DMs chegarem pelo webhook.
  const inscricao = await graph<{ success?: boolean }>(
    `${GRAPH}/${app.versao}/${igUserId}/subscribed_apps?${new URLSearchParams({ subscribed_fields: "messages,comments", access_token: token })}`,
    { method: "POST" },
  );
  if (inscricao.error) {
    console.error(`[instagram] a conta ${igUserId} não foi inscrita no app: ${explicarErro(inscricao.error)}`);
  }

  // Mantém o agente de uma conexão anterior da mesma casa: reconectar não
  // pode "desligar" quem atende.
  const anterior = await conexaoDaCasa(params.venue).catch(() => null);
  const conexao: ConexaoInstagram = {
    venue_id: params.venue.id,
    ig_user_id: igUserId,
    usuario: eu.username ?? null,
    nome: eu.name ?? null,
    token,
    expira_em: expiraEm,
    renovado_em: null,
    agent_slug: anterior?.venue_id ? anterior.agent_slug : null,
    comentarios: anterior?.venue_id ? anterior.comentarios : "privado",
    comentarios_aviso: anterior?.venue_id ? anterior.comentarios_aviso : null,
    comentarios_agradecer: anterior?.venue_id ? anterior.comentarios_agradecer : true,
    conectado_em: agora.toISOString(),
  };
  await gravar({
    venue_id: conexao.venue_id,
    ig_user_id: conexao.ig_user_id,
    usuario: conexao.usuario,
    nome: conexao.nome,
    token: conexao.token,
    expira_em: conexao.expira_em,
    renovado_em: null,
    agent_slug: conexao.agent_slug,
    comentarios: conexao.comentarios,
    comentarios_aviso: conexao.comentarios_aviso,
    comentarios_agradecer: conexao.comentarios_agradecer,
    conectado_em: conexao.conectado_em,
  });
  return conexao;
}

/**
 * Renova os tokens que estão para vencer. Para o relógio, de hora em hora:
 * de hora em hora porque é barato, e porque um token vencido é um agente
 * mudo sem ninguém saber.
 */
export async function renovarTokens(agora = new Date()): Promise<{ renovados: number; falharam: number }> {
  const total = { renovados: 0, falharam: 0 };
  const app = appDoInstagram();
  const { data, error } = await cliente().from("instagram_oficial").select("*");
  if (error) {
    if (!ehMigracaoPendente(error.message)) console.error(`[instagram] não li as conexões para renovar: ${error.message}`);
    return total;
  }
  for (const linha of (data ?? []) as Record<string, unknown>[]) {
    const c = daLinha(linha);
    if (!precisaRenovar(c, agora)) continue;
    // A Meta só renova token com mais de um dia; um recém-conectado espera.
    const nasceu = c.renovado_em ?? c.conectado_em;
    if (nasceu && agora.getTime() - new Date(nasceu).getTime() < 86_400_000) continue;

    const r = await graph<{ access_token?: string; expires_in?: number }>(
      `${GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: c.token })}`,
    );
    if (r.error || !r.access_token) {
      total.falharam += 1;
      console.error(`[instagram] não renovei o token de @${c.usuario ?? c.ig_user_id}: ${explicarErro(r.error)}`);
      continue;
    }
    await gravar({
      venue_id: c.venue_id,
      ig_user_id: c.ig_user_id,
      token: r.access_token,
      expira_em: new Date(agora.getTime() + (r.expires_in ?? 60 * 86_400) * 1000).toISOString(),
      renovado_em: agora.toISOString(),
    }).catch((e) => console.error(`[instagram] renovei mas não gravei o token de ${c.venue_id}: ${(e as Error).message}`));
    total.renovados += 1;
  }
  if (total.renovados || total.falharam) console.log(`[instagram] tokens: ${total.renovados} renovado(s), ${total.falharam} falha(s).`);
  return total;
}
