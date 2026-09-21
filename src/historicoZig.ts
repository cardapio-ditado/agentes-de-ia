import { db, ehMigracaoPendente } from "./supabase.js";
import { hojeNaCasa } from "./fuso.js";
import { reivindicar } from "./rotinas.js";
import { alimentarBasePelaZig, diaAnterior } from "./pesquisaZig.js";

/**
 * O HISTÓRICO DA CASA — buscar na Zig os dias que faltam, não só o de ontem.
 *
 * A varredura diária busca ONTEM e mais nada. Isso deixa dois buracos, e a
 * casa caiu nos dois:
 *
 *   · o passado inteiro. A base do Ditado começa no dia em que a varredura
 *     entrou no ar. Tudo que aconteceu antes — meses de movimento que a Zig
 *     tem guardado — nunca foi buscado, e "meu cliente sumiu" não tinha como
 *     ser respondido com dezessete dias de base;
 *   · o dia perdido. Servidor fora do ar na virada, e aquele dia não volta
 *     nunca: amanhã a varredura pede ontem de novo, que já é outro dia.
 *
 * Aqui o critério deixa de ser "que dia é hoje" e passa a ser "que dias
 * faltam". É a mesma pergunta que resolve carga histórica e autocura, e é
 * por isso que são uma função só.
 *
 * O MARCADOR É O ATO DE BUSCAR, e não o resultado dele.
 *
 * A primeira versão usava o próprio dado — "dia com visita gravada é dia já
 * buscado" —, o que é elegante e está errado: a segunda-feira em que o bar
 * fechou não grava visita nenhuma e continua parecendo um buraco. Na carga
 * do Ditado a coisa saiu de desperdício para paralisia, com o comando
 * refazendo as mesmas dez datas em laço, sem nunca andar para trás.
 *
 * "Procurei em 12/08 e não havia ninguém" é uma resposta, e `clientes_dias_zig`
 * é onde ela mora.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

/**
 * Quantos dias a varredura de hora em hora busca por volta.
 *
 * Baixo de propósito. Cada dia são dezenas de páginas de check-in na API da
 * Zig, e a carga de um ano inteiro martelando a API deles de uma vez é um
 * jeito de ser bloqueado. Em compensação, oito por hora cobrem um ano em
 * dois dias sem ninguém olhar — e a casa não tem pressa pelo que já passou.
 */
export const DIAS_POR_VOLTA = 8;

/** Até onde faz sentido procurar buraco. Um ano dá a sazonalidade da casa. */
export const JANELA_PADRAO = 365;

/** Os dias da janela, do mais recente para o mais antigo. */
export function diasDaJanela(ultimoDia: string, quantos: number): string[] {
  const dias: string[] = [];
  let d = ultimoDia;
  for (let i = 0; i < quantos; i += 1) {
    dias.push(d);
    d = diaAnterior(d);
  }
  return dias;
}

/**
 * Os dias da janela que a base não tem, do mais recente para o mais antigo.
 *
 * Do recente para o antigo de propósito: se a carga for interrompida no meio
 * — e vai ser, porque ela leva dias —, o que já entrou é o que mais importa.
 * Ninguém abre o CRM para ver a terça-feira de onze meses atrás antes de ver
 * a semana passada.
 */
export function buracos(janela: string[], jaTem: Set<string>): string[] {
  return janela.filter((d) => !jaTem.has(d));
}

/**
 * Os dias já buscados na janela.
 *
 * Lê as DUAS fontes de propósito. O marcador é a resposta certa, mas os dias
 * que entraram antes de ele existir só aparecem em `clientes_visitas` — e
 * refazer meses de carga por causa de uma mudança de mecanismo seria trocar
 * um desperdício por outro.
 */
async function diasJaBuscados(venueId: string, desde: string): Promise<Set<string>> {
  const [marcados, comVisita] = await Promise.all([
    cliente().from("clientes_dias_zig").select("dia").eq("venue_id", venueId).gte("dia", desde).limit(50_000),
    cliente().from("clientes_visitas").select("dia").eq("venue_id", venueId).gte("dia", desde).limit(50_000),
  ]);

  // Banco sem a migração ainda: o marcador simplesmente não conta, e a
  // varredura volta a se guiar pelo dado. Degradar é melhor que parar.
  if (marcados.error && !ehMigracaoPendente(marcados.error.message)) {
    throw new Error(`Falha ao ler os dias buscados: ${marcados.error.message}`);
  }
  if (comVisita.error) throw new Error(`Falha ao ler as visitas: ${comVisita.error.message}`);

  const dias = new Set<string>();
  for (const linha of [...(marcados.data ?? []), ...(comVisita.data ?? [])] as Array<{ dia: string }>) {
    dias.add(linha.dia);
  }
  return dias;
}

/**
 * Anota que este dia foi buscado, com quantos vieram.
 *
 * Nunca estoura: se o marcador falhar, o pior que acontece é o dia ser
 * buscado de novo mais tarde — perder a carga inteira por causa da anotação
 * seria bem pior.
 */
