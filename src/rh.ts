import { db, ehMigracaoPendente } from "./supabase.js";

/**
 * RH — Fase 1: ficha do funcionário, documentos, admissão e desligamento.
 *
 * O que este módulo NÃO faz, de propósito: folha de pagamento. Não calcula
 * INSS, IRRF, FGTS, décimo terceiro nem rescisão. Errar imposto de terceiro é
 * risco jurídico do cliente, e a contabilidade dele já faz isso — o papel
 * daqui é entregar o dia a dia organizado e, no fim do mês, os números
 * prontos para quem fecha a folha.
 *
 * A pessoa mora em DUAS tabelas de propósito:
 *
 *   `pesquisa_atendentes` — nome, apelido, função, ativo. É infraestrutura
 *   compartilhada da casa (a pesquisa usa para atribuir a nota; o cardápio,
 *   para escolher o garçom da mesa). Já existia antes do RH.
 *
 *   `rh_fichas` — CPF, admissão, salário, desligamento. É deste módulo.
 *
 * Por isso quem é admitido aqui já aparece como opção de garçom no cardápio,
 * sem ninguém recadastrar — e a casa que não contratou RH continua com a
 * lista leve de sempre, sem enxergar ficha nenhuma.
 */

export class ErroDoRh extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDoRh";
  }
}

// As tabelas do RH não estão em `database.types.ts` — os tipos só são
// regerados depois que a migração roda no Supabase. Mesmo caminho do CMV e
// do cardápio: tabela inteira nova, não uma coluna aqui e outra ali.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

const BALDE_RH = "rh";

/** Quanto tempo o endereço de um documento vale. Curto: é RG e atestado. */
const SEGUNDOS_DO_LINK = 300;

/** O mesmo teto do balde no Supabase: passar disso, o upload morreria lá. */
export const LIMITE_DOCUMENTO_BYTES = 20 * 1024 * 1024;

/** "Este objeto ainda não existe" vira uma mensagem que o dono entende. */
function falhar(status: number, contexto: string, mensagem: string): never {
  if (ehMigracaoPendente(mensagem)) {
    throw new ErroDoRh(
      503,
      `${contexto}: o banco ainda não recebeu a migração do RH. Rode o SQL e tente de novo.`,
    );
  }
  throw new ErroDoRh(status, `${contexto}: ${mensagem}`);
}

// ============================================================
// Tipos
// ============================================================

export const VINCULOS = [
  { id: "clt", nome: "CLT" },
  { id: "mei", nome: "MEI" },
  { id: "diarista", nome: "Diarista" },
  { id: "freelancer", nome: "Freelancer" },
  { id: "estagio", nome: "Estágio" },
  { id: "socio", nome: "Sócio" },
] as const;

const IDS_DE_VINCULO = new Set<string>(VINCULOS.map((v) => v.id));

export const TIPOS_DE_DOCUMENTO = [
  { id: "rg", nome: "RG" },
  { id: "cpf", nome: "CPF" },
  { id: "ctps", nome: "Carteira de trabalho" },
  { id: "comprovante_endereco", nome: "Comprovante de endereço" },
  { id: "exame_admissional", nome: "Exame admissional" },
  { id: "exame_periodico", nome: "Exame periódico" },
  { id: "exame_demissional", nome: "Exame demissional" },
  { id: "aso", nome: "ASO" },
  { id: "atestado", nome: "Atestado" },
  { id: "contrato", nome: "Contrato" },
  { id: "foto", nome: "Foto" },
  { id: "outro", nome: "Outro" },
] as const;

const IDS_DE_DOCUMENTO = new Set<string>(TIPOS_DE_DOCUMENTO.map((t) => t.id));

export const FORMAS_DE_PAGAMENTO = ["pix", "dinheiro", "transferencia"] as const;

export interface Ficha {
  atendente_id: string;
  nome_completo: string | null;
  cpf: string | null;
  rg: string | null;
  nascimento: string | null;
  telefone: string | null;
  endereco: string | null;
  vinculo: string;
  cargo: string | null;
  admissao: string | null;
  desligamento: string | null;
  motivo_desligamento: string | null;
  salario: number | null;
  forma_pagamento: string | null;
  chave_pix: string | null;
  banco: string | null;
  emergencia_nome: string | null;
  emergencia_telefone: string | null;
  observacoes: string | null;
}

