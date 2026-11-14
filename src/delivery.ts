import { randomUUID } from "node:crypto";
import { cardapioPublico, type ItemPublico } from "./cardapioDigital.js";
import { registrarClienteSeDer, telefoneDaBase } from "./clientes.js";
import {
  assinaturaConfere,
  consultarPagamento,
  criarCobranca,
  enderecoPublico,
  type Cobranca,
  type CredenciaisDoMercadoPago,
  type PagamentoDoMercadoPago,
} from "./deliveryPagamento.js";
import { canalAtivo, inserirAvisos, tentarEnviar, type Notification } from "./notifications.js";
import { reivindicar } from "./rotinas.js";
import { db, ehMigracaoPendente } from "./supabase.js";
import type { Venue } from "./venues.js";

/**
 * Delivery: o canal próprio de pedidos da casa, sem comissão de aplicativo.
 *
 * O cliente pede de dois jeitos, e os dois caem na MESMA sacola: pelo
 * cardápio com link próprio (/delivery/<casa>) ou conversando com o
 * atendente virtual, que manda esse link, tira dúvida e também fecha o
 * pedido inteiro pela conversa.
 *
 * Três regras atravessam o arquivo:
 *
 * 1. Preço, taxa, desconto e cashback são calculados AQUI, a partir do
 *    cardápio do dia. O que chega do navegador e do modelo é só a intenção
 *    ("dois X-Burger com bacon"); número nenhum vem de fora.
 * 2. O pagamento é antecipado (Pix ou cartão). O pedido só entra como
 *    `recebido` — que é quando a cozinha vê — depois que o Mercado Pago
 *    confirma. Não existe "pagar na entrega".
 * 3. Cashback só é gasto e só é ganho por telefone que o CANAL verificou
 *    (a conversa do WhatsApp). No site aberto, digitar o número de outra
 *    pessoa não dá o saldo dela.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// Sem os tipos gerados: as tabelas do delivery são novas e `database.types.ts`
// só é regerado depois que a migração roda em produção — a mesma decisão já
// tomada no CMV, na pesquisa e no financeiro.
const cliente = () => db() as any;

export class ErroDoDelivery extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDoDelivery";
  }
}

function falhar(contexto: string, mensagem: string): never {
  if (ehMigracaoPendente(mensagem)) {
    throw new ErroDoDelivery(503, `${contexto}: o banco ainda não recebeu a migração do Delivery. Rode o SQL e tente de novo.`);
  }
  // Erro de regra levantado pelas funções do banco: é para o cliente ler.
  const regra = /DELIVERY:\s*(.+)$/m.exec(mensagem);
  if (regra) throw new ErroDoDelivery(400, regra[1]!.trim());
  throw new ErroDoDelivery(500, `${contexto}: ${mensagem}`);
}

function recusar(mensagem: string): never {
  throw new ErroDoDelivery(400, mensagem);
}

export const dinheiro = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const emCentavos = (reais: number) => Math.round(reais * 100);
const texto = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max) || null;
const ehUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

// ============================================================
// Tipos
// ============================================================

export type StatusDoPedido =
  | "aguardando_pagamento"
  | "recebido"
  | "em_preparo"
  | "saiu_para_entrega"
  | "pronto_para_retirada"
  | "entregue"
  | "cancelado";

export const STATUS_DO_PEDIDO: StatusDoPedido[] = [
  "aguardando_pagamento", "recebido", "em_preparo", "saiu_para_entrega", "pronto_para_retirada", "entregue", "cancelado",
];

export const ROTULO_DO_STATUS: Record<StatusDoPedido, string> = {
  aguardando_pagamento: "aguardando pagamento",
  recebido: "recebido pela casa",
  em_preparo: "em preparo",
  saiu_para_entrega: "saiu para entrega",
  pronto_para_retirada: "pronto para retirada",
  entregue: "entregue",
  cancelado: "cancelado",
};

export type Pagamento = "pix" | "cartao";
export const ROTULO_DO_PAGAMENTO: Record<Pagamento, string> = { pix: "Pix", cartao: "Cartão" };

export interface ConfigDoDelivery {
  aceitando: boolean;
  /** { "0": ["18:00", "23:00"] } por dia da semana (0 = domingo). */
  horario: Record<string, [string, string]>;
  taxa_unica_centavos: number;
  previsao: string;
  endereco_retirada: string | null;
  cashback_percentual: number;
  lembrar_sacola: boolean;
  instrucoes: string | null;
  mp_access_token: string | null;
  mp_webhook_secret: string | null;
  mp_email_pagador: string | null;
}

export const CONFIG_PADRAO: ConfigDoDelivery = {
  aceitando: true,
  horario: {},
  taxa_unica_centavos: 0,
  previsao: "40 a 60 minutos",
  endereco_retirada: null,
  cashback_percentual: 0,
  lembrar_sacola: true,
  instrucoes: null,
  mp_access_token: null,
  mp_webhook_secret: null,
  mp_email_pagador: null,
};

export interface Bairro {
  id: string;
  nome: string;
  taxa_centavos: number;
  ativo: boolean;
}

export interface Cupom {
  id: string;
  codigo: string;
  tipo: "percentual" | "fixo";
  valor: number;
  minimo_centavos: number;
  limite_usos: number;
  usos: number;
  expira_em: string | null;
  ativo: boolean;
}

export interface OpcaoEscolhida {
  id: string;
  grupo: string;
  nome: string;
}

/** Uma linha da sacola como fica gravada: só a intenção, sem preço. */
export interface LinhaGravada {
  id: string;
  item_id: string;
  quantidade: number;
  opcoes: OpcaoEscolhida[];
  observacao: string | null;
}

/** A linha já com o preço do cardápio de agora. */
export interface LinhaDaSacola extends LinhaGravada {
  nome: string;
  preco_centavos: number;
  /** O item saiu do cardápio (ou a opção deixou de existir) depois de entrar na sacola. */
  indisponivel: boolean;
}

export interface Sacola {
  id: string;
  venue_id: string;
  conversation_id: string | null;
  telefone: string | null;
  nome: string | null;
  endereco: string | null;
  bairro: string | null;
  itens: LinhaGravada[];
  atualizada_em: string;
  lembrada_em: string | null;
}

export interface Pedido {
  id: string;
  venue_id: string;
  numero: number;
  token: string;
  sacola_id: string | null;
  conversation_id: string | null;
  origem: "cardapio" | "conversa";
  canal: string;
  nome: string;
  telefone: string;
  telefone_verificado: boolean;
  tipo: "entrega" | "retirada";
  endereco: string | null;
  bairro: string | null;
  pagamento: Pagamento;
  subtotal_centavos: number;
  taxa_centavos: number;
  desconto_centavos: number;
  cupom: string | null;
  cashback_usado_centavos: number;
  cashback_ganho_centavos: number;
  total_centavos: number;
  status: StatusDoPedido;
  mp_ref: string | null;
  link_pagamento: string | null;
  pix_codigo: string | null;
  pix_qr: string | null;
  observacoes: string | null;
  criado_em: string;
  pago_em: string | null;
}

export interface ItemDoPedido {
  nome: string;
  opcoes: string | null;
  preco_centavos: number;
  quantidade: number;
  observacao: string | null;
}

// ============================================================
// Regras puras — o que os testes cobrem sem banco
// ============================================================

/**
 * A casa está entregando agora?
 *
 * A chave manual vence o horário: pausar o delivery numa noite de casa cheia
 * não pode depender de alguém lembrar de editar a grade. Sem nenhum dia na
 * grade, vale só a chave — é o estado de quem acabou de ligar o módulo.
 */
