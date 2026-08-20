/**
 * Autenticação por e-mail e senha, em cima do Supabase Auth.
 *
 * O login não acontece no navegador: o painel manda e-mail e senha para a
 * nossa API, e é o servidor que fala com o Supabase. Assim o front continua
 * sem nenhuma dependência nem chave do Supabase — o que combina com um painel
 * de JS puro, sem build, e evita ter que explicar a um dono de restaurante
 * por que existe uma "chave anônima" no código da página dele.
 *
 * O que o navegador guarda é o par de tokens do Supabase: o de acesso (curto,
 * ~1h) e o de renovação. Quando o primeiro expira, o painel troca o segundo
 * por um novo par, sem pedir a senha de novo.
 *
 * A chave `sk_...` continua valendo em paralelo. Ela é o acesso de máquina
 * (conector do WhatsApp, integrações) e não deve morrer junto com a migração
 * das pessoas para e-mail e senha — são coisas diferentes que só por
 * comodidade dividiam o mesmo campo.
 */

import { db, dbAuth } from "./supabase.js";

export interface Sessao {
  userId: string;
  email: string | null;
  orgId: string;
  papel: string;
  /**
   * Módulos que esta pessoa pode abrir, ou null para "todos os que a casa
   * contratou".
   *
   * Separado do papel de propósito: são perguntas diferentes. O papel diz O
   * QUE a pessoa pode fazer (ler, escrever, administrar); esta lista diz
   * ONDE. Um conferente de doca escreve, mas só no CMV.
   */
  modulos: string[] | null;
  /** Administrador da plataforma enxerga e cria todas as organizações. */
  plataformaAdmin: boolean;
  /**
   * A senha atual foi gerada pelo sistema e ditada para a pessoa.
   *
   * Senha que alguém ditou por telefone é senha que alguém sabe. Enquanto
   * esta marca existir, o painel exige a troca antes de abrir qualquer tela
   * — e é a troca que a apaga.
   */
  senhaProvisoria: boolean;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expira_em: number;
}

/** Erro de autenticação com mensagem já pronta para o usuário final. */
export class ErroDeAcesso extends Error {
  readonly status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.name = "ErroDeAcesso";
    this.status = status;
  }
}

// Verificar o token custa uma chamada ao Supabase. Uma tela do painel dispara
// várias requisições em sequência, então uma memória curta evita repetir a
// mesma verificação meia dúzia de vezes por clique.
const memoria = new Map<string, { quando: number; sessao: Sessao }>();
const VALIDADE_MS = 60_000;

export function esquecerSessao(token: string): void {
  memoria.delete(token);
}

export async function entrar(email: string, senha: string): Promise<Tokens> {
  const { data, error } = await dbAuth().auth.signInWithPassword({ email, password: senha });
  if (error || !data.session) {
    // Mensagem única para e-mail inexistente e senha errada: dizer qual dos
    // dois falhou entrega a quem tenta invadir a lista de quem é cliente.
    throw new ErroDeAcesso(401, "E-mail ou senha incorretos.");
  }
  return formatarTokens(data.session);
}

export async function renovar(refreshToken: string): Promise<Tokens> {
  const { data, error } = await dbAuth().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    throw new ErroDeAcesso(401, "Sua sessão expirou. Entre de novo.");
  }
  return formatarTokens(data.session);
}

export async function pedirTrocaDeSenha(email: string, redirectTo: string): Promise<void> {
  // Nunca revela se o e-mail existe: a resposta é sempre a mesma, e o erro
  // (se houver) fica só no log do servidor.
  const { error } = await dbAuth().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) console.warn(`[auth] recuperação de senha falhou para um e-mail:`, error.message);
}

function formatarTokens(sessao: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}): Tokens {
  return {
    access_token: sessao.access_token,
    refresh_token: sessao.refresh_token,
    expira_em: sessao.expires_in ?? 3600,
  };
}

/**
 * Resolve o token de acesso na sessão da pessoa: quem é, de qual organização
 * e com qual papel.
 */
