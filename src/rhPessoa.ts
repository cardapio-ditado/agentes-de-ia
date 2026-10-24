import { randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicConfig } from "./config.js";
import { db, ehMigracaoPendente } from "./supabase.js";
import { ErroDoRh, apenasDigitos, cpfValido, salvarFicha, type Ficha } from "./rh.js";
import { hojeNaCasa } from "./fuso.js";

/**
 * RH — a pessoa por inteiro (Rodada A).
 *
 *   · OCORRÊNCIAS: elogio, feedback, conversa, atraso, falta, advertência,
 *     suspensão — e o elogio que o cliente deixou na pesquisa. É a linha do
 *     tempo da pessoa na casa, e o registro formal que protege a casa.
 *   · CONTRATO DE EXPERIÊNCIA: 45 + 45 dias por padrão. Esquecer o prazo
 *     efetiva a pessoa sem querer; o sistema avisa antes.
 *   · FICHA 360°: tudo de uma pessoa numa resposta só, para a tela e o PDF.
 *   · CONVITE: o link para a própria pessoa preencher a ficha e mandar a foto
 *     dos documentos. É o que tira do gerente o trabalho que ele não fazia.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

function falhar(contexto: string, mensagem: string): never {
  if (ehMigracaoPendente(mensagem)) {
    throw new ErroDoRh(503, `${contexto}: o banco ainda não recebeu a migração do RH. Rode o SQL e tente de novo.`);
  }
  throw new ErroDoRh(500, `${contexto}: ${mensagem}`);
}

const DIA_MS = 86_400_000;
const somarDias = (iso: string, dias: number) =>
  new Date(new Date(`${iso}T12:00:00Z`).getTime() + dias * DIA_MS).toISOString().slice(0, 10);
const diasEntre = (de: string, ate: string) =>
  Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / DIA_MS);

// ============================================================
// Ocorrências
// ============================================================

export const TIPOS_DE_OCORRENCIA = [
  { id: "elogio", nome: "Elogio", formal: false },
  { id: "feedback", nome: "Feedback de ajuste", formal: false },
  { id: "conversa", nome: "Conversa registrada", formal: false },
  { id: "atraso", nome: "Atraso", formal: false },
  { id: "falta", nome: "Falta", formal: false },
  { id: "advertencia", nome: "Advertência", formal: true },
  { id: "suspensao", nome: "Suspensão", formal: true },
  { id: "elogio_cliente", nome: "Elogio de cliente", formal: false },
] as const;

const IDS_DE_OCORRENCIA = new Set<string>(TIPOS_DE_OCORRENCIA.map((t) => t.id));

export interface Ocorrencia {
  id: string;
  atendente_id: string;
  dia: string;
  tipo: string;
  descricao: string | null;
  minutos: number | null;
  dias: number | null;
  origem: string;
  criado_por: string | null;
  criado_em: string;
}

const COLUNAS_DA_OCORRENCIA = "id, atendente_id, dia, tipo, descricao, minutos, dias, origem, criado_por, criado_em";

export async function listarOcorrencias(venueId: string, atendenteId: string): Promise<Ocorrencia[]> {
  const { data, error } = await cliente()
    .from("rh_ocorrencias")
    .select(COLUNAS_DA_OCORRENCIA)
    .eq("venue_id", venueId)
    .eq("atendente_id", atendenteId)
    .order("dia", { ascending: false })
    .order("criado_em", { ascending: false })
    .limit(200);
  if (error) falhar("Falha ao ler as ocorrências", error.message);
  return (data ?? []) as Ocorrencia[];
}

/** O que entra numa ocorrência, conferido. Pura: testável sem banco. */
export function montarOcorrencia(campos: Record<string, unknown>): {
  dia: string;
  tipo: string;
  descricao: string | null;
  minutos: number | null;
  dias: number | null;
} {
  const tipo = String(campos.tipo ?? "");
  if (!IDS_DE_OCORRENCIA.has(tipo) || tipo === "elogio_cliente") {
    throw new ErroDoRh(400, "Escolha o tipo: elogio, feedback, conversa, atraso, falta, advertência ou suspensão.");
  }
  const dia = String(campos.dia ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new ErroDoRh(400, "Informe o dia.");
  const descricao = String(campos.descricao ?? "").trim() || null;
  if ((tipo === "advertencia" || tipo === "suspensao") && !descricao) {
    throw new ErroDoRh(400, "Advertência e suspensão precisam do motivo por escrito: é o que vale numa conversa trabalhista.");
  }
  const inteiro = (v: unknown) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0) throw new ErroDoRh(400, "Número inválido.");
    return n;
  };
  const minutos = tipo === "atraso" ? inteiro(campos.minutos) : null;
  if (tipo === "atraso" && !minutos) throw new ErroDoRh(400, "Quantos minutos de atraso?");
  const dias = tipo === "suspensao" ? inteiro(campos.dias) : null;
  if (tipo === "suspensao" && !dias) throw new ErroDoRh(400, "Quantos dias de suspensão?");
  return { dia, tipo, descricao, minutos, dias };
}

