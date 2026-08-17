/**
 * Medidor de pontos: quanto do plano o cliente já gastou e quanto ainda dura.
 *
 * A regra comercial é simples de explicar na mesa do restaurante: 1 ponto é
 * uma resposta do agente no motor mais leve. Motor melhor pensa mais e custa
 * mais, então pesa mais.
 *
 *   Haiku 4.5 = 1 ponto · Sonnet 5 = 3 pontos · Opus 5 = 5 pontos
 *
 * Não é peso inventado: é a razão real entre os preços por token da API.
 * Uma resposta custa ~$0,0032 no Haiku, ~$0,0095 no Sonnet e ~$0,0158 no Opus.
 * Por isso o teto de custo de um plano é o mesmo qualquer que seja a escolha
 * do cliente — o que muda é quantas respostas ele compra com os mesmos pontos.
 *
 * O saldo é sempre DERIVADO das mensagens já gravadas, nunca de um contador
 * paralelo. Contador que se incrementa à parte é a primeira coisa a divergir
 * do que realmente aconteceu.
 */

import { diaLocal } from "./inbox.js";
import { deslocamentoEm } from "./venues.js";
import { db } from "./supabase.js";

/** Peso de cada família de modelo, por prefixo do id. */
const PESOS: Array<[string, number, string]> = [
  ["claude-opus", 5, "Opus"],
  ["claude-sonnet", 3, "Sonnet"],
  ["claude-haiku", 1, "Haiku"],
  ["claude-fable", 10, "Fable"],
];

const PESO_DESCONHECIDO = 3;

export function pesoDoModelo(model: string | null | undefined): number {
  if (!model) return PESO_DESCONHECIDO;
  for (const [prefixo, peso] of PESOS) {
    if (model.startsWith(prefixo)) return peso;
  }
  return PESO_DESCONHECIDO;
}

export function nomeDoModelo(model: string | null | undefined): string {
  if (!model) return "Outro";
  for (const [prefixo, , nome] of PESOS) {
    if (model.startsWith(prefixo)) return nome;
  }
  return "Outro";
}

/** Motores oferecidos, do mais leve ao mais caro — a ordem que o painel mostra. */
export const MOTORES: Array<{ id: string; nome: string; peso: number }> = [
  { id: "claude-haiku-4-5-20251001", nome: "Haiku", peso: 1 },
  { id: "claude-sonnet-5", nome: "Sonnet", peso: 3 },
  { id: "claude-opus-5", nome: "Opus", peso: 5 },
];

/**
 * Instante UTC da meia-noite local de uma data.
 *
 * O deslocamento é lido NA data em questão, não hoje: fuso com horário de
 * verão muda de offset no meio do ano, e usar o de hoje erraria o início do
 * ciclo por uma hora em metade do calendário.
 */
function meiaNoiteLocal(ano: number, mes: number, dia: number, timezone: string): Date {
  const aproximado = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
  const offset = deslocamentoEm(timezone, aproximado);
  const mm = String(mes).padStart(2, "0");
  const dd = String(dia).padStart(2, "0");
  return new Date(`${ano}-${mm}-${dd}T00:00:00${offset}`);
}

export interface Ciclo {
  inicio: Date;
  fim: Date;
  diasCorridos: number;
  diasRestantes: number;
}

/**
 * Ciclo de cobrança vigente, ancorado no dia de assinatura.
 *
 * Trabalha em data local do estabelecimento: em Cuiabá, o consumo de uma
 * quinta às 22h pertence à quinta, não à sexta que já começou em UTC.
 */
export function cicloAtual(cicloDia: number, timezone: string, agora = new Date()): Ciclo {
  const dia = Math.min(Math.max(Math.trunc(cicloDia) || 1, 1), 28);
  const hojeLocal = diaLocal(agora.toISOString(), timezone);
  const [ano, mes, diaHoje] = hojeLocal.split("-").map(Number) as [number, number, number];

  // Antes do dia de virada, o ciclo corrente começou no mês passado.
  let anoInicio = ano;
  let mesInicio = mes;
  if (diaHoje < dia) {
    mesInicio -= 1;
    if (mesInicio === 0) {
      mesInicio = 12;
      anoInicio -= 1;
    }
  }

  // Meia-noite LOCAL convertida para o instante UTC correspondente, e não
  // meia-noite UTC da data local. Em Cuiabá (UTC-4) a diferença é de quatro
  // horas: sem isto, as respostas das 20h à meia-noite do último dia do ciclo
  // cairiam no ciclo seguinte — cobrança errada na virada, que é o único
  // momento em que ninguém está olhando.
  const inicio = meiaNoiteLocal(anoInicio, mesInicio, dia, timezone);
  const proximoMes = mesInicio === 12 ? 1 : mesInicio + 1;
  const anoDoFim = mesInicio === 12 ? anoInicio + 1 : anoInicio;
  const fim = meiaNoiteLocal(anoDoFim, proximoMes, dia, timezone);

  // "Hoje" na mesma régua que início e fim — meia-noite local. Misturar
  // meia-noite UTC com meia-noite local faria a diferença cair em fração de
  // dia e a contagem passar a depender de arredondamento.
  const hoje = meiaNoiteLocal(ano, mes, diaHoje, timezone);
  const MS_DIA = 24 * 60 * 60 * 1000;
  // Dias corridos conta o dia de hoje: no primeiro dia do ciclo o ritmo é
  // "o que foi gasto hoje", não uma divisão por zero.
  const diasCorridos = Math.max(1, Math.round((hoje.getTime() - inicio.getTime()) / MS_DIA) + 1);
  const diasRestantes = Math.max(0, Math.round((fim.getTime() - hoje.getTime()) / MS_DIA));

  return { inicio, fim, diasCorridos, diasRestantes };
}

