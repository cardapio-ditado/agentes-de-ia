import { db, ehMigracaoPendente } from "./supabase.js";
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
export interface QuandoFaz {
  /** Dia do aniversário, 1 a 31. */
  dia: number;
  /** Mês do aniversário, 1 a 12. */
  mes: number;
  /** Quantos dias faltam. Só para o texto antigo com {quando}. */
  diasAntes?: number;
}

/** "25 de dezembro" — a data como uma pessoa fala. */
export function dataPorExtenso(dia: number, mes: number): string {
  const meses = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  return `${dia} de ${meses[mes - 1] ?? "?"}`;
}

export function textoDeParabens(
  config: Pick<ConfigDeClientes, "aniversario_texto">,
  casa: string,
  nome: string | null,
  quando: QuandoFaz,
): string {
  const primeiro = primeiroNome(nome);
  const data = dataPorExtenso(quando.dia, quando.mes);
  const diasAntes = quando.diasAntes ?? 0;
  const modelo = config.aniversario_texto?.trim() || padraoDoParabens(primeiro, diasAntes);
  return modelo
    .replaceAll("{nome}", primeiro)
    .replaceAll("{casa}", casa)
    .replaceAll("{data}", data)
    .replaceAll("{quando}", quandoEmPalavras(diasAntes))
    .trim();
}

/** "hoje", "amanhã", "daqui a 10 dias" — só para quem já usa {quando}. */
function quandoEmPalavras(diasAntes: number): string {
  if (diasAntes <= 0) return "hoje";
  if (diasAntes === 1) return "amanhã";
  return `daqui a ${diasAntes} dias`;
}

/**
 * O texto padrão diz a DATA, não a contagem.
 *
 * "Daqui a 10 dias" é uma conta, e conta erra: basta a mensagem sair com uma
 * hora de atraso, o fuso virar o dia, ou a fila segurar o envio, para o
 * cliente ler um número que não bate com o calendário dele. "Dia 25 de
 * dezembro" não tem como estar errado — e é assim que uma pessoa fala.
 *
 * No dia do aniversário o texto muda de objetivo: ali é carinho, porque ele
 * já escolheu onde comemorar. Antes é convite — a única janela em que a
 * mensagem muda alguma coisa.
 */