export async function registrarOcorrencia(params: {
  venueId: string;
  atendenteId: string;
  campos: Record<string, unknown>;
  quem: string;
}): Promise<Ocorrencia> {
  const linha = montarOcorrencia(params.campos);
  const { data, error } = await cliente()
    .from("rh_ocorrencias")
    .insert({ venue_id: params.venueId, atendente_id: params.atendenteId, ...linha, criado_por: params.quem })
    .select(COLUNAS_DA_OCORRENCIA)
    .single();
  if (error) falhar("Falha ao registrar", error.message);
  return data as Ocorrencia;
}

export async function apagarOcorrencia(params: { venueId: string; id: string }): Promise<{ apagado: boolean }> {
  const { error } = await cliente().from("rh_ocorrencias").delete().eq("venue_id", params.venueId).eq("id", params.id);
  if (error) falhar("Falha ao apagar", error.message);
  return { apagado: true };
}

// ============================================================
// Contrato de experiência
// ============================================================

export interface SituacaoDaExperiencia {
  /** "primeiro" e "segundo" são os períodos; "fim" = já decidido ou passou. */
  fase: "primeiro" | "segundo" | "fim";
  primeiro_vence: string;
  segundo_vence: string | null;
  /** O prazo que está correndo agora. */
  vence_em: string | null;
  dias_para_vencer: number | null;
  decisao: string | null;
  /** Precisa de alguém decidir em até 7 dias (ou já passou e ninguém decidiu). */
  alerta: boolean;
  /** Passou do prazo sem decisão: o contrato virou indeterminado por omissão. */
  venceu_sem_decisao: boolean;
}

/**
 * Onde está o contrato de experiência. Só CLT com admissão tem um.
 *
 * O primeiro período vence no dia `admissão + dias − 1` (o dia da admissão
 * conta). Prorrogado, corre o segundo. Efetivado ou encerrado, acabou.
 */
export function situacaoDaExperiencia(
  ficha: Pick<Ficha, "vinculo" | "admissao" | "desligamento"> & {
    experiencia_primeiro?: number | null;
    experiencia_segundo?: number | null;
    experiencia_decisao?: string | null;
  },
  hoje: string,
): SituacaoDaExperiencia | null {
  if (ficha.vinculo !== "clt" || !ficha.admissao || ficha.desligamento) return null;
  const p1 = Number(ficha.experiencia_primeiro ?? 45);
  const p2 = Number(ficha.experiencia_segundo ?? 45);
  if (!p1) return null;
  const primeiroVence = somarDias(ficha.admissao, p1 - 1);
  const segundoVence = p2 ? somarDias(primeiroVence, p2) : null;
  const decisao = ficha.experiencia_decisao ?? null;

  // Mais de 90 dias de casa sem nada decidido: é história, não alerta.
  if (decisao === "efetivado" || decisao === "encerrado" || diasEntre(ficha.admissao, hoje) > 120) {
    return { fase: "fim", primeiro_vence: primeiroVence, segundo_vence: segundoVence, vence_em: null, dias_para_vencer: null, decisao, alerta: false, venceu_sem_decisao: false };
  }
  const fase = decisao === "prorrogado" && segundoVence ? "segundo" : "primeiro";
  const venceEm = fase === "segundo" ? segundoVence! : primeiroVence;
  const dias = diasEntre(hoje, venceEm);
  return {
    fase,
    primeiro_vence: primeiroVence,
    segundo_vence: segundoVence,
    vence_em: venceEm,
    dias_para_vencer: dias,
    decisao,
    alerta: dias <= 7,
    venceu_sem_decisao: dias < 0,
  };
}

