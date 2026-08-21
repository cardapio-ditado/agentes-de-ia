import { nuvemDePalavras } from "./nuvemDePalavras.js";
import type { TermoDaNuvem } from "./nuvemDePalavras.js";

/**
 * As contas da pesquisa.
 *
 * Puro de propósito: são estas contas que o dono vai olhar para decidir
 * demitir, promover ou mudar a cozinha. Uma média errada aqui não estoura em
 * lugar nenhum — só produz uma decisão errada, meses depois, sem ninguém
 * desconfiar de onde veio.
 */

export interface RespostaBruta {
  id: string;
  nota: number;
  elogios: string[];
  criticas: string[];
  comentario: string | null;
  atendente_id: string | null;
  atendente_nota: number | null;
  mesa: string | null;
  origem: string;
  cliente_nome: string | null;
  cliente_contato: string | null;
  created_at: string;
}

export interface ResumoNps {
  respostas: number;
  /** Média das notas de 0 a 10, uma casa decimal. */
  media: number;
  promotores: number;
  neutros: number;
  detratores: number;
  /** %promotores − %detratores, de −100 a 100. Inteiro. */
  nps: number;
}

/**
 * A classificação do NPS. Não é escolha nossa: 9-10 promotor, 7-8 neutro,
 * 0-6 detrator é o padrão do mercado, e mudar isso tornaria o número da casa
 * incomparável com qualquer referência que o dono leia por aí.
 */
export function classificar(nota: number): "promotor" | "neutro" | "detrator" {
  if (nota >= 9) return "promotor";
  if (nota >= 7) return "neutro";
  return "detrator";
}

export function resumoNps(respostas: RespostaBruta[]): ResumoNps {
  const vazio: ResumoNps = {
    respostas: 0, media: 0, promotores: 0, neutros: 0, detratores: 0, nps: 0,
  };
  if (respostas.length === 0) return vazio;

  let soma = 0;
  let promotores = 0;
  let neutros = 0;
  let detratores = 0;

  for (const r of respostas) {
    soma += r.nota;
    const classe = classificar(r.nota);
    if (classe === "promotor") promotores += 1;
    else if (classe === "neutro") neutros += 1;
    else detratores += 1;
  }

  const total = respostas.length;
  return {
    respostas: total,
    media: Math.round((soma / total) * 10) / 10,
    promotores,
    neutros,
    detratores,
    // Arredondado só no fim: arredondar cada percentual antes da subtração
    // produz NPS diferente do que a mesma amostra daria em qualquer outra
    // ferramenta, e o dono compara.
    nps: Math.round((promotores / total) * 100 - (detratores / total) * 100),
  };
}

export interface PostoNoRanking {
  atendenteId: string;
  nome: string;
  /** Média das estrelas (1 a 5) recebidas. */
  media: number;
  /** Quantos clientes avaliaram esta pessoa. */
  avaliacoes: number;
  /** Quantas dessas avaliações foram 5 estrelas. */
  cincoEstrelas: number;
  /** false = ainda não tem avaliações suficientes para valer como posição. */
  classificado: boolean;
}

/**
 * Quantas avaliações uma pessoa precisa para entrar no ranking de verdade.
 *
 * Sem um mínimo, quem foi avaliado UMA vez com 5 estrelas fica em primeiro
 * lugar acima de quem tem quarenta avaliações e média 4,8 — e o ranking, que
 * existe para reconhecer trabalho, vira sorteio. Quem ainda não chegou lá
 * aparece na lista assim mesmo, marcado como "em formação": sumir da tela
 * seria pior, porque a pessoa existe e o gerente precisa vê-la.
 */
export const MINIMO_PARA_RANKING = 5;

