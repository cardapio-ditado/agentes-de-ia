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

const HOST = "https://v3.football.api-sports.io";

/**
 * As competições que interessam a um bar brasileiro.
 *
 * O plano gratuito dá acesso a todas as 1.236 ligas, então a lista curta é
 * escolha de produto, não limitação: mostrar 1.236 opções para quem quer
 * saber do jogo do Cuiabá é esconder a informação dentro de um catálogo.
 */
export const COMPETICOES = [
  { id: 71, nome: "Brasileirão Série A" },
  { id: 72, nome: "Brasileirão Série B" },
  { id: 73, nome: "Copa do Brasil" },
  { id: 13, nome: "Libertadores" },
  { id: 11, nome: "Sul-Americana" },
] as const;

export interface JogoDaApi {
  id: number;
  competicao: string;
  competicaoId: number;
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
 * O plano gratuito dá 100 requisições por dia — e a tabela de jogos do
 * Brasileirão é a MESMA para todo bar do país. Uma consulta serve todos os
 * clientes, e repetir a cada abertura de tela seria queimar a cota para
 * receber a resposta de sempre.
 *
 * Seis horas: tempo suficiente para pegar adiamento no mesmo dia, e curto o
 * bastante para não gastar mais que algumas requisições diárias.
 */
const VALIDADE_CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { em: number; jogos: JogoDaApi[] }>();

export function jogosConfigurados(): boolean {
  return Boolean(process.env.API_FOOTBALL_KEY?.trim());
}

/**
 * Os próximos jogos de uma competição.
 *
 * `season` é o ano do campeonato. Competição de calendário europeu (que
 * atravessa o ano) usa o ano de início; as brasileiras usam o ano corrente,
 * que é o caso de tudo que interessa aqui.
 */
export async function proximosJogos(params: {
  competicaoId: number;
  dias?: number;
}): Promise<JogoDaApi[]> {
  const chave = process.env.API_FOOTBALL_KEY?.trim();
  if (!chave) {
    throw new ErroDeJogos(503, "A busca de jogos ainda não foi configurada nesta instalação.");
  }

  const dias = params.dias ?? 30;
  const chaveCache = `${params.competicaoId}:${dias}`;
  const guardado = cache.get(chaveCache);
  if (guardado && Date.now() - guardado.em < VALIDADE_CACHE_MS) {
    return guardado.jogos;
  }

  const hoje = new Date();
  const ate = new Date(hoje.getTime() + dias * 864e5);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const url =
    `${HOST}/fixtures?league=${params.competicaoId}` +
    `&season=${hoje.getFullYear()}` +
    `&from=${iso(hoje)}&to=${iso(ate)}`;

  let resposta: Response;
  try {
    resposta = await fetch(url, { headers: { "x-apisports-key": chave } });
  } catch (e) {
    throw new ErroDeJogos(502, `Não consegui falar com o serviço de jogos: ${(e as Error).message}`);
  }

  if (!resposta.ok) {
    throw new ErroDeJogos(
      resposta.status === 429 ? 429 : 502,
      resposta.status === 429
        ? "A cota diária de consultas acabou. Os jogos voltam a aparecer amanhã."
        : `O serviço de jogos respondeu ${resposta.status}.`,
    );
  }

  const corpo = (await resposta.json().catch(() => null)) as {
    errors?: unknown;
    response?: unknown[];
  } | null;

  // A API responde 200 com os erros DENTRO do corpo — chave inválida, cota
  // estourada e liga fora do plano chegam todos assim. Sem esta conferência, o
  // resultado seria uma lista vazia e a tela diria "nenhum jogo", que é a
  // mensagem mais enganosa possível para "sua chave está errada".
  const erros = corpo?.errors;
  const listaDeErros =
    Array.isArray(erros) ? erros.map(String)
    : erros && typeof erros === "object" ? Object.values(erros as Record<string, unknown>).map(String)
    : [];
  if (listaDeErros.length > 0) {
    const texto = listaDeErros.join(" · ");
    throw new ErroDeJogos(
      /token|key|subscri/i.test(texto) ? 401 : 502,
      /token|key/i.test(texto)
        ? "A chave do serviço de jogos não foi aceita. Confira a API_FOOTBALL_KEY."
        : `O serviço de jogos recusou a consulta: ${texto}`,
    );
  }

  const jogos = converter(corpo?.response ?? []);
  cache.set(chaveCache, { em: Date.now(), jogos });
  return jogos;
}

/**
 * Traduz a resposta da API para o que a tela precisa.
 *
 * Exportada para teste: a regra do que é um jogo aproveitável não deveria
 * custar uma requisição da cota para ser verificada.
 */
export function converter(bruto: unknown[]): JogoDaApi[] {
  const jogos: JogoDaApi[] = [];

  for (const item of bruto as Array<Record<string, any>>) {
    const id = Number(item?.fixture?.id);
    const quando = item?.fixture?.date;
    const casa = item?.teams?.home?.name;
    const fora = item?.teams?.away?.name;

    // Jogo sem id, sem data ou sem os dois times não vira linha na tela:
    // importar isso criaria um evento que o agente leria em voz alta.
    if (!Number.isFinite(id) || typeof quando !== "string" || !casa || !fora) continue;

    jogos.push({
      id,
      competicao: String(item?.league?.name ?? "—"),
      competicaoId: Number(item?.league?.id ?? 0),
      rodada: typeof item?.league?.round === "string" ? item.league.round : null,
      quando,
      mandante: String(casa),
      visitante: String(fora),
      escudoMandante: typeof item?.teams?.home?.logo === "string" ? item.teams.home.logo : null,
      escudoVisitante: typeof item?.teams?.away?.logo === "string" ? item.teams.away.logo : null,
      estadio: typeof item?.fixture?.venue?.name === "string" ? item.fixture.venue.name : null,
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
export async function jogosJaNaAgenda(venueId: string, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await cliente()
    .from("venue_events")
    .select("details")
    .eq("venue_id", venueId)
    .eq("kind", "jogo")
    .eq("active", true);
  if (error) throw new ErroDeJogos(500, `Falha ao conferir a agenda: ${error.message}`);

  const naAgenda = new Set<number>();
  for (const linha of data ?? []) {
    const id = Number((linha.details as Record<string, unknown> | null)?.fixture_id);
    if (Number.isFinite(id)) naAgenda.add(id);
  }
  return naAgenda;
}

/** Duração padrão de um jogo com intervalo e acréscimos, em minutos. */
const DURACAO_JOGO_MIN = 120;

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
        liga_id: jogo.competicaoId,
      },
      active: true,
    };
  });

  const { error } = await cliente().from("venue_events").insert(linhas);
  if (error) throw new ErroDeJogos(500, `Falha ao criar os eventos: ${error.message}`);

  return { criados: novos.length, jaExistiam: params.jogos.length - novos.length };
}
