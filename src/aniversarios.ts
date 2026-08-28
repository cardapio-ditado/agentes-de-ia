import { db } from "./supabase.js";
import { inserirAvisos } from "./notifications.js";
import { hojeNaCasa, horaNaCasa } from "./fuso.js";
import { configDeClientes } from "./clientes.js";
import type { Cliente, ConfigDeClientes } from "./clientes.js";

/**
 * O parabéns de aniversário.
 *
 * É a mensagem mais barata que uma casa manda e a que mais volta: quem
 * lembra do aniversário do cliente é lembrado na hora de escolher onde
 * comemorar. Só que é MARKETING, não aviso operacional — e marketing tem
 * regras que o resto do sistema não tem:
 *
 *   - desligado por padrão, ligado por decisão explícita de quem responde
 *     pela casa (a LGPD cobra dela, não de nós);
 *   - quem pediu para sair não recebe, nunca mais;
 *   - teto por dia, porque WhatsApp comum disparando em rajada é WhatsApp
 *     banido — e aí a casa perde o número, não só a campanha;
 *   - UM parabéns por ano por pessoa, travado no banco e não na memória de
 *     um processo que reinicia.
 *
 * Não depende de módulo nenhum: a base de clientes é da CASA. Uma casa que
 * só comprou o CMV cadastra aniversariantes na mão e manda o parabéns.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const cliente = () => db() as any;

/** Quantas casas uma volta da varredura processa. */
const TETO_DE_CASAS = 200;

/**
 * O dia que a varredura procura hoje.
 *
 * Com antecedência 0 é o aniversário de hoje; com 3, o de daqui a três dias
 * — que é o que o dono quer quando o objetivo da mensagem é o cliente ter
 * tempo de marcar a mesa. O ano devolvido é o da COMEMORAÇÃO, não o do
 * nascimento: é ele que entra na trava de um parabéns por ano.
 */
export function diaDoParabens(
  fuso: string,
  antecedencia: number,
  agora = new Date(),
): { dia: number; mes: number; ano: number } {
  const hoje = hojeNaCasa(fuso, agora);
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.trunc(antecedencia)));
  return { dia: d.getUTCDate(), mes: d.getUTCMonth() + 1, ano: d.getUTCFullYear() };
}

