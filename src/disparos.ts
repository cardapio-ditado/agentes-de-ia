import { db, ehMigracaoPendente } from "./supabase.js";
import { reivindicar } from "./rotinas.js";
import { hojeNaCasa } from "./fuso.js";
import { conexaoDaCasa, prontaParaEnviar } from "./whatsappOficial.js";
import { enviarModeloPelaCloudApi, normalizarTelefone } from "./notifications.js";
import { listarClientes, type Cliente } from "./clientes.js";
import { SELOS, faltaHaQuantoTempo, retratoDe, type Retrato, type Selo } from "./crm.js";

/**
 * DISPAROS — a casa manda, pelo número oficial, para quem ela escolher.
 *
 * Promoção para quem sumiu, convite para os VIPs, o parabéns do mês. É a
 * outra metade do CRM: a lista de clientes diz QUEM; aqui a casa FALA com
 * eles. E fala pelo número oficial da Meta, que é o único que aguenta
 * disparo em massa sem ser banido.
 *
 * A REGRA QUE DESENHA TUDO: mensagem que a casa INICIA só sai por MODELO
 * aprovado pela Meta. Texto livre é só resposta, nas 24 h depois de o
 * cliente falar. Então um disparo é sempre: um modelo (com lacunas), o que
 * vai em cada lacuna, quem recebe, quando. O texto não é escrito aqui — é
 * escolhido.
 *
 * TRÊS CUIDADOS:
 *
 *   · o público é fotografado ao AGENDAR, não ao enviar. O dono vê "137
 *     pessoas" e aperta o botão; se a base mudar até a hora do envio, são
 *     as 137 que ele aprovou que recebem, e não 140;
 *   · o ritmo é lento de propósito. A Meta limita conversas por dia e
 *     derruba a qualidade do número quando muita gente bloqueia de uma
 *     vez. Vinte por minuto cobre mil pessoas em menos de uma hora, e uma
 *     campanha ruim é descoberta (e cancelada) antes de chegar em todo mundo;
 *   · o que aconteceu com CADA pessoa fica gravado — entregue, lida,
 *     respondeu — porque é isso que o agente precisa saber quando ela
 *     escreve de volta, e é isso que diz se a campanha valeu.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

export class ErroDeDisparo extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeDisparo";
  }
}

/** Quantos saem por minuto. Ver o segundo cuidado lá em cima. */
export const RITMO_POR_MINUTO = 20;

/** Resposta até aqui depois do envio ainda é "resposta ao disparo". */
export const HORAS_DE_RESPOSTA = 72;

// ============================================================
// As lacunas do modelo
// ============================================================

export type Variavel =
  | { tipo: "primeiro_nome" }
  | { tipo: "nome" }
  | { tipo: "casa" }
  | { tipo: "fixo"; texto: string };

export const TIPOS_DE_VARIAVEL: Array<{ id: Variavel["tipo"]; nome: string }> = [
  { id: "primeiro_nome", nome: "Primeiro nome do cliente" },
  { id: "nome", nome: "Nome completo do cliente" },
  { id: "casa", nome: "Nome da casa" },
  { id: "fixo", nome: "Um texto fixo" },
];

function primeiroNome(nome: string | null | undefined): string | null {
  const limpo = (nome ?? "").trim();
  return limpo ? (limpo.split(/\s+/)[0] ?? null) : null;
}

/**
 * O que vai em cada lacuna, para esta pessoa.
 *
 * Nunca devolve lacuna vazia: a Meta recusa parâmetro em branco, e a casa
 * não pode perder o disparo inteiro por causa de um cliente sem nome. Quem
 * não tem nome recebe "você" — "Oi, você!" é estranho, mas chega.
 */
export function preencherVariaveis(
  variaveis: Variavel[],
  pessoa: { nome: string | null },
  casa: string,
): string[] {
  return variaveis.map((v) => {
    switch (v.tipo) {
      case "primeiro_nome":
        return primeiroNome(pessoa.nome) ?? "você";
      case "nome":
        return (pessoa.nome ?? "").trim() || "você";
      case "casa":
        return casa;
      case "fixo":
        return v.texto.trim() || "-";
    }
  });
}

/** O corpo do modelo com as lacunas preenchidas — o que a pessoa leu. */
export function renderizar(corpo: string, valores: string[]): string {
  return corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (tudo, n: string) => valores[Number(n) - 1] ?? tudo);
}