export function abertoAgora(
  cfg: Pick<ConfigDoDelivery, "aceitando" | "horario">,
  fuso: string,
  agora = new Date(),
): boolean {
  if (!cfg.aceitando) return false;
  const horario = cfg.horario ?? {};
  if (Object.keys(horario).length === 0) return true;

  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: fuso, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  );
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(partes.weekday ?? "");
  const hm = `${partes.hour}:${partes.minute}`;

  const hoje = horario[String(dia)];
  if (hoje) {
    const [abre, fecha] = hoje;
    if (fecha > abre ? hm >= abre && hm < fecha : hm >= abre) return true;
  }
  // O turno que atravessa a meia-noite (18:00–02:00) ainda vale na madrugada
  // do dia seguinte: sábado 01:30 é a sexta que não acabou.
  const ontem = horario[String((dia + 6) % 7)];
  return Boolean(ontem && ontem[1] <= ontem[0] && hm < ontem[1]);
}

/** A grade que veio da tela, conferida: só dia 0–6 e hora HH:MM. */
export function lerHorario(bruto: unknown): Record<string, [string, string]> {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return {};
  const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
  const saida: Record<string, [string, string]> = {};
  for (const [dia, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(dia) || !Array.isArray(valor)) recusar("Horário inválido: confira os dias marcados.");
    const [abre, fecha] = valor as unknown[];
    if (typeof abre !== "string" || typeof fecha !== "string" || !HORA.test(abre) || !HORA.test(fecha)) {
      recusar("Horário inválido: use o formato 18:00.");
    }
    saida[dia] = [abre as string, fecha as string];
  }
  return saida;
}

/**
 * Confere as opções escolhidas contra as variações do item.
 *
 * O Cardápio Digital só sabe se o grupo é obrigatório ou não. Para vender, a
 * leitura é: obrigatório = exatamente uma (o sabor, o ponto da carne);
 * opcional = quantas quiser, cada uma no máximo uma vez (os adicionais).
 *
 * Aceita o id da opção (o cardápio manda) ou o nome (o atendente fala).
 */
export function escolherOpcoes(item: Pick<ItemPublico, "nome" | "variacoes">, escolhidas: string[]): OpcaoEscolhida[] {
  const pedidas = escolhidas.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const usadas = new Set<string>();
  const saida: OpcaoEscolhida[] = [];

  for (const grupo of item.variacoes) {
    const desteGrupo = grupo.opcoes.filter((o) => pedidas.includes(o.id.toLowerCase()) || pedidas.includes(o.nome.trim().toLowerCase()));
    if (grupo.obrigatorio && desteGrupo.length !== 1) {
      recusar(
        `"${item.nome}": escolha uma opção de "${grupo.nome}" (${grupo.opcoes.map((o) => o.nome).join(", ")}).`,
      );
    }
    for (const o of desteGrupo) {
      usadas.add(o.id.toLowerCase());
      usadas.add(o.nome.trim().toLowerCase());
      saida.push({ id: o.id, grupo: grupo.nome, nome: o.nome });
    }
  }
  const sobrou = pedidas.find((p) => !usadas.has(p));
  if (sobrou) recusar(`"${item.nome}" não tem a opção "${sobrou}".`);
  return saida;
}

/** O preço de UMA unidade agora: promoção em vigor (se houver) mais os adicionais. */
export function precoDaLinha(item: ItemPublico, opcoes: OpcaoEscolhida[]): { centavos: number; indisponivel: boolean } {
  let centavos = emCentavos(item.promocao?.preco ?? item.preco);
  let indisponivel = false;
  const todas = new Map(item.variacoes.flatMap((g) => g.opcoes.map((o) => [o.id, o] as const)));
  for (const escolhida of opcoes) {
    const opcao = todas.get(escolhida.id);
    if (!opcao) indisponivel = true;
    else centavos += emCentavos(opcao.adicional);
  }
  return { centavos, indisponivel };
}

/**
 * O item que a pessoa quis dizer: pelo id (o cardápio manda), pelo nome exato
 * ou por um pedaço do nome que só case com UM item (o atendente fala).
 *
 * Pedaço que casa com vários não é adivinhado: "x-burger" não pode virar
 * "X-Burger Duplo" por ser o primeiro da lista. O erro devolve os candidatos
 * para o atendente perguntar qual.
 */
export function acharItem<T extends { id: string; nome: string }>(cardapio: T[], pedido: string): T {
  const alvo = pedido.trim().toLowerCase();
  const exato = cardapio.find((i) => i.id === pedido) ?? cardapio.find((i) => i.nome.trim().toLowerCase() === alvo);
  if (exato) return exato;
  const parecidos = alvo ? cardapio.filter((i) => i.nome.toLowerCase().includes(alvo)) : [];
  if (parecidos.length === 1) return parecidos[0]!;
  if (parecidos.length > 1) {
    return recusar(`"${pedido}" pode ser: ${parecidos.slice(0, 8).map((i) => i.nome).join("; ")}. Pergunte qual e use o nome exato.`);
  }
  return recusar(`"${pedido}" não está no cardápio de hoje.`);
}

/** A sacola gravada, com nome e preço do cardápio de agora. */
export function precificar(itens: LinhaGravada[], cardapio: ItemPublico[]): { linhas: LinhaDaSacola[]; subtotal: number } {
  const porId = new Map(cardapio.map((i) => [i.id, i]));
  const linhas = itens.map((l): LinhaDaSacola => {
    const item = porId.get(l.item_id);
    if (!item) return { ...l, nome: "Item fora do cardápio", preco_centavos: 0, indisponivel: true };
    const { centavos, indisponivel } = precoDaLinha(item, l.opcoes);
    return { ...l, nome: item.nome, preco_centavos: centavos, indisponivel };
  });
  return { linhas, subtotal: linhas.reduce((s, l) => s + l.preco_centavos * l.quantidade, 0) };
}

export interface PedidoDeCotacao {
  tipo: "entrega" | "retirada";
  /** Id do bairro (o cardápio manda) ou o nome (o atendente fala). */
  bairro?: string | null;
  cupom?: string | null;
  usar_cashback?: boolean;
}

export interface Cotacao {
  subtotal: number;
  taxa: number;
  desconto: number;
  cashback_usado: number;
  cashback_disponivel: number;
  total: number;
  bairro: string | null;
  cupom: string | null;
  /** O que impede fechar: bairro não atendido, cupom inválido… */
  pendencias: string[];
}

/** Quanto custa este pedido. Não lê nem grava nada: recebe tudo pronto. */
export function cotar(params: {
  subtotal: number;
  pedido: PedidoDeCotacao;
  cfg: Pick<ConfigDoDelivery, "taxa_unica_centavos">;
  bairros: Bairro[];
  cupom: Cupom | null;
  /** Saldo do telefone verificado; 0 para quem abriu direto no site. */
  saldoDeCashback: number;
  hoje: string;
}): Cotacao {
  const { subtotal, pedido, cfg, cupom, saldoDeCashback, hoje } = params;
  const pendencias: string[] = [];

  let taxa = 0;
  let bairro: string | null = null;
  if (pedido.tipo === "entrega") {
    const ativos = params.bairros.filter((b) => b.ativo);
    if (ativos.length > 0) {
      const pedidoBairro = pedido.bairro?.trim().toLowerCase();
      const achado = ativos.find((b) => b.id === pedido.bairro || b.nome.trim().toLowerCase() === pedidoBairro);
      if (achado) {
        taxa = achado.taxa_centavos;
        bairro = achado.nome;
      } else {
        pendencias.push(`Escolha o bairro da entrega. Atendemos: ${ativos.map((b) => b.nome).join(", ")}.`);
      }
    } else {
      taxa = cfg.taxa_unica_centavos;
      bairro = pedido.bairro?.trim() || null;
    }
  }

  let desconto = 0;
  let codigo: string | null = null;
  const pedidoCupom = pedido.cupom?.trim().toUpperCase();
  if (pedidoCupom) {
    if (!cupom || !cupom.ativo) pendencias.push(`O cupom ${pedidoCupom} não é válido.`);
    else if (cupom.expira_em && cupom.expira_em < hoje) pendencias.push(`O cupom ${pedidoCupom} expirou.`);
    else if (cupom.limite_usos > 0 && cupom.usos >= cupom.limite_usos) pendencias.push(`O cupom ${pedidoCupom} esgotou.`);
    else if (subtotal < cupom.minimo_centavos) pendencias.push(`O cupom ${pedidoCupom} vale para pedidos a partir de ${dinheiro(cupom.minimo_centavos)}.`);
    else {
      codigo = cupom.codigo;
      desconto = cupom.tipo === "percentual" ? Math.round((subtotal * cupom.valor) / 100) : Math.min(cupom.valor, subtotal);
    }
  }

  // O cashback abate os itens, não a entrega: a taxa é do entregador.
  const cashback_usado = pedido.usar_cashback ? Math.min(saldoDeCashback, subtotal - desconto) : 0;
  return {
    subtotal, taxa, desconto, cashback_usado,
    cashback_disponivel: saldoDeCashback,
    total: subtotal - desconto - cashback_usado + taxa,
    bairro, cupom: codigo, pendencias,
  };
}

