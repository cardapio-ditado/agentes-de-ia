/**
 * RH — o perfil comportamental DISC.
 *
 * A teoria é de William Marston (1928) e é de domínio público: quatro jeitos
 * de agir que todo mundo tem em doses diferentes —
 *
 *   D  Dominância   — vai direto ao resultado, decide rápido, gosta de desafio.
 *   I  Influência   — puxa conversa, anima o ambiente, convence.
 *   S  Estabilidade — constante, paciente, bom parceiro, gosta de rotina.
 *   C  Conformidade — cuidadoso, organizado, gosta de fazer certo.
 *
 * O questionário aqui é PRÓPRIO do Brasa Food (não é o Everything DiSC nem
 * outro teste com marca registrada): 24 blocos de quatro palavras simples,
 * e a pessoa escolhe a que MAIS e a que MENOS combina com ela no trabalho.
 *
 * O que o DISC NÃO é, e a tela diz isso: teste de inteligência, de caráter,
 * nem critério para contratar ou demitir. Serve para a liderança entender
 * como falar com cada um, e para montar a equipe com jeitos que se completam.
 */

export type Fator = "d" | "i" | "s" | "c";

/** Cada bloco: [D, I, S, C], sempre nesta ordem (a tela embaralha). */
export const BLOCOS: Array<[string, string, string, string]> = [
  ["Decidido", "Animado", "Paciente", "Cuidadoso"],
  ["Direto", "Falante", "Calmo", "Organizado"],
  ["Competitivo", "Simpático", "Leal", "Detalhista"],
  ["Corajoso", "Divertido", "Tranquilo", "Preciso"],
  ["Firme", "Entusiasmado", "Prestativo", "Caprichoso"],
  ["Ousado", "Comunicativo", "Compreensivo", "Disciplinado"],
  ["Determinado", "Alegre", "Estável", "Exigente comigo mesmo"],
  ["Decido rápido", "Faço amizade fácil", "Sei ouvir", "Sigo as regras"],
  ["Gosto de desafio", "Gosto de gente", "Gosto de rotina", "Gosto de tudo certinho"],
  ["Assumo o comando", "Convenço fácil", "Evito briga", "Penso antes de agir"],
  ["Independente", "Otimista", "Constante", "Correto"],
  ["Objetivo", "Expressivo", "Gentil", "Cauteloso"],
  ["Ambicioso", "Espontâneo", "Confiável", "Metódico"],
  ["Prático", "Inspiro os outros", "Sereno", "Analítico"],
  ["Resolvo na hora", "Animo o ambiente", "Ajudo os colegas", "Confiro tudo"],
  ["Falo o que penso", "Gosto de conversar", "Gosto de paz", "Gosto de fazer bem feito"],
  ["Persistente", "Persuasivo", "Dedicado", "Perfeccionista"],
  ["Enérgico", "Brincalhão", "Sossegado", "Reservado"],
  ["Arrisco", "Improviso", "Mantenho o ritmo", "Planejo"],
  ["Líder", "Animador", "Parceiro", "Especialista"],
  ["Fico impaciente com demora", "Esqueço detalhes", "Demoro a aceitar mudança", "Fico incomodado com erro"],
  ["Quero resultado", "Quero reconhecimento", "Quero segurança", "Quero qualidade"],
  ["Assertivo", "Carismático", "Atencioso", "Sistemático"],
  ["Vou direto ao ponto", "Conto histórias", "Escuto com atenção", "Pergunto os detalhes"],
];

const FATORES: Fator[] = ["d", "i", "s", "c"];

export interface Resposta {
  /** Índice (0–3) da palavra que MAIS combina. */
  mais: number;
  /** Índice (0–3) da que MENOS combina. */
  menos: number;
}

export interface ResultadoDisc {
  d: number;
  i: number;
  s: number;
  c: number;
  perfil: string;
}

/**
 * A conta: "mais" soma 1 no fator da palavra, "menos" tira 1. Cada fator vai
 * de −24 a +24, e vira 0–100 para o gráfico. O perfil é o fator mais alto, e
 * o segundo junto quando está a até 12 pontos dele (o "DI", o "SC").
 */
export function calcularDisc(respostas: Resposta[]): ResultadoDisc {
  if (!Array.isArray(respostas) || respostas.length !== BLOCOS.length) {
    throw new Error(`Responda os ${BLOCOS.length} blocos.`);
  }
  const bruto: Record<Fator, number> = { d: 0, i: 0, s: 0, c: 0 };
  respostas.forEach((r, n) => {
    const mais = Number(r?.mais);
    const menos = Number(r?.menos);
    if (![0, 1, 2, 3].includes(mais) || ![0, 1, 2, 3].includes(menos)) throw new Error(`Bloco ${n + 1} sem resposta.`);
    if (mais === menos) throw new Error(`No bloco ${n + 1}, a que mais e a que menos combina precisam ser diferentes.`);
    bruto[FATORES[mais]!] += 1;
    bruto[FATORES[menos]!] -= 1;
  });
  const total = BLOCOS.length;
  const escala = (v: number) => Math.round(((v + total) / (2 * total)) * 100);
  const notas = { d: escala(bruto.d), i: escala(bruto.i), s: escala(bruto.s), c: escala(bruto.c) };
  const ordem = [...FATORES].sort((a, b) => notas[b] - notas[a]);
  const [primeiro, segundo] = ordem as [Fator, Fator];
  const perfil = (notas[primeiro] - notas[segundo] <= 12 ? `${primeiro}${segundo}` : primeiro).toUpperCase();
  return { ...notas, perfil };
}

