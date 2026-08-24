import { randomBytes } from "node:crypto";
import { db } from "./supabase.js";
import { montarPainel } from "./pesquisaMetricas.js";
import type { NotaBruta, PainelDaPesquisa, RespostaBruta } from "./pesquisaMetricas.js";
import { notaNormalizada, pesquisaAtiva } from "./pesquisaModelo.js";
import type { ItemDaPesquisa } from "./pesquisaModelo.js";
import { instanteNaCasa } from "./fuso.js";
import { avisarDetrator, mereceAviso } from "./pesquisaAlerta.js";
import type { CategoriaDaResposta } from "./pesquisaAlerta.js";

/**
 * Pesquisa de satisfação: a opinião do cliente enquanto ele ainda está na mesa.
 *
 * O que a casa já tinha era a avaliação do Google — que chega depois, em
 * público, e só de quem se dá ao trabalho. Falta o outro lado: o cliente que
 * não vai escrever no Google mas responde um QR code em vinte segundos, e o
 * que teve um problema e vai embora calado. Esse segundo é o mais caro de
 * perder: ele não reclama, só não volta.
 *
 * O módulo não depende de nenhum outro. Uma casa que comprou só a pesquisa
 * imprime o QR code, cadastra quem atende e está funcionando — sem agente, sem
 * cardápio, sem CMV.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sem os tipos gerados: as tabelas da pesquisa são novas e
 * `database.types.ts` só é regerado depois que a migração roda em produção.
 * Tipar à mão aqui criaria uma terceira descrição do mesmo esquema para
 * manter em dia — a mesma decisão já tomada no CMV.
 */
const cliente = () => db() as any;