export interface PessoaDoRh {
  id: string;
  nome: string;
  apelido: string | null;
  funcao: string | null;
  ativo: boolean;
  ficha: Ficha | null;
  /** Quantos documentos vencem nos próximos 30 dias (ou já venceram). */
  documentos_alerta: number;
  /** O que falta para a admissão ficar completa. */
  pendencias: string[];
}

export interface DocumentoDoRh {
  id: string;
  tipo: string;
  titulo: string | null;
  content_type: string | null;
  tamanho_bytes: number | null;
  validade: string | null;
  enviado_em: string;
  enviado_por: string | null;
  /** Dias até vencer. Negativo = venceu. null = documento sem validade. */
  dias_para_vencer: number | null;
}

// ============================================================
// Conferências
// ============================================================

export function apenasDigitos(texto: string | null | undefined): string {
  return String(texto ?? "").replace(/\D/g, "");
}

/**
 * O CPF fecha na conta dos dígitos verificadores?
 *
 * Não é frescura: CPF digitado errado só aparece meses depois, quando a
 * contabilidade tenta usar. Conferir na hora custa nada.
 */
export function cpfValido(bruto: string | null | undefined): boolean {
  const cpf = apenasDigitos(bruto);
  if (cpf.length !== 11) return false;
  // 111.111.111-11 e afins passam na conta, mas não existem.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  for (const [ate, posicao] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(cpf[i]) * (posicao - i);
    const resto = (soma * 10) % 11;
    const digito = resto === 10 ? 0 : resto;
    if (digito !== Number(cpf[ate])) return false;
  }
  return true;
}

/** "2026-09-10" ou null. Data impossível vira erro, não linha torta no banco. */
export function dataOuNulo(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const texto = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    throw new ErroDoRh(400, `${campo}: use o formato dia/mês/ano.`);
  }
  const data = new Date(`${texto}T12:00:00Z`);
  if (Number.isNaN(data.getTime())) throw new ErroDoRh(400, `${campo}: data inválida.`);
  return texto;
}

function textoOuNulo(valor: unknown): string | null {
  const t = String(valor ?? "").trim();
  return t ? t : null;
}

/**
 * Documento obrigatório por tipo de vínculo.
 *
 * Diarista de fim de semana não tem carteira assinada nem exame admissional —
 * cobrar isso dele só ensina a equipe a ignorar o aviso. Cada vínculo cobra o
 * que de fato precisa.
 */
const DOCUMENTOS_OBRIGATORIOS: Record<string, string[]> = {
  clt: ["rg", "cpf", "ctps", "comprovante_endereco", "exame_admissional"],
  mei: ["cpf", "contrato"],
  estagio: ["rg", "cpf", "contrato"],
  socio: ["rg", "cpf"],
  diarista: ["rg", "cpf"],
  freelancer: ["rg", "cpf"],
};

const NOME_DO_DOCUMENTO = new Map<string, string>(TIPOS_DE_DOCUMENTO.map((t) => [t.id, t.nome]));

/**
 * O que falta para a admissão estar completa.
 *
 * É a "admissão guiada": em vez de uma tela com trinta campos vazios, o
 * gestor vê a lista curta do que ainda precisa pedir para a pessoa.
 */
export function pendenciasDaFicha(
  ficha: Ficha | null,
  documentos: Array<{ tipo: string }>,
): string[] {
  if (!ficha) return ["Ficha ainda não preenchida"];
  // Quem saiu não tem pendência de admissão: cobrar exame de ex-funcionário
  // é ruído puro na tela.
  if (ficha.desligamento) return [];

  const faltando: string[] = [];
  if (!ficha.cpf) faltando.push("CPF");
  if (!ficha.admissao) faltando.push("Data de admissão");
  if (!ficha.telefone) faltando.push("Telefone");

  const enviados = new Set(documentos.map((d) => d.tipo));
  for (const tipo of DOCUMENTOS_OBRIGATORIOS[ficha.vinculo] ?? []) {
    if (!enviados.has(tipo)) faltando.push(NOME_DO_DOCUMENTO.get(tipo) ?? tipo);
  }
  return faltando;
}