/** O cashback de um pedido entregue: percentual sobre o que o cliente pagou pelos itens. */
export function cashbackDoPedido(
  pedido: Pick<Pedido, "subtotal_centavos" | "desconto_centavos" | "cashback_usado_centavos" | "telefone_verificado">,
  percentual: number,
): number {
  if (!pedido.telefone_verificado || percentual <= 0) return 0;
  const base = pedido.subtotal_centavos - pedido.desconto_centavos - pedido.cashback_usado_centavos;
  return Math.max(0, Math.round((base * percentual) / 100));
}

/** Os caminhos que o painel pode dar ao pedido a partir de onde ele está. */
export function proximosStatus(pedido: Pick<Pedido, "status" | "tipo">): StatusDoPedido[] {
  const saida = pedido.tipo === "entrega" ? "saiu_para_entrega" : "pronto_para_retirada";
  switch (pedido.status) {
    // Pedido sem pagamento não vai para a cozinha pela mão de ninguém: quem
    // libera é o Mercado Pago. O painel só pode cancelar.
    case "aguardando_pagamento": return ["cancelado"];
    case "recebido": return ["em_preparo", saida, "entregue", "cancelado"];
    case "em_preparo": return [saida, "entregue", "cancelado"];
    case "saiu_para_entrega":
    case "pronto_para_retirada": return ["entregue", "cancelado"];
    default: return [];
  }
}

export function opcoesEmTexto(opcoes: OpcaoEscolhida[]): string {
  return opcoes.map((o) => o.nome).join(", ");
}

export const enderecoDoCardapio = (venue: Pick<Venue, "slug">, sacolaId?: string | null) =>
  `${enderecoPublico()}/delivery/${encodeURIComponent(venue.slug)}${sacolaId ? `?s=${sacolaId}` : ""}`;
export const enderecoDoPedido = (venue: Pick<Venue, "slug">, pedido: Pick<Pedido, "token">) =>
  `${enderecoPublico()}/delivery/${encodeURIComponent(venue.slug)}?pedido=${pedido.token}`;

// ============================================================
// Configuração, bairros e cupons
// ============================================================

export async function configDoDelivery(venueId: string): Promise<ConfigDoDelivery> {
  const { data, error } = await cliente().from("delivery_config").select("*").eq("venue_id", venueId).maybeSingle();
  if (error) falhar("Falha ao ler a configuração do delivery", error.message);
  return { ...CONFIG_PADRAO, ...(data ?? {}) };
}

/** O que a tela pode saber: o token do Mercado Pago nunca volta inteiro. */
export function configParaATela(cfg: ConfigDoDelivery) {
  const { mp_access_token, mp_webhook_secret, ...resto } = cfg;
  return {
    ...resto,
    mercado_pago: {
      conectado: Boolean(mp_access_token),
      final_do_token: mp_access_token ? mp_access_token.slice(-4) : null,
      webhook_assinado: Boolean(mp_webhook_secret),
    },
  };
}

export async function salvarConfigDoDelivery(venueId: string, campos: Record<string, unknown>): Promise<ConfigDoDelivery> {
  const linha: Record<string, unknown> = { venue_id: venueId, atualizado_em: new Date().toISOString() };
  const inteiro = (v: unknown, min: number, max: number, nome: string): number => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) recusar(`${nome} inválido.`);
    return n;
  };
  if ("aceitando" in campos) linha.aceitando = campos.aceitando === true;
  if ("lembrar_sacola" in campos) linha.lembrar_sacola = campos.lembrar_sacola === true;
  if ("horario" in campos) linha.horario = lerHorario(campos.horario);
  if ("taxa_unica_centavos" in campos) linha.taxa_unica_centavos = inteiro(campos.taxa_unica_centavos, 0, 100_000, "Taxa de entrega");
  if ("cashback_percentual" in campos) linha.cashback_percentual = inteiro(campos.cashback_percentual, 0, 50, "Percentual de cashback");
  if ("previsao" in campos) linha.previsao = texto(campos.previsao, 80) ?? CONFIG_PADRAO.previsao;
  if ("endereco_retirada" in campos) linha.endereco_retirada = texto(campos.endereco_retirada, 300);
  if ("instrucoes" in campos) linha.instrucoes = texto(campos.instrucoes, 4000);
  if ("mp_email_pagador" in campos) linha.mp_email_pagador = texto(campos.mp_email_pagador, 200);
  // Token e segredo só mudam quando vem um valor: a tela não recebe o atual,
  // então campo vazio significa "não mexi", e não "apague".
  for (const segredo of ["mp_access_token", "mp_webhook_secret"] as const) {
    const valor = texto(campos[segredo], 500);
    if (valor) linha[segredo] = valor;
  }
  if (campos.desconectar_mercado_pago === true) {
    linha.mp_access_token = null;
    linha.mp_webhook_secret = null;
  }

  const { error } = await cliente().from("delivery_config").upsert(linha, { onConflict: "venue_id" });
  if (error) falhar("Falha ao salvar a configuração do delivery", error.message);
  return configDoDelivery(venueId);
}

export async function listarBairros(venueId: string): Promise<Bairro[]> {
  const { data, error } = await cliente().from("delivery_bairros").select("id, nome, taxa_centavos, ativo").eq("venue_id", venueId).order("nome");
  if (error) falhar("Falha ao ler os bairros", error.message);
  return data ?? [];
}

export async function salvarBairro(venueId: string, campos: Record<string, unknown>, id?: string): Promise<void> {
  const nome = texto(campos.nome, 80) ?? recusar("Dê um nome ao bairro.");
  const taxa = Number(campos.taxa_centavos);
  if (!Number.isInteger(taxa) || taxa < 0 || taxa > 100_000) recusar("Taxa de entrega inválida.");
  const linha = { venue_id: venueId, nome, taxa_centavos: taxa, ativo: campos.ativo !== false };
  const consulta = id
    ? cliente().from("delivery_bairros").update(linha).eq("id", id).eq("venue_id", venueId)
    : cliente().from("delivery_bairros").insert(linha);
  const { error } = await consulta;
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) recusar(`Já existe um bairro chamado "${nome}".`);
    falhar("Falha ao salvar o bairro", error.message);
  }
}

export async function listarCupons(venueId: string): Promise<Cupom[]> {
  const { data, error } = await cliente()
    .from("delivery_cupons")
    .select("id, codigo, tipo, valor, minimo_centavos, limite_usos, usos, expira_em, ativo")
    .eq("venue_id", venueId)
    .order("ativo", { ascending: false })
    .order("codigo");
  if (error) falhar("Falha ao ler os cupons", error.message);
  return data ?? [];
}