function padraoDoParabens(primeiro: string, diasAntes: number): string {
  const oi = primeiro ? "Oi, {nome}! " : "";

  if (diasAntes <= 0) {
    return (
      `${oi}Hoje é seu dia e a gente não podia deixar passar em branco. ` +
      `Feliz aniversário! 🎉 Vem comemorar com a gente — {casa}.`
    );
  }
  return (
    `${oi}Vimos aqui que dia {data} é seu aniversário e a gente já quer ` +
    `comemorar junto! 🎉 Se quiser trazer a turma, é só responder esta mensagem ` +
    `que a gente separa a melhor mesa pra você. Um abraço, {casa}.`
  );
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

export interface EnvioDoParabens {
  /** pending, sent ou failed — como a fila de avisos registra. */
  status: string;
  erro: string | null;
  criado_em: string;
  enviado_em: string | null;
}

export interface Aniversariante extends Cliente {
  /** Quantos dias faltam. Zero = hoje. */
  dias_ate: number;
  /** AAAA-MM-DD da próxima comemoração. */
  proximo: string;
  /** Já recebeu o parabéns deste ano — a tela mostra e não repete. */
  ja_avisado: boolean;
  /**
   * O que aconteceu com a mensagem dela, quando já foi disparada.
   *
   * "Enfileirado" não é "entregue": entre uma coisa e outra estão o conector,
   * o WhatsApp e o número da pessoa. Sem mostrar isto, um disparo em que
   * metade falhou parece um disparo bem-sucedido — que foi exatamente o que
   * aconteceu e ninguém tinha onde ver.
   */
  envio: EnvioDoParabens | null;
  /**
   * A mensagem EXATA que sairia para esta pessoa.
   *
   * Montada aqui, no mesmo lugar que monta a de verdade, e não na tela. Uma
   * prévia construída por outro código é uma prévia que mente — mostra uma
   * coisa e manda outra, e ninguém descobre até um cliente estranhar.
   */
  mensagem: string;
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
  venue: { id: string; name?: string; timezone: string },
  dias = 30,
  agora = new Date(),
): Promise<Aniversariante[]> {
  const hojeISO = hojeNaCasa(venue.timezone, agora);
  const config = await configDeClientes(venue.id);

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
      envio: null as EnvioDoParabens | null,
    }))
    .map(({ dias: d, proximo, ...resto }) => ({
      ...resto,
      dias_ate: d,
      proximo,
      mensagem: textoDeParabens(config, venue.name ?? "sua casa", resto.nome, {
        dia: resto.nascimento_dia!,
        mes: resto.nascimento_mes!,
        diasAntes: d,
      }),
    }))
    .filter((c) => c.dias_ate <= dias)
    .sort((a, b) => a.dias_ate - b.dias_ate);

  if (!proximos.length) return proximos;

  // O que já foi disparado para o ano da PRÓXIMA comemoração, com o status de
  // entrega. Numa consulta só: uma por cliente viraria centenas de idas ao
  // banco para abrir a tela.
  const anos = [...new Set(proximos.map((c) => `aniversario_${c.proximo.slice(0, 4)}`))];
  const { data: avisados } = await cliente()
    .from("notifications")
    .select("cliente_id, template, status, error, created_at, sent_at")
    .eq("venue_id", venue.id)
    .in("template", anos)
    .in("cliente_id", proximos.map((c) => c.id));

  type LinhaDeAviso = {
    cliente_id: string;
    template: string;
    status: string;
    error: string | null;
    created_at: string;
    sent_at: string | null;
  };
  const porPessoa = new Map<string, LinhaDeAviso>();
  for (const n of (avisados ?? []) as LinhaDeAviso[]) {
    porPessoa.set(`${n.cliente_id}|${n.template}`, n);
  }

  for (const c of proximos) {
    const achado = porPessoa.get(`${c.id}|aniversario_${c.proximo.slice(0, 4)}`);
    c.ja_avisado = Boolean(achado);
    c.envio = achado
      ? {
          status: achado.status,
          erro: achado.error,
          criado_em: achado.created_at,
          enviado_em: achado.sent_at,
        }
      : null;
  }
  return proximos;
}

/**
 * Os clientes que o dono marcou na tela.
 *
 * O filtro de descadastrado vem junto e não é negociável: quem pediu para não
 * receber não recebe nem quando alguém clica no nome dele por engano.
 */
async function clientesEscolhidos(venueId: string, ids: string[]): Promise<Cliente[]> {
  const { data, error } = await cliente()
    .from("clientes")
    .select("*")
    .eq("venue_id", venueId)
    .in("id", ids.slice(0, 200))
    .is("descadastrado_em", null);
  if (error) throw new Error(`Falha ao carregar os escolhidos: ${error.message}`);
  return (data ?? []) as Cliente[];
}

/**
 * Devolve à fila um parabéns que existe mas nunca chegou.
 *
 * Devolve `true` quando ressuscitou algo, `false` quando a mensagem já foi
 * entregue de verdade — e aí "repetido" é a resposta certa, porque mandar de
 * novo seria dois parabéns no mesmo ano.
 *
 * Zera as tentativas porque o teto de quatro é o que tirou a mensagem da fila;
 * sem zerar, o conector continuaria ignorando. E regrava o corpo: entre a
 * falha e agora a casa pode ter mudado o texto da campanha, e é o texto de
 * hoje que deve sair.
 */