/** Dias entre hoje e a validade. Negativo = já venceu. */
export function diasParaVencer(validade: string | null, hoje = new Date()): number | null {
  if (!validade) return null;
  const alvo = new Date(`${validade}T12:00:00Z`).getTime();
  const base = new Date(
    `${hoje.toISOString().slice(0, 10)}T12:00:00Z`,
  ).getTime();
  return Math.round((alvo - base) / 86_400_000);
}

/** Vence dentro de 30 dias — ou já venceu. */
export function estaEmAlerta(validade: string | null, hoje = new Date()): boolean {
  const dias = diasParaVencer(validade, hoje);
  return dias !== null && dias <= 30;
}

// ============================================================
// Leitura
// ============================================================

export async function listarPessoas(
  venueId: string,
  { incluirDesligados = false } = {},
): Promise<PessoaDoRh[]> {
  const { data: atendentes, error } = await cliente()
    .from("pesquisa_atendentes")
    .select("id, nome, apelido, funcao, ativo")
    .eq("venue_id", venueId)
    .order("nome", { ascending: true });
  if (error) falhar(500, "Falha ao listar a equipe", error.message);

  const pessoas = (atendentes ?? []) as Array<{
    id: string;
    nome: string;
    apelido: string | null;
    funcao: string | null;
    ativo: boolean;
  }>;
  if (pessoas.length === 0) return [];

  const ids = pessoas.map((p) => p.id);

  const { data: fichas, error: erroFicha } = await cliente()
    .from("rh_fichas")
    .select("*")
    .eq("venue_id", venueId)
    .in("atendente_id", ids);
  if (erroFicha) falhar(500, "Falha ao ler as fichas", erroFicha.message);

  const { data: docs, error: erroDoc } = await cliente()
    .from("rh_documentos")
    .select("atendente_id, tipo, validade")
    .eq("venue_id", venueId)
    .in("atendente_id", ids);
  if (erroDoc) falhar(500, "Falha ao ler os documentos", erroDoc.message);

  const porPessoa = new Map<string, Ficha>();
  for (const f of (fichas ?? []) as Ficha[]) porPessoa.set(f.atendente_id, f);

  const documentosDe = new Map<string, Array<{ tipo: string; validade: string | null }>>();
  for (const d of (docs ?? []) as Array<{ atendente_id: string; tipo: string; validade: string | null }>) {
    const lista = documentosDe.get(d.atendente_id) ?? [];
    lista.push({ tipo: d.tipo, validade: d.validade });
    documentosDe.set(d.atendente_id, lista);
  }

  const agora = new Date();
  return pessoas
    .map((p) => {
      const ficha = porPessoa.get(p.id) ?? null;
      const meus = documentosDe.get(p.id) ?? [];
      return {
        ...p,
        ficha,
        documentos_alerta: meus.filter((d) => estaEmAlerta(d.validade, agora)).length,
        pendencias: pendenciasDaFicha(ficha, meus),
      };
    })
    .filter((p) => incluirDesligados || !p.ficha?.desligamento);
}

export async function verPessoa(
  venueId: string,
  atendenteId: string,
): Promise<{ pessoa: PessoaDoRh; documentos: DocumentoDoRh[] }> {
  const { data: atendente, error } = await cliente()
    .from("pesquisa_atendentes")
    .select("id, nome, apelido, funcao, ativo")
    .eq("venue_id", venueId)
    .eq("id", atendenteId)
    .maybeSingle();
  if (error) falhar(500, "Falha ao abrir a ficha", error.message);
  if (!atendente) throw new ErroDoRh(404, "Essa pessoa não está no cadastro desta casa.");

  const { data: ficha, error: erroFicha } = await cliente()
    .from("rh_fichas")
    .select("*")
    .eq("venue_id", venueId)
    .eq("atendente_id", atendenteId)
    .maybeSingle();
  if (erroFicha) falhar(500, "Falha ao ler a ficha", erroFicha.message);

  const documentos = await listarDocumentos(venueId, atendenteId);
  const agora = new Date();

  return {
    pessoa: {
      ...(atendente as { id: string; nome: string; apelido: string | null; funcao: string | null; ativo: boolean }),
      ficha: (ficha ?? null) as Ficha | null,
      documentos_alerta: documentos.filter((d) => estaEmAlerta(d.validade, agora)).length,
      pendencias: pendenciasDaFicha((ficha ?? null) as Ficha | null, documentos),
    },
    documentos,
  };
}