/** Cria ou edita pelo código: o código é o que a casa divulga, não muda. */
export async function salvarCupom(venueId: string, campos: Record<string, unknown>): Promise<void> {
  const codigo = String(campos.codigo ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(codigo)) recusar("O código do cupom tem de 3 a 20 letras ou números, sem espaço.");
  const tipo = campos.tipo === "fixo" ? "fixo" : "percentual";
  const valor = Number(campos.valor);
  if (!Number.isInteger(valor) || valor <= 0) recusar("Informe o valor do desconto.");
  if (tipo === "percentual" && valor > 100) recusar("O desconto percentual vai até 100%.");
  const inteiroOuZero = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  const expira = typeof campos.expira_em === "string" && /^\d{4}-\d{2}-\d{2}$/.test(campos.expira_em) ? campos.expira_em : null;

  const { error } = await cliente().from("delivery_cupons").upsert(
    {
      venue_id: venueId, codigo, tipo, valor,
      minimo_centavos: inteiroOuZero(campos.minimo_centavos),
      limite_usos: inteiroOuZero(campos.limite_usos),
      expira_em: expira,
      ativo: campos.ativo !== false,
    },
    { onConflict: "venue_id,codigo" },
  );
  if (error) falhar("Falha ao salvar o cupom", error.message);
}

async function cupomPeloCodigo(venueId: string, codigo: string | null | undefined): Promise<Cupom | null> {
  const limpo = codigo?.trim().toUpperCase();
  if (!limpo) return null;
  const { data, error } = await cliente().from("delivery_cupons").select("*").eq("venue_id", venueId).eq("codigo", limpo).maybeSingle();
  if (error) falhar("Falha ao ler o cupom", error.message);
  return data ?? null;
}

export async function saldoDeCashback(venueId: string, telefone: string | null): Promise<number> {
  if (!telefone) return 0;
  const { data, error } = await cliente()
    .from("delivery_cashback")
    .select("saldo_centavos")
    .eq("venue_id", venueId)
    .eq("telefone", telefone)
    .maybeSingle();
  if (error) falhar("Falha ao ler o cashback", error.message);
  return data?.saldo_centavos ?? 0;
}

// ============================================================
// Sacola
// ============================================================

/** Abre uma sacola nova para quem chegou direto pelo site. */
export async function abrirSacola(venueId: string): Promise<Sacola> {
  const { data, error } = await cliente().from("delivery_sacolas").insert({ venue_id: venueId }).select().single();
  if (error) falhar("Falha ao abrir a sacola", error.message);
  return data;
}

export async function lerSacola(venueId: string, id: string): Promise<Sacola> {
  if (!ehUuid(id)) throw new ErroDoDelivery(404, "Sacola não encontrada.");
  const { data, error } = await cliente().from("delivery_sacolas").select("*").eq("id", id).eq("venue_id", venueId).maybeSingle();
  if (error) falhar("Falha ao ler a sacola", error.message);
  if (!data) throw new ErroDoDelivery(404, "Sacola não encontrada.");
  return data;
}

/**
 * A sacola de uma conversa do atendente — criada na primeira vez que ele
 * precisa dela.
 *
 * No chat do cardápio a conversa já nasceu de uma sacola (o id dela é o
 * identificador do interlocutor), então é a mesma. No WhatsApp a sacola nasce
 * aqui, já com o telefone que o canal entregou — é isso que a torna
 * "verificada" para o cashback.
 */
export async function sacolaDaConversa(venueId: string, conversationId: string): Promise<Sacola> {
  const { data: conversa, error: erroConversa } = await cliente()
    .from("conversations")
    .select("id, channel, external_id, title, metadata")
    .eq("id", conversationId)
    .maybeSingle();
  if (erroConversa) falhar("Falha ao ler a conversa", erroConversa.message);
  if (!conversa) throw new ErroDoDelivery(404, "Conversa não encontrada.");

  if (conversa.channel === "delivery" && ehUuid(conversa.external_id)) {
    return lerSacola(venueId, conversa.external_id);
  }

  const { data: existente, error } = await cliente()
    .from("delivery_sacolas")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) falhar("Falha ao ler a sacola", error.message);
  if (existente) return existente;

  const verificado = conversa.channel === "whatsapp" ? telefoneDaBase(String(conversa.metadata?.contato ?? "")) : null;
  const { data: nova, error: erroNova } = await cliente()
    .from("delivery_sacolas")
    .insert({ venue_id: venueId, conversation_id: conversationId, telefone: verificado, nome: texto(conversa.title, 80) })
    .select()
    .single();
  if (erroNova) {
    // Duas mensagens seguidas do mesmo cliente criando a sacola ao mesmo
    // tempo: a segunda bate no índice único e usa a que a primeira criou.
    if (/duplicate key|unique/i.test(erroNova.message)) return sacolaDaConversa(venueId, conversationId);
    falhar("Falha ao abrir a sacola", erroNova.message);
  }
  return nova;
}

async function gravarItens(sacola: Sacola, itens: LinhaGravada[]): Promise<Sacola> {
  const { data, error } = await cliente()
    .from("delivery_sacolas")
    .update({ itens, atualizada_em: new Date().toISOString() })
    .eq("id", sacola.id)
    .select()
    .single();
  if (error) falhar("Falha ao gravar a sacola", error.message);
  return data;
}

const MAXIMO_DE_LINHAS = 40;

export async function adicionarASacola(
  venue: Venue,
  sacola: Sacola,
  pedido: { item: string; quantidade: number; opcoes?: string[]; observacao?: string | null },
): Promise<Sacola> {
  const { itens: cardapio } = await cardapioPublico(venue);
  // Pelo id (o cardápio) ou pelo nome exato (o atendente).
  const item = acharItem(cardapio, pedido.item);
  if (!Number.isInteger(pedido.quantidade) || pedido.quantidade < 1 || pedido.quantidade > 50) recusar("Quantidade inválida.");
  if (sacola.itens.length >= MAXIMO_DE_LINHAS) recusar("A sacola chegou ao limite de itens. Feche este pedido e abra outro.");

  const linha: LinhaGravada = {
    id: randomUUID(),
    item_id: item.id,
    quantidade: pedido.quantidade,
    opcoes: escolherOpcoes(item, pedido.opcoes ?? []),
    observacao: texto(pedido.observacao, 300),
  };
  return gravarItens(sacola, [...sacola.itens, linha]);
}

/** Quantidade zero (ou menos) tira a linha. */
export async function mudarQuantidade(sacola: Sacola, linhaId: string, quantidade: number): Promise<Sacola> {
  if (!sacola.itens.some((l) => l.id === linhaId)) recusar("Esse item não está mais na sacola.");
  const itens =
    quantidade < 1
      ? sacola.itens.filter((l) => l.id !== linhaId)
      : sacola.itens.map((l) => (l.id === linhaId ? { ...l, quantidade: Math.min(Math.trunc(quantidade), 50) } : l));
  return gravarItens(sacola, itens);
}

/** A sacola com os preços de agora, do jeito que a tela e o atendente leem. */
export async function verSacola(venue: Venue, sacola: Sacola): Promise<{ linhas: LinhaDaSacola[]; subtotal: number }> {
  if (sacola.itens.length === 0) return { linhas: [], subtotal: 0 };
  const { itens } = await cardapioPublico(venue);
  return precificar(sacola.itens, itens);
}

// ============================================================
// Cotação e fechamento
// ============================================================

async function cotarSacola(venue: Venue, sacola: Sacola, pedido: PedidoDeCotacao) {
  const [cfg, bairros, cupom, saldo, vista] = await Promise.all([
    configDoDelivery(venue.id),
    listarBairros(venue.id),
    cupomPeloCodigo(venue.id, pedido.cupom),
    saldoDeCashback(venue.id, sacola.telefone),
    verSacola(venue, sacola),
  ]);
  const hoje = new Date().toISOString().slice(0, 10);
  return { cfg, vista, cotacao: cotar({ subtotal: vista.subtotal, pedido, cfg, bairros, cupom, saldoDeCashback: saldo, hoje }) };
}

