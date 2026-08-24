import { db } from "./supabase.js";

/**
 * A identidade visual da casa.
 *
 * A pesquisa é a única tela do sistema que o CLIENTE vê. Ele escaneia um QR
 * code na mesa do bar e cai numa página com a logo de outra empresa — e a
 * primeira reação de quem não esperava isso é achar que caiu num golpe, ou no
 * mínimo que a casa terceirizou a opinião dele para um site qualquer.
 *
 * Com a logo do bar e a cor do bar, a pesquisa é do bar. Muda a taxa de
 * resposta e muda o que a pessoa escreve: reclamar "com a casa" é diferente de
 * preencher formulário de fornecedor.
 *
 * A parte de cima do arquivo é só julgamento — cor, contraste, formato de
 * arquivo — e é onde mora a conta que decide se o texto por cima da cor da
 * casa fica legível. O balde de imagens vem depois, no fim.
 */

/** O escuro da marca, usado quando a cor da casa é clara demais para texto branco. */
export const TEXTO_ESCURO = "#191110";
export const TEXTO_CLARO = "#fff8f0";

/**
 * Normaliza a cor que a casa digitou.
 *
 * Aceita `#f4a100`, `f4a100`, `#FA1` — porque ninguém decora que hexadecimal
 * precisa de cerquilha, e recusar por causa dela transformaria "escolher a cor
 * do bar" numa tarefa de programador.
 *
 * Devolve null para o que não é cor, e null aqui significa "usa o padrão da
 * Brasa" — nunca uma cor inventada.
 */
