import { db } from "./supabase.js";
import { ErroDePesquisa, enviarConvite, telefoneLimpo } from "./pesquisa.js";
import { hojeNaCasa, horaNaCasa } from "./fuso.js";
import { registrarClienteSeDer } from "./clientes.js";

/**
 * A ponte da pesquisa com a Zig: quem esteve ontem recebe o convite hoje.
 *
 * A Zig sabe QUEM esteve na casa — nome e telefone de quem comprou e de quem
 * fez check-in. A pesquisa sabe PERGUNTAR. Este módulo liga as duas pontas:
 * uma vez por dia, na hora que a casa escolheu, busca os visitantes de ontem
 * e manda cada um pelo mesmo corredor do convite digitado no painel.
 *
 * Três travas, porque convite em massa erra caro:
 *   - o índice único no banco: a mesma pessoa, na mesma visita, UM convite —
 *     mesmo que a varredura rode duas vezes;
 *   - o "não repetir": quem já foi convidado há menos de N dias não recebe
 *     de novo, senão o cliente aprende a ignorar a pesquisa;
 *   - o teto por dia: WhatsApp comum disparando centenas de mensagens numa
 *     rajada é WhatsApp banido. O teto protege o número da casa.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// Sem os tipos gerados: mesma decisão da pesquisa e do CMV — a tabela é nova
// e `database.types.ts` só é regerado depois da migração em produção.
const cliente = () => db() as any;

const BASE_ZIG = process.env.ZIG_API_URL ?? "https://api.zigcore.com.br/integration";

// ============================================================
// Configuração por casa
// ============================================================

export interface ConfigZig {
  token: string | null;
  loja: string | null;
  ativo: boolean;
  hora_envio: number;
  teto_por_dia: number;
  nao_repetir_dias: number;
  ultimo_dia: string | null;
}

export const CONFIG_ZIG_PADRAO: ConfigZig = {
  token: null,
  loja: null,
  ativo: false,
  hora_envio: 11,
  teto_por_dia: 80,
  nao_repetir_dias: 30,
  ultimo_dia: null,
};

export async function configZig(venueId: string): Promise<ConfigZig> {
  const { data, error } = await cliente()
    .from("pesquisa_zig")
    .select("*")
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) throw new ErroDePesquisa(500, `Falha ao ler a conexão com a Zig: ${error.message}`);
  if (!data) return { ...CONFIG_ZIG_PADRAO };
  return {
    token: data.token ?? null,
    loja: data.loja ?? null,
    ativo: data.ativo === true,
    hora_envio: Number(data.hora_envio ?? CONFIG_ZIG_PADRAO.hora_envio),
    teto_por_dia: Number(data.teto_por_dia ?? CONFIG_ZIG_PADRAO.teto_por_dia),
    nao_repetir_dias: Number(data.nao_repetir_dias ?? CONFIG_ZIG_PADRAO.nao_repetir_dias),
    ultimo_dia: data.ultimo_dia ?? null,
  };
}

export async function salvarConfigZig(
  venueId: string,
  campos: Partial<ConfigZig>,
): Promise<ConfigZig> {
  const atual = await configZig(venueId);
  // Campo ausente não é campo apagado: só o que veio definido entra no
  // merge. String vazia apaga de propósito — é como o X da tela funciona.
  const definidos = Object.fromEntries(
    Object.entries(campos).filter(([, v]) => v !== undefined),
  ) as Partial<ConfigZig>;
  const misturado = { ...atual, ...definidos };
  if (misturado.token === ("" as unknown)) misturado.token = null;
  if (misturado.loja === ("" as unknown)) misturado.loja = null;

  const { error } = await cliente()
    .from("pesquisa_zig")
    .upsert(
      {
        venue_id: venueId,
        token: misturado.token,
        loja: misturado.loja,
        ativo: misturado.ativo,
        hora_envio: misturado.hora_envio,
        teto_por_dia: misturado.teto_por_dia,
        nao_repetir_dias: misturado.nao_repetir_dias,
        ultimo_dia: misturado.ultimo_dia,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "venue_id" },
    );
  if (error) throw new ErroDePesquisa(500, `Falha ao salvar a conexão com a Zig: ${error.message}`);
  return misturado;
}

// ============================================================
// O cliente HTTP da Zig
// ============================================================

async function chamarZig<T>(caminho: string, token: string): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${BASE_ZIG}${caminho}`, {
      headers: { authorization: token },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new ErroDePesquisa(
      502,
      `Não deu para falar com a Zig: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (resposta.status === 401 || resposta.status === 403) {
    throw new ErroDePesquisa(401, "A Zig recusou o token. Confira o token de integração no painel da Zig.");
  }
  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    throw new ErroDePesquisa(502, `A Zig respondeu ${resposta.status}: ${corpo.slice(0, 300)}`);
  }
  return (await resposta.json()) as T;
}

interface CompradorDaZig {
  userPhone?: string | null;
  userName?: string | null;
  /** Valor dos produtos da transação, em centavos. */
  productsValue?: number | null;
  /** Data de nascimento do cadastro da Zig, quando a pessoa preencheu. */
  userBirthdate?: string | null;
}