export class ErroDePesquisa extends Error {
  constructor(readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

/**
 * As etiquetas que o cliente marca com o dedo.
 *
 * Lista fixa, e não texto livre por casa, de propósito: é o que permite dizer
 * "as reclamações de tempo de espera dobraram este mês". Com etiqueta livre,
 * "demora", "Demora" e "demorou muito" viram três assuntos e o gráfico não
 * significa mais nada. O texto livre existe — é o comentário, que a nuvem lê.
 */
export const ETIQUETAS = [
  "Atendimento",
  "Comida",
  "Bebidas",
  "Ambiente",
  "Música",
  "Preço",
  "Tempo de espera",
  "Limpeza",
] as const;

const ETIQUETAS_VALIDAS = new Set<string>(ETIQUETAS);

export interface ConfigDaPesquisa {
  ativa: boolean;
  saudacao: string | null;
  agradecimento: string | null;
  premio_ativo: boolean;
  premio_titulo: string;
  premio_regras: string | null;
  premio_validade_dias: number;
  perguntar_atendente: boolean;
  perguntar_comentario: boolean;
  /** WhatsApp avisado na hora quando entra nota baixa. Vazio = ninguém. */
  detrator_avisar_whatsapp: string | null;
  /** Nota até a qual a resposta dispara aviso. 6 é a régua do NPS. */
  detrator_nota_maxima: number;
}

const CONFIG_PADRAO: ConfigDaPesquisa = {
  ativa: true,
  saudacao: null,
  agradecimento: null,
  premio_ativo: true,
  premio_titulo: "Um chopp por nossa conta na próxima visita",
  premio_regras: null,
  premio_validade_dias: 30,
  perguntar_atendente: true,
  perguntar_comentario: true,
  // Desligado até a casa escrever um número: aviso é mensagem no celular de
  // alguém, e ligar isso sozinho seria decidir pelo dono que ele quer ser
  // acordado às onze da noite.
  detrator_avisar_whatsapp: null,
  detrator_nota_maxima: 6,
};

/**
 * A configuração da casa, ou o padrão.
 *
 * Sem linha no banco a pesquisa funciona assim mesmo: quem acabou de comprar o
 * módulo imprime o QR code e já recebe resposta, em vez de descobrir numa tela
 * em branco que precisava configurar alguma coisa antes.
 */
export async function configDaPesquisa(venueId: string): Promise<ConfigDaPesquisa> {
  const { data, error } = await cliente()
    .from("pesquisa_config")
    .select("*")
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) throw new ErroDePesquisa(500, `Falha ao ler os ajustes da pesquisa: ${error.message}`);
  if (!data) return { ...CONFIG_PADRAO };

  const linha = data as Record<string, unknown>;
  return {
    ativa: Boolean(linha.ativa),
    saudacao: (linha.saudacao as string) || null,
    agradecimento: (linha.agradecimento as string) || null,
    premio_ativo: Boolean(linha.premio_ativo),
    premio_titulo: (linha.premio_titulo as string) || CONFIG_PADRAO.premio_titulo,
    premio_regras: (linha.premio_regras as string) || null,
    premio_validade_dias: Number(linha.premio_validade_dias) || CONFIG_PADRAO.premio_validade_dias,
    perguntar_atendente: Boolean(linha.perguntar_atendente),
    perguntar_comentario: Boolean(linha.perguntar_comentario),
    detrator_avisar_whatsapp: (linha.detrator_avisar_whatsapp as string) || null,
    detrator_nota_maxima:
      linha.detrator_nota_maxima == null
        ? CONFIG_PADRAO.detrator_nota_maxima
        : Number(linha.detrator_nota_maxima),
  };
}

export async function salvarConfig(
  venueId: string,
  campos: Partial<ConfigDaPesquisa>,
): Promise<ConfigDaPesquisa> {
  const atual = await configDaPesquisa(venueId);
  const nova = { ...atual, ...campos };

  if (!nova.premio_titulo.trim()) {
    throw new ErroDePesquisa(400, "Escreva qual é o prêmio — o cliente vai ler isso antes de responder.");
  }
  if (!(nova.premio_validade_dias >= 1 && nova.premio_validade_dias <= 365)) {
    throw new ErroDePesquisa(400, "A validade do prêmio precisa ficar entre 1 e 365 dias.");
  }

  nova.detrator_nota_maxima = Math.trunc(Number(nova.detrator_nota_maxima));
  if (!(nova.detrator_nota_maxima >= 0 && nova.detrator_nota_maxima <= 10)) {
    throw new ErroDePesquisa(400, "O limite do aviso precisa ser uma nota de 0 a 10.");
  }
  // Campo em branco desliga o aviso. Guardar "" em vez de null faria a coluna
  // parecer preenchida em toda consulta que só testa se há valor.
  nova.detrator_avisar_whatsapp = nova.detrator_avisar_whatsapp?.trim() || null;

  const { error } = await cliente()
    .from("pesquisa_config")
    .upsert(
      { venue_id: venueId, ...nova, updated_at: new Date().toISOString() } as never,
      { onConflict: "venue_id" },
    );
  if (error) throw new ErroDePesquisa(500, `Falha ao salvar os ajustes: ${error.message}`);
  return nova;
}

// ============================================================
// Quem atende
// ============================================================

export interface Atendente {
  id: string;
  nome: string;
  apelido: string | null;
  funcao: string | null;
  ativo: boolean;
}

export async function listarAtendentes(
  venueId: string,
  { incluirInativos = false } = {},
): Promise<Atendente[]> {
  let consulta = cliente()
    .from("pesquisa_atendentes")
    .select("id, nome, apelido, funcao, ativo")
    .eq("venue_id", venueId)
    .order("nome", { ascending: true });
  if (!incluirInativos) consulta = consulta.eq("ativo", true);

  const { data, error } = await consulta;
  if (error) throw new ErroDePesquisa(500, `Falha ao listar a equipe: ${error.message}`);
  return (data ?? []) as Atendente[];
}

export async function criarAtendente(params: {
  venueId: string;
  nome: string;
  apelido?: string | null;
  funcao?: string | null;
}): Promise<Atendente> {
  const nome = params.nome.trim();
  if (!nome) throw new ErroDePesquisa(400, "O nome de quem atende é obrigatório.");

  const { data, error } = await cliente()
    .from("pesquisa_atendentes")
    .insert({
      venue_id: params.venueId,
      nome,
      apelido: params.apelido?.trim() || null,
      funcao: params.funcao?.trim() || null,
    } as never)
    .select("id, nome, apelido, funcao, ativo")
    .single();

  if (error) {
    // Índice único por nome normalizado: a pessoa já está cadastrada, talvez
    // desativada. Dizer isso é mais útil que "erro 23505".
    if (/duplicate key|unique/i.test(error.message)) {
      throw new ErroDePesquisa(409, `"${nome}" já está na lista — confira se não está desativado.`);
    }
    throw new ErroDePesquisa(500, `Falha ao cadastrar: ${error.message}`);
  }
  return data as Atendente;
}

export async function atualizarAtendente(params: {
  venueId: string;
  id: string;
  nome?: string;
  apelido?: string | null;
  funcao?: string | null;
  ativo?: boolean;
}): Promise<Atendente> {
  const mudancas: Record<string, unknown> = {};
  if (params.nome !== undefined) {
    const nome = params.nome.trim();
    if (!nome) throw new ErroDePesquisa(400, "O nome não pode ficar vazio.");
    mudancas.nome = nome;
  }
  if (params.apelido !== undefined) mudancas.apelido = params.apelido?.trim() || null;
  if (params.funcao !== undefined) mudancas.funcao = params.funcao?.trim() || null;
  if (params.ativo !== undefined) mudancas.ativo = params.ativo;

  const { data, error } = await cliente()
    .from("pesquisa_atendentes")
    .update(mudancas as never)
    .eq("id", params.id)
    .eq("venue_id", params.venueId)
    .select("id, nome, apelido, funcao, ativo")
    .maybeSingle();

  if (error) throw new ErroDePesquisa(500, `Falha ao salvar: ${error.message}`);
  if (!data) throw new ErroDePesquisa(404, "Pessoa não encontrada nesta casa.");
  return data as Atendente;
}

/**
 * Tira a pessoa da lista.
 *
 * DESATIVA em vez de apagar quando ela já foi avaliada: apagar levaria junto o
 * histórico de quem foi bem avaliado por um ano — e o dono perderia
 * exatamente o dado que justificaria uma promoção. Sem avaliação nenhuma, é
 * cadastro errado e some de vez.
 */
export async function removerAtendente(venueId: string, id: string): Promise<{ apagado: boolean }> {
  const { count, error: erroConta } = await cliente()
    .from("pesquisa_respostas")
    .select("id", { count: "exact", head: true })
    .eq("atendente_id", id);
  if (erroConta) throw new ErroDePesquisa(500, `Falha ao conferir o histórico: ${erroConta.message}`);

  if ((count ?? 0) > 0) {
    await atualizarAtendente({ venueId, id, ativo: false });
    return { apagado: false };
  }

  const { error } = await cliente()
    .from("pesquisa_atendentes")
    .delete()
    .eq("id", id)
    .eq("venue_id", venueId);
  if (error) throw new ErroDePesquisa(500, `Falha ao remover: ${error.message}`);
  return { apagado: true };
}

// ============================================================
// A resposta do cliente
// ============================================================

export interface PremioEmitido {
  codigo: string;
  titulo: string;
  expira_em: string;
  /** A partir de quando vale. O prêmio é pela próxima visita. */
  liberado_em: string;
}

export interface RespostaRegistrada {
  id: string;
  premio: PremioEmitido | null;
  agradecimento: string | null;
}

/**
 * Só o que está na lista fixa entra.
 *
 * Exportada para teste: é a fronteira que impede um POST feito à mão de
 * gravar texto qualquer no lugar da etiqueta e sujar o gráfico da casa para
 * sempre — e uma fronteira que não é testada é uma fronteira que se acredita
 * ter.
 */
export function etiquetasValidas(cruas: unknown): string[] {
  if (!Array.isArray(cruas)) return [];
  // Só o que está na lista fixa entra: sem isto, um POST feito à mão gravaria
  // qualquer texto no lugar da etiqueta e sujaria o gráfico da casa para
  // sempre.
  const limpas = cruas.map(String).filter((e) => ETIQUETAS_VALIDAS.has(e));
  return [...new Set(limpas)];
}

/** O que o cliente respondeu numa pergunta montada pela casa. */
export interface RespostaDeItem {
  item_id: string;
  valor?: unknown;
  texto?: string | null;
}

export async function registrarResposta(params: {
  venueId: string;
  /** O fuso da casa — é ele que define quando o cupom é liberado. */
  fuso: string;
  nota: number;
  elogios?: unknown;
  criticas?: unknown;
  comentario?: string | null;
  atendenteId?: string | null;
  atendenteNota?: number | null;
  mesa?: string | null;
  origem?: string;
  conviteId?: string | null;
  clienteNome?: string | null;
  clienteContato?: string | null;
  /** As respostas às perguntas da pesquisa da casa. */
  itens?: unknown;
  /** Nome da casa, para o aviso de nota baixa não sair anônimo. */
  casaNome?: string;
}): Promise<RespostaRegistrada> {
  const nota = Math.trunc(Number(params.nota));
  if (!Number.isFinite(nota) || nota < 0 || nota > 10) {
    throw new ErroDePesquisa(400, "Escolha uma nota de 0 a 10.");
  }

  // Atendente sem nota é meia informação: o banco recusa, e recusar aqui dá
  // uma mensagem que a pessoa entende em vez de um erro de constraint.
  const temAtendente = Boolean(params.atendenteId);
  const atendenteNota = params.atendenteNota == null ? null : Math.trunc(Number(params.atendenteNota));
  if (temAtendente && !(atendenteNota !== null && atendenteNota >= 1 && atendenteNota <= 5)) {
    throw new ErroDePesquisa(400, "Dê de 1 a 5 estrelas para quem atendeu.");
  }

  const config = await configDaPesquisa(params.venueId);
  if (!config.ativa) {
    throw new ErroDePesquisa(403, "A pesquisa desta casa está desligada no momento.");
  }

  const origem = ["qrcode", "whatsapp", "link"].includes(String(params.origem))
    ? String(params.origem)
    : "qrcode";

  const modelo = await pesquisaAtiva(params.venueId);

  // A NOTA VEM DA PERGUNTA DO NPS, QUANDO A CASA MARCOU UMA.
  //
  // Aqui e não só na tela: é este número que vira o NPS da casa, e deixá-lo
  // por conta do que o navegador mandou significa que uma tela desatualizada
  // (cache, aba aberta desde ontem) grava a nota do jeito antigo — e ninguém
  // descobre, porque a resposta entra normalmente.
  //
  // Sem pergunta marcada, vale o passo embutido, exatamente como antes.
  const notaFinal = notaDoNps(modelo?.itens ?? [], params.itens) ?? nota;

  const { data, error } = await cliente()
    .from("pesquisa_respostas")
    .insert({
      venue_id: params.venueId,
      pesquisa_id: modelo?.id ?? null,
      nota: notaFinal,
      elogios: etiquetasValidas(params.elogios),
      criticas: etiquetasValidas(params.criticas),
      // Comentário gigante quase sempre é cola acidental; o que interessa
      // cabe muito antes disso.
      comentario: params.comentario?.trim().slice(0, 2000) || null,
      atendente_id: temAtendente ? params.atendenteId : null,
      atendente_nota: temAtendente ? atendenteNota : null,
      mesa: params.mesa?.trim().slice(0, 40) || null,
      origem,
      convite_id: params.conviteId ?? null,
      cliente_nome: params.clienteNome?.trim().slice(0, 120) || null,
      cliente_contato: params.clienteContato?.trim().slice(0, 40) || null,
    } as never)
    .select("id")
    .single();

  if (error) {
    if (/duplicate key|unique/i.test(error.message)) {
      throw new ErroDePesquisa(409, "Esta pesquisa já foi respondida. Obrigado!");
    }
    if (/foreign key/i.test(error.message)) {
      throw new ErroDePesquisa(400, "Quem atendeu não está mais na lista desta casa.");
    }
    throw new ErroDePesquisa(500, `Falha ao gravar a resposta: ${error.message}`);
  }

  const respostaId = (data as { id: string }).id;

  // As notas por pergunta entram DEPOIS da resposta, e falhar aqui não
  // desfaz nada: a nota geral e o comentário já estão gravados, e é melhor
  // uma resposta incompleta que resposta nenhuma.
  let notasPorCategoria: CategoriaDaResposta[] = [];
  if (modelo) {
    try {
      notasPorCategoria = await gravarNotas({
        respostaId,
        venueId: params.venueId,
        itens: modelo.itens,
        respondido: params.itens,
      });
    } catch (e) {
      console.error(`[pesquisa] notas da resposta ${respostaId} não entraram: ${(e as Error).message}`);
    }
  }

  // O AVISO DE NOTA BAIXA VEM ANTES DO CUPOM.
  //
  // Os dois podem falhar sem desfazer a resposta, mas a ordem importa: o cupom
  // é um agrado e o aviso é a chance de recuperar um cliente que está indo
  // embora insatisfeito. Se um dos dois for tropeçar num dia ruim de rede, que
  // seja o brinde.
  await talvezAvisarNotaBaixa({
    config,
    respostaId,
    nota: notaFinal,
    categorias: notasPorCategoria,
    resposta: params,
  });

  let premio: PremioEmitido | null = null;
  if (config.premio_ativo) {
    // Falhar aqui não pode desfazer a resposta: a opinião do cliente é o que
    // interessa, o cupom é o agrado. Perder a resposta inteira porque a
    // emissão do cupom tropeçou seria trocar o ouro pelo brinde.
    try {
      premio = await emitirPremio(respostaId, config, params.fuso);
    } catch (e) {
      console.error(`[pesquisa] resposta ${respostaId} sem cupom: ${(e as Error).message}`);
    }
  }

  return { id: respostaId, premio, agradecimento: config.agradecimento };
}

/**
 * A nota da avaliação, quando a casa marcou uma pergunta como sendo a do NPS.
 *
 * Devolve null quando não há pergunta marcada ou quando o cliente pulou ela —
 * e null aqui significa "vale a nota do passo embutido", não "zero".
 *
 * Exportada para teste porque é a conta que define o número que o dono vê
 * primeiro. Ela existe por um caso real: a pesquisa da casa perguntava "o
 * quanto você indicaria o Ditado Popular" e o passo embutido perguntava "o
 * quanto você indicaria esta casa". O mesmo cliente respondeu 2 numa e 10 na
 * outra, e o painel mostrou 10.
 */
export function notaDoNps(itens: ItemDaPesquisa[], respondido: unknown): number | null {
  const marcada = itens.find((i) => i.nps);
  if (!marcada) return null;
  if (!Array.isArray(respondido)) return null;

  const resposta = respondido.find(
    (r) => (r as RespostaDeItem | null)?.item_id === marcada.id,
  ) as RespostaDeItem | undefined;
  if (!resposta) return null;

  const valor = notaNormalizada(marcada.tipo, resposta.valor);
  return valor === null ? null : Math.round(valor);
}

/**
 * Dispara o aviso de nota baixa, se a casa pediu e a nota merecer.
 *
 * Separada só para não engordar `registrarResposta`, que já é grande demais:
 * cada bloco novo espremido lá dentro é mais um caminho para conferir quando
 * alguém for mexer na gravação da resposta.
 */
async function talvezAvisarNotaBaixa(params: {
  config: ConfigDaPesquisa;
  respostaId: string;
  nota: number;
  categorias: CategoriaDaResposta[];
  resposta: {
    venueId: string;
    casaNome?: string;
    mesa?: string | null;
    criticas?: unknown;
    comentario?: string | null;
    clienteNome?: string | null;
    clienteContato?: string | null;
  };
}): Promise<void> {
  const destino = params.config.detrator_avisar_whatsapp;
  if (!destino) return;

  // Duas portas, e basta uma: a nota de recomendação no chão, OU qualquer
  // categoria no chão. Só a nota deixaria passar o cliente que indicaria a
  // casa e mesmo assim esperou quarenta minutos — e é justamente esse que
  // ainda dá para recuperar, porque o problema tem nome.
  const limite = params.config.detrator_nota_maxima;
  if (!mereceAviso({ nota: params.nota, categorias: params.categorias, limite })) return;

  const r = params.resposta;
  await avisarDetrator({
    venueId: r.venueId,
    respostaId: params.respostaId,
    destino,
    dados: {
      casa: r.casaNome?.trim() || "sua casa",
      nota: params.nota,
      mesa: r.mesa?.trim() || null,
      criticas: etiquetasValidas(r.criticas),
      comentario: r.comentario?.trim() || null,
      clienteNome: r.clienteNome?.trim() || null,
      clienteContato: r.clienteContato?.trim() || null,
      categorias: params.categorias,
      limite,
    },
  });
}

async function emitirPremio(
  respostaId: string,
  config: ConfigDaPesquisa,
  fuso: string,
): Promise<PremioEmitido> {
  const { data, error } = await cliente().rpc("pesquisa_emitir_premio", {
    p_resposta_id: respostaId,
    p_titulo: config.premio_titulo,
    p_validade_dias: config.premio_validade_dias,
    p_liberado_em: liberacaoDoPremio(fuso),
  } as never);
  if (error) throw new Error(error.message);

  const linha = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  return {
    codigo: String(linha.codigo),
    titulo: String(linha.titulo),
    expira_em: String(linha.expira_em),
    liberado_em: String(linha.liberado_em ?? ""),
  };
}

/**
 * A partir de quando o cupom vale: o começo do dia seguinte no relógio da casa.
 *
 * O prêmio é pela PRÓXIMA visita. Usado na mesma conta, ele vira desconto no
 * que o cliente já ia pagar — o oposto de trazer alguém de volta.
 *
 * "Dia seguinte" e não "24 horas": quem responde às 23h de sexta poderia usar
 * na sexta seguinte com 24h, mas não no sábado à noite. A virada do dia é o
 * que as palavras "próxima visita" significam para quem lê o cupom.
 *
 * A conta é feita no fuso da CASA. Feita em UTC, a noite de sábado em Cuiabá
 * (que já é domingo em UTC) liberaria o cupom no próprio sábado.
 */
export function liberacaoDoPremio(fuso: string, agora = new Date()): string {
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);

