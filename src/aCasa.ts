import { db } from "./supabase.js";

/**
 * A CASA AO VIVO — a planta do bar, com o que está acontecendo em cada setor.
 *
 * O painel conta a verdade repartida em dez telas: reserva numa, recebimento
 * noutra, ponto numa terceira. Quem abre de manhã quer uma coisa só — "o que
 * andou acontecendo na minha casa?" — e hoje isso custa dez cliques.
 *
 * Aqui a casa vira planta, e cada fato aparece NO SETOR onde ele acontece: a
 * mercadoria chega na doca, a reserva entra pela porta, o ponto bate no
 * escritório. Não é enfeite: é o mapa mental de quem toca o bar, e reconhecer
 * "a doca está parada há três dias" num relance é mais rápido do que ler
 * qualquer lista.
 *
 * DUAS REGRAS MANDAM AQUI:
 *
 * 1. Nenhum módulo depende do outro. Cada fonte só roda se a casa contratou
 *    o módulo dela, e o setor sem contrato aparece apagado — não some, para
 *    o dono ver o que existe e poder querer.
 *
 * 2. Fonte que falha não derruba a planta. Se a migração do RH não rodou, o
 *    escritório fica quieto e o resto da casa continua viva. Uma tela de
 *    panorama que quebra inteira por causa de um módulo é pior do que não
 *    ter panorama nenhum.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

export interface Setor {
  id: string;
  nome: string;
  /** O que este setor faz, em quatro palavras. */
  legenda: string;
  /** O módulo que alimenta o setor. `null` = todo cliente tem. */
  modulo: string | null;
  /**
   * A área da casa onde esta baia fica.
   *
   * A GEOMETRIA em si é da tela, não daqui: o domínio diz o que a coisa é e
   * onde ela pertence; a tela decide quantos pixels isso ocupa.
   */
  area: AreaDaCasa;
  contratado: boolean;
  /** Módulo que ainda não existe: aparece na planta como "em breve". */
  em_breve?: boolean;
  /** Fatos deste setor na janela lida. */
  quantos: number;
  /** O fato mais recente, para o cartão dizer algo sem ninguém clicar. */
  ultimo: Fato | null;
  /** Quanto tempo faz desde o último fato, em minutos. `null` = nada ainda. */
  minutos_parado: number | null;
}

export interface Fato {
  /** Estável: a tela usa para não desenhar o mesmo fato duas vezes. */
  id: string;
  quando: string;
  setor: string;
  tipo: string;
  titulo: string;
  detalhe: string | null;
  /** De quem é o fato — é por aqui que ele acha o boneco de quem o fez. */
  quem: string | null;
  /** Precisa de alguém: reserva esperando, nota baixa, checklist com alerta. */
  atencao: boolean;
}

/**
 * Quem está na casa agora — de carne ou de software.
 *
 * O boneco de cada um anda na sala dele e carrega na cabeça o que está
 * fazendo. "Ocioso" aqui é informação de verdade, não enfeite: garçom ocioso
 * às nove da noite de sexta é um problema, e agente ocioso é o normal.
 */
export interface Trabalhador {
  id: string;
  nome: string;
  /** `pessoa` bate ponto; `agente` é rotina do sistema. */
  tipo: "pessoa" | "agente";
  /** A função de quem é gente; o que faz, no caso do agente. */
  papel: string | null;
  setor: string;
  /** O que está fazendo agora. `null` = ocioso. */
  fazendo: string | null;
  /** Desde quando está nisto — ou desde quando está parado. */
  desde: string | null;
  minutos_parado: number | null;
  /** Saiu para a pausa: está na casa, mas não está trabalhando. */
  em_pausa: boolean;
  /**
   * A fila deste trabalhador, aberta — o que a tela mostra quando alguém
   * clica nele.
   *
   * "1 aviso falhou" acima da cabeça do Carteiro é verdade, e é inútil
   * sozinho: quem lê não tem como saber QUAL aviso nem POR QUÊ. Aqui vem o
   * motivo em letra de gente ("Telefone inválido"), para o dono resolver em
   * vez de só ficar sabendo que existe um problema.
   */
  detalhes?: DetalheDoTrabalhador[];
}

export interface DetalheDoTrabalhador {
  titulo: string;
  detalhe: string | null;
  quando: string | null;
  /** Deu errado: a tela marca em vermelho. */
  ruim: boolean;
}

export type AreaDaCasa = "recepcao" | "salao" | "doca" | "administrativo";

/** As quatro áreas da casa, na ordem em que se atravessa o bar. */
export const AREAS: Array<{ id: AreaDaCasa; nome: string; legenda: string }> = [
  { id: "recepcao", nome: "Recepção", legenda: "Por onde o cliente chega" },
  { id: "salao", nome: "Salão", legenda: "As mesas e quem atende" },
  { id: "doca", nome: "Doca", legenda: "O que entra e o que se produz" },
  { id: "administrativo", nome: "Administrativo", legenda: "O escritório da casa" },
];

/**
 * As baias da casa — uma mesa de trabalho por assunto.
 *
 * Cada baia pertence a uma área e a um módulo. Baia sem módulo contratado
 * aparece apagada, e não some: o dono vê o que existe e pode querer. O
 * Financeiro é o caso especial — não é que a casa não comprou, é que ele
 * ainda não foi construído, e a planta diz isso com todas as letras.
 */