export async function cotarPedido(venue: Venue, sacola: Sacola, pedido: PedidoDeCotacao): Promise<Cotacao> {
  return (await cotarSacola(venue, sacola, pedido)).cotacao;
}

export interface DadosDoFechamento extends PedidoDeCotacao {
  nome: string;
  /** Só vale para sacola aberta no site; a do WhatsApp usa o telefone do canal. */
  telefone?: string | null;
  endereco?: string | null;
  pagamento: string;
  observacoes?: string | null;
  origem: "cardapio" | "conversa";
}

/**
 * Fecha a sacola num pedido e cria a cobrança.
 *
 * A ordem importa. O pedido nasce primeiro, numa transação do banco que
 * também gasta o cupom e o cashback; só então a cobrança é criada. Se o
 * Mercado Pago falhar, o pedido é cancelado (devolvendo cupom e cashback) e a
 * sacola volta como estava — o cliente tenta de novo sem redigitar nada.
 *
 * A cobrança vai ao cliente pelo SISTEMA, não pelo modelo: o código Pix tem
 * 150 caracteres e um errado é um pagamento perdido.
 */
export async function fecharPedido(
  venue: Venue,
  sacola: Sacola,
  dados: DadosDoFechamento,
  cobrar: (pedido: Pedido, credenciais: CredenciaisDoMercadoPago, venue: Venue) => Promise<Cobranca> = criarCobranca,
): Promise<Pedido> {
  const nome = texto(dados.nome, 80);
  if (!nome || nome.length < 2) recusar("Informe o nome de quem vai receber.");
  const telefone = sacola.telefone ?? telefoneDaBase(String(dados.telefone ?? ""));
  if (!telefone) recusar("Informe um WhatsApp com DDD.");
  if (dados.pagamento !== "pix" && dados.pagamento !== "cartao") {
    recusar("Aceitamos Pix ou cartão, pagos no ato do pedido. Não há pagamento na entrega.");
  }
  const endereco = texto(dados.endereco, 300);
  if (dados.tipo !== "entrega" && dados.tipo !== "retirada") recusar("Diga se é entrega ou retirada.");
  if (dados.tipo === "entrega" && !endereco) recusar("Informe o endereço da entrega.");

  const { cfg, vista, cotacao } = await cotarSacola(venue, sacola, dados);
  if (!abertoAgora(cfg, venue.timezone)) recusar("A casa não está recebendo pedidos de delivery agora.");
  if (vista.linhas.length === 0) recusar("A sacola está vazia.");
  const fora = vista.linhas.find((l) => l.indisponivel);
  if (fora) recusar(`"${fora.nome}" saiu do cardápio. Tire da sacola para continuar.`);
  if (cotacao.pendencias.length > 0) recusar(cotacao.pendencias.join(" "));
  if (cotacao.total > 0 && !cfg.mp_access_token) {
    throw new ErroDoDelivery(503, "A casa ainda não conectou o Mercado Pago, então não dá para cobrar. Avise a equipe.");
  }

  const { data, error } = await cliente().rpc("delivery_fechar_pedido", {
    p: {
      venue_id: venue.id,
      sacola_id: sacola.id,
      conversation_id: sacola.conversation_id,
      origem: dados.origem,
      canal: sacola.conversation_id && sacola.telefone ? "whatsapp" : "site",
      nome,
      telefone,
      telefone_verificado: Boolean(sacola.telefone),
      tipo: dados.tipo,
      endereco: dados.tipo === "entrega" ? endereco : null,
      bairro: dados.tipo === "entrega" ? cotacao.bairro : null,
      pagamento: dados.pagamento,
      subtotal_centavos: cotacao.subtotal,
      taxa_centavos: cotacao.taxa,
      desconto_centavos: cotacao.desconto,
      cupom: cotacao.cupom,
      cashback_usado_centavos: cotacao.cashback_usado,
      total_centavos: cotacao.total,
      observacoes: texto(dados.observacoes, 300),
      itens: vista.linhas.map((l) => ({
        item_id: l.item_id, nome: l.nome, opcoes: opcoesEmTexto(l.opcoes),
        preco_centavos: l.preco_centavos, quantidade: l.quantidade, observacao: l.observacao,
      })),
    },
  });
  if (error) falhar("Falha ao fechar o pedido", error.message);
  let pedido = data as Pedido;

  // Quem pediu é cliente da casa: entra na base como qualquer outro.
  void registrarClienteSeDer(venue.id, "delivery", { telefone: telefone!, nome });

  const cabeca = `🧾 Pedido #${pedido.numero} — total ${dinheiro(pedido.total_centavos)}`;
  const acompanhe = `Acompanhe aqui: ${enderecoDoPedido(venue, pedido)}`;

  if (pedido.status === "recebido") {
    await avisarCliente(venue, pedido, "recebido", `${cabeca}\n✅ Pedido recebido, já pago com seu desconto. Previsão: ${cfg.previsao}.\n${acompanhe}`);
    return pedido;
  }

  let cobranca: Cobranca;
  try {
    cobranca = await cobrar(pedido, { accessToken: cfg.mp_access_token!, emailPagador: cfg.mp_email_pagador }, venue);
  } catch (e) {
    console.error(`[delivery] não criou a cobrança do pedido #${pedido.numero}: ${(e as Error).message}`);
    await cliente().rpc("delivery_cancelar_pedido", { p_pedido: pedido.id, p_so_pendente: true });
    await gravarItens(sacola, sacola.itens);
    throw new ErroDoDelivery(502, "Não consegui gerar a cobrança agora. Sua sacola continua guardada — tente de novo em instantes.");
  }

  const { data: comCobranca, error: erroCobranca } = await cliente()
    .from("delivery_pedidos")
    .update({ mp_ref: cobranca.ref, link_pagamento: cobranca.link, pix_codigo: cobranca.pixCodigo, pix_qr: cobranca.pixQr })
    .eq("id", pedido.id)
    .select()
    .single();
  if (erroCobranca) falhar("Falha ao gravar a cobrança", erroCobranca.message);
  pedido = comCobranca;

  if (pedido.pagamento === "pix" && cobranca.pixCodigo) {
    await avisarCliente(venue, pedido, "cobranca", `${cabeca}\nPague com o Pix copia e cola da próxima mensagem (vale por 30 minutos). O preparo começa assim que o pagamento cair.\n${acompanhe}`);
    // Sozinho numa mensagem: é assim que o cliente copia sem levar texto junto.
    await avisarCliente(venue, pedido, "pix", cobranca.pixCodigo);
  } else {
    await avisarCliente(venue, pedido, "cobranca", `${cabeca}\nPague com cartão pelo link seguro: ${cobranca.link}\nO preparo começa assim que o pagamento for aprovado.\n${acompanhe}`);
  }
  return pedido;
}

// ============================================================
// Avisos ao cliente
// ============================================================

/**
 * Manda um aviso do pedido pelo WhatsApp da casa, pela mesma fila de tudo.
 *
 * Nunca lança: o pedido já está gravado, e um aviso que não saiu não pode
 * desfazê-lo. O que falhar fica na fila para o reenvio — e a página de
 * acompanhamento mostra a mesma coisa de qualquer jeito.
 *
 * Pelo número oficial, texto livre só chega dentro das 24 h da última
 * mensagem do cliente. Quem pediu conversando está dentro; quem pediu direto
 * no site pode não receber — por isso o acompanhamento não depende disto.
 */
