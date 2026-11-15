/**
 * Cadastro de cliente novo: de "fechei a venda" a "o agente está atendendo".
 *
 * Um cliente do Brasa Food não é uma linha numa tabela — são seis coisas que
 * precisam nascer juntas e coerentes: organização, estabelecimento, agente
 * com personalidade pronta, plano com pontos, dono com conta de acesso e
 * chave de máquina para o conector do WhatsApp. Criar isso na mão em SQL é
 * meia hora e erra fácil; a pior falha é o fuso horário errado, que só
 * aparece semanas depois numa reserva marcada na hora errada.
 *
 * NÃO HÁ TRANSAÇÃO. O PostgREST não expõe transação de várias tabelas, então
 * a criação avança por etapas e desfaz o que já criou se algo falhar no meio
 * (ver `desfazer`). É menos garantido que um BEGIN/COMMIT, mas evita o pior
 * caso na prática: um cliente meio-criado que ninguém sabe se existe.
 */

import { createApiKey } from "./apikeys.js";
import { esquecerEstado, extratoDePontos } from "./pontos.js";
import type { ModuloDoCliente } from "./modulos.js";
import { db, dbAuth } from "./supabase.js";
import { senhaLegivel } from "./senhaInicial.js";

export interface DadosDoCliente {
  /** Nome comercial: "Ditado Popular". Vira organização e estabelecimento. */
  nome: string;
  /** Identificador na URL. Gerado do nome quando não vier. */
  slug?: string;
  cidade?: string;
  /** Estado da casa. Com ele o fuso sai sozinho — é o jeito de não errar. */
  uf?: string;
  /** Só é preciso quando não vier a UF, ou para contrariar o fuso dela. */
  timezone?: string;
  /** O que a casa é. Decide os módulos que já nascem ligados e o jeito do atendente. */
  tipo?: TipoDeCasa;
  /** Os módulos contratados. Ausente = os do tipo de casa. */
  modulos?: string[];
  plano: "essencial" | "profissional" | "casa_cheia" | "cortesia";
  emailDono: string;
  telefone?: string;
  observacoes?: string;
}

export interface ClienteCriado {
  organizacao: { id: string; slug: string; nome: string };
  estabelecimento: { id: string; slug: string; nome: string; timezone: string };
  agente: { id: string; slug: string };
  /** Os módulos que nasceram ligados. */
  modulos: string[];
  /** Aparece UMA vez. Não é recuperável depois. */
  chave: string;
  /** Senha inicial do dono. Também aparece uma vez só. */
  senhaInicial: string;
  dono: { userId: string; email: string };
}

/** Pontos por plano — a tabela comercial vive aqui, num lugar só. */
const PONTOS_DO_PLANO: Record<DadosDoCliente["plano"], number> = {
  essencial: 1000,
  profissional: 2500,
  casa_cheia: 6000,
  cortesia: 500,
};

/** Preço de tabela, em reais. A mensalidade gravada tem precedência: desconto
 *  e negociação existem, e o painel precisa mostrar o combinado, não o
 *  catálogo. */
export const PRECO_DO_PLANO: Record<string, number> = {
  essencial: 147,
  profissional: 297,
  casa_cheia: 597,
  cortesia: 0,
};

export function gerarSlug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// ============================================================
// Os moldes: criar um cliente tem que ser escolher, não configurar
// ============================================================

/** Os módulos que se vendem — a mesma lista da tela de carteira. */
export const MODULOS_VENDAVEIS = [
  "agentes-ia", "cardapio-digital", "delivery", "checklist", "avaliacoes", "cmv", "pesquisa", "rh", "financeiro",
] as const;

export type TipoDeCasa = "bar" | "restaurante" | "delivery";

const REGRAS_DE_TODO_ATENDENTE = `- Não invente informação. Se não souber, diga que vai verificar com a equipe.
- Não fale de outros assuntos além do estabelecimento.`;

const REGRA_DA_RESERVA = `- NUNCA confirme uma reserva. Diga sempre que ela será analisada pela equipe
  e que a confirmação chega pelo WhatsApp.`;

