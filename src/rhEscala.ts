import { db, ehMigracaoPendente } from "./supabase.js";
import { inserirAvisos, normalizarTelefone } from "./notifications.js";
import { ErroDoRh } from "./rh.js";
import type { Venue } from "./venues.js";

/**
 * RH — Fase 2: a escala da semana.
 *
 * A escala de bar vive num grupo de WhatsApp e num papel na cozinha. Todo mês
 * a mesma cena: alguém jura que não estava escalado, a troca combinada na
 * quinta sumiu até sábado, e ninguém sabe qual foto do grupo é a versão boa.
 *
 * Aqui a grade é a versão boa, e publicar é o ato que manda para cada um o
 * horário DELE — não a foto da grade inteira. A mensagem sai pela mesma fila
 * de avisos que já entrega lembrete de reserva, pelo número administrativo da
 * casa (nunca pelo número do agente de IA).
 *
 * Rascunho x publicado: enquanto não publica, o gestor mexe à vontade e
 * ninguém é incomodado. É o que permite montar a semana aos poucos.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

function falhar(status: number, contexto: string, mensagem: string): never {
  if (ehMigracaoPendente(mensagem)) {
    throw new ErroDoRh(
      503,
      `${contexto}: o banco ainda não recebeu a migração da escala. Rode o SQL e tente de novo.`,
    );
  }
  throw new ErroDoRh(status, `${contexto}: ${mensagem}`);
}

export const SITUACOES = [
  { id: "trabalha", nome: "Trabalha" },
  { id: "folga", nome: "Folga" },
  { id: "ferias", nome: "Férias" },
  { id: "atestado", nome: "Atestado" },
  { id: "falta", nome: "Falta" },
] as const;

const IDS_DE_SITUACAO = new Set<string>(SITUACOES.map((s) => s.id));

/** Como cada situação aparece na mensagem do WhatsApp. */
const ROTULO_DA_SITUACAO: Record<string, string> = {
  folga: "Folga",
  ferias: "Férias",
  atestado: "Atestado",
  falta: "Falta",
};

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export interface Turno {
  id: string;
  nome: string;
  inicio: string;
  fim: string;
  ordem: number;
  ativo: boolean;
}

export interface LinhaDaEscala {
  id: string;
  data: string;
  atendente_id: string;
  turno_id: string | null;
  situacao: string;
  funcao: string | null;
  observacao: string | null;
}

// ============================================================
// Contas de calendário — sem banco, sem fuso, testáveis
// ============================================================

