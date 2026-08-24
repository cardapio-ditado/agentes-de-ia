import { db } from "./supabase.js";

/**
 * O aviso de nota ruim, na hora que ela entra.
 *
 * O painel só fala com quem abre o painel. O cliente que deu 3 e escreveu
 * "esperei 40 minutos" vai embora achando que ninguém leu — e tem razão, porque
 * ninguém leu até alguém lembrar de olhar a tela.
 *
 * Uma nota ruim é a única reclamação que chega antes do estrago. Quem recebe na
 * mesma noite ainda liga, pede desculpa e recupera o cliente; quem recebe na
 * segunda-feira só descobre por que a mesa 12 nunca mais voltou.
 *
 * ---
 *
 * POR QUE O DIAGNÓSTICO NÃO PASSA POR IA.
 *
 * Seria tentador mandar o comentário para o modelo resumir "do que ele
 * reclamou". Mas o que o cliente reclamou já está escrito, com as palavras
 * dele, e as notas por categoria já dizem onde afundou. Resumir isso adiciona
 * latência, custo e uma chance de a máquina inventar uma reclamação que o
 * cliente não fez — sobre uma pessoa real, num aviso que vai virar conversa
 * com ela. O texto vai cru e completo; quem lê é dono de bar, não precisa de
 * tradução.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const cliente = () => db() as any;

export const TEMPLATE_DETRATOR = "pesquisa_detrator";

/**
 * Esta nota merece aviso?
 *
 * Separada e pura porque é a decisão que define quantas mensagens o dono
 * recebe por semana — e aviso demais é indistinguível de aviso nenhum, já que
 * os dois terminam com a conversa silenciada.
 */
export function ehDetrator(nota: number, limite: number): boolean {
  if (!Number.isFinite(nota)) return false;
  return nota <= corteValido(limite);
}

/** Limite fora da faixa é engano de configuração; na dúvida, a régua do NPS. */
function corteValido(limite: number): number {
  return Number.isFinite(limite) && limite >= 0 && limite <= 10 ? limite : 6;
}

export interface CategoriaEmAlerta {
  categoria: string;
  media: number;
}

/**
 * A média de tudo o que o cliente pontuou nesta resposta.
 *
 * NÃO é a nota da avaliação — essa é a pergunta de recomendação, e tem de
 * continuar sendo, porque é o que torna o NPS comparável com o de qualquer
 * outra casa. Esta é a outra metade: "como foi a experiência dele", somando
 * comida, atendimento, ambiente e o resto.
 *
 * As duas discordam com frequência, e é aí que ficam interessantes: nota 9 com
 * experiência 5 é o cliente que gosta da casa e teve uma noite ruim.
 *
 * Null quando não houve nada a pontuar — pesquisa só de perguntas abertas, ou
 * cliente que pulou tudo. Null e não zero: zero significaria péssimo.
 */
export function mediaDaExperiencia(categorias: CategoriaDaResposta[]): number | null {
  const notas = (categorias ?? [])
    .map((c) => c.nota)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (notas.length === 0) return null;
  return Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 10) / 10;
}

/**
 * As categorias cuja média ficou no chão, da pior para a menos pior.
 *
 * Existe porque a nota de recomendação esconde estrago. O cliente que dá 8 na
 * recomendação — "eu indicaria, o lugar é bom" — pode ter dado 2 em Tempo de
 * espera. Ninguém era avisado desse cliente, e ele é justamente o que a casa
 * ainda consegue resolver: o problema é pontual e tem nome.
 *
 * Média por CATEGORIA e não por pergunta: uma pergunta ruim isolada dentro de
 * um assunto que vai bem é ruído, e avisar a cada uma delas ensina o dono a
 * ignorar o aviso.
 */