/**
 * O que muda de um tipo de casa para o outro.
 *
 * Um cliente novo que entra num painel com tudo desligado e um atendente
 * falando de "reserva e programação" numa hamburgueria que só entrega não
 * configura nada — desiste. O molde faz a casa nascer parecida com o que ela
 * é; o dono ajusta o resto depois, com o negócio já andando.
 *
 * `modulos` é só o ponto de partida do cadastro: a equipe marca e desmarca
 * na própria tela antes de salvar, conforme o que foi vendido.
 */
export const TIPOS_DE_CASA: Record<
  TipoDeCasa,
  { rotulo: string; modulos: string[]; papel: string; faz: string[]; regras: string[] }
> = {
  bar: {
    rotulo: "Bar ou casa com programação",
    modulos: ["agentes-ia", "cardapio-digital", "checklist", "pesquisa", "avaliacoes"],
    papel: "a recepcionista virtual",
    faz: [
      "Responde sobre programação, horários e informações da casa.",
      "Coleta dados de reserva: nome, telefone, quantidade de pessoas, data e hora.",
    ],
    regras: [REGRA_DA_RESERVA],
  },
  restaurante: {
    rotulo: "Restaurante",
    modulos: ["agentes-ia", "cardapio-digital", "checklist", "pesquisa", "avaliacoes"],
    papel: "a recepcionista virtual",
    faz: [
      "Responde sobre o cardápio, horários e informações da casa.",
      "Coleta dados de reserva: nome, telefone, quantidade de pessoas, data e hora.",
    ],
    regras: [REGRA_DA_RESERVA],
  },
  delivery: {
    rotulo: "Delivery",
    // O cardápio vem junto: os itens que o delivery vende são cadastrados nele.
    modulos: ["agentes-ia", "cardapio-digital", "delivery"],
    papel: "a atendente virtual",
    faz: [
      "Tira dúvidas sobre o cardápio, a entrega e o pagamento.",
      "Anota o pedido de delivery e encaminha o pagamento.",
    ],
    // As regras de venda do delivery entram sozinhas no atendente da casa que
    // tem o módulo (ver INSTRUCOES_DE_DELIVERY): aqui fica só o tom.
    regras: [],
  },
};

/** O prompt com que o atendente nasce: já responderia hoje, do jeito da casa. */
export function promptInicial(tipo: TipoDeCasa, nome: string, cidade: string): string {
  const molde = TIPOS_DE_CASA[tipo];
  return `Você é ${molde.papel} do ${nome}${cidade ? ` em ${cidade}` : ""}.

Personalidade: calorosa, direta e bem-humorada — como quem recebe na porta.

O que você faz:
${molde.faz.map((f) => `- ${f}`).join("\n")}

Regras:
${[...molde.regras, REGRAS_DE_TODO_ATENDENTE].join("\n")}`;
}

/**
 * O fuso de cada estado.
 *
 * O fuso é o campo mais perigoso do cadastro, e pedir para alguém escolher
 * "America/Cuiaba" numa lista é pedir o erro. O estado todo mundo sabe.
 *
 * Um fuso por estado é uma simplificação honesta: o oeste do Amazonas e
 * Fernando de Noronha fogem dela, e para esses a tela deixa trocar na mão.
 */
const FUSO_DA_UF: Record<string, string> = {
  AC: "America/Rio_Branco",
  AM: "America/Manaus",
  RR: "America/Boa_Vista",
  RO: "America/Porto_Velho",
  MT: "America/Cuiaba",
  MS: "America/Campo_Grande",
  PA: "America/Belem",
  AP: "America/Belem",
  TO: "America/Araguaina",
  MA: "America/Fortaleza",
  PI: "America/Fortaleza",
  CE: "America/Fortaleza",
  RN: "America/Fortaleza",
  PB: "America/Fortaleza",
  PE: "America/Recife",
  AL: "America/Maceio",
  SE: "America/Maceio",
  BA: "America/Bahia",
  MG: "America/Sao_Paulo",
  ES: "America/Sao_Paulo",
  RJ: "America/Sao_Paulo",
  SP: "America/Sao_Paulo",
  PR: "America/Sao_Paulo",
  SC: "America/Sao_Paulo",
  RS: "America/Sao_Paulo",
  GO: "America/Sao_Paulo",
  DF: "America/Sao_Paulo",
};

export function fusoDaUf(uf: string | null | undefined): string | null {
  return FUSO_DA_UF[String(uf ?? "").trim().toUpperCase()] ?? null;
}