export const SETORES: Array<Omit<Setor, "contratado" | "quantos" | "ultimo" | "minutos_parado">> = [
  { id: "recepcao", nome: "Recepção", legenda: "Reservas e quem chega na porta", modulo: "agentes-ia", area: "recepcao" },
  { id: "salao", nome: "Salão", legenda: "Mesas, garçons e cardápio", modulo: "cardapio-digital", area: "salao" },
  { id: "recebimento", nome: "Recebimento", legenda: "Mercadoria entrando e contagem", modulo: "cmv", area: "doca" },
  { id: "cozinha", nome: "Cozinha", legenda: "Produção das fichas técnicas", modulo: "cmv", area: "doca" },
  { id: "rh", nome: "RH", legenda: "Ponto, escala, férias e gorjeta", modulo: "rh", area: "administrativo" },
  { id: "financeiro", nome: "Financeiro", legenda: "Contas a pagar e a receber", modulo: "financeiro", area: "administrativo", em_breve: true },
  { id: "atendimento", nome: "Atendimento ao cliente", legenda: "O agente no WhatsApp, pesquisa e avaliações", modulo: "clientes", area: "administrativo" },
  { id: "rotinas", nome: "Rotinas", legenda: "Checklists do turno", modulo: "checklist", area: "administrativo" },
];

/**
 * Onde cada função trabalha.
 *
 * Casado por pedaço do nome e sem acento, porque o cadastro do bar tem
 * "GARCOM", "garçom" e "Garçonete" na mesma lista — e ninguém vai normalizar
 * isso à mão.
 */
const FUNCAO_NO_SETOR: Array<[string, string]> = [
  ["cozinh", "cozinha"],
  ["chapeir", "cozinha"],
  ["pizzaiol", "cozinha"],
  ["confeit", "cozinha"],
  ["estoqu", "recebimento"],
  ["almox", "recebimento"],
  ["compr", "recebimento"],
  ["receb", "recebimento"],
  ["financ", "financeiro"],
  ["caixa", "financeiro"],
  ["tesour", "financeiro"],
  ["gerent", "rh"],
  ["administrat", "rh"],
  ["rh", "rh"],
  ["seguran", "recepcao"],
  ["portari", "recepcao"],
  ["recep", "recepcao"],
  ["hostes", "recepcao"],
  ["host", "recepcao"],
  ["manobr", "recepcao"],
  ["limpez", "rotinas"],
  ["manuten", "rotinas"],
];

