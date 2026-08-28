import { db } from "./supabase.js";

/**
 * A base de clientes da casa.
 *
 * Até aqui o cliente existia espalhado: um telefone na resposta da pesquisa,
 * um nome na conversa do agente, um CPF na Zig, um nome numa reserva. Cada
 * pedaço servia à tela que o gerou e a nenhuma outra — e "quem são meus
 * clientes?" não tinha onde ser respondida.
 *
 * Uma linha por PESSOA, por casa, com o telefone como chave: é o único dado
 * que todas as fontes têm, é o que o WhatsApp entende, e é por ele que a
 * pessoa é reconhecida quando volta.
 *
 * Não depende de módulo nenhum. Uma casa que só comprou o CMV cadastra
 * clientes na mão e manda parabéns; quem tem Zig e agente vê a base encher
 * sozinha. É a mesma regra da colmeia: módulo não puxa módulo.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// Sem os tipos gerados: a tabela é nova e `database.types.ts` só é regerado
// depois que a migração roda em produção. Mesma decisão da pesquisa e do CMV.
const cliente = () => db() as any;

export class ErroDeClientes extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export type OrigemDeCliente = "manual" | "zig" | "agente" | "pesquisa" | "planilha";

export interface Cliente {
  id: string;
  telefone: string;
  nome: string | null;
  nascimento_dia: number | null;
  nascimento_mes: number | null;
  nascimento_ano: number | null;
  email: string | null;
  documento: string | null;
  observacoes: string | null;
  origens: OrigemDeCliente[];
  visitas: number;
  gasto_total_centavos: number;
  ultima_visita: string | null;
  descadastrado_em: string | null;
  criado_em: string;
}

/**
 * O telefone como a base guarda: só dígitos, com o 55 na frente.
 *
 * Normalizar na ENTRADA é o que faz "(65) 99999-0000", "65999990000" e
 * "+55 65 99999-0000" serem a mesma pessoa. Sem isto a mesma cliente vira
 * três linhas e recebe três parabéns.
 */
export function telefoneDaBase(bruto: string): string | null {
  let digitos = (bruto ?? "").replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
  if (digitos.length < 12 || digitos.length > 15) return null;
  return digitos;
}

/**
 * Dia e mês de uma data que pode chegar de vários jeitos.
 *
 * A Zig manda "1990-01-01"; o gerente digita "01/01/1990" ou só "01/01".
 * Recusar por causa do formato transformaria um detalhe em suporte.
 */
