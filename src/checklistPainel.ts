import { db } from "./supabase.js";
import {
  agendaDe,
  agoraLocal,
  ehDeRodadas,
  rodadasDe,
  type Checklist,
  type ChecklistRun,
  type RespostaItem,
} from "./checklists.js";
import { minutosDe, rodadasPrevistas, TOLERANCIA_MINUTOS, type Rodada } from "./rodadas.js";

/**
 * O PAINEL DOS CHECKLISTS — um cartão por checklist, em vez de uma lista
 * com todas as execuções de todos os dias.
 *
 * A lista antiga respondia "o que aconteceu em cada dia", e o dono de bar
 * pergunta outra coisa: "o banheiro está sendo limpo?", "o vigia faz o
 * checklist?". Para responder isso é preciso juntar os dias de UM checklist
 * — e é o que este módulo faz: para cada checklist, a situação de cada dia,
 * quanto foi cumprido, quem fez por último e o que se repete.
 *
 * Quase tudo aqui é puro (recebe as execuções e devolve o resumo), porque é
 * a parte que tem regra de negócio e precisa de teste. O que lê o banco está
 * no fim do arquivo.
 */

/** Como ficou um dia de um checklist — é a cor do quadradinho. */
export type SituacaoDoDia =
  /** Feito, sem nada apontado. Verde. */
  | "feito"
  /** Feito, mas com alerta da IA ou rodada pulada. Amarelo. */
  | "com_problema"
  /** O dia passou e não terminaram (ou nem abriram). Vermelho. */
  | "nao_feito"
  /** É hoje e ainda está aberto. Cinza. */
  | "aguardando"
  /** Estava na agenda, mas o link nem saiu (o sistema estava fora). */
  | "nao_saiu"
  /** Não estava na agenda. Vazio. */
  | "folga";

export interface DiaDoChecklist {
  data: string;
  situacao: SituacaoDoDia;
  run_id: string | null;
  /** Quem preencheu — nas rodadas, todo mundo que fez alguma. */
  executores: string[];
  /** Por que ficou amarelo ou vermelho, em uma frase. */
  motivo: string | null;
}

export interface HojeDoChecklist {
  situacao: SituacaoDoDia;
  run_id: string | null;
  /** Hora em que o link sai. */
  hora: string;
  /** Depois desta hora sem ninguém terminar, está atrasado. */
  atrasado: boolean;
  executor: string | null;
  concluido_em: string | null;
  rodadas: { feitas: number; previstas: number; puladas: number } | null;
}

export interface ResumoDoChecklist {
  id: string;
  nome: string;
  ativo: boolean;
  responsavel: string;
  /** "Seg, qua e sex às 09:00" — a agenda dita em português. */
  agenda: string;
  de_rodadas: boolean;
  /** Os dias do período pedido, do mais antigo para o mais novo. */
  dias: DiaDoChecklist[];
  /** Os últimos 14 dias até hoje — a faixa do cartão, sempre a mesma. */
  faixa: DiaDoChecklist[];
  /**
   * Quanto foi cumprido no período. No checklist comum conta DIAS; no de
   * rodadas conta RODADAS — senão a noite com três rodadas puladas valeria
   * o mesmo que a noite perfeita.
   */
  cumprimento: { feitos: number; devidos: number; percentual: number | null; unidade: "dias" | "rodadas" };
  contagem: Record<SituacaoDoDia, number>;
  ultimo_feito: { data: string; executor: string | null; concluido_em: string | null } | null;
  hoje: HojeDoChecklist | null;
  /** O que se repete no período, já em frase. No máximo três. */
  repeticoes: string[];
  /** O link saiu e ninguém terminou nenhuma vez no período. */
  nunca_feito: { links: number; abertos: number } | null;
  por_executor: Record<string, number>;
}

export interface PainelDosChecklists {
  hoje: string;
  agora: string;
  de: string;
  ate: string;
  checklists: ResumoDoChecklist[];
  executores: string[];
}

