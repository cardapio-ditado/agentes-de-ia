import { db, ehMigracaoPendente } from "./supabase.js";
import { ErroDoRh } from "./rh.js";
import { emHoras, minutosDoTurno, minutosNoturnosDoTurno } from "./rhJornada.js";
import { hojeNaCasa } from "./fuso.js";

/**
 * RH — Fase 5: o resumo do mês, pronto para a contabilidade.
 *
 * No fim do mês o contador pede sempre a mesma coisa: quantos dias cada um
 * trabalhou, quantas horas, quantas foram noturnas, quantas faltas, quantos
 * atrasos, quem tirou férias. Hoje isso sai de cabeça, de caderno e de
 * WhatsApp — e é por isso que a folha atrasa.
 *
 * Este arquivo junta o que a escala, as ocorrências e as férias já sabem e entrega
 * em dois formatos: texto para colar no WhatsApp do contador, e CSV para
 * quem prefere planilha.
 *
 * O que ele NÃO faz, como em todo o módulo: calcular salário líquido,
 * imposto, adicional em dinheiro ou rescisão. Entrega os NÚMEROS DE FATO;
 * quem transforma em folha é quem sempre fez isso.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

function falhar(status: number, contexto: string, mensagem: string): never {
  if (ehMigracaoPendente(mensagem)) {
    throw new ErroDoRh(503, `${contexto}: o banco ainda não recebeu as migrações do RH. Rode o SQL e tente de novo.`);
  }
  throw new ErroDoRh(status, `${contexto}: ${mensagem}`);
}

export interface LinhaDoResumo {
  atendente_id: string;
  nome: string;
  vinculo: string | null;
  cargo: string | null;
  salario: number | null;
  dias_trabalhados: number;
  minutos_trabalhados: number;
  minutos_noturnos: number;
  faltas: number;
  atrasos: number;
  minutos_de_atraso: number;
  dias_de_ferias: number;
  gorjeta: number;
}

export interface ResumoDoMes {
  mes: string;
  de: string;
  ate: string;
  casa: string;
  linhas: LinhaDoResumo[];
}

/** "2026-09" → primeiro e último dia. */
export function bordasDoMes(mes: string): { de: string; ate: string } {
  if (!/^\d{4}-\d{2}$/.test(String(mes ?? ""))) {
    throw new ErroDoRh(400, "Informe o mês no formato 2026-09.");
  }
  const [ano, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano!, m!, 0, 12));
  return { de: `${mes}-01`, ate: ultimo.toISOString().slice(0, 10) };
}