export function lerNascimento(bruto: string | null | undefined): {
  dia: number | null;
  mes: number | null;
  ano: number | null;
} {
  const vazio = { dia: null, mes: null, ano: null };
  const t = (bruto ?? "").trim();
  if (!t) return vazio;

  // AAAA-MM-DD (o formato da Zig e do banco) ou DD/MM/AAAA e DD/MM (o que o
  // gerente digita). Um só ponto de saída para os dois: o resto da regra —
  // dia possível, mês possível, ano plausível — vale igual para ambos.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(t);
  const br = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(t);
  if (!iso && !br) return vazio;

  const dia = Number(iso ? iso[3] : br![1]);
  const mes = Number(iso ? iso[2] : br![2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return vazio;

  const cru = iso ? iso[1] : br![3];
  return { dia, mes, ano: anoPlausivel(cru) };
}

/**
 * O ano, quando ele veio e faz sentido.
 *
 * "90" é 1990, não o ano 90: dois dígitos acima do ano corrente viram século
 * passado, porque ninguém cadastra cliente que ainda vai nascer.
 */
function anoPlausivel(cru: string | undefined): number | null {
  if (!cru) return null;
  let ano = Number(cru);
  if (ano < 100) ano += ano > new Date().getFullYear() % 100 ? 1900 : 2000;
  return ano >= 1900 && ano <= 2100 ? ano : null;
}

/** Um valor que vale a pena gravar: texto com conteúdo, e não espaço em branco. */
const util = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

export interface DadosDoCliente {
  telefone: string;
  nome?: string | null;
  nascimento?: string | null;
  email?: string | null;
  documento?: string | null;
  observacoes?: string | null;
  /** Só cresce com o que a fonte realmente sabe. */
  visitas?: number;
  gastoCentavos?: number;
  ultimaVisita?: string | null;
}

/**
 * Grava (ou atualiza) uma pessoa na base.
 *
 * A regra que rege tudo aqui: **dado bom nunca é sobrescrito por vazio**. A
 * Zig manda nome e nascimento; a conversa do agente manda só o telefone. Se
 * a conversa apagasse o que a Zig soube, a base pioraria a cada mensagem
 * recebida — o oposto do que uma base de clientes deve fazer.
 *
 * As origens se SOMAM: quem veio da Zig e depois conversou com o agente é o
 * mesmo cliente, e saber que ele apareceu nas duas pontas vale mais que
 * escolher uma.
 */
export async function registrarCliente(
  venueId: string,
  origem: OrigemDeCliente,
  dados: DadosDoCliente,
): Promise<Cliente> {
  const telefone = telefoneDaBase(dados.telefone);
  if (!telefone) {
    throw new ErroDeClientes(400, `"${dados.telefone}" não parece um telefone com DDD.`);
  }

  const { data: atual } = await cliente()
    .from("clientes")
    .select("*")
    .eq("venue_id", venueId)
    .eq("telefone", telefone)
    .maybeSingle();

  const nasc = lerNascimento(dados.nascimento);
  const origens = new Set<string>([...(atual?.origens ?? []), origem]);

  // `manter` e não `||`: o que já está gravado só cede lugar a um valor de
  // verdade. É esta linha que impede a conversa do agente (que só tem o
  // telefone) de apagar o nome que a Zig trouxe.
  const manter = <T>(novo: T | null | undefined, velho: T | null | undefined): T | null =>
    novo ?? velho ?? null;

  const linha: Record<string, unknown> = {
    venue_id: venueId,
    telefone,
    origens: [...origens],
    atualizado_em: new Date().toISOString(),
    nome: manter(util(dados.nome), atual?.nome),
    email: manter(util(dados.email), atual?.email),
    documento: manter(util(dados.documento), atual?.documento),
    observacoes: manter(util(dados.observacoes), atual?.observacoes),
    nascimento_dia: manter(nasc.dia, atual?.nascimento_dia),
    nascimento_mes: manter(nasc.mes, atual?.nascimento_mes),
    nascimento_ano: manter(nasc.ano, atual?.nascimento_ano),
  };

  // Movimento é acumulado, não substituído: cada visita soma à anterior.
  if (dados.visitas !== undefined) {
    linha.visitas = Number(atual?.visitas ?? 0) + Math.max(0, dados.visitas);
  }
  if (dados.gastoCentavos !== undefined) {
    linha.gasto_total_centavos =
      Number(atual?.gasto_total_centavos ?? 0) + Math.max(0, dados.gastoCentavos);
  }
  // A última visita só anda para frente: um dia antigo chegando atrasado
  // (venda offline que sincronizou depois) não pode rejuvenescer o cadastro.
  if (dados.ultimaVisita) {
    linha.ultima_visita =
      dados.ultimaVisita > (atual?.ultima_visita ?? "") ? dados.ultimaVisita : atual?.ultima_visita;
  }

  const { data, error } = await cliente()
    .from("clientes")
    .upsert(linha as never, { onConflict: "venue_id,telefone" })
    .select("*")
    .single();
  if (error) throw new ErroDeClientes(500, `Falha ao gravar o cliente: ${error.message}`);
  return data as Cliente;
}

/**
 * Registra sem deixar a falha subir.
 *
 * Usado pelas fontes automáticas (conversa do agente, resposta de pesquisa):
 * alimentar a base é acessório, e acessório não derruba o essencial. O
 * cliente ser atendido importa mais do que o cadastro dele existir.
 */
export async function registrarClienteSeDer(
  venueId: string,
  origem: OrigemDeCliente,
  dados: DadosDoCliente,
): Promise<void> {
  try {
    await registrarCliente(venueId, origem, dados);
  } catch (e) {
    // Tabela ainda sem migração também cai aqui, e em silêncio de propósito.
    if (!/clientes|42P01|PGRST/i.test((e as Error).message)) {
      console.error(`[clientes] não registrei ${dados.telefone}: ${(e as Error).message}`);
    }
  }
}

export interface FiltroDeClientes {
  busca?: string;
  origem?: OrigemDeCliente;
  /** Só quem tem dia e mês de nascimento — a lista que o parabéns usa. */
  comAniversario?: boolean;
  mes?: number;
  limite?: number;
}

export async function listarClientes(
  venueId: string,
  filtro: FiltroDeClientes = {},
): Promise<Cliente[]> {
  let busca = cliente().from("clientes").select("*").eq("venue_id", venueId);

  if (filtro.busca?.trim()) {
    const t = filtro.busca.trim();
    // Nome OU telefone: o gerente às vezes lembra do nome, às vezes tem só
    // o número que apareceu no WhatsApp.
    const digitos = t.replace(/\D/g, "");
    busca = digitos.length >= 4
      ? busca.or(`nome.ilike.%${t}%,telefone.ilike.%${digitos}%`)
      : busca.ilike("nome", `%${t}%`);
  }
  if (filtro.origem) busca = busca.contains("origens", [filtro.origem]);
  if (filtro.comAniversario) busca = busca.not("nascimento_dia", "is", null);
  if (filtro.mes) busca = busca.eq("nascimento_mes", filtro.mes);

  const { data, error } = await busca
    .order("ultima_visita", { ascending: false, nullsFirst: false })
    .order("criado_em", { ascending: false })
    .limit(Math.min(filtro.limite ?? 200, 1000));
  if (error) throw new ErroDeClientes(500, `Falha ao listar os clientes: ${error.message}`);
  return (data ?? []) as Cliente[];
}

export async function obterCliente(venueId: string, id: string): Promise<Cliente> {
  const { data, error } = await cliente()
    .from("clientes")
    .select("*")
    .eq("venue_id", venueId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ErroDeClientes(500, `Falha ao abrir o cliente: ${error.message}`);
  if (!data) throw new ErroDeClientes(404, "Cliente não encontrado.");
  return data as Cliente;
}

/**
 * Edição pela tela.
 *
 * Aqui o vazio APAGA — ao contrário da coleta automática. É a diferença
 * entre "esta fonte não sabe" e "esta pessoa está corrigindo": quem abriu a
 * ficha e apagou o nascimento quis apagar mesmo.
 */
export async function editarCliente(
  venueId: string,
  id: string,
  campos: {
    nome?: string;
    nascimento?: string;
    email?: string;
    documento?: string;
    observacoes?: string;
    descadastrado?: boolean;
  },
): Promise<Cliente> {
  const mudancas: Record<string, unknown> = { atualizado_em: new Date().toISOString() };

  if (campos.nome !== undefined) mudancas.nome = util(campos.nome);
  if (campos.email !== undefined) mudancas.email = util(campos.email);
  if (campos.documento !== undefined) mudancas.documento = util(campos.documento);
  if (campos.observacoes !== undefined) mudancas.observacoes = util(campos.observacoes);
  if (campos.nascimento !== undefined) {
    const n = lerNascimento(campos.nascimento);
    if (campos.nascimento.trim() && n.dia === null) {
      throw new ErroDeClientes(400, `"${campos.nascimento}" não é uma data. Use 25/12 ou 25/12/1990.`);
    }
    mudancas.nascimento_dia = n.dia;
    mudancas.nascimento_mes = n.mes;
    mudancas.nascimento_ano = n.ano;
  }
  if (campos.descadastrado !== undefined) {
    mudancas.descadastrado_em = campos.descadastrado ? new Date().toISOString() : null;
  }

  const { data, error } = await cliente()
    .from("clientes")
    .update(mudancas as never)
    .eq("venue_id", venueId)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new ErroDeClientes(500, `Falha ao salvar o cliente: ${error.message}`);
  if (!data) throw new ErroDeClientes(404, "Cliente não encontrado.");
  return data as Cliente;
}

// ============================================================
// A configuração do parabéns
// ============================================================

export interface ConfigDeClientes {
  aniversario_ativo: boolean;
  aniversario_hora: number;
  aniversario_antecedencia: number;
  aniversario_texto: string | null;
  aniversario_teto_por_dia: number;
}

const CONFIG_PADRAO: ConfigDeClientes = {
  aniversario_ativo: false,
  aniversario_hora: 10,
  aniversario_antecedencia: 0,
  aniversario_texto: null,
  aniversario_teto_por_dia: 40,
};

/**
 * A configuração da casa — com o padrão quando ela nunca mexeu.
 *
 * Nunca estoura: casa sem linha, ou banco sem a migração ainda, recebe o
 * padrão desligado. Uma tela não pode quebrar por causa de configuração que
 * ninguém preencheu.
 */
export async function configDeClientes(venueId: string): Promise<ConfigDeClientes> {
  const { data, error } = await cliente()
    .from("clientes_config")
    .select("*")
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error || !data) return { ...CONFIG_PADRAO };
  return { ...CONFIG_PADRAO, ...(data as Partial<ConfigDeClientes>) };
}

export async function salvarConfigDeClientes(
  venueId: string,
  campos: Partial<ConfigDeClientes>,
): Promise<ConfigDeClientes> {
  const atual = await configDeClientes(venueId);
  // Campo ausente não é campo apagado: só o que a tela mandou muda.
  const limpo = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
  const misturado = { ...atual, ...limpo } as ConfigDeClientes;

  const { error } = await cliente()
    .from("clientes_config")
    .upsert(
      { venue_id: venueId, ...misturado, atualizado_em: new Date().toISOString() } as never,
      { onConflict: "venue_id" },
    );
  if (error) throw new ErroDeClientes(500, `Falha ao salvar a configuração: ${error.message}`);
  return misturado;
}

export async function apagarCliente(venueId: string, id: string): Promise<void> {
  const { error, count } = await cliente()
    .from("clientes")
    .delete({ count: "exact" })
    .eq("venue_id", venueId)
    .eq("id", id);
  if (error) throw new ErroDeClientes(500, `Falha ao apagar o cliente: ${error.message}`);
  if (!count) throw new ErroDeClientes(404, "Cliente não encontrado.");
}