interface CheckinDaZig {
  phone?: string | null;
  name?: string | null;
  birthDate?: string | null;
}

/** O visitante como a pesquisa o entende: telefone, nome e o que gastou. */
export interface Visitante {
  telefone: string;
  nome: string | null;
  /** Soma das compras da pessoa no dia, em centavos. Check-in sem compra = 0. */
  gasto_centavos: number;
  /**
   * O nascimento, quando a Zig tem. Não serve para o convite — serve para a
   * base de clientes, que é quem manda o parabéns depois.
   */
  nascimento: string | null;
}

/**
 * Junta compradores e check-ins numa lista só, um por telefone, com o gasto
 * do dia somado — e ordenada do maior gasto para o menor, porque é nessa
 * ordem que o dono escolhe quem convida.
 *
 * As duas fontes de propósito: numa mesa de seis, às vezes só um paga — mas
 * os seis fizeram check-in. Telefone sem DDD ou inventado fica de fora aqui,
 * antes de gastar convite.
 */
export function mesclarVisitantes(
  compradores: CompradorDaZig[],
  checkins: CheckinDaZig[],
): Visitante[] {
  const porTelefone = new Map<string, Visitante>();
  const acrescentar = (
    telefoneBruto: string | null | undefined,
    nome: string | null | undefined,
    gastoCentavos: number,
    nascimento: string | null | undefined,
  ) => {
    let telefone = telefoneLimpo(telefoneBruto ?? "");
    if (telefone.length < 10 || telefone.length > 15) return;
    // A Zig ora manda com +55, ora sem. Normalizar aqui é o que faz o mesmo
    // cliente das duas fontes virar UMA pessoa — e casa com a trava de
    // repetição, que compara telefones.
    if (telefone.length === 10 || telefone.length === 11) telefone = `55${telefone}`;
    const existente = porTelefone.get(telefone);
    if (existente) {
      // Um nome de verdade vale mais que nenhum — de qualquer uma das fontes.
      if (!existente.nome && nome?.trim()) existente.nome = nome.trim();
      if (!existente.nascimento && nascimento?.trim()) existente.nascimento = nascimento.trim();
      // Cada transação é uma linha em Compradores; a pessoa é a soma delas.
      existente.gasto_centavos += gastoCentavos;
      return;
    }
    porTelefone.set(telefone, {
      telefone,
      nome: nome?.trim() || null,
      gasto_centavos: gastoCentavos,
      nascimento: nascimento?.trim() || null,
    });
  };
  for (const c of compradores) {
    acrescentar(c.userPhone, c.userName, Math.max(0, Number(c.productsValue ?? 0)), c.userBirthdate);
  }
  for (const c of checkins) acrescentar(c.phone, c.name, 0, c.birthDate);
  return [...porTelefone.values()].sort((a, b) => b.gasto_centavos - a.gasto_centavos);
}

