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

/** Só as categorias abaixo disto entram no "o que puxou para baixo". */
const NOTA_DE_CORTE_DA_CATEGORIA = 7;

/**
 * Esta nota merece aviso?
 *
 * Separada e pura porque é a decisão que define quantas mensagens o dono
 * recebe por semana — e aviso demais é indistinguível de aviso nenhum, já que
 * os dois terminam com a conversa silenciada.
 */
export function ehDetrator(nota: number, limite: number): boolean {
  if (!Number.isFinite(nota)) return false;
  // Limite fora da faixa é engano de configuração; na dúvida, a régua do NPS.
  const corte = Number.isFinite(limite) && limite >= 0 && limite <= 10 ? limite : 6;
  return nota <= corte;
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
  const linhas: string[] = [`🚨 Nota ${dados.nota} na pesquisa — ${dados.casa}`];

  const onde = [dados.mesa?.trim() ? `Mesa ${dados.mesa.trim()}` : null, dados.atendente?.trim() || null]
    .filter(Boolean)
    .join(" · ");
  if (onde) linhas.push(onde);

  // As categorias que afundaram, da pior para a menos pior: é o "o quê" que
  // transforma a nota num problema endereçável.
  const fracas = (dados.categorias ?? [])
    .filter((c) => typeof c.nota === "number" && c.nota < NOTA_DE_CORTE_DA_CATEGORIA)
    .sort((a, b) => (a.nota as number) - (b.nota as number))
    .slice(0, 5);

  if (fracas.length > 0) {
    linhas.push(``, `O que puxou para baixo:`);
    for (const c of fracas) {
      linhas.push(`• ${c.categoria} — ${formatarNota(c.nota as number)} (${c.pergunta})`);
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