/** O primeiro nome, que é como se fala com uma pessoa. */
export function primeiroNome(nome: string | null | undefined): string {
  const limpo = (nome ?? "").trim().replace(/\s+/g, " ");
  if (!limpo) return "";
  const primeiro = limpo.split(" ")[0] ?? "";
  // "MARIA" e "maria" viram "Maria": o nome vem da Zig em caixa alta com
  // frequência, e parabéns gritado não parece escrito por gente.
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

/**
 * O texto que vai sair.
 *
 * `{nome}` vira o primeiro nome e `{casa}` o nome da casa. Sem texto
 * configurado, um padrão que já cita a casa — porque mensagem de número
 * desconhecido sem dizer quem está falando é mensagem denunciada.
 */
export function textoDeParabens(
  config: Pick<ConfigDeClientes, "aniversario_texto">,
  casa: string,
  nome: string | null,
): string {
  const primeiro = primeiroNome(nome);
  const modelo =
    config.aniversario_texto?.trim() ||
    (primeiro
      ? "Oi, {nome}! Hoje é seu dia e a gente não podia deixar passar em branco. " +
        "Feliz aniversário! 🎉 Vem comemorar com a gente — {casa}."
      : "Feliz aniversário! 🎉 Hoje é seu dia e a gente não podia deixar passar " +
        "em branco. Vem comemorar com a gente — {casa}.");
  return modelo.replaceAll("{nome}", primeiro).replaceAll("{casa}", casa).trim();
}

/**
 * Quem faz aniversário no dia procurado, nesta casa.
 *
 * Descadastrado fica de fora aqui, no banco, e não num `if` depois: a lista
 * que sai desta função é a lista que recebe mensagem, e o lugar mais seguro
 * para essa regra é o mais perto do dado.
 */
export async function aniversariantesDoDia(
  venueId: string,
  dia: number,
  mes: number,
): Promise<Cliente[]> {
  const { data, error } = await cliente()
    .from("clientes")
    .select("*")
    .eq("venue_id", venueId)
    .eq("nascimento_dia", dia)
    .eq("nascimento_mes", mes)
    .is("descadastrado_em", null)
    .order("ultima_visita", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`Falha ao listar os aniversariantes: ${error.message}`);
  return (data ?? []) as Cliente[];
}

export interface Aniversariante extends Cliente {
  /** Quantos dias faltam. Zero = hoje. */
  dias_ate: number;
  /** AAAA-MM-DD da próxima comemoração. */
  proximo: string;
  /** Já recebeu o parabéns deste ano — a tela mostra e não repete. */
  ja_avisado: boolean;
}

/**
 * Quantos dias faltam para o próximo aniversário, a partir de hoje na casa.
 *
 * Aniversário que já passou este ano cai no ano que vem — é o que "faltam
 * quantos dias?" significa para uma pessoa. 29 de fevereiro em ano comum é
 * comemorado no dia 1º de março: melhor um dia depois que de quatro em
 * quatro anos.
 */
export function diasAte(
  nascDia: number,
  nascMes: number,
  hojeISO: string,
): { dias: number; proximo: string } {
  const hoje = new Date(`${hojeISO}T12:00:00Z`);
  for (const ano of [hoje.getUTCFullYear(), hoje.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(ano, nascMes - 1, nascDia, 12));
    // Date rola o excedente sozinho: 29/2 em ano comum vira 1º/3.
    if (d.getTime() < hoje.getTime()) continue;
    return {
      dias: Math.round((d.getTime() - hoje.getTime()) / 86_400_000),
      proximo: d.toISOString().slice(0, 10),
    };
  }
  /* c8 ignore next */
  return { dias: 0, proximo: hojeISO };
}

/**
 * A agenda de aniversários da casa: quem faz nos próximos N dias.
 *
 * É a tela que o gerente abre na segunda-feira para saber quem ligar. Traz
 * descadastrado também, marcado — esconder quem pediu para sair faria o
 * gerente achar que o cadastro sumiu.
 */
export async function proximosAniversariantes(
  venue: { id: string; timezone: string },
  dias = 30,
  agora = new Date(),
): Promise<Aniversariante[]> {
  const hojeISO = hojeNaCasa(venue.timezone, agora);

  const { data, error } = await cliente()
    .from("clientes")
    .select("*")
    .eq("venue_id", venue.id)
    .not("nascimento_dia", "is", null)
    .not("nascimento_mes", "is", null)
    .limit(5000);
  if (error) throw new Error(`Falha ao listar os aniversariantes: ${error.message}`);

  const proximos = ((data ?? []) as Cliente[])
    .map((c) => ({
      ...c,
      ...diasAte(c.nascimento_dia!, c.nascimento_mes!, hojeISO),
      ja_avisado: false,
    }))
    .map(({ dias: d, proximo, ...resto }) => ({ ...resto, dias_ate: d, proximo }))
    .filter((c) => c.dias_ate <= dias)
    .sort((a, b) => a.dias_ate - b.dias_ate);

  if (!proximos.length) return proximos;

  // Quem já recebeu o parabéns do ano da PRÓXIMA comemoração. Numa consulta
  // só: uma por cliente viraria centenas de idas ao banco para abrir a tela.
  const anos = [...new Set(proximos.map((c) => `aniversario_${c.proximo.slice(0, 4)}`))];
  const { data: avisados } = await cliente()
    .from("notifications")
    .select("cliente_id, template")
    .eq("venue_id", venue.id)
    .in("template", anos)
    .in("cliente_id", proximos.map((c) => c.id));

  const jaFoi = new Set(
    ((avisados ?? []) as { cliente_id: string; template: string }[]).map(
      (n) => `${n.cliente_id}|${n.template}`,
    ),
  );
  for (const c of proximos) {
    c.ja_avisado = jaFoi.has(`${c.id}|aniversario_${c.proximo.slice(0, 4)}`);
  }
  return proximos;
}

/** Quantos parabéns esta casa já enfileirou nas últimas 24 horas. */
async function parabensRecentes(venueId: string, agora: Date): Promise<number> {
  const desde = new Date(agora.getTime() - 24 * 60 * 60_000).toISOString();
  const { count, error } = await cliente()
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .like("template", "aniversario_%")
    .gte("created_at", desde);
  if (error) return 0;
  return count ?? 0;
}

export interface ResultadoDoParabens {
  /** O dia procurado, como AAAA-MM-DD. */
  dia: string;
  aniversariantes: number;
  enfileirados: number;
  /** Já tinham recebido o parabéns deste ano. */
  repetidos: number;
  sem_telefone: number;
  alem_do_teto: number;
}

/**
 * Uma volta do parabéns numa casa.
 *
 * `forcar` ignora a HORA configurada (o botão "Mandar agora" do painel), mas
 * nunca ignora a trava de um por ano nem o teto: forçar duas vezes não manda
 * duas vezes.
 */
export async function mandarParabens(
  venue: { id: string; name: string; timezone: string },
  opcoes: { agora?: Date; forcar?: boolean; config?: ConfigDeClientes } = {},
): Promise<ResultadoDoParabens> {
  const agora = opcoes.agora ?? new Date();
  const config = opcoes.config ?? (await configDeClientes(venue.id));
  const alvo = diaDoParabens(venue.timezone, config.aniversario_antecedencia, agora);
  const diaISO = `${alvo.ano}-${String(alvo.mes).padStart(2, "0")}-${String(alvo.dia).padStart(2, "0")}`;
  const vazio: ResultadoDoParabens = {
    dia: diaISO,
    aniversariantes: 0,
    enfileirados: 0,
    repetidos: 0,
    sem_telefone: 0,
    alem_do_teto: 0,
  };

  if (!config.aniversario_ativo) return vazio;
  if (!opcoes.forcar && horaNaCasa(venue.timezone, agora) < config.aniversario_hora) return vazio;

  const pessoas = await aniversariantesDoDia(venue.id, alvo.dia, alvo.mes);
  const sobra = Math.max(0, config.aniversario_teto_por_dia - (await parabensRecentes(venue.id, agora)));

  const resultado = { ...vazio, aniversariantes: pessoas.length };
  for (const p of pessoas) {
    if (!p.telefone) {
      resultado.sem_telefone += 1;
      continue;
    }
    if (resultado.enfileirados >= sobra) {
      resultado.alem_do_teto += 1;
      continue;
    }

    // O ano no template é o que faz a trava do banco permitir o parabéns do
    // ano que vem sem permitir dois no mesmo ano.
    const { error } = await inserirAvisos({
      venue_id: venue.id,
      cliente_id: p.id,
      channel: "whatsapp",
      destination: p.telefone,
      template: `aniversario_${alvo.ano}`,
      papel: "administrativo",
      body: textoDeParabens(config, venue.name, p.nome),
    } as never);

    if (error) {
      // Índice único: já mandamos este ano. Não é erro — é a trava trabalhando.
      if (/duplicate key|unique/i.test(error.message)) resultado.repetidos += 1;
      else console.error(`[aniversarios] ${p.telefone}: ${error.message}`);
      continue;
    }
    resultado.enfileirados += 1;
  }

  if (resultado.enfileirados) {
    console.log(
      `[aniversarios] ${venue.name}: ${resultado.enfileirados} parabéns para ${diaISO} ` +
        `(${resultado.repetidos} já mandados antes).`,
    );
  }
  return resultado;
}

/**
 * A volta diária, em todas as casas que ligaram o parabéns.
 *
 * Lista pela CONFIGURAÇÃO e não por módulo: a base de clientes é da casa, e
 * quem ligou o parabéns quer o parabéns — tenha ou não pesquisa, cardápio ou
 * agente. Falha de uma casa não pode calar as outras.
 */
export async function varrerAniversarios(agora = new Date()): Promise<void> {
  let casas: any[];
  try {
    const { data, error } = await cliente()
      .from("clientes_config")
      .select("venue_id, aniversario_ativo, aniversario_hora, aniversario_antecedencia, " +
        "aniversario_texto, aniversario_teto_por_dia, venues:venue_id(id, name, timezone)")
      .eq("aniversario_ativo", true)
      .limit(TETO_DE_CASAS);
    if (error) {
      // Banco ainda sem a migração: silêncio é o comportamento certo.
      if (/clientes_config|42P01|PGRST/i.test(error.message)) return;
      throw error;
    }
    casas = data ?? [];
  } catch (e) {
    console.error(`[aniversarios] varredura não listou as casas: ${(e as Error).message}`);
    return;
  }

  for (const casa of casas) {
    const venue = casa.venues;
    if (!venue) continue;
    try {
      await mandarParabens(venue, { agora, config: casa as ConfigDeClientes });
    } catch (e) {
      console.error(`[aniversarios] ${venue.name}: ${(e as Error).message}`);
    }
  }
}