export async function avisarCliente(
  venue: Venue,
  pedido: Pick<Pedido, "telefone" | "numero">,
  momento: string,
  corpo: string,
): Promise<void> {
  try {
    const { data, error } = await inserirAvisos<Notification>(
      {
        venue_id: venue.id,
        channel: "whatsapp",
        destination: pedido.telefone,
        template: `delivery_${momento}`,
        // Pelo número em que o cliente conversa: se ele responder "cadê meu
        // pedido?", quem está do outro lado é o atendente, que sabe consultar.
        papel: "agente",
        body: corpo,
      },
      { devolver: true },
    );
    if (error || !data) {
      console.error(`[delivery] não enfileirou o aviso do pedido #${pedido.numero}: ${error?.message}`);
      return;
    }
    if ((await canalAtivo(venue.id)) === "console") return;
    await tentarEnviar(data);
  } catch (e) {
    console.error(`[delivery] aviso do pedido #${pedido.numero} falhou: ${(e as Error).message}`);
  }
}

// ============================================================
// Vida do pedido
// ============================================================

export async function lerPedido(venueId: string, id: string): Promise<Pedido> {
  if (!ehUuid(id)) throw new ErroDoDelivery(404, "Pedido não encontrado.");
  const { data, error } = await cliente().from("delivery_pedidos").select("*").eq("id", id).eq("venue_id", venueId).maybeSingle();
  if (error) falhar("Falha ao ler o pedido", error.message);
  if (!data) throw new ErroDoDelivery(404, "Pedido não encontrado.");
  return data;
}

async function itensDosPedidos(ids: string[]): Promise<Map<string, ItemDoPedido[]>> {
  const mapa = new Map<string, ItemDoPedido[]>();
  if (ids.length === 0) return mapa;
  const { data, error } = await cliente()
    .from("delivery_pedido_itens")
    .select("pedido_id, nome, opcoes, preco_centavos, quantidade, observacao")
    .in("pedido_id", ids);
  if (error) falhar("Falha ao ler os itens do pedido", error.message);
  for (const l of data ?? []) {
    const { pedido_id, ...item } = l;
    mapa.set(pedido_id, [...(mapa.get(pedido_id) ?? []), item]);
  }
  return mapa;
}

/** O que o cliente vê no acompanhamento: o próprio pedido, pelo token do link. */
export async function pedidoPublico(venueId: string, token: string) {
  if (!ehUuid(token)) throw new ErroDoDelivery(404, "Pedido não encontrado.");
  const { data, error } = await cliente().from("delivery_pedidos").select("*").eq("token", token).eq("venue_id", venueId).maybeSingle();
  if (error) falhar("Falha ao ler o pedido", error.message);
  if (!data) throw new ErroDoDelivery(404, "Pedido não encontrado.");
  const pedido = data as Pedido;
  const itens = (await itensDosPedidos([pedido.id])).get(pedido.id) ?? [];
  const pendente = pedido.status === "aguardando_pagamento";
  return {
    numero: pedido.numero, token: pedido.token, status: pedido.status, criado_em: pedido.criado_em,
    tipo: pedido.tipo, endereco: pedido.endereco, bairro: pedido.bairro, pagamento: pedido.pagamento,
    subtotal_centavos: pedido.subtotal_centavos, taxa_centavos: pedido.taxa_centavos,
    desconto_centavos: pedido.desconto_centavos, cupom: pedido.cupom,
    cashback_usado_centavos: pedido.cashback_usado_centavos, cashback_ganho_centavos: pedido.cashback_ganho_centavos,
    total_centavos: pedido.total_centavos,
    // A cobrança só acompanha o pedido enquanto ele espera por ela.
    pix_codigo: pendente ? pedido.pix_codigo : null,
    pix_qr: pendente ? pedido.pix_qr : null,
    link_pagamento: pendente ? pedido.link_pagamento : null,
    itens,
  };
}

export async function listarPedidos(venueId: string, limite = 100): Promise<Array<Pedido & { itens: ItemDoPedido[]; proximos: StatusDoPedido[] }>> {
  const { data, error } = await cliente()
    .from("delivery_pedidos")
    .select("*")
    .eq("venue_id", venueId)
    .order("criado_em", { ascending: false })
    .limit(limite);
  if (error) falhar("Falha ao ler os pedidos", error.message);
  const pedidos = (data ?? []) as Pedido[];
  const itens = await itensDosPedidos(pedidos.map((p) => p.id));
  // O código Pix e o QR não têm o que fazer no painel, e pesam.
  return pedidos.map((p) => ({ ...p, pix_codigo: null, pix_qr: null, itens: itens.get(p.id) ?? [], proximos: proximosStatus(p) }));
}

/** Os pedidos recentes de uma sacola (ou de um telefone verificado), para o atendente consultar. */
export async function pedidosDoCliente(venueId: string, sacola: Sacola): Promise<Array<Pedido & { itens: ItemDoPedido[] }>> {
  let consulta = cliente().from("delivery_pedidos").select("*").eq("venue_id", venueId).order("criado_em", { ascending: false }).limit(5);
  consulta = sacola.telefone
    ? consulta.eq("telefone", sacola.telefone).eq("telefone_verificado", true)
    : consulta.eq("sacola_id", sacola.id);
  const { data, error } = await consulta;
  if (error) falhar("Falha ao ler os pedidos", error.message);
  const pedidos = (data ?? []) as Pedido[];
  const itens = await itensDosPedidos(pedidos.map((p) => p.id));
  return pedidos.map((p) => ({ ...p, itens: itens.get(p.id) ?? [] }));
}

/**
 * O Mercado Pago confirmou: o pedido entra para a cozinha.
 *
 * Idempotente — o webhook chega mais de uma vez, e só a primeira muda algo.
 */
export async function marcarPago(venue: Venue, pedidoId: string, mpRef?: string | null): Promise<boolean> {
  const mudancas: Record<string, unknown> = { status: "recebido", pago_em: new Date().toISOString(), atualizado_em: new Date().toISOString() };
  if (mpRef) mudancas.mp_ref = mpRef;
  const { data, error } = await cliente()
    .from("delivery_pedidos")
    .update(mudancas)
    .eq("id", pedidoId)
    .eq("venue_id", venue.id)
    .eq("status", "aguardando_pagamento")
    .select();
  if (error) falhar("Falha ao confirmar o pagamento", error.message);
  const pedido = (data ?? [])[0] as Pedido | undefined;
  if (!pedido) return false;
  const cfg = await configDoDelivery(venue.id);
  await avisarCliente(venue, pedido, "pago", `✅ Pagamento do pedido #${pedido.numero} confirmado! Já vamos começar o preparo. Previsão: ${cfg.previsao}.`);
  return true;
}