/** Quantos dias das férias caem dentro da janela. */
export function diasDentroDaJanela(inicio: string, fim: string, de: string, ate: string): number {
  const comeco = inicio > de ? inicio : de;
  const termino = fim < ate ? fim : ate;
  if (comeco > termino) return 0;
  const ms = new Date(`${termino}T12:00:00Z`).getTime() - new Date(`${comeco}T12:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export async function resumoDoMes(params: {
  venueId: string;
  casa: string;
  mes: string;
  timezone: string;
}): Promise<ResumoDoMes> {
  const { de, ate } = bordasDoMes(params.mes);

  const [{ data: pessoas, error }, { data: fichas }, { data: atrasosRegistrados }, { data: escala }, { data: turnos }, { data: ferias }, { data: cotas }] =
    await Promise.all([
      cliente().from("pesquisa_atendentes").select("id, nome, apelido, funcao").eq("venue_id", params.venueId),
      cliente().from("rh_fichas").select("atendente_id, vinculo, cargo, salario, desligamento").eq("venue_id", params.venueId),
      // Atraso é o que o gerente registra como ocorrência. Sem a tabela
      // (migração por rodar), simplesmente não há atraso a contar.
      cliente()
        .from("rh_ocorrencias")
        .select("atendente_id, minutos")
        .eq("venue_id", params.venueId)
        .eq("tipo", "atraso")
        .gte("dia", de)
        .lte("dia", ate),
      cliente()
        .from("rh_escala")
        .select("atendente_id, data, turno_id, situacao")
        .eq("venue_id", params.venueId)
        .gte("data", de)
        .lte("data", ate),
      cliente().from("rh_turnos").select("id, inicio, fim").eq("venue_id", params.venueId),
      cliente()
        .from("rh_ferias")
        .select("atendente_id, inicio, fim, situacao")
        .eq("venue_id", params.venueId)
        .eq("situacao", "aprovado")
        .lte("inicio", ate)
        .gte("fim", de),
      cliente()
        .from("rh_gorjeta_cotas")
        .select("atendente_id, valor, gorjeta_id")
        .eq("venue_id", params.venueId),
    ]);
  if (error) falhar(500, "Falha ao montar o resumo", error.message);

  // As cotas não têm data: o dia está na gorjeta. Buscar as do mês e cruzar.
  const { data: gorjetasDoMes } = await cliente()
    .from("rh_gorjetas")
    .select("id")
    .eq("venue_id", params.venueId)
    .gte("dia", de)
    .lte("dia", ate);
  const idsDoMes = new Set(((gorjetasDoMes ?? []) as Array<{ id: string }>).map((g) => g.id));

  const fichaDe = new Map(
    ((fichas ?? []) as Array<{
      atendente_id: string;
      vinculo: string | null;
      cargo: string | null;
      salario: string | number | null;
      desligamento: string | null;
    }>).map((f) => [f.atendente_id, f]),
  );

  const turnoDe = new Map(((turnos ?? []) as Array<{ id: string; inicio: string; fim: string }>).map((t) => [t.id, t]));

  // O que ainda não aconteceu não conta: a escala do fim do mês já está
  // montada no dia 20, e não é dia trabalhado.
  const hoje = hojeNaCasa(params.timezone);

  const atrasosDe = new Map<string, { vezes: number; minutos: number }>();
  for (const a of (atrasosRegistrados ?? []) as Array<{ atendente_id: string; minutos: number | null }>) {
    const atual = atrasosDe.get(a.atendente_id) ?? { vezes: 0, minutos: 0 };
    atrasosDe.set(a.atendente_id, { vezes: atual.vezes + 1, minutos: atual.minutos + (Number(a.minutos) || 0) });
  }

  const escalados = (escala ?? []) as Array<{ atendente_id: string; data: string; turno_id: string | null; situacao: string }>;

  const gorjetaDe = new Map<string, number>();
  for (const c of (cotas ?? []) as Array<{ atendente_id: string; valor: string | number; gorjeta_id: string }>) {
    if (!idsDoMes.has(c.gorjeta_id)) continue;
    gorjetaDe.set(c.atendente_id, (gorjetaDe.get(c.atendente_id) ?? 0) + Number(c.valor));
  }

  const feriasDe = new Map<string, number>();
  for (const f of (ferias ?? []) as Array<{ atendente_id: string; inicio: string; fim: string }>) {
    feriasDe.set(f.atendente_id, (feriasDe.get(f.atendente_id) ?? 0) + diasDentroDaJanela(f.inicio, f.fim, de, ate));
  }

  const linhas: LinhaDoResumo[] = ((pessoas ?? []) as Array<{
    id: string;
    nome: string;
    apelido: string | null;
    funcao: string | null;
  }>).map((pessoa) => {
    const ficha = fichaDe.get(pessoa.id);

    // Dias e horas pela escala: o turno de quem estava para trabalhar, nos
    // dias que já passaram. Falta é o que o gerente marcou na escala.
    let dias = 0;
    let minutos = 0;
    let noturnos = 0;
    let faltas = 0;
    for (const e of escalados) {
      if (e.atendente_id !== pessoa.id || e.data > hoje) continue;
      if (e.situacao === "falta") {
        faltas += 1;
        continue;
      }
      if (e.situacao !== "trabalha") continue;
      dias += 1;
      const turno = e.turno_id ? turnoDe.get(e.turno_id) : null;
      if (turno) {
        minutos += minutosDoTurno(turno.inicio, turno.fim);
        noturnos += minutosNoturnosDoTurno(turno.inicio, turno.fim);
      }
    }
    const atraso = atrasosDe.get(pessoa.id) ?? { vezes: 0, minutos: 0 };
    const atrasos = atraso.vezes;
    const minutosDeAtraso = atraso.minutos;

    return {
      atendente_id: pessoa.id,
      nome: pessoa.apelido || pessoa.nome,
      vinculo: ficha?.vinculo ?? null,
      cargo: ficha?.cargo ?? pessoa.funcao ?? null,
      salario: ficha?.salario === null || ficha?.salario === undefined ? null : Number(ficha.salario),
      dias_trabalhados: dias,
      minutos_trabalhados: minutos,
      minutos_noturnos: noturnos,
      faltas,
      atrasos,
      minutos_de_atraso: minutosDeAtraso,
      dias_de_ferias: feriasDe.get(pessoa.id) ?? 0,
      gorjeta: Math.round((gorjetaDe.get(pessoa.id) ?? 0) * 100) / 100,
    };
  });

  // Quem não teve nada no mês não vai para o contador: lista limpa é lista
  // que alguém lê.
  const comMovimento = linhas.filter(
    (l) =>
      l.dias_trabalhados > 0 || l.faltas > 0 || l.dias_de_ferias > 0 || l.gorjeta > 0 || l.minutos_de_atraso > 0,
  );

  comMovimento.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return { mes: params.mes, de, ate, casa: params.casa, linhas: comMovimento };
}

// ============================================================
// Formatos de saída
// ============================================================

function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function mesPorExtenso(mes: string): string {
  const nomes = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  const [ano, m] = mes.split("-");
  return `${nomes[Number(m) - 1] ?? m}/${ano}`;
}

/**
 * O resumo como texto para colar no WhatsApp do contador.
 *
 * Uma pessoa por bloco, com as linhas que o contador usa. A última frase não
 * é enfeite: ela deixa claro que os números são de fato e que o cálculo
 * continua sendo dele.
 */
export function comoTexto(resumo: ResumoDoMes): string {
  const partes: string[] = [
    `*${resumo.casa} — fechamento de ${mesPorExtenso(resumo.mes)}*`,
    `Período: ${diaBr(resumo.de)} a ${diaBr(resumo.ate)}`,
    "",
  ];

  if (resumo.linhas.length === 0) {
    partes.push("Nenhum movimento de equipe registrado neste mês.");
    return partes.join("\n");
  }

  for (const l of resumo.linhas) {
    const detalhes = [
      `${l.dias_trabalhados} dia(s) · ${emHoras(l.minutos_trabalhados)}`,
      l.minutos_noturnos ? `noturno ${emHoras(l.minutos_noturnos)}` : null,
      l.faltas ? `${l.faltas} falta(s)` : null,
      l.atrasos ? `${l.atrasos} atraso(s) (${emHoras(l.minutos_de_atraso)})` : null,
      l.dias_de_ferias ? `${l.dias_de_ferias} dia(s) de férias` : null,
      l.gorjeta ? `gorjeta ${reais(l.gorjeta)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    partes.push(`*${l.nome}*${l.cargo ? ` (${l.cargo})` : ""}`);
    partes.push(detalhes);
    partes.push("");
  }

  partes.push(
    "Dias e horas pela escala da casa (horas previstas do turno), faltas e atrasos registrados pelo gerente, e a gorjeta lançada. Cálculo de salário, encargos e adicionais permanece com a contabilidade.",
  );
  return partes.join("\n");
}

/** O mesmo resumo em CSV, para quem prefere planilha. */
export function comoCsv(resumo: ResumoDoMes): string {
  const cabecalho = [
    "nome", "cargo", "vinculo", "dias_trabalhados", "horas_trabalhadas", "horas_noturnas",
    "faltas", "atrasos", "minutos_de_atraso", "dias_de_ferias", "gorjeta", "salario_combinado",
  ];

  const escapar = (valor: unknown): string => {
    const texto = String(valor ?? "");
    return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  // Vírgula decimal e ponto e vírgula separando colunas: é assim que o Excel
  // em português abre sem pedir nada.
  const numero = (n: number) => n.toFixed(2).replace(".", ",");

  const linhas = resumo.linhas.map((l) =>
    [
      l.nome,
      l.cargo ?? "",
      l.vinculo ?? "",
      l.dias_trabalhados,
      numero(l.minutos_trabalhados / 60),
      numero(l.minutos_noturnos / 60),
      l.faltas,
      l.atrasos,
      l.minutos_de_atraso,
      l.dias_de_ferias,
      numero(l.gorjeta),
      l.salario === null ? "" : numero(l.salario),
    ]
      .map(escapar)
      .join(";"),
  );

  return [cabecalho.join(";"), ...linhas].join("\n");
}

function diaBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}
