import { db } from "./supabase.js";

/**
 * Jogos que o bar vai transmitir.
 *
 * Digitar "Cuiabá x Palmeiras, sábado, 21h" à mão dá errado de três jeitos:
 * esquece-se de cadastrar, erra-se o horário, e ninguém volta para corrigir
 * quando a CBF muda a data — e aí o agente passa a mentir para o cliente que
 * perguntou se ia passar o jogo.
 *
 * Aqui os jogos vêm da API-Football e a pessoa MARCA quais entram na
 * programação. Nada entra sozinho: bar não transmite tudo, e uma agenda cheia
 * de jogos que não vão passar é pior que uma agenda vazia.
 */

/**
 * A API pública do ESPN — a mesma que alimenta o placar do site deles.
 *
 * Não é oficial no sentido de ter contrato, mas é aberta, não pede chave, não
 * tem cota e traz a temporada corrente. As alternativas com contrato ou não
 * servem ou custam: o plano gratuito da API-Football só libera as temporadas
 * de 2022 a 2024, a API Futebol brasileira dá só a Série B, e o
 * football-data.org não cobre Copa do Brasil nem Libertadores.
 *
 * O risco assumido: sem contrato, o formato pode mudar sem aviso. Por isso a
 * leitura é defensiva — jogo malformado é descartado e a tela segue com o que
 * deu para entender. E a aba inteira é um extra: se a API sumir amanhã, a
 * programação continua sendo cadastrada à mão, como sempre foi.
 */
const HOST = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/**
 * As competições que interessam a um bar brasileiro.
 *
 * O id é o código de liga do ESPN, não um número: é ele que vai na URL.
 */
export const COMPETICOES = [
  { id: "bra.1", nome: "Brasileirão Série A" },
  { id: "bra.2", nome: "Brasileirão Série B" },
  { id: "bra.copa_do_brazil", nome: "Copa do Brasil" },
  { id: "conmebol.libertadores", nome: "Libertadores" },
  { id: "conmebol.sudamericana", nome: "Sul-Americana" },
] as const;

export interface JogoDaApi {
  /** Id do jogo no ESPN. Texto, não número — é o que amarra o evento à fonte. */
  id: string;
  competicao: string;
  competicaoId: string;
  rodada: string | null;
  /** ISO em UTC. A tela e o evento convertem para o fuso da casa. */
  quando: string;
  mandante: string;
  visitante: string;
  escudoMandante: string | null;
  escudoVisitante: string | null;
  estadio: string | null;
  /** Já está na programação desta casa? */
  jaNaAgenda?: boolean;
}

export class ErroDeJogos extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeJogos";
  }
}

/**
 * Guarda o que a API respondeu, por competição.
 *
 * A API do ESPN não cobra nem impõe cota, mas a tabela de jogos do
 * Brasileirão é a MESMA para todo bar do país: uma consulta serve todos os
 * clientes. Repetir a cada abertura de tela seria bater no servidor dos
 * outros para receber a resposta de sempre.
 *
 * Seis horas: pega adiamento no mesmo dia e mantém a tela instantânea.
 */
const VALIDADE_CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { em: number; jogos: JogoDaApi[] }>();

/**
 * A busca de jogos não exige configuração nenhuma.
 *
 * Fica como função, e não como constante, porque a tela já pergunta isto — e
 * no dia em que a fonte exigir chave, a resposta muda aqui e em nenhum outro
 * lugar.
 */
export function jogosConfigurados(): boolean {
  return true;
}

/** AAAAMMDD, o formato de data que o ESPN aceita no parâmetro `dates`. */
function comoDataDoEspn(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function proximosJogos(params: {
  competicaoId: string;
  dias?: number;
}): Promise<JogoDaApi[]> {
  const dias = params.dias ?? 30;
  const chaveCache = `${params.competicaoId}:${dias}`;
  const guardado = cache.get(chaveCache);
  if (guardado && Date.now() - guardado.em < VALIDADE_CACHE_MS) {
    return guardado.jogos;
  }

  const agora = new Date();
  // O intervalo começa ONTEM, de propósito. `dates` é interpretado em UTC, e
  // no Brasil o dia UTC vira antes do nosso: às 21h de Cuiabá já é o dia
  // seguinte em UTC, e pedir "de hoje em diante" perderia justamente os jogos
  // desta noite — os mais prováveis de alguém querer marcar.
  const de = new Date(agora.getTime() - 864e5);
  const ate = new Date(agora.getTime() + dias * 864e5);
  // Sem o intervalo, o placar traz só os jogos de HOJE — e a tela existe para
  // escolher o que vai passar nas próximas semanas.
  const url =
    `${HOST}/${params.competicaoId}/scoreboard` +
    `?dates=${comoDataDoEspn(de)}-${comoDataDoEspn(ate)}`;

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new ErroDeJogos(502, `Não consegui falar com o serviço de jogos: ${(e as Error).message}`);
  }

  if (!resposta.ok) {
    throw new ErroDeJogos(
      502,
      resposta.status === 404
        ? "Essa competição não foi encontrada na fonte de jogos."
        : `O serviço de jogos respondeu ${resposta.status}.`,
    );
  }

  const corpo = (await resposta.json().catch(() => null)) as { events?: unknown[] } | null;
  const jogos = converter(corpo?.events ?? []);
  cache.set(chaveCache, { em: Date.now(), jogos });
  return jogos;
}

