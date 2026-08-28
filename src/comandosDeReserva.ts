import { db, ehMigracaoPendente } from "./supabase.js";
import { decidirReserva } from "./reservationFlow.js";
import { codigoDaReserva } from "./codigoDeReserva.js";
import type { Reservation, Venue } from "./venues.js";

/**
 * O gestor decide a reserva respondendo no próprio WhatsApp.
 *
 * O aviso de reserva nova já chega no celular dele. Obrigá-lo a abrir o painel
 * para clicar em "Aprovar" é pedir que ele pare o que está fazendo no salão,
 * ache o celular, entre no sistema e navegue — e é por isso que a fila fica
 * parada em noite de movimento, com o cliente esperando resposta.
 *
 * Responder "CONFIRMAR" é o caminho que ele já usa para tudo.
 *
 * ---
 *
 * ISTO ABRE UMA PORTA, e ela é estreita de propósito:
 *
 * 1. SÓ O NÚMERO CADASTRADO. Comando de qualquer outro remetente é ignorado
 *    exatamente como hoje — o administrativo continua não atendendo ninguém.
 *    A lista de quem pode é de um número por casa, escrito pelo dono no painel.
 * 2. SÓ PALAVRA EXPLÍCITA. "ok", "sim" e "blz" NÃO confirmam nada. Um "ok"
 *    solto é a coisa mais fácil de digitar por engano no WhatsApp, e aprovar
 *    uma reserva por engano é prometer mesa que a casa pode não ter.
 * 3. SÓ RESERVA PENDENTE, e a troca de status já é atômica no banco
 *    (`reviewReservation` filtra por `status = 'pending'`): dois "confirmar"
 *    seguidos não aprovam duas vezes.
 */

export { codigoDaReserva };

/* eslint-disable @typescript-eslint/no-explicit-any */
const cliente = () => db() as any;

export interface ComandoDeReserva {
  acao: "aprovar" | "recusar";
  /** As 4 primeiras letras do id da reserva, se o gestor disse qual. */
  codigo: string | null;
  /** O que vier depois do verbo e do código, numa recusa. */
  motivo: string | null;
}

/**
 * Palavras que decidem. Nada de "ok", "sim" ou "blz".
 *
 * A lista é curta e explícita porque o custo dos dois erros é diferente:
 * não entender um comando custa uma segunda mensagem; entender um comando que
 * não existia custa uma mesa prometida (ou negada) por engano.
 */
const APROVAR = ["confirmar", "confirmado", "confirma", "aprovar", "aprovado", "aprova"];
const RECUSAR = ["recusar", "recusado", "recusa", "negar", "negado", "nega", "cancelar"];

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Lê o que o gestor escreveu.
 *
 * Exportada para teste: é a fronteira entre uma mensagem de WhatsApp e uma
 * decisão que muda o dia de um cliente.
 */
export function interpretarComando(texto: string): ComandoDeReserva | null {
  const limpo = semAcento(String(texto ?? "").trim().toLowerCase());
  if (!limpo) return null;

  const partes = limpo.split(/\s+/);
  const verbo = partes[0]!;

  const acao = APROVAR.includes(verbo) ? "aprovar" : RECUSAR.includes(verbo) ? "recusar" : null;
  if (!acao) return null;

  // O código, se veio: 4 caracteres hexadecimais. Hexadecimal não tem O nem I,
  // então não há confusão com zero e um quando alguém dita por telefone.
  const resto = partes.slice(1);
  const primeiro = resto[0] ?? "";
  const temCodigo = /^[0-9a-f]{4}$/.test(primeiro);

  // O motivo sai do texto ORIGINAL, não do minúsculo sem acento: ele vai para
  // o cliente ler, e "sem mesa disponivel" em caixa baixa é desleixo nosso
  // chegando na tela dele.
  const palavrasDoMotivo = String(texto).trim().split(/\s+/).slice(temCodigo ? 2 : 1);
  const motivo = palavrasDoMotivo.join(" ").trim();

  return {
    acao,
    codigo: temCodigo ? primeiro : null,
    motivo: motivo || null,
  };
}