  const amanha = new Date(`${hoje}T12:00:00Z`);
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  return instanteNaCasa(amanha.toISOString().slice(0, 10), "00:00", fuso);
}

/**
 * Grava uma linha por pergunta respondida, com a nota já na escala de 0 a 10.
 *
 * Só entra o que a casa realmente perguntou: a lista de itens do modelo é a
 * fonte, e não o corpo que chegou. Sem isso, um POST feito à mão inventaria
 * categorias e perguntas que nunca existiram, e o painel mostraria assunto que
 * ninguém perguntou.
 */
/**
 * Grava as notas por pergunta e devolve o que gravou.
 *
 * Devolve em vez de só gravar porque o aviso de nota baixa precisa dizer ONDE
 * afundou, e reler do banco o que acabamos de escrever seria uma ida a mais
 * para buscar o que já está na mão.
 */
async function gravarNotas(params: {
  respostaId: string;
  venueId: string;
  itens: ItemDaPesquisa[];
  respondido: unknown;
}): Promise<CategoriaDaResposta[]> {
  const porId = new Map<string, RespostaDeItem>();
  if (Array.isArray(params.respondido)) {
    for (const cru of params.respondido) {
      const o = (cru ?? {}) as RespostaDeItem;
      if (typeof o.item_id === "string") porId.set(o.item_id, o);
    }
  }

  const linhas = [];
  for (const item of params.itens) {
    const resposta = porId.get(item.id);
    if (!resposta) continue;

    const nota = notaNormalizada(item.tipo, resposta.valor);
    const texto = typeof resposta.texto === "string" ? resposta.texto.trim().slice(0, 2000) : null;

    // Pergunta pulada: nada a gravar. Uma linha com nota nula e texto nulo só
    // engordaria a tabela e não entraria em conta nenhuma.
    if (nota === null && !texto) continue;

    linhas.push({
      resposta_id: params.respostaId,
      venue_id: params.venueId,
      item_id: item.id,
      categoria: item.categoria,
      pergunta: item.pergunta,
      tipo: item.tipo,
      nota,
      valor: resposta.valor === undefined || resposta.valor === null ? null : String(resposta.valor),
      texto: texto || null,
    });
  }

  if (linhas.length === 0) return [];
  const { error } = await cliente().from("pesquisa_resposta_itens").insert(linhas as never);
  if (error) throw new Error(error.message);

  return linhas.map((l) => ({
    categoria: l.categoria,
    pergunta: l.pergunta,
    nota: l.nota,
    texto: l.texto,
  }));
}