/** Sem acento e em minúscula, para o cadastro torto não atrapalhar. */
function simples(txt: string): string {
  return txt.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function setorDaFuncao(funcao: string | null): string {
  const alvo = simples(String(funcao ?? ""));
  if (!alvo) return "salao";
  for (const [pedaco, setor] of FUNCAO_NO_SETOR) {
    if (alvo.includes(pedaco)) return setor;
  }
  // Garçom, barman, copa e o que mais não se encaixar: o salão é o padrão,
  // porque é onde fica a maior parte da equipe de um bar.
  return "salao";
}


// ============================================================
// Contas puras — sem banco, testáveis
// ============================================================

/** Minutos entre dois instantes, arredondados para baixo. */
export function minutosEntre(de: string, ate: string): number {
  return Math.max(0, Math.floor((new Date(ate).getTime() - new Date(de).getTime()) / 60_000));
}

/**
 * Os fatos em ordem, sem repetição e sem passar do limite.
 *
 * A repetição não é hipótese: a tela pergunta de novo a cada quinze segundos
 * com `desde`, e a borda da janela devolve o mesmo fato duas vezes. Cortar
 * pelo id é mais barato e mais seguro do que confiar no relógio.
 */
export function arrumarFatos(fatos: Fato[], limite = 60): Fato[] {
  const vistos = new Set<string>();
  return fatos
    .filter((f) => {
      if (vistos.has(f.id)) return false;
      vistos.add(f.id);
      return true;
    })
    .sort((a, b) => b.quando.localeCompare(a.quando))
    .slice(0, limite);
}

/**
 * O estado de cada setor a partir dos fatos.
 *
 * Setor sem contrato não conta nada e não fica "parado há muito tempo": ele
 * está apagado porque a casa não comprou, e dizer "parado há 40 dias" seria
 * cobrar de alguém uma coisa que ele não tem.
 */
export function montarSetores(params: {
  fatos: Fato[];
  contratados: string[];
  agora: string;
}): Setor[] {
  const temModulo = new Set(params.contratados);
  return SETORES.map((base) => {
    const contratado = base.modulo === null || temModulo.has(base.modulo);
    const meus = contratado ? params.fatos.filter((f) => f.setor === base.id) : [];
    const ultimo = meus[0] ?? null;
    return {
      ...base,
      contratado,
      quantos: meus.length,
      ultimo,
      minutos_parado: ultimo ? minutosEntre(ultimo.quando, params.agora) : null,
    };
  });
}

/**
 * Como cada aviso se chama para quem não escreveu o sistema.
 *
 * `reserva_aprovada` é nome de código; "Confirmação de reserva" é o que o
 * dono do bar reconhece. O que não estiver na lista vira o próprio nome com
 * os sublinhados trocados por espaço — errar para o lado de mostrar algo.
 */
const NOME_DO_AVISO: Record<string, string> = {
  reserva_aprovada: "Confirmação de reserva",
  reserva_lembrete: "Lembrete de reserva",
  reserva_nova_gestor: "Aviso de reserva nova",
  pesquisa_convite: "Convite da pesquisa",
  pesquisa_detrator: "Alerta de nota baixa",
  aniversario_2026: "Mensagem de aniversário",
  checklist_link: "Link do checklist",
  checklist_resumo: "Resumo do checklist",
  cmv_lembrete_contagem: "Lembrete de contagem",
  cardapio_chamou_garcom: "Mesa chamou o garçom",
  mesa_chamando: "Mesa chamando",
  conector_caiu: "Aviso de conexão caída",
  resposta_humana: "Resposta de gente",
};

export function nomeDoAviso(template: string | null): string {
  const chave = String(template ?? "").trim();
  if (!chave) return "Aviso";
  return NOME_DO_AVISO[chave] ?? chave.replace(/_/g, " ");
}

export interface AvisoNaFila {
  status: string;
  template: string | null;
  destination: string | null;
  error: string | null;
  created_at: string;
}

/**
 * A fila do Carteiro aberta, um aviso por linha.
 *
 * O que falhou vem primeiro, e com o motivo junto: é o que alguém pode
 * resolver. O que está só esperando vem depois, porque em um minuto ele
 * sai sozinho e não é problema de ninguém.
 */
export function filaDoCarteiro(avisos: AvisoNaFila[]): DetalheDoTrabalhador[] {
  const ordem = [...avisos].sort((a, b) => {
    const falhou = Number(b.status === "failed") - Number(a.status === "failed");
    return falhou !== 0 ? falhou : b.created_at.localeCompare(a.created_at);
  });

  return ordem.map((a) => {
    const ruim = a.status === "failed";
    const para = texto(a.destination);
    return {
      titulo: nomeDoAviso(a.template),
      detalhe: ruim
        ? [motivoDaFalha(a.error), para ? `para ${para}` : null].filter(Boolean).join(" · ")
        // Aviso parado costuma estar só na fila. Quando ele traz um motivo —
        // "esperando o conector" — é esse motivo que importa, e não a frase
        // genérica que faria o dono achar que está tudo correndo.
        : [para ? `para ${para}` : null, texto(a.error) || "na fila para enviar"]
          .filter(Boolean).join(" · "),
      quando: a.created_at,
      ruim,
    };
  });
}

/**
 * O motivo da falha em uma linha.
 *
 * O provedor devolve parágrafo, json e código de erro. Quem toca o bar
 * precisa de uma frase — e a frase tem de dizer o que fazer, não o que o
 * servidor achou.
 */
export function motivoDaFalha(erro: string | null): string {
  const cru = String(erro ?? "").trim();
  if (!cru) return "Não deu para enviar";
  const baixo = simples(cru);
  if (baixo.includes("telefone")) return "O telefone do cadastro não é um número de WhatsApp";
  if (baixo.includes("24") && baixo.includes("hora")) return "Passou da janela de 24 h do WhatsApp";
  if (baixo.includes("template")) return "O modelo da mensagem não está aprovado na Meta";
  if (baixo.includes("token") || baixo.includes("auth")) return "A conexão com o WhatsApp caiu";
  // Uma linha só, e curta: a gaveta tem de caber na tela do celular.
  return cru.split("\n")[0]!.slice(0, 120);
}

/** "agora mesmo", "há 12 min", "há 3 h", "há 2 dias". */
export function comoFazTempo(minutos: number | null): string {
  if (minutos === null) return "nada ainda";
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "ontem" : `há ${dias} dias`;
}

/** O primeiro nome, que é o que cabe embaixo do boneco. */
export function primeiroNome(nome: string | null): string | null {
  const limpo = String(nome ?? "").trim();
  if (!limpo) return null;
  return limpo.split(/\s+/)[0]!;
}

/** Depois disto, quem não fez nada aparece como ocioso. */
export const MINUTOS_PARA_OCIOSO = 25;

/**
 * O que cada um está fazendo agora.
 *
 * A regra é simples e honesta: o último fato DA PESSOA manda, se for
 * recente. Não havendo, ela está ociosa — e a tela diz há quanto tempo.
 *
 * Ocioso não é acusação: agente ocioso é o normal (ninguém escreveu), e
 * cozinheiro ocioso às três da tarde também. O que a tela entrega é o
 * contraste — garçom ocioso às nove da noite de sexta salta aos olhos.
 */
export function oQueCadaUmFaz(params: {
  trabalhadores: Trabalhador[];
  fatos: Fato[];
  agora: string;
  minutosParaOcioso?: number;
}): Trabalhador[] {
  const limite = params.minutosParaOcioso ?? MINUTOS_PARA_OCIOSO;

  return params.trabalhadores.map((t) => {
    // Quem já veio com tarefa da própria fonte (o agente sabe o que está
    // respondendo) não precisa que ninguém adivinhe por ele.
    if (t.fazendo) return t;
    if (t.em_pausa) {
      return { ...t, fazendo: null, minutos_parado: t.desde ? minutosEntre(t.desde, params.agora) : null };
    }

    const meus = params.fatos.filter((f) => ehDaPessoa(f, t));
    const ultimo = meus[0] ?? null;
    const desde = ultimo?.quando ?? t.desde ?? null;
    const parado = desde ? minutosEntre(desde, params.agora) : null;
    const trabalhando = ultimo !== null && parado !== null && parado <= limite;

    return {
      ...t,
      fazendo: trabalhando ? ultimo!.titulo : null,
      desde,
      minutos_parado: parado,
    };
  });
}

/** O fato é desta pessoa? Casa pelo nome, que é o que as fontes carregam. */
function ehDaPessoa(fato: Fato, t: Trabalhador): boolean {
  if (!fato.quem) return false;
  const dele = simples(t.nome);
  const doFato = simples(fato.quem);
  return doFato === dele || doFato.startsWith(`${dele} `) || dele.startsWith(`${doFato} `);
}

// ============================================================
// As fontes — uma por assunto, cada uma sozinha
// ============================================================

interface Janela {
  venueId: string;
  desde: string;
  limite: number;
}

type Fonte = (j: Janela) => Promise<Fato[]>;

const texto = (v: unknown) => (v === null || v === undefined ? null : String(v));

async function reservas(j: Janela): Promise<Fato[]> {
  const { data } = await cliente()
    .from("reservations")
    .select("id, customer_name, party_size, reserved_for, status, source_channel, created_at")
    .eq("venue_id", j.venueId)
    .gte("created_at", j.desde)
    .order("created_at", { ascending: false })
    .limit(j.limite);

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: `reserva:${r.id}`,
    quando: String(r.created_at),
    setor: "recepcao",
    tipo: "reserva",
    titulo: `Reserva para ${Number(r.party_size) || 1} pessoa(s)`,
    // Sem o nome aqui: ele já vai em `quem`, e a tela junta os dois na mesma
    // linha — repetido, ficava "Renata Prado · Renata Prado".
    detalhe: r.reserved_for ? `para ${quando(String(r.reserved_for))}` : null,
    quem: texto(r.customer_name),
    atencao: r.status === "pending",
  }));
}

