import { db, dbAuth } from "./supabase.js";

/**
 * Pessoas e acessos da casa.
 *
 * Até aqui só existia a conta do dono, criada junto com o cliente. Quem
 * quisesse dar acesso a um gerente não tinha por onde: a tela nunca foi
 * feita, e o resultado previsível é a senha do dono circulando pela equipe
 * inteira — que é como um sistema perde a rastreabilidade de quem fez o quê.
 *
 * Isto NÃO é um módulo. Toda casa tem gente, tenha comprado o que tiver
 * comprado, e por isso mora nos Ajustes da casa e não dentro de um produto.
 */

/** Papéis, do mais poderoso ao mais restrito. */
export const PAPEIS = [
  {
    id: "owner",
    nome: "Dono",
    descricao: "Tudo, inclusive criar e remover acessos.",
  },
  {
    id: "admin",
    nome: "Gerente",
    descricao: "Tudo no dia a dia; também cria acessos da equipe.",
  },
  {
    id: "member",
    nome: "Operação",
    descricao: "Usa os módulos liberados. Não mexe em acessos nem em cadastro da casa.",
  },
  {
    id: "viewer",
    nome: "Só leitura",
    descricao: "Vê os números, não altera nada.",
  },
] as const;

const IDS_DE_PAPEL = new Set(PAPEIS.map((p) => p.id));

/** Quem pode mexer em acessos. Operação e leitura não entram aqui. */
const PODEM_GERIR_EQUIPE = new Set(["owner", "admin"]);

export function podeGerirEquipe(papel: string, plataformaAdmin: boolean): boolean {
  return plataformaAdmin || PODEM_GERIR_EQUIPE.has(papel);
}

export interface PessoaDaCasa {
  userId: string;
  email: string;
  nome: string | null;
  papel: string;
  /** null = todos os módulos da casa; [] = nenhum. */
  modulos: string[] | null;
  ultimoAcesso: string | null;
  criadoEm: string | null;
}

export async function listarEquipe(orgId: string): Promise<PessoaDaCasa[]> {
  const { data, error } = await db()
    .from("org_members")
    .select("user_id, role, modulos, convidado_em")
    .eq("org_id", orgId);
  if (error) throw new Error(`Falha ao ler a equipe: ${error.message}`);

  // O e-mail e o último acesso vivem no auth, não em org_members: uma volta a
  // mais, mas evita duplicar dado de conta em duas tabelas — que é como se
  // criam dois e-mails diferentes para a mesma pessoa.
  const pessoas = await Promise.all(
    (data ?? []).map(async (m): Promise<PessoaDaCasa> => {
      const { data: conta } = await dbAuth().auth.admin.getUserById(m.user_id);
      const u = conta?.user;
      return {
        userId: m.user_id,
        email: u?.email ?? "—",
        nome: (u?.user_metadata?.nome as string | undefined) ?? null,
        papel: m.role ?? "member",
        modulos: (m as { modulos?: string[] | null }).modulos ?? null,
        ultimoAcesso: u?.last_sign_in_at ?? null,
        criadoEm: m.convidado_em ?? null,
      };
    }),
  );

  // Dono primeiro, depois por nome: a lista responde "quem manda aqui?" antes
  // de responder "quem trabalha aqui?".
  const ordem = ["owner", "admin", "member", "viewer"];
  return pessoas.sort(
    (a, b) =>
      ordem.indexOf(a.papel) - ordem.indexOf(b.papel) ||
      (a.nome ?? a.email).localeCompare(b.nome ?? b.email),
  );
}

/** Senha fácil de ditar por telefone — a pessoa troca no primeiro acesso. */
function senhaLegivel(): string {
  const palavras = ["brasa", "fogo", "forno", "grelha", "carvao", "chama", "sabor", "tempero"];
  const palavra = palavras[Math.floor(Math.random() * palavras.length)];
  const numero = String(Math.floor(Math.random() * 9000) + 1000);
  return `${palavra}-${numero}`;
}

export class ErroDeEquipe extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeEquipe";
  }
}

/**
 * Cria o acesso de alguém da equipe e devolve a senha inicial UMA VEZ.
 *
 * A senha aparece na tela para o dono ditar; ela não fica guardada em lugar
 * nenhum legível depois disso. Mandar por e-mail exigiria SMTP próprio (que
 * ainda não temos) e, num bar, ditar funciona melhor: o gerente está do lado.
 */