export function categoriasEmAlerta(
  categorias: CategoriaDaResposta[],
  limite: number,
): CategoriaEmAlerta[] {
  const corte = corteValido(limite);
  const soma = new Map<string, { total: number; quantas: number }>();

  for (const item of categorias ?? []) {
    if (typeof item.nota !== "number" || !Number.isFinite(item.nota)) continue;
    const atual = soma.get(item.categoria) ?? { total: 0, quantas: 0 };
    atual.total += item.nota;
    atual.quantas += 1;
    soma.set(item.categoria, atual);
  }

  return [...soma.entries()]
    .map(([categoria, s]) => ({
      categoria,
      media: Math.round((s.total / s.quantas) * 10) / 10,
    }))
    .filter((c) => c.media <= corte)
    .sort((a, b) => a.media - b.media);
}

/**
 * Esta resposta merece aviso?
 *
 * Duas portas, e basta uma: a nota de recomendação no chão, OU qualquer
 * categoria no chão. Exigir as duas deixaria passar exatamente o cliente que
 * mais dá para recuperar — o que gosta da casa e teve um problema com nome e
 * endereço.
 */
export function mereceAviso(params: {
  nota: number;
  categorias: CategoriaDaResposta[];
  limite: number;
}): boolean {
  if (ehDetrator(params.nota, params.limite)) return true;
  return categoriasEmAlerta(params.categorias, params.limite).length > 0;
}

export interface CategoriaDaResposta {
  categoria: string;
  pergunta: string;
  nota: number | null;
  texto?: string | null;
}

export interface DadosDoAlerta {
  casa: string;
  nota: number;
  mesa?: string | null;
  atendente?: string | null;
  criticas?: string[];
  comentario?: string | null;
  clienteNome?: string | null;
  clienteContato?: string | null;
  categorias?: CategoriaDaResposta[];
  /** A régua da casa. 6 quando não vier — a do NPS. */
  limite?: number;
}

/**
 * O que o dono lê no celular.
 *
 * Traz o suficiente para ele AGIR sem abrir o painel: a nota, onde afundou, o
 * que a pessoa escreveu e como falar com ela. Um aviso que só diz "entrou uma
 * nota 3" obriga a largar tudo e ir procurar — e é assim que um aviso vira uma
 * coisa que se ignora.
 */
export function textoDoAlerta(dados: DadosDoAlerta): string {
  const limite = dados.limite ?? 6;
  const emAlerta = categoriasEmAlerta(dados.categorias ?? [], limite);
  const experiencia = mediaDaExperiencia(dados.categorias ?? []);
  const notaNoChao = ehDetrator(dados.nota, limite);

  // O TÍTULO DIZ QUAL DOS DOIS CASOS É.
  //
  // "🚨 Nota 8" faria o dono abrir achando que erramos a conta. O aviso por
  // categoria existe justamente para o cliente que indicaria a casa e mesmo
  // assim teve um problema — e o título tem de contar isso na primeira linha,
  // que é a única que aparece na notificação do celular.
  const linhas: string[] = notaNoChao
    ? [`🚨 Nota ${dados.nota} na pesquisa — ${dados.casa}`]
    : [
        `⚠️ ${nomesDasCategorias(emAlerta)} com nota baixa — ${dados.casa}`,
        `O cliente deu ${dados.nota} na recomendação, mas não em tudo.`,
      ];

  const onde = [dados.mesa?.trim() ? `Mesa ${dados.mesa.trim()}` : null, dados.atendente?.trim() || null]
    .filter(Boolean)
    .join(" · ");
  if (onde) linhas.push(onde);

  if (experiencia !== null) {
    linhas.push(`Média da experiência: ${formatarNota(experiencia)} de 10`);
  }

  // As categorias em alerta, da pior para a menos pior: é o "o quê" que
  // transforma a nota num problema endereçável.
  if (emAlerta.length > 0) {
    linhas.push(``, `Categorias em alerta:`);
    for (const c of emAlerta.slice(0, 6)) {
      linhas.push(`• ${c.categoria} — ${formatarNota(c.media)}${perguntasDaCategoria(dados, c.categoria)}`);
    }
  }

  const criticas = (dados.criticas ?? []).filter((t) => String(t).trim());
  if (criticas.length > 0) {
    linhas.push(``, `Marcou: ${criticas.join(", ")}`);
  }

  // O texto do cliente vai inteiro e entre aspas. É a única parte do aviso em
  // que ele fala, e cortar ou parafrasear a queixa de alguém para caber num
  // resumo é como a reclamação vira "o cliente reclamou de alguma coisa".
  const escritos = [
    dados.comentario?.trim() || null,
    ...(dados.categorias ?? []).map((c) => c.texto?.trim() || null),
  ].filter((t): t is string => Boolean(t));

  if (escritos.length > 0) {
    linhas.push(``);
    for (const t of escritos) linhas.push(`"${t}"`);
  }

  const quem = [dados.clienteNome?.trim() || null, dados.clienteContato?.trim() || null]
    .filter(Boolean)
    .join(" · ");
  // Sem contato não há recuperação possível, e dizer isso é mais útil que
  // omitir: o dono aprende a pedir o contato na pesquisa.
  linhas.push(``, quem ? `Falar com: ${quem}` : `Respondeu sem deixar contato.`);

  return linhas.join("\n");
}