async function anotarDiaBuscado(venueId: string, dia: string, visitantes: number): Promise<void> {
  const { error } = await cliente()
    .from("clientes_dias_zig")
    .upsert({ venue_id: venueId, dia, visitantes, buscado_em: new Date().toISOString() },
      { onConflict: "venue_id,dia" });
  if (error && !ehMigracaoPendente(error.message)) {
    console.error(`[historico-zig] não anotei ${dia}: ${error.message}`);
  }
}

export interface ResultadoDoHistorico {
  /** Dias que faltavam na janela quando a volta começou. */
  faltavam: number;
  /** Dias efetivamente buscados nesta volta. */
  buscados: number;
  /** Dias que a Zig recusou ou que deram erro — ficam para a próxima volta. */
  falharam: number;
  /** Visitantes gravados nesta volta. */
  visitantes: number;
}

/**
 * Preenche os buracos de uma casa, até o teto de dias desta volta.
 *
 * Dia que falha não interrompe os outros: a Zig às vezes devolve erro numa
 * data e responde na seguinte, e parar tudo no primeiro tropeço deixaria a
 * carga presa para sempre naquele dia.
 */
export async function preencherHistorico(
  venue: { id: string; name: string; timezone: string },
  opcoes: { janela?: number; teto?: number; agora?: Date; aoAndar?: (dia: string, visitantes: number) => void } = {},
): Promise<ResultadoDoHistorico> {
  const agora = opcoes.agora ?? new Date();
  const janela = opcoes.janela ?? JANELA_PADRAO;
  const teto = opcoes.teto ?? DIAS_POR_VOLTA;

  // Ontem é o dia mais novo que faz sentido pedir: o de hoje ainda está
  // acontecendo, e gravá-lo pela metade seria pior que não ter.
  const ultimo = diaAnterior(hojeNaCasa(venue.timezone, agora));
  const dias = diasDaJanela(ultimo, janela);
  const faltando = buracos(dias, await diasJaBuscados(venue.id, dias[dias.length - 1]!));

  const resultado: ResultadoDoHistorico = {
    faltavam: faltando.length,
    buscados: 0,
    falharam: 0,
    visitantes: 0,
  };

  for (const dia of faltando.slice(0, teto)) {
    try {
      // `forcar` porque a decisão de buscar já foi tomada aqui, olhando o
      // marcador. Sem isto, a checagem interna por visita gravada mandaria
      // pular justamente o dia vazio que viemos anotar.
      const r = await alimentarBasePelaZig(venue, { dia, agora, forcar: true });
      await anotarDiaBuscado(venue.id, dia, r.visitantes);
      resultado.buscados += 1;
      resultado.visitantes += r.visitantes;
      opcoes.aoAndar?.(dia, r.visitantes);
    } catch (e) {
      resultado.falharam += 1;
      console.error(`[historico-zig] ${venue.name} ${dia}: ${(e as Error).message}`);
    }
  }
  return resultado;
}

/** As casas com a Zig ligada — token e loja preenchidos. */
export async function casasComZig(): Promise<Array<{ id: string; name: string; timezone: string }>> {
  const { data: conexoes } = await cliente()
    .from("pesquisa_zig")
    .select("venue_id, token, loja")
    .not("token", "is", null)
    .limit(200);

  const prontas = ((conexoes ?? []) as Array<{ venue_id: string; token: string | null; loja: string | null }>)
    .filter((c) => c.token?.trim() && c.loja?.trim());
  if (prontas.length === 0) return [];

  const { data: casas } = await cliente()
    .from("venues")
    .select("id, name, timezone")
    .in("id", prontas.map((c) => c.venue_id));
  return (casas ?? []) as Array<{ id: string; name: string; timezone: string }>;
}

/**
 * A volta de hora em hora: cada casa ganha alguns dias de histórico.
 *
 * Enquanto há buraco ela carrega o passado; quando não há mais, ela vira a
 * rede de segurança do dia a dia — e a diferença entre as duas coisas é
 * quantos dias ela encontra faltando, não código nenhum.
 */
export async function varrerHistorico(agora = new Date()): Promise<ResultadoDoHistorico> {
  const total: ResultadoDoHistorico = { faltavam: 0, buscados: 0, falharam: 0, visitantes: 0 };
  // Um processo por hora: quatro buscando os mesmos oito dias na Zig é
  // quatro vezes o custo pelo mesmo resultado.
  if (!(await reivindicar("historico-zig", 50, agora))) return total;

  for (const casa of await casasComZig()) {
    try {
      const r = await preencherHistorico(casa, { agora });
      total.faltavam += r.faltavam;
      total.buscados += r.buscados;
      total.falharam += r.falharam;
      total.visitantes += r.visitantes;
      if (r.buscados > 0) {
        console.log(
          `[historico-zig] ${casa.name}: ${r.buscados} dia(s), ${r.visitantes} visitante(s); ` +
            `faltam ${r.faltavam - r.buscados}.`,
        );
      }
    } catch (e) {
      // Uma casa com problema não pode calar as outras.
      console.error(`[historico-zig] ${casa.name}: ${(e as Error).message}`);
    }
  }
  return total;
}