// ============================================================
// Cupons
// ============================================================

export interface PremioNaLista {
  id: string;
  codigo: string;
  titulo: string;
  expira_em: string;
  resgatado_em: string | null;
  created_at: string;
  cliente_nome: string | null;
  cliente_contato: string | null;
  nota: number | null;
}

export async function listarPremios(
  venueId: string,
  { situacao = "todos", limite = 200 } = {},
): Promise<PremioNaLista[]> {
  const { data, error } = await cliente()
    .from("pesquisa_premios")
    .select("id, codigo, titulo, expira_em, resgatado_em, created_at, pesquisa_respostas(cliente_nome, cliente_contato, nota)")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw new ErroDePesquisa(500, `Falha ao listar os cupons: ${error.message}`);

  const agora = Date.now();
  const lista: PremioNaLista[] = (data ?? []).map((linha: unknown) => {
    const l = linha as Record<string, unknown>;
    const resposta = (l.pesquisa_respostas ?? {}) as Record<string, unknown>;
    return {
      id: String(l.id),
      codigo: String(l.codigo),
      titulo: String(l.titulo),
      expira_em: String(l.expira_em),
      resgatado_em: (l.resgatado_em as string) ?? null,
      created_at: String(l.created_at),
      cliente_nome: (resposta.cliente_nome as string) ?? null,
      cliente_contato: (resposta.cliente_contato as string) ?? null,
      nota: resposta.nota == null ? null : Number(resposta.nota),
    };
  });

  if (situacao === "aberto") {
    return lista.filter((p) => !p.resgatado_em && Date.parse(p.expira_em) > agora);
  }
  if (situacao === "resgatado") return lista.filter((p) => p.resgatado_em);
  if (situacao === "vencido") {
    return lista.filter((p) => !p.resgatado_em && Date.parse(p.expira_em) <= agora);
  }
  return lista;
}

