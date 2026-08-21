/**
 * Converter "22/08 às 20h no relógio da casa" para um instante.
 *
 * O banco guarda instantes (`timestamptz`), e quem digita a agenda pensa em
 * horário local: "sábado, 20h". Entre os dois há um pulo que só é invisível
 * para quem trabalha em UTC — em Cuiabá, 20h de sábado é meia-noite de
 * domingo em UTC, e errar isso põe o show no dia errado do calendário.
 *
 * Sem biblioteca de datas: `Intl` já sabe todos os fusos e os horários de
 * verão de cada ano, e é o que o resto do painel usa.
 */

/**
 * Quantos milissegundos este fuso está à frente do UTC NESTE instante.
 *
 * O deslocamento não é fixo por fuso: depende da data, por causa do horário
 * de verão. Por isso a pergunta é sempre "quanto era o deslocamento naquele
 * momento", nunca "quanto é o deslocamento deste lugar".
 */
export function deslocamentoDoFuso(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);

  const parte = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");

  // A mesma parede de relógio, lida como se fosse UTC. A diferença para o
  // instante original é exatamente o deslocamento do fuso.
  const comoSeFosseUtc = Date.UTC(
    parte("year"),
    parte("month") - 1,
    parte("day"),
    parte("hour"),
    parte("minute"),
    parte("second"),
  );
  return comoSeFosseUtc - instante.getTime();
}

/**
 * "2026-08-22" + "20:00" no fuso da casa → instante em ISO/UTC.
 *
 * O deslocamento é calculado DUAS vezes: a primeira estimativa usa o palpite
 * ingênuo, e a segunda confere com a data já corrigida. Sem isso, um horário
 * perto da virada do horário de verão sai uma hora errado — o cálculo teria
 * usado o deslocamento do dia errado.
 */
export function instanteNaCasa(data: string, hora: string, fuso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error(`Data inválida: "${data}".`);
  if (!/^\d{2}:\d{2}$/.test(hora)) throw new Error(`Hora inválida: "${hora}".`);

  const ingenuo = Date.parse(`${data}T${hora}:00Z`);
  if (Number.isNaN(ingenuo)) throw new Error(`Data e hora inválidas: "${data} ${hora}".`);

  let instante = ingenuo - deslocamentoDoFuso(new Date(ingenuo), fuso);
  instante = ingenuo - deslocamentoDoFuso(new Date(instante), fuso);
  return new Date(instante).toISOString();
}

/**
 * Que dia é hoje no calendário da casa.
 *
 * Serve de referência para a IA completar "sexta que vem" e o ano que o cartaz
 * não diz. Lido em UTC, das 20h à meia-noite de Cuiabá o servidor já estaria
 * no dia seguinte — e a agenda do sábado viraria domingo.
 */
export function hojeNaCasa(fuso: string, agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/**
 * O fim de um evento que pode virar a noite.
 *
 * "20h às 00h" e "23h às 1h" são a vida de um bar: a hora final MENOR que a
 * inicial significa o dia seguinte. Tratada como o mesmo dia, a duração fica
 * negativa e o evento some das buscas por período.
 */
export function fimDoEvento(
  data: string,
  inicio: string,
  fim: string,
  fuso: string,
): string {
  const mesmoDia = instanteNaCasa(data, fim, fuso);
  if (Date.parse(mesmoDia) > Date.parse(instanteNaCasa(data, inicio, fuso))) return mesmoDia;

  const seguinte = new Date(`${data}T12:00:00Z`);
  seguinte.setUTCDate(seguinte.getUTCDate() + 1);
  return instanteNaCasa(seguinte.toISOString().slice(0, 10), fim, fuso);
}
