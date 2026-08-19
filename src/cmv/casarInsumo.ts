/**
 * Casar uma linha de nota fiscal com um insumo do estoque.
 *
 * Uma escada, do barato e certeiro ao caro e incerto. A IA fica no último
 * degrau de propósito: "TIRAS FRANGO CONG 1KG" e "Tiras de frango" casam por
 * texto normalizado em microssegundos, de graça. Pagar um modelo para
 * confirmar o óbvio é gastar dinheiro e tempo para responder pior.
 *
 * O degrau que mais rende é o APELIDO: cada fornecedor escreve do seu jeito,
 * e o jeito não muda. Casado uma vez à mão, a nota seguinte daquele
 * fornecedor entra sozinha. É o que transforma "conferir nota" de meia hora
 * em dois minutos, a partir da segunda compra.
 */

export interface InsumoConhecido {
  id: string;
  nome: string;
  nomeNormalizado: string;
  codigo: string | null;
  unidade: string;
}

export interface Apelido {
  insumoId: string;
  apelidoNormalizado: string;
}

export type ComoCasou = 'codigo' | 'apelido' | 'nome_exato' | 'nome_parecido' | 'ia' | 'nenhum';

export interface Casamento {
  insumoId: string | null;
  como: ComoCasou;
  /** 0 a 1. Abaixo de CONFIANCA_AUTOMATICA, a tela pede confirmação. */
  confianca: number;
}

/**
 * A partir de quanta confiança o vínculo entra sem alguém olhar.
 *
 * 0.9 e não 0.75: errar o casamento não dá erro na tela — dá entrada de
 * mercadoria no insumo errado, e o estrago só aparece na contagem, semanas
 * depois, como "sumiu frango e sobrou peixe". Confirmar é barato; desfazer
 * não é.
 */
export const CONFIANCA_AUTOMATICA = 0.9;

/** Sem acento, sem pontuação, sem espaço duplo, minúsculo. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Palavras que não distinguem um insumo de outro.
 *
 * Nota fiscal é cheia de embalagem e apresentação: "CX", "PCT", "1KG",
 * "CONG". Comparar com elas dentro faz "FRANGO CONG CX 10KG" parecer mais
 * distante de "Frango" do que realmente é.
 */
const RUIDO = new Set([
  'cx', 'caixa', 'pct', 'pacote', 'fardo', 'fd', 'un', 'und', 'unid', 'unidade',
  'kg', 'g', 'gr', 'l', 'lt', 'ml', 'litro', 'litros',
  'cong', 'congelado', 'congelada', 'resfriado', 'resfriada',
  'de', 'da', 'do', 'e', 'com', 'sem', 'tipo', 'pc',
]);

function palavrasUteis(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((p) => p.length > 1 && !RUIDO.has(p) && !/^\d+$/.test(p));
}

/**
 * Quanto duas descrições se parecem, de 0 a 1.
 *
 * Por palavras em comum, e não por distância de edição: "TILAPIA FILE" e
 * "File de tilapia" são a mesma coisa com a ordem trocada, e a distância de
 * edição entre elas é enorme.
 */
export function semelhanca(a: string, b: string): number {
  const pa = palavrasUteis(a);
  const pb = palavrasUteis(b);
  if (pa.length === 0 || pb.length === 0) return 0;

  const conjuntoB = new Set(pb);
  const comuns = pa.filter((p) => conjuntoB.has(p)).length;

  // Dividido pelo MENOR dos dois: a nota costuma ter mais palavras que o
  // cadastro ("TILAPIA FILE CONG IQF 1KG" vs "Tilápia filé"). Dividir pelo
  // maior puniria o cadastro por ser enxuto, que é como ele deve ser.
  return comuns / Math.min(pa.length, pb.length);
}

/**
 * Casa uma descrição de nota com os insumos já cadastrados.
 *
 * Devolve o degrau em que casou — a tela mostra isso para a pessoa saber o
 * quanto pode confiar sem conferir.
 */
export function casarPorTexto(
  descricao: string,
  codigo: string | null,
  insumos: InsumoConhecido[],
  apelidos: Apelido[],
): Casamento {
  const alvo = normalizar(descricao);

  // 1. Código do fornecedor. Não há como errar.
  if (codigo?.trim()) {
    const porCodigo = insumos.find((i) => i.codigo?.trim() === codigo.trim());
    if (porCodigo) return { insumoId: porCodigo.id, como: 'codigo', confianca: 1 };
  }

  // 2. Apelido aprendido. Alguém já casou esta grafia à mão uma vez.
  const apelido = apelidos.find((a) => a.apelidoNormalizado === alvo);
  if (apelido) return { insumoId: apelido.insumoId, como: 'apelido', confianca: 1 };

  // 3. Nome idêntico depois de normalizar.
  const exato = insumos.find((i) => i.nomeNormalizado === alvo);
  if (exato) return { insumoId: exato.id, como: 'nome_exato', confianca: 0.98 };

  // 4. Parecido. Aqui já é palpite, e a confiança diz o quanto.
  let melhor: { insumo: InsumoConhecido; nota: number } | null = null;
  for (const insumo of insumos) {
    const nota = semelhanca(descricao, insumo.nome);
    if (!melhor || nota > melhor.nota) melhor = { insumo, nota };
  }

  // Abaixo de 0.6 é coincidência de uma palavra genérica, não parecença.
  if (melhor && melhor.nota >= 0.6) {
    return {
      insumoId: melhor.insumo.id,
      como: 'nome_parecido',
      // Teto abaixo do automático: parecença nunca entra sozinha, por melhor
      // que seja a nota. Quem decide é a pessoa ou a IA no degrau seguinte.
      confianca: Math.min(melhor.nota, 0.85),
    };
  }

  return { insumoId: null, como: 'nenhum', confianca: 0 };
}

/**
 * As linhas que sobraram para a IA resolver.
 *
 * Só as que ninguém casou. Mandar a nota inteira para o modelo custaria mais
 * e daria a ele a chance de discordar de um casamento por código, que é
 * certo por definição.
 */
export function pendentes<T>(
  linhas: T[],
  casamentos: Casamento[],
): Array<{ indice: number; linha: T }> {
  return linhas
    .map((linha, indice) => ({ indice, linha }))
    // Linha sem casamento correspondente conta como pendente: um descompasso
    // de tamanho entre as duas listas é bug, e mandar a linha para conferência
    // humana erra menos do que tratá-la como já resolvida.
    .filter(({ indice }) => (casamentos[indice]?.confianca ?? 0) < CONFIANCA_AUTOMATICA);
}