/**
 * Baixa o cupom no balcão.
 *
 * A regra inteira (existe? já usou? venceu?) mora numa função do banco, com a
 * linha travada durante a leitura. Feita aqui, dois garçons batendo o mesmo
 * código ao mesmo tempo dariam o prêmio duas vezes.
 */
export async function resgatarPremio(params: {
  venueId: string;
  codigo: string;
  usuarioId?: string | null;
}): Promise<{ codigo: string; titulo: string; resgatado_em: string }> {
  const codigo = params.codigo.trim();
  if (!codigo) throw new ErroDePesquisa(400, "Digite o código do cupom.");

  const { data, error } = await cliente().rpc("pesquisa_resgatar_premio", {
    p_venue_id: params.venueId,
    p_codigo: codigo,
    p_usuario: params.usuarioId ?? null,
  } as never);

  if (error) {
    // As mensagens vêm prontas do banco, escritas para quem está no balcão.
    const texto = error.message.replace(/^.*?:\s*/, "");
    const naoAchou = /não encontrado/i.test(texto);
    throw new ErroDePesquisa(naoAchou ? 404 : 409, texto);
  }

  const linha = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  return {
    codigo: String(linha.codigo),
    titulo: String(linha.titulo),
    resgatado_em: String(linha.resgatado_em),
  };
}