/**
 * Dois telefones são a mesma linha?
 *
 * O Brasil tem três grafias para o mesmo número: com e sem o 55, com e sem o
 * nono dígito. O gestor cadastra de um jeito e o WhatsApp entrega de outro —
 * comparar texto com texto simplesmente nunca casaria, e o comando dele
 * seria ignorado sem explicação.
 *
 * A comparação é por DDD + os 8 últimos dígitos. Duas linhas diferentes
 * precisariam ter o mesmo DDD e os mesmos 8 finais para colidir — o que é a
 * definição de serem a mesma linha.
 */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const nucleo = (bruto: string | null | undefined): string | null => {
    let digitos = String(bruto ?? "").replace(/\D/g, "");
    if (!digitos) return null;
    // Código do país: só cai fora quando sobra número suficiente para ser um
    // telefone com DDD.
    if (digitos.length > 11 && digitos.startsWith("55")) digitos = digitos.slice(2);
    if (digitos.length < 10) return null;
    const ddd = digitos.slice(0, 2);
    return `${ddd}${digitos.slice(-8)}`;
  };

  const x = nucleo(a);
  const y = nucleo(b);
  return x !== null && x === y;
}

/**
 * Monta a resposta ao comando. Devolve `null` quando não há o que responder —
 * remetente desconhecido ou mensagem que não é comando.
 *
 * Null é silêncio de propósito: o número administrativo continua não atendendo
 * quem não deveria estar falando com ele. Responder "não entendi" a qualquer
 * mensagem transformaria um número de avisos num chatbot.
 */
export async function responderComandoDeReserva(params: {
  telefoneDoRemetente: string;
  texto: string;
}): Promise<string | null> {
  const comando = interpretarComando(params.texto);
  if (!comando) return null;

  const casas = await casasQueEsteNumeroGerencia(params.telefoneDoRemetente);
  if (casas.length === 0) return null;

  const pendentes = await reservasPendentes(casas.map((c) => c.id));
  if (pendentes.length === 0) {
    return "Não há nenhuma reserva esperando decisão agora. 👍";
  }

  const escolha = escolherReserva(comando, pendentes);

  if (escolha.tipo === "nao_achou") {
    return (
      `Não achei reserva com o código ${comando.codigo?.toUpperCase()}. Estas estão esperando:\n\n` +
      listar(pendentes, casas)
    );
  }

  if (escolha.tipo === "ambigua") {
    return (
      `Tem ${escolha.candidatas.length} reservas esperando. Qual delas?\n\n` +
      `${listar(escolha.candidatas, casas)}\n\n` +
      `Responda com o código: *${comando.acao === "aprovar" ? "CONFIRMAR" : "RECUSAR"} ${codigoDaReserva(escolha.candidatas[0]!.id)}*`
    );
  }

  const reserva = escolha.reserva;
  const casa = casas.find((c) => c.id === reserva.venue_id);

  try {
    const { reserva: decidida } = await decidirReserva({
      reservationId: reserva.id,
      status: comando.acao === "aprovar" ? "approved" : "rejected",
      // Recusa sem motivo ainda avisa o cliente: o texto padrão é honesto e
      // deixa a porta aberta, que é melhor que um "não" seco.
      motivo:
        comando.acao === "recusar"
          ? (comando.motivo ?? "Não temos disponibilidade neste horário.")
          : undefined,
      venue: casa,
    });

    const quando = formatarQuando(decidida, casa);
    return comando.acao === "aprovar"
      ? `✅ Confirmada: ${decidida.customer_name}, ${quando}.\nO cliente já foi avisado.`
      : `❌ Recusada: ${decidida.customer_name}, ${quando}.\nO cliente já foi avisado do motivo.`;
  } catch (e) {
    // O caso mais provável: alguém decidiu pelo painel entre o aviso e a
    // resposta. Dizer isso vale mais que repetir a mensagem crua do banco.
    const mensagem = (e as Error).message;
    if (/não está pendente/i.test(mensagem)) {
      return "Essa reserva já foi decidida por alguém — não mexi em nada.";
    }
    console.error(`[comandos] reserva ${reserva.id}: ${mensagem}`);
    return "Não consegui registrar agora. Tente de novo, ou decida pelo painel.";
  }
}