/** O painel move o pedido — só pelos caminhos que fazem sentido — e o cliente é avisado. */
export async function mudarStatus(venue: Venue, pedidoId: string, novo: string): Promise<Pedido> {
  const pedido = await lerPedido(venue.id, pedidoId);
  if (pedido.status === novo) return pedido;
  if (!proximosStatus(pedido).includes(novo as StatusDoPedido)) {
    recusar(`Um pedido ${ROTULO_DO_STATUS[pedido.status]} não pode ir para "${ROTULO_DO_STATUS[novo as StatusDoPedido] ?? novo}".`);
  }

  if (novo === "cancelado") {
    const cancelado = await cancelar(venue, pedido, `Seu pedido #${pedido.numero} foi cancelado. Qualquer dúvida, é só chamar por aqui.`);
    return cancelado ?? lerPedido(venue.id, pedidoId);
  }

  if (novo === "entregue") {
    const cfg = await configDoDelivery(venue.id);
    const ganho = cashbackDoPedido(pedido, cfg.cashback_percentual);
    const { data, error } = await cliente().rpc("delivery_entregar_pedido", { p_pedido: pedido.id, p_ganho_centavos: ganho });
    if (error) falhar("Falha ao concluir o pedido", error.message);
    if (data?.id) {
      const bonus = ganho > 0 ? `\n💰 Você ganhou ${dinheiro(ganho)} de cashback para o próximo pedido pelo nosso WhatsApp.` : "";
      // O link de volta fecha o ciclo: a mensagem que agradece é a que o
      // cliente relê na próxima vez que der fome.
      await avisarCliente(venue, pedido, "entregue", `Pedido #${pedido.numero} entregue. Obrigado pela preferência! 💛${bonus}\nPara pedir de novo: ${enderecoDoCardapio(venue)}`);
    }
    return lerPedido(venue.id, pedidoId);
  }

  const { error } = await cliente()
    .from("delivery_pedidos")
    .update({ status: novo, atualizado_em: new Date().toISOString() })
    .eq("id", pedido.id)
    .eq("status", pedido.status);
  if (error) falhar("Falha ao atualizar o pedido", error.message);
  const avisos: Partial<Record<StatusDoPedido, string>> = {
    em_preparo: `👩‍🍳 Seu pedido #${pedido.numero} está em preparo.`,
    saiu_para_entrega: `🛵 Seu pedido #${pedido.numero} saiu para entrega!`,
    pronto_para_retirada: `📦 Seu pedido #${pedido.numero} está pronto para retirada.`,
  };
  const aviso = avisos[novo as StatusDoPedido];
  if (aviso) await avisarCliente(venue, pedido, novo, aviso);
  return lerPedido(venue.id, pedidoId);
}

async function cancelar(venue: Venue, pedido: Pedido, aviso: string, soPendente = false): Promise<Pedido | null> {
  const { data, error } = await cliente().rpc("delivery_cancelar_pedido", { p_pedido: pedido.id, p_so_pendente: soPendente });
  if (error) falhar("Falha ao cancelar o pedido", error.message);
  if (!data?.id) return null;
  await avisarCliente(venue, pedido, "cancelado", aviso);
  return data as Pedido;
}

/** O próprio cliente desiste, pela conversa — só enquanto não pagou. */
export async function cancelarPendenteDoCliente(venue: Venue, sacola: Sacola, numero: number): Promise<Pedido> {
  const pedidos = await pedidosDoCliente(venue.id, sacola);
  const pedido = pedidos.find((p) => p.numero === numero);
  if (!pedido) recusar(`Não encontrei o pedido #${numero} deste cliente.`);
  const cancelado = await cancelar(venue, pedido!, `Pedido #${numero} cancelado, como você pediu.`, true);
  if (!cancelado) recusar(`O pedido #${numero} já foi pago ou encerrado. Cancelar agora é com a equipe da casa.`);
  return cancelado!;
}

// ============================================================
// Rotinas de fundo
// ============================================================

const MINUTOS_PARA_PAGAR = 40;
const MINUTOS_DE_SACOLA_PARADA = 30;

async function venuePorId(id: string): Promise<Venue | null> {
  const { data } = await db().from("venues").select("*").eq("id", id).maybeSingle();
  return (data as Venue | null) ?? null;
}

/**
 * De minuto em minuto: derruba o pedido que ninguém pagou e lembra a sacola
 * esquecida.
 *
 * O pedido sem pagamento segura um uso de cupom e o saldo de cashback; depois
 * de 40 minutos (o Pix vale 30) ele não vai mais ser pago, e devolver é o
 * certo. O lembrete é um só por sacola, só para quem veio do WhatsApp e só
 * com a casa aberta — lembrar à meia-noite de uma loja fechada é spam.
 */
export async function cuidarDoDelivery(agora = new Date()): Promise<{ expirados: number; lembrados: number }> {
  const total = { expirados: 0, lembrados: 0 };
  if (!(await reivindicar("delivery", 1, agora))) return total;

  const limite = new Date(agora.getTime() - MINUTOS_PARA_PAGAR * 60_000).toISOString();
  const { data: vencidos, error } = await cliente()
    .from("delivery_pedidos")
    .select("*")
    .eq("status", "aguardando_pagamento")
    .lt("criado_em", limite)
    .limit(50);
  if (error) {
    // Banco sem a migração é casa que ainda não tem o módulo: nada a fazer.
    if (ehMigracaoPendente(error.message)) return total;
    falhar("Falha ao buscar pedidos sem pagamento", error.message);
  }
  for (const pedido of (vencidos ?? []) as Pedido[]) {
    const venue = await venuePorId(pedido.venue_id);
    if (!venue) continue;
    const feito = await cancelar(
      venue, pedido,
      `O pagamento do pedido #${pedido.numero} não foi identificado e ele foi cancelado. Se ainda quiser, é só pedir de novo!`,
      true,
    );
    if (feito) total.expirados++;
  }

  const parada = new Date(agora.getTime() - MINUTOS_DE_SACOLA_PARADA * 60_000).toISOString();
  const velha = new Date(agora.getTime() - 24 * 60 * 60_000).toISOString();
  const { data: sacolas, error: erroSacolas } = await cliente()
    .from("delivery_sacolas")
    .select("*")
    .not("telefone", "is", null)
    .is("lembrada_em", null)
    .lt("atualizada_em", parada)
    .gt("atualizada_em", velha)
    .neq("itens", "[]")
    .limit(50);
  if (erroSacolas) falhar("Falha ao buscar sacolas paradas", erroSacolas.message);

  for (const sacola of (sacolas ?? []) as Sacola[]) {
    const venue = await venuePorId(sacola.venue_id);
    if (!venue) continue;
    const cfg = await configDoDelivery(venue.id);
    if (!cfg.lembrar_sacola || !abertoAgora(cfg, venue.timezone, agora)) continue;
    // Marca ANTES de mandar: se o envio travar, o pior caso é um lembrete a
    // menos, nunca um lembrete por minuto.
    const { data: marcada } = await cliente()
      .from("delivery_sacolas")
      .update({ lembrada_em: agora.toISOString() })
      .eq("id", sacola.id)
      .is("lembrada_em", null)
      .select("id");
    if (!marcada?.length) continue;

    const { linhas, subtotal } = await verSacola(venue, sacola);
    if (linhas.length === 0) continue;
    const lista = linhas.map((l) => `${l.quantidade}x ${l.nome}`).join(", ");
    const primeiroNome = sacola.nome?.split(" ")[0];
    await avisarCliente(
      venue,
      { numero: 0, telefone: sacola.telefone! },
      "sacola",
      `Oi${primeiroNome ? `, ${primeiroNome}` : ""}! Sua sacola continua guardada: ${lista} (${dinheiro(subtotal)}). Quer finalizar? É só responder aqui ou abrir: ${enderecoDoCardapio(venue, sacola.id)}`,
    );
    total.lembrados++;
  }
  return total;
}

// ============================================================
// Relatório
// ============================================================

export interface PedidoDoRelatorio {
  criado_em: string;
  total_centavos: number;
  desconto_centavos: number;
  cashback_usado_centavos: number;
  origem: string;
  canal: string;
  pagamento: string;
  status: string;
  itens: Array<{ nome: string; quantidade: number; preco_centavos: number }>;
}