export async function criarPessoa(params: {
  orgId: string;
  email: string;
  nome: string;
  papel: string;
  modulos: string[] | null;
}): Promise<{ pessoa: PessoaDaCasa; senhaInicial: string }> {
  const email = params.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ErroDeEquipe(400, "Informe um e-mail válido — é com ele que a pessoa entra.");
  }
  if (!IDS_DE_PAPEL.has(params.papel as (typeof PAPEIS)[number]["id"])) {
    throw new ErroDeEquipe(400, "Escolha o que essa pessoa pode fazer.");
  }
  if (params.papel === "owner") {
    // Dono é quem contratou. Promover alguém a dono daria a ele o poder de
    // remover o próprio dono — o tipo de coisa que só se descobre tarde.
    throw new ErroDeEquipe(400, "Só existe um dono, definido na contratação. Use Gerente para dar acesso total.");
  }

  const senhaInicial = senhaLegivel();
  const { data: criado, error } = await dbAuth().auth.admin.createUser({
    email,
    password: senhaInicial,
    email_confirm: true,
    user_metadata: { nome: params.nome.trim() },
  });
  if (error || !criado.user) {
    throw new ErroDeEquipe(
      error?.message?.includes("already") ? 409 : 500,
      error?.message?.includes("already")
        ? `Já existe uma conta com o e-mail ${email}.`
        : `Não consegui criar o acesso: ${error?.message}`,
    );
  }

  const { error: erroMembro } = await db().from("org_members").insert({
    org_id: params.orgId,
    user_id: criado.user.id,
    role: params.papel,
    modulos: params.modulos,
    convidado_em: new Date().toISOString(),
  } as never);
  if (erroMembro) {
    // Conta órfã no auth é pior que nenhuma: o e-mail fica "em uso" e a
    // pessoa não entra em lugar nenhum.
    await dbAuth().auth.admin.deleteUser(criado.user.id);
    throw new ErroDeEquipe(500, `Não consegui vincular a pessoa à casa: ${erroMembro.message}`);
  }

  return {
    pessoa: {
      userId: criado.user.id,
      email,
      nome: params.nome.trim(),
      papel: params.papel,
      modulos: params.modulos,
      ultimoAcesso: null,
      criadoEm: new Date().toISOString(),
    },
    senhaInicial,
  };
}

export async function atualizarPessoa(params: {
  orgId: string;
  userId: string;
  papel?: string;
  modulos?: string[] | null;
}): Promise<void> {
  const atual = await db()
    .from("org_members")
    .select("role")
    .eq("org_id", params.orgId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (atual.error) throw new ErroDeEquipe(500, `Falha ao ler a pessoa: ${atual.error.message}`);
  if (!atual.data) throw new ErroDeEquipe(404, "Pessoa não encontrada nesta casa.");
  if (atual.data.role === "owner") {
    throw new ErroDeEquipe(400, "O acesso do dono não se altera por aqui.");
  }

  const mudancas: Record<string, unknown> = {};
  if (params.papel !== undefined) {
    if (!IDS_DE_PAPEL.has(params.papel as (typeof PAPEIS)[number]["id"]) || params.papel === "owner") {
      throw new ErroDeEquipe(400, "Papel inválido.");
    }
    mudancas.role = params.papel;
  }
  if (params.modulos !== undefined) mudancas.modulos = params.modulos;
  if (Object.keys(mudancas).length === 0) return;

  const { error } = await db()
    .from("org_members")
    .update(mudancas as never)
    .eq("org_id", params.orgId)
    .eq("user_id", params.userId);
  if (error) throw new ErroDeEquipe(500, `Falha ao salvar: ${error.message}`);
}

/**
 * Tira o acesso de alguém.
 *
 * Remove o vínculo com a casa e apaga a conta. Não há "desativar": conta que
 * fica meio viva é conta que volta a funcionar quando alguém mexe no papel
 * sem perceber — e ex-funcionário com acesso é problema de segurança, não de
 * histórico. O que a pessoa fez continua registrado nos movimentos, que
 * guardam o id.
 */
export async function removerPessoa(params: {
  orgId: string;
  userId: string;
  euMesmo: string | null;
}): Promise<void> {
  if (params.euMesmo && params.euMesmo === params.userId) {
    throw new ErroDeEquipe(400, "Você não pode remover o próprio acesso.");
  }

  const atual = await db()
    .from("org_members")
    .select("role")
    .eq("org_id", params.orgId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (atual.error) throw new ErroDeEquipe(500, `Falha ao ler a pessoa: ${atual.error.message}`);
  if (!atual.data) throw new ErroDeEquipe(404, "Pessoa não encontrada nesta casa.");
  if (atual.data.role === "owner") {
    throw new ErroDeEquipe(400, "O dono não pode ser removido — é a conta da contratação.");
  }

  const { error } = await db()
    .from("org_members")
    .delete()
    .eq("org_id", params.orgId)
    .eq("user_id", params.userId);
  if (error) throw new ErroDeEquipe(500, `Falha ao remover: ${error.message}`);

  await dbAuth().auth.admin.deleteUser(params.userId);
}

/** Gera uma senha nova e devolve para ditar. Usado quando alguém esquece. */
export async function redefinirSenha(params: {
  orgId: string;
  userId: string;
}): Promise<string> {
  const membro = await db()
    .from("org_members")
    .select("user_id")
    .eq("org_id", params.orgId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (membro.error) throw new ErroDeEquipe(500, `Falha ao ler a pessoa: ${membro.error.message}`);
  if (!membro.data) throw new ErroDeEquipe(404, "Pessoa não encontrada nesta casa.");

  const senha = senhaLegivel();
  const { error } = await dbAuth().auth.admin.updateUserById(params.userId, { password: senha });
  if (error) throw new ErroDeEquipe(500, `Falha ao trocar a senha: ${error.message}`);
  return senha;
}