export async function decidirExperiencia(params: {
  venueId: string;
  atendenteId: string;
  decisao: unknown;
}): Promise<{ ok: true }> {
  const decisao = String(params.decisao ?? "");
  if (!["prorrogado", "efetivado", "encerrado"].includes(decisao)) {
    throw new ErroDoRh(400, "Decida: prorrogar, efetivar ou encerrar.");
  }
  const { error } = await cliente()
    .from("rh_fichas")
    .update({ experiencia_decisao: decisao, experiencia_decidida_em: new Date().toISOString() })
    .eq("venue_id", params.venueId)
    .eq("atendente_id", params.atendenteId);
  if (error) falhar("Falha ao registrar a decisão", error.message);
  return { ok: true };
}

/** Quem tem contrato de experiência pedindo decisão — para o Hoje e o aviso. */
export async function experienciasEmAlerta(venueId: string, timezone: string): Promise<Array<{
  atendente_id: string;
  nome: string;
  situacao: SituacaoDaExperiencia;
}>> {
  const hoje = hojeNaCasa(timezone);
  const [{ data: fichas, error }, { data: pessoas }] = await Promise.all([
    cliente()
      .from("rh_fichas")
      .select("atendente_id, vinculo, admissao, desligamento, experiencia_primeiro, experiencia_segundo, experiencia_decisao")
      .eq("venue_id", venueId)
      .eq("vinculo", "clt")
      .is("desligamento", null)
      .gte("admissao", somarDias(hoje, -130)),
    cliente().from("pesquisa_atendentes").select("id, nome, apelido").eq("venue_id", venueId),
  ]);
  if (error) return [];
  const nomeDe = new Map(((pessoas ?? []) as Array<{ id: string; nome: string; apelido: string | null }>).map((p) => [p.id, p.apelido || p.nome]));
  return ((fichas ?? []) as Array<Record<string, unknown>>)
    .map((f) => ({
      atendente_id: String(f.atendente_id),
      nome: nomeDe.get(String(f.atendente_id)) ?? "—",
      situacao: situacaoDaExperiencia(f as never, hoje),
    }))
    .filter((x): x is { atendente_id: string; nome: string; situacao: SituacaoDaExperiencia } => Boolean(x.situacao?.alerta));
}

// ============================================================
// A ficha 360°
// ============================================================