/** Os números do período, a partir dos pedidos que valeram (pagos e não cancelados). */
export function resumoDosPedidos(pedidos: PedidoDoRelatorio[], fuso: string) {
  const validos = pedidos.filter((p) => p.status !== "cancelado" && p.status !== "aguardando_pagamento");
  const somar = <T>(lista: T[], valor: (x: T) => number) => lista.reduce((s, x) => s + valor(x), 0);
  const agrupar = (chave: (p: PedidoDoRelatorio) => string) => {
    const mapa = new Map<string, { rotulo: string; pedidos: number; centavos: number }>();
    for (const p of validos) {
      const rotulo = chave(p);
      const atual = mapa.get(rotulo) ?? { rotulo, pedidos: 0, centavos: 0 };
      atual.pedidos++;
      atual.centavos += p.total_centavos;
      mapa.set(rotulo, atual);
    }
    return [...mapa.values()];
  };
  const diaNaCasa = new Intl.DateTimeFormat("en-CA", { timeZone: fuso });

  const produtos = new Map<string, { rotulo: string; quantidade: number; centavos: number }>();
  for (const p of validos) {
    for (const i of p.itens) {
      const atual = produtos.get(i.nome) ?? { rotulo: i.nome, quantidade: 0, centavos: 0 };
      atual.quantidade += i.quantidade;
      atual.centavos += i.quantidade * i.preco_centavos;
      produtos.set(i.nome, atual);
    }
  }

  const faturamento = somar(validos, (p) => p.total_centavos);
  return {
    pedidos: validos.length,
    faturamento_centavos: faturamento,
    ticket_medio_centavos: validos.length ? Math.round(faturamento / validos.length) : 0,
    descontos_centavos: somar(validos, (p) => p.desconto_centavos),
    cashback_usado_centavos: somar(validos, (p) => p.cashback_usado_centavos),
    cancelados: pedidos.filter((p) => p.status === "cancelado").length,
    por_dia: agrupar((p) => diaNaCasa.format(new Date(p.criado_em))).sort((a, b) => a.rotulo.localeCompare(b.rotulo)),
    por_canal: agrupar((p) => `${p.origem}:${p.canal}`).sort((a, b) => b.centavos - a.centavos),
    por_pagamento: agrupar((p) => p.pagamento).sort((a, b) => b.centavos - a.centavos),
    mais_vendidos: [...produtos.values()].sort((a, b) => b.quantidade - a.quantidade).slice(0, 10),
  };
}

export async function relatorioDoDelivery(venue: Venue, dias: number) {
  const periodo = Math.min(365, Math.max(1, Math.trunc(dias) || 7));
  const desde = new Date(Date.now() - periodo * 24 * 60 * 60_000).toISOString();
  const { data, error } = await cliente()
    .from("delivery_pedidos")
    .select(
      `criado_em, total_centavos, desconto_centavos, cashback_usado_centavos, origem, canal, pagamento, status,
       itens:delivery_pedido_itens ( nome, quantidade, preco_centavos )`,
    )
    .eq("venue_id", venue.id)
    .gte("criado_em", desde)
    .limit(5000);
  if (error) falhar("Falha ao montar o relatório", error.message);
  return { dias: periodo, ...resumoDosPedidos((data ?? []) as PedidoDoRelatorio[], venue.timezone) };
}

// ============================================================
// O que as telas públicas leem
// ============================================================

/** A sacola como o cardápio de delivery desenha. */
export async function sacolaParaATela(venue: Venue, sacola: Sacola) {
  const [{ linhas, subtotal }, saldo, pendente] = await Promise.all([
    verSacola(venue, sacola),
    saldoDeCashback(venue.id, sacola.telefone),
    cliente().from("delivery_pedidos").select("token").eq("sacola_id", sacola.id).eq("status", "aguardando_pagamento").maybeSingle(),
  ]);
  return {
    id: sacola.id,
    // O pedido desta sacola que espera pagamento: quando o atendente fecha
    // pela conversa da página, é por aqui que a cobrança aparece na tela.
    pedido_pendente: (pendente.data?.token as string | undefined) ?? null,
    // Veio de uma conversa do WhatsApp: o telefone já é conhecido, a conversa
    // continua lá e o cashback pode ser usado.
    verificada: Boolean(sacola.telefone),
    cliente: { nome: sacola.nome ?? "", endereco: sacola.endereco ?? "", bairro: sacola.bairro ?? "" },
    cashback_centavos: saldo,
    linhas,
    subtotal,
  };
}

/** O que o cardápio de delivery precisa saber da casa antes de vender. */
export async function lojaPublica(venue: Venue) {
  const [cfg, bairros] = await Promise.all([configDoDelivery(venue.id), listarBairros(venue.id)]);
  return {
    aberto: abertoAgora(cfg, venue.timezone),
    previsao: cfg.previsao,
    endereco_retirada: cfg.endereco_retirada,
    taxa_unica_centavos: cfg.taxa_unica_centavos,
    cashback_percentual: cfg.cashback_percentual,
    // Sem Mercado Pago não há como cobrar: a página mostra o cardápio e avisa.
    cobranca_pronta: Boolean(cfg.mp_access_token),
    bairros: bairros.filter((b) => b.ativo).map((b) => ({ id: b.id, nome: b.nome, taxa_centavos: b.taxa_centavos })),
  };
}

// ============================================================
// Webhook do Mercado Pago
// ============================================================

/**
 * O Mercado Pago avisou de um pagamento desta casa.
 *
 * O aviso não é confiável por si: qualquer um descobre o endereço e manda
 * "pagamento aprovado". Por isso o corpo só serve para dizer QUAL pagamento
 * olhar — o status e o valor são consultados na API com o token da casa, e o
 * pedido só é liberado se o valor pago cobre o total.
 */
export async function receberAvisoDoMercadoPago(
  venue: Venue,
  aviso: { tipo: string | null; pagamentoId: string | null; assinatura?: string; requestId?: string },
  consultar: (token: string, id: string) => Promise<PagamentoDoMercadoPago> = consultarPagamento,
): Promise<{ liberado: boolean; motivo?: string }> {
  if (aviso.tipo !== "payment" || !aviso.pagamentoId) return { liberado: false, motivo: "ignorado" };
  const cfg = await configDoDelivery(venue.id);
  if (!cfg.mp_access_token) return { liberado: false, motivo: "casa sem Mercado Pago" };
  if (cfg.mp_webhook_secret && !assinaturaConfere(cfg.mp_webhook_secret, aviso.assinatura, aviso.requestId, aviso.pagamentoId)) {
    throw new ErroDoDelivery(401, "Assinatura do webhook inválida.");
  }

  const pagamento = await consultar(cfg.mp_access_token, aviso.pagamentoId);
  if (pagamento.status !== "approved" || !pagamento.pedidoId) return { liberado: false, motivo: `pagamento ${pagamento.status}` };
  const pedido = await lerPedido(venue.id, pagamento.pedidoId).catch(() => null);
  if (!pedido) return { liberado: false, motivo: "pedido de outra casa ou inexistente" };
  if (pagamento.centavos < pedido.total_centavos) {
    console.error(`[delivery] pagamento ${pagamento.id} menor que o pedido #${pedido.numero}: ${pagamento.centavos} < ${pedido.total_centavos}`);
    return { liberado: false, motivo: "valor menor que o pedido" };
  }
  // DINHEIRO QUE ENTROU DE UM PEDIDO JÁ CANCELADO.
  //
  // O cliente pagou no último segundo, ou depois que a rotina derrubou o
  // pedido. Reabrir sozinho não é seguro (a cozinha pode ter fechado, o cupom
  // já voltou). O que não pode é o dinheiro entrar em silêncio: o pagamento
  // fica gravado no pedido, e o painel mostra "pago depois de cancelado" para
  // a casa estornar ou combinar com o cliente.
  if (pedido.status === "cancelado") {
    console.error(`[delivery] pagamento ${pagamento.id} aprovado para o pedido #${pedido.numero}, que já estava cancelado.`);
    const { error } = await cliente()
      .from("delivery_pedidos")
      .update({ pago_em: new Date().toISOString(), mp_ref: pagamento.id })
      .eq("id", pedido.id)
      .is("pago_em", null);
    if (error) falhar("Falha ao registrar o pagamento tardio", error.message);
    return { liberado: false, motivo: "pago depois de cancelado" };
  }
  return { liberado: await marcarPago(venue, pedido.id, pagamento.id) };
}