async function reenfileirarSeNaoChegou(
  venueId: string,
  clienteId: string,
  template: string,
  corpo: string,
): Promise<boolean> {
  const { data, error } = await cliente()
    .from("notifications")
    .select("id, status")
    .eq("venue_id", venueId)
    .eq("cliente_id", clienteId)
    .eq("template", template)
    .maybeSingle();
  if (error || !data) return false;
  if (data.status === "sent") return false;

  const { error: erroUpdate } = await cliente()
    .from("notifications")
    .update({ status: "pending", attempts: 0, error: null, body: corpo } as never)
    .eq("id", data.id);
  if (erroUpdate) {
    console.error(`[aniversarios] não reenfileirei ${data.id}: ${erroUpdate.message}`);
    return false;
  }
  console.log(`[aniversarios] aviso ${data.id} voltou para a fila — nunca tinha chegado.`);
  return true;
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
 * Manda o parabéns — para a lista do dia, ou para quem o dono escolheu.
 *
 * DOIS MODOS, E O MANUAL NÃO PEDE LICENÇA À AGENDA.
 *
 * A varredura escolhe sozinha pelo dia-alvo (hoje + antecedência) e só age
 * com o envio automático ligado, na hora configurada. Quando o dono marca
 * gente na tela, nada disso se aplica: ele já olhou a lista, leu a mensagem e
 * apertou o botão — pedir que ele também ligue o automático e espere as 10h
 * seria transformar uma decisão tomada num formulário.
 *
 * O que NÃO muda em nenhum dos dois: a trava de um por ano, o teto do dia,
 * quem pediu para não receber, e quem está sem telefone. Essas existem para
 * proteger o cliente e o número da casa, e clicar não desfaz nenhuma.
 */
export async function mandarParabens(
  venue: { id: string; name: string; timezone: string },
  opcoes: {
    agora?: Date;
    forcar?: boolean;
    config?: ConfigDeClientes;
    /** Escolhidos a dedo na tela. Vazio ou ausente = a lista do dia. */
    clienteIds?: string[];
  } = {},
): Promise<ResultadoDoParabens> {
  const agora = opcoes.agora ?? new Date();
  const config = opcoes.config ?? (await configDeClientes(venue.id));
  const aDedo = (opcoes.clienteIds ?? []).length > 0;
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

  if (!aDedo) {
    if (!config.aniversario_ativo) return vazio;
    if (!opcoes.forcar && horaNaCasa(venue.timezone, agora) < config.aniversario_hora) return vazio;
  }

  const pessoas = aDedo
    ? await clientesEscolhidos(venue.id, opcoes.clienteIds!)
    : await aniversariantesDoDia(venue.id, alvo.dia, alvo.mes);
  const sobra = Math.max(0, config.aniversario_teto_por_dia - (await parabensRecentes(venue.id, agora)));
  const hojeISO = hojeNaCasa(venue.timezone, agora);

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

    // Cada pessoa tem o SEU aniversário: no modo a dedo, o dono pode marcar
    // quem faz amanhã e quem faz daqui a um mês na mesma leva. O ano da trava
    // e a data do texto saem da data dela, não do dia-alvo da varredura.
    const dela = p.nascimento_dia && p.nascimento_mes
      ? diasAte(p.nascimento_dia, p.nascimento_mes, hojeISO)
      : { dias: 0, proximo: diaISO };
    const ano = Number(dela.proximo.slice(0, 4));
    const corpo = textoDeParabens(config, venue.name, p.nome, {
      dia: p.nascimento_dia ?? alvo.dia,
      mes: p.nascimento_mes ?? alvo.mes,
      diasAntes: dela.dias,
    });

    const { error } = await inserirAvisos({
      venue_id: venue.id,
      cliente_id: p.id,
      channel: "whatsapp",
      destination: p.telefone,
      // O ano no template é o que faz a trava do banco permitir o parabéns do
      // ano que vem sem permitir dois no mesmo ano.
      template: `aniversario_${ano}`,
      papel: "administrativo",
      body: corpo,
    } as never);

    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        // A TRAVA IMPEDE ENTREGA DOBRADA, NÃO ENTREGA NENHUMA.
        //
        // Já existe um aviso deste ano para esta pessoa — mas "existe" não
        // quer dizer "chegou". Se o número da casa estava fora do ar quando
        // ele foi criado, ele falhou quatro vezes, saiu da fila (o teto de
        // tentativas) e ficou morto no banco. Sem isto, a trava transformaria
        // uma falha de conexão numa condenação: aquela pessoa nunca mais
        // receberia o parabéns, e a tela contaria como "já avisado".
        if (await reenfileirarSeNaoChegou(venue.id, p.id, `aniversario_${ano}`, corpo)) {
          resultado.enfileirados += 1;
        } else {
          resultado.repetidos += 1;
        }
      } else {
        console.error(`[aniversarios] ${p.telefone}: ${error.message}`);
      }
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
      if (ehMigracaoPendente(error.message)) return;
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
