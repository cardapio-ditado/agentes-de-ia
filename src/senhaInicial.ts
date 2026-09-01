import { randomInt } from "node:crypto";

/**
 * A senha que alguém vai DITAR por telefone.
 *
 * Ela tem duas exigências que puxam para lados opostos: precisa ser fácil de
 * falar em voz alta ("é brasa, traço, forno, traço, quatro oito dois um") e
 * precisa ser difícil de adivinhar. Palavra do dicionário resolve a primeira
 * e destrói a segunda — a menos que o espaço de sorteio seja grande o
 * bastante para compensar.
 *
 * A primeira versão tinha 8 palavras e 4 dígitos: 72 mil combinações. Isso é
 * pouco. Não é "pouco na teoria" — é a quantidade de tentativas que um
 * programa comum faz enquanto alguém toma um café.
 *
 * Duas palavras de uma lista de 32 mais 4 dígitos dão 9,2 milhões, e a frase
 * continua cabendo numa ligação. O ganho real, porém, veio do sorteio: o
 * `Math.random` de antes é PREVISÍVEL. Quem obtém uma senha gerada consegue
 * calcular as próximas. `randomInt` é o sorteio do sistema operacional, o
 * mesmo que gera os tokens de sessão.
 *
 * Isto mora sozinho num arquivo de propósito: estava duplicado em dois
 * lugares, e função de segurança duplicada é função que só é corrigida na
 * metade dos lugares.
 */

/** Palavras da casa: curtas, sem acento e sem par que se confunda ao telefone. */
const PALAVRAS = [
  "brasa", "fogo", "forno", "grelha", "carvao", "chama", "sabor", "tempero",
  "picanha", "costela", "chopp", "balcao", "salao", "cozinha", "praca", "mesa",
  "porta", "janela", "banco", "copo", "prato", "faca", "garfo", "panela",
  "alho", "cebola", "limao", "pimenta", "sal", "azeite", "manteiga", "farinha",
];

/**
 * Senha inicial legível: o dono vai ditar isto por telefone, e a pessoa troca
 * no primeiro acesso.
 */
export function senhaLegivel(): string {
  const primeira = PALAVRAS[randomInt(PALAVRAS.length)]!;

  // Duas palavras iguais viram uma só na cabeça de quem ouve ("brasa-brasa"
  // é digitado como "brasa" mais vezes do que se imagina), e ainda encolhem
  // o sorteio sem que ninguém perceba.
  let segunda = PALAVRAS[randomInt(PALAVRAS.length)]!;
  while (segunda === primeira) segunda = PALAVRAS[randomInt(PALAVRAS.length)]!;

  const numero = String(randomInt(1000, 10_000));
  return `${primeira}-${segunda}-${numero}`;
}
