/**
 * O que os clientes repetem — e se repetem elogiando ou reclamando.
 *
 * Ler duzentos comentários um a um ninguém lê. A nuvem existe para responder
 * de relance a pergunta que o dono realmente tem: "o que estão falando da
 * minha casa?". Termo grande é termo repetido.
 *
 * A parte que quase todo mundo erra é a cor. Uma nuvem que só mostra tamanho
 * põe "demora" e "delicioso" lado a lado do mesmo jeito, e o dono comemora a
 * palavra que era reclamação. Aqui cada termo carrega a NOTA MÉDIA de quem o
 * escreveu: "demora" aparece vermelho porque quem escreveu deu 4, "delicioso"
 * verde porque quem escreveu deu 10. É a mesma nuvem contando duas coisas.
 */

export interface ComentarioParaNuvem {
  texto: string | null;
  /** A nota da resposta em que este comentário veio, 0 a 10. */
  nota: number;
}

export interface TermoDaNuvem {
  termo: string;
  /** Em quantos comentários apareceu (não quantas vezes ao todo). */
  mencoes: number;
  /** Média das notas de quem escreveu o termo. */
  notaMedia: number;
  /** elogio: nota média >= 9 · critica: <= 6 · neutro: entre os dois. */
  tom: "elogio" | "neutro" | "critica";
}

/**
 * Palavras que aparecem em tudo e não dizem nada sobre a casa.
 *
 * Sem esta lista, a nuvem de qualquer bar do Brasil é a mesma: "de", "muito",
 * "não", "foi". Verbo genérico e advérbio entram aqui pelo mesmo motivo.
 */
const VAZIAS = new Set([
  // artigos, preposições, conjunções, pronomes
  "a", "à", "às", "ao", "aos", "as", "o", "os", "um", "uma", "uns", "umas",
  "de", "da", "do", "das", "dos", "em", "na", "no", "nas", "nos", "num", "numa",
  "por", "pra", "para", "pro", "pela", "pelo", "pelas", "pelos", "com", "sem",
  "sobre", "entre", "até", "desde", "após", "e", "ou", "mas", "porém", "que",
  "porque", "pois", "se", "como", "quando", "onde", "então", "também", "já",
  "eu", "me", "mim", "meu", "minha", "nós", "nosso", "nossa", "você", "voce",
  "vocês", "voces", "seu", "sua", "ele", "ela", "eles", "elas", "lhe", "nos",
  "isso", "isto", "aquilo", "esse", "essa", "este", "esta", "aquele", "aquela",
  "tudo", "todo", "toda", "todos", "todas", "algum", "alguma", "nada", "ninguém",
  // verbos e advérbios que não distinguem uma casa da outra
  "é", "foi", "era", "ser", "sou", "são", "estar", "está", "esta", "estava",
  "ter", "tem", "tinha", "teve", "ir", "vai", "foram", "fui", "fica", "ficou",
  "fazer", "faz", "fez", "dar", "dá", "deu", "ver", "vi", "achei", "acho",
  "muito", "muita", "muitos", "muitas", "mais", "menos", "bem", "mal", "aqui",
  "lá", "só", "ainda", "sempre", "nunca", "hoje", "ontem", "agora", "depois",
  "antes", "não", "nao", "sim", "pouco", "quase", "bastante", "super", "mto",
  "gente", "vez", "vezes", "dia", "noite", "hora", "coisa", "coisas", "lugar",
  "mesmo", "mesma", "mesmos", "mesmas", "assim", "cada", "outro", "outra",
  "outros", "outras", "tá", "ta", "né", "ne", "pq", "aí", "ai", "além", "alem",
  "vou", "quero", "queria", "dava", "deram", "gostei", "gostaria", "senti",
  // cortesias que aparecem em metade dos comentários
  "obrigado", "obrigada", "parabéns", "parabens", "abraço", "abracos", "valeu",
]);

/** Um termo com menos que isto é ruído de digitação, não assunto. */
const MINIMO_LETRAS = 3;

/**
 * Palavras curtas que, apesar de curtas, SÃO o assunto de um bar.
 *
 * Sem esta exceção, o corte por tamanho apagaria justamente o que mais
 * importa numa casa de shows.
 */
const CURTAS_QUE_VALEM = new Set(["som", "gás", "gas", "luz", "fila", "gelo", "chá", "cha", "pf"]);

/**
 * Formas diferentes da mesma reclamação.
 *
 * "demorou", "demora" e "demorado" são um assunto só, e separados eles nunca
 * ficam grandes o bastante para o dono reparar. O mapa é curto de propósito:
 * cobre o que um bar ouve, sem virar um radicalizador de português inteiro —
 * que erraria em silêncio nos casos que não previu.
 */