export async function sessaoDoToken(token: string): Promise<Sessao> {
  const guardado = memoria.get(token);
  if (guardado && Date.now() - guardado.quando < VALIDADE_MS) return guardado.sessao;

  const { data, error } = await dbAuth().auth.getUser(token);
  if (error || !data.user) throw new ErroDeAcesso(401, "Sessão inválida ou expirada.");

  const userId = data.user.id;

  const [vinculo, admin] = await Promise.all([
    db()
      .from("org_members")
      // `modulos` é a restrição de acesso por módulo. Sem ela na seleção, a
      // sessão nasceria sempre sem restrição e a trava não valeria nada.
      .select("org_id, role, modulos")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db().from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);

  // Consulta que FALHOU e consulta que não achou nada devolvem ambas `data:
  // null`. Tratar as duas igual manda o usuário caçar um vínculo que existe,
  // enquanto o problema real (tabela fora do cache do PostgREST, permissão,
  // rede) fica invisível. Por isso o erro é lido antes.
  const falhas = [vinculo.error, admin.error].filter(Boolean);
  if (falhas.length > 0) {
    for (const f of falhas) console.error("[auth] consulta de vínculo falhou:", f?.message);
    throw new ErroDeAcesso(
      503,
      "Não consegui conferir seu acesso agora — o banco recusou a consulta. " +
        `Detalhe: ${falhas.map((f) => f?.message).join(" | ")}`,
    );
  }

  const plataformaAdmin = Boolean(admin.data);
  const membro = vinculo.data;

  if (!membro && !plataformaAdmin) {
    // Conta existe no Supabase Auth mas não pertence a nenhuma organização:
    // acontece se alguém for removido, ou se o cadastro parou no meio.
    //
    // O id vai junto porque o e-mail sozinho não basta para diagnosticar: dois
    // usuários podem ter e-mails parecidos, e é o id que a consulta usa. Sem
    // ele, comparar o que o servidor vê com o que o banco tem vira adivinhação.
    console.warn(`[auth] sem vínculo para ${data.user.email ?? "?"} (id ${userId})`);
    throw new ErroDeAcesso(
      403,
      `Sua conta (${data.user.email ?? "?"}) ainda não está vinculada a um estabelecimento. ` +
        `Id do usuário: ${userId}`,
    );
  }

  const sessao: Sessao = {
    userId,
    email: data.user.email ?? null,
    orgId: membro?.org_id ?? "",
    papel: membro?.role ?? "plataforma",
    // A coluna pode não existir num banco que ainda não recebeu a migração;
    // ausente vira null, que é "sem restrição" — o comportamento de antes.
    modulos: (membro as { modulos?: string[] | null } | null)?.modulos ?? null,
    plataformaAdmin,
    senhaProvisoria: data.user.user_metadata?.senha_provisoria === true,
  };

  memoria.set(token, { quando: Date.now(), sessao });
  await marcarPrimeiroAcesso(userId, membro?.org_id);
  return sessao;
}

/** Registra o primeiro login para a tela de clientes mostrar quem já entrou. */
async function marcarPrimeiroAcesso(userId: string, orgId?: string): Promise<void> {
  if (!orgId) return;
  await db()
    .from("org_members")
    .update({ primeiro_acesso_em: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .is("primeiro_acesso_em", null);
}

/** Papéis que podem alterar dados. `viewer` só lê. */
const PODEM_ESCREVER = new Set(["owner", "admin", "member", "plataforma"]);

export function podeEscrever(sessao: Sessao): boolean {
  return sessao.plataformaAdmin || PODEM_ESCREVER.has(sessao.papel);
}

/**
 * Esta sessão pode abrir este módulo?
 *
 * Só a metade da pergunta que depende da PESSOA. A outra metade — se o
 * estabelecimento contratou o módulo — vive em `modulos.ts` e é conferida
 * junto na rota. Separadas porque as mensagens de recusa são diferentes:
 * "sua casa não assina isso" manda falar com o comercial; "você não tem
 * acesso" manda falar com o dono.
 */
export function podeAbrirModulo(sessao: Sessao, modulo: string): boolean {
  if (sessao.plataformaAdmin) return true;
  // Null é "todos": mantém quem já usa o sistema sem mudança, e faz módulo
  // novo contratado aparecer sozinho para quem tem acesso amplo.
  if (sessao.modulos === null) return true;
  return sessao.modulos.includes(modulo);
}

/**
 * Define uma senha nova para quem está com um token válido em mãos.
 *
 * Serve aos dois caminhos: quem clicou no link de recuperação (o token vem
 * no endereço) e quem já está logado e quer trocar. Nos dois casos a prova
 * de identidade é o token — nunca a senha antiga, que quem esqueceu não tem.
 */
export async function trocarSenha(token: string, novaSenha: string): Promise<void> {
  if (novaSenha.length < 8) {
    throw new ErroDeAcesso(400, "A senha precisa ter pelo menos 8 caracteres.");
  }

  const cliente = dbAuth();
  const { data, error } = await cliente.auth.getUser(token);
  if (error || !data.user) {
    throw new ErroDeAcesso(401, "Este link de troca de senha expirou. Peça outro.");
  }

  // Repetir a senha que foi ditada não é trocar: continuaria valendo a que
  // outra pessoa falou em voz alta.
  if (/^(brasa|fogo|forno|grelha|carvao|chama|sabor|tempero)-\d{4}$/.test(novaSenha.trim())) {
    throw new ErroDeAcesso(400, "Essa é a senha provisória. Escolha uma senha sua.");
  }

  // A marca de provisória sai junto com a troca — é ela que faz o painel
  // exigir esta tela, e escolher a própria senha é exatamente o que a
  // resolve. Os outros metadados (nome) são preservados: `user_metadata`
  // substitui o objeto inteiro, não mescla.
  const metadados = { ...(data.user.user_metadata ?? {}) };
  delete metadados.senha_provisoria;

  // Pelo admin e não pelo updateUser da sessão: o cliente aqui é descartável
  // e não tem sessão nenhuma — só o token que acabou de ser conferido.
  const { error: erroTroca } = await cliente.auth.admin.updateUserById(data.user.id, {
    password: novaSenha,
    user_metadata: metadados,
  });
  if (erroTroca) throw new ErroDeAcesso(400, `Não deu para trocar a senha: ${erroTroca.message}`);

  // A sessão em memória guarda o papel, não a senha — mas sair do cache força
  // a próxima requisição a reler tudo, que é o que se espera depois de trocar.
  esquecerSessao(token);
}
