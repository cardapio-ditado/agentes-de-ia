import { db } from "./supabase.js";
import {
  MAX_TENTATIVAS,
  inserirAvisos,
  motivoDaFalha,
  nomeDoAviso,
  type AvisoNaFila,
} from "./notifications.js";

/**
 * O AVISO SOBRE OS AVISOS — quando um recado não chega, alguém tem de saber.
 *
 * A casa perdeu uma confirmação de reserva em agosto e só descobriu trinta
 * dias depois, quando a planta passou a mostrar a fila do Carteiro. O recado
 * estava lá o tempo todo, vermelho, esperando alguém abrir a tela certa.
 *
 * Uma tela que conta a verdade só serve para quem olha. Esta varredura
 * inverte isso: ela vai atrás do dono no WhatsApp.
 *
 * TRÊS CUIDADOS, todos aprendidos de problemas reais:
 *
 * 1. NÃO AVISAR SOBRE O PRÓPRIO AVISO. O alerta é, ele mesmo, uma notificação
 *    na fila. Se ele falhar e a varredura o enxergar, o alerta seguinte fala
 *    do anterior, e assim por diante. O template do alerta fica de fora da
 *    busca, e isso fecha o laço.
 *
 * 2. NÃO REPETIR. A varredura roda de hora em hora e quase sempre encontra a
 *    mesma coisa. Só fala quando há novidade depois do último alerta — senão
 *    o dono recebe o mesmo texto vinte e quatro vezes por dia e para de ler,
 *    que é o pior resultado possível.
 *
 * 3. NÃO CONFUNDIR ESPERA COM FALHA. Aviso parado porque o conector caiu vai
 *    sair sozinho quando ele voltar; só vira assunto se ficar parado tempo
 *    demais. O que morreu de vez — gastou as quatro tentativas — é assunto
 *    na hora.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

/** O template do alerta. Fica fora da busca — ver o cuidado 1. */
export const TEMPLATE_DO_ALERTA = "avisos_encalhados";

/** Parado mais do que isto sem sair, mesmo sem ter falhado, já é assunto. */
export const HORAS_PARA_ENCALHAR = 6;

export interface AvisoEncalhado extends AvisoNaFila {
  id: string;
  attempts: number;
  updated_at: string;
  /** `morreu` gastou as tentativas; `parado` ainda pode sair, mas demorou. */
  como: "morreu" | "parado";
}

type LinhaDaFila = AvisoNaFila & { id: string; attempts: number; updated_at: string };

function horasEntre(de: string, ate: Date): number {
  return (ate.getTime() - new Date(de).getTime()) / 3_600_000;
}

/**
 * Este aviso encalhou? E de que jeito?
 *
 * Falhou e ainda tem tentativa é `null` de propósito: o worker vai tentar de
 * novo em segundos, e acordar o dono para algo que se resolve sozinho é o
 * caminho mais curto para ele passar a ignorar os alertas.
 */
export function comoEncalhou(aviso: LinhaDaFila, agora: Date): AvisoEncalhado["como"] | null {
  if (aviso.status === "failed" && aviso.attempts >= MAX_TENTATIVAS) return "morreu";
  if (horasEntre(aviso.created_at, agora) >= HORAS_PARA_ENCALHAR) return "parado";
  return null;
}