const SINONIMOS: Record<string, string> = {
  demorou: "demora", demorado: "demora", demorada: "demora", demoraram: "demora",
  demorando: "demora", lento: "demora", lentidão: "demora", lentidao: "demora",
  atendente: "atendimento", garcom: "atendimento", garçom: "atendimento",
  garçons: "atendimento", garcons: "atendimento", atendeu: "atendimento",
  atenciosa: "atencioso", atenciosos: "atencioso", atenciosas: "atencioso",
  simpatica: "simpático", simpática: "simpático", simpaticos: "simpático",
  simpáticos: "simpático", simpaticas: "simpático", simpáticas: "simpático",
  educada: "educado", educados: "educado", educadas: "educado",
  comida: "comida", comidas: "comida", prato: "comida", pratos: "comida",
  cerveja: "cerveja", cervejas: "cerveja", chopp: "chopp", chope: "chopp",
  chopps: "chopp", chopes: "chopp", gelada: "gelado", geladas: "gelado",
  gelados: "gelado", quente: "quente", quentes: "quente",
  caro: "caro", cara: "caro", caros: "caro", caras: "caro", caríssimo: "caro",
  carissimo: "caro", preço: "preço", preco: "preço", precos: "preço",
  preços: "preço",
  musica: "música", musicas: "música", músicas: "música", banda: "música",
  bandas: "música", show: "música", shows: "música",
  limpo: "limpeza", limpa: "limpeza", limpos: "limpeza", limpas: "limpeza",
  sujo: "sujeira", suja: "sujeira", sujos: "sujeira", sujas: "sujeira",
  otimo: "ótimo", otima: "ótimo", ótima: "ótimo", otimos: "ótimo",
  ótimos: "ótimo", otimas: "ótimo", ótimas: "ótimo",
  excelentes: "excelente", maravilhosa: "maravilhoso",
  maravilhosos: "maravilhoso", maravilhosas: "maravilhoso",
  delicia: "delícia", delicias: "delícia", delícias: "delícia",
  delicioso: "delícia", deliciosa: "delícia", deliciosos: "delícia",
  deliciosas: "delícia",
  boa: "bom", bons: "bom", boas: "bom",
  ruins: "ruim", pessima: "péssimo", péssima: "péssimo", pessimo: "péssimo",
  pessimos: "péssimo", péssimos: "péssimo",
  banheiros: "banheiro", mesas: "mesa", ambientes: "ambiente",
  porcao: "porção", porcoes: "porção", porções: "porção",
};

/** Só para comparar: "Ótimo" e "otimo" são a mesma palavra. */
function semAcento(palavra: string): string {
  return palavra.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * As palavras aproveitáveis de um comentário, sem repetição.
 *
 * Sem repetição de propósito: quem escreve "muito bom, bom mesmo, tudo bom"
 * não vale três clientes falando de "bom". A nuvem conta PESSOAS, não
 * teclas — senão um comentário longo domina a tela sozinho.
 */
export function termosDoComentario(texto: string): string[] {
  const encontrados = new Set<string>();

  for (const cru of texto.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!cru) continue;

    // Número solto ("10", "2") não é assunto.
    if (!/\p{L}/u.test(cru)) continue;

    const termo = SINONIMOS[cru] ?? SINONIMOS[semAcento(cru)] ?? cru;
    if (VAZIAS.has(termo) || VAZIAS.has(semAcento(termo))) continue;
    if (termo.length < MINIMO_LETRAS && !CURTAS_QUE_VALEM.has(termo)) continue;

    encontrados.add(termo);
  }

  return [...encontrados];
}

/**
 * A nuvem inteira, já ordenada do mais falado para o menos.
 *
 * `minimoMencoes` existe para a nuvem não ser feita de palavras que uma
 * pessoa só escreveu: dois clientes falando a mesma coisa é assunto, um é
 * opinião.
 */
export function nuvemDePalavras(
  comentarios: ComentarioParaNuvem[],
  { limite = 40, minimoMencoes = 2 } = {},
): TermoDaNuvem[] {
  const acumulado = new Map<string, { mencoes: number; soma: number }>();

  for (const c of comentarios) {
    if (!c.texto?.trim()) continue;
    for (const termo of termosDoComentario(c.texto)) {
      const atual = acumulado.get(termo) ?? { mencoes: 0, soma: 0 };
      atual.mencoes += 1;
      atual.soma += c.nota;
      acumulado.set(termo, atual);
    }
  }

  // Com pouquíssimo comentário, exigir duas menções devolve uma nuvem vazia e
  // a tela parece quebrada. Nesse caso vale mais mostrar o que tem.
  const total = comentarios.filter((c) => c.texto?.trim()).length;
  const corte = total < 8 ? 1 : minimoMencoes;

  const termos: TermoDaNuvem[] = [];
  for (const [termo, { mencoes, soma }] of acumulado) {
    if (mencoes < corte) continue;
    const notaMedia = soma / mencoes;
    termos.push({
      termo,
      mencoes,
      notaMedia: Math.round(notaMedia * 10) / 10,
      tom: notaMedia >= 9 ? "elogio" : notaMedia <= 6 ? "critica" : "neutro",
    });
  }

  // Mais falado primeiro; empate desempata pelo termo, para a nuvem não
  // dançar entre dois carregamentos com os mesmos dados.
  termos.sort((a, b) => b.mencoes - a.mencoes || a.termo.localeCompare(b.termo));
  return termos.slice(0, limite);
}
