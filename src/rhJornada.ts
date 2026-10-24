/**
 * RH — a jornada pela ESCALA, e não pelo relógio de ponto.
 *
 * O ponto digital saiu do produto: tablet na parede, PIN e batida eram mais
 * uma coisa para a casa do interior manter funcionando, e quase ninguém
 * usava. O que a casa já preenche é a escala — quem trabalha em que turno —
 * e é dela que saem as horas do rateio da gorjeta e do resumo do mês.
 *
 * São horas PREVISTAS, e o resumo para o contador diz isso. Atraso e falta
 * passam a ser o que o gerente registra (falta na escala, atraso como
 * ocorrência), que é o que vale numa conversa trabalhista de qualquer jeito.
 */

/** "18:00" ou "18:00:00" → minutos desde a meia-noite. */
function minutoDoDia(hora: string): number {
  const [h, m] = String(hora ?? "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Duração do turno em minutos. Turno que passa da meia-noite (18h–2h) vale 8h. */
export function minutosDoTurno(inicio: string, fim: string): number {
  const a = minutoDoDia(inicio);
  const b = minutoDoDia(fim);
  return b > a ? b - a : b + 24 * 60 - a;
}

/**
 * Minutos do turno dentro do horário noturno urbano da CLT (22h às 5h).
 * Sem fuso: a escala já está no relógio da casa.
 */
export function minutosNoturnosDoTurno(inicio: string, fim: string): number {
  const a = minutoDoDia(inicio);
  const duracao = minutosDoTurno(inicio, fim);
  let noturno = 0;
  // Minuto a minuto seria lento demais para um mês; por janelas basta.
  const janelas: Array<[number, number]> = [
    [22 * 60, 29 * 60], // 22h de hoje às 5h de amanhã
    [-2 * 60, 5 * 60], // a janela que começou ontem às 22h
    [46 * 60, 53 * 60], // a de amanhã, para turno muito longo
  ];
  for (const [abre, fecha] of janelas) {
    const inicioDaSobreposicao = Math.max(a, abre);
    const fimDaSobreposicao = Math.min(a + duracao, fecha);
    if (fimDaSobreposicao > inicioDaSobreposicao) noturno += fimDaSobreposicao - inicioDaSobreposicao;
  }
  return noturno;
}

export function emHoras(minutos: number): string {
  const h = Math.floor(Math.abs(minutos) / 60);
  const m = Math.abs(minutos) % 60;
  const sinal = minutos < 0 ? "-" : "";
  return m === 0 ? `${sinal}${h}h` : `${sinal}${h}h${String(m).padStart(2, "0")}`;
}