/**
 * O agente respondendo.
 *
 * Duas consultas de propósito: as mensagens não têm venue_id, e trazer por
 * junção do PostgREST custaria uma view só para isto. As conversas da casa
 * são poucas e a lista de ids é curta.
 */
async function agenteNoWhatsapp(j: Janela): Promise<Fato[]> {
  const { data: conversas } = await cliente()
    .from("conversations")
    .select("id, title, external_id, channel, updated_at")
    .eq("venue_id", j.venueId)
    .gte("updated_at", j.desde)
    .order("updated_at", { ascending: false })
    .limit(30);

  const lista = (conversas ?? []) as Array<Record<string, unknown>>;
  if (lista.length === 0) return [];

  const nomeDa = new Map(lista.map((c) => [String(c.id), texto(c.title) || texto(c.external_id)]));
  const { data: mensagens } = await cliente()
    .from("messages")
    .select("id, conversation_id, role, content, created_at")
    .in("conversation_id", lista.map((c) => c.id))
    .gte("created_at", j.desde)
    .order("created_at", { ascending: false })
    .limit(j.limite);

  return ((mensagens ?? []) as Array<Record<string, unknown>>).map((m) => {
    const doAgente = m.role === "assistant";
    const nome = nomeDa.get(String(m.conversation_id)) ?? null;
    return {
      id: `msg:${m.id}`,
      quando: String(m.created_at),
      // O agente atende CLIENTE: a baia dele é o atendimento, não a porta.
      setor: "atendimento",
      tipo: doAgente ? "agente-respondeu" : "cliente-falou",
      titulo: doAgente ? "O agente respondeu" : "Cliente falou no WhatsApp",
      detalhe: resumir(texto(m.content)),
      quem: nome,
      atencao: false,
    };
  });
}

async function docaRecebendo(j: Janela): Promise<Fato[]> {
  const [{ data: compras }, { data: contagens }] = await Promise.all([
    cliente()
      .from("compras")
      .select("id, fornecedor, valor_total, status, created_at, recebida_em")
      .eq("venue_id", j.venueId)
      .gte("created_at", j.desde)
      .order("created_at", { ascending: false })
      .limit(j.limite),
    cliente()
      .from("contagens")
      .select("id, status, created_at, processada_em")
      .eq("venue_id", j.venueId)
      .gte("created_at", j.desde)
      .order("created_at", { ascending: false })
      .limit(j.limite),
  ]);

  const deCompra = ((compras ?? []) as Array<Record<string, unknown>>).map((c) => ({
    id: `compra:${c.id}`,
    quando: String(c.recebida_em ?? c.created_at),
    setor: "recebimento",
    tipo: c.recebida_em ? "recebimento" : "pedido",
    titulo: c.recebida_em ? "Mercadoria recebida" : "Pedido de compra lançado",
    detalhe: [texto(c.fornecedor), c.valor_total ? dinheiro(Number(c.valor_total)) : null]
      .filter(Boolean)
      .join(" · ") || null,
    quem: texto(c.fornecedor),
    // Pedido que ainda não chegou é cobrança: alguém precisa conferir.
    atencao: !c.recebida_em && c.status !== "cancelada",
  }));

  const deContagem = ((contagens ?? []) as Array<Record<string, unknown>>).map((c) => ({
    id: `contagem:${c.id}`,
    quando: String(c.processada_em ?? c.created_at),
    setor: "recebimento",
    tipo: "contagem",
    titulo: c.processada_em ? "Contagem de estoque fechada" : "Contagem aberta",
    detalhe: null,
    quem: null,
    atencao: !c.processada_em,
  }));

  return [...deCompra, ...deContagem];
}

async function cozinhaProduzindo(j: Janela): Promise<Fato[]> {
  const { data } = await cliente()
    .from("producoes")
    .select("id, lotes, status, created_at, ficha_id")
    .eq("venue_id", j.venueId)
    .gte("created_at", j.desde)
    .order("created_at", { ascending: false })
    .limit(j.limite);

  const linhas = (data ?? []) as Array<Record<string, unknown>>;
  if (linhas.length === 0) return [];

  const { data: fichas } = await cliente()
    .from("fichas_tecnicas")
    .select("id, nome")
    .in("id", [...new Set(linhas.map((p) => p.ficha_id).filter(Boolean))]);
  const nomeDa = new Map(
    ((fichas ?? []) as Array<{ id: string; nome: string }>).map((f) => [f.id, f.nome]),
  );

  return linhas.map((p) => ({
    id: `producao:${p.id}`,
    quando: String(p.created_at),
    setor: "cozinha",
    tipo: "producao",
    titulo: `Produziu ${Number(p.lotes) || 1} lote(s)`,
    detalhe: nomeDa.get(String(p.ficha_id)) ?? null,
    quem: null,
    atencao: false,
  }));
}