/** O dia anterior a um AAAA-MM-DD, sem depender do fuso do servidor. */
export function diaAnterior(diaISO: string): string {
  const d = new Date(`${diaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** E o seguinte — a Zig pede a janela [desde, até] dos check-ins. */
export function diaSeguinte(diaISO: string): string {
  const d = new Date(`${diaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Que dia buscar agora — ou null, se ainda não é hora.
 *
 * Busca-se sempre ONTEM (no calendário da casa): o movimento de hoje ainda
 * está acontecendo. E só depois da hora configurada, para o convite não
 * chegar às sete da manhã de domingo.
 */
export function diaParaBuscar(
  config: Pick<ConfigZig, "ativo" | "token" | "loja" | "hora_envio" | "ultimo_dia">,
  fuso: string,
  agora = new Date(),
): string | null {
  if (!config.ativo || !config.token || !config.loja) return null;
  const ontem = diaAnterior(hojeNaCasa(fuso, agora));
  if (config.ultimo_dia && config.ultimo_dia >= ontem) return null;
  if (horaNaCasa(fuso, agora) < config.hora_envio) return null;
  return ontem;
}

/**
 * Quem esteve na casa num dia, segundo a Zig.
 *
 * Compradores numa chamada; check-ins paginados de 50 em 50 (limite da Zig).
 * Um dia só cabe folgado nos limites de janela dela (5 dias / 5 eventos).
 */
export async function visitantesDoDia(
  config: { token: string; loja: string },
  diaISO: string,
): Promise<Visitante[]> {
  const compradores = await chamarZig<CompradorDaZig[]>(
    `/erp/compradores?dtinicio=${diaISO}&dtfim=${diaISO}&loja=${encodeURIComponent(config.loja)}`,
    config.token,
  );

  const checkins: CheckinDaZig[] = [];
  for (let pagina = 1; pagina <= 40; pagina++) {
    const lote = await chamarZig<CheckinDaZig[]>(
      `/erp/checkins?desde=${diaISO}&dtfim=${diaSeguinte(diaISO)}&loja=${encodeURIComponent(config.loja)}&page=${pagina}`,
      config.token,
    );
    checkins.push(...(lote ?? []));
    if (!lote || lote.length < 50) break;
  }

  return mesclarVisitantes(compradores ?? [], checkins);
}

/**
 * Passa os visitantes do dia para a base de clientes da casa.
 *
 * Isto acontece TODA vez que a Zig é consultada — inclusive quando ninguém é
 * convidado (teto batido, todo mundo repetido, pesquisa desligada). O convite
 * é uma decisão do dono; conhecer quem esteve na casa não é: se a pessoa
 * apareceu, ela entra na base, e é da base que sai o parabéns de aniversário.
 *
 * Nunca derruba a busca: alimentar o cadastro é acessório, convidar é o
 * essencial. Mesma regra de sempre.
 */
export async function alimentarBaseDeClientes(
  venueId: string,
  visitantes: Visitante[],
  diaISO: string,
): Promise<void> {
  for (const v of visitantes) {
    await registrarClienteSeDer(venueId, "zig", {
      telefone: v.telefone,
      nome: v.nome,
      nascimento: v.nascimento,
      // Uma visita por dia buscado, e o gasto do dia somado ao histórico. A
      // varredura só processa cada dia uma vez, então isto não conta dobrado.
      visitas: 1,
      gastoCentavos: v.gasto_centavos,
      ultimaVisita: diaISO,
    });
  }
}

/**
 * Testa a conexão sem mandar nada: token e loja valem?
 *
 * Usa o endpoint de eventos, que aceita qualquer janela — uma resposta 200
 * prova que o token abre a porta e a loja existe.
 */
export async function testarZig(config: { token: string; loja: string }): Promise<{ ok: true; eventos: number }> {
  const hoje = new Date().toISOString().slice(0, 10);
  const eventos = await chamarZig<unknown[]>(
    `/erp/events?loja=${encodeURIComponent(config.loja)}&dtinicio=${diaAnterior(hoje)}&dtfim=${hoje}`,
    config.token,
  );
  return { ok: true, eventos: Array.isArray(eventos) ? eventos.length : 0 };
}

// ============================================================
// A busca de um dia, para uma casa
// ============================================================

export interface ResultadoDaBusca {
  dia: string;
  visitantes: number;
  convidados: number;
  repetidos: number;
  alem_do_teto: number;
  ja_buscado: boolean;
}

/**
 * Telefones que já receberam convite nos últimos N dias — a trava do "não
 * repetir". A importação de planilha usa a mesma, pelo mesmo motivo.
 */
export async function telefonesConvidadosRecentemente(
  venueId: string,
  dias: number,
  agora: Date,
): Promise<Set<string>> {
  if (dias <= 0) return new Set();
  const corte = new Date(agora.getTime() - dias * 86_400_000).toISOString();
  const { data, error } = await cliente()
    .from("pesquisa_convites")
    .select("telefone")
    .eq("venue_id", venueId)
    .gte("created_at", corte)
    .limit(10_000);
  if (error) throw new ErroDePesquisa(500, `Falha ao conferir convites recentes: ${error.message}`);

  // Cada telefone entra com e sem o 55 na frente: o convite digitado no
  // painel costuma vir sem, o da Zig vem com — e são a mesma pessoa.
  const conjunto = new Set<string>();
  for (const c of (data ?? []) as { telefone: string }[]) {
    const t = c.telefone;
    conjunto.add(t);
    if (t.length === 10 || t.length === 11) conjunto.add(`55${t}`);
    if (t.startsWith("55") && (t.length === 12 || t.length === 13)) conjunto.add(t.slice(2));
  }
  return conjunto;
}

/**
 * Busca os visitantes de um dia na Zig e convida cada um.
 *
 * `forcar` ignora a hora configurada (o botão "Buscar agora" do painel), mas
 * NUNCA ignora o dia já buscado nem as travas de repetição — forçar duas
 * vezes não manda duas vezes.
 */
export async function buscarEConvidar(
  venue: { id: string; name: string; timezone: string },
  opcoes: { agora?: Date; forcar?: boolean } = {},
): Promise<ResultadoDaBusca> {
  const agora = opcoes.agora ?? new Date();
  const config = await configZig(venue.id);
  if (!config.token || !config.loja) {
    throw new ErroDePesquisa(400, "Preencha o token e a loja da Zig antes.");
  }

  const ontem = diaAnterior(hojeNaCasa(venue.timezone, agora));
  const vazio = { dia: ontem, visitantes: 0, convidados: 0, repetidos: 0, alem_do_teto: 0 };
  if (config.ultimo_dia && config.ultimo_dia >= ontem) {
    return { ...vazio, ja_buscado: true };
  }
  if (!opcoes.forcar && !diaParaBuscar(config, venue.timezone, agora)) {
    return { ...vazio, ja_buscado: false };
  }

  const visitantes = await visitantesDoDia({ token: config.token, loja: config.loja }, ontem);
  // Antes de decidir quem convidar: todo mundo que esteve na casa entra na
  // base. Quem não recebe convite hoje ainda pode receber o parabéns em maio.
  await alimentarBaseDeClientes(venue.id, visitantes, ontem);
  const recentes = await telefonesConvidadosRecentemente(venue.id, config.nao_repetir_dias, agora);
  const ineditos = visitantes.filter((v) => !recentes.has(v.telefone));
  const convidaveis = ineditos.slice(0, config.teto_por_dia);

  let convidados = 0;
  let repetidos = visitantes.length - ineditos.length;
  for (const v of convidaveis) {
    try {
      await enviarConvite(venue, {
        telefone: v.telefone,
        nome: v.nome,
        origem: "zig",
        diaVisita: ontem,
      });
      convidados++;
    } catch (e) {
      // 409 é o índice único segurando a repetição — conta como repetido e
      // segue. Qualquer outra falha não pode derrubar o restante da lista.
      if (e instanceof ErroDePesquisa && e.status === 409) repetidos++;
      else console.error(`[pesquisa-zig] convite para ${v.telefone} falhou: ${(e as Error).message}`);
    }
  }

  // O dia fica marcado como buscado mesmo com zero convidados: dia sem
  // movimento também é dia processado — senão a varredura tenta para sempre.
  await salvarConfigZig(venue.id, { ultimo_dia: ontem });
  console.log(
    `[pesquisa-zig] ${venue.name}: ${visitantes.length} visitante(s) em ${ontem}, ` +
      `${convidados} convidado(s), ${repetidos} já convidado(s) antes.`,
  );
  return {
    dia: ontem,
    visitantes: visitantes.length,
    convidados,
    repetidos,
    alem_do_teto: ineditos.length - convidaveis.length,
    ja_buscado: false,
  };
}

// ============================================================
// O modo escolhido a dedo: buscar, olhar, marcar, enviar
// ============================================================

export interface VisitanteParaEscolher extends Visitante {
  /** Já recebeu convite há menos de N dias — a tela desabilita a linha. */
  ja_convidado: boolean;
}

/**
 * Quem esteve na casa num dia, com o gasto de cada um — SEM mandar nada.
 *
 * É a lista que o dono olha antes de escolher: do maior gasto para o menor,
 * com quem já foi convidado há pouco marcado. Buscar não convida; convidar é
 * outro botão, apertado de propósito.
 */
export async function listarVisitantes(
  venue: { id: string },
  diaISO?: string,
  fuso = "America/Cuiaba",
): Promise<{ dia: string; visitantes: VisitanteParaEscolher[] }> {
  const config = await configZig(venue.id);
  if (!config.token || !config.loja) {
    throw new ErroDePesquisa(400, "Preencha o token e a loja da Zig antes.");
  }
  const dia = diaISO && /^\d{4}-\d{2}-\d{2}$/.test(diaISO)
    ? diaISO
    : diaAnterior(hojeNaCasa(fuso));

  const visitantes = await visitantesDoDia({ token: config.token, loja: config.loja }, dia);
  // Só a identidade — nome e nascimento — e nenhum contador. Esta tela pode
  // ser aberta cinco vezes para o mesmo dia enquanto o dono escolhe; somar
  // visita a cada abertura inventaria movimento que não existiu.
  for (const v of visitantes) {
    await registrarClienteSeDer(venue.id, "zig", {
      telefone: v.telefone,
      nome: v.nome,
      nascimento: v.nascimento,
    });
  }
  const recentes = await telefonesConvidadosRecentemente(
    venue.id,
    Math.max(1, config.nao_repetir_dias),
    new Date(),
  );
  return {
    dia,
    visitantes: visitantes.map((v) => ({ ...v, ja_convidado: recentes.has(v.telefone) })),
  };
}

/**
 * Convida exatamente quem o dono marcou.
 *
 * O teto por dia continua valendo — ele existe para proteger o número do
 * WhatsApp, e escolher a dedo não muda o que a Meta enxerga. As travas de
 * repetição também: marcar alguém já convidado vira "repetido", não segundo
 * convite.
 */
export async function convidarEscolhidos(
  venue: { id: string; name: string },
  dia: string,
  escolhidos: { telefone: string; nome?: string | null }[],
): Promise<{ enviados: number; repetidos: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    throw new ErroDePesquisa(400, "Diga de que dia é essa lista (AAAA-MM-DD).");
  }
  if (escolhidos.length === 0) {
    throw new ErroDePesquisa(400, "Marque pelo menos um cliente.");
  }
  const config = await configZig(venue.id);
  if (escolhidos.length > config.teto_por_dia) {
    throw new ErroDePesquisa(
      400,
      `São ${escolhidos.length} marcados, e o teto do dia é ${config.teto_por_dia} — ` +
        `o teto protege o número do WhatsApp. Marque menos gente ou suba o teto na conexão da Zig.`,
    );
  }

  let enviados = 0;
  let repetidos = 0;
  for (const e of escolhidos) {
    try {
      await enviarConvite(venue, {
        telefone: e.telefone,
        nome: e.nome ?? null,
        origem: "zig",
        diaVisita: dia,
      });
      enviados++;
    } catch (erro) {
      if (erro instanceof ErroDePesquisa && erro.status === 409) repetidos++;
      else console.error(`[pesquisa-zig] convite para ${e.telefone} falhou: ${(erro as Error).message}`);
    }
  }
  return { enviados, repetidos };
}

// ============================================================
// A varredura — roda de hora em hora onde há processo de pé
// ============================================================

/**
 * Passa por toda casa com o módulo de pesquisa ativo e busca o dia de ontem
 * quando for a hora. Idempotente: `ultimo_dia` + índice único seguram
 * qualquer repetição, então pode rodar de hora em hora sem guardar estado.
 */
export async function cicloDaPesquisaZig(agora = new Date()): Promise<void> {
  let casas: any[];
  try {
    const { data, error } = await cliente()
      .from("venue_modulos")
      .select("venue_id, venues:venue_id(id, name, timezone)")
      .eq("modulo", "pesquisa")
      .eq("ativo", true);
    if (error) {
      if (/venue_modulos|42P01|PGRST/i.test(error.message)) return;
      throw error;
    }
    casas = data ?? [];
  } catch (e) {
    console.error(`[pesquisa-zig] varredura não listou as casas: ${(e as Error).message}`);
    return;
  }

  for (const casa of casas) {
    const venue = casa.venues;
    if (!venue) continue;
    try {
      const config = await configZig(venue.id);
      const dia = diaParaBuscar(config, venue.timezone, agora);
      if (!dia) continue;
      await buscarEConvidar(venue, { agora });
    } catch (e) {
      // A tabela pode nem existir ainda (migração pendente) — silêncio é o
      // comportamento certo para casa sem Zig configurada.
      if (!/pesquisa_zig|42P01|PGRST/i.test((e as Error).message)) {
        console.error(`[pesquisa-zig] ${venue.name}: ${(e as Error).message}`);
      }
    }
  }
}