export async function visao360(params: { venueId: string; atendenteId: string; timezone: string }) {
  const { venueId, atendenteId } = params;
  const hoje = hojeNaCasa(params.timezone);
  const trintaDias = somarDias(hoje, -30);
  const noventaDias = somarDias(hoje, -90);

  const [ficha, ocorrencias, escala, ferias, respostas, vendas] = await Promise.all([
    cliente().from("rh_fichas").select("*").eq("venue_id", venueId).eq("atendente_id", atendenteId).maybeSingle(),
    listarOcorrencias(venueId, atendenteId).catch(() => [] as Ocorrencia[]),
    cliente().from("rh_escala").select("data, situacao").eq("venue_id", venueId).eq("atendente_id", atendenteId).gte("data", trintaDias).lte("data", hoje),
    cliente().from("rh_ferias").select("inicio, fim, dias, situacao").eq("venue_id", venueId).eq("atendente_id", atendenteId).order("inicio", { ascending: false }).limit(10),
    cliente()
      .from("pesquisa_respostas")
      .select("id, created_at, atendente_nota, comentario, elogios, nota")
      .eq("venue_id", venueId)
      .eq("atendente_id", atendenteId)
      .order("created_at", { ascending: false })
      .limit(100),
    cliente().from("rh_vendas").select("dia, valor").eq("venue_id", venueId).eq("atendente_id", atendenteId).gte("dia", noventaDias),
  ]);

  const linhasDaEscala = (escala.data ?? []) as Array<{ data: string; situacao: string }>;
  const notas = ((respostas.data ?? []) as Array<{ id: string; created_at: string; atendente_nota: number; comentario: string | null; elogios: string[] | null }>);
  const media = notas.length ? Math.round((notas.reduce((s, r) => s + r.atendente_nota, 0) / notas.length) * 10) / 10 : null;
  const contar = (tipo: string, desde: string) => ocorrencias.filter((o) => o.tipo === tipo && o.dia >= desde).length;

  return {
    experiencia: ficha.data ? situacaoDaExperiencia(ficha.data, hoje) : null,
    escala_30d: {
      trabalhou: linhasDaEscala.filter((e) => e.situacao === "trabalha").length,
      faltas: linhasDaEscala.filter((e) => e.situacao === "falta").length + contar("falta", trintaDias),
      atestados: linhasDaEscala.filter((e) => e.situacao === "atestado").length,
      atrasos: contar("atraso", trintaDias),
    },
    ferias: (ferias.data ?? []) as Array<{ inicio: string; fim: string; dias: number; situacao: string }>,
    cliente: {
      avaliacoes: notas.length,
      media,
      cinco_estrelas: notas.filter((r) => r.atendente_nota === 5).length,
      recentes: notas.filter((r) => r.comentario).slice(0, 5).map((r) => ({ dia: r.created_at.slice(0, 10), nota: r.atendente_nota, comentario: r.comentario })),
    },
    vendas_90d: ((vendas.data ?? []) as Array<{ valor: number }>).reduce((s, v) => s + Number(v.valor), 0),
    ocorrencias,
    contagem: {
      elogios: ocorrencias.filter((o) => o.tipo === "elogio" || o.tipo === "elogio_cliente").length,
      feedbacks: ocorrencias.filter((o) => o.tipo === "feedback").length,
      advertencias: ocorrencias.filter((o) => o.tipo === "advertencia").length,
      suspensoes: ocorrencias.filter((o) => o.tipo === "suspensao").length,
    },
  };
}

// ============================================================
// O convite: a própria pessoa preenche a ficha
// ============================================================

const VALIDADE_DO_CONVITE_DIAS = 7;

export async function criarConvite(params: { venueId: string; atendenteId: string; quem: string }): Promise<{ token: string; expira_em: string }> {
  const token = randomBytes(18).toString("base64url");
  const expiraEm = new Date(Date.now() + VALIDADE_DO_CONVITE_DIAS * DIA_MS).toISOString();
  const { error } = await cliente()
    .from("rh_convites")
    .insert({ venue_id: params.venueId, atendente_id: params.atendenteId, token, criado_por: params.quem, expira_em: expiraEm });
  if (error) falhar("Falha ao criar o link", error.message);
  return { token, expira_em: expiraEm };
}

export interface ConviteAberto {
  venue_id: string;
  atendente_id: string;
  casa: string;
  nome: string;
  ficha: Record<string, unknown>;
  documentos: string[];
  enviado_em: string | null;
}