async function escritorioDoRh(j: Janela): Promise<Fato[]> {
  const [{ data: pontos }, { data: ferias }] = await Promise.all([
    cliente()
      .from("rh_pontos")
      .select("id, atendente_id, tipo, momento, origem")
      .eq("venue_id", j.venueId)
      .gte("momento", j.desde)
      .order("momento", { ascending: false })
      .limit(j.limite),
    cliente()
      .from("rh_ferias")
      .select("id, atendente_id, inicio, fim, dias, situacao, criado_em")
      .eq("venue_id", j.venueId)
      .gte("criado_em", j.desde)
      .order("criado_em", { ascending: false })
      .limit(j.limite),
  ]);

  const linhas = [...((pontos ?? []) as Array<Record<string, unknown>>), ...((ferias ?? []) as Array<Record<string, unknown>>)];
  const nomeDa = await nomesDaEquipe(j.venueId, linhas.map((l) => String(l.atendente_id)));

  const NOME_DA_BATIDA: Record<string, string> = {
    entrada: "Bateu entrada",
    saida: "Bateu saída",
    pausa: "Saiu para a pausa",
    volta: "Voltou da pausa",
  };

  const deBatida = ((pontos ?? []) as Array<Record<string, unknown>>).map((p) => ({
    id: `ponto:${p.id}`,
    quando: String(p.momento),
    setor: "rh",
    tipo: "ponto",
    titulo: NOME_DA_BATIDA[String(p.tipo)] ?? "Bateu ponto",
    detalhe: p.origem === "gestor" ? "lançado pelo gestor" : null,
    quem: nomeDa.get(String(p.atendente_id)) ?? null,
    atencao: false,
  }));

  const deFerias = ((ferias ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: `ferias:${f.id}`,
    quando: String(f.criado_em),
    setor: "rh",
    tipo: "ferias",
    titulo: f.situacao === "aprovado" ? "Férias registradas" : "Férias pedidas",
    detalhe: `${Number(f.dias)} dia(s) a partir de ${quando(String(f.inicio))}`,
    quem: nomeDa.get(String(f.atendente_id)) ?? null,
    atencao: f.situacao === "pedido",
  }));

  return [...deBatida, ...deFerias];
}

async function salaoDoCardapio(j: Janela): Promise<Fato[]> {
  const { data } = await cliente()
    .from("mesa_eventos")
    .select("id, mesa_numero, cliente_nome, item_nome, tipo, criado_em")
    .eq("venue_id", j.venueId)
    .gte("criado_em", j.desde)
    .order("criado_em", { ascending: false })
    .limit(j.limite);

  // Os nomes são os que o cardápio grava de verdade. Já estiveram errados
  // aqui: eu tinha inventado "abriu/curtiu/chamou", e o evento real nunca
  // casava — a mesa acendia na tela e o texto saía cru.
  const NOME_DO_EVENTO: Record<string, string> = {
    visualizacao: "Olhou um item",
    chamou_garcom: "Chamou o garçom",
    garcom: "Garçom atendeu",
    pedido: "Fez um pedido",
  };

  return ((data ?? []) as Array<Record<string, unknown>>).map((e) => ({
    id: `mesa:${e.id}`,
    quando: String(e.criado_em),
    setor: "salao",
    tipo: String(e.tipo),
    titulo: `Mesa ${e.mesa_numero}: ${NOME_DO_EVENTO[String(e.tipo)] ?? String(e.tipo)}`,
    detalhe: texto(e.item_nome),
    quem: texto(e.cliente_nome),
    atencao: e.tipo === "chamou_garcom",
  }));
}

async function rotinasDoTurno(j: Janela): Promise<Fato[]> {
  const { data } = await cliente()
    .from("checklist_runs")
    .select("id, executor_nome, status, scheduled_for, completed_at, created_at, alertas_ia")
    .eq("venue_id", j.venueId)
    .gte("created_at", j.desde)
    .order("created_at", { ascending: false })
    .limit(j.limite);

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const alertas = Array.isArray(r.alertas_ia) ? r.alertas_ia.length : 0;
    return {
      id: `checklist:${r.id}`,
      quando: String(r.completed_at ?? r.created_at),
      setor: "rotinas",
      tipo: "checklist",
      titulo: r.completed_at ? "Checklist concluído" : "Checklist aberto",
      detalhe: alertas > 0 ? `${alertas} ponto(s) de atenção` : null,
      quem: texto(r.executor_nome),
      atencao: alertas > 0,
    };
  });
}

async function opiniaoDoCliente(j: Janela): Promise<Fato[]> {
  const [{ data: respostas }, { data: avaliacoes }] = await Promise.all([
    cliente()
      .from("pesquisa_respostas")
      .select("id, nota, comentario, cliente_nome, mesa, created_at")
      .eq("venue_id", j.venueId)
      .gte("created_at", j.desde)
      .order("created_at", { ascending: false })
      .limit(j.limite),
    cliente()
      .from("google_avaliacoes")
      .select("id, nota, comentario, autor, created_at")
      .eq("venue_id", j.venueId)
      .gte("created_at", j.desde)
      .order("created_at", { ascending: false })
      .limit(j.limite),
  ]);

  const daPesquisa = ((respostas ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: `resposta:${r.id}`,
    quando: String(r.created_at),
    setor: "atendimento",
    tipo: "pesquisa",
    titulo: `Respondeu a pesquisa: nota ${r.nota}`,
    detalhe: resumir(texto(r.comentario)),
    quem: texto(r.cliente_nome),
    // Detrator na régua do NPS: é o telefonema de hoje.
    atencao: Number(r.nota) <= 6,
  }));

  const doGoogle = ((avaliacoes ?? []) as Array<Record<string, unknown>>).map((a) => ({
    id: `google:${a.id}`,
    quando: String(a.created_at),
    setor: "atendimento",
    tipo: "google",
    titulo: `Avaliação no Google: ${a.nota} estrela(s)`,
    detalhe: resumir(texto(a.comentario)),
    quem: texto(a.autor),
    atencao: Number(a.nota) <= 3,
  }));

  return [...daPesquisa, ...doGoogle];
}