export async function listarDocumentos(venueId: string, atendenteId: string): Promise<DocumentoDoRh[]> {
  const { data, error } = await cliente()
    .from("rh_documentos")
    .select("id, tipo, titulo, content_type, tamanho_bytes, validade, enviado_em, enviado_por")
    .eq("venue_id", venueId)
    .eq("atendente_id", atendenteId)
    .order("enviado_em", { ascending: false });
  if (error) falhar(500, "Falha ao listar os documentos", error.message);

  const agora = new Date();
  return ((data ?? []) as Omit<DocumentoDoRh, "dias_para_vencer">[]).map((d) => ({
    ...d,
    dias_para_vencer: diasParaVencer(d.validade, agora),
  }));
}

/** O cabeçalho da tela: o que o gestor precisa ver antes de abrir qualquer ficha. */
export async function resumoDoRh(venueId: string): Promise<{
  ativos: number;
  desligados: number;
  com_pendencia: number;
  documentos_em_alerta: number;
}> {
  const pessoas = await listarPessoas(venueId, { incluirDesligados: true });
  const naCasa = pessoas.filter((p) => !p.ficha?.desligamento);
  return {
    ativos: naCasa.length,
    desligados: pessoas.length - naCasa.length,
    com_pendencia: naCasa.filter((p) => p.pendencias.length > 0).length,
    documentos_em_alerta: naCasa.reduce((soma, p) => soma + p.documentos_alerta, 0),
  };
}

// ============================================================
// Escrita
// ============================================================

interface CamposDaFicha {
  nome_completo?: unknown;
  cpf?: unknown;
  rg?: unknown;
  nascimento?: unknown;
  telefone?: unknown;
  endereco?: unknown;
  vinculo?: unknown;
  cargo?: unknown;
  admissao?: unknown;
  salario?: unknown;
  forma_pagamento?: unknown;
  chave_pix?: unknown;
  banco?: unknown;
  emergencia_nome?: unknown;
  emergencia_telefone?: unknown;
  observacoes?: unknown;
  experiencia_primeiro?: unknown;
  experiencia_segundo?: unknown;
}

/**
 * Só os campos que vieram viram mudança — o resto fica como está.
 *
 * Exportada porque é aqui que mora a conferência do que entra na ficha (CPF,
 * salário, vínculo, forma de pagamento), e isso se testa sem banco.
 */
export function montarFicha(campos: CamposDaFicha): Record<string, unknown> {
  const linha: Record<string, unknown> = {};
  for (const [campo, limpar] of Object.entries(LIMPEZA_DO_CAMPO)) {
    if (!(campo in campos)) continue;
    const valor = limpar((campos as Record<string, unknown>)[campo]);
    // `undefined` é o jeito de um campo dizer "não mexa em mim".
    if (valor !== undefined) linha[campo] = valor;
  }
  return linha;
}

/**
 * Como cada campo da ficha entra no banco.
 *
 * Uma tabela em vez de trinta `if`: campo novo é uma linha aqui, e o que
 * confere cada tipo de dado fica num lugar só.
 */