/** O que o link mostra. Só campos que a própria pessoa preenche — salário não. */
export async function abrirConvite(token: string): Promise<ConviteAberto> {
  const { data: convite, error } = await cliente()
    .from("rh_convites")
    .select("venue_id, atendente_id, expira_em, enviado_em")
    .eq("token", token)
    .maybeSingle();
  if (error) falhar("Falha ao abrir o link", error.message);
  if (!convite) throw new ErroDoRh(404, "Este link não existe. Peça um novo para a casa.");
  if (new Date(convite.expira_em).getTime() < Date.now()) {
    throw new ErroDoRh(410, "Este link venceu. Peça um novo para a casa — ele vale 7 dias.");
  }
  const [{ data: venue }, { data: pessoa }, { data: ficha }, { data: docs }] = await Promise.all([
    cliente().from("venues").select("name").eq("id", convite.venue_id).single(),
    cliente().from("pesquisa_atendentes").select("nome").eq("id", convite.atendente_id).single(),
    cliente()
      .from("rh_fichas")
      .select("nome_completo, cpf, rg, nascimento, telefone, endereco, chave_pix, banco, emergencia_nome, emergencia_telefone")
      .eq("atendente_id", convite.atendente_id)
      .maybeSingle(),
    cliente().from("rh_documentos").select("tipo").eq("atendente_id", convite.atendente_id),
  ]);
  return {
    venue_id: convite.venue_id,
    atendente_id: convite.atendente_id,
    casa: venue?.name ?? "",
    nome: pessoa?.nome ?? "",
    ficha: ficha ?? {},
    documentos: [...new Set(((docs ?? []) as Array<{ tipo: string }>).map((d) => d.tipo))],
    enviado_em: convite.enviado_em,
  };
}

/** Os campos que a pessoa pode mandar pelo link. Salário, cargo e vínculo, não. */
const CAMPOS_DO_FUNCIONARIO = [
  "nome_completo", "cpf", "rg", "nascimento", "telefone", "endereco",
  "chave_pix", "banco", "emergencia_nome", "emergencia_telefone",
] as const;

export async function receberFichaDoConvite(params: { token: string; campos: Record<string, unknown>; consentimento: boolean }): Promise<{ ok: true }> {
  if (!params.consentimento) {
    throw new ErroDoRh(400, "Para mandar a ficha, marque que você concorda com o uso dos seus dados pela casa.");
  }
  const convite = await abrirConvite(params.token);
  const campos: Record<string, unknown> = {};
  for (const c of CAMPOS_DO_FUNCIONARIO) if (c in params.campos) campos[c] = params.campos[c];
  if (campos.forma_pagamento === undefined && campos.chave_pix) campos.forma_pagamento = "pix";
  await salvarFicha({ venueId: convite.venue_id, atendenteId: convite.atendente_id, campos });
  const agora = new Date().toISOString();
  await cliente().from("rh_fichas").update({ consentimento_em: agora }).eq("atendente_id", convite.atendente_id);
  await cliente().from("rh_convites").update({ enviado_em: agora }).eq("token", params.token);
  return { ok: true };
}

// ============================================================
// A IA lê o documento
// ============================================================

export interface DocumentoLido {
  tipo: string | null;
  nome: string | null;
  cpf: string | null;
  rg: string | null;
  nascimento: string | null;
  legivel: boolean;
}

const FERRAMENTA_DOCUMENTO = {
  name: "registrar_documento",
  description: "Registra o que está escrito no documento de identificação fotografado.",
  input_schema: {
    type: "object" as const,
    properties: {
      tipo: { type: ["string", "null"], enum: ["rg", "cpf", "ctps", "comprovante_endereco", "outro", null], description: "Que documento é." },
      nome: { type: ["string", "null"], description: "Nome completo como está no documento." },
      cpf: { type: ["string", "null"], description: "CPF, só os números." },
      rg: { type: ["string", "null"], description: "Número do RG como está." },
      nascimento: { type: ["string", "null"], description: "Data de nascimento AAAA-MM-DD." },
      legivel: { type: "boolean", description: "Falso se a foto está cortada, borrada ou não é um documento." },
    },
    required: ["legivel"],
  },
};

/**
 * Transcreve o documento para conferir com o que a pessoa digitou. Não decide
 * nada: o gerente vê "o documento diz X, a ficha diz Y" e resolve.
 */