/** O dia da semana (0 = domingo) de uma data ISO, sem passar pelo fuso local. */
function diaDaSemana(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * A segunda-feira da semana que contém esta data.
 *
 * Toda a Fase 2 gira em torno disto: a grade, a publicação e a cópia da
 * semana anterior usam a segunda como nome da semana. Domingo pertence à
 * semana que começou na segunda anterior — que é como a casa fala ("a semana
 * do dia 15"), e não como o JavaScript conta (domingo = 0).
 */
export function segundaDaSemana(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new ErroDoRh(400, "Data da semana inválida.");
  }
  const dow = diaDaSemana(iso);
  const recuo = dow === 0 ? 6 : dow - 1;
  return somarDias(iso, -recuo);
}

export function diasDaSemana(segunda: string): string[] {
  return Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
}

/** "18:00:00" vira "18h"; "18:30:00" vira "18h30". */
export function horaCurta(hora: string): string {
  const [h, m] = String(hora ?? "").split(":");
  const hh = Number(h);
  if (!Number.isFinite(hh)) return String(hora ?? "");
  return m && m !== "00" ? `${hh}h${m}` : `${hh}h`;
}

/** O turno atravessa a meia-noite? Em bar é o normal, não a exceção. */
export function viraODia(turno: { inicio: string; fim: string }): boolean {
  return turno.fim < turno.inicio;
}

/** "Noite · 18h → 2h (vira o dia)" */
export function descreverTurno(turno: { nome: string; inicio: string; fim: string }): string {
  const faixa = `${horaCurta(turno.inicio)} → ${horaCurta(turno.fim)}`;
  return `${turno.nome} · ${faixa}${viraODia(turno) ? " (vira o dia)" : ""}`;
}

/** "seg 15/09" */
export function diaCurto(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${DIAS_CURTOS[diaDaSemana(iso)]} ${dia}/${mes}`;
}

/**
 * A mensagem que cada pessoa recebe no WhatsApp.
 *
 * Só os dias que estão na escala dela. Uma semana inteira com quatro linhas
 * de "sem escala" é mensagem que ninguém lê até o fim — e a última linha
 * explica o silêncio, para ninguém supor folga onde só falta lançamento.
 */
export function mensagemDaSemana(params: {
  nome: string;
  casa: string;
  segunda: string;
  linhas: LinhaDaEscala[];
  turnos: Turno[];
}): string {
  const porId = new Map(params.turnos.map((t) => [t.id, t]));
  const domingo = somarDias(params.segunda, 6);

  const ordenadas = [...params.linhas].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const corpo = ordenadas.map((linha) => {
    const turno = linha.turno_id ? porId.get(linha.turno_id) : null;
    if (linha.situacao !== "trabalha" || !turno) {
      return `${diaCurto(linha.data)} · ${ROTULO_DA_SITUACAO[linha.situacao] ?? "Sem turno"}`;
    }
    const extra = linha.funcao ? ` (${linha.funcao})` : "";
    return `${diaCurto(linha.data)} · ${turno.nome} ${horaCurta(turno.inicio)} → ${horaCurta(turno.fim)}${extra}`;
  });

  const partes = [
    `Olá, ${params.nome}! Sua escala de ${diaCurto(params.segunda)} a ${diaCurto(domingo)} — ${params.casa}:`,
    "",
    ...(corpo.length ? corpo : ["Nenhum turno lançado para você nesta semana."]),
    "",
    "Dias que não aparecem aqui não estão na sua escala. Qualquer troca, fale com a gerência.",
  ];
  return partes.join("\n");
}

// ============================================================
// Alertas de descanso — conta pura, sem banco
// ============================================================
//
// A grade aceita qualquer coisa: sete dias seguidos, fechar às 2h e abrir às
// 9h, o menor de idade no fechamento. Quem monta a escala com pressa não faz
// essa conta de cabeça — e é exatamente o que aparece numa fiscalização ou
// numa ação trabalhista.
//
// Isto AVISA, não proíbe e não é parecer jurídico: convenção coletiva,
// escala 12x36, banco de horas e compensação mudam a regra de cada casa. O
// gestor vê a lista antes de publicar e publica se quiser — a frase diz o
// que olhar e manda conferir com a contabilidade.

/** Um turno de trabalho de uma pessoa: o dia em que começa e os horários. */
export interface TurnoEscalado {
  data: string;
  inicio: string;
  fim: string;
}

export interface AlertaDeDescanso {
  tipo: "setimo_dia" | "entre_jornadas" | "horas_da_semana" | "menor_a_noite";
  texto: string;
}

/** Os números de referência (CLT e Constituição). Num lugar só, para a contabilidade conferir. */
export const LIMITES_DE_DESCANSO = {
  /** Dias seguidos de trabalho a partir dos quais falta a folga semanal. */
  dias_seguidos: 7,
  /** Horas de descanso entre o fim de uma jornada e o começo da outra. */
  horas_entre_jornadas: 11,
  /** Horas de trabalho na semana. */
  horas_na_semana: 44,
  /** Turno de mais de tantas horas tem 1h de intervalo, que não conta como trabalho. */
  horas_que_pedem_intervalo: 6,
  /** Menor de 18 não trabalha entre estas horas. */
  noite_do_menor: { de: 22, ate: 5 },
} as const;

const minutosDe = (hora: string): number => {
  const [h, m] = String(hora ?? "").split(":");
  return Number(h) * 60 + (Number(m) || 0);
};

/** Dias desde 1970 — é o que permite comparar instantes sem tocar em fuso. */
const diaCorrido = (iso: string): number => Math.round(new Date(`${iso}T12:00:00Z`).getTime() / 86_400_000);

/** "9h" ou "9h30", de uma quantidade de minutos. */
function horasEmTexto(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** Idade completa num dia. `null` se a data de nascimento não serve. */
function idadeEm(nascimento: string | null | undefined, dia: string): number | null {
  const n = String(nascimento ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n)) return null;
  const anos = Number(dia.slice(0, 4)) - Number(n.slice(0, 4));
  return dia.slice(5) < n.slice(5) ? anos - 1 : anos;
}

/**
 * O que a escala de UMA pessoa tem de estranho nesta semana.
 *
 * Recebe os turnos da semana E dos dias vizinhos que a casa já lançou (na
 * prática, a semana anterior): o sétimo dia seguido e o descanso curto
 * quase sempre atravessam a virada da semana. Dia sem lançamento conta
 * como folga — só dá para avisar do que está na grade.
 *
 * Só fala do que CAI nesta semana, para a mesma frase não aparecer em duas.
 */
export function alertasDeDescanso(params: {
  nome: string;
  /** A segunda-feira da semana que está na tela. */
  semana: string;
  turnos: TurnoEscalado[];
  /** Da ficha, se tiver. Sem ela, o aviso do menor simplesmente não sai. */
  nascimento?: string | null;
}): AlertaDeDescanso[] {
  const L = LIMITES_DE_DESCANSO;
  const { nome, semana } = params;
  const domingo = somarDias(semana, 6);
  const naSemana = (dia: string) => dia >= semana && dia <= domingo;

  // Cada turno vira um intervalo em minutos corridos; o que vira a noite
  // termina no dia seguinte. Turno com horário ilegível fica de fora.
  const turnos = params.turnos
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.data) && /^\d{1,2}:\d{2}/.test(t.inicio) && /^\d{1,2}:\d{2}/.test(t.fim))
    .map((t) => {
      const base = diaCorrido(t.data) * 1440;
      const comeca = base + minutosDe(t.inicio);
      const termina = base + minutosDe(t.fim) + (viraODia(t) ? 1440 : 0);
      return { ...t, comeca, termina };
    })
    .sort((a, b) => a.comeca - b.comeca);
  if (!turnos.length) return [];

  // A JORNADA do dia: do primeiro turno que começa nele ao último que
  // termina. Quem dobra almoço e noite tem uma jornada só — as horas entre
  // um turno e outro são intervalo, não o descanso entre jornadas.
  const jornadas = new Map<string, { data: string; comeca: number; termina: number; fim: string; inicio: string }>();
  for (const t of turnos) {
    const j = jornadas.get(t.data);
    if (!j) jornadas.set(t.data, { data: t.data, comeca: t.comeca, termina: t.termina, inicio: t.inicio, fim: t.fim });
    else if (t.termina > j.termina) Object.assign(j, { termina: t.termina, fim: t.fim });
  }
  const dias = [...jornadas.values()].sort((a, b) => a.comeca - b.comeca);
  const alertas: AlertaDeDescanso[] = [];

  // ---- 7º dia seguido ----
  // Uma frase por sequência, no primeiro dia que estoura dentro da semana.
  let seguidos = 0;
  let primeiro = "";
  let avisouDestaSequencia = false;
  dias.forEach((d, i) => {
    const emenda = i > 0 && diaCorrido(d.data) - diaCorrido(dias[i - 1]!.data) === 1;
    if (!emenda) {
      seguidos = 0;
      primeiro = d.data;
      avisouDestaSequencia = false;
    }
    seguidos += 1;
    if (seguidos >= L.dias_seguidos && naSemana(d.data) && !avisouDestaSequencia) {
      avisouDestaSequencia = true;
      alertas.push({
        tipo: "setimo_dia",
        texto:
          `${nome} chega ao ${seguidos}º dia seguido de trabalho em ${diaCurto(d.data)} (sem folga desde ${diaCurto(primeiro)}). ` +
          `Toda semana precisa de uma folga de 24h: dê uma folga antes desse dia.`,
      });
    }
  });

  // ---- Menos de 11h entre uma jornada e a outra ----
  for (let i = 1; i < dias.length; i += 1) {
    const antes = dias[i - 1]!;
    const depois = dias[i]!;
    const descanso = depois.comeca - antes.termina;
    if (descanso >= L.horas_entre_jornadas * 60) continue;
    if (!naSemana(depois.data)) continue;
    alertas.push({
      tipo: "entre_jornadas",
      texto:
        descanso > 0
          ? `${nome} sai às ${horaCurta(antes.fim)} do turno de ${diaCurto(antes.data)} e volta às ${horaCurta(depois.inicio)} de ${diaCurto(depois.data)}: ` +
            `só ${horasEmTexto(descanso)} de descanso. O mínimo entre um dia de trabalho e o outro é ${L.horas_entre_jornadas}h.`
          : `${nome} começa às ${horaCurta(depois.inicio)} de ${diaCurto(depois.data)} sem ter saído do turno de ${diaCurto(antes.data)} (que vai até ${horaCurta(antes.fim)}): ` +
            `os horários se atropelam. O mínimo entre um dia de trabalho e o outro é ${L.horas_entre_jornadas}h de descanso.`,
    });
  }

  // ---- Mais de 44h na semana ----
  // Conta o turno pelo dia em que COMEÇA (o de domingo que acaba na segunda
  // é desta semana) e tira 1h de intervalo dos turnos de mais de 6h — sem
  // isso, a semana comum de seis noites de 8h daria alarme falso toda vez.
  const minutosDaSemana = turnos
    .filter((t) => naSemana(t.data))
    .reduce((soma, t) => {
      const duracao = t.termina - t.comeca;
      return soma + (duracao > L.horas_que_pedem_intervalo * 60 ? duracao - 60 : duracao);
    }, 0);
  if (minutosDaSemana > L.horas_na_semana * 60) {
    alertas.push({
      tipo: "horas_da_semana",
      texto:
        `${nome} está com ${horasEmTexto(minutosDaSemana)} na semana (já tirando 1h de intervalo dos turnos longos). ` +
        `Acima de ${L.horas_na_semana}h é hora extra: tire um turno ou confira com a contabilidade.`,
    });
  }

  // ---- Menor de 18 depois das 22h ----
  // Uma frase por dia. A noite proibida vai das 22h às 5h, e pega tanto o
  // turno que entra nela quanto o que já começa de madrugada.
  const noite = L.noite_do_menor;
  const avisados = new Set<string>();
  for (const t of turnos) {
    if (!naSemana(t.data) || avisados.has(t.data)) continue;
    const idade = idadeEm(params.nascimento, t.data);
    if (idade === null || idade >= 18) continue;
    const base = diaCorrido(t.data) * 1440;
    const pegaANoite = t.termina > base + noite.de * 60 || t.comeca < base + noite.ate * 60;
    if (!pegaANoite) continue;
    avisados.add(t.data);
    alertas.push({
      tipo: "menor_a_noite",
      texto:
        `${nome} tem ${idade} anos e está no turno de ${diaCurto(t.data)} (${horaCurta(t.inicio)} → ${horaCurta(t.fim)}). ` +
        `Menor de 18 não pode trabalhar entre ${noite.de}h e ${noite.ate}h: troque o turno.`,
    });
  }

  return alertas;
}

// ============================================================
// Turnos da casa
// ============================================================

export async function listarTurnos(venueId: string, { incluirInativos = false } = {}): Promise<Turno[]> {
  let consulta = cliente()
    .from("rh_turnos")
    .select("id, nome, inicio, fim, ordem, ativo")
    .eq("venue_id", venueId)
    .order("ordem", { ascending: true })
    .order("inicio", { ascending: true });
  if (!incluirInativos) consulta = consulta.eq("ativo", true);

  const { data, error } = await consulta;
  if (error) falhar(500, "Falha ao listar os turnos", error.message);
  return (data ?? []) as Turno[];
}

function horaValida(valor: unknown, campo: string): string {
  const texto = String(valor ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(texto)) {
    throw new ErroDoRh(400, `${campo}: informe a hora no formato 18:00.`);
  }
  return texto.length === 5 ? `${texto}:00` : texto;
}

export async function criarTurno(params: {
  venueId: string;
  nome: string;
  inicio: unknown;
  fim: unknown;
  ordem?: unknown;
}): Promise<Turno> {
  const nome = String(params.nome ?? "").trim();
  if (!nome) throw new ErroDoRh(400, "O turno precisa de um nome.");

  const { data, error } = await cliente()
    .from("rh_turnos")
    .insert({
      venue_id: params.venueId,
      nome,
      inicio: horaValida(params.inicio, "Início"),
      fim: horaValida(params.fim, "Fim"),
      ordem: Number(params.ordem) || 0,
    } as never)
    .select("id, nome, inicio, fim, ordem, ativo")
    .single();

  if (error) {
    if (/duplicate key|unique/i.test(error.message)) {
      throw new ErroDoRh(409, `Já existe um turno chamado "${nome}".`);
    }
    falhar(500, "Falha ao criar o turno", error.message);
  }
  return data as Turno;
}

export async function atualizarTurno(params: {
  venueId: string;
  id: string;
  nome?: unknown;
  inicio?: unknown;
  fim?: unknown;
  ordem?: unknown;
  ativo?: unknown;
}): Promise<Turno> {
  const mudancas: Record<string, unknown> = {};
  if (params.nome !== undefined) {
    const nome = String(params.nome).trim();
    if (!nome) throw new ErroDoRh(400, "O nome do turno não pode ficar vazio.");
    mudancas.nome = nome;
  }
  if (params.inicio !== undefined) mudancas.inicio = horaValida(params.inicio, "Início");
  if (params.fim !== undefined) mudancas.fim = horaValida(params.fim, "Fim");
  if (params.ordem !== undefined) mudancas.ordem = Number(params.ordem) || 0;
  if (params.ativo !== undefined) mudancas.ativo = Boolean(params.ativo);

  const { data, error } = await cliente()
    .from("rh_turnos")
    .update(mudancas as never)
    .eq("venue_id", params.venueId)
    .eq("id", params.id)
    .select("id, nome, inicio, fim, ordem, ativo")
    .maybeSingle();
  if (error) falhar(500, "Falha ao salvar o turno", error.message);
  if (!data) throw new ErroDoRh(404, "Turno não encontrado.");
  return data as Turno;
}

/**
 * Apagar turno leva a escala dele junto (cascade no banco).
 *
 * Por isso a tela desativa em vez de apagar quando já houve escala: o
 * histórico de quem trabalhou vale mais que a lista limpa.
 */
export async function apagarTurno(params: { venueId: string; id: string }): Promise<{ apagado: boolean }> {
  const { count, error: erroConta } = await cliente()
    .from("rh_escala")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", params.venueId)
    .eq("turno_id", params.id);
  if (erroConta) falhar(500, "Falha ao conferir a escala do turno", erroConta.message);

  if ((count ?? 0) > 0) {
    await atualizarTurno({ venueId: params.venueId, id: params.id, ativo: false });
    return { apagado: false };
  }

  const { error } = await cliente()
    .from("rh_turnos")
    .delete()
    .eq("venue_id", params.venueId)
    .eq("id", params.id);
  if (error) falhar(500, "Falha ao apagar o turno", error.message);
  return { apagado: true };
}

// ============================================================
// A grade da semana
// ============================================================

export interface SemanaDaEscala {
  semana: string;
  dias: string[];
  turnos: Turno[];
  pessoas: Array<{ id: string; nome: string; apelido: string | null; funcao: string | null }>;
  linhas: LinhaDaEscala[];
  publicada_em: string | null;
  publicada_por: string | null;
  avisos_enviados: number;
  /** Mudou alguma coisa depois de publicar? A tela avisa para republicar. */
  mudou_depois_de_publicar: boolean;
  /** O que conferir antes de publicar: folga, descanso, horas, menor à noite. */
  alertas: Array<AlertaDeDescanso & { atendente_id: string }>;
}

export async function escalaDaSemana(venueId: string, qualquerDia: string): Promise<SemanaDaEscala> {
  const semana = segundaDaSemana(qualquerDia);
  const dias = diasDaSemana(semana);

  const [turnos, pessoas, linhas, publicacao] = await Promise.all([
    listarTurnos(venueId, { incluirInativos: true }),
    pessoasEscalaveis(venueId),
    linhasDaSemana(venueId, semana),
    publicacaoDaSemana(venueId, semana),
  ]);

  // Os alertas ajudam, mas não seguram a grade: se a conta falhar, a
  // escala abre sem eles (e o servidor anota o porquê).
  const alertas = await alertasDaSemana({ venueId, semana, turnos, pessoas }).catch((e) => {
    console.warn(`[rh] alertas da escala não saíram: ${(e as Error).message}`);
    return [];
  });

  const ultimaMexida = linhas.reduce<string | null>((maior, l) => {
    const q = (l as LinhaDaEscala & { atualizada_em?: string }).atualizada_em ?? null;
    return q && (!maior || q > maior) ? q : maior;
  }, null);

  return {
    semana,
    dias,
    // Turno desativado continua na grade se ainda houver escala nele — some
    // só quando ninguém mais depende dele.
    turnos: turnos.filter((t) => t.ativo || linhas.some((l) => l.turno_id === t.id)),
    pessoas,
    linhas,
    publicada_em: publicacao?.publicada_em ?? null,
    publicada_por: publicacao?.publicada_por ?? null,
    avisos_enviados: publicacao?.avisos_enviados ?? 0,
    mudou_depois_de_publicar: Boolean(
      publicacao?.publicada_em && ultimaMexida && ultimaMexida > publicacao.publicada_em,
    ),
    alertas,
  };
}

/** Quem pode entrar na grade: gente ativa no cadastro da casa. */
async function pessoasEscalaveis(venueId: string) {
  const { data, error } = await cliente()
    .from("pesquisa_atendentes")
    .select("id, nome, apelido, funcao")
    .eq("venue_id", venueId)
    .eq("ativo", true)
    .order("nome", { ascending: true });
  if (error) falhar(500, "Falha ao listar a equipe", error.message);
  return (data ?? []) as Array<{ id: string; nome: string; apelido: string | null; funcao: string | null }>;
}

/**
 * Os alertas de descanso de todo mundo que está na grade desta semana.
 *
 * Busca também a semana anterior — o que a casa já lançou — porque é na
 * virada que o sétimo dia e o descanso curto se escondem. A data de nascimento vem da ficha só para o aviso do menor.
 */
async function alertasDaSemana(params: {
  venueId: string;
  semana: string;
  turnos: Turno[];
  pessoas: Array<{ id: string; nome: string; apelido: string | null }>;
}): Promise<Array<AlertaDeDescanso & { atendente_id: string }>> {
  const [{ data: linhas, error }, { data: fichas }] = await Promise.all([
    cliente()
      .from("rh_escala")
      .select("data, atendente_id, turno_id, situacao")
      .eq("venue_id", params.venueId)
      .eq("situacao", "trabalha")
      .gte("data", somarDias(params.semana, -7))
      .lte("data", somarDias(params.semana, 6)),
    cliente().from("rh_fichas").select("atendente_id, nascimento").eq("venue_id", params.venueId),
  ]);
  if (error) throw new Error(error.message);

  const turnoDe = new Map(params.turnos.map((t) => [t.id, t]));
  const nascimentoDe = new Map(
    ((fichas ?? []) as Array<{ atendente_id: string; nascimento: string | null }>).map((f) => [f.atendente_id, f.nascimento]),
  );
  const porPessoa = new Map<string, TurnoEscalado[]>();
  for (const l of (linhas ?? []) as Array<{ data: string; atendente_id: string; turno_id: string | null }>) {
    const turno = l.turno_id ? turnoDe.get(l.turno_id) : null;
    if (!turno) continue;
    const lista = porPessoa.get(l.atendente_id) ?? [];
    lista.push({ data: l.data, inicio: turno.inicio, fim: turno.fim });
    porPessoa.set(l.atendente_id, lista);
  }

  // Na ordem da grade (por nome), para a lista bater com o que está na tela.
  return params.pessoas.flatMap((p) =>
    alertasDeDescanso({
      nome: p.apelido || p.nome,
      semana: params.semana,
      turnos: porPessoa.get(p.id) ?? [],
      nascimento: nascimentoDe.get(p.id),
    }).map((a) => ({ atendente_id: p.id, ...a })),
  );
}

async function linhasDaSemana(venueId: string, semana: string): Promise<LinhaDaEscala[]> {
  const { data, error } = await cliente()
    .from("rh_escala")
    .select("id, data, atendente_id, turno_id, situacao, funcao, observacao, atualizada_em")
    .eq("venue_id", venueId)
    .gte("data", semana)
    .lte("data", somarDias(semana, 6));
  if (error) falhar(500, "Falha ao ler a escala", error.message);
  return (data ?? []) as LinhaDaEscala[];
}

async function publicacaoDaSemana(venueId: string, semana: string) {
  const { data, error } = await cliente()
    .from("rh_semanas")
    .select("publicada_em, publicada_por, avisos_enviados")
    .eq("venue_id", venueId)
    .eq("semana", semana)
    .maybeSingle();
  if (error) falhar(500, "Falha ao ler a publicação da semana", error.message);
  return (data ?? null) as { publicada_em: string; publicada_por: string | null; avisos_enviados: number } | null;
}

function dataValida(valor: unknown): string {
  const texto = String(valor ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) throw new ErroDoRh(400, "Data inválida na escala.");
  return texto;
}

/**
 * Põe alguém na grade — ou muda o que já estava lá.
 *
 * Um clique na célula chama isto. Situação diferente de "trabalha" zera o
 * turno no próprio banco (trigger), então "folga das 18h" não existe.
 */
export async function marcarNaEscala(params: {
  venueId: string;
  data: unknown;
  atendenteId: string;
  turnoId?: string | null;
  situacao?: unknown;
  funcao?: unknown;
  observacao?: unknown;
}): Promise<LinhaDaEscala> {
  const data = dataValida(params.data);
  const situacao = String(params.situacao ?? "trabalha");
  if (!IDS_DE_SITUACAO.has(situacao)) throw new ErroDoRh(400, "Situação desconhecida na escala.");

  const turnoId = situacao === "trabalha" ? (params.turnoId ?? null) : null;
  if (situacao === "trabalha" && !turnoId) {
    throw new ErroDoRh(400, "Escolha o turno de quem vai trabalhar.");
  }

  const linha = {
    venue_id: params.venueId,
    data,
    atendente_id: params.atendenteId,
    turno_id: turnoId,
    situacao,
    funcao: String(params.funcao ?? "").trim() || null,
    observacao: String(params.observacao ?? "").trim() || null,
  };

  // Sempre as quatro colunas, com turno ou sem: o índice é único e usa
  // `nulls not distinct`, então duas folgas no mesmo dia colidem como duas
  // linhas do mesmo turno colidiriam. Mirar em três colunas quando o turno é
  // nulo devolveria "no unique or exclusion constraint matching".
  const { data: gravada, error } = await cliente()
    .from("rh_escala")
    .upsert(linha as never, { onConflict: "venue_id,data,atendente_id,turno_id" })
    .select("id, data, atendente_id, turno_id, situacao, funcao, observacao")
    .single();

  if (error) falhar(500, "Falha ao salvar a escala", error.message);
  return gravada as LinhaDaEscala;
}

export async function tirarDaEscala(params: { venueId: string; id: string }): Promise<{ apagado: boolean }> {
  const { error } = await cliente()
    .from("rh_escala")
    .delete()
    .eq("venue_id", params.venueId)
    .eq("id", params.id);
  if (error) falhar(500, "Falha ao tirar da escala", error.message);
  return { apagado: true };
}

/**
 * Copia a semana anterior para a de agora.
 *
 * É o que faz a escala levar minutos: em bar a semana repete quase igual, e
 * o gestor só ajusta as exceções. Não sobrescreve o que já foi lançado na
 * semana destino — quem já mexeu lá tinha um motivo.
 */
export async function copiarSemana(params: {
  venueId: string;
  de: string;
  para: string;
}): Promise<{ copiadas: number; ignoradas: number }> {
  const origem = segundaDaSemana(dataValida(params.de));
  const destino = segundaDaSemana(dataValida(params.para));
  if (origem === destino) throw new ErroDoRh(400, "Escolha uma semana diferente para copiar.");

  const [linhasOrigem, linhasDestino] = await Promise.all([
    linhasDaSemana(params.venueId, origem),
    linhasDaSemana(params.venueId, destino),
  ]);
  if (linhasOrigem.length === 0) throw new ErroDoRh(404, "A semana escolhida não tem escala para copiar.");

  const deslocamento = Math.round(
    (new Date(`${destino}T12:00:00Z`).getTime() - new Date(`${origem}T12:00:00Z`).getTime()) / 86_400_000,
  );

  const jaTem = new Set(linhasDestino.map((l) => `${l.data}|${l.atendente_id}|${l.turno_id ?? "-"}`));
  const novas = linhasOrigem
    .map((l) => ({
      venue_id: params.venueId,
      data: somarDias(l.data, deslocamento),
      atendente_id: l.atendente_id,
      turno_id: l.turno_id,
      situacao: l.situacao,
      funcao: l.funcao,
      observacao: l.observacao,
    }))
    .filter((l) => !jaTem.has(`${l.data}|${l.atendente_id}|${l.turno_id ?? "-"}`));

  if (novas.length === 0) return { copiadas: 0, ignoradas: linhasOrigem.length };

  const { error } = await cliente().from("rh_escala").insert(novas as never);
  if (error) falhar(500, "Falha ao copiar a semana", error.message);
  return { copiadas: novas.length, ignoradas: linhasOrigem.length - novas.length };
}

// ============================================================
// Publicar: a semana vira mensagem no WhatsApp de cada um
// ============================================================

export interface ResultadoDaPublicacao {
  semana: string;
  avisados: number;
  sem_telefone: string[];
  sem_escala: number;
  /** Quantos alertas de descanso a semana tinha ao publicar. Não impede: informa. */
  alertas: number;
}

export async function publicarSemana(params: {
  venue: Venue;
  semana: string;
  quem?: string | null;
}): Promise<ResultadoDaPublicacao> {
  const semana = segundaDaSemana(dataValida(params.semana));
  const [turnos, linhas, pessoas] = await Promise.all([
    listarTurnos(params.venue.id, { incluirInativos: true }),
    linhasDaSemana(params.venue.id, semana),
    pessoasEscalaveis(params.venue.id),
  ]);

  if (linhas.length === 0) {
    throw new ErroDoRh(400, "Esta semana ainda não tem ninguém escalado.");
  }

  // O telefone mora na ficha do RH (Fase 1). Quem ainda não tem ficha não
  // recebe — e a tela diz quem são, em vez de fingir que todos foram avisados.
  const { data: fichas, error } = await cliente()
    .from("rh_fichas")
    .select("atendente_id, telefone")
    .eq("venue_id", params.venue.id);
  if (error) falhar(500, "Falha ao ler os telefones da equipe", error.message);

  const telefoneDe = new Map(
    ((fichas ?? []) as Array<{ atendente_id: string; telefone: string | null }>).map((f) => [f.atendente_id, f.telefone]),
  );
  const nomeDe = new Map(pessoas.map((p) => [p.id, p.apelido || p.nome]));

  const porPessoa = new Map<string, LinhaDaEscala[]>();
  for (const linha of linhas) {
    const lista = porPessoa.get(linha.atendente_id) ?? [];
    lista.push(linha);
    porPessoa.set(linha.atendente_id, lista);
  }

  const avisos: Record<string, unknown>[] = [];
  const semTelefone: string[] = [];

  for (const [atendenteId, minhas] of porPessoa) {
    const nome = nomeDe.get(atendenteId);
    // Escala de quem saiu do cadastro no meio da semana: fica na grade como
    // histórico, mas não vira mensagem.
    if (!nome) continue;

    const destino = normalizarTelefone(telefoneDe.get(atendenteId) ?? "");
    if (!destino) {
      semTelefone.push(nome);
      continue;
    }

    avisos.push({
      venue_id: params.venue.id,
      channel: "whatsapp",
      destination: destino,
      template: "rh_escala_semana",
      // Sai pelo número administrativo da casa, nunca pelo do agente de IA:
      // escala é recado da gerência, e resposta vai para uma pessoa.
      papel: "administrativo",
      body: mensagemDaSemana({
        nome,
        casa: params.venue.name,
        segunda: semana,
        linhas: minhas,
        turnos,
      }),
    });
  }

  if (avisos.length > 0) {
    const { error: erroAviso } = await inserirAvisos(avisos);
    if (erroAviso) falhar(500, "Falha ao enfileirar os avisos da escala", erroAviso.message);
  }

  const { error: erroSemana } = await cliente()
    .from("rh_semanas")
    .upsert(
      {
        venue_id: params.venue.id,
        semana,
        publicada_em: new Date().toISOString(),
        publicada_por: params.quem ?? null,
        avisos_enviados: avisos.length,
      } as never,
      { onConflict: "venue_id,semana" },
    );
  if (erroSemana) falhar(500, "Falha ao registrar a publicação", erroSemana.message);

  // Publicar com alerta é decisão do gestor (ele viu a lista na tela); a
  // resposta só repete quantos eram, para a confirmação não esconder nada.
  const alertas = await alertasDaSemana({ venueId: params.venue.id, semana, turnos, pessoas }).catch(() => []);

  return {
    semana,
    avisados: avisos.length,
    sem_telefone: semTelefone,
    sem_escala: pessoas.length - porPessoa.size,
    alertas: alertas.length,
  };
}
