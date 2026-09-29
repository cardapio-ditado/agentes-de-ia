import { db } from "./supabase.js";
import { reivindicar } from "./rotinas.js";
import { MAX_TENTATIVAS, tentarEnviar, type Notification } from "./notifications.js";
import { conexaoDaCasa, prontaParaEnviar } from "./whatsappOficial.js";

/**
 * A FILA DO NÚMERO OFICIAL — os avisos com modelo saem daqui.
 *
 * A fila de avisos sempre morou dentro do conector (WhatsApp Web) e só
 * anda enquanto ele está conectado. Fazia sentido quando o único jeito de
 * enviar era ele. Com o número oficial, um parabéns com modelo escolhido
 * não precisa de conector nenhum — e ficava parado na fila mesmo assim,
 * com zero tentativas, esperando um QR que ninguém ia ler.
 *
 * Este relógio pega só o que tem modelo e só das casas com o oficial
 * pronto. O resto continua com o conector, como sempre.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

/** Por minuto. O mesmo ritmo dos disparos, pelo mesmo motivo: o número. */
export const RITMO_POR_MINUTO = 20;

export async function enviarPendentesPeloOficial(agora = new Date()): Promise<{ enviadas: number; falharam: number; puladas: number }> {
  const total = { enviadas: 0, falharam: 0, puladas: 0 };
  if (!(await reivindicar("fila-oficial", 1, agora))) return total;

  const { data, error } = await cliente()
    .from("notifications")
    .select("*")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_TENTATIVAS)
    .not("modelo", "is", null)
    .order("created_at", { ascending: true })
    .limit(RITMO_POR_MINUTO * 3);
  if (error) {
    console.error(`[fila-oficial] não li a fila: ${error.message}`);
    return total;
  }

  // Uma consulta de conexão por casa, não por aviso.
  const prontas = new Map<string, boolean>();
  for (const aviso of (data ?? []) as Notification[]) {
    if (total.enviadas + total.falharam >= RITMO_POR_MINUTO) break;
    if (!prontas.has(aviso.venue_id)) {
      const c = await conexaoDaCasa({ id: aviso.venue_id }).catch(() => null);
      prontas.set(aviso.venue_id, prontaParaEnviar(c));
    }
    // Casa sem o oficial pronto: fica para o conector. Tentar aqui só
    // gastaria as quatro tentativas numa porta que não abre.
    if (!prontas.get(aviso.venue_id)) {
      total.puladas += 1;
      continue;
    }
    const r = await tentarEnviar(aviso);
    if (r.status === "sent") total.enviadas += 1;
    else total.falharam += 1;
  }
  if (total.enviadas || total.falharam) {
    console.log(`[fila-oficial] ${total.enviadas} enviado(s), ${total.falharam} falha(s).`);
  }
  return total;
}