/** "Cozinha e Atendimento", "Cozinha, Atendimento e mais 2". */
function nomesDasCategorias(alerta: CategoriaEmAlerta[]): string {
  const nomes = alerta.map((c) => c.categoria);
  if (nomes.length === 0) return "Uma categoria";
  if (nomes.length === 1) return nomes[0]!;
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]}`;
  return `${nomes.slice(0, 2).join(", ")} e mais ${nomes.length - 2}`;
}

/**
 * A pior pergunta da categoria, entre parênteses.
 *
 * "Cozinha — 2,0" diz onde dói; "(O prato saiu no tempo?)" diz o que doeu. Sem
 * a pergunta, o dono ainda precisa abrir o painel para saber o que fazer, e o
 * aviso volta a ser só um convite para largar tudo e ir olhar.
 */
function perguntasDaCategoria(dados: DadosDoAlerta, categoria: string): string {
  const pior = (dados.categorias ?? [])
    .filter((c) => c.categoria === categoria && typeof c.nota === "number")
    .sort((a, b) => (a.nota as number) - (b.nota as number))[0];
  return pior ? ` (${pior.pergunta})` : "";
}

/** "8" e não "8,00"; "6,5" quando tem fração. */
function formatarNota(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

/**
 * Enfileira o aviso. Nunca lança.
 *
 * A resposta do cliente JÁ está gravada quando isto roda. Derrubar a opinião
 * dele porque o aviso tropeçou seria trocar o essencial pelo acessório — o
 * mesmo raciocínio do cupom e do aviso de reserva.
 */
export async function avisarDetrator(params: {
  venueId: string;
  respostaId: string;
  destino: string;
  dados: DadosDoAlerta;
}): Promise<boolean> {
  const destino = params.destino.trim();
  if (!destino) return false;

  try {
    const { error } = await cliente().from("notifications").insert({
      venue_id: params.venueId,
      pesquisa_resposta_id: params.respostaId,
      channel: "whatsapp",
      destination: destino,
      template: TEMPLATE_DETRATOR,
      body: textoDoAlerta(params.dados),
    });

    if (error) {
      // Índice único: o aviso desta resposta já saiu. Não é erro.
      if (/duplicate key|unique/i.test(error.message)) return false;
      // Coluna ainda não existe (migração não rodou): a pesquisa segue
      // funcionando sem aviso, em vez de a resposta do cliente virar erro.
      if (/pesquisa_resposta_id|42703|PGRST/i.test(error.message)) return false;
      console.error(`[pesquisa] aviso de detrator não entrou: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[pesquisa] aviso de detrator falhou: ${(e as Error).message}`);
    return false;
  }
}
