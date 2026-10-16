/**
 * O FREIO DO AGENTE.
 *
 * Em 15/10/2026 um robô de banco (o atendimento automático do Itaú
 * Empresas) e a Fernanda conversaram sozinhos por uma hora: cada um
 * respondia o outro em segundos, 76 respostas, e cada resposta mandava a
 * conversa INTEIRA para o modelo — 308 mensagens, 49 mil tokens por vez,
 * 2,7 milhões de tokens numa manhã. Sem ninguém do lado de lá.
 *
 * Dois freios, os dois aqui, puros e testáveis:
 *
 * 1. O histórico que vai para o modelo tem teto. Uma conversa de um mês não
 *    precisa inteira para responder "tem mesa hoje?"; as últimas dezenas de
 *    mensagens bastam, e o custo deixa de crescer com o tamanho da conversa.
 *
 * 2. Resposta em rajada ou a mesma mensagem chegando repetida é robô do
 *    outro lado, ou alguém testando. O agente para, a conversa vai para
 *    atendimento humano (aparece na inbox esperando gente) e nada mais é
 *    gasto até uma pessoa devolver a conversa ao agente.
 */

/** Quantas mensagens do histórico vão para o modelo, no máximo. */
export const MAXIMO_DE_MENSAGENS_NO_CONTEXTO = 40;
/** A janela em que se conta a rajada. */
export const JANELA_DO_FREIO_MINUTOS = 10;
/** Respostas do agente na janela a partir das quais ele para. */
export const MAXIMO_DE_RESPOSTAS_NA_JANELA = 10;
/** A mesma mensagem recebida tantas vezes (contando a nova) é repetição. */
export const REPETICOES_PARA_FREAR = 3;
/** Entre quantas mensagens recentes do cliente a repetição é procurada. */
const JANELA_DE_REPETICAO = 12;

export interface LinhaDoHistorico {
  role: string;
  content: string | null;
  created_at: string;
}

/**
 * As últimas mensagens, prontas para a API.
 *
 * O corte nunca começa num resultado de ferramenta: ele responde a um pedido
 * de ferramenta que ficou do lado de fora, e a API recusa a conversa inteira
 * por isso. Avança até a primeira mensagem do cliente.
 */
export function recortarHistorico<T extends { role: string }>(historico: T[], maximo = MAXIMO_DE_MENSAGENS_NO_CONTEXTO): T[] {
  const ultimas = historico.slice(-Math.max(1, maximo));
  const primeiraDoCliente = ultimas.findIndex((m) => m.role === "user");
  if (primeiraDoCliente <= 0) return primeiraDoCliente === 0 ? ultimas : [];
  return ultimas.slice(primeiraDoCliente);
}

function normalizar(texto: string | null | undefined): string {
  return (texto ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Esta conversa virou um laço?
 *
 * `historico` é o que já estava gravado ANTES da mensagem nova; `novaMensagem`
 * é a que acabou de chegar. Devolve o motivo, para o log e para a inbox.
 */
export function pareceLoop(params: {
  historico: LinhaDoHistorico[];
  novaMensagem: string;
  agora: Date;
}): { freia: boolean; motivo: string | null } {
  const limite = params.agora.getTime() - JANELA_DO_FREIO_MINUTOS * 60_000;
  const respostasRecentes = params.historico.filter(
    (m) => m.role === "assistant" && new Date(m.created_at).getTime() >= limite,
  ).length;
  if (respostasRecentes >= MAXIMO_DE_RESPOSTAS_NA_JANELA) {
    return { freia: true, motivo: `${respostasRecentes} respostas em ${JANELA_DO_FREIO_MINUTOS} minutos` };
  }

  const nova = normalizar(params.novaMensagem);
  if (nova.length >= 12) {
    const recebidas = params.historico.filter((m) => m.role === "user").slice(-JANELA_DE_REPETICAO);
    const iguais = recebidas.filter((m) => normalizar(m.content) === nova).length + 1;
    if (iguais >= REPETICOES_PARA_FREAR) {
      return { freia: true, motivo: `a mesma mensagem chegou ${iguais} vezes` };
    }
  }

  return { freia: false, motivo: null };
}