const LIMPEZA_DO_CAMPO: Record<string, (valor: unknown) => unknown> = {
  nome_completo: textoOuNulo,
  rg: textoOuNulo,
  endereco: textoOuNulo,
  cargo: textoOuNulo,
  chave_pix: textoOuNulo,
  banco: textoOuNulo,
  emergencia_nome: textoOuNulo,
  observacoes: textoOuNulo,

  telefone: (v) => apenasDigitos(v as string) || null,
  emergencia_telefone: (v) => apenasDigitos(v as string) || null,

  nascimento: (v) => dataOuNulo(v, "Nascimento"),
  admissao: (v) => dataOuNulo(v, "Admissão"),

  cpf: (v) => {
    const cpf = apenasDigitos(v as string);
    if (cpf && !cpfValido(cpf)) throw new ErroDoRh(400, "Esse CPF não é válido — confira os números.");
    return cpf || null;
  },

  vinculo: (v) => {
    const vinculo = String(v ?? "").trim();
    // Campo que veio vazio não vira vínculo nulo: a coluna é obrigatória e
    // tem 'clt' como padrão. Vazio aqui significa "não mexa".
    if (!vinculo) return undefined;
    if (!IDS_DE_VINCULO.has(vinculo)) throw new ErroDoRh(400, "Tipo de vínculo desconhecido.");
    return vinculo;
  },

  salario: (v) => {
    if (v === null || v === undefined || v === "") return null;
    const valor = Number(v);
    if (!Number.isFinite(valor) || valor < 0) throw new ErroDoRh(400, "Salário inválido.");
    return valor;
  },

  // Os dois períodos do contrato de experiência (CLT: até 90 dias somados).
  experiencia_primeiro: (v) => diasDeExperiencia(v),
  experiencia_segundo: (v) => diasDeExperiencia(v),

  forma_pagamento: (v) => {
    const forma = textoOuNulo(v);
    if (forma && !FORMAS_DE_PAGAMENTO.includes(forma as (typeof FORMAS_DE_PAGAMENTO)[number])) {
      throw new ErroDoRh(400, "Forma de pagamento desconhecida.");
    }
    return forma;
  },
};

function diasDeExperiencia(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 90) throw new ErroDoRh(400, "O período de experiência vai de 0 a 90 dias.");
  return n;
}

/**
 * Admite alguém: cria a pessoa no cadastro da casa e abre a ficha.
 *
 * Quem já está no cadastro (a lista de atendentes que a pesquisa e o cardápio
 * usam) não é recriado — a ficha é aberta em cima de quem já existe, via
 * `atendente_id`.
 */
export async function admitir(params: {
  venueId: string;
  nome: string;
  apelido?: string | null;
  funcao?: string | null;
  ficha?: CamposDaFicha;
}): Promise<{ atendente_id: string }> {
  const nome = String(params.nome ?? "").trim();
  if (!nome) throw new ErroDoRh(400, "O nome é obrigatório.");

  const { data, error } = await cliente()
    .from("pesquisa_atendentes")
    .insert({
      venue_id: params.venueId,
      nome,
      apelido: textoOuNulo(params.apelido),
      funcao: textoOuNulo(params.funcao),
    } as never)
    .select("id")
    .single();

  if (error) {
    if (/duplicate key|unique/i.test(error.message)) {
      throw new ErroDoRh(
        409,
        `"${nome}" já está no cadastro da casa — abra a ficha dele em vez de cadastrar de novo.`,
      );
    }
    falhar(500, "Falha ao admitir", error.message);
  }

  const atendenteId = (data as { id: string }).id;
  await salvarFicha({ venueId: params.venueId, atendenteId, campos: params.ficha ?? {} });
  return { atendente_id: atendenteId };
}

/** Grava a ficha (cria na primeira vez) e os campos que também vivem no cadastro. */
export async function salvarFicha(params: {
  venueId: string;
  atendenteId: string;
  campos: CamposDaFicha;
  cadastro?: { nome?: string; apelido?: string | null; funcao?: string | null; ativo?: boolean };
}): Promise<Ficha> {
  if (params.cadastro && Object.keys(params.cadastro).length > 0) {
    const mudancas: Record<string, unknown> = {};
    if (params.cadastro.nome !== undefined) {
      const nome = params.cadastro.nome.trim();
      if (!nome) throw new ErroDoRh(400, "O nome não pode ficar vazio.");
      mudancas.nome = nome;
    }
    if (params.cadastro.apelido !== undefined) mudancas.apelido = textoOuNulo(params.cadastro.apelido);
    if (params.cadastro.funcao !== undefined) mudancas.funcao = textoOuNulo(params.cadastro.funcao);
    if (params.cadastro.ativo !== undefined) mudancas.ativo = params.cadastro.ativo;

    const { error } = await cliente()
      .from("pesquisa_atendentes")
      .update(mudancas as never)
      .eq("id", params.atendenteId)
      .eq("venue_id", params.venueId);
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        throw new ErroDoRh(409, "Já existe alguém com esse nome no cadastro da casa.");
      }
      falhar(500, "Falha ao salvar o cadastro", error.message);
    }
  }

  const linha = montarFicha(params.campos);
  const { data, error } = await cliente()
    .from("rh_fichas")
    .upsert(
      { venue_id: params.venueId, atendente_id: params.atendenteId, ...linha } as never,
      { onConflict: "atendente_id" },
    )
    .select("*")
    .single();

  if (error) {
    if (/duplicate key|unique/i.test(error.message) && /cpf/i.test(error.message)) {
      throw new ErroDoRh(409, "Esse CPF já está em outra ficha desta casa.");
    }
    falhar(500, "Falha ao salvar a ficha", error.message);
  }
  return data as Ficha;
}

