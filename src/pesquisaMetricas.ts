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

/** Uma linha de `pesquisa_resposta_itens`, do jeito que sai do banco. */
export interface NotaBruta {
  resposta_id: string;
  item_id: string;
  categoria: string;
  pergunta: string;
  tipo: string;
  /** Já normalizada de 0 a 10. Null em pergunta de texto. */
  nota: number | null;
  texto: string | null;
  created_at: string;
}

export interface NotaDaPergunta {
  itemId: string;
  pergunta: string;
  tipo: string;
  media: number;
  respostas: number;
}

export interface NotaDaCategoria {
  categoria: string;
  media: number;
  /** Quantas notas entraram nesta média (não quantos clientes). */
  respostas: number;
  /** A mesma média no período anterior. Null = sem base para comparar. */
  antes: number | null;
  perguntas: NotaDaPergunta[];
}

/**
 * A nota de cada assunto da casa.
 *
 * É a resposta para "o problema é a cozinha ou o salão?" — a pergunta que a
 * nota geral sozinha nunca respondeu. Duas casas com NPS 40 podem ter
 * problemas opostos, e o dono só descobre qual é o dele olhando por categoria.
 */
export function porCategoria(
  notas: NotaBruta[],
  anteriores: NotaBruta[] = [],
): NotaDaCategoria[] {
  const medias = (linhas: NotaBruta[]) => {
    const acumulado = new Map<string, { soma: number; n: number }>();
    for (const l of linhas) {
      if (l.nota === null) continue;
      const atual = acumulado.get(l.categoria) ?? { soma: 0, n: 0 };
      atual.soma += l.nota;
      atual.n += 1;
      acumulado.set(l.categoria, atual);
    }
    return acumulado;
  };

  const agora = medias(notas);
  const antes = medias(anteriores);

  // Uma linha por pergunta, dentro da categoria dela: a categoria diz ONDE
  // está o problema, a pergunta diz QUAL é.
  const porPergunta = new Map<string, Map<string, { pergunta: string; tipo: string; soma: number; n: number }>>();
  for (const l of notas) {
    if (l.nota === null) continue;
    if (!porPergunta.has(l.categoria)) porPergunta.set(l.categoria, new Map());
    const daCategoria = porPergunta.get(l.categoria)!;
    const atual = daCategoria.get(l.item_id) ?? {
      pergunta: l.pergunta,
      tipo: l.tipo,
      soma: 0,
      n: 0,
    };
    atual.soma += l.nota;
    atual.n += 1;
    daCategoria.set(l.item_id, atual);
  }

  const saida: NotaDaCategoria[] = [];
  for (const [categoria, { soma, n }] of agora) {
    const base = antes.get(categoria);
    saida.push({
      categoria,
      media: arredondar(soma / n),
      respostas: n,
      antes: base && base.n > 0 ? arredondar(base.soma / base.n) : null,
      perguntas: [...(porPergunta.get(categoria) ?? new Map()).entries()]
        .map(([itemId, p]) => ({
          itemId,
          pergunta: p.pergunta,
          tipo: p.tipo,
          media: arredondar(p.soma / p.n),
          respostas: p.n,
        }))
        .sort((a, b) => a.media - b.media || a.pergunta.localeCompare(b.pergunta)),
    });
  }

  // Da pior para a melhor: a tela existe para achar problema, e o que precisa
  // de ação tem que estar em cima. Ordenar por nome poria "Ambiente" antes de
  // "Tempo de espera" mesmo com a espera em 4,2.
  saida.sort((a, b) => a.media - b.media || a.categoria.localeCompare(b.categoria));
  return saida;
}

function arredondar(n: number): number {
  return Math.round(n * 10) / 10;
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
  categorias: NotaDaCategoria[];
  /** Detratores recentes: é para estes que o dono liga de volta. */
  aBater: RespostaBruta[];
}

/** Quantos detratores a tela destaca. Mais que isso vira lista, não alerta. */
const LIMITE_A_BATER = 10;

export function montarPainel(params: {
  respostas: RespostaBruta[];
  anteriores?: RespostaBruta[];
  notas?: NotaBruta[];
  notasAnteriores?: NotaBruta[];
  atendentes: Array<{ id: string; nome: string; apelido?: string | null }>;
  fuso: string;
}): PainelDaPesquisa {
  const { respostas, atendentes, fuso } = params;

  return {
    categorias: porCategoria(params.notas ?? [], params.notasAnteriores ?? []),
    resumo: resumoNps(respostas),
    anterior: params.anteriores?.length ? resumoNps(params.anteriores) : null,
    ranking: ranking(respostas, atendentes),
    elogios: contarEtiquetas(respostas, "elogios"),
    criticas: contarEtiquetas(respostas, "criticas"),
    // A nuvem lê o comentário geral E o texto das perguntas abertas da casa:
    // quem escreveu na pergunta "quer contar mais?" está falando da casa do
    // mesmo jeito, e deixar isso de fora esvaziaria a nuvem justamente nas
    // pesquisas mais bem montadas.
    nuvem: nuvemDePalavras([
      ...respostas.map((r) => ({ texto: r.comentario, nota: r.nota })),
      ...(params.notas ?? [])
        .filter((n) => n.texto)
        .map((n) => ({
          texto: n.texto,
          nota: respostas.find((r) => r.id === n.resposta_id)?.nota ?? 8,
        })),
    ]),
    linha: porDia(respostas, fuso),
    // Os mais recentes primeiro: um cliente insatisfeito ontem ainda dá para
    // recuperar; o de três semanas atrás já contou para os amigos.
    aBater: respostas
      .filter((r) => classificar(r.nota) === "detrator")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, LIMITE_A_BATER),
  };
}