// ============================================================
// Convites por WhatsApp
// ============================================================

export interface Convite {
  id: string;
  telefone: string;
  nome: string | null;
  token: string;
  enviado_em: string | null;
  respondido_em: string | null;
  created_at: string;
}

/** Só dígitos: o que o WhatsApp entende. */
export function telefoneLimpo(bruto: string): string {
  return bruto.replace(/\D/g, "");
}

export async function criarConvite(params: {
  venueId: string;
  telefone: string;
  nome?: string | null;
}): Promise<Convite> {
  const telefone = telefoneLimpo(params.telefone);
  // 10 dígitos = fixo com DDD; abaixo disso não é telefone brasileiro nenhum,
  // e mandar para um número inventado gasta o disparo e some sem aviso.
  if (telefone.length < 10 || telefone.length > 15) {
    throw new ErroDePesquisa(400, `"${params.telefone}" não parece um telefone com DDD.`);
  }

  const { data, error } = await cliente()
    .from("pesquisa_convites")
    .insert({
      venue_id: params.venueId,
      telefone,
      nome: params.nome?.trim() || null,
      token: randomBytes(18).toString("base64url"),
    } as never)
    .select("*")
    .single();
  if (error) throw new ErroDePesquisa(500, `Falha ao criar o convite: ${error.message}`);
  return data as Convite;
}

