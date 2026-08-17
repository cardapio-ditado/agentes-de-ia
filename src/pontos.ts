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

  const inicio = new Date(Date.UTC(anoInicio, mesInicio - 1, dia, 0, 0, 0));
  const fim = new Date(Date.UTC(anoInicio, mesInicio, dia, 0, 0, 0));

  const hoje = new Date(Date.UTC(ano, mes - 1, diaHoje, 0, 0, 0));
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

  const { data: conversas, error: erroConversas } = await db()
    .from("conversations")
    .select("id")
    .eq("venue_id", venue.id);
  if (erroConversas) throw new Error(`Falha ao listar conversas: ${erroConversas.message}`);

  const ids = (conversas ?? []).map((c) => c.id);
  const porModelo = new Map<string, { mensagens: number; pontos: number; modelo: string | null }>();
  let usados = 0;
  let mensagens = 0;

  if (ids.length > 0) {
    const { data: msgs, error: erroMsgs } = await db()
      .from("messages")
      .select("model, created_at")
      .in("conversation_id", ids)
      .eq("role", "assistant")
      .gte("created_at", ciclo.inicio.toISOString())
      .lt("created_at", ciclo.fim.toISOString());
    if (erroMsgs) throw new Error(`Falha ao somar o consumo: ${erroMsgs.message}`);

    for (const m of msgs ?? []) {
      const peso = pesoDoModelo(m.model);
      const nome = nomeDoModelo(m.model);
      usados += peso;
      mensagens += 1;
      const atual = porModelo.get(nome) ?? { mensagens: 0, pontos: 0, modelo: m.model };
      atual.mensagens += 1;
      atual.pontos += peso;
      porModelo.set(nome, atual);
    }
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

  return {
    plano: venue.plano ?? "profissional",
    total,
    usados,
    restantes,
    percentual: total > 0 ? Math.min(100, Math.round((usados / total) * 100)) : 0,
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
