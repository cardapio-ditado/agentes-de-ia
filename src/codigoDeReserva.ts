/**
 * O código curto que identifica uma reserva numa conversa de WhatsApp.
 *
 * Vive sozinho num arquivo de uma função por um motivo chato mas real: quem
 * MONTA o aviso (`reservationFlow`) e quem LÊ a resposta (`comandosDeReserva`)
 * precisam do mesmo código, e esses dois já se importam em sentido contrário.
 * Deixar a função em qualquer um dos dois fecharia um ciclo de importação —
 * que hoje funcionaria por sorte, e quebraria no dia em que alguém usasse o
 * valor durante a carga do módulo.
 *
 * Quatro caracteres hexadecimais: 65 mil combinações para uma casa que tem
 * meia dúzia de reservas pendentes por vez, e nenhum caractere ambíguo — o
 * hexadecimal não tem O nem I para confundir com zero e um quando o código é
 * lido em voz alta.
 */
export function codigoDaReserva(reservationId: string): string {
  return reservationId.replace(/-/g, "").slice(0, 4).toUpperCase();
}