/**
 * Desliga: guarda data e motivo, e apaga a pessoa das listas do dia a dia.
 *
 * A ficha FICA. Obrigação trabalhista se guarda por anos, e "quem trabalhou
 * aqui em 2024" é pergunta que aparece — de fiscal, de advogado ou do próprio
 * ex-funcionário pedindo declaração.
 */
export async function desligar(params: {
  venueId: string;
  atendenteId: string;
  data?: unknown;
  motivo?: unknown;
}): Promise<Ficha> {
  const quando = dataOuNulo(params.data, "Data do desligamento") ?? new Date().toISOString().slice(0, 10);

  const { data, error } = await cliente()
    .from("rh_fichas")
    .upsert(
      {
        venue_id: params.venueId,
        atendente_id: params.atendenteId,
        desligamento: quando,
        motivo_desligamento: textoOuNulo(params.motivo),
      } as never,
      { onConflict: "atendente_id" },
    )
    .select("*")
    .single();
  if (error) falhar(500, "Falha ao registrar o desligamento", error.message);

  // Sai das listas de quem atende: garçom desligado não pode continuar
  // aparecendo para escolher na mesa.
  const { error: erroCadastro } = await cliente()
    .from("pesquisa_atendentes")
    .update({ ativo: false } as never)
    .eq("id", params.atendenteId)
    .eq("venue_id", params.venueId);
  if (erroCadastro) falhar(500, "Falha ao desativar no cadastro", erroCadastro.message);

  return data as Ficha;
}

/** Voltou a trabalhar na casa. Acontece muito em bar. */
export async function readmitir(params: {
  venueId: string;
  atendenteId: string;
  admissao?: unknown;
}): Promise<Ficha> {
  const linha: Record<string, unknown> = {
    venue_id: params.venueId,
    atendente_id: params.atendenteId,
    desligamento: null,
    motivo_desligamento: null,
  };
  const nova = dataOuNulo(params.admissao, "Admissão");
  if (nova) linha.admissao = nova;

  const { data, error } = await cliente()
    .from("rh_fichas")
    .upsert(linha as never, { onConflict: "atendente_id" })
    .select("*")
    .single();
  if (error) falhar(500, "Falha ao readmitir", error.message);

  const { error: erroCadastro } = await cliente()
    .from("pesquisa_atendentes")
    .update({ ativo: true } as never)
    .eq("id", params.atendenteId)
    .eq("venue_id", params.venueId);
  if (erroCadastro) falhar(500, "Falha ao reativar no cadastro", erroCadastro.message);

  return data as Ficha;
}

// ============================================================
// Documentos — balde privado
// ============================================================