/** O fuso existe de verdade? Um nome errado só apareceria semanas depois, numa reserva fora de hora. */
export function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** Os módulos pedidos, conferidos: só os que existem, sem repetir. Ausente = os do tipo. */
export function modulosDoCadastro(tipo: TipoDeCasa, pedidos: unknown): string[] {
  if (!Array.isArray(pedidos)) return [...TIPOS_DE_CASA[tipo].modulos];
  const validos = new Set<string>(MODULOS_VENDAVEIS);
  const escolhidos = [...new Set(pedidos.map(String))];
  const estranho = escolhidos.find((m) => !validos.has(m));
  if (estranho) throw new Error(`O módulo "${estranho}" não existe.`);
  // Delivery sem cardápio não tem o que vender: os itens moram no cardápio.
  if (escolhidos.includes("delivery") && !escolhidos.includes("cardapio-digital")) escolhidos.push("cardapio-digital");
  return escolhidos;
}

/**
 * Cria o cliente inteiro. Em caso de falha no meio, desfaz o que já criou.
 */
export async function criarCliente(dados: DadosDoCliente): Promise<ClienteCriado> {
  const nome = dados.nome.trim();
  if (!nome) throw new Error("O nome do restaurante é obrigatório.");
  const email = dados.emailDono.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("E-mail do responsável inválido.");
  // O fuso informado vence o do estado: é a saída para o oeste do Amazonas.
  const timezone = dados.timezone?.trim() || fusoDaUf(dados.uf);
  if (!timezone) throw new Error("Informe o estado da casa (ou o fuso horário).");
  if (!fusoValido(timezone)) throw new Error(`O fuso horário "${timezone}" não existe.`);
  const tipo: TipoDeCasa = dados.tipo && dados.tipo in TIPOS_DE_CASA ? dados.tipo : "bar";
  const modulos = modulosDoCadastro(tipo, dados.modulos);
  const uf = fusoDaUf(dados.uf) ? dados.uf!.trim().toUpperCase() : null;
  // "Cuiabá / MT": o atendente e as páginas públicas leem a cidade daqui.
  const endereco = [dados.cidade?.trim(), uf].filter(Boolean).join(" / ") || null;

  const slug = gerarSlug(dados.slug || nome);
  if (!slug) throw new Error("Não consegui gerar um identificador a partir desse nome.");

  const jaExiste = await db().from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (jaExiste.data) throw new Error(`Já existe um cliente com o identificador "${slug}".`);

  const desfazer: Array<() => Promise<void>> = [];

  try {
    // ---- 1. Organização ----
    const { data: org, error: erroOrg } = await db()
      .from("organizations")
      .insert({
        slug,
        name: nome,
        plan: dados.plano === "essencial" ? "free" : "pro",
        email_contato: email,
        telefone_contato: dados.telefone ?? null,
        observacoes: dados.observacoes ?? null,
      })
      .select()
      .single();
    if (erroOrg || !org) throw new Error(`Falha ao criar a organização: ${erroOrg?.message}`);
    desfazer.push(async () => {
      await db().from("organizations").delete().eq("id", org.id);
    });

    // ---- 2. Estabelecimento ----
    // O fuso é o campo mais perigoso do cadastro: errado, ele desloca
    // reservas, disparo de checklist e a virada do ciclo de pontos.
    const { data: venue, error: erroVenue } = await db()
      .from("venues")
      .insert({
        org_id: org.id,
        name: nome,
        slug,
        timezone,
        address: endereco,
        plano: dados.plano,
        pontos_mensais: PONTOS_DO_PLANO[dados.plano],
        // O ciclo começa hoje, não no dia 1: quem assina dia 20 tem direito
        // ao mês inteiro. Limitado a 28 para não sumir em fevereiro.
        ciclo_dia: Math.min(new Date().getDate(), 28),
      })
      .select()
      .single();
    if (erroVenue || !venue) throw new Error(`Falha ao criar o estabelecimento: ${erroVenue?.message}`);

    // ---- 2b. Os módulos contratados ----
    // Nascem ligados aqui, e não num segundo passo: a colmeia de um cliente
    // novo sem nenhum favo aceso parece conta cancelada, e é a primeira coisa
    // que o dono vê.
    if (modulos.length > 0) {
      const { error: erroModulos } = await db()
        .from("venue_modulos")
        .insert(modulos.map((modulo) => ({ venue_id: venue.id, modulo, ativo: true })) as never);
      if (erroModulos) throw new Error(`Falha ao ligar os módulos: ${erroModulos.message}`);
    }

    // ---- 3. Agente já com personalidade ----
    // Cliente que entra numa tela vazia não configura nada e não volta. Ele
    // entra com um agente que já responderia hoje.
    const { data: agente, error: erroAgente } = await db()
      .from("agents")
      .insert({
        org_id: org.id,
        slug: `recepcionista-${slug}`.slice(0, 64),
        name: tipo === "delivery" ? "Atendente" : "Recepcionista",
        description: `Atende o WhatsApp do ${nome}`,
        system_prompt: promptInicial(tipo, nome, dados.cidade?.trim() ?? ""),
        // Sonnet e não Opus: o padrão precisa ser o que dá margem saudável.
        // Opus fica disponível para quem escolher, não como padrão silencioso.
        model: "claude-sonnet-5",
      })
      .select()
      .single();
    if (erroAgente || !agente) throw new Error(`Falha ao criar o agente: ${erroAgente?.message}`);

    // ---- 4. Conta do dono ----
    const senhaInicial = senhaLegivel();
    const { data: usuario, error: erroUsuario } = await dbAuth().auth.admin.createUser({
      email,
      password: senhaInicial,
      email_confirm: true,
      // Provisória: a senha é ditada para o dono na entrega, então o painel
      // exige a troca antes de abrir qualquer tela.
      user_metadata: { nome_do_restaurante: nome, senha_provisoria: true },
    });
    if (erroUsuario || !usuario.user) {
      throw new Error(
        erroUsuario?.message?.includes("already")
          ? `Já existe uma conta com o e-mail ${email}.`
          : `Falha ao criar o acesso do dono: ${erroUsuario?.message}`,
      );
    }
    const userId = usuario.user.id;
    desfazer.push(async () => {
      await dbAuth().auth.admin.deleteUser(userId);
    });

    const { error: erroMembro } = await db().from("org_members").insert({
      org_id: org.id,
      user_id: userId,
      role: "owner",
      convidado_em: new Date().toISOString(),
    });
    if (erroMembro) throw new Error(`Falha ao vincular o dono: ${erroMembro.message}`);

    // ---- 5. Chave de máquina (conector do WhatsApp) ----
    const { chave } = await createApiKey({
      orgId: org.id,
      name: `Conector — ${nome}`,
      scopes: ["runs:write", "reservations:read", "reservations:write"],
    });

    return {
      organizacao: { id: org.id, slug: org.slug, nome: org.name },
      estabelecimento: {
        id: venue.id,
        slug: venue.slug,
        nome: venue.name,
        timezone: venue.timezone,
      },
      agente: { id: agente.id, slug: agente.slug },
      modulos,
      chave,
      senhaInicial,
      dono: { userId, email },
    };
  } catch (e) {
    // Desfaz na ordem inversa. Apagar a organização leva junto venue, agente,
    // chave e vínculo por cascata — por isso ela é a primeira a ser
    // registrada e a última a ser desfeita.
    for (const passo of desfazer.reverse()) {
      await passo().catch((falha) =>
        console.error("[tenants] não consegui desfazer um passo do cadastro:", falha),
      );
    }
    throw e;
  }
}