/** Qual fonte alimenta qual setor, e de qual módulo ela depende. */
const FONTES: Array<{ modulo: string; fonte: Fonte }> = [
  { modulo: "agentes-ia", fonte: reservas },
  { modulo: "agentes-ia", fonte: agenteNoWhatsapp },
  { modulo: "cmv", fonte: docaRecebendo },
  { modulo: "cmv", fonte: cozinhaProduzindo },
  { modulo: "rh", fonte: escritorioDoRh },
  { modulo: "cardapio-digital", fonte: salaoDoCardapio },
  { modulo: "checklist", fonte: rotinasDoTurno },
  { modulo: "clientes", fonte: opiniaoDoCliente },
];

// ============================================================
// As mesas do salão
// ============================================================

export interface MesaNoSalao {
  numero: number;
  /** `livre`, `ocupada` (leu o QR) ou `chamando` (pediu o garçom). */
  estado: "livre" | "ocupada" | "chamando";
  cliente: string | null;
  /** O item que a mesa estava olhando no cardápio. */
  olhando: string | null;
  garcom: string | null;
  /** Há quantos minutos a mesa está aberta. */
  minutos: number | null;
}

/** Depois disto, a mesa apaga sozinha: ninguém fica três horas no cardápio. */
export const MINUTOS_DE_MESA_ACESA = 150;
/** Chamado de garçom fica piscando por este tempo. */
export const MINUTOS_DE_CHAMADO = 20;

/**
 * O estado de cada mesa do salão.
 *
 * A mesa acende quando alguém LÊ O QR CODE dela — é a sessão do cardápio que
 * abre. Ela pisca quando essa mesa chamou o garçom. Apaga sozinha depois de
 * um tempo sem evento, porque o cliente vai embora sem avisar o sistema.
 *
 * Mesa cadastrada e sem sessão aparece livre, e não some: o salão vazio tem
 * de parecer o salão vazio, com as mesas no lugar.
 */
export function montarMesas(params: {
  cadastro: number[];
  sessoes: Array<{ mesa: number; cliente: string | null; olhando: string | null; ultimoEm: string }>;
  chamados: Array<{ mesa: number; em: string }>;
  garcons: Map<number, string>;
  agora: string;
}): MesaNoSalao[] {
  const sessaoDa = new Map(params.sessoes.map((s) => [s.mesa, s]));
  const chamadoDa = new Map<number, number>();
  for (const c of params.chamados) {
    const faz = minutosEntre(c.em, params.agora);
    const atual = chamadoDa.get(c.mesa);
    if (atual === undefined || faz < atual) chamadoDa.set(c.mesa, faz);
  }

  // A mesa que nem está no cadastro, mas teve movimento, entra assim mesmo:
  // é a mesa que alguém criou na correria e não cadastrou.
  const numeros = [...new Set([...params.cadastro, ...sessaoDa.keys(), ...chamadoDa.keys()])].sort((a, b) => a - b);

  return numeros.map((numero) => {
    const sessao = sessaoDa.get(numero);
    const faz = sessao ? minutosEntre(sessao.ultimoEm, params.agora) : null;
    const acesa = faz !== null && faz <= MINUTOS_DE_MESA_ACESA;
    const chamando = (chamadoDa.get(numero) ?? Infinity) <= MINUTOS_DE_CHAMADO;

    return {
      numero,
      estado: chamando ? "chamando" : acesa ? "ocupada" : "livre",
      cliente: acesa ? (sessao?.cliente ?? null) : null,
      olhando: acesa ? (sessao?.olhando ?? null) : null,
      garcom: params.garcons.get(numero) ?? null,
      minutos: acesa || chamando ? faz : null,
    };
  });
}

/** O salão de verdade: cadastro de mesas, sessões abertas e chamados. */
async function mesasDoSalao(venueId: string, dia: string): Promise<MesaNoSalao[]> {
  const agora = new Date().toISOString();
  const desde = new Date(Date.now() - 4 * 3600_000).toISOString();

  const [{ data: cadastro }, { data: sessoes }, { data: eventos }, { data: turno }] = await Promise.all([
    cliente().from("mesas").select("numero").eq("venue_id", venueId).eq("ativa", true).order("numero"),
    cliente()
      .from("mesa_sessoes")
      .select("mesa_numero, cliente_nome, ultimo_item, iniciada_em, ultimo_evento_em")
      .eq("venue_id", venueId)
      .eq("ativa", true)
      .order("ultimo_evento_em", { ascending: false, nullsFirst: false })
      .limit(300),
    cliente()
      .from("mesa_eventos")
      .select("mesa_numero, criado_em")
      .eq("venue_id", venueId)
      .eq("tipo", "chamou_garcom")
      .gte("criado_em", desde)
      .order("criado_em", { ascending: false })
      .limit(100),
    cliente().from("turno_mesas").select("mesa_numero, garcom_nome").eq("venue_id", venueId).eq("turno_data", dia),
  ]);

  // Uma sessão por mesa: a mais recente, que é a primeira da ordenação.
  const porMesa = new Map<number, { mesa: number; cliente: string | null; olhando: string | null; ultimoEm: string }>();
  for (const s of (sessoes ?? []) as Array<Record<string, unknown>>) {
    const numero = Number(s.mesa_numero);
    if (porMesa.has(numero)) continue;
    porMesa.set(numero, {
      mesa: numero,
      cliente: texto(s.cliente_nome),
      olhando: texto(s.ultimo_item),
      ultimoEm: String(s.ultimo_evento_em ?? s.iniciada_em),
    });
  }

  return montarMesas({
    cadastro: ((cadastro ?? []) as Array<{ numero: number }>).map((m) => Number(m.numero)),
    sessoes: [...porMesa.values()],
    chamados: ((eventos ?? []) as Array<Record<string, unknown>>).map((e) => ({
      mesa: Number(e.mesa_numero),
      em: String(e.criado_em),
    })),
    garcons: new Map(
      ((turno ?? []) as Array<{ mesa_numero: number; garcom_nome: string }>).map((t) => [
        Number(t.mesa_numero),
        t.garcom_nome,
      ]),
    ),
    agora,
  });
}