// ============================================================
// Datas — sempre "AAAA-MM-DD" no dia da casa
// ============================================================

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Todos os dias de `de` a `ate`, inclusive. Nunca mais que 400. */
export function diasEntre(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let d = de; d <= ate && dias.length < 400; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

const DIA_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

export function diaDaSemana(data: string): string {
  return DIA_DA_SEMANA[new Date(`${data}T12:00:00Z`).getUTCDay()]!;
}

const NOME_DO_DIA: Record<string, string> = {
  seg: "seg", ter: "ter", qua: "qua", qui: "qui", sex: "sex", sab: "sáb", dom: "dom",
};

/** "todo dia às 09:00", "seg, qua e sex às 09:00", "só quando disparado". */
export function agendaEmTexto(checklist: Checklist): string {
  const agenda = agendaDe(checklist);
  if (agenda.dias.length === 0) return "só quando disparado";
  const ordem = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
  const dias = ordem.filter((d) => agenda.dias.includes(d));
  const quando =
    dias.length === 7
      ? "todo dia"
      : dias.length === 1
        ? NOME_DO_DIA[dias[0]!]!
        : `${dias.slice(0, -1).map((d) => NOME_DO_DIA[d]).join(", ")} e ${NOME_DO_DIA[dias.at(-1)!]}`;
  const horario = ehDeRodadas(agenda)
    ? `das ${agenda.hora} às ${agenda.ate}, a cada ${agenda.a_cada_minutos} min`
    : `às ${agenda.hora}`;
  return `${quando} ${horario}`;
}

// ============================================================
// Nomes de quem fez
// ============================================================

/**
 * "  lucineide " e "Lucineide" são a mesma pessoa; "Lili" e "Lilian" talvez
 * sejam, mas juntar nomes diferentes seria inventar — por isso só a caixa e
 * os espaços são acertados.
 */
export function nomeDeQuemFez(bruto: string | null | undefined): string | null {
  const limpo = (bruto ?? "").trim().replace(/\s+/g, " ");
  if (!limpo) return null;
  return limpo
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((p) => (p.length <= 2 && p !== limpo.toLocaleLowerCase("pt-BR") ? p : p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1)))
    .join(" ");
}

// ============================================================
// A situação de uma execução
// ============================================================

interface Avaliacao {
  situacao: SituacaoDoDia;
  executores: string[];
  motivo: string | null;
}

function rodadasFeitas(rodadas: Rodada[]): Rodada[] {
  return rodadas.filter((r) => r.concluida_em);
}