export type EscolhaDeReserva =
  | { tipo: "unica"; reserva: Reservation }
  | { tipo: "ambigua"; candidatas: Reservation[] }
  | { tipo: "nao_achou" };

/**
 * Qual reserva o comando quer decidir.
 *
 * Separada e pura porque é o ponto onde um erro custa caro e não aparece:
 * escolher a reserva errada aprova a mesa errada, avisa o cliente errado, e
 * ninguém descobre até alguém chegar na porta.
 *
 * Por isso a ambiguidade PERGUNTA em vez de chutar. "A mais recente" e "a mais
 * próxima" são regras que funcionam quase sempre — e o "quase" aqui é um
 * cliente ouvindo "sua mesa está confirmada" sobre uma reserva que era de
 * outra pessoa.
 */
export function escolherReserva(
  comando: ComandoDeReserva,
  pendentes: Reservation[],
): EscolhaDeReserva {
  if (comando.codigo) {
    const casadas = pendentes.filter(
      (r) => codigoDaReserva(r.id).toLowerCase() === comando.codigo,
    );
    if (casadas.length === 0) return { tipo: "nao_achou" };
    // Duas reservas com o mesmo prefixo de id é improvável, mas se acontecer
    // o certo continua sendo perguntar.
    if (casadas.length > 1) return { tipo: "ambigua", candidatas: casadas };
    return { tipo: "unica", reserva: casadas[0]! };
  }

  if (pendentes.length === 1) return { tipo: "unica", reserva: pendentes[0]! };
  return { tipo: "ambigua", candidatas: pendentes };
}

/** A lista numerada que vai na resposta quando é preciso escolher. */
function listar(reservas: Reservation[], casas: Venue[]): string {
  return reservas
    .slice(0, 5)
    .map((r) => {
      const casa = casas.find((c) => c.id === r.venue_id);
      return `*${codigoDaReserva(r.id)}* — ${r.customer_name}, ${formatarQuando(r, casa)} (${r.party_size}p)`;
    })
    .join("\n");
}

function formatarQuando(reserva: Reservation, casa: Venue | undefined): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: casa?.timezone ?? "America/Cuiaba",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(reserva.reserved_for));
}

/**
 * As casas que puseram ESTE número como gestor de reservas.
 *
 * Vem do banco a cada comando, e não de um cache: o dono pode acabar de trocar
 * o número, e o número antigo tem de parar de decidir na hora.
 */
async function casasQueEsteNumeroGerencia(telefone: string): Promise<Venue[]> {
  const { data, error } = await cliente()
    .from("venues")
    .select("*")
    .not("reservas_avisar_whatsapp", "is", null)
    .eq("active", true);

  if (error) {
    // Coluna ainda não existe (migração não rodou): ninguém gerencia por
    // WhatsApp, e o administrativo segue mudo como antes.
    if (ehMigracaoPendente(error.message)) return [];
    throw new Error(`Falha ao conferir o gestor: ${error.message}`);
  }

  return ((data ?? []) as Venue[]).filter((v) =>
    mesmoTelefone(v.reservas_avisar_whatsapp, telefone),
  );
}

async function reservasPendentes(venueIds: string[]): Promise<Reservation[]> {
  if (venueIds.length === 0) return [];
  const { data, error } = await cliente()
    .from("reservations")
    .select("*")
    .in("venue_id", venueIds)
    .eq("status", "pending")
    // Só o que ainda vai acontecer: decidir uma reserva de ontem não serve a
    // ninguém, e ela poluiria a lista de escolha.
    .gt("reserved_for", new Date().toISOString())
    .order("reserved_for", { ascending: true })
    .limit(20);

  if (error) throw new Error(`Falha ao listar as pendentes: ${error.message}`);
  return (data ?? []) as Reservation[];
}