/** O que cada fator quer dizer, na língua de quem trabalha em restaurante. */
export const SOBRE_O_FATOR: Record<Fator, {
  nome: string;
  resumo: string;
  fortes: string;
  cuidado: string;
  liderar: string;
  feedback: string;
  rende: string;
}> = {
  d: {
    nome: "Dominância — o executor",
    resumo: "Vai direto ao resultado. Decide rápido, gosta de desafio e de ter autonomia.",
    fortes: "Resolve problema na hora do aperto, assume a frente quando a casa lota, não tem medo de cobrar.",
    cuidado: "Pode atropelar os colegas e ficar impaciente com quem é mais lento. Às vezes esquece o jeito de falar.",
    liderar: "Dê metas claras e liberdade para chegar lá. Explique o porquê em uma frase; detalhe demais irrita.",
    feedback: "Seja direto e curto, com o fato e o resultado esperado. Rodeio ele entende como fraqueza.",
    rende: "Chefe de praça, líder de turno, caixa em hora de pico, quem resolve reclamação na hora.",
  },
  i: {
    nome: "Influência — o comunicador",
    resumo: "Puxa conversa, anima o ambiente e convence. Gosta de gente e de reconhecimento.",
    fortes: "Encanta o cliente, vende a sobremesa e o drink, levanta a equipe numa noite cansada.",
    cuidado: "Pode se distrair, esquecer detalhe (a comanda, o pedido sem cebola) e prometer mais do que dá.",
    liderar: "Reconheça em público, dê espaço para falar. Combine os detalhes por escrito — um checklist ajuda muito.",
    feedback: "Comece pelo que ele faz bem, de verdade. O ajuste vai em seguida, com um exemplo prático.",
    rende: "Salão, recepção, atendimento de mesa, venda e eventos.",
  },
  s: {
    nome: "Estabilidade — o parceiro",
    resumo: "Constante, paciente e leal. Gosta de rotina, de harmonia e de ajudar os colegas.",
    fortes: "Segura o serviço no mesmo ritmo a noite inteira, é o colega que todo mundo quer do lado, raramente falta.",
    cuidado: "Pode demorar a aceitar mudança e guardar incômodo para não criar conflito.",
    liderar: "Avise mudanças com antecedência e explique o motivo. Mostre como fazer em vez de só mandar.",
    feedback: "Em particular, com calma e segurança. Pergunte o que ele acha — ele não vai falar se não for perguntado.",
    rende: "Cozinha, copa, bar em ritmo de rotina, apoio do salão, treinar quem chegou.",
  },
  c: {
    nome: "Conformidade — o cuidadoso",
    resumo: "Organizado, preciso e exigente com a qualidade. Gosta de regra clara e de fazer certo.",
    fortes: "Ficha técnica seguida à risca, estoque conferido, higiene em dia, caixa que fecha sem diferença.",
    cuidado: "Pode ser lento para decidir sem todas as informações e crítico demais com o erro dos outros.",
    liderar: "Dê a regra, o padrão e o prazo. Responda as perguntas dele — é assim que ele faz bem feito.",
    feedback: "Com fatos e números, sem emoção. Mostre o padrão esperado e onde ficou a diferença.",
    rende: "Estoque e compras, confeitaria, caixa, controle de qualidade, abertura e fechamento.",
  },
};

/** Lê o perfil ("DI") e devolve as descrições dos fatores dele, na ordem. */
export function descreverPerfil(perfil: string) {
  return [...String(perfil ?? "").toLowerCase()]
    .filter((f): f is Fator => FATORES.includes(f as Fator))
    .map((f) => ({ fator: f.toUpperCase(), ...SOBRE_O_FATOR[f] }));
}

/**
 * O mapa da equipe: quantos de cada fator principal, e o que falta. Uma
 * equipe só de "I" é animada e esquece a comanda; só de "C" é certinha e
 * fria com o cliente.
 */
export function mapaDaEquipe(perfis: Array<{ perfil: string }>): { contagem: Record<string, number>; observacoes: string[] } {
  const contagem: Record<string, number> = { D: 0, I: 0, S: 0, C: 0 };
  for (const p of perfis) {
    const principal = String(p.perfil ?? "")[0]?.toUpperCase();
    if (principal && principal in contagem) contagem[principal]! += 1;
  }
  const total = perfis.length;
  const observacoes: string[] = [];
  if (total >= 4) {
    if (!contagem.D) observacoes.push("Ninguém com D forte: na hora do aperto, falta quem assuma a frente e decida.");
    if (!contagem.I) observacoes.push("Ninguém com I forte: o atendimento pode ficar correto, mas frio — e a venda adicional sofre.");
    if (!contagem.S) observacoes.push("Ninguém com S forte: falta quem segure o ritmo e dê estabilidade à equipe.");
    if (!contagem.C) observacoes.push("Ninguém com C forte: falta quem cuide do detalhe — ficha técnica, estoque, higiene, caixa.");
    for (const [fator, n] of Object.entries(contagem)) {
      if (n / total > 0.6) observacoes.push(`Mais da metade da equipe é ${fator}: bom para o que esse perfil faz bem, mas vale equilibrar nas próximas contratações.`);
    }
  }
  return { contagem, observacoes };
}