export function corValida(bruta: string | null | undefined): string | null {
  const texto = String(bruta ?? "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(texto)) return `#${texto}`;
  // Forma curta: #fa1 é #ffaa11.
  if (/^[0-9a-f]{3}$/.test(texto)) {
    return `#${texto[0]}${texto[0]}${texto[1]}${texto[1]}${texto[2]}${texto[2]}`;
  }
  return null;
}

/**
 * Luminância relativa, na fórmula do WCAG.
 *
 * Não é a média dos canais: o olho humano enxerga o verde muito mais que o
 * azul, e a média simples diria que um azul forte e um verde forte pedem o
 * mesmo texto por cima — quando o verde já está quase pedindo texto preto.
 */
export function luminancia(hex: string): number {
  const cor = corValida(hex);
  if (!cor) return 0;
  const canal = (i: number): number => {
    const v = parseInt(cor.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

/**
 * Qual cor de texto fica legível EM CIMA desta cor.
 *
 * É a linha entre personalizar e estragar. O bar que escolhe amarelo-ouro para
 * a marca ganha um botão amarelo com letra branca por cima — invisível ao sol,
 * na varanda, que é exatamente onde o cliente responde a pesquisa. A casa não
 * tem como saber disso na hora de escolher a cor; o sistema tem.
 *
 * O corte NÃO é no meio da faixa. É em 0,179, que é onde o contraste com
 * branco e com preto se iguala:
 *
 *     1,05 / (L + 0,05) = (L + 0,05) / 0,05   →   L = 0,179
 *
 * Chutar 0,5 "porque é o meio" erra numa faixa enorme de cores quentes. O
 * próprio laranja da Brasa (#ff6b35) tem luminância 0,32: pelo meio da faixa
 * ele pediria letra branca, que dá 2,8:1 — ilegível —, quando a letra escura
 * dá 7,4:1. É por isso que o botão laranja deste sistema sempre teve texto
 * escuro, e uma conta "razoável" teria invertido isso na primeira casa que
 * escolhesse uma cor quente.
 */
export function textoSobre(cor: string | null | undefined): string {
  const hex = corValida(cor);
  if (!hex) return TEXTO_CLARO;
  return luminancia(hex) > 0.179 ? TEXTO_ESCURO : TEXTO_CLARO;
}

/**
 * Um tom escuro da cor da casa, para o fundo da página.
 *
 * A pesquisa é escura por decisão de projeto — ela é respondida à noite, num
 * salão de luz baixa, e uma tela branca na cara do cliente é agressiva. Tingir
 * o escuro com um pouco da cor da casa personaliza sem clarear.
 */
export function fundoDaCasa(cor: string | null | undefined, base = "#191110"): string {
  const hex = corValida(cor);
  if (!hex) return base;
  const misturar = (i: number): number => {
    const dela = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    const nossa = parseInt(base.slice(1 + i * 2, 3 + i * 2), 16);
    // 12% dela: o suficiente para o olho perceber que a página "é" do bar, e
    // pouco o bastante para o texto claro continuar com contraste de sobra.
    return Math.round(nossa * 0.88 + dela * 0.12);
  };
  const doisDigitos = (n: number) => n.toString(16).padStart(2, "0");
  return `#${doisDigitos(misturar(0))}${doisDigitos(misturar(1))}${doisDigitos(misturar(2))}`;
}

/**
 * A cor da casa clareada até dar para enxergar sobre o fundo escuro.
 *
 * `textoSobre` resolve o caso da cor como FUNDO. Este resolve o inverso, que é
 * igualmente real e menos óbvio: a cor da casa também é usada como traço em
 * cima da página escura — a trilha de progresso, o contorno do campo em foco,
 * o código do cupom.
 *
 * O bar de identidade azul-marinho ou verde-garrafa pinta esses elementos de
 * uma cor quase idêntica ao fundo, e a trilha de progresso simplesmente some.
 * Não é um detalhe estético: a trilha é o que diz à pessoa que a pesquisa está
 * andando e que falta pouco.
 *
 * Clarear em direção ao branco preserva o tom (azul continua azul) enquanto
 * empurra o contraste até 3:1, que é o mínimo do WCAG para elemento gráfico.
 */
export function corLegivelNoEscuro(cor: string | null | undefined, fundo = "#191110"): string | null {
  const hex = corValida(cor);
  if (!hex) return null;

  const lFundo = luminancia(fundo);
  const contraste = (l: number) => (Math.max(l, lFundo) + 0.05) / (Math.min(l, lFundo) + 0.05);

  let atual = hex;
  // Vinte passos de 5%: chega ao branco no pior caso, e para assim que passa
  // do mínimo. Laço fechado de propósito — clarear "até dar" sem teto é como
  // se trava a página do cliente numa conta que não converge.
  for (let passo = 0; passo < 20; passo += 1) {
    if (contraste(luminancia(atual)) >= 3) return atual;
    atual = clarear(atual, 0.05);
  }
  return atual;
}

/** Mistura a cor com branco na proporção dada. */
function clarear(hex: string, quanto: number): string {
  const canal = (i: number): string => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(v + (255 - v) * quanto)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${canal(0)}${canal(1)}${canal(2)}`;
}

/** Os formatos de logo que aceitamos, e a extensão de cada um. */
const FORMATOS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/**
 * A extensão para este tipo de arquivo, ou null se não serve.
 *
 * A lista é curta de propósito. `image/gif` fora porque logo animada numa
 * pesquisa é distração; PDF e Word fora porque é o que a pessoa manda quando
 * confunde "logo" com "arquivo da identidade visual" que o designer entregou.
 */
export function extensaoDaLogo(contentType: string | null | undefined): string | null {
  const tipo = String(contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return FORMATOS[tipo] ?? null;
}

/**
 * Teto do arquivo da logo.
 *
 * 8 MB porque a logo que a casa tem à mão costuma ser a foto do letreiro
 * tirada no celular, e celular novo produz 5 a 10 MB sem esforço. Recusar isso
 * com "no máximo 2 MB" empurra o dono para um editor de imagem que ele não
 * tem — e o resultado prático é a casa ficar sem logo.
 *
 * O painel reduz a imagem antes de mandar, então o arquivo que chega aqui
 * quase sempre é pequeno. Este teto é a rede de baixo, para quem chamar a rota
 * direto.
 */
export const LIMITE_LOGO_BYTES = 8 * 1024 * 1024;

export const BUCKET_MARCAS = "marcas";

/**
 * Guarda a logo e devolve o endereço público dela.
 *
 * O caminho inclui um carimbo de tempo. Sem ele, trocar a logo gravaria por
 * cima do mesmo endereço — e o cache do navegador do cliente continuaria
 * mostrando a antiga por dias, o que na prática é "troquei e não mudou nada".
 */
export async function guardarLogo(params: {
  venueId: string;
  arquivo: Buffer;
  contentType: string;
}): Promise<string> {
  const extensao = extensaoDaLogo(params.contentType);
  if (!extensao) {
    throw new Error("Mande a logo em PNG, JPG, WEBP ou SVG.");
  }
  if (params.arquivo.length === 0) throw new Error("O arquivo chegou vazio.");
  if (params.arquivo.length > LIMITE_LOGO_BYTES) {
    throw new Error("A logo precisa ter no máximo 8 MB.");
  }

  const caminho = `${params.venueId}/logo-${Date.now()}.${extensao}`;
  const { error } = await db()
    .storage.from(BUCKET_MARCAS)
    .upload(caminho, params.arquivo, { contentType: params.contentType, upsert: true });
  if (error) throw new Error(`Falha ao guardar a logo: ${error.message}`);

  const { data } = db().storage.from(BUCKET_MARCAS).getPublicUrl(caminho);
  return data.publicUrl;
}

/**
 * Apaga a logo antiga do balde.
 *
 * Nunca lança: a logo nova já está gravada e o endereço já mudou quando isto
 * roda. Falhar em apagar a antiga custa alguns kilobytes; deixar o erro subir
 * faria a troca "dar errado" depois de ter dado certo.
 */
export async function apagarLogoAntiga(urlAntiga: string | null | undefined): Promise<void> {
  const caminho = caminhoDaUrl(urlAntiga);
  if (!caminho) return;
  try {
    await db().storage.from(BUCKET_MARCAS).remove([caminho]);
  } catch (e) {
    console.error(`[marca] logo antiga não saiu: ${(e as Error).message}`);
  }
}

/**
 * O caminho dentro do balde, a partir da URL pública.
 *
 * Exportada para teste: é uma leitura de string que, errada, apagaria o
 * arquivo errado — ou nenhum, calada.
 */
export function caminhoDaUrl(url: string | null | undefined): string | null {
  const texto = String(url ?? "");
  const marca = `/${BUCKET_MARCAS}/`;
  const corte = texto.indexOf(marca);
  if (corte === -1) return null;
  const caminho = texto.slice(corte + marca.length).split("?")[0]!;
  // Precisa ser "<uuid da casa>/<arquivo>". Sem a barra não é caminho nosso.
  return caminho.includes("/") ? caminho : null;
}