export async function listarConvites(venueId: string, limite = 100): Promise<Convite[]> {
  const { data, error } = await cliente()
    .from("pesquisa_convites")
    .select("*")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw new ErroDePesquisa(500, `Falha ao listar os convites: ${error.message}`);
  return (data ?? []) as Convite[];
}

export async function marcarConviteEnviado(id: string): Promise<void> {
  await cliente()
    .from("pesquisa_convites")
    .update({ enviado_em: new Date().toISOString() } as never)
    .eq("id", id);
}

/** O convite por trás de um token, se ele ainda serve. */
export async function conviteDoToken(
  token: string,
): Promise<{ id: string; venue_id: string; nome: string | null } | null> {
  const { data, error } = await cliente()
    .from("pesquisa_convites")
    .select("id, venue_id, nome, respondido_em")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new ErroDePesquisa(500, `Falha ao conferir o convite: ${error.message}`);
  if (!data) return null;

  const linha = data as Record<string, unknown>;
  if (linha.respondido_em) {
    throw new ErroDePesquisa(409, "Esta pesquisa já foi respondida. Obrigado!");
  }
  return {
    id: String(linha.id),
    venue_id: String(linha.venue_id),
    nome: (linha.nome as string) ?? null,
  };
}

// ============================================================
// O painel
// ============================================================

/** Quantas respostas o painel lê de uma vez. Um bar movimentado não passa disso num mês. */
const TETO_DE_RESPOSTAS = 5000;

async function respostasEntre(
  venueId: string,
  de: Date,
  ate: Date,
): Promise<RespostaBruta[]> {
  const { data, error } = await cliente()
    .from("pesquisa_respostas")
    .select("*")
    .eq("venue_id", venueId)
    .gte("created_at", de.toISOString())
    .lt("created_at", ate.toISOString())
    .order("created_at", { ascending: false })
    .limit(TETO_DE_RESPOSTAS);
  if (error) throw new ErroDePesquisa(500, `Falha ao ler as respostas: ${error.message}`);
  return (data ?? []) as RespostaBruta[];
}

async function notasEntre(venueId: string, de: Date, ate: Date): Promise<NotaBruta[]> {
  const { data, error } = await cliente()
    .from("pesquisa_resposta_itens")
    .select("resposta_id, item_id, categoria, pergunta, tipo, nota, texto, created_at")
    .eq("venue_id", venueId)
    .gte("created_at", de.toISOString())
    .lt("created_at", ate.toISOString())
    .limit(TETO_DE_RESPOSTAS * 4);
  if (error) throw new ErroDePesquisa(500, `Falha ao ler as notas: ${error.message}`);
  // `numeric` volta como texto do PostgREST: sem o Number, a média viraria
  // concatenação de strings e o painel mostraria um número absurdo.
  return (data ?? []).map((l: Record<string, unknown>) => ({
    ...l,
    nota: l.nota === null || l.nota === undefined ? null : Number(l.nota),
  })) as NotaBruta[];
}

export async function painelDaPesquisa(params: {
  venueId: string;
  fuso: string;
  dias?: number;
}): Promise<PainelDaPesquisa & { atendentes: Atendente[]; etiquetas: string[] }> {
  const dias = Math.min(Math.max(Math.trunc(params.dias ?? 30), 1), 365);
  const agora = new Date();
  const inicio = new Date(agora.getTime() - dias * 86_400_000);
  // A janela anterior tem o MESMO tamanho: comparar 30 dias com 90 diria que
  // a casa piorou sempre que o dono ampliasse o período na tela.
  const inicioAnterior = new Date(inicio.getTime() - dias * 86_400_000);

  const fim = new Date(agora.getTime() + 60_000);
  const [respostas, anteriores, notas, notasAnteriores, atendentes] = await Promise.all([
    respostasEntre(params.venueId, inicio, fim),
    respostasEntre(params.venueId, inicioAnterior, inicio),
    notasEntre(params.venueId, inicio, fim),
    notasEntre(params.venueId, inicioAnterior, inicio),
    listarAtendentes(params.venueId, { incluirInativos: true }),
  ]);

  return {
    ...montarPainel({ respostas, anteriores, notas, notasAnteriores, atendentes, fuso: params.fuso }),
    atendentes,
    etiquetas: [...ETIQUETAS],
  };
}