// ============================================================
// Quem está na casa agora
// ============================================================

/** A última batida manda: entrada e volta põem na casa; pausa e saída tiram. */
const NA_CASA = new Set(["entrada", "volta"]);

/**
 * As pessoas com o ponto aberto.
 *
 * Lê as batidas das últimas dezoito horas e fica com a última de cada um —
 * dezoito horas porque o turno de bar atravessa a madrugada, e pedir o "dia
 * operacional" aqui amarraria esta tela à configuração do CMV.
 */
async function pessoasNaCasa(venueId: string): Promise<Trabalhador[]> {
  const desde = new Date(Date.now() - 18 * 3600_000).toISOString();
  const { data } = await cliente()
    .from("rh_pontos")
    .select("atendente_id, tipo, momento")
    .eq("venue_id", venueId)
    .gte("momento", desde)
    .order("momento", { ascending: true });

  const ultima = new Map<string, { tipo: string; momento: string }>();
  for (const b of (data ?? []) as Array<{ atendente_id: string; tipo: string; momento: string }>) {
    ultima.set(b.atendente_id, { tipo: b.tipo, momento: b.momento });
  }
  const dentro = [...ultima.entries()].filter(([, b]) => NA_CASA.has(b.tipo) || b.tipo === "pausa");
  if (dentro.length === 0) return [];

  const { data: pessoas } = await cliente()
    .from("pesquisa_atendentes")
    .select("id, nome, apelido, funcao")
    .eq("venue_id", venueId)
    .in("id", dentro.map(([id]) => id));

  const cadastro = new Map(
    ((pessoas ?? []) as Array<{ id: string; nome: string; apelido: string | null; funcao: string | null }>)
      .map((p) => [p.id, p]),
  );

  return dentro.map(([id, batida]) => {
    const pessoa = cadastro.get(id);
    return {
      id: `pessoa:${id}`,
      nome: pessoa?.apelido || pessoa?.nome || "Alguém",
      tipo: "pessoa" as const,
      papel: pessoa?.funcao ?? null,
      setor: setorDaFuncao(pessoa?.funcao ?? null),
      fazendo: null,
      desde: batida.momento,
      minutos_parado: null,
      em_pausa: batida.tipo === "pausa",
    };
  });
}

/**
 * Os agentes de software, que também moram na casa.
 *
 * São dois, e os dois são verdade conferível: o que atende no WhatsApp e o
 * que despacha a fila de avisos. Inventar um terceiro "robô do estoque" só
 * porque a planta tem espaço seria encher a tela de mentira.
 */
async function agentesDeSoftware(venueId: string, contratados: string[]): Promise<Trabalhador[]> {
  const lista: Trabalhador[] = [];

  if (contratados.includes("agentes-ia")) {
    lista.push(await atendenteDoWhatsapp(venueId));
  }
  lista.push(await carteiroDosAvisos(venueId));
  return lista;
}

async function atendenteDoWhatsapp(venueId: string): Promise<Trabalhador> {
  const base: Trabalhador = {
    id: "agente:atendente",
    nome: "Atendente",
    tipo: "agente",
    papel: "Responde o WhatsApp",
    setor: "atendimento",
    fazendo: null,
    desde: null,
    minutos_parado: null,
    em_pausa: false,
  };

  // Oito, e não uma: a de cima diz o que ele está fazendo agora, e as
  // outras sete são o que a gaveta mostra quando alguém clica no agente.
  const { data: conversas } = await cliente()
    .from("conversations")
    .select("id, title, external_id, updated_at")
    .eq("venue_id", venueId)
    .order("updated_at", { ascending: false })
    .limit(8);

  const fila = (conversas ?? []) as Array<Record<string, unknown>>;
  const conversa = fila[0];
  if (!conversa) return base;

  const agora = new Date().toISOString();
  const nome = texto(conversa.title) || texto(conversa.external_id);
  const minutos = minutosEntre(String(conversa.updated_at), agora);
  return {
    ...base,
    // Cinco minutos: uma conversa de WhatsApp respira nesse ritmo. Passou
    // disso, o agente já respondeu e está esperando o próximo.
    fazendo: minutos <= 5 ? `Respondendo ${primeiroNome(nome) ?? "um cliente"}` : null,
    desde: String(conversa.updated_at),
    minutos_parado: minutos,
    detalhes: fila.map((c) => ({
      titulo: texto(c.title) || texto(c.external_id) || "Alguém no WhatsApp",
      detalhe: `última mensagem ${comoFazTempo(minutosEntre(String(c.updated_at), agora))}`,
      quando: String(c.updated_at),
      ruim: false,
    })),
  };
}