/** Os que encalharam, os mais novos na frente. */
export function encalhados(avisos: LinhaDaFila[], agora: Date): AvisoEncalhado[] {
  return avisos
    .map((a) => ({ ...a, como: comoEncalhou(a, agora) }))
    .filter((a): a is AvisoEncalhado => a.como !== null)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/**
 * Já contei isto ao dono?
 *
 * A comparação é com o `updated_at` do aviso, e não com a hora do alerta:
 * assim um aviso NOVO que encalhe depois do último alerta gera um alerta
 * novo, e o mesmo punhado de sempre não gera nenhum.
 */
export function temNovidade(lista: AvisoEncalhado[], ultimoAlerta: string | null): boolean {
  if (lista.length === 0) return false;
  if (!ultimoAlerta) return true;
  return lista.some((a) => a.updated_at > ultimoAlerta);
}

/**
 * O texto que chega no WhatsApp do dono.
 *
 * Diz o que não saiu, para quem, e por quê — em uma linha cada. Quem lê isto
 * às onze da noite precisa decidir em cinco segundos se levanta ou não.
 */
export function montarAlerta(params: {
  casa: string;
  lista: AvisoEncalhado[];
  agora: Date;
}): string {
  const { casa, lista, agora } = params;
  const morreram = lista.filter((a) => a.como === "morreu").length;

  const linhas = lista.slice(0, 8).map((a) => {
    const para = String(a.destination ?? "").trim();
    const motivo = a.como === "morreu"
      ? motivoDaFalha(a.error)
      : `parado há ${Math.floor(horasEntre(a.created_at, agora))} h na fila`;
    return `• ${nomeDoAviso(a.template)}${para ? ` — para ${para}` : ""}\n  ${motivo}`;
  });

  return [
    `⚠️ ${lista.length} aviso(s) não chegaram no ${casa}.`,
    morreram > 0
      ? `${morreram} deles já desistiu de tentar — esses não saem mais sozinhos.`
      : `Nenhum desistiu ainda; eles saem sozinhos se o WhatsApp voltar.`,
    ``,
    ...linhas,
    lista.length > 8 ? `\n… e mais ${lista.length - 8}.` : null,
    ``,
    `Para ver: painel → A casa agora → clique no Carteiro.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/**
 * Varre a fila de todas as casas e avisa quem precisa saber.
 *
 * Devolve quantas casas foram avisadas. Nunca estoura: uma varredura que
 * derruba o relógio do servidor levaria junto o checklist, o lembrete de
 * reserva e a pesquisa — e o remédio seria pior que a doença.
 */
export async function varrerAvisosEncalhados(agora = new Date()): Promise<number> {
  const { data: casas } = await cliente()
    .from("venues")
    .select("id, name, reservas_avisar_whatsapp");

  const comDono = ((casas ?? []) as Array<{ id: string; name: string; reservas_avisar_whatsapp: string | null }>)
    .filter((c) => (c.reservas_avisar_whatsapp ?? "").trim());

  let avisadas = 0;
  for (const casa of comDono) {
    try {
      if (await avisarUmaCasa(casa, agora)) avisadas += 1;
    } catch (e) {
      // Uma casa com problema não pode calar as outras.
      console.error(`[encalhados] casa ${casa.id}: ${(e as Error).message}`);
    }
  }
  return avisadas;
}

async function avisarUmaCasa(
  casa: { id: string; name: string; reservas_avisar_whatsapp: string | null },
  agora: Date,
): Promise<boolean> {
  const { data } = await cliente()
    .from("notifications")
    .select("id, status, template, destination, error, attempts, created_at, updated_at")
    .eq("venue_id", casa.id)
    .in("status", ["pending", "queued", "failed"])
    // O cuidado 1: o alerta nunca fala do alerta.
    .neq("template", TEMPLATE_DO_ALERTA)
    .order("created_at", { ascending: true })
    .limit(100);

  const lista = encalhados((data ?? []) as LinhaDaFila[], agora);
  if (lista.length === 0) return false;

  const { data: alertas } = await cliente()
    .from("notifications")
    .select("created_at")
    .eq("venue_id", casa.id)
    .eq("template", TEMPLATE_DO_ALERTA)
    .order("created_at", { ascending: false })
    .limit(1);

  const ultimo = ((alertas ?? []) as Array<{ created_at: string }>)[0]?.created_at ?? null;
  if (!temNovidade(lista, ultimo)) return false;

  const { error } = await inserirAvisos({
    venue_id: casa.id,
    channel: "whatsapp",
    destination: casa.reservas_avisar_whatsapp!.trim(),
    // Pelo número administrativo: é recado da casa para o dono, não conversa
    // de cliente — e o do agente responde com IA, o que aqui não faz sentido.
    papel: "administrativo",
    template: TEMPLATE_DO_ALERTA,
    body: montarAlerta({ casa: casa.name, lista, agora }),
  });

  if (error) {
    console.error(`[encalhados] não enfileirei o alerta da casa ${casa.id}: ${error.message}`);
    return false;
  }
  console.log(`[encalhados] ${casa.name}: ${lista.length} aviso(s) encalhado(s), dono avisado.`);
  return true;
}