const FORMATOS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function extensaoDoArquivo(contentType: string | null | undefined): string | null {
  const tipo = String(contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return FORMATOS[tipo] ?? null;
}

export async function guardarDocumento(params: {
  venueId: string;
  atendenteId: string;
  arquivo: Buffer;
  contentType: string;
  tipo?: string;
  titulo?: string | null;
  validade?: unknown;
  enviadoPor?: string | null;
}): Promise<DocumentoDoRh> {
  const extensao = extensaoDoArquivo(params.contentType);
  if (!extensao) throw new ErroDoRh(400, "Mande o documento em PDF, JPG, PNG ou WEBP.");
  if (params.arquivo.length === 0) throw new ErroDoRh(400, "O arquivo chegou vazio.");
  if (params.arquivo.length > LIMITE_DOCUMENTO_BYTES) {
    throw new ErroDoRh(400, "O arquivo precisa ter no máximo 20 MB.");
  }

  const tipo = String(params.tipo ?? "outro");
  if (!IDS_DE_DOCUMENTO.has(tipo)) {
    throw new ErroDoRh(400, "Tipo de documento desconhecido.");
  }
  const validade = dataOuNulo(params.validade, "Validade");

  // O caminho não carrega o nome da pessoa: quem olhar a listagem do balde
  // não descobre de quem é o atestado.
  const caminho = `${params.venueId}/${params.atendenteId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensao}`;

  const { error: erroUpload } = await db()
    .storage.from(BALDE_RH)
    .upload(caminho, params.arquivo, { contentType: params.contentType, upsert: false });
  if (erroUpload) {
    if (/bucket not found/i.test(erroUpload.message)) {
      throw new ErroDoRh(503, "O balde de documentos do RH ainda não existe. Rode a migração do RH.");
    }
    throw new ErroDoRh(500, `Falha ao guardar o documento: ${erroUpload.message}`);
  }

  const { data, error } = await cliente()
    .from("rh_documentos")
    .insert({
      venue_id: params.venueId,
      atendente_id: params.atendenteId,
      tipo,
      titulo: textoOuNulo(params.titulo),
      caminho,
      content_type: params.contentType,
      tamanho_bytes: params.arquivo.length,
      validade,
      enviado_por: textoOuNulo(params.enviadoPor),
    } as never)
    .select("id, tipo, titulo, content_type, tamanho_bytes, validade, enviado_em, enviado_por")
    .single();

  if (error) {
    // O registro falhou: o arquivo sozinho no balde é lixo que ninguém acha.
    await db().storage.from(BALDE_RH).remove([caminho]).catch(() => undefined);
    falhar(500, "Falha ao registrar o documento", error.message);
  }

  const linha = data as Omit<DocumentoDoRh, "dias_para_vencer">;
  return { ...linha, dias_para_vencer: diasParaVencer(linha.validade) };
}

/**
 * Endereço temporário para abrir o documento.
 *
 * Nunca há link público: o balde é privado e o endereço expira em minutos.
 * Assim um link copiado por engano no WhatsApp não vira RG exposto para
 * sempre.
 */
export async function linkDoDocumento(params: { venueId: string; id: string }): Promise<{ url: string }> {
  const { data, error } = await cliente()
    .from("rh_documentos")
    .select("caminho")
    .eq("venue_id", params.venueId)
    .eq("id", params.id)
    .maybeSingle();
  if (error) falhar(500, "Falha ao abrir o documento", error.message);
  if (!data) throw new ErroDoRh(404, "Documento não encontrado.");

  const { data: assinado, error: erroLink } = await db()
    .storage.from(BALDE_RH)
    .createSignedUrl((data as { caminho: string }).caminho, SEGUNDOS_DO_LINK);
  if (erroLink || !assinado) {
    throw new ErroDoRh(500, `Falha ao abrir o documento: ${erroLink?.message ?? "sem endereço"}`);
  }
  return { url: assinado.signedUrl };
}

export async function apagarDocumento(params: { venueId: string; id: string }): Promise<{ apagado: boolean }> {
  const { data, error } = await cliente()
    .from("rh_documentos")
    .select("caminho")
    .eq("venue_id", params.venueId)
    .eq("id", params.id)
    .maybeSingle();
  if (error) falhar(500, "Falha ao apagar o documento", error.message);
  if (!data) return { apagado: false };

  const { error: erroApagar } = await cliente()
    .from("rh_documentos")
    .delete()
    .eq("venue_id", params.venueId)
    .eq("id", params.id);
  if (erroApagar) falhar(500, "Falha ao apagar o documento", erroApagar.message);

  // O arquivo sai depois do registro: sobra no balde custa bytes, registro
  // apontando para arquivo que não existe custa uma tela quebrada.
  await db()
    .storage.from(BALDE_RH)
    .remove([(data as { caminho: string }).caminho])
    .catch((e: Error) => console.error(`[rh] arquivo não saiu do balde: ${e.message}`));

  return { apagado: true };
}