async function carteiroDosAvisos(venueId: string): Promise<Trabalhador> {
  const { data } = await cliente()
    .from("notifications")
    .select("id, status, template, destination, error, created_at")
    .eq("venue_id", venueId)
    .in("status", ["pending", "queued", "failed"])
    .order("created_at", { ascending: true })
    .limit(50);

  const fila = (data ?? []) as AvisoNaFila[];
  const falhas = fila.filter((n) => n.status === "failed").length;
  const esperando = fila.length - falhas;

  return {
    id: "agente:carteiro",
    nome: "Carteiro",
    tipo: "agente",
    papel: "Manda os avisos no WhatsApp",
    setor: "rh",
    fazendo: esperando > 0 ? `${esperando} aviso(s) para enviar` : falhas > 0 ? `${falhas} aviso(s) falharam` : null,
    desde: fila[0]?.created_at ?? null,
    minutos_parado: null,
    em_pausa: false,
    detalhes: filaDoCarteiro(fila),
  };
}

// ============================================================
// A leitura
// ============================================================

export async function oQueEstaAcontecendo(params: {
  venueId: string;
  /** Os módulos que a casa contratou. */
  contratados: string[];
  /** Ler o que aconteceu a partir daqui. Padrão: as últimas 24 horas. */
  desde?: string;
  limite?: number;
  /** O dia da casa, para achar o garçom de cada mesa no turno. */
  dia: string;
}): Promise<{
  agora: string;
  desde: string;
  setores: Setor[];
  fatos: Fato[];
  trabalhadores: Trabalhador[];
  mesas: MesaNoSalao[];
  setoresMudos: string[];
}> {
  const agora = new Date().toISOString();
  const desde = params.desde ?? new Date(Date.now() - 24 * 3600_000).toISOString();
  const janela: Janela = { venueId: params.venueId, desde, limite: params.limite ?? 40 };

  const temModulo = new Set(params.contratados);
  const aRodar = FONTES.filter((f) => temModulo.has(f.modulo));

  // `allSettled`, e não `all`: uma fonte que falha (migração que não rodou,
  // tabela de um módulo antigo) não pode apagar a casa inteira.
  const resultados = await Promise.allSettled(aRodar.map((f) => f.fonte(janela)));

  const fatos: Fato[] = [];
  const setoresMudos: string[] = [];
  resultados.forEach((r, i) => {
    if (r.status === "fulfilled") {
      fatos.push(...r.value);
      return;
    }
    const modulo = aRodar[i]!.modulo;
    setoresMudos.push(modulo);
    console.error(`[a-casa] a fonte de ${modulo} não respondeu: ${(r.reason as Error)?.message}`);
  });

  // Quem mora na casa e as mesas do salão são lidos à parte, e com a mesma
  // tolerância a falha: sem ninguém de pé a planta continua contando o que
  // aconteceu, e sem as mesas o resto da casa continua de pé.
  const [dosMoradores, dosAgentes, dasMesas] = await Promise.allSettled([
    temModulo.has("rh") ? pessoasNaCasa(params.venueId) : Promise.resolve([] as Trabalhador[]),
    agentesDeSoftware(params.venueId, params.contratados),
    temModulo.has("cardapio-digital")
      ? mesasDoSalao(params.venueId, params.dia)
      : Promise.resolve([] as MesaNoSalao[]),
  ]);

  const trabalhadores: Trabalhador[] = [];
  for (const m of [dosMoradores, dosAgentes]) {
    if (m.status === "fulfilled") trabalhadores.push(...m.value);
    else console.error(`[a-casa] não deu para saber quem está na casa: ${(m.reason as Error)?.message}`);
  }
  if (dasMesas.status === "rejected") {
    console.error(`[a-casa] não deu para ler o salão: ${(dasMesas.reason as Error)?.message}`);
  }
  const mesas = dasMesas.status === "fulfilled" ? dasMesas.value : [];

  // A janela dos fatos é curta quando a tela pergunta de novo, mas quem está
  // fazendo o quê precisa olhar mais para trás — senão todo mundo vira
  // ocioso a cada quinze segundos.
  const fatosDoDia = arrumarFatos(fatos, 200);
  const arrumados = fatosDoDia.slice(0, params.limite ?? 60);

  return {
    agora,
    desde,
    setores: montarSetores({ fatos: arrumados, contratados: params.contratados, agora }),
    fatos: arrumados,
    trabalhadores: oQueCadaUmFaz({ trabalhadores, fatos: fatosDoDia, agora }),
    mesas,
    setoresMudos: [...new Set(setoresMudos)],
  };
}

// ============================================================
// Miudezas de texto
// ============================================================

async function nomesDaEquipe(venueId: string, ids: string[]): Promise<Map<string, string>> {
  const limpos = [...new Set(ids.filter((id) => id && id !== "undefined"))];
  if (limpos.length === 0) return new Map();
  const { data } = await cliente()
    .from("pesquisa_atendentes")
    .select("id, nome, apelido")
    .eq("venue_id", venueId)
    .in("id", limpos);
  return new Map(
    ((data ?? []) as Array<{ id: string; nome: string; apelido: string | null }>).map((p) => [
      p.id,
      p.apelido || p.nome,
    ]),
  );
}

/** Comentário inteiro não cabe no balão do bonequinho. */
function resumir(txt: string | null, tamanho = 90): string | null {
  if (!txt) return null;
  const limpo = txt.replace(/\s+/g, " ").trim();
  if (!limpo) return null;
  return limpo.length <= tamanho ? limpo : `${limpo.slice(0, tamanho - 1)}…`;
}

function quando(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  const hora = iso.length > 10 ? ` ${iso.slice(11, 16)}` : "";
  return `${dia}/${mes}/${ano}${hora}`;
}

function dinheiro(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