export interface UsoDeMotor {
  motor: string;
  modelo: string | null;
  mensagens: number;
  pontos: number;
}

export interface DuracaoEstimada {
  motor: string;
  modelo: string;
  peso: number;
  /** Quantas respostas ainda cabem no saldo neste motor. */
  respostas: number;
  /** Dias até zerar, no ritmo atual. null = sem ritmo medido ainda. */
  dias: number | null;
  /** Se o saldo aguenta até o fim do ciclo neste motor. */
  cobreOCiclo: boolean;
}

/**
 * O que acontece quando os pontos acabam.
 *
 * Cortar o atendimento no instante em que o saldo zera seria transformar um
 * problema de cobrança em WhatsApp mudo numa noite de sábado — e o cliente
 * culpa o produto, não o plano dele. Então há dois dias de cortesia rodando
 * no motor mais barato: o restaurante continua atendendo, o custo fica preso
 * no mínimo e sobra tempo para comprar pontos antes de travar de verdade.
 */
export type EstadoDoPlano = "ativo" | "cortesia" | "bloqueado";

export const MODELO_DE_CORTESIA = "claude-haiku-4-5-20251001";
export const DIAS_DE_CORTESIA = 2;

/**
 * Traduz "quando o saldo zerou" em estado do plano agora.
 *
 * Função pura e separada porque é a regra de cobrança: é ela que decide se o
 * agente fala, e a borda exata das 48h precisa ser testável sem banco.
 */
export function estadoPelaExaustao(
  esgotadoEm: string | null,
  agora: Date,
): { estado: EstadoDoPlano; cortesiaAte: Date | null; horasDeCortesia: number | null } {
  if (esgotadoEm === null) {
    return { estado: "ativo", cortesiaAte: null, horasDeCortesia: null };
  }
  const MS_HORA = 60 * 60 * 1000;
  const cortesiaAte = new Date(new Date(esgotadoEm).getTime() + DIAS_DE_CORTESIA * 24 * MS_HORA);
  return {
    // Exatamente às 48h já bloqueia: a cortesia é "menos que", não "até".
    estado: agora.getTime() < cortesiaAte.getTime() ? "cortesia" : "bloqueado",
    cortesiaAte,
    horasDeCortesia: Math.max(0, Math.ceil((cortesiaAte.getTime() - agora.getTime()) / MS_HORA)),
  };
}

export interface Extrato {
  plano: string;
  total: number;
  usados: number;
  restantes: number;
  percentual: number;
  ciclo: { inicio: string; fim: string; dias_corridos: number; dias_restantes: number };
  por_motor: UsoDeMotor[];
  mensagens: number;
  ritmo_diario: number;
  projecao_ciclo: number;
  duracao_por_motor: DuracaoEstimada[];
  estado: EstadoDoPlano;
  /** Quando o saldo zerou, ISO. null enquanto houver pontos. */
  esgotado_em: string | null;
  /** Fim da cortesia, ISO. null enquanto houver pontos. */
  cortesia_ate: string | null;
  /** Horas que ainda restam de cortesia — o número do aviso. */
  horas_de_cortesia: number | null;
}

interface VenueDoPlano {
  id: string;
  timezone: string;
  plano?: string | null;
  pontos_mensais?: number | null;
  ciclo_dia?: number | null;
}

/**
 * Extrato do ciclo corrente: gasto, sobra e quanto tempo a sobra dura.
 */