/** Quantas lacunas o corpo tem ({{1}}, {{2}}…). */
export function lacunasDe(corpo: string): number {
  let maior = 0;
  for (const m of corpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) maior = Math.max(maior, Number(m[1]));
  return maior;
}

/** As variáveis como vieram do banco/tela, sem confiar em nada. */
export function variaveisValidas(bruto: unknown): Variavel[] {
  if (!Array.isArray(bruto)) return [];
  const saida: Variavel[] = [];
  for (const v of bruto) {
    const tipo = (v as { tipo?: string })?.tipo;
    if (tipo === "primeiro_nome" || tipo === "nome" || tipo === "casa") saida.push({ tipo });
    else if (tipo === "fixo") saida.push({ tipo, texto: String((v as { texto?: unknown }).texto ?? "") });
  }
  return saida;
}

// ============================================================
// O público
// ============================================================

export interface Publico {
  /** Um selo do CRM: vip, fiel, sumido, novo, comum. */
  selo?: Selo;
  /** Quem faz aniversário neste mês (1–12). */
  aniversario_mes?: number;
  /** A base inteira. */
  todos?: boolean;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function descreverPublico(p: Publico): string {
  if (p.aniversario_mes) return `aniversariantes de ${MESES[p.aniversario_mes - 1] ?? p.aniversario_mes}`;
  if (p.selo) {
    const selo = SELOS.find((s) => s.id === p.selo);
    return selo ? `clientes ${selo.nome.toLowerCase()}${p.selo === "vip" ? "" : "s"}`.replace("comuns", "comuns") : p.selo;
  }
  if (p.todos) return "a base inteira";
  return "ninguém escolhido";
}

export function publicoValido(bruto: unknown): Publico {
  const b = (bruto ?? {}) as Record<string, unknown>;
  const mes = Number(b.aniversario_mes);
  if (mes >= 1 && mes <= 12) return { aniversario_mes: mes };
  if (typeof b.selo === "string" && SELOS.some((s) => s.id === b.selo)) return { selo: b.selo as Selo };
  if (b.todos === true) return { todos: true };
  return {};
}

/**
 * Quem recebe: sem repetir telefone, sem quem pediu para sair, sem quem não
 * tem telefone. A foto que vira `disparos_envios`.
 */
export function selecionarPublico(pessoas: Cliente[]): Cliente[] {
  const vistos = new Set<string>();
  const saida: Cliente[] = [];
  for (const p of pessoas) {
    if (p.descadastrado_em) continue;
    const tel = normalizarTelefone(p.telefone);
    if (!tel || vistos.has(tel)) continue;
    vistos.add(tel);
    saida.push(p);
  }
  return saida;
}

async function pessoasDoPublico(venue: { id: string; timezone: string }, publico: Publico): Promise<Cliente[]> {
  const hoje = hojeNaCasa(venue.timezone);
  if (publico.aniversario_mes) {
    return selecionarPublico(await listarClientes(venue.id, { mes: publico.aniversario_mes, comAniversario: true, limite: 2000, hoje }));
  }
  if (publico.selo) return selecionarPublico(await listarClientes(venue.id, { selo: publico.selo, limite: 2000, hoje }));
  if (publico.todos) return selecionarPublico(await listarClientes(venue.id, { limite: 2000, hoje }));
  return [];
}

// ============================================================
// O disparo
// ============================================================

export type StatusDoDisparo = "rascunho" | "agendado" | "enviando" | "concluido" | "cancelado";

export interface Disparo {
  id: string;
  venue_id: string;
  nome: string;
  modelo: string;
  idioma: string;
  corpo: string;
  variaveis: Variavel[];
  publico: Publico;
  status: StatusDoDisparo;
  agendado_para: string | null;
  concluido_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export type StatusDoEnvio = "pendente" | "enviado" | "entregue" | "lido" | "respondeu" | "falhou";

export interface Envio {
  id: string;
  disparo_id: string;
  venue_id: string;
  cliente_id: string | null;
  telefone: string;
  nome: string | null;
  status: StatusDoEnvio;
  provider_id: string | null;
  erro: string | null;
  enviado_em: string | null;
  entregue_em: string | null;
  lido_em: string | null;
  respondeu_em: string | null;
  resposta: string | null;
}

export interface Balanco {
  pessoas: number;
  pendentes: number;
  enviados: number;
  entregues: number;
  lidos: number;
  responderam: number;
  falharam: number;
}

/** "Enviado" conta quem passou por lá: entregue, lido e respondeu também foram enviados. */
export function balanco(envios: Array<Pick<Envio, "status">>): Balanco {
  const b: Balanco = { pessoas: envios.length, pendentes: 0, enviados: 0, entregues: 0, lidos: 0, responderam: 0, falharam: 0 };
  for (const e of envios) {
    if (e.status === "pendente") b.pendentes += 1;
    else if (e.status === "falhou") b.falharam += 1;
    else {
      b.enviados += 1;
      if (e.status === "entregue" || e.status === "lido" || e.status === "respondeu") b.entregues += 1;
      if (e.status === "lido" || e.status === "respondeu") b.lidos += 1;
      if (e.status === "respondeu") b.responderam += 1;
    }
  }
  return b;
}

/** O que impede de agendar, em frases. Vazio = pode. */
export function porQueNaoAgenda(d: Pick<Disparo, "modelo" | "corpo" | "variaveis" | "publico" | "status">): string[] {
  const motivos: string[] = [];
  if (d.status !== "rascunho" && d.status !== "agendado") motivos.push("este disparo já saiu ou foi cancelado");
  if (!d.modelo) motivos.push("escolha um modelo aprovado");
  const lacunas = lacunasDe(d.corpo);
  if (d.variaveis.length < lacunas) motivos.push(`o modelo tem ${lacunas} lacuna(s) e só ${d.variaveis.length} preenchida(s)`);
  if (!d.publico.selo && !d.publico.aniversario_mes && !d.publico.todos) motivos.push("escolha quem recebe");
  return motivos;
}

/**
 * A ordem dos status é uma escada: o webhook da Meta pode chegar fora de
 * ordem ("lida" antes de "entregue"), e descer um degrau apagaria o que a
 * casa já sabe.
 */
const DEGRAU: Record<StatusDoEnvio, number> = { pendente: 0, falhou: 1, enviado: 2, entregue: 3, lido: 4, respondeu: 5 };

export function sobe(de: StatusDoEnvio, para: StatusDoEnvio): boolean {
  return DEGRAU[para] > DEGRAU[de];
}

/** O status da Meta no nosso vocabulário. `null` = não interessa ("sent" já é o nosso "enviado"). */
export function statusDaMeta(status: string | undefined): StatusDoEnvio | null {
  if (status === "delivered") return "entregue";
  if (status === "read") return "lido";
  if (status === "failed") return "falhou";
  return null;
}

// ============================================================
// O contexto para o agente
// ============================================================

function dataCurta(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function reais(centavos: number): string {
  return `R$ ${(centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Quem é esta pessoa para a casa, numa frase que o agente lê antes de
 * responder. É a diferença entre "Oi! Como posso ajudar?" e "Bruno! Faz
 * tempo, hein — a mesa dos fundos sentiu sua falta".
 */
export function retratoParaOAgente(pessoa: { nome: string | null; ultima_visita: string | null }, retrato: Retrato): string {
  const selo = SELOS.find((s) => s.id === retrato.selo);
  const partes: string[] = [];
  partes.push(`Quem escreve: ${pessoa.nome?.trim() || "cliente sem nome no cadastro"}${selo ? ` — cliente ${selo.nome}` : ""}.`);
  if (retrato.visitas > 0) {
    partes.push(
      `${retrato.visitas} visita(s)` +
        (retrato.ticket_centavos ? `, gasta em média ${reais(retrato.ticket_centavos)} por visita` : "") +
        (retrato.dias_sem_vir !== null ? `, última visita ${faltaHaQuantoTempo(retrato.dias_sem_vir)}` : "") +
        ".",
    );
  } else {
    partes.push("Nunca teve visita registrada.");
  }
  if (retrato.selo === "sumido") partes.push("Vinha e parou de vir: trate como alguém que vale trazer de volta, sem cobrar a ausência.");
  return partes.join(" ");
}

/** O disparo a que a pessoa está respondendo, numa frase para o agente. */
export function contextoDoDisparo(
  disparo: Pick<Disparo, "nome" | "corpo" | "variaveis">,
  envio: Pick<Envio, "nome" | "enviado_em">,
  casa: string,
  timezone: string,
  botao?: string | null,
): string {
  const texto = renderizar(disparo.corpo, preencherVariaveis(disparo.variaveis, { nome: envio.nome }, casa));
  const quando = envio.enviado_em ? ` em ${dataCurta(envio.enviado_em, timezone)}` : "";
  return (
    `Esta pessoa está RESPONDENDO a uma mensagem que a casa mandou${quando} (disparo "${disparo.nome}"). ` +
    `O texto que ela recebeu foi: "${texto}". ` +
    (botao ? `Ela tocou no botão "${botao}". ` : "") +
    `Responda como continuação dessa mensagem — não pergunte "como posso ajudar", ela já sabe do que se trata.`
  );
}

// ============================================================
// Banco
// ============================================================

function disparoDaLinha(l: Record<string, unknown>): Disparo {
  return {
    id: String(l.id),
    venue_id: String(l.venue_id),
    nome: String(l.nome ?? ""),
    modelo: String(l.modelo ?? ""),
    idioma: String(l.idioma ?? "pt_BR"),
    corpo: String(l.corpo ?? ""),
    variaveis: variaveisValidas(l.variaveis),
    publico: publicoValido(l.publico),
    status: (l.status as StatusDoDisparo) ?? "rascunho",
    agendado_para: (l.agendado_para as string | null) ?? null,
    concluido_em: (l.concluido_em as string | null) ?? null,
    criado_em: String(l.criado_em ?? ""),
    atualizado_em: String(l.atualizado_em ?? ""),
  };
}

function erroDoBanco(e: { message: string }, oQue: string): never {
  if (ehMigracaoPendente(e.message)) {
    throw new ErroDeDisparo(503, "O banco ainda não tem as tabelas de disparos. Aplique a migração e tente de novo.");
  }
  throw new ErroDeDisparo(500, `Falha ao ${oQue}: ${e.message}`);
}

export interface DadosDoDisparo {
  nome: string;
  modelo: string;
  idioma?: string;
  corpo: string;
  variaveis: Variavel[];
  publico: Publico;
}

export async function criarDisparo(venueId: string, dados: DadosDoDisparo): Promise<Disparo> {
  if (!dados.nome.trim()) throw new ErroDeDisparo(400, "Dê um nome ao disparo — é como ele aparece na lista.");
  const { data, error } = await cliente()
    .from("disparos")
    .insert({
      venue_id: venueId,
      nome: dados.nome.trim(),
      modelo: dados.modelo.trim(),
      idioma: dados.idioma?.trim() || "pt_BR",
      corpo: dados.corpo,
      variaveis: dados.variaveis,
      publico: dados.publico,
    })
    .select()
    .single();
  if (error) erroDoBanco(error, "criar o disparo");
  return disparoDaLinha(data);
}

export async function atualizarDisparo(venueId: string, id: string, dados: Partial<DadosDoDisparo>): Promise<Disparo> {
  const atual = await obterDisparo(venueId, id);
  if (atual.status !== "rascunho") {
    throw new ErroDeDisparo(409, "Este disparo já foi agendado. Cancele para mexer nele.");
  }
  const campos: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (dados.nome !== undefined) campos.nome = dados.nome.trim();
  if (dados.modelo !== undefined) campos.modelo = dados.modelo.trim();
  if (dados.idioma !== undefined) campos.idioma = dados.idioma.trim() || "pt_BR";
  if (dados.corpo !== undefined) campos.corpo = dados.corpo;
  if (dados.variaveis !== undefined) campos.variaveis = dados.variaveis;
  if (dados.publico !== undefined) campos.publico = dados.publico;
  const { data, error } = await cliente().from("disparos").update(campos).eq("id", id).eq("venue_id", venueId).select().single();
  if (error) erroDoBanco(error, "salvar o disparo");
  return disparoDaLinha(data);
}

export async function obterDisparo(venueId: string, id: string): Promise<Disparo> {
  const { data, error } = await cliente().from("disparos").select("*").eq("id", id).eq("venue_id", venueId).maybeSingle();
  if (error) erroDoBanco(error, "ler o disparo");
  if (!data) throw new ErroDeDisparo(404, "Disparo não encontrado.");
  return disparoDaLinha(data);
}

export async function listarDisparos(venueId: string): Promise<Array<Disparo & { balanco: Balanco }>> {
  const { data, error } = await cliente()
    .from("disparos")
    .select("*")
    .eq("venue_id", venueId)
    .order("criado_em", { ascending: false })
    .limit(100);
  if (error) {
    if (ehMigracaoPendente(error.message)) return [];
    erroDoBanco(error, "listar os disparos");
  }
  const disparos = ((data ?? []) as Record<string, unknown>[]).map(disparoDaLinha);
  if (disparos.length === 0) return [];

  const { data: envios } = await cliente()
    .from("disparos_envios")
    .select("disparo_id, status")
    .in("disparo_id", disparos.map((d) => d.id))
    .limit(20_000);
  const porDisparo = new Map<string, Array<{ status: StatusDoEnvio }>>();
  for (const e of (envios ?? []) as Array<{ disparo_id: string; status: StatusDoEnvio }>) {
    const lista = porDisparo.get(e.disparo_id) ?? [];
    lista.push(e);
    porDisparo.set(e.disparo_id, lista);
  }
  return disparos.map((d) => ({ ...d, balanco: balanco(porDisparo.get(d.id) ?? []) }));
}

export async function enviosDoDisparo(venueId: string, id: string): Promise<Envio[]> {
  const { data, error } = await cliente()
    .from("disparos_envios")
    .select("*")
    .eq("disparo_id", id)
    .eq("venue_id", venueId)
    .order("enviado_em", { ascending: false, nullsFirst: false })
    .order("nome", { ascending: true })
    .limit(5000);
  if (error) erroDoBanco(error, "ler os envios");
  return (data ?? []) as Envio[];
}

/** Quantos receberiam, e alguns nomes — a prévia antes de agendar. */
export async function preverPublico(
  venue: { id: string; timezone: string },
  publico: Publico,
): Promise<{ pessoas: number; amostra: string[] }> {
  const pessoas = await pessoasDoPublico(venue, publico);
  return { pessoas: pessoas.length, amostra: pessoas.slice(0, 5).map((p) => p.nome?.trim() || p.telefone) };
}

/**
 * Agenda: fotografa o público em `disparos_envios` e marca a hora.
 *
 * `quando` no passado (ou ausente) é "agora": o relógio de minuto em
 * minuto pega na próxima volta.
 */
export async function agendarDisparo(
  venue: { id: string; timezone: string },
  id: string,
  quando: Date | null,
): Promise<{ disparo: Disparo; pessoas: number }> {
  const d = await obterDisparo(venue.id, id);
  const motivos = porQueNaoAgenda(d);
  if (motivos.length > 0) throw new ErroDeDisparo(400, `Ainda não dá para agendar: ${motivos.join("; ")}.`);

  const pessoas = await pessoasDoPublico(venue, d.publico);
  if (pessoas.length === 0) throw new ErroDeDisparo(400, `Ninguém para receber: ${descreverPublico(d.publico)} está vazio.`);

  // Reagendar um agendado: a foto antiga sai, a nova entra.
  if (d.status === "agendado") {
    await cliente().from("disparos_envios").delete().eq("disparo_id", d.id).eq("status", "pendente");
  }

  const linhas = pessoas.map((p) => ({
    disparo_id: d.id,
    venue_id: venue.id,
    cliente_id: p.id,
    telefone: normalizarTelefone(p.telefone),
    nome: p.nome,
  }));
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await cliente().from("disparos_envios").upsert(linhas.slice(i, i + 500), { onConflict: "disparo_id,telefone", ignoreDuplicates: true });
    if (error) erroDoBanco(error, "fotografar o público");
  }

  const agora = new Date();
  const para = quando && quando.getTime() > agora.getTime() ? quando : agora;
  const { data, error } = await cliente()
    .from("disparos")
    .update({ status: "agendado", agendado_para: para.toISOString(), atualizado_em: agora.toISOString() })
    .eq("id", d.id)
    .select()
    .single();
  if (error) erroDoBanco(error, "agendar o disparo");
  return { disparo: disparoDaLinha(data), pessoas: pessoas.length };
}

/** Cancela: o que ainda não saiu, não sai. O que já saiu, saiu. */
export async function cancelarDisparo(venueId: string, id: string): Promise<Disparo> {
  const d = await obterDisparo(venueId, id);
  if (d.status === "concluido" || d.status === "cancelado") return d;
  await cliente().from("disparos_envios").delete().eq("disparo_id", d.id).eq("status", "pendente");
  const { data, error } = await cliente()
    .from("disparos")
    .update({ status: "cancelado", concluido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
    .eq("id", d.id)
    .select()
    .single();
  if (error) erroDoBanco(error, "cancelar o disparo");
  return disparoDaLinha(data);
}

export async function apagarDisparo(venueId: string, id: string): Promise<void> {
  const d = await obterDisparo(venueId, id);
  if (d.status === "agendado" || d.status === "enviando") {
    throw new ErroDeDisparo(409, "Cancele antes de apagar: este disparo ainda está saindo.");
  }
  const { error } = await cliente().from("disparos").delete().eq("id", id).eq("venue_id", venueId);
  if (error) erroDoBanco(error, "apagar o disparo");
}

// ============================================================
// O relógio: mandar o que está na hora, no ritmo
// ============================================================

/**
 * Manda um lote de um disparo. Devolve quantos saíram e quantos faltam.
 *
 * Cada envio é gravado ANTES de chamar a Meta ("enviado" com o wamid vem
 * depois). Um processo que morre no meio deixa "pendente" quem não foi
 * chamado e "enviado" quem foi — nunca manda duas vezes para a mesma
 * pessoa.
 */
export async function enviarLote(
  venue: { id: string; slug: string; name: string },
  disparo: Disparo,
  limite = RITMO_POR_MINUTO,
): Promise<{ enviados: number; falharam: number; faltam: number }> {
  const conexao = await conexaoDaCasa(venue);
  if (!prontaParaEnviar(conexao)) {
    throw new ErroDeDisparo(400, "A casa não tem o WhatsApp oficial conectado. Conecte em Ajustes > WhatsApp da casa.");
  }

  const { data, error } = await cliente()
    .from("disparos_envios")
    .select("*")
    .eq("disparo_id", disparo.id)
    .eq("status", "pendente")
    .order("nome", { ascending: true })
    .limit(limite + 1);
  if (error) erroDoBanco(error, "ler os pendentes");

  const pendentes = (data ?? []) as Envio[];
  const lote = pendentes.slice(0, limite);
  let enviados = 0;
  let falharam = 0;

  for (const envio of lote) {
    // Reivindica a linha: só quem trocou "pendente" por "enviado" manda.
    // Dois processos no mesmo lote não mandam duas vezes.
    const { data: minha } = await cliente()
      .from("disparos_envios")
      .update({ status: "enviado", enviado_em: new Date().toISOString() })
      .eq("id", envio.id)
      .eq("status", "pendente")
      .select("id");
    if (!minha || (minha as unknown[]).length === 0) continue;

    const r = await enviarModeloPelaCloudApi(
      envio.telefone,
      { name: disparo.modelo, language: disparo.idioma, parametros: preencherVariaveis(disparo.variaveis, { nome: envio.nome }, venue.name) },
      conexao,
    );
    if (r.enviado) {
      enviados += 1;
      await cliente().from("disparos_envios").update({ provider_id: r.providerId ?? null }).eq("id", envio.id);
    } else {
      falharam += 1;
      await cliente().from("disparos_envios").update({ status: "falhou", erro: r.erro ?? "falha desconhecida" }).eq("id", envio.id);
    }
  }

  const faltam = Math.max(0, pendentes.length - lote.length);
  return { enviados, falharam, faltam };
}

/**
 * A volta de minuto em minuto.
 *
 * Um processo por minuto (o servidor roda em quatro), e um lote por disparo
 * por volta: é o ritmo. Disparo sem pendente vira "concluido".
 */
export async function cuidarDosDisparos(agora = new Date()): Promise<{ enviados: number; concluidos: number }> {
  const total = { enviados: 0, concluidos: 0 };
  if (!(await reivindicar("disparos", 1, agora))) return total;

  const { data, error } = await cliente()
    .from("disparos")
    .select("*, venues!inner(id, slug, name, timezone)")
    .in("status", ["agendado", "enviando"])
    .lte("agendado_para", agora.toISOString())
    .limit(50);
  if (error) {
    if (!ehMigracaoPendente(error.message)) console.error(`[disparos] não li os agendados: ${error.message}`);
    return total;
  }

  for (const linha of (data ?? []) as Array<Record<string, unknown> & { venues: { id: string; slug: string; name: string; timezone: string } }>) {
    const disparo = disparoDaLinha(linha);
    const venue = linha.venues;
    try {
      if (disparo.status === "agendado") {
        await cliente().from("disparos").update({ status: "enviando", atualizado_em: agora.toISOString() }).eq("id", disparo.id);
      }
      const r = await enviarLote(venue, disparo);
      total.enviados += r.enviados;
      if (r.enviados || r.falharam) {
        console.log(`[disparos] ${venue.name} · "${disparo.nome}": ${r.enviados} enviado(s), ${r.falharam} falha(s), faltam ${r.faltam}.`);
      }
      if (r.faltam === 0) {
        await cliente()
          .from("disparos")
          .update({ status: "concluido", concluido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
          .eq("id", disparo.id);
        total.concluidos += 1;
      }
    } catch (e) {
      // Uma casa sem conexão não pode travar as outras; o disparo fica
      // "enviando" e tenta de novo no próximo minuto.
      console.error(`[disparos] ${venue.name} · "${disparo.nome}": ${(e as Error).message}`);
    }
  }
  return total;
}

// ============================================================
// O que a Meta conta de volta, e a resposta da pessoa
// ============================================================

/** Um status do webhook ("delivered", "read", "failed") para o envio certo. */
export async function registrarStatusDaMeta(status: {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: Array<{ title?: string; message?: string }>;
}): Promise<boolean> {
  const novo = statusDaMeta(status.status);
  if (!novo || !status.id) return false;

  const { data } = await cliente().from("disparos_envios").select("id, status").eq("provider_id", status.id).maybeSingle();
  if (!data) return false;
  const atual = (data as { status: StatusDoEnvio }).status;
  if (!sobe(atual, novo)) return false;

  const quando = status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : new Date().toISOString();
  const campos: Record<string, unknown> = { status: novo };
  if (novo === "entregue") campos.entregue_em = quando;
  if (novo === "lido") {
    campos.lido_em = quando;
    campos.entregue_em = campos.entregue_em ?? quando;
  }
  if (novo === "falhou") campos.erro = status.errors?.[0]?.message ?? status.errors?.[0]?.title ?? "a Meta não entregou";
  await cliente().from("disparos_envios").update(campos).eq("id", (data as { id: string }).id);
  return true;
}

/**
 * A pessoa escreveu: ela está respondendo a um disparo?
 *
 * Três pistas, da mais certa à menos: a mensagem citada (a Meta manda o
 * wamid), depois o último disparo enviado a ela nas últimas 72 h. Marca o
 * envio como "respondeu" (uma vez) e devolve o disparo, para o agente.
 */
export async function registrarResposta(
  venueId: string,
  telefone: string,
  pista: { contextoId?: string | null; texto?: string | null; botao?: string | null },
  agora = new Date(),
): Promise<{ disparo: Disparo; envio: Envio } | null> {
  const tel = normalizarTelefone(telefone);
  if (!tel) return null;

  let envio: Envio | null = null;
  if (pista.contextoId) {
    const { data } = await cliente().from("disparos_envios").select("*").eq("provider_id", pista.contextoId).eq("venue_id", venueId).maybeSingle();
    envio = (data as Envio | null) ?? null;
  }
  if (!envio) {
    const desde = new Date(agora.getTime() - HORAS_DE_RESPOSTA * 3_600_000).toISOString();
    const { data, error } = await cliente()
      .from("disparos_envios")
      .select("*")
      .eq("venue_id", venueId)
      .eq("telefone", tel)
      .gte("enviado_em", desde)
      .neq("status", "pendente")
      .neq("status", "falhou")
      .order("enviado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error && !ehMigracaoPendente(error.message)) console.error(`[disparos] não li a resposta de ${tel}: ${error.message}`);
    envio = (data as Envio | null) ?? null;
  }
  if (!envio) return null;

  const { data: d } = await cliente().from("disparos").select("*").eq("id", envio.disparo_id).maybeSingle();
  if (!d) return null;

  if (envio.status !== "respondeu") {
    const resposta = (pista.botao ?? pista.texto ?? "").trim().slice(0, 200) || null;
    await cliente()
      .from("disparos_envios")
      .update({ status: "respondeu", respondeu_em: agora.toISOString(), resposta })
      .eq("id", envio.id);
    envio = { ...envio, status: "respondeu", respondeu_em: agora.toISOString(), resposta };
  }
  return { disparo: disparoDaLinha(d), envio };
}

export { retratoDe };