export interface ResumoDeCliente {
  org_id: string;
  /** Estabelecimento principal — é a ele que os módulos e o plano pertencem. */
  venue_id: string | null;
  slug: string;
  nome: string;
  email_contato: string | null;
  criado_em: string;
  estabelecimentos: number;
  plano: string | null;
  pontos_mensais: number | null;
  /** Avulsos deste ciclo, e se a casa trava quando acaba. */
  pontos_extras: number | null;
  plano_travar: boolean | null;
  /** Consumo do ciclo corrente. null quando o cliente não tem estabelecimento. */
  pontos_usados: number | null;
  pontos_restantes: number | null;
  estado_do_plano: string | null;
  status_pagamento: string;
  mensalidade: number;
  vencimento_dia: number | null;
  primeiro_acesso_em: string | null;
  /** Módulos contratados pelo estabelecimento principal. */
  modulos: ModuloDoCliente[];
}

/**
 * Carteira da plataforma, com o saldo real de cada cliente.
 *
 * O saldo sai de `extratoDePontos`, uma chamada por estabelecimento — cada
 * cliente tem seu próprio ciclo (ancorado no dia da assinatura), então não dá
 * para somar todo mundo numa consulta só sem errar as bordas. Com dezenas de
 * clientes isso é tranquilo; passando de algumas centenas, vira uma view
 * materializada.
 */