export interface ItemRespondido {
  item_id: string;
  categoria: string;
  pergunta: string;
  tipo: string;
  /** Normalizada de 0 a 10. Null em pergunta de texto, que não pontua. */
  nota: number | null;
  /** O que o cliente marcou, como ele marcou: "4", "sim". */
  valor: string | null;
  texto: string | null;
}

export interface RespostaCompleta extends RespostaBruta {
  atendente_nome: string | null;
  itens: ItemRespondido[];
  premio: { codigo: string; titulo: string; resgatado_em: string | null } | null;
}

/**
 * Uma resposta inteira, como o cliente a preencheu.
 *
 * Existe porque o resto do módulo só sabia calcular médias. As notas por
 * pergunta eram gravadas, viravam "Cozinha: 4,2" no painel e nunca mais eram
 * lidas — de modo que o dono via QUE alguém reclamou e nunca DO QUÊ.
 *
 * Média responde "como andam as coisas". Só a resposta individual responde
 * "por que essa pessoa foi embora chateada", que é a pergunta que faz alguém
 * pegar o telefone.
 */
export async function respostaCompleta(
  venueId: string,
  respostaId: string,
): Promise<RespostaCompleta> {
  const { data, error } = await cliente()
    .from("pesquisa_respostas")
    .select("*")
    .eq("venue_id", venueId)
    .eq("id", respostaId)
    .maybeSingle();

  if (error) throw new ErroDePesquisa(500, `Falha ao ler a resposta: ${error.message}`);
  if (!data) throw new ErroDePesquisa(404, "Resposta não encontrada nesta casa.");

  const resposta = data as RespostaBruta & Record<string, unknown>;

  // As três buscas seguintes são acessórias: sem elas a resposta ainda é
  // legível. Falhar em qualquer uma não pode esconder o que o cliente
  // escreveu, que é o motivo desta tela existir.
  const [itens, atendente, premio] = await Promise.all([
    itensDaResposta(respostaId),
    resposta.atendente_id ? nomeDoAtendente(String(resposta.atendente_id)) : Promise.resolve(null),
    premioDaResposta(respostaId),
  ]);

  return { ...(resposta as RespostaBruta), atendente_nome: atendente, itens, premio };
}

async function itensDaResposta(respostaId: string): Promise<ItemRespondido[]> {
  const { data, error } = await cliente()
    .from("pesquisa_resposta_itens")
    .select("item_id, categoria, pergunta, tipo, nota, valor, texto")
    .eq("resposta_id", respostaId)
    .order("categoria", { ascending: true });

  if (error) {
    console.error(`[pesquisa] itens da resposta ${respostaId}: ${error.message}`);
    return [];
  }
  return ((data ?? []) as ItemRespondido[]).map((i) => ({
    ...i,
    nota: i.nota === null ? null : Number(i.nota),
  }));
}

async function nomeDoAtendente(id: string): Promise<string | null> {
  const { data, error } = await cliente()
    .from("pesquisa_atendentes")
    .select("nome, apelido")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const linha = data as { nome: string; apelido: string | null };
  return linha.apelido?.trim() || linha.nome;
}

async function premioDaResposta(
  respostaId: string,
): Promise<{ codigo: string; titulo: string; resgatado_em: string | null } | null> {
  const { data, error } = await cliente()
    .from("pesquisa_premios")
    .select("codigo, titulo, resgatado_em")
    .eq("resposta_id", respostaId)
    .maybeSingle();
  if (error || !data) return null;
  return data as { codigo: string; titulo: string; resgatado_em: string | null };
}

export async function listarRespostas(params: {
  venueId: string;
  dias?: number;
  notaMaxima?: number;
  limite?: number;
}): Promise<RespostaBruta[]> {
  const dias = Math.min(Math.max(Math.trunc(params.dias ?? 30), 1), 365);
  const inicio = new Date(Date.now() - dias * 86_400_000);

  let consulta = cliente()
    .from("pesquisa_respostas")
    .select("*")
    .eq("venue_id", params.venueId)
    .gte("created_at", inicio.toISOString())
    .order("created_at", { ascending: false })
    .limit(Math.min(params.limite ?? 300, TETO_DE_RESPOSTAS));

  if (params.notaMaxima !== undefined) consulta = consulta.lte("nota", params.notaMaxima);

  const { data, error } = await consulta;
  if (error) throw new ErroDePesquisa(500, `Falha ao listar as respostas: ${error.message}`);
  return (data ?? []) as RespostaBruta[];
}