/**
 * Traduz o placar do ESPN para o que a tela precisa.
 *
 * Exportada para teste: sem contrato com a fonte, a regra do que é um jogo
 * aproveitável é justamente o que precisa estar coberto — e verificá-la não
 * deveria depender de a API estar no ar.
 */
/** Duração de um jogo com intervalo e acréscimos, em minutos. */
const DURACAO_JOGO_MIN = 120;

export function converter(bruto: unknown[]): JogoDaApi[] {
  const jogos: JogoDaApi[] = [];

  for (const item of bruto as Array<Record<string, any>>) {
    const id = item?.id;
    // O jogo de verdade vive em competitions[0]; o objeto de fora é o
    // "evento", que na maioria das ligas tem uma competição só.
    const partida = Array.isArray(item?.competitions) ? item.competitions[0] : null;
    const quando = partida?.date ?? item?.date;

    const times = Array.isArray(partida?.competitors) ? partida.competitors : [];
    const casa = times.find((t: any) => t?.homeAway === "home");
    const fora = times.find((t: any) => t?.homeAway === "away");

    const nomeCasa = casa?.team?.displayName ?? casa?.team?.name;
    const nomeFora = fora?.team?.displayName ?? fora?.team?.name;

    // Jogo sem id, sem data ou sem os dois times não vira linha na tela:
    // importar isso criaria um evento que o agente leria em voz alta.
    if (!id || typeof quando !== "string" || !nomeCasa || !nomeFora) continue;

    // Jogo que já acabou não serve para escolher o que vai passar. São dois
    // testes porque um só não basta: o `completed` da fonte é a verdade
    // quando existe, mas o intervalo agora começa ontem para não perder os
    // jogos desta noite — e sem o corte pelo relógio a lista abriria com a
    // rodada de ontem no topo.
    if (partida?.status?.type?.completed === true) continue;
    if (Date.parse(quando) + DURACAO_JOGO_MIN * 60_000 < Date.now()) continue;

    jogos.push({
      id: String(id),
      competicao: String(item?.season?.slug ?? "").replace(/-/g, " ") || "—",
      competicaoId: "",
      rodada: typeof item?.week?.text === "string" ? item.week.text : null,
      quando,
      mandante: String(nomeCasa),
      visitante: String(nomeFora),
      escudoMandante: typeof casa?.team?.logo === "string" ? casa.team.logo : null,
      escudoVisitante: typeof fora?.team?.logo === "string" ? fora.team.logo : null,
      estadio: typeof partida?.venue?.fullName === "string" ? partida.venue.fullName : null,
    });
  }

  // Do mais próximo para o mais distante: quem escolhe o que vai passar
  // decide primeiro o fim de semana, não o mês que vem.
  return jogos.sort((a, b) => a.quando.localeCompare(b.quando));
}

/** Título curto do evento — é o que o agente vai falar. */
export function tituloDoJogo(jogo: JogoDaApi): string {
  return `${jogo.mandante} x ${jogo.visitante}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const cliente = () => db() as any;

/**
 * Quais destes jogos já estão na agenda da casa.
 *
 * O vínculo é o id do jogo na API, guardado em `details`. É ele que impede a
 * mesma partida de entrar duas vezes quando alguém marca de novo sem lembrar
 * — e é ele que permitirá, depois, corrigir o horário quando a CBF mudar.
 */
export async function jogosJaNaAgenda(venueId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await cliente()
    .from("venue_events")
    .select("details")
    .eq("venue_id", venueId)
    .eq("kind", "jogo")
    .eq("active", true);
  if (error) throw new ErroDeJogos(500, `Falha ao conferir a agenda: ${error.message}`);

  const naAgenda = new Set<string>();
  for (const linha of data ?? []) {
    const id = (linha.details as Record<string, unknown> | null)?.fixture_id;
    if (id !== undefined && id !== null) naAgenda.add(String(id));
  }
  return naAgenda;
}

/**
 * Põe os jogos escolhidos na programação.
 *
 * Devolve quantos entraram e quantos já estavam — repetir a marcação não pode
 * duplicar o evento, e avisar que já estava é melhor que fingir que criou.
 */
export async function importarJogos(params: {
  venueId: string;
  jogos: JogoDaApi[];
}): Promise<{ criados: number; jaExistiam: number }> {
  if (params.jogos.length === 0) {
    throw new ErroDeJogos(400, "Escolha ao menos um jogo.");
  }

  const naAgenda = await jogosJaNaAgenda(
    params.venueId,
    params.jogos.map((j) => j.id),
  );

  const novos = params.jogos.filter((j) => !naAgenda.has(j.id));
  if (novos.length === 0) {
    return { criados: 0, jaExistiam: params.jogos.length };
  }

  const linhas = novos.map((jogo) => {
    const inicio = new Date(jogo.quando);
    return {
      venue_id: params.venueId,
      kind: "jogo",
      title: tituloDoJogo(jogo),
      description: [jogo.competicao, jogo.rodada, jogo.estadio].filter(Boolean).join(" · "),
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + DURACAO_JOGO_MIN * 60_000).toISOString(),
      // De onde veio. Sem isto, o jogo importado é indistinguível do digitado
      // à mão, e não há como corrigi-lo quando a data mudar na fonte.
      details: {
        fonte: "api-football",
        fixture_id: jogo.id,
        competicao: jogo.competicao,
      },
      active: true,
    };
  });

  const { error } = await cliente().from("venue_events").insert(linhas);
  if (error) throw new ErroDeJogos(500, `Falha ao criar os eventos: ${error.message}`);

  return { criados: novos.length, jaExistiam: params.jogos.length - novos.length };
}