export async function lerDocumento(imagem: Buffer, mediaType: string): Promise<DocumentoLido> {
  const { apiKey } = anthropicConfig();
  const anthropic = new Anthropic({ apiKey });
  const resposta = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 800,
    system:
      "Você transcreve documentos brasileiros de identificação (RG, CPF, carteira de trabalho, comprovante de endereço). " +
      "Só leia o que está escrito; se um dígito estiver ilegível, devolva null naquele campo. Não chute.",
    tools: [FERRAMENTA_DOCUMENTO],
    tool_choice: { type: "tool", name: "registrar_documento" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: imagem.toString("base64") } },
          { type: "text", text: "Transcreva este documento." },
        ],
      },
    ],
  });
  const uso = resposta.content.find((b) => b.type === "tool_use");
  const bruto = (uso && uso.type === "tool_use" ? uso.input : {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const cpf = apenasDigitos(texto(bruto.cpf));
  return {
    tipo: texto(bruto.tipo),
    nome: texto(bruto.nome),
    cpf: cpf && cpfValido(cpf) ? cpf : null,
    rg: texto(bruto.rg),
    nascimento: /^\d{4}-\d{2}-\d{2}$/.test(String(bruto.nascimento ?? "")) ? String(bruto.nascimento) : null,
    legivel: bruto.legivel !== false,
  };
}

/** O documento bate com a ficha? Só aponta diferença; quem resolve é gente. */
export function conferirComAFicha(lido: DocumentoLido, ficha: Record<string, unknown>): string[] {
  const avisos: string[] = [];
  const norm = (t: unknown) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!lido.legivel) avisos.push("A foto do documento não está legível — peça outra, sem reflexo e sem cortar.");
  if (lido.cpf && ficha.cpf && lido.cpf !== apenasDigitos(String(ficha.cpf))) avisos.push(`O CPF do documento (${lido.cpf}) é diferente do digitado na ficha.`);
  if (lido.nome && ficha.nome_completo && norm(lido.nome) !== norm(ficha.nome_completo)) avisos.push(`O nome no documento é "${lido.nome}".`);
  if (lido.nascimento && ficha.nascimento && lido.nascimento !== ficha.nascimento) avisos.push(`A data de nascimento do documento é ${lido.nascimento.split("-").reverse().join("/")}.`);
  return avisos;
}

// ============================================================
// O elogio do cliente chega no funcionário
// ============================================================

/**
 * Quando o cliente dá 4 ou 5 estrelas para quem atendeu, o elogio entra na
 * linha do tempo da pessoa — e, se ela tem WhatsApp na ficha, chega nela.
 * Custa nada e é o reconhecimento mais forte que existe: a palavra do
 * cliente, no dia.
 *
 * Uma mensagem por pessoa por dia, no máximo: no sábado cheio o garçom bom
 * recebe dez estrelas, e dez mensagens viram ruído.
 */
export async function elogioDoCliente(params: {
  venueId: string;
  respostaId: string;
  atendenteId: string;
  estrelas: number;
  comentario: string | null;
  elogios: string[];
  casaNome: string;
  timezone: string;
}): Promise<void> {
  if (params.estrelas < 4) return;
  const { temModulo } = await import("./modulos.js");
  if (!(await temModulo(params.venueId, "rh"))) return;

  const hoje = hojeNaCasa(params.timezone);
  const frase = params.comentario?.trim()
    ? `“${params.comentario.trim().slice(0, 280)}”`
    : params.elogios.length
      ? `Elogiou: ${params.elogios.join(", ")}`
      : null;

  const { error } = await cliente()
    .from("rh_ocorrencias")
    .insert({
      venue_id: params.venueId,
      atendente_id: params.atendenteId,
      dia: hoje,
      tipo: "elogio_cliente",
      descricao: `${params.estrelas} estrela(s) na pesquisa${frase ? ` · ${frase}` : ""}`,
      origem: "pesquisa",
      pesquisa_resposta_id: params.respostaId,
      criado_por: "Pesquisa de satisfação",
    });
  // Duplicada (mesma resposta) ou tabela por criar: não há mais o que fazer.
  if (error) return;

  const { data: ficha } = await cliente().from("rh_fichas").select("telefone").eq("atendente_id", params.atendenteId).maybeSingle();
  const { normalizarTelefone, inserirAvisos } = await import("./notifications.js");
  const telefone = normalizarTelefone(String(ficha?.telefone ?? ""));
  if (!telefone) return;

  const { count } = await cliente()
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("venue_id", params.venueId)
    .eq("template", "rh_elogio_cliente")
    .eq("destination", telefone)
    .gte("created_at", new Date(Date.now() - 20 * 3_600_000).toISOString());
  if ((count ?? 0) > 0) return;

  const { data: pessoa } = await cliente().from("pesquisa_atendentes").select("nome, apelido").eq("id", params.atendenteId).maybeSingle();
  const primeiro = String(pessoa?.apelido || pessoa?.nome || "").split(" ")[0];
  await inserirAvisos({
    venue_id: params.venueId,
    channel: "whatsapp",
    destination: telefone,
    papel: "administrativo",
    template: "rh_elogio_cliente",
    body:
      `⭐ ${primeiro ? `${primeiro}, u` : "U"}m cliente da ${params.casaNome} avaliou o seu atendimento com ${params.estrelas} estrelas!` +
      (frase ? `\n\n${frase}` : "") +
      "\n\nParabéns, continue assim!",
  });
}