export async function extratoDePontos(venue: VenueDoPlano, agora = new Date()): Promise<Extrato> {
  const total = Math.max(0, venue.pontos_mensais ?? 2500);
  const ciclo = cicloAtual(venue.ciclo_dia ?? 1, venue.timezone, agora);

  const porModelo = new Map<string, { mensagens: number; pontos: number; modelo: string | null }>();
  let usados = 0;
  let mensagens = 0;

  // Em ordem cronológica porque não basta somar: precisamos saber em QUE
  // momento o saldo cruzou o limite, e é desse instante que a cortesia conta.
  let esgotadoEm: string | null = null;

  // Junção no banco em vez de buscar os ids das conversas e mandá-los de volta
  // num `in(...)`: numa casa com milhares de conversas essa lista viraria uma
  // URL gigante (e um 414). Isto roda a cada mensagem recebida — precisa ser
  // uma consulta só, com filtro do lado do Postgres.
  const { data: msgs, error: erroMsgs } = await db()
    .from("messages")
    .select("model, created_at, conversations!inner(venue_id)")
    .eq("conversations.venue_id", venue.id)
    .eq("role", "assistant")
    .gte("created_at", ciclo.inicio.toISOString())
    .lt("created_at", ciclo.fim.toISOString())
    .order("created_at", { ascending: true });
  if (erroMsgs) throw new Error(`Falha ao somar o consumo: ${erroMsgs.message}`);

  for (const m of msgs ?? []) {
    const peso = pesoDoModelo(m.model);
    const nome = nomeDoModelo(m.model);
    usados += peso;
    mensagens += 1;
    if (esgotadoEm === null && usados >= total) esgotadoEm = m.created_at;
    const atual = porModelo.get(nome) ?? { mensagens: 0, pontos: 0, modelo: m.model };
    atual.mensagens += 1;
    atual.pontos += peso;
    porModelo.set(nome, atual);
  }

  const restantes = Math.max(0, total - usados);
  const ritmo = usados / ciclo.diasCorridos;
  const projecao = Math.round(ritmo * (ciclo.diasCorridos + ciclo.diasRestantes));

  // A pergunta que o cliente realmente faz ao trocar de motor: "e aí, dura até
  // o fim do mês?". Respondida no ritmo dele, não numa média de mercado.
  const duracao: DuracaoEstimada[] = MOTORES.map(({ id, nome, peso }) => {
    const respostas = Math.floor(restantes / peso);
    const respostasPorDia = mensagens / ciclo.diasCorridos;
    const dias = respostasPorDia > 0 ? Math.floor(respostas / respostasPorDia) : null;
    return {
      motor: nome,
      modelo: id,
      peso,
      respostas,
      dias,
      cobreOCiclo: dias === null ? restantes > 0 : dias >= ciclo.diasRestantes,
    };
  });

  const { estado, cortesiaAte, horasDeCortesia } = estadoPelaExaustao(esgotadoEm, agora);

  return {
    plano: venue.plano ?? "profissional",
    total,
    usados,
    restantes,
    percentual: total > 0 ? Math.min(100, Math.round((usados / total) * 100)) : 0,
    estado,
    esgotado_em: esgotadoEm,
    cortesia_ate: cortesiaAte?.toISOString() ?? null,
    horas_de_cortesia: horasDeCortesia,
    ciclo: {
      inicio: ciclo.inicio.toISOString().slice(0, 10),
      fim: ciclo.fim.toISOString().slice(0, 10),
      dias_corridos: ciclo.diasCorridos,
      dias_restantes: ciclo.diasRestantes,
    },
    por_motor: [...porModelo.entries()]
      .map(([motor, v]) => ({ motor, modelo: v.modelo, mensagens: v.mensagens, pontos: v.pontos }))
      .sort((a, b) => b.pontos - a.pontos),
    mensagens,
    ritmo_diario: Math.round(ritmo * 10) / 10,
    projecao_ciclo: projecao,
    duracao_por_motor: duracao,
  };
}

/**
 * Estado do plano para decidir, em tempo de resposta, se o agente fala e com
 * qual motor.
 *
 * Memória de 60 segundos porque isto roda a CADA mensagem recebida: sem cache
 * seria uma varredura do ciclo inteiro por mensagem de cliente. Um minuto de
 * atraso pode deixar passar algumas respostas depois do limite — barato perto
 * de transformar cada "oi" do WhatsApp numa agregação no banco.
 */
const memoria = new Map<string, { quando: number; extrato: Extrato }>();
const VALIDADE_MS = 60_000;

export async function estadoDoPlano(
  venue: VenueDoPlano,
  agora = new Date(),
): Promise<{ estado: EstadoDoPlano; modelo: string | null; extrato: Extrato }> {
  const guardado = memoria.get(venue.id);
  let extrato = guardado && agora.getTime() - guardado.quando < VALIDADE_MS ? guardado.extrato : null;

  if (!extrato) {
    extrato = await extratoDePontos(venue, agora);
    memoria.set(venue.id, { quando: agora.getTime(), extrato });
  }

  return {
    estado: extrato.estado,
    // Na cortesia o motor escolhido pelo cliente é ignorado: o combinado é
    // continuar atendendo ao custo mínimo, não continuar gastando 5x.
    modelo: extrato.estado === "cortesia" ? MODELO_DE_CORTESIA : null,
    extrato,
  };
}

/** Some com a memória de um venue — usar após vender pontos ou trocar o plano. */
export function esquecerEstado(venueId: string): void {
  memoria.delete(venueId);
}

/** Erro de plano travado: o chamador decide o que dizer em cada canal. */
export class PlanoBloqueadoError extends Error {
  readonly extrato: Extrato;
  readonly conversationId: string | null;
  constructor(extrato: Extrato, conversationId: string | null = null) {
    super(
      "Os pontos deste estabelecimento acabaram e o período de cortesia terminou. " +
        "Renove o plano ou compre pontos extras para o agente voltar a responder.",
    );
    this.name = "PlanoBloqueadoError";
    this.extrato = extrato;
    this.conversationId = conversationId;
  }
}