export function ranking(
  respostas: RespostaBruta[],
  atendentes: Array<{ id: string; nome: string; apelido?: string | null }>,
): PostoNoRanking[] {
  const nomes = new Map(atendentes.map((a) => [a.id, a.apelido?.trim() || a.nome]));
  const acumulado = new Map<string, { soma: number; n: number; cinco: number }>();

  for (const r of respostas) {
    if (!r.atendente_id || r.atendente_nota === null) continue;
    const atual = acumulado.get(r.atendente_id) ?? { soma: 0, n: 0, cinco: 0 };
    atual.soma += r.atendente_nota;
    atual.n += 1;
    if (r.atendente_nota === 5) atual.cinco += 1;
    acumulado.set(r.atendente_id, atual);
  }

  const postos: PostoNoRanking[] = [];
  for (const [atendenteId, { soma, n, cinco }] of acumulado) {
    postos.push({
      atendenteId,
      // Atendente apagado depois de ter sido avaliado: as avaliações ficam
      // (são história da casa), mas o nome já não existe para consultar.
      nome: nomes.get(atendenteId) ?? "Atendente removido",
      media: Math.round((soma / n) * 10) / 10,
      avaliacoes: n,
      cincoEstrelas: cinco,
      classificado: n >= MINIMO_PARA_RANKING,
    });
  }

  // Classificados primeiro, depois por média, e o volume desempata: com a
  // mesma média, quem foi avaliado mais vezes provou mais.
  postos.sort(
    (a, b) =>
      Number(b.classificado) - Number(a.classificado) ||
      b.media - a.media ||
      b.avaliacoes - a.avaliacoes ||
      a.nome.localeCompare(b.nome),
  );
  return postos;
}

export interface ContagemDeEtiqueta {
  etiqueta: string;
  vezes: number;
}

/** As etiquetas marcadas, da mais escolhida para a menos. */
export function contarEtiquetas(
  respostas: RespostaBruta[],
  campo: "elogios" | "criticas",
): ContagemDeEtiqueta[] {
  const conta = new Map<string, number>();
  for (const r of respostas) {
    for (const etiqueta of r[campo] ?? []) {
      conta.set(etiqueta, (conta.get(etiqueta) ?? 0) + 1);
    }
  }
  return [...conta.entries()]
    .map(([etiqueta, vezes]) => ({ etiqueta, vezes }))
    .sort((a, b) => b.vezes - a.vezes || a.etiqueta.localeCompare(b.etiqueta));
}

export interface PontoDaLinha {
  /** AAAA-MM-DD no calendário da casa. */
  dia: string;
  respostas: number;
  media: number;
}

/**
 * A evolução dia a dia, no fuso da casa.
 *
 * Agrupar pelo dia UTC jogaria a noite de sábado inteira (que em Cuiabá
 * termina depois da meia-noite UTC) para o domingo — e o dono veria movimento
 * no dia em que a casa estava fechada.
 */
export function porDia(respostas: RespostaBruta[], fuso: string): PontoDaLinha[] {
  const formatador = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const conta = new Map<string, { soma: number; n: number }>();
  for (const r of respostas) {
    const dia = formatador.format(new Date(r.created_at));
    const atual = conta.get(dia) ?? { soma: 0, n: 0 };
    atual.soma += r.nota;
    atual.n += 1;
    conta.set(dia, atual);
  }

  return [...conta.entries()]
    .map(([dia, { soma, n }]) => ({
      dia,
      respostas: n,
      media: Math.round((soma / n) * 10) / 10,
    }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

export interface PainelDaPesquisa {
  resumo: ResumoNps;
  /** O mesmo resumo do período anterior, do mesmo tamanho. Null = sem base. */
  anterior: ResumoNps | null;
  ranking: PostoNoRanking[];
  elogios: ContagemDeEtiqueta[];
  criticas: ContagemDeEtiqueta[];
  nuvem: TermoDaNuvem[];
  linha: PontoDaLinha[];
  /** Detratores recentes: é para estes que o dono liga de volta. */
  aBater: RespostaBruta[];
}

/** Quantos detratores a tela destaca. Mais que isso vira lista, não alerta. */
const LIMITE_A_BATER = 10;

export function montarPainel(params: {
  respostas: RespostaBruta[];
  anteriores?: RespostaBruta[];
  atendentes: Array<{ id: string; nome: string; apelido?: string | null }>;
  fuso: string;
}): PainelDaPesquisa {
  const { respostas, atendentes, fuso } = params;

  return {
    resumo: resumoNps(respostas),
    anterior: params.anteriores?.length ? resumoNps(params.anteriores) : null,
    ranking: ranking(respostas, atendentes),
    elogios: contarEtiquetas(respostas, "elogios"),
    criticas: contarEtiquetas(respostas, "criticas"),
    nuvem: nuvemDePalavras(
      respostas.map((r) => ({ texto: r.comentario, nota: r.nota })),
    ),
    linha: porDia(respostas, fuso),
    // Os mais recentes primeiro: um cliente insatisfeito ontem ainda dá para
    // recuperar; o de três semanas atrás já contou para os amigos.
    aBater: respostas
      .filter((r) => classificar(r.nota) === "detrator")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, LIMITE_A_BATER),
  };
}