// ============================================================
// O aviso do contrato de experiência
// ============================================================

/**
 * Uma vez por dia, a partir das 9h da casa, quem tem contrato de
 * experiência vencendo em até 7 dias (ou vencido sem decisão) vira uma
 * mensagem para o gestor. Esquecer esse prazo efetiva a pessoa sem querer —
 * é o erro mais comum de RH em bar.
 *
 * Uma mensagem por casa por dia, com todos os nomes: a trava é a própria
 * fila (template + destino nas últimas 20 horas).
 */
export async function cicloDaExperiencia(agora = new Date()): Promise<void> {
  const { data: casas, error } = await cliente()
    .from("venue_modulos")
    .select("venue_id, venues:venue_id(id, name, timezone, reservas_avisar_whatsapp)")
    .eq("modulo", "rh")
    .eq("ativo", true);
  if (error) return;
  const { normalizarTelefone, inserirAvisos } = await import("./notifications.js");
  const { horaNaCasa } = await import("./fuso.js");

  for (const casa of (casas ?? []) as Array<{ venues: { id: string; name: string; timezone: string; reservas_avisar_whatsapp: string | null } | null }>) {
    const venue = casa.venues;
    if (!venue) continue;
    try {
      const fuso = venue.timezone || "America/Cuiaba";
      if (horaNaCasa(fuso, agora) < 9) continue;
      const destino = normalizarTelefone(String(venue.reservas_avisar_whatsapp ?? ""));
      if (!destino) continue;
      const alertas = await experienciasEmAlerta(venue.id, fuso);
      if (!alertas.length) continue;

      const { count } = await cliente()
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("venue_id", venue.id)
        .eq("template", "rh_experiencia")
        .gte("created_at", new Date(agora.getTime() - 20 * 3_600_000).toISOString());
      if ((count ?? 0) > 0) continue;

      const linhas = alertas.map(({ nome, situacao }) => {
        const quando = situacao.venceu_sem_decisao
          ? `venceu em ${situacao.vence_em!.split("-").reverse().join("/")} sem decisão`
          : situacao.dias_para_vencer === 0
            ? "vence HOJE"
            : `vence em ${situacao.dias_para_vencer} dia(s) (${situacao.vence_em!.split("-").reverse().join("/")})`;
        return `• ${nome}: ${situacao.fase === "primeiro" ? "1º" : "2º"} período ${quando}`;
      });
      await inserirAvisos({
        venue_id: venue.id,
        channel: "whatsapp",
        destination: destino,
        papel: "administrativo",
        template: "rh_experiencia",
        body:
          `📋 Contrato de experiência — ${venue.name}\n\n${linhas.join("\n")}\n\n` +
          "Decida no painel (RH → ficha da pessoa): prorrogar, efetivar ou encerrar. Passar do prazo sem decidir efetiva a pessoa.",
      });
    } catch (e) {
      console.error(`[rh] aviso de experiência de ${venue.name} falhou: ${(e as Error).message}`);
    }
  }
}