function alertasDe(run: ChecklistRun): string[] {
  return Array.isArray(run.alertas_ia) ? run.alertas_ia.map(String).filter(Boolean) : [];
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/**
 * A cor do dia. `hoje` decide se um checklist aberto ainda está no prazo
 * (é hoje) ou já ficou para trás (o dia passou).
 */
export function avaliarExecucao(run: ChecklistRun, hoje: string): Avaliacao {
  const rodadas = rodadasDe(run);
  const executores = new Set<string>();
  const nome = nomeDeQuemFez(run.executor_nome);
  if (nome) executores.add(nome);
  for (const r of rodadas) {
    const n = nomeDeQuemFez(r.executor_nome);
    if (n) executores.add(n);
  }
  const quem = [...executores];
  const alertas = alertasDe(run);
  const passou = String(run.scheduled_for) < hoje;

  if (rodadas.length > 0) {
    const feitas = rodadasFeitas(rodadas).length;
    const fechada = run.status === "concluida" || passou;
    if (!fechada) return { situacao: "aguardando", executores: quem, motivo: null };
    if (feitas === 0) return { situacao: "nao_feito", executores: quem, motivo: "nenhuma rodada feita" };
    const puladas = rodadas.length - feitas;
    if (puladas > 0) {
      return { situacao: "com_problema", executores: quem, motivo: `${plural(puladas, "rodada pulada", "rodadas puladas")} de ${rodadas.length}` };
    }
    if (alertas.length > 0) return { situacao: "com_problema", executores: quem, motivo: alertas[0]! };
    return { situacao: "feito", executores: quem, motivo: null };
  }

  if (run.status === "concluida") {
    if (alertas.length > 0) return { situacao: "com_problema", executores: quem, motivo: alertas[0]! };
    return { situacao: "feito", executores: quem, motivo: null };
  }
  if (!passou) return { situacao: "aguardando", executores: quem, motivo: null };
  return {
    situacao: "nao_feito",
    executores: quem,
    motivo: run.status === "em_andamento" ? "abriram o link, mas não terminaram" : "ninguém abriu o link",
  };
}

// ============================================================
// O que se repete
// ============================================================

/**
 * As três coisas que mais se repetem no período, já em frase:
 *  - a rodada que mais fica sem fazer ("A rodada das 22:00 ficou sem fazer 9 vezes");
 *  - rodadas feitas com atraso;
 *  - a pergunta que mais recebeu "Não".
 * Os alertas da IA são texto livre e quase nunca se repetem palavra por
 * palavra — entram só quando nada acima apareceu.
 */
export function oQueSeRepete(runs: ChecklistRun[], itens: { id: string; pergunta: string; tipo: string }[], hoje: string): string[] {
  const fechadas = runs.filter((r) => avaliarExecucao(r, hoje).situacao !== "aguardando");
  const frases: { texto: string; peso: number }[] = [];

  const puladas = new Map<string, number>();
  let atrasadas = 0;
  for (const run of fechadas) {
    for (const r of rodadasDe(run)) {
      if (!r.concluida_em) puladas.set(r.prevista, (puladas.get(r.prevista) ?? 0) + 1);
      else if (r.minuto_feita !== null && r.minuto_feita - r.minuto > TOLERANCIA_MINUTOS) atrasadas += 1;
    }
  }
  const piorRodada = [...puladas.entries()].sort((a, b) => b[1] - a[1] || minutosDe(a[0]) - minutosDe(b[0]))[0];
  if (piorRodada && piorRodada[1] >= 2) {
    frases.push({ texto: `A rodada das ${piorRodada[0]} ficou sem fazer ${piorRodada[1]} vezes`, peso: piorRodada[1] });
  }
  if (atrasadas >= 2) {
    frases.push({ texto: `${plural(atrasadas, "rodada feita", "rodadas feitas")} com mais de ${TOLERANCIA_MINUTOS} min de atraso`, peso: atrasadas });
  }

  const simNao = new Map(itens.filter((i) => i.tipo === "sim_nao").map((i) => [i.id, i.pergunta]));
  const naos = new Map<string, number>();
  const contarNaos = (respostas: RespostaItem[] | null | undefined) => {
    for (const r of respostas ?? []) {
      if (r.valor === "nao" && simNao.has(r.item)) naos.set(r.item, (naos.get(r.item) ?? 0) + 1);
    }
  };
  for (const run of fechadas) {
    contarNaos(Array.isArray(run.answers) ? (run.answers as unknown as RespostaItem[]) : []);
    for (const r of rodadasDe(run)) contarNaos(r.respostas);
  }
  const maisNao = [...naos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  for (const [item, vezes] of maisNao) {
    if (vezes >= 2) frases.push({ texto: `"${simNao.get(item)}" respondido Não ${vezes} vezes`, peso: vezes });
  }

  if (frases.length === 0) {
    const ultimoAlerta = fechadas
      .slice()
      .sort((a, b) => String(b.scheduled_for).localeCompare(String(a.scheduled_for)))
      .flatMap(alertasDe)[0];
    if (ultimoAlerta) frases.push({ texto: `Último alerta da IA: ${ultimoAlerta}`, peso: 0 });
  }

  return frases.sort((a, b) => b.peso - a.peso).slice(0, 3).map((f) => f.texto);
}

// ============================================================
// O cartão de um checklist
// ============================================================

function contagemVazia(): Record<SituacaoDoDia, number> {
  return { feito: 0, com_problema: 0, nao_feito: 0, aguardando: 0, nao_saiu: 0, folga: 0 };
}

export interface Relogio {
  /** Hoje no dia da casa. */
  hoje: string;
  /** Agora no relógio da casa, "HH:MM". */
  agora: string;
}

/**
 * Um dia do checklist: a execução daquele dia, se houver; senão, se estava
 * na agenda e o checklist já existia, o link não saiu; senão, folga.
 */
function diaDe(
  data: string,
  run: ChecklistRun | undefined,
  agendados: string[],
  criadoEm: string,
  relogio: Relogio,
): DiaDoChecklist {
  if (run) {
    const a = avaliarExecucao(run, relogio.hoje);
    return { data, situacao: a.situacao, run_id: run.id, executores: a.executores, motivo: a.motivo };
  }
  const devia = agendados.includes(diaDaSemana(data)) && data >= criadoEm && data < relogio.hoje;
  return { data, situacao: devia ? "nao_saiu" : "folga", run_id: null, executores: [], motivo: devia ? "o link não saiu" : null };
}

export function resumirChecklist(
  checklist: Checklist,
  runs: ChecklistRun[],
  periodo: { de: string; ate: string },
  relogio: Relogio,
): ResumoDoChecklist {
  const agenda = agendaDe(checklist);
  const criadoEm = String(checklist.created_at).slice(0, 10);
  // Uma execução por dia (o índice único garante); se vier mais de uma, a
  // mais recente vale.
  const porDia = new Map<string, ChecklistRun>();
  for (const r of runs) {
    const data = String(r.scheduled_for).slice(0, 10);
    const ja = porDia.get(data);
    if (!ja || String(r.created_at) > String(ja.created_at)) porDia.set(data, r);
  }

  const dias = diasEntre(periodo.de, periodo.ate).map((d) => diaDe(d, porDia.get(d), agenda.dias, criadoEm, relogio));
  const faixa = diasEntre(somarDias(relogio.hoje, -13), relogio.hoje).map((d) => diaDe(d, porDia.get(d), agenda.dias, criadoEm, relogio));

  const contagem = contagemVazia();
  const porExecutor: Record<string, number> = {};
  for (const d of dias) {
    contagem[d.situacao] += 1;
    if (d.situacao === "feito" || d.situacao === "com_problema") {
      for (const e of d.executores) porExecutor[e] = (porExecutor[e] ?? 0) + 1;
    }
  }
  let feitos = contagem.feito + contagem.com_problema;
  // Hoje ainda aberto não conta contra: o dia não acabou.
  let devidos = feitos + contagem.nao_feito + contagem.nao_saiu;
  const deRodadas = ehDeRodadas(agenda);
  if (deRodadas) {
    const porNoite = rodadasPrevistas(agenda.hora, agenda.ate!, agenda.a_cada_minutos!).length;
    feitos = 0;
    devidos = 0;
    for (const d of dias) {
      if (d.situacao === "aguardando" || d.situacao === "folga") continue;
      const rodadas = d.run_id ? rodadasDe(porDia.get(d.data)!) : [];
      devidos += rodadas.length || porNoite;
      feitos += rodadasFeitas(rodadas).length;
    }
  }

  const runsDoPeriodo = [...porDia.entries()].filter(([d]) => d >= periodo.de && d <= periodo.ate).map(([, r]) => r);
  const ultimo = [...porDia.values()]
    .filter((r) => {
      const s = avaliarExecucao(r, relogio.hoje).situacao;
      return s === "feito" || s === "com_problema";
    })
    .sort((a, b) => String(b.scheduled_for).localeCompare(String(a.scheduled_for)))[0];

  const runDeHoje = porDia.get(relogio.hoje);
  const agendadoHoje = agenda.dias.includes(diaDaSemana(relogio.hoje));
  let hoje: HojeDoChecklist | null = null;
  if (runDeHoje || (agendadoHoje && checklist.active)) {
    const a = runDeHoje ? avaliarExecucao(runDeHoje, relogio.hoje) : null;
    const rodadas = runDeHoje ? rodadasDe(runDeHoje) : [];
    const agoraMin = minutosDe(relogio.agora);
    const prazo = minutosDe(agenda.hora) + (ehDeRodadas(agenda) ? 0 : 60);
    const feitasHoje = rodadasFeitas(rodadas).length;
    // Rodada pulada hoje: a hora dela (mais a tolerância) já passou e
    // ninguém fez. Com a janela virando a noite, conta só o que é de hoje.
    const puladasHoje = rodadas.filter((r) => !r.concluida_em && minutosDe(agenda.hora) + r.minuto + TOLERANCIA_MINUTOS < agoraMin).length;
    hoje = {
      situacao: a?.situacao ?? "aguardando",
      run_id: runDeHoje?.id ?? null,
      hora: agenda.hora,
      atrasado:
        (a?.situacao ?? "aguardando") === "aguardando" &&
        (rodadas.length > 0 ? puladasHoje > 0 : agoraMin > prazo),
      executor: a?.executores[0] ?? null,
      concluido_em: runDeHoje?.completed_at ?? null,
      rodadas: rodadas.length > 0 ? { feitas: feitasHoje, previstas: rodadas.length, puladas: puladasHoje } : null,
    };
  }

  const fechadasNoPeriodo = runsDoPeriodo.filter((r) => avaliarExecucao(r, relogio.hoje).situacao !== "aguardando");
  const nenhumaFeita = fechadasNoPeriodo.length > 0 && fechadasNoPeriodo.every((r) => avaliarExecucao(r, relogio.hoje).situacao === "nao_feito");

  return {
    id: checklist.id,
    nome: checklist.name,
    ativo: checklist.active,
    responsavel: agenda.responsavel_nome,
    agenda: agendaEmTexto(checklist),
    de_rodadas: deRodadas,
    dias,
    faixa,
    cumprimento: { feitos, devidos, percentual: devidos > 0 ? Math.floor((feitos / devidos) * 100) : null, unidade: deRodadas ? "rodadas" : "dias" },
    contagem,
    ultimo_feito: ultimo
      ? {
          data: String(ultimo.scheduled_for).slice(0, 10),
          executor: avaliarExecucao(ultimo, relogio.hoje).executores[0] ?? null,
          concluido_em: ultimo.completed_at,
        }
      : null,
    hoje,
    repeticoes: oQueSeRepete(runsDoPeriodo, Array.isArray(checklist.items) ? (checklist.items as unknown as { id: string; pergunta: string; tipo: string }[]) : [], relogio.hoje),
    nunca_feito: nenhumaFeita
      ? { links: fechadasNoPeriodo.length, abertos: fechadasNoPeriodo.filter((r) => r.status === "em_andamento").length }
      : null,
    por_executor: porExecutor,
  };
}

/**
 * Período pedido pela tela, conferido. Sem nada, os últimos 30 dias; nunca
 * mais que um ano, nunca depois de hoje.
 */
export function periodoPedido(de: string | null, ate: string | null, hoje: string): { de: string; ate: string } {
  const valida = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null);
  let fim = valida(ate) ?? hoje;
  if (fim > hoje) fim = hoje;
  let inicio = valida(de) ?? somarDias(fim, -29);
  if (inicio > fim) inicio = fim;
  if (inicio < somarDias(fim, -366)) inicio = somarDias(fim, -366);
  return { de: inicio, ate: fim };
}

// ============================================================
// Banco
// ============================================================

const PAGINA = 1000;

async function execucoesEntre(venueId: string, de: string, ate: string, checklistId?: string): Promise<ChecklistRun[]> {
  const todas: ChecklistRun[] = [];
  for (let pagina = 0; pagina < 20; pagina += 1) {
    let consulta = db()
      .from("checklist_runs")
      .select("*")
      .eq("venue_id", venueId)
      .gte("scheduled_for", de)
      .lte("scheduled_for", ate)
      .order("scheduled_for", { ascending: true })
      .order("id", { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (checklistId) consulta = consulta.eq("checklist_id", checklistId);
    const { data, error } = await consulta;
    if (error) throw new Error(`Falha ao ler os checklists feitos: ${error.message}`);
    todas.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) break;
  }
  return todas;
}

export async function painelDosChecklists(params: {
  venue: { id: string; timezone: string };
  checklists: Checklist[];
  de: string | null;
  ate: string | null;
  checklistId?: string | null;
  agora?: Date;
}): Promise<PainelDosChecklists> {
  const local = agoraLocal(params.agora ?? new Date(), params.venue.timezone);
  const relogio: Relogio = { hoje: local.data, agora: local.hhmm };
  const periodo = periodoPedido(params.de, params.ate, relogio.hoje);
  const inicioDaLeitura = [periodo.de, somarDias(relogio.hoje, -13)].sort()[0]!;
  const modelos = params.checklistId ? params.checklists.filter((c) => c.id === params.checklistId) : params.checklists;

  // A última vez que foi feito pode ser antes do período — busca 90 dias
  // para trás só para isso não sumir num mês ruim.
  const runs = await execucoesEntre(params.venue.id, [inicioDaLeitura, somarDias(relogio.hoje, -90)].sort()[0]!, relogio.hoje, params.checklistId ?? undefined);
  const porChecklist = new Map<string, ChecklistRun[]>();
  for (const r of runs) {
    const lista = porChecklist.get(r.checklist_id) ?? [];
    lista.push(r);
    porChecklist.set(r.checklist_id, lista);
  }

  const checklists = modelos
    .map((c) => resumirChecklist(c, porChecklist.get(c.id) ?? [], periodo, relogio))
    // Desativado e sem nada no período não ocupa lugar na tela.
    .filter((r) => r.ativo || r.dias.some((d) => d.run_id));

  const executores = [...new Set(checklists.flatMap((c) => Object.keys(c.por_executor)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { hoje: relogio.hoje, agora: relogio.agora, de: periodo.de, ate: periodo.ate, checklists, executores };
}

/**
 * Os nomes que aparecem para escolher no link do checklist: o responsável
 * cadastrado, quem já preencheu nos últimos 60 dias (do mais frequente para
 * o menos) e a equipe ativa. Quem limpa o banheiro nem sempre está no
 * cadastro da equipe — mas já preencheu antes, e é o nome que vai escolher.
 */
export function nomesParaEscolher(params: {
  responsavel: string | null;
  jaPreencheram: (string | null)[];
  equipe: { nome: string; apelido: string | null }[];
}): string[] {
  const vistos = new Map<string, string>();
  const juntar = (bruto: string | null) => {
    const nome = nomeDeQuemFez(bruto);
    if (!nome) return;
    const chave = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (!vistos.has(chave)) vistos.set(chave, nome);
  };
  juntar(params.responsavel);
  const frequencia = new Map<string, number>();
  for (const n of params.jaPreencheram) {
    const nome = nomeDeQuemFez(n);
    if (nome) frequencia.set(nome, (frequencia.get(nome) ?? 0) + 1);
  }
  for (const [nome] of [...frequencia.entries()].sort((a, b) => b[1] - a[1])) juntar(nome);
  for (const p of [...params.equipe].sort((a, b) => (a.apelido || a.nome).localeCompare(b.apelido || b.nome, "pt-BR"))) {
    juntar(p.apelido || p.nome);
  }
  return [...vistos.values()].slice(0, 40);
}

export async function nomesDaEquipeParaChecklist(venueId: string, checklist: Checklist): Promise<string[]> {
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  // As tabelas da equipe não estão nos tipos gerados (como em pesquisa.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const semTipo = () => db() as any;
  const [equipe, desligados, runs] = await Promise.all([
    semTipo().from("pesquisa_atendentes").select("id, nome, apelido").eq("venue_id", venueId).eq("ativo", true) as Promise<{ data: { id: string; nome: string; apelido: string | null }[] | null }>,
    semTipo().from("rh_fichas").select("atendente_id").eq("venue_id", venueId).not("desligamento", "is", null) as Promise<{ data: { atendente_id: string }[] | null }>,
    db().from("checklist_runs").select("executor_nome, rodadas").eq("venue_id", venueId).gte("scheduled_for", desde).limit(500),
  ]);
  const fora = new Set((desligados.data ?? []).map((d) => d.atendente_id));
  const jaPreencheram: (string | null)[] = [];
  for (const r of runs.data ?? []) {
    jaPreencheram.push(r.executor_nome);
    for (const rod of Array.isArray(r.rodadas) ? (r.rodadas as unknown as Rodada[]) : []) jaPreencheram.push(rod.executor_nome);
  }
  return nomesParaEscolher({
    responsavel: agendaDe(checklist).responsavel_nome || null,
    jaPreencheram,
    equipe: (equipe.data ?? []).filter((p) => !fora.has(p.id)),
  });
}