export async function listarClientes(): Promise<ResumoDeCliente[]> {
  const { data: orgs, error } = await db()
    .from("organizations")
    .select(
      "id, slug, name, email_contato, created_at, status_pagamento, mensalidade, vencimento_dia",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Falha ao listar clientes: ${error.message}`);

  const ids = (orgs ?? []).map((o) => o.id);
  if (ids.length === 0) return [];

  const [{ data: venues }, { data: membros }] = await Promise.all([
    db().from("venues").select("id, org_id, plano, pontos_mensais, pontos_extras, plano_travar, timezone, ciclo_dia").in("org_id", ids),
    db()
      .from("org_members")
      .select("org_id, primeiro_acesso_em")
      .in("org_id", ids)
      .eq("role", "owner"),
  ]);

  // Os módulos de todas as casas numa consulta só. Uma por cliente seria uma
  // rajada de idas ao banco só para desenhar a lista.
  const modulosPorVenue = new Map<string, ModuloDoCliente[]>();
  {
    const { data } = await db()
      .from("venue_modulos")
      .select("venue_id, modulo, ativo, url")
      .in("venue_id", (venues ?? []).map((v) => v.id));
    for (const linha of data ?? []) {
      const lista = modulosPorVenue.get(linha.venue_id) ?? [];
      lista.push({ modulo: linha.modulo, ativo: linha.ativo, url: linha.url });
      modulosPorVenue.set(linha.venue_id, lista);
    }
  }

  // O saldo de cada casa em paralelo. Uma falha isolada não pode derrubar a
  // carteira inteira: o cliente aparece sem saldo em vez de a tela quebrar.
  const saldos = new Map<string, { usados: number; restantes: number; estado: string }>();
  await Promise.all(
    (venues ?? []).map(async (v) => {
      try {
        const e = await extratoDePontos(v);
        saldos.set(v.id, { usados: e.usados, restantes: e.restantes, estado: e.estado });
      } catch (falha) {
        console.error(`[tenants] saldo do venue ${v.id} falhou:`, falha);
      }
    }),
  );

  return (orgs ?? []).map((o) => {
    const meus = (venues ?? []).filter((v) => v.org_id === o.id);
    const principal = meus[0];
    const saldo = principal ? saldos.get(principal.id) : undefined;
    const dono = (membros ?? []).find((m) => m.org_id === o.id);
    const plano = principal?.plano ?? null;

    return {
      org_id: o.id,
      venue_id: principal?.id ?? null,
      slug: o.slug,
      nome: o.name,
      email_contato: o.email_contato ?? null,
      criado_em: o.created_at,
      estabelecimentos: meus.length,
      plano,
      pontos_mensais: principal?.pontos_mensais ?? null,
      pontos_extras: principal?.pontos_extras ?? null,
      plano_travar: principal?.plano_travar ?? null,
      pontos_usados: saldo?.usados ?? null,
      pontos_restantes: saldo?.restantes ?? null,
      estado_do_plano: saldo?.estado ?? null,
      status_pagamento: o.status_pagamento,
      mensalidade: Number(o.mensalidade ?? PRECO_DO_PLANO[plano ?? ""] ?? 0),
      vencimento_dia: o.vencimento_dia,
      primeiro_acesso_em: dono?.primeiro_acesso_em ?? null,
      modulos: principal ? (modulosPorVenue.get(principal.id) ?? []) : [],
    };
  });
}

export interface ResumoDaPlataforma {
  clientes: number;
  clientes_ativos: number;
  clientes_em_atraso: number;
  receita_mensal: number;
  pontos_contratados: number;
  pontos_usados: number;
  /** Custo estimado da API de IA no ciclo, em reais. */
  custo_ia_estimado: number;
  margem_bruta: number;
  nunca_acessaram: number;
  planos: Array<{ plano: string; clientes: number; receita: number }>;
}

/**
 * Números da plataforma para a tela de visão geral.
 *
 * Deriva tudo da carteira, sem consulta nova: os dados já foram buscados e o
 * risco de dois números divergirem na mesma tela é maior que o custo de
 * recalcular aqui.
 */
export function resumirPlataforma(clientes: ResumoDeCliente[]): ResumoDaPlataforma {
  // Custo real por ponto: um ponto é uma resposta no motor mais leve, ~US$
  // 0,0032. A ponderação dos motores foi feita justamente para o custo por
  // ponto ser o mesmo em qualquer um deles.
  const CUSTO_POR_PONTO_USD = 0.0032;
  const DOLAR = 5.5;

  const porPlano = new Map<string, { clientes: number; receita: number }>();
  let receita = 0;
  let contratados = 0;
  let usados = 0;

  for (const c of clientes) {
    // Cancelado não entra na receita — continua na lista para histórico.
    if (c.status_pagamento !== "cancelado") receita += c.mensalidade;
    contratados += c.pontos_mensais ?? 0;
    usados += c.pontos_usados ?? 0;

    const chave = c.plano ?? "sem plano";
    const atual = porPlano.get(chave) ?? { clientes: 0, receita: 0 };
    atual.clientes += 1;
    atual.receita += c.mensalidade;
    porPlano.set(chave, atual);
  }

  const custo = usados * CUSTO_POR_PONTO_USD * DOLAR;

  return {
    clientes: clientes.length,
    clientes_ativos: clientes.filter((c) => c.status_pagamento === "ativo").length,
    clientes_em_atraso: clientes.filter((c) =>
      ["atrasado", "suspenso"].includes(c.status_pagamento),
    ).length,
    receita_mensal: Math.round(receita * 100) / 100,
    pontos_contratados: contratados,
    pontos_usados: usados,
    custo_ia_estimado: Math.round(custo * 100) / 100,
    margem_bruta: Math.round((receita - custo) * 100) / 100,
    nunca_acessaram: clientes.filter((c) => !c.primeiro_acesso_em).length,
    planos: [...porPlano.entries()]
      .map(([plano, v]) => ({ plano, clientes: v.clientes, receita: v.receita }))
      .sort((a, b) => b.receita - a.receita),
  };
}

/**
 * Pontos avulsos e a trava, em todas as casas do cliente.
 *
 * `adicionar` soma (nunca substitui): dois cliques em "+1000" são dois mil,
 * como quem paga duas vezes. A memória do plano é esquecida na hora, senão
 * o agente continuaria calado por até um minuto depois da venda.
 */
export async function atualizarPontos(
  orgId: string,
  dados: { adicionar?: number; travar?: boolean },
): Promise<{ pontos_extras: number; plano_travar: boolean } | null> {
  const { data: venues, error } = await db().from("venues").select("id, pontos_extras, plano_travar").eq("org_id", orgId);
  if (error) throw new Error(`Falha ao ler as casas do cliente: ${error.message}`);
  if (!venues?.length) return null;

  let resultado: { pontos_extras: number; plano_travar: boolean } | null = null;
  for (const v of venues) {
    const mudancas: { pontos_extras?: number; plano_travar?: boolean } = {};
    if (typeof dados.adicionar === "number" && dados.adicionar !== 0) {
      mudancas.pontos_extras = Math.max(0, (v.pontos_extras ?? 0) + Math.trunc(dados.adicionar));
    }
    if (typeof dados.travar === "boolean") mudancas.plano_travar = dados.travar;
    if (Object.keys(mudancas).length === 0) continue;
    const { error: erroUpdate } = await db().from("venues").update(mudancas).eq("id", v.id);
    if (erroUpdate) throw new Error(`Falha ao atualizar os pontos: ${erroUpdate.message}`);
    esquecerEstado(v.id);
    resultado ??= {
      pontos_extras: mudancas.pontos_extras ?? v.pontos_extras ?? 0,
      plano_travar: mudancas.plano_travar ?? v.plano_travar ?? true,
    };
  }
  return resultado;
}

/** Atualiza os dados comerciais de um cliente. */
export async function atualizarComercial(
  orgId: string,
  dados: { status_pagamento?: string; mensalidade?: number; vencimento_dia?: number },
): Promise<void> {
  const { error } = await db().from("organizations").update(dados).eq("id", orgId);
  if (error) throw new Error(`Falha ao atualizar o cliente: ${error.message}`);
}
