import { db } from "./supabase.js";
import { fimDoEvento, instanteNaCasa } from "./fuso.js";
import type { EventoLido } from "./lerProgramacao.js";
import type { TablesInsert } from "./database.types.js";

/**
 * Gravar na agenda o que a IA leu — depois de alguém conferir.
 *
 * A leitura (lerProgramacao.ts) e a gravação são passos separados de
 * propósito: entre um e outro há uma tela onde a pessoa corrige o que ficou
 * errado. Um show inventado por uma foto ruim viraria promessa ao cliente.
 *
 * O que este arquivo resolve é a parte chata: o horário digitado é o do
 * relógio da casa e o banco guarda instante, o show que vira a noite termina
 * no dia seguinte, e o mesmo cartaz mandado duas vezes não pode virar duas
 * agendas.
 */

/** Sem hora final declarada, o show ocupa a noite. */
const DURACAO_PADRAO_MIN = 240;

export interface EventoParaGravar extends EventoLido {
  /** Desmarcado na tela de conferência = não entra. */
  escolhido?: boolean;
}

/**
 * Duas grafias do mesmo show. "Acústico Berê " e "acustico bere" são o mesmo
 * evento para quem lê o cartaz duas vezes, e é isso que precisa ser detectado.
 */
function chave(titulo: string, inicio: string): string {
  const limpo = titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return `${limpo}|${inicio}`;
}

/**
 * Converte os eventos lidos em linhas do banco.
 *
 * Separada da gravação para poder ser testada: a conversão de fuso e a virada
 * da meia-noite são exatamente onde um erro passa despercebido até o cliente
 * aparecer no dia errado.
 */
export function linhasParaGravar(params: {
  venueId: string;
  fuso: string;
  eventos: EventoParaGravar[];
  /** Chaves de `chaveDoEvento` que já estão na agenda. */
  jaExistentes?: Set<string>;
}): { linhas: TablesInsert<"venue_events">[]; repetidos: number; avisos: string[] } {
  const jaExistentes = params.jaExistentes ?? new Set<string>();
  const linhas: TablesInsert<"venue_events">[] = [];
  const avisos: string[] = [];
  let repetidos = 0;

  // Repetido dentro do próprio material também conta: cartaz costuma listar o
  // mesmo show no cabeçalho e no corpo.
  const vistos = new Set<string>();

  for (const evento of params.eventos) {
    if (evento.escolhido === false) continue;

    let comeca: string;
    let termina: string | null;
    try {
      comeca = instanteNaCasa(evento.data, evento.inicio, params.fuso);
      termina = evento.fim
        ? fimDoEvento(evento.data, evento.inicio, evento.fim, params.fuso)
        : new Date(Date.parse(comeca) + DURACAO_PADRAO_MIN * 60_000).toISOString();
    } catch {
      avisos.push(`"${evento.titulo}": data ou hora inválida, não foi gravado.`);
      continue;
    }

    const k = chave(evento.titulo, comeca);
    if (jaExistentes.has(k) || vistos.has(k)) {
      repetidos++;
      continue;
    }
    vistos.add(k);

    linhas.push({
      venue_id: params.venueId,
      kind: evento.tipo,
      title: evento.titulo,
      description: evento.descricao,
      starts_at: comeca,
      ends_at: termina,
      cover_charge: evento.couvert,
      // De onde veio. Sem isto não há como distinguir o que a IA leu do que
      // alguém digitou — e é a primeira pergunta quando aparece um evento
      // estranho na agenda.
      details: { fonte: "leitura-ia" },
      active: true,
    });
  }

  return { linhas, repetidos, avisos };
}

/** A chave de comparação de um evento que já está no banco. */
export function chaveDoEvento(titulo: string, startsAt: string): string {
  return chave(titulo, new Date(startsAt).toISOString());
}

export class ErroDeAgenda extends Error {
  constructor(readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

export async function importarProgramacao(params: {
  venueId: string;
  fuso: string;
  eventos: EventoParaGravar[];
}): Promise<{ criados: number; repetidos: number; avisos: string[] }> {
  const escolhidos = params.eventos.filter((e) => e.escolhido !== false);
  if (escolhidos.length === 0) throw new ErroDeAgenda(400, "Escolha ao menos um evento.");

  // Só a janela do material: carregar a agenda inteira de uma casa com anos de
  // histórico para conferir doze shows não faz sentido.
  const datas = escolhidos.map((e) => e.data).sort();
  const de = `${datas[0]}T00:00:00Z`;
  const ate = new Date(Date.parse(`${datas[datas.length - 1]}T00:00:00Z`) + 2 * 86_400_000).toISOString();

  const { data, error } = await db()
    .from("venue_events")
    .select("title, starts_at")
    .eq("venue_id", params.venueId)
    .gte("starts_at", de)
    .lte("starts_at", ate);
  if (error) throw new ErroDeAgenda(500, `Falha ao conferir a agenda: ${error.message}`);

  const jaExistentes = new Set((data ?? []).map((e) => chaveDoEvento(e.title, e.starts_at)));

  const { linhas, repetidos, avisos } = linhasParaGravar({
    venueId: params.venueId,
    fuso: params.fuso,
    eventos: escolhidos,
    jaExistentes,
  });

  if (linhas.length === 0) return { criados: 0, repetidos, avisos };

  const { error: erroInsert } = await db().from("venue_events").insert(linhas);
  if (erroInsert) throw new ErroDeAgenda(500, `Falha ao gravar a agenda: ${erroInsert.message}`);

  return { criados: linhas.length, repetidos, avisos };
}
