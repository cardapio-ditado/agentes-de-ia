import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { contextoDeAgora, runAgent, type AgentStreamEvent } from "./agent.js";
import { authenticateApiKey, hasScope } from "./apikeys.js";
import {
  AgenteEmUso,
  createAgent,
  excluirAgente,
  getAgentInOrg,
  listAgentsInOrg,
  listAllAgentsInOrg,
  updateAgent,
  type DadosAgente,
} from "./repository.js";
import { decidirReserva } from "./reservationFlow.js";
import { listNotificationsForReservation } from "./notifications.js";
import {
  ErroDoCardapio,
  LIMITES as LIMITES_DO_CARDAPIO,
  LIMITE_MIDIA_BYTES,
  adicionarMidiaAoItem,
  apagarBanner,
  apagarCategoria,
  apagarItem,
  apagarPromocao,
  atualizarBanner,
  atualizarCategoria,
  atualizarItem,
  atualizarPromocao,
  cardapioPublico,
  chamadosRecentes,
  chamarGarcom,
  comentarItem,
  comentariosLiberados,
  contarComentariosPendentes,
  criarBanner,
  criarCategoria,
  criarItem,
  criarPromocao,
  curtirItem,
  definirCapaDoItem,
  listarBannersDoPainel,
  listarCategoriasDoPainel,
  listarComentarios,
  listarItensDoPainel,
  listarPromocoesDoPainel,
  moderarComentario,
  removerMidiaDoItem,
  reordenar,
  salvarVariacoes,
  trocarImagemDaCategoria,
  trocarMidiaDoBanner,
  validarComentario,
  type DadosDaCategoria,
  type DadosDaPromocao,
  type DadosDoBanner,
  type DadosDoItem,
} from "./cardapioDigital.js";
import {
  apagarConversa,
  atendimentoDe,
  definirAtendimento,
  definirStatusConversa,
  getConversationInOrg,
  listConversations,
  metricasDoVenue,
  registrarMensagemHumana,
} from "./inbox.js";
import {
  entrar,
  ErroDeAcesso,
  pedirTrocaDeSenha,
  renovar,
  sessaoDoToken,
  trocarSenha,
} from "./auth.js";
import {
  adicionarAvaliacaoManual,
  aprovarResposta,
  avaliacaoComOrg,
  descartarResposta,
  filaDeAprovacao,
  historicoDeAvaliacoes,
  marcarPublicada,
  perfilDoVenue,
  salvarPerfil,
} from "./avaliacoes.js";
import { extratoDePontos, PlanoBloqueadoError } from "./pontos.js";
import {
  atualizarComercial,
  criarCliente,
  listarClientes,
  resumirPlataforma,
  type DadosDoCliente,
} from "./tenants.js";
import {
  addTrainingFile,
  addTrainingText,
  LIMITE_ARQUIVO_BYTES,
  listTraining,
  removeTraining,
} from "./training.js";
import {
  assinaturaValida,
  estadoInstagram,
  processarWebhookInstagram,
  verificarWebhook,
} from "./channels/instagram.js";
import {
  LIMITE_FOTO_BYTES,
  concluirRun,
  conversarGeracao,
  createChecklist,
  deleteChecklist,
  dispararChecklist,
  getChecklistInVenue,
  getRunByToken,
  getRunInVenue,
  itensDe,
  listChecklists,
  listRuns,
  marcarEmAndamento,
  respostasDaRun,
  salvarFotoDeItem,
  updateChecklist,
  urlAssinadaDaFoto,
  validarAgenda,
  validarItens,
  type MensagemGeracao,
  type RespostaItem,
} from "./checklists.js";
import {
  criarComandoPonte,
  lerEstadoPonte,
  papelValido,
} from "./ponteWhatsapp.js";
import { db } from "./supabase.js";
import { engenhariaDoCardapio } from "./cmv/engenharia.js";
import {
  avisarAumentoDePreco,
  avisarEstoqueBaixo,
  configDoCmv,
  fotografarCustosDaCompra,
  salvarConfigDoCmv,
} from "./cmv/avisos.js";
import {
  LIMITE_LOGO_BYTES,
  apagarLogoAntiga,
  corLegivelNoEscuro,
  corValida,
  fundoDaCasa,
  guardarLogo,
  textoSobre,
} from "./marca.js";
import { versaoDoCodigo } from "./version.js";
import {
  cancelReservation,
  createVenueEvent,
  createVenueEventSeries,
  createVenueInfo,
  deleteReservation,
  deleteVenueEvent,
  deleteVenueEventSeries,
  deleteVenueInfo,
  findVenueBySlug,
  findVenueBySlugInOrg,
  getReservationWithVenue,
  listAllEvents,
  listPendingReservations,
  listUpcomingApproved,
  listVenueInfo,
  listVenuesInOrg,
  renewVenueEventSeries,
  updateReservation,
  updateVenue,
  updateVenueLogo,
  dadosDaCasaParaOPainel,
  type DadosReserva,
  type DadosVenue,
} from "./venues.js";
import { definirModulo, listarModulos, temModulo } from "./modulos.js";
import {
  ErroDoEstoque,
  apagarFicha,
  aprenderApelido,
  atualizarCompra,
  atualizarInsumo,
  atualizarLocal,
  cancelarCompra,
  excluirCompra,
  casarLinhas,
  criarCompra,
  criarLocal,
  desativarCategoria,
  desativarLocal,
  garantirCategoria,
  listarCategorias,
  divergenciasDaCompra,
  enviarPedido,
  excluirInsumo,
  extratoInsumo,
  garantirInsumo,
  lancarFaturamento,
  listarCompras,
  listarContagens,
  detalheDaContagem,
  movimentosDoEstoque,
  kardexDoFornecedor,
  listarFichas,
  listarFornecedores,
  listarInsumos,
  listarLocais,
  obterCompra,
  painelCmv,
  posicaoEstoque,
  receberCompra,
  registrarContagem,
  registrarPerda,
  conciliacaoDeSaldos,
  ressincronizarSaldos,
  registrarProducao,
  salvarFicha,
  salvarFornecedor,
  sugestaoCompra,
  transferir,
  substituirItens,
  type ItemDaCompra,
} from "./cmv/estoque.js";
import { lerNota, somaConfere, tipoAceito } from "./cmv/lerNota.js";
import { sugerirFicha } from "./cmv/sugerirFicha.js";
import {
  COMPETICOES,
  ErroDeJogos,
  importarJogos,
  jogosJaNaAgenda,
  proximosJogos,
} from "./jogos.js";
import {
  atualizarPessoa,
  criarPessoa,
  ErroDeEquipe,
  listarEquipe,
  PAPEIS,
  podeGerirEquipe,
  redefinirSenha,
  removerPessoa,
} from "./equipe.js";
import { tipoDeVendasAceito } from "./cmv/lerVendas.js";
import { lerProgramacao, tipoDeAgendaAceito } from "./lerProgramacao.js";
import { ErroDeAgenda, importarProgramacao } from "./importarProgramacao.js";
import { hojeNaCasa } from "./fuso.js";
import {
  ErroDePesquisa,
  ETIQUETAS,
  apagarConvite,
  atualizarAtendente,
  conviteDoToken,
  configDaPesquisa,
  criarAtendente,
  enviarConvite,
  listarAtendentes,
  listarConvites,
  listarPremios,
  listarRespostas,
  avaliacoesDoCliente,
  notasPorCliente,
  painelDaPesquisa,
  registrarResposta,
  respostaCompleta,
  removerAtendente,
  resgatarPremio,
  salvarConfig,
} from "./pesquisa.js";
import {
  configZig,
  convidarEscolhidos,
  listarVisitantes,
  salvarConfigZig,
  telefonesConvidadosRecentemente,
  testarZig,
  alimentarBasePelaZig,
} from "./pesquisaZig.js";
import {
  ErroDeClientes,
  apagarCliente,
  configDeClientes,
  editarCliente,
  lerNascimento,
  // `listarClientes` já é o nome do que lista as CASAS clientes da Brasa Food
  // (tenants). Aqui são os clientes DA casa — gente que bebe no bar.
  listarClientes as listarClientesDaCasa,
  registrarCliente,
  salvarConfigDeClientes,
  visitasDoCliente,
} from "./clientes.js";
import type { OrigemDeCliente } from "./clientes.js";
import { mandarParabens, proximosAniversariantes } from "./aniversarios.js";
import { lerPlanilhaDeClientes } from "./planilhaDeClientes.js";
import type { LinhaRecusada } from "./planilhaDeClientes.js";
import type { EventoParaGravar } from "./importarProgramacao.js";
import type { Venue } from "./venues.js";
import {
  CATEGORIAS_SUGERIDAS,
  ErroDeModelo,
  apagarPesquisa,
  atualizarPesquisa,
  conversarMontagem,
  criarPesquisa,
  listarPesquisas,
  pesquisaAtiva,
  itensDoDia,
} from "./pesquisaModelo.js";
import {
  baixarVendas,
  corrigirItem,
  descartarImportacao,
  importarVendas,
  listarImportacoes,
  obterImportacao,
  teoricoVersusReal,
} from "./cmv/vendas.js";

/**
 * Roteamento da API, sem servidor.
 *
 * O mesmo handler serve os dois destinos: `src/server.ts` monta um servidor
 * Node de verdade (local, VPS, container), e `api/index.ts` é a função
 * serverless da Vercel. A diferença é só quem serve os arquivos estáticos —
 * na Vercel, o CDN cuida disso.
 */

// Relativo ao cwd, não ao módulo: compilado, este arquivo vive em dist/src/,
// e um caminho relativo ao módulo apontaria para dist/public (inexistente).
const PUBLIC_DIR = resolve(process.cwd(), "public");

// ============================================================
// Conector WhatsApp — registrado, não importado
// ============================================================

/**
 * Interface mínima do conector, para este módulo não importar o Baileys.
 *
 * Importar direto arrastaria 9 MB de dependência para dentro da função
 * serverless, que nunca conseguiria usá-la: o Baileys precisa de WebSocket
 * aberto e de disco. Quem roda num servidor de verdade registra o conector;
 * na Vercel ele fica nulo e as rotas respondem 501.
 */
export interface ConectorWhatsapp {
  estado(): unknown;
  iniciar(opcoes: {
    agentSlug: string;
    venueSlug: string;
    /** A casa deste conector: amarra fila, conversas e sessão a ela. */
    venueId?: string | null;
    papel?: "agente" | "administrativo";
  }): Promise<void>;
  parar(): Promise<void>;
}

let conectorWhatsapp: ConectorWhatsapp | null = null;

export function registrarConectorWhatsapp(conector: ConectorWhatsapp | null): void {
  conectorWhatsapp = conector;
}

// ============================================================
// Envelope de resposta (padrão do PRD)
// ============================================================
interface ErroHttp {
  status: number;
  code: string;
  message: string;
}

function erro(status: number, code: string, message: string): ErroHttp {
  return { status, code, message };
}

function responder(res: ServerResponse, status: number, corpo: unknown): void {
  const json = JSON.stringify(corpo);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

/**
 * A marca da casa, pronta para a página do cliente aplicar.
 *
 * O contraste é calculado AQUI e não no navegador: a página pública é a única
 * tela que um estranho abre, e mandar a decisão para lá significaria confiar
 * que todo celular vai fazer a conta igual. Além disso, a casa que escolhe
 * amarelo-ouro precisa de letra escura por cima independentemente do aparelho.
 */
function marcaDaCasa(venue: Venue): {
  logo_url: string | null;
  cor_marca: string | null;
  cor_texto: string;
  cor_fundo: string;
  cor_traco: string | null;
} {
  const cor = corValida(venue.cor_marca);
  return {
    logo_url: venue.logo_url ?? null,
    cor_marca: cor,
    cor_texto: textoSobre(cor),
    cor_fundo: fundoDaCasa(cor),
    // A mesma cor, clareada o quanto for preciso para aparecer COMO TRAÇO
    // sobre o fundo escuro: trilha de progresso, contorno do campo em foco,
    // código do cupom. Sem isto, a casa de identidade azul-marinho fica com a
    // trilha invisível e a pesquisa parece travada.
    cor_traco: corLegivelNoEscuro(cor),
  };
}

function ok(res: ServerResponse, data: unknown, status = 200): void {
  responder(res, status, { success: true, data });
}

function falha(res: ServerResponse, e: ErroHttp): void {
  responder(res, e.status, {
    success: false,
    error: { code: e.code, message: e.message },
  });
}

/**
 * O banco responde, e responde com o poder certo?
 *
 * Existe porque uma falha específica é invisível de fora: com a chave `anon`
 * no lugar da `service_role`, o RLS (ligado em todas as tabelas, sem policy
 * permissiva) devolve ZERO LINHAS em vez de erro. A API sobe, o login
 * funciona, e todo o resto simplesmente parece vazio — o que se manifesta
 * como "chave inválida" e "conta sem estabelecimento" mesmo com os dados
 * todos lá. Descobrir isso por eliminação custa horas; aqui custa uma URL.
 *
 * Não expõe nada sensível: só contagens de linhas que o painel já mostra.
 */
async function diagnosticoDoBanco(): Promise<Record<string, unknown>> {
  // Referência do projeto: o "abcdefg" de https://abcdefg.supabase.co. Não é
  // segredo — vai em qualquer app cliente — e responde a pergunta que já custou
  // caro nesta base: o app fala com o MESMO projeto onde o SQL foi rodado?
  // Com duas contas Supabase, o SQL acerta um banco e o app lê o outro, e o
  // sintoma é dado que "existe" mas o sistema não encontra.
  const projeto = (process.env.SUPABASE_URL ?? "").match(/https?:\/\/([^.]+)\./)?.[1] ?? "?";

  try {
    const contar = (tabela: "organizations" | "api_keys" | "org_members" | "platform_admins") =>
      db().from(tabela).select("*", { count: "exact", head: true });

    const [orgs, chaves, membros, admins] = await Promise.all([
      contar("organizations"),
      contar("api_keys"),
      contar("org_members"),
      contar("platform_admins"),
    ]);

    const erroGrave = orgs.error ?? chaves.error;
    if (erroGrave) return { projeto, alcancavel: false, erro: erroGrave.message };

    const total = (orgs.count ?? 0) + (chaves.count ?? 0);
    return {
      projeto,
      alcancavel: true,
      organizacoes: orgs.count ?? 0,
      chaves_de_api: chaves.count ?? 0,
      // Tabelas do login por e-mail e senha. Erro aqui (e não zero) significa
      // que a migração não rodou NESTE projeto, ou que o PostgREST ainda não
      // recarregou o schema.
      vinculos: membros.error ? `erro: ${membros.error.message}` : (membros.count ?? 0),
      admins_da_plataforma: admins.error ? `erro: ${admins.error.message}` : (admins.count ?? 0),
      // Zero nas duas primeiras num banco em uso é o sintoma do RLS bloqueando
      // tudo. Nunca é o estado normal: sem organização e sem chave, ninguém
      // teria conseguido usar o sistema para chegar até aqui.
      credencial:
        total === 0
          ? "SUSPEITA: leituras vazias. SUPABASE_SERVICE_ROLE_KEY pode não ser a service_role (RLS bloqueando)."
          : "service_role ok",
    };
  } catch (e) {
    return { projeto, alcancavel: false, erro: e instanceof Error ? e.message : "falha desconhecida" };
  }
}

// ============================================================
// Autenticação
// ============================================================
/**
 * Quem está do outro lado da requisição.
 *
 * Dois caminhos chegam aqui e é de propósito: pessoas entram com e-mail e
 * senha (token do Supabase Auth), máquinas entram com chave `sk_...` — o
 * conector do WhatsApp roda num PC sem ninguém para digitar senha. As rotas
 * não precisam saber qual dos dois veio; recebem sempre o mesmo formato.
 */
interface Acesso {
  org_id: string;
  /** Assinatura da ação na inbox: nome da chave ou e-mail de quem agiu. */
  name: string;
  scopes: string[];
  plataformaAdmin: boolean;
  /**
   * Módulos que este acesso pode abrir; null = todos.
   *
   * Chave de máquina não tem restrição por módulo: ela já nasce com escopos
   * declarados, que é o mecanismo de limite dela.
   */
  modulos: string[] | null;
  /**
   * Papel e id de quem está agindo — só existem quando é gente, não máquina.
   *
   * A gestão de acessos precisa dos dois: o papel para saber quem pode mexer,
   * o id para impedir que alguém remova o próprio acesso e fique de fora.
   */
  papel: string | null;
  userId: string | null;
  /**
   * A senha atual foi gerada pelo sistema e ditada para a pessoa.
   *
   * Só existe para gente; chave de máquina não tem senha. O painel tranca as
   * telas até a troca.
   */
  senhaProvisoria?: boolean;
}

/** Papel de pessoa vira escopo. `viewer` olha, não mexe. */
const ESCOPOS_POR_PAPEL: Record<string, string[]> = {
  owner: ["runs:write", "reservations:read", "reservations:write"],
  admin: ["runs:write", "reservations:read", "reservations:write"],
  member: ["runs:write", "reservations:read", "reservations:write"],
  plataforma: ["runs:write", "reservations:read", "reservations:write"],
  viewer: ["reservations:read"],
};

/**
 * Opções de portaria. Hoje só existe uma, e ela é a exceção da senha ditada.
 */
interface OpcoesDeAcesso {
  /**
   * Deixa passar quem ainda não trocou a senha provisória.
   *
   * Vale para UMA rota: `GET /v1/auth/me`, que é como o painel descobre que
   * precisa mostrar a tela de troca. Sem esta fresta, a tela que obriga a
   * troca nunca apareceria — o painel levaria 403 antes de saber o motivo.
   */
  senhaProvisoriaOk?: boolean;
}

async function exigirChave(
  req: IncomingMessage,
  escopo: string,
  opcoes: OpcoesDeAcesso = {},
): Promise<Acesso> {
  const header = req.headers.authorization ?? "";
  const credencial = header.startsWith("Bearer ") ? header.slice(7).trim() : undefined;

  if (!credencial) {
    throw erro(401, "unauthorized", "Faça login para continuar.");
  }

  // Chave de máquina: o prefixo torna a distinção inequívoca, sem precisar
  // tentar validar dos dois jeitos e ver qual não explode.
  if (credencial.startsWith("sk_")) {
    const apiKey = await authenticateApiKey(credencial);
    if (!apiKey) {
      throw erro(401, "unauthorized", "Chave de API ausente, inválida, revogada ou expirada.");
    }
    if (!hasScope(apiKey, escopo)) {
      throw erro(403, "forbidden", `Esta chave não tem o escopo "${escopo}".`);
    }
    return {
      org_id: apiKey.org_id,
      name: apiKey.name,
      scopes: apiKey.scopes,
      plataformaAdmin: false,
      modulos: null,
      papel: null,
      userId: null,
    };
  }

  // Sessão de pessoa.
  let sessao;
  try {
    sessao = await sessaoDoToken(credencial);
  } catch (e) {
    if (e instanceof ErroDeAcesso) throw erro(e.status, "unauthorized", e.message);
    throw e;
  }

  const scopes = ESCOPOS_POR_PAPEL[sessao.papel] ?? ESCOPOS_POR_PAPEL.viewer!;
  if (!sessao.plataformaAdmin && !scopes.includes(escopo)) {
    throw erro(403, "forbidden", "Seu perfil não permite esta ação.");
  }

  // Senha ditada é senha que outra pessoa sabe. O painel já fechava a tela
  // até a troca, mas fechar a TELA não fecha a PORTA: o endereço da API é o
  // mesmo, e quem chamasse direto trabalhava com a senha provisória para
  // sempre. Quem tranca é aqui.
  //
  // Chave `sk_` não passa por este ponto — máquina não tem senha para trocar.
  if (sessao.senhaProvisoria && !opcoes.senhaProvisoriaOk) {
    throw erro(
      403,
      "senha_provisoria",
      "Sua senha foi criada por outra pessoa. Troque a senha para continuar.",
    );
  }

  // Admin da plataforma sem organização própria pode olhar a de um cliente
  // passando ?org=slug — é como o suporte enxerga o que o cliente enxerga.
  return {
    org_id: sessao.orgId,
    name: sessao.email ?? "painel",
    scopes,
    plataformaAdmin: sessao.plataformaAdmin,
    modulos: sessao.modulos,
    papel: sessao.papel,
    userId: sessao.userId,
    senhaProvisoria: sessao.senhaProvisoria,
  };
}

/**
 * Exige que o acesso possa abrir o módulo, além de estar autenticado.
 *
 * Esconder o favo na colmeia é conveniência; a trava é aqui. Quem guardou o
 * endereço de uma tela entraria por ele com o favo apagado — e no CMV isso
 * significaria mexer no estoque de uma casa cujo módulo a pessoa não tem.
 */
/**
 * Módulos que toda casa tem, e por isso não se conferem no contrato.
 *
 * A base de clientes é da CASA, não um produto: quem só comprou o CMV
 * cadastra cliente na mão e manda parabéns do mesmo jeito. Não existe linha
 * em `venue_modulos` para ela, e conferir contrato aqui trancaria a base de
 * todo mundo. A restrição da PESSOA continua valendo — é o que impede um
 * conferente de doca de baixar a lista de telefones da casa.
 */
const MODULOS_DA_CASA = new Set(["clientes"]);

/**
 * As duas perguntas que um módulo faz, e que são diferentes.
 *
 * 1. A CASA contratou? Se não, ninguém entra — nem o dono. É o que separa
 *    quem paga pelo CMV de quem descobriu o endereço.
 * 2. Esta PESSOA pode abrir? O dono contratou tudo, e mesmo assim o
 *    conferente de doca não tem o que fazer na base de clientes.
 *
 * As duas viviam só no painel, apagando o favo na colmeia. Apagar o favo não
 * tranca a porta: o endereço da API é o mesmo, e o painel inteiro é JS aberto
 * que qualquer um lê. Agora a portaria confere as duas.
 */
async function exigirModulo(acesso: Acesso, modulo: string, venueId: string): Promise<void> {
  // Suporte da Brasa Food enxerga o que o cliente enxerga — é como se
  // descobre por telefone que o favo apagado era um módulo não contratado.
  if (acesso.plataformaAdmin) return;

  if (acesso.modulos !== null && !acesso.modulos.includes(modulo)) {
    throw erro(403, "forbidden", "Seu acesso não inclui este módulo. Fale com o dono da conta.");
  }

  if (MODULOS_DA_CASA.has(modulo)) return;

  if (!(await temModulo(venueId, modulo))) {
    throw erro(403, "forbidden", "Esta casa não contratou este módulo. Fale com a Brasa Food.");
  }
}

/**
 * Executa uma operação do estoque traduzindo a falha para a resposta HTTP.
 *
 * As funções do CMV levantam `ErroDoEstoque` com status e mensagem já
 * pensados para quem está na doca. Sem esta ponte, cada rota repetiria o
 * mesmo try/catch — e a que esquecesse devolveria 500 com texto de Postgres.
 */
async function comErroDeEstoque<T>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (e) {
    if (e instanceof ErroDoEstoque) {
      throw erro(e.status, e.status === 404 ? "not_found" : "invalid_request", e.message);
    }
    throw e;
  }
}

/** E para os erros da base de clientes. */
async function comErroDeClientes<T>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (e) {
    if (e instanceof ErroDeClientes) {
      throw erro(e.status, e.status === 404 ? "not_found" : "invalid_request", e.message);
    }
    throw e;
  }
}

/** O mesmo tratamento para os erros da pesquisa de satisfação. */
async function comErroDePesquisa<T>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (e) {
    if (e instanceof ErroDePesquisa) {
      const codigo =
        e.status === 404 ? "not_found" : e.status === 409 ? "conflito" : "invalid_request";
      throw erro(e.status, codigo, e.message);
    }
    throw e;
  }
}

/** O mesmo tratamento para os erros do cardápio digital. */
async function comErroDoCardapio<T>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (e) {
    if (e instanceof ErroDoCardapio) {
      const codigo =
        e.status === 404 ? "not_found" : e.status === 503 ? "migracao_pendente" : e.status === 429 ? "rate_limited" : "invalid_request";
      throw erro(e.status, codigo, e.message);
    }
    throw e;
  }
}

/**
 * Como a casa aparece num endereço público.
 *
 * Pelo slug quando ele é só desta casa; pelo id quando não é. Um QR code é
 * IMPRESSO e colado na mesa: se um segundo cliente do hub escolher o mesmo
 * slug daqui a seis meses, o cartaz da mesa passaria a abrir a pesquisa (ou o
 * cardápio) do vizinho, e ninguém iria descobrir por meses. O id é feio na
 * barra de endereços e nunca fica ambíguo.
 */
async function identificadorPublico(venue: { id: string; slug: string }): Promise<string> {
  try {
    const porSlug = await findVenueBySlug(venue.slug);
    if (porSlug.id === venue.id) return venue.slug;
  } catch {
    /* slug repetido em outra organização: fica o id, que não erra */
  }
  return venue.id;
}

function enderecoBase(): string {
  return (process.env.PUBLIC_URL ?? "https://agentes-de-ia-alpha.vercel.app").replace(/\/$/, "");
}

/** O endereço público da pesquisa desta casa. */
async function enderecoDaPesquisa(
  venue: { id: string; slug: string },
  mesa?: string | null,
): Promise<string> {
  const busca = new URLSearchParams({ c: await identificadorPublico(venue) });
  if (mesa?.trim()) busca.set("mesa", mesa.trim());
  return `${enderecoBase()}/pesquisa?${busca}`;
}

/** O endereço público do cardápio desta casa: /cardapio/<casa>?mesa=7. */
async function enderecoDoCardapio(
  venue: { id: string; slug: string },
  mesa?: string | null,
): Promise<string> {
  const caminho = `${enderecoBase()}/cardapio/${encodeURIComponent(await identificadorPublico(venue))}`;
  return mesa?.trim() ? `${caminho}?mesa=${encodeURIComponent(mesa.trim())}` : caminho;
}

/**
 * De onde veio a requisição, para o limite de ritmo das rotas públicas.
 *
 * Atrás da Vercel o endereço real está em x-forwarded-for (o primeiro da
 * lista); direto no servidor, é o do socket. Nenhum dos dois é prova de
 * identidade — é só a chave do balde de ritmo.
 */
function ipDe(req: IncomingMessage): string {
  const encaminhado = req.headers["x-forwarded-for"];
  const primeiro = (Array.isArray(encaminhado) ? encaminhado[0] : encaminhado)?.split(",")[0]?.trim();
  return primeiro || req.socket?.remoteAddress || "desconhecido";
}

/**
 * A casa por trás do que veio no QR code: um id ou um slug.
 *
 * Os dois formatos existem porque o cartaz gerado hoje usa o slug e o gerado
 * amanhã pode usar o id (ver `enderecoDaPesquisa`). Um cartaz impresso vive
 * anos na mesa e precisa continuar abrindo.
 */
async function venueDaPesquisa(identificador: string): Promise<Venue | null> {
  const pareceUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    identificador,
  );
  try {
    if (pareceUuid) {
      const { data } = await db().from("venues").select("*").eq("id", identificador).maybeSingle();
      return (data as Venue) ?? null;
    }
    return await findVenueBySlug(identificador);
  } catch {
    return null;
  }
}

/** O QR code como imagem embutida, pronto para a tela mandar imprimir. */
async function qrcodeDataUrl(texto: string): Promise<string> {
  const { toDataURL } = await import("qrcode");
  return toDataURL(texto, { errorCorrectionLevel: "M", margin: 1, width: 512 });
}

/**
 * O convite digitado no painel. A criação, o link e a fila moram em
 * `enviarConvite` (pesquisa.ts) — o mesmo corredor da Zig e da planilha.
 */
async function convidarParaPesquisa(
  venue: { id: string; name: string; slug: string },
  corpo: Record<string, unknown>,
): Promise<{ convite: unknown; enfileirado: boolean }> {
  return await enviarConvite(venue, {
    telefone: texto(corpo, "telefone"),
    nome: textoOpcional(corpo, "nome") ?? null,
    mensagem: textoOpcional(corpo, "mensagem") ?? null,
  });
}

/** E o mesmo para os erros de montagem da pesquisa. */
async function comErroDeModelo<T>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (e) {
    if (e instanceof ErroDeModelo) {
      throw erro(e.status, e.status === 404 ? "not_found" : "invalid_request", e.message);
    }
    throw e;
  }
}

/** O mesmo tratamento para os erros da gestão de acessos. */
async function comErroDeEquipe<T>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (e) {
    if (e instanceof ErroDeEquipe) {
      throw erro(e.status, e.status === 404 ? "not_found" : "invalid_request", e.message);
    }
    throw e;
  }
}

/**
 * Lê os itens de uma compra do corpo da requisição.
 *
 * Números vêm como `null` quando ausentes, e não como zero: no recebimento,
 * nulo é "não conferido" e zero é "não veio" — a diferença decide se o item
 * entra no estoque ou aparece como falta.
 */
function itensDaCompra(corpo: unknown): ItemDaCompra[] {
  const bruto = (corpo as Record<string, unknown>).itens;
  if (!Array.isArray(bruto)) {
    throw erro(400, "invalid_request", 'Informe "itens" com as linhas da compra.');
  }
  return bruto.map((linha) => {
    const i = linha as Record<string, unknown>;
    return {
      insumoId: typeof i.insumo_id === "string" ? i.insumo_id : null,
      localId: typeof i.local_id === "string" ? i.local_id : null,
      descricaoNota: typeof i.descricao_nota === "string" ? i.descricao_nota : null,
      quantidadePedida: numeroOuNulo(i.quantidade_pedida),
      custoUnitarioPedido: numeroOuNulo(i.custo_unitario_pedido),
      quantidadeRecebida: numeroOuNulo(i.quantidade_recebida),
      custoUnitarioRecebido: numeroOuNulo(i.custo_unitario_recebido),
      divergenciaMotivo: typeof i.divergencia_motivo === "string" ? i.divergencia_motivo : null,
    };
  });
}

function numeroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    throw erro(400, "invalid_request", `Quantidade ou valor inválido: ${String(valor)}`);
  }
  return n;
}

/** Rotas de administração da plataforma exigem mais que estar logado. */
async function exigirAdminDaPlataforma(req: IncomingMessage): Promise<Acesso> {
  const acesso = await exigirChave(req, "reservations:read");
  if (!acesso.plataformaAdmin) {
    throw erro(403, "forbidden", "Esta área é da equipe Brasa Food.");
  }
  return acesso;
}

async function lerJson(
  req: IncomingMessage,
  limite = 1_000_000,
): Promise<Record<string, unknown>> {
  const partes: Buffer[] = [];
  let bytes = 0;
  for await (const parte of req) {
    bytes += (parte as Buffer).length;
    if (bytes > limite) {
      throw erro(
        413,
        "request_too_large",
        `Corpo da requisição acima de ${Math.round(limite / 1_000_000)} MB.`,
      );
    }
    partes.push(parte as Buffer);
  }
  if (partes.length === 0) return {};
  try {
    const corpo: unknown = JSON.parse(Buffer.concat(partes).toString("utf8"));
    if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
      throw erro(400, "invalid_request", "O corpo precisa ser um objeto JSON.");
    }
    return corpo as Record<string, unknown>;
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) throw e;
    throw erro(400, "invalid_request", "JSON inválido.");
  }
}

/**
 * Lê o corpo bruto da requisição — sem JSON, sem base64.
 *
 * Usado para upload de arquivo: mandar o arquivo cru custa ~25% menos bytes
 * na rede do que embrulhar em base64 dentro de um JSON, o que dá mais folga
 * sob qualquer limite de tamanho de corpo imposto por um proxy na frente.
 */
async function lerBinario(req: IncomingMessage, limite: number): Promise<Buffer> {
  const partes: Buffer[] = [];
  let bytes = 0;
  for await (const parte of req) {
    bytes += (parte as Buffer).length;
    if (bytes > limite) {
      throw erro(
        413,
        "request_too_large",
        `Arquivo acima de ${Math.round(limite / 1_000_000)} MB.`,
      );
    }
    partes.push(parte as Buffer);
  }
  return Buffer.concat(partes);
}

function texto(corpo: Record<string, unknown>, campo: string): string {
  const valor = corpo[campo];
  if (typeof valor !== "string" || valor.trim() === "") {
    throw erro(400, "invalid_request", `O campo "${campo}" é obrigatório.`);
  }
  return valor.trim();
}

/** Número inteiro dentro da faixa, ou undefined para "não mexe". */
function inteiroOpcional(valor: unknown, minimo: number, maximo: number): number | undefined {
  if (valor === undefined || valor === null || valor === "") return undefined;
  const n = Math.trunc(Number(valor));
  if (!Number.isFinite(n)) return undefined;
  return Math.min(maximo, Math.max(minimo, n));
}

/**
 * A conexão com a Zig como o painel a vê: o token NUNCA volta inteiro.
 *
 * O que volta é "tem token salvo" e o finalzinho dele — o suficiente para a
 * pessoa reconhecer qual é e apertar o X para trocar, sem o token trafegar
 * de volta a cada abertura da tela.
 */
function zigParaOPainel(config: {
  token: string | null;
  loja: string | null;
  ativo: boolean;
  hora_envio: number;
  teto_por_dia: number;
  nao_repetir_dias: number;
  ultimo_dia: string | null;
}): Record<string, unknown> {
  return {
    loja: config.loja,
    ativo: config.ativo,
    hora_envio: config.hora_envio,
    teto_por_dia: config.teto_por_dia,
    nao_repetir_dias: config.nao_repetir_dias,
    ultimo_dia: config.ultimo_dia,
    token_salvo: Boolean(config.token),
    token_final: config.token ? config.token.slice(-4) : null,
  };
}

function textoOpcional(corpo: Record<string, unknown>, campo: string): string | undefined {
  const valor = corpo[campo];
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined;
}

// ============================================================
// Rotas
// ============================================================
async function rotear(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  traceId: string,
  servirEstaticos: boolean,
): Promise<void> {
  const metodo = req.method ?? "GET";
  const caminho = url.pathname.replace(/\/+$/, "") || "/";
  const partes = caminho.split("/").filter(Boolean);

  if (metodo === "GET" && caminho === "/health") {
    return ok(res, {
      status: "ok",
      versao: versaoDoCodigo(),
      // A mesma frase de data que o agente recebe. Serve de teste rápido de
      // três coisas ao mesmo tempo: build atualizado, relógio da máquina certo
      // e fuso horário resolvendo. Um curl responde o que antes era palpite.
      agora: contextoDeAgora("America/Cuiaba"),
      banco: await diagnosticoDoBanco(),
      trace_id: traceId,
    });
  }

  // Tudo sob /v1 exige chave de API.
  if (partes[0] === "v1") {
    return await roteasApi(req, res, metodo, partes.slice(1), url);
  }

  if (!servirEstaticos) {
    throw erro(404, "not_found", `Rota ${metodo} ${caminho} não existe.`);
  }
  return await servirEstatico(res, caminho);
}

async function roteasApi(
  req: IncomingMessage,
  res: ServerResponse,
  metodo: string,
  p: string[],
  url: URL,
): Promise<void> {
  // POST /v1/runs
  if (metodo === "POST" && p[0] === "runs" && p.length === 1) {
    const chave = await exigirChave(req, "runs:write");
    return await executarAgente(req, res, chave, url);
  }

  // GET /v1/agents — todos com ?all=1 (painel), só habilitados sem (execução)
  if (metodo === "GET" && p[0] === "agents" && p.length === 1) {
    const chave = await exigirChave(req, "runs:write");
    const agentes =
      url.searchParams.get("all") === "1"
        ? await listAllAgentsInOrg(chave.org_id)
        : await listAgentsInOrg(chave.org_id);
    return ok(
      res,
      agentes.map((a) => ({
        slug: a.slug,
        name: a.name,
        description: a.description,
        model: a.model,
        effort: a.effort,
        enabled: a.enabled,
      })),
    );
  }

  // POST /v1/agents — cria um agente
  if (metodo === "POST" && p[0] === "agents" && p.length === 1) {
    const chave = await exigirChave(req, "runs:write");
    const corpo = await lerJson(req);
    try {
      const agente = await createAgent(chave.org_id, corpo as DadosAgente);
      return ok(res, agente, 201);
    } catch (e) {
      throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
    }
  }

  // ---- Treinamento do agente ----
  if (p[0] === "agents" && p[2] === "training") {
    const chave = await exigirChave(req, "runs:write");
    const agente = await getAgentInOrg(chave.org_id, p[1]!);
    if (!agente) throw erro(404, "not_found", `Agente "${p[1]}" não encontrado.`);

    // GET /v1/agents/:slug/training
    if (metodo === "GET" && p.length === 3) {
      return ok(
        res,
        listTraining(agente).map((i) => ({
          id: i.id,
          kind: i.kind,
          titulo: i.titulo,
          arquivo: i.arquivo,
          tamanho: i.conteudo.length,
          criado_em: i.criado_em,
        })),
      );
    }

    // POST /v1/agents/:slug/training — texto digitado (JSON)
    if (metodo === "POST" && p.length === 3) {
      const corpo = await lerJson(req);
      try {
        const item = await addTrainingText({
          agent: agente,
          titulo: texto(corpo, "titulo"),
          conteudo: texto(corpo, "conteudo"),
        });
        return ok(res, { id: item.id, titulo: item.titulo, tamanho: item.conteudo.length }, 201);
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Falha no treinamento.");
      }
    }

    // POST /v1/agents/:slug/training/upload — arquivo cru no corpo, metadados
    // na query string. Sem JSON e sem base64: o arquivo trafega do jeito que é,
    // ~25% mais leve do que embrulhado em base64 dentro de um JSON — o que
    // importa sob qualquer limite de tamanho de corpo imposto por um proxy.
    if (metodo === "POST" && p[3] === "upload" && p.length === 4) {
      const nomeArquivo = url.searchParams.get("nome_arquivo");
      const mediaType = url.searchParams.get("media_type");
      if (!nomeArquivo || !mediaType) {
        throw erro(400, "invalid_request", 'Informe "nome_arquivo" e "media_type" na URL.');
      }
      const arquivo = await lerBinario(req, LIMITE_ARQUIVO_BYTES);
      if (arquivo.byteLength === 0) {
        throw erro(400, "invalid_request", "O arquivo chegou vazio — tente enviar de novo.");
      }
      try {
        const item = await addTrainingFile({
          agent: agente,
          titulo: url.searchParams.get("titulo") ?? "",
          nomeArquivo,
          mediaType,
          arquivo,
        });
        return ok(res, { id: item.id, titulo: item.titulo, tamanho: item.conteudo.length }, 201);
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Falha no treinamento.");
      }
    }

    // DELETE /v1/agents/:slug/training/:id
    if (metodo === "DELETE" && p.length === 4) {
      try {
        await removeTraining(agente, p[3]!);
        return ok(res, { removido: true });
      } catch (e) {
        throw erro(404, "not_found", e instanceof Error ? e.message : "Item não encontrado.");
      }
    }
  }

  // GET | PATCH /v1/agents/:slug — detalhe (com o prompt) e edição
  if (p[0] === "agents" && p.length === 2) {
    const chave = await exigirChave(req, "runs:write");
    const slug = p[1]!;

    if (metodo === "GET") {
      const agente = await getAgentInOrg(chave.org_id, slug);
      if (!agente) throw erro(404, "not_found", `Agente "${slug}" não encontrado.`);
      return ok(res, agente);
    }

    // DELETE /v1/agents/:slug — apaga (só agente que nunca atendeu)
    if (metodo === "DELETE") {
      // O agente que está no ar não se apaga: o conector aponta para este
      // slug, e sumir com ele deixaria a sessão do WhatsApp conectada
      // atendendo em nome de um agente que não existe mais — o mesmo
      // 'Agente "" não encontrado' que já nos custou uma tarde.
      //
      // TODAS as casas da organização são conferidas: com mais de um
      // estabelecimento, o agente pode estar atendendo na segunda casa e a
      // primeira dizer que está tudo livre.
      const { data: casas } = await db()
        .from("venues")
        .select("settings")
        .eq("org_id", chave.org_id)
        .eq("active", true);
      for (const casa of casas ?? []) {
        const noAr = lerEstadoPonte(casa.settings ?? null, "agente");
        if (noAr?.agentSlug === slug && noAr.status === "conectado") {
          throw erro(
            409,
            "agente_no_ar",
            "Este agente está atendendo no WhatsApp agora. Desconecte o WhatsApp dele em Canais do agente antes de excluir.",
          );
        }
      }

      try {
        await excluirAgente(chave.org_id, slug);
        return ok(res, { excluido: true });
      } catch (e) {
        if (e instanceof AgenteEmUso) throw erro(409, "agente_com_historico", e.message);
        const msg = e instanceof Error ? e.message : "Falha ao excluir.";
        throw msg.includes("não encontrado") ? erro(404, "not_found", msg) : erro(400, "invalid_request", msg);
      }
    }

    if (metodo === "PATCH") {
      const corpo = await lerJson(req);
      // O slug identifica a rota; trocá-lo aqui quebraria conversas e o
      // conector do WhatsApp que apontam para ele.
      delete (corpo as Record<string, unknown>).slug;
      try {
        return ok(res, await updateAgent(chave.org_id, slug, corpo as DadosAgente));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Dados inválidos.";
        throw msg.includes("não encontrado")
          ? erro(404, "not_found", msg)
          : erro(400, "invalid_request", msg);
      }
    }
  }

  // GET /v1/venues
  if (metodo === "GET" && p[0] === "venues" && p.length === 1) {
    const chave = await exigirChave(req, "reservations:read");
    const venues = await listVenuesInOrg(chave.org_id);
    return ok(res, venues.map((v) => ({ slug: v.slug, name: v.name, timezone: v.timezone })));
  }

  // GET | PATCH /v1/venues/:slug — dados cadastrais completos e edição
  if (p[0] === "venues" && p.length === 2) {
    const escopo = metodo === "GET" ? "reservations:read" : "reservations:write";
    const chave = await exigirChave(req, escopo);
    const venue = await findVenueBySlugInOrg(chave.org_id, p[1]!);

    if (metodo === "GET") {
      return ok(res, dadosDaCasaParaOPainel(venue));
    }

    if (metodo === "PATCH") {
      const corpo = await lerJson(req);
      // O slug identifica a rota e a chave do painel; não muda por aqui.
      delete (corpo as Record<string, unknown>).slug;
      try {
        const atualizado = await updateVenue(chave.org_id, venue.slug, corpo as DadosVenue);
        return ok(res, { slug: atualizado.slug, name: atualizado.name });
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
      }
    }
  }

  // /v1/venues/:slug/...
  if (p[0] === "venues" && p.length >= 3) {
    const slug = p[1]!;
    const recurso = p[2]!;

    // GET /v1/venues/:slug/reservations — pendentes; ?status=approved traz as
    // confirmadas que ainda vão acontecer
    if (metodo === "GET" && recurso === "reservations") {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      if (url.searchParams.get("status") === "approved") {
        return ok(res, await listUpcomingApproved(venue.id));
      }
      return ok(res, await listPendingReservations(venue.id));
    }

    // A trava de módulo fica aqui, no reconhecimento do recurso, e não rota a
    // rota: assim uma rota nova do mesmo módulo já nasce protegida, em vez de
    // depender de alguém lembrar de repetir a linha.
    const MODULO_DO_RECURSO: Record<string, string> = {
      avaliacoes: "avaliacoes",
      "avaliacoes-perfil": "avaliacoes",
      checklists: "checklist",
      "checklist-runs": "checklist",
      insumos: "cmv",
      categorias: "cmv",
      "estoque-locais": "cmv",
      compras: "cmv",
      fichas: "cmv",
      contagens: "cmv",
      fornecedores: "cmv",
      estoque: "cmv",
      cmv: "cmv",
      producoes: "cmv",
      faturamento: "cmv",
      vendas: "cmv",
      consumo: "cmv",
      jogos: "agentes-ia",
      programacao: "agentes-ia",
      conversations: "agentes-ia",
      pesquisa: "pesquisa",
      clientes: "clientes",
      aniversariantes: "clientes",
      cardapio: "cardapio-digital",
    };
    const moduloExigido = MODULO_DO_RECURSO[recurso];
    if (moduloExigido) {
      const quem = await exigirChave(req, "reservations:read");
      // A casa sai do slug da própria URL, e não de um parâmetro: assim a
      // trava confere o contrato DA CASA QUE A ROTA VAI MEXER, e não o de
      // outra que o chamador tenha resolvido citar.
      const casa = await findVenueBySlugInOrg(quem.org_id, slug);
      await exigirModulo(quem, moduloExigido, casa.id);
    }

    // GET /v1/venues/:slug/modulos — quais favos acendem na colmeia deste
    // cliente, e para onde vão os que moram fora do painel.
    if (metodo === "GET" && recurso === "modulos" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await listarModulos(venue.id));
    }


    // ---- CMV: estoque, compras e recebimento ----

    // GET /v1/venues/:slug/estoque-locais
    if (metodo === "GET" && recurso === "estoque-locais" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDeEstoque(() => listarLocais(venue.id)));
    }

    // GET /v1/venues/:slug/insumos?busca=&local=
    if (metodo === "GET" && recurso === "insumos" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(
        res,
        await comErroDeEstoque(() =>
          listarInsumos({
            venueId: venue.id,
            busca: url.searchParams.get("busca") ?? undefined,
            localId: url.searchParams.get("local") ?? undefined,
          }),
        ),
      );
    }

    // POST /v1/venues/:slug/insumos — cria, ou devolve o que já existe
    if (metodo === "POST" && recurso === "insumos" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);
      const resultado = await comErroDeEstoque(() =>
        garantirInsumo({
          venueId: venue.id,
          nome: texto(corpo, "nome"),
          unidade: textoOpcional(corpo, "unidade"),
          codigo: textoOpcional(corpo, "codigo") ?? null,
          categoria: textoOpcional(corpo, "categoria") ?? null,
        }),
      );
      // 200 e não 201 quando já existia: para a tela saber que não criou
      // nada, e poder dizer "esse já estava cadastrado" em vez de fingir.
      return ok(res, resultado, resultado.criado ? 201 : 200);
    }

    // POST /v1/venues/:slug/estoque-locais — cria um local
    if (metodo === "POST" && recurso === "estoque-locais" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);
      const local = await comErroDeEstoque(() =>
        criarLocal({
          venueId: venue.id,
          nome: texto(corpo, "nome"),
          tipo: textoOpcional(corpo, "tipo"),
        }),
      );
      return ok(res, local, 201);
    }

    // PATCH /v1/venues/:slug/estoque-locais/:id — renomeia ou muda o tipo
    if (metodo === "PATCH" && recurso === "estoque-locais" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = (await lerJson(req)) as Record<string, unknown>;
      await comErroDeEstoque(() =>
        atualizarLocal({
          venueId: venue.id,
          localId: p[3]!,
          nome: typeof corpo.nome === "string" ? corpo.nome : undefined,
          tipo: typeof corpo.tipo === "string" ? corpo.tipo : undefined,
        }),
      );
      return ok(res, { salvo: true });
    }

    // GET | POST /v1/venues/:slug/categorias — o cadastro de categorias
    if (recurso === "categorias" && p.length === 3) {
      if (metodo === "GET") {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        return ok(res, await comErroDeEstoque(() => listarCategorias(venue.id)));
      }
      if (metodo === "POST") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = await lerJson(req);
        const resultado = await comErroDeEstoque(() =>
          garantirCategoria({ venueId: venue.id, nome: texto(corpo, "nome") }),
        );
        return ok(res, resultado, resultado.criada ? 201 : 200);
      }
    }

    // DELETE /v1/venues/:slug/categorias/:id — desativa e solta os itens
    if (metodo === "DELETE" && recurso === "categorias" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await comErroDeEstoque(() => desativarCategoria(venue.id, p[3]!));
      return ok(res, { desativada: true });
    }

    // DELETE /v1/venues/:slug/estoque-locais/:id — desativa (nunca apaga)
    if (metodo === "DELETE" && recurso === "estoque-locais" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await comErroDeEstoque(() => desativarLocal(venue.id, p[3]!));
      return ok(res, { desativado: true });
    }

    // DELETE /v1/venues/:slug/insumos/:id — apaga (só item sem movimento)
    if (metodo === "DELETE" && recurso === "insumos" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await comErroDeEstoque(() => excluirInsumo(venue.id, p[3]!));
      return ok(res, { excluido: true });
    }

    // PATCH /v1/venues/:slug/insumos/:id — edita cadastro
    if (metodo === "PATCH" && recurso === "insumos" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req) as Record<string, unknown>;
      await comErroDeEstoque(() =>
        atualizarInsumo({
          venueId: venue.id,
          insumoId: p[3]!,
          nome: typeof corpo.nome === "string" ? corpo.nome : undefined,
          unidade: typeof corpo.unidade === "string" ? corpo.unidade : undefined,
          categoria: "categoria" in corpo ? (corpo.categoria as string | null) : undefined,
          codigo: "codigo" in corpo ? (corpo.codigo as string | null) : undefined,
          estoqueMinimo: "estoque_minimo" in corpo ? numeroOuNulo(corpo.estoque_minimo) : undefined,
          toleranciaPct: "tolerancia_pct" in corpo ? (numeroOuNulo(corpo.tolerancia_pct) ?? 0) : undefined,
          fornecedorId: "fornecedor_id" in corpo ? (corpo.fornecedor_id as string | null) : undefined,
          entraNoCmv: typeof corpo.entra_no_cmv === "boolean" ? corpo.entra_no_cmv : undefined,
          ativo: typeof corpo.ativo === "boolean" ? corpo.ativo : undefined,
        }),
      );
      return ok(res, { salvo: true });
    }

    // POST /v1/venues/:slug/fichas/sugerir — a IA propõe a receita
    //
    // Só PROPÕE: devolve para a tela preencher o formulário, e quem salva é
    // a pessoa. Gravar direto criaria fichas que ninguém olhou, e ficha não
    // olhada é custo inventado esperando virar preço de cardápio.
    if (metodo === "POST" && recurso === "fichas" && p[3] === "sugerir" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);
      const cadastrados = await comErroDeEstoque(() => listarInsumos({ venueId: venue.id }));
      try {
        const sugestao = await sugerirFicha({
          prato: texto(corpo, "prato"),
          observacao: textoOpcional(corpo, "observacao") ?? null,
          vocabulario: cadastrados.map((i) => ({
            id: i.id,
            nome: i.nome,
            unidade: i.unidade,
            categoria: i.categoria,
          })),
        });
        return ok(res, sugestao);
      } catch (e) {
        throw erro(422, "sugestao_falhou", e instanceof Error ? e.message : "A IA não conseguiu propor a ficha.");
      }
    }

    // GET /v1/venues/:slug/fichas — com custo por porção
    if (metodo === "GET" && recurso === "fichas" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDeEstoque(() => listarFichas(venue.id)));
    }

    // POST /v1/venues/:slug/fichas — cria ou atualiza (id no corpo)
    if (metodo === "POST" && recurso === "fichas" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req) as Record<string, unknown>;
      const ingredientes = Array.isArray(corpo.ingredientes)
        ? corpo.ingredientes.map((i) => {
            const ing = i as Record<string, unknown>;
            return {
              insumoId: String(ing.insumo_id ?? ""),
              quantidade: Number(ing.quantidade ?? 0),
              observacao: typeof ing.observacao === "string" ? ing.observacao : null,
            };
          })
        : [];
      const id = await comErroDeEstoque(() =>
        salvarFicha({
          venueId: venue.id,
          fichaId: typeof corpo.id === "string" ? corpo.id : null,
          nome: texto(corpo, "nome"),
          rendimento: Number(corpo.rendimento ?? 1),
          precoVenda: numeroOuNulo(corpo.preco_venda),
          itemId: typeof corpo.item_id === "string" ? corpo.item_id : null,
          ingredientes,
          confirmar: corpo.confirmar === true,
        }),
      );
      return ok(res, { id });
    }

    // DELETE /v1/venues/:slug/fichas/:id — desativa
    if (metodo === "DELETE" && recurso === "fichas" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await comErroDeEstoque(() => apagarFicha(venue.id, p[3]!));
      return ok(res, { removida: true });
    }

    // GET /v1/venues/:slug/compras?status= — pedidos e histórico
    if (metodo === "GET" && recurso === "compras" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(
        res,
        await comErroDeEstoque(() =>
          listarCompras({ venueId: venue.id, status: url.searchParams.get("status") ?? undefined }),
        ),
      );
    }

    // GET /v1/venues/:slug/compras/:id — com itens, para conferir na doca
    if (metodo === "GET" && recurso === "compras" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDeEstoque(() => obterCompra(venue.id, p[3]!)));
    }

    // GET | POST /v1/venues/:slug/fornecedores
    if (recurso === "fornecedores" && p.length === 3) {
      if (metodo === "GET") {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        return ok(res, await comErroDeEstoque(() => listarFornecedores(venue.id)));
      }
      if (metodo === "POST") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = await lerJson(req) as Record<string, unknown>;
        const id = await comErroDeEstoque(() =>
          salvarFornecedor({
            venueId: venue.id,
            fornecedorId: typeof corpo.id === "string" ? corpo.id : null,
            nome: texto(corpo, "nome"),
            cnpj: textoOpcional(corpo, "cnpj") ?? null,
            telefone: textoOpcional(corpo, "telefone") ?? null,
            email: textoOpcional(corpo, "email") ?? null,
            cicloCompraDias: numeroOuNulo(corpo.ciclo_compra_dias) ?? 7,
            observacoes: textoOpcional(corpo, "observacoes") ?? null,
            ativo: typeof corpo.ativo === "boolean" ? corpo.ativo : undefined,
          }),
        );
        return ok(res, { id });
      }
    }

    // GET /v1/venues/:slug/estoque/posicao — valorizada, por local
    if (metodo === "GET" && recurso === "estoque" && p[3] === "posicao" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDeEstoque(() => posicaoEstoque(venue.id)));
    }

    // GET /v1/venues/:slug/estoque/extrato/:insumoId — o kardex
    if (metodo === "GET" && recurso === "estoque" && p[3] === "extrato" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:read");
      await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(
        res,
        await comErroDeEstoque(() => extratoInsumo(p[4]!, url.searchParams.get("local"))),
      );
    }

    // POST /v1/venues/:slug/estoque/transferir
    if (metodo === "POST" && recurso === "estoque" && p[3] === "transferir" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req) as Record<string, unknown>;
      await comErroDeEstoque(() =>
        transferir({
          venueId: venue.id,
          insumoId: texto(corpo, "insumo_id"),
          deLocal: texto(corpo, "de_local"),
          paraLocal: texto(corpo, "para_local"),
          quantidade: numeroOuNulo(corpo.quantidade) ?? 0,
          chave: textoOpcional(corpo, "chave") ?? null,
        }),
      );
      return ok(res, { transferido: true });
    }

    // POST /v1/venues/:slug/estoque/perda
    if (metodo === "POST" && recurso === "estoque" && p[3] === "perda" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req) as Record<string, unknown>;
      await comErroDeEstoque(() =>
        registrarPerda({
          venueId: venue.id,
          insumoId: texto(corpo, "insumo_id"),
          localId: texto(corpo, "local_id"),
          quantidade: numeroOuNulo(corpo.quantidade) ?? 0,
          motivo: texto(corpo, "motivo"),
          chave: textoOpcional(corpo, "chave") ?? null,
        }),
      );
      return ok(res, { registrada: true });
    }

    // GET /v1/venues/:slug/estoque/sugestao-compra — o que pedir, por consumo
    if (metodo === "GET" && recurso === "estoque" && p[3] === "sugestao-compra" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDeEstoque(() => sugestaoCompra(venue.id)));
    }

    // GET /v1/venues/:slug/cmv?inicio=AAAA-MM-DD&fim=AAAA-MM-DD — o painel
    // GET /v1/venues/:slug/cmv/engenharia?inicio=&fim= — popularidade × margem
    if (metodo === "GET" && recurso === "cmv" && p[3] === "engenharia" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const hoje = hojeNaCasa(venue.timezone);
      const inicio = url.searchParams.get("inicio") ?? hoje.slice(0, 8) + "01";
      const fim = url.searchParams.get("fim") ?? hoje;
      return ok(
        res,
        await comErroDeEstoque(() => engenhariaDoCardapio({ venueId: venue.id, inicio, fim })),
      );
    }

    // GET | PUT /v1/venues/:slug/cmv/avisos — quem recebe e a partir de quanto
    if (recurso === "cmv" && p[3] === "avisos" && p.length === 4) {
      if (metodo === "GET") {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        return ok(res, await configDoCmv(venue.id));
      }
      if (metodo === "PUT") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        try {
          return ok(
            res,
            await salvarConfigDoCmv(venue.id, {
              // "" apaga o número — é assim que o X desliga o aviso; ausente
              // não mexe. A mesma regra do aviso de nota baixa.
              avisar_whatsapp:
                corpo.avisar_whatsapp === undefined
                  ? undefined
                  : String(corpo.avisar_whatsapp ?? "").trim() || null,
              contagem_whatsapp:
                corpo.contagem_whatsapp === undefined
                  ? undefined
                  : String(corpo.contagem_whatsapp ?? "").trim() || null,
              aumento_preco_pct: numeroOuNulo(corpo.aumento_preco_pct) ?? undefined,
              divergencia_reais: numeroOuNulo(corpo.divergencia_reais) ?? undefined,
              avisar_estoque:
                corpo.avisar_estoque === undefined ? undefined : Boolean(corpo.avisar_estoque),
              lembrete_contagem_dias: numeroOuNulo(corpo.lembrete_contagem_dias) ?? undefined,
            }),
          );
        } catch (e) {
          throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
        }
      }
    }

    // GET /v1/venues/:slug/cmv/conciliacao — o cache de saldo bate com o razão?
    // POST /v1/venues/:slug/cmv/conciliacao/ressincronizar — reescreve o cache
    if (recurso === "cmv" && p[3] === "conciliacao") {
      if (metodo === "GET" && p.length === 4) {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        return ok(res, await comErroDeEstoque(() => conciliacaoDeSaldos(venue.id)));
      }
      if (metodo === "POST" && p[4] === "ressincronizar" && p.length === 5) {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const divergentes = await comErroDeEstoque(() => ressincronizarSaldos(venue.id));
        return ok(res, { divergentes_corrigidos: divergentes });
      }
    }

    if (metodo === "GET" && recurso === "cmv" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const hoje = new Date().toISOString().slice(0, 10);
      const inicio = url.searchParams.get("inicio") ?? hoje.slice(0, 8) + "01";
      const fim = url.searchParams.get("fim") ?? hoje;
      return ok(res, await comErroDeEstoque(() => painelCmv({ venueId: venue.id, inicio, fim })));
    }

    // POST /v1/venues/:slug/faturamento — o denominador do CMV
    if (metodo === "POST" && recurso === "faturamento" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req) as Record<string, unknown>;
      await comErroDeEstoque(() =>
        lancarFaturamento({
          venueId: venue.id,
          data: texto(corpo, "data"),
          valor: numeroOuNulo(corpo.valor) ?? -1,
        }),
      );
      return ok(res, { lancado: true });
    }

    // POST /v1/venues/:slug/producoes — baixa os insumos da ficha
    if (metodo === "POST" && recurso === "producoes" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req) as Record<string, unknown>;
      await comErroDeEstoque(() =>
        registrarProducao({
          venueId: venue.id,
          fichaId: texto(corpo, "ficha_id"),
          localId: texto(corpo, "local_id"),
          lotes: numeroOuNulo(corpo.lotes) ?? 0,
          chave: textoOpcional(corpo, "chave") ?? null,
        }),
      );
      return ok(res, { registrada: true }, 201);
    }

    // GET /v1/venues/:slug/estoque/movimentos?insumo=&tipo= — o razão da casa
    if (metodo === "GET" && recurso === "estoque" && p[3] === "movimentos" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(
        res,
        await comErroDeEstoque(() =>
          movimentosDoEstoque({
            venueId: venue.id,
            insumoId: url.searchParams.get("insumo"),
            tipo: url.searchParams.get("tipo"),
          }),
        ),
      );
    }

    // GET /v1/venues/:slug/fornecedores/:id/kardex — a conta corrente dele
    if (metodo === "GET" && recurso === "fornecedores" && p[4] === "kardex" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDeEstoque(() => kardexDoFornecedor(venue.id, p[3]!)));
    }

    // GET /v1/venues/:slug/contagens — histórico, com a quebra em reais
    if (metodo === "GET" && recurso === "contagens" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDeEstoque(() => listarContagens(venue.id)));
    }

    // GET /v1/venues/:slug/contagens/:id — a contagem aberta, item a item
    if (metodo === "GET" && recurso === "contagens" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDeEstoque(() => detalheDaContagem(venue.id, p[3]!)));
    }

    // POST /v1/venues/:slug/contagens — cria, processa e devolve os ajustes
    if (metodo === "POST" && recurso === "contagens" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req) as Record<string, unknown>;
      const itens = Array.isArray(corpo.itens)
        ? corpo.itens.map((i) => {
            const item = i as Record<string, unknown>;
            return {
              insumoId: String(item.insumo_id ?? ""),
              quantidade: Number(item.quantidade ?? NaN),
            };
          })
        : [];
      const resultado = await comErroDeEstoque(() =>
        registrarContagem({
          venueId: venue.id,
          localId: texto(corpo, "local_id"),
          itens,
          observacoes: textoOpcional(corpo, "observacoes") ?? null,
        }),
      );
      return ok(res, resultado, 201);
    }

    // POST /v1/venues/:slug/insumos/:id/apelido — ensina a grafia do fornecedor
    if (metodo === "POST" && recurso === "insumos" && p[4] === "apelido" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);
      await comErroDeEstoque(() =>
        aprenderApelido({
          venueId: venue.id,
          insumoId: p[3]!,
          descricao: texto(corpo, "descricao"),
        }),
      );
      return ok(res, { aprendido: true });
    }

    // ---- Jogos: a agenda esportiva que vira programação ----

    // GET /v1/venues/:slug/jogos?competicao=bra.1 — o que vem por aí
    if (metodo === "GET" && recurso === "jogos" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);

      // O id é o código de liga do ESPN ("bra.1"), então vem como texto — e
      // procurar na lista é o que impede uma URL com qualquer coisa dentro de
      // virar requisição para um endereço que não é nosso.
      const pedida = url.searchParams.get("competicao") ?? COMPETICOES[0].id;
      const competicao = COMPETICOES.find((c) => c.id === pedida) ?? COMPETICOES[0];
      try {
        const jogos = await proximosJogos({ competicaoId: competicao.id });
        // Marcar o que já está na agenda evita o erro mais provável da tela:
        // importar de novo o jogo de sábado porque ninguém lembra se marcou.
        const naAgenda = await jogosJaNaAgenda(venue.id, jogos.map((j) => j.id));
        return ok(res, {
          competicoes: COMPETICOES,
          competicao: competicao.id,
          jogos: jogos.map((j) => ({ ...j, jaNaAgenda: naAgenda.has(j.id) })),
        });
      } catch (e) {
        if (e instanceof ErroDeJogos) throw erro(e.status, "jogos_indisponiveis", e.message);
        throw e;
      }
    }

    // POST /v1/venues/:slug/jogos — põe os escolhidos na programação
    if (metodo === "POST" && recurso === "jogos" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = (await lerJson(req)) as Record<string, unknown>;
      const escolhidos = Array.isArray(corpo.jogos) ? corpo.jogos : [];
      try {
        const r = await importarJogos({
          venueId: venue.id,
          // A tela devolve o jogo inteiro, e não só o id: assim a criação não
          // precisa de uma segunda consulta à API — que gastaria cota para
          // buscar o que a pessoa está vendo na tela.
          jogos: escolhidos as Parameters<typeof importarJogos>[0]["jogos"],
        });
        return ok(res, r, 201);
      } catch (e) {
        if (e instanceof ErroDeJogos) throw erro(e.status, "jogos_indisponiveis", e.message);
        throw e;
      }
    }

    // ---- Programação lida por IA: cola-se o texto, manda-se o cartaz ----

    // POST /v1/venues/:slug/programacao/ler
    //
    // Com `media_type` na URL, o arquivo vai cru no corpo (foto do cartaz,
    // planilha, PDF). Sem ele, o corpo é JSON com o texto colado. Só LÊ: quem
    // grava é a rota de baixo, depois que alguém conferiu na tela.
    if (metodo === "POST" && recurso === "programacao" && p[3] === "ler" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const hoje = hojeNaCasa(venue.timezone);

      const mediaType = url.searchParams.get("media_type");
      try {
        if (mediaType) {
          if (!tipoDeAgendaAceito(mediaType)) {
            throw erro(400, "invalid_request", "Mande foto, PDF, Excel ou CSV.");
          }
          const arquivo = await lerBinario(req, LIMITE_ARQUIVO_BYTES);
          if (arquivo.length === 0) throw erro(400, "invalid_request", "O arquivo chegou vazio.");
          return ok(res, await lerProgramacao({ arquivo, mediaType, hoje }));
        }
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        return ok(res, await lerProgramacao({ texto: texto(corpo, "texto"), hoje }));
      } catch (e) {
        // Erro de leitura é recado para quem está na tela ("mande outra foto"),
        // não falha de servidor — mas o `erro()` acima já vem pronto.
        if (e && typeof e === "object" && "status" in e) throw e;
        throw erro(422, "leitura_falhou", e instanceof Error ? e.message : "Não consegui ler esta agenda.");
      }
    }

    // POST /v1/venues/:slug/programacao/importar — grava o que foi conferido
    if (metodo === "POST" && recurso === "programacao" && p[3] === "importar" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = (await lerJson(req)) as Record<string, unknown>;
      const eventos = Array.isArray(corpo.eventos) ? (corpo.eventos as EventoParaGravar[]) : [];
      try {
        return ok(
          res,
          await importarProgramacao({ venueId: venue.id, fuso: venue.timezone, eventos }),
          201,
        );
      } catch (e) {
        if (e instanceof ErroDeAgenda) throw erro(e.status, "agenda_invalida", e.message);
        throw e;
      }
    }

    // ---- Pesquisa de satisfação ----

    // GET /v1/venues/:slug/pesquisa?dias=30 — o painel inteiro
    if (metodo === "GET" && recurso === "pesquisa" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(
        res,
        await comErroDePesquisa(() =>
          painelDaPesquisa({
            venueId: venue.id,
            fuso: venue.timezone,
            dias: numeroOuNulo(url.searchParams.get("dias")) ?? 30,
          }),
        ),
      );
    }

    // GET /v1/venues/:slug/pesquisa/respostas?dias=&nota_max=
    if (metodo === "GET" && recurso === "pesquisa" && p[3] === "respostas" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const notaMaxima = numeroOuNulo(url.searchParams.get("nota_max"));
      return ok(
        res,
        await comErroDePesquisa(() =>
          listarRespostas({
            venueId: venue.id,
            dias: numeroOuNulo(url.searchParams.get("dias")) ?? 30,
            notaMaxima: notaMaxima ?? undefined,
          }),
        ),
      );
    }

    // POST | DELETE /v1/venues/:slug/logo — a marca da casa
    //
    // O arquivo vai cru no corpo, como as outras rotas de upload. A logo é da
    // CASA e não do módulo de pesquisa: quem tem só o cardápio ou só o
    // checklist também sobe a dele por aqui.
    if (recurso === "logo" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);

      if (metodo === "DELETE") {
        await apagarLogoAntiga(venue.logo_url);
        return ok(res, await updateVenueLogo(venue.id, null));
      }

      if (metodo === "POST") {
        const mediaType = url.searchParams.get("media_type") ?? "";
        const arquivo = await lerBinario(req, LIMITE_LOGO_BYTES);
        let endereco: string;
        try {
          endereco = await guardarLogo({ venueId: venue.id, arquivo, contentType: mediaType });
        } catch (e) {
          throw erro(400, "invalid_request", e instanceof Error ? e.message : "Logo inválida.");
        }
        const atualizada = await updateVenueLogo(venue.id, endereco);
        // A antiga sai DEPOIS de a nova estar gravada e apontada. Na ordem
        // inversa, uma falha no meio deixaria a casa sem logo nenhuma.
        await apagarLogoAntiga(venue.logo_url);
        return ok(res, atualizada);
      }
    }

    // GET /v1/venues/:slug/pesquisa/respostas/:id — a resposta inteira
    if (metodo === "GET" && recurso === "pesquisa" && p[3] === "respostas" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(
        res,
        await comErroDePesquisa(() => respostaCompleta(venue.id, p[4]!)),
      );
    }

    // ---- O modelo: as perguntas que a casa faz ----

    // GET | POST /v1/venues/:slug/pesquisa/modelos
    if (recurso === "pesquisa" && p[3] === "modelos" && p.length === 4) {
      if (metodo === "GET") {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        return ok(res, {
          pesquisas: await comErroDeModelo(() => listarPesquisas(venue.id)),
          categorias: [...CATEGORIAS_SUGERIDAS],
        });
      }
      if (metodo === "POST") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        return ok(
          res,
          await comErroDeModelo(() =>
            criarPesquisa({
              venueId: venue.id,
              nome: texto(corpo, "nome"),
              descricao: textoOpcional(corpo, "descricao") ?? null,
              itens: corpo.itens,
              ativar: corpo.ativar === undefined ? undefined : Boolean(corpo.ativar),
            }),
          ),
          201,
        );
      }
    }

    // PATCH | DELETE /v1/venues/:slug/pesquisa/modelos/:id
    if (recurso === "pesquisa" && p[3] === "modelos" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);

      if (metodo === "PATCH") {
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        return ok(
          res,
          await comErroDeModelo(() =>
            atualizarPesquisa({
              venueId: venue.id,
              id: p[4]!,
              nome: textoOpcional(corpo, "nome"),
              descricao: corpo.descricao === undefined ? undefined : (textoOpcional(corpo, "descricao") ?? null),
              itens: corpo.itens,
              ativa: corpo.ativa === undefined ? undefined : Boolean(corpo.ativa),
            }),
          ),
        );
      }
      if (metodo === "DELETE") {
        await comErroDeModelo(() => apagarPesquisa(venue.id, p[4]!));
        return ok(res, { apagada: true });
      }
    }

    // POST /v1/venues/:slug/pesquisa/montar — a IA conversa e propõe
    if (metodo === "POST" && recurso === "pesquisa" && p[3] === "montar" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = (await lerJson(req)) as Record<string, unknown>;

      const mensagens = Array.isArray(corpo.mensagens)
        ? corpo.mensagens.map((m) => {
            const o = (m ?? {}) as Record<string, unknown>;
            return {
              papel: o.papel === "ia" ? ("ia" as const) : ("usuario" as const),
              texto: String(o.texto ?? ""),
            };
          }).filter((m) => m.texto.trim())
        : [];

      return ok(res, await comErroDeModelo(() => conversarMontagem(mensagens)));
    }

    // GET | PUT /v1/venues/:slug/pesquisa/config
    if (recurso === "pesquisa" && p[3] === "config" && p.length === 4) {
      if (metodo === "GET") {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        return ok(res, await comErroDePesquisa(() => configDaPesquisa(venue.id)));
      }
      if (metodo === "PUT") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        return ok(
          res,
          await comErroDePesquisa(() =>
            salvarConfig(venue.id, {
              ativa: corpo.ativa === undefined ? undefined : Boolean(corpo.ativa),
              saudacao: textoOpcional(corpo, "saudacao") ?? null,
              agradecimento: textoOpcional(corpo, "agradecimento") ?? null,
              premio_ativo: corpo.premio_ativo === undefined ? undefined : Boolean(corpo.premio_ativo),
              premio_titulo: textoOpcional(corpo, "premio_titulo"),
              premio_regras: textoOpcional(corpo, "premio_regras") ?? null,
              premio_validade_dias: numeroOuNulo(corpo.premio_validade_dias) ?? undefined,
              perguntar_atendente:
                corpo.perguntar_atendente === undefined ? undefined : Boolean(corpo.perguntar_atendente),
              atendente_posicao:
                corpo.atendente_posicao === undefined
                  ? undefined
                  : corpo.atendente_posicao === "apos_nps"
                    ? "apos_nps"
                    : "fim",
              perguntar_comentario:
                corpo.perguntar_comentario === undefined ? undefined : Boolean(corpo.perguntar_comentario),
              // `textoOpcional` não serve aqui: ele devolve undefined para "",
              // e "" é justamente como o X da tela diz "apague este número".
              // Com ele, desligar o aviso viraria um salvamento que não faz
              // nada — e o dono continuaria recebendo mensagem sem entender.
              detrator_avisar_whatsapp:
                corpo.detrator_avisar_whatsapp === undefined
                  ? undefined
                  : String(corpo.detrator_avisar_whatsapp ?? "").trim() || null,
              detrator_nota_maxima: numeroOuNulo(corpo.detrator_nota_maxima) ?? undefined,
            }),
          ),
        );
      }
    }

    // GET | POST /v1/venues/:slug/pesquisa/atendentes
    if (recurso === "pesquisa" && p[3] === "atendentes" && p.length === 4) {
      if (metodo === "GET") {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        return ok(
          res,
          await comErroDePesquisa(() =>
            listarAtendentes(venue.id, { incluirInativos: url.searchParams.get("todos") === "1" }),
          ),
        );
      }
      if (metodo === "POST") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        return ok(
          res,
          await comErroDePesquisa(() =>
            criarAtendente({
              venueId: venue.id,
              nome: texto(corpo, "nome"),
              apelido: textoOpcional(corpo, "apelido") ?? null,
              funcao: textoOpcional(corpo, "funcao") ?? null,
            }),
          ),
          201,
        );
      }
    }

    // PATCH | DELETE /v1/venues/:slug/pesquisa/atendentes/:id
    if (recurso === "pesquisa" && p[3] === "atendentes" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);

      if (metodo === "PATCH") {
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        return ok(
          res,
          await comErroDePesquisa(() =>
            atualizarAtendente({
              venueId: venue.id,
              id: p[4]!,
              nome: textoOpcional(corpo, "nome"),
              apelido: corpo.apelido === undefined ? undefined : (textoOpcional(corpo, "apelido") ?? null),
              funcao: corpo.funcao === undefined ? undefined : (textoOpcional(corpo, "funcao") ?? null),
              ativo: corpo.ativo === undefined ? undefined : Boolean(corpo.ativo),
            }),
          ),
        );
      }
      if (metodo === "DELETE") {
        return ok(res, await comErroDePesquisa(() => removerAtendente(venue.id, p[4]!)));
      }
    }

    // GET /v1/venues/:slug/pesquisa/premios?situacao=aberto|resgatado|vencido
    if (metodo === "GET" && recurso === "pesquisa" && p[3] === "premios" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(
        res,
        await comErroDePesquisa(() =>
          listarPremios(venue.id, { situacao: url.searchParams.get("situacao") ?? "todos" }),
        ),
      );
    }

    // POST /v1/venues/:slug/pesquisa/premios/resgatar — o balcão baixa o cupom
    if (
      metodo === "POST" && recurso === "pesquisa" &&
      p[3] === "premios" && p[4] === "resgatar" && p.length === 5
    ) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = (await lerJson(req)) as Record<string, unknown>;
      return ok(
        res,
        await comErroDePesquisa(() =>
          resgatarPremio({
            venueId: venue.id,
            codigo: texto(corpo, "codigo"),
            usuarioId: chave.userId ?? null,
          }),
        ),
      );
    }

    // GET /v1/venues/:slug/pesquisa/qrcode?mesa=7 — o cartaz da mesa
    if (metodo === "GET" && recurso === "pesquisa" && p[3] === "qrcode" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const mesa = url.searchParams.get("mesa");
      const endereco = await enderecoDaPesquisa(venue, mesa);
      return ok(res, { url: endereco, png: await qrcodeDataUrl(endereco), mesa: mesa ?? null });
    }

    // ---- Cardápio digital: o que a casa mexe ----
    //
    // Tudo aqui passa pela trava de módulo lá em cima (recurso "cardapio").
    // Leitura com reservations:read, escrita com reservations:write — o mesmo
    // par que separa quem olha de quem mexe no resto do painel.
    if (recurso === "cardapio") {
      const acao = p[3] ?? "";

      // GET /v1/venues/:slug/cardapio — tudo que as telas do painel desenham
      if (metodo === "GET" && p.length === 3) {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const [categorias, itens, banners, promocoes, pendentes, chamados] = await comErroDoCardapio(() =>
          Promise.all([
            listarCategoriasDoPainel(venue.id),
            listarItensDoPainel(venue.id),
            listarBannersDoPainel(venue.id),
            listarPromocoesDoPainel(venue.id),
            contarComentariosPendentes(venue.id),
            chamadosRecentes(venue.id),
          ]),
        );
        return ok(res, {
          endereco: await enderecoDoCardapio(venue),
          categorias,
          itens,
          banners,
          promocoes,
          comentarios_pendentes: pendentes,
          chamados,
        });
      }

      // GET /v1/venues/:slug/cardapio/qrcode?mesa=7 — o cartaz da mesa
      if (metodo === "GET" && acao === "qrcode" && p.length === 4) {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const mesa = url.searchParams.get("mesa");
        const endereco = await enderecoDoCardapio(venue, mesa);
        return ok(res, { url: endereco, png: await qrcodeDataUrl(endereco), mesa: mesa ?? null });
      }

      // GET /v1/venues/:slug/cardapio/comentarios?situacao=pending|approved|rejected
      if (metodo === "GET" && acao === "comentarios" && p.length === 4) {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const situacao = url.searchParams.get("situacao") ?? "pending";
        if (situacao !== "pending" && situacao !== "approved" && situacao !== "rejected") {
          throw erro(400, "invalid_request", "situacao precisa ser pending, approved ou rejected.");
        }
        return ok(res, await comErroDoCardapio(() => listarComentarios(venue.id, situacao)));
      }

      // POST /v1/venues/:slug/cardapio/comentarios/:id/liberar|recusar
      if (metodo === "POST" && acao === "comentarios" && p.length === 6) {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const decisao = p[5] === "liberar" ? "approved" : p[5] === "recusar" ? "rejected" : null;
        if (!decisao) throw erro(404, "not_found", `Ação "${p[5]}" não existe.`);
        return ok(
          res,
          await comErroDoCardapio(() =>
            moderarComentario({ venueId: venue.id, id: p[4]!, decisao, quem: chave.name, userId: chave.userId }),
          ),
        );
      }

      // Daqui para baixo é escrita.
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);

      // PUT /v1/venues/:slug/cardapio/{categorias|itens|banners}/ordem  { ids }
      if (metodo === "PUT" && p[4] === "ordem" && p.length === 5) {
        const tabela = acao === "categorias" ? "categories" : acao === "itens" ? "items" : acao === "banners" ? "banners" : null;
        if (!tabela) throw erro(404, "not_found", "Só categorias, itens e banners têm ordem.");
        const corpo = await lerJson(req);
        await comErroDoCardapio(() => reordenar(tabela, venue.id, corpo.ids));
        return ok(res, { reordenado: true });
      }

      // ---- categorias ----
      if (acao === "categorias") {
        if (metodo === "POST" && p.length === 4) {
          const corpo = (await lerJson(req)) as DadosDaCategoria;
          return ok(res, await comErroDoCardapio(() => criarCategoria(venue.id, corpo)), 201);
        }
        if (metodo === "PATCH" && p.length === 5) {
          const corpo = (await lerJson(req)) as DadosDaCategoria;
          await comErroDoCardapio(() => atualizarCategoria(venue.id, p[4]!, corpo));
          return ok(res, { salvo: true });
        }
        if (metodo === "DELETE" && p.length === 5) {
          await comErroDoCardapio(() => apagarCategoria(venue.id, p[4]!));
          return ok(res, { removido: true });
        }
        // POST /cardapio/categorias/:id/imagem?media_type=
        if (metodo === "POST" && p[5] === "imagem" && p.length === 6) {
          const arquivo = await lerBinario(req, LIMITE_MIDIA_BYTES);
          return ok(
            res,
            await comErroDoCardapio(() =>
              trocarImagemDaCategoria({
                venueId: venue.id,
                categoriaId: p[4]!,
                arquivo,
                contentType: url.searchParams.get("media_type") ?? "",
              }),
            ),
          );
        }
      }

      // ---- itens ----
      if (acao === "itens") {
        if (metodo === "POST" && p.length === 4) {
          const corpo = (await lerJson(req)) as DadosDoItem;
          return ok(res, await comErroDoCardapio(() => criarItem(venue.id, corpo)), 201);
        }
        if (metodo === "PATCH" && p.length === 5) {
          const corpo = (await lerJson(req)) as DadosDoItem;
          await comErroDoCardapio(() => atualizarItem(venue.id, p[4]!, corpo));
          return ok(res, { salvo: true });
        }
        if (metodo === "DELETE" && p.length === 5) {
          await comErroDoCardapio(() => apagarItem(venue.id, p[4]!));
          return ok(res, { removido: true });
        }
        // PUT /cardapio/itens/:id/variacoes  { grupos: [...] }
        if (metodo === "PUT" && p[5] === "variacoes" && p.length === 6) {
          const corpo = await lerJson(req);
          await comErroDoCardapio(() => salvarVariacoes(venue.id, p[4]!, corpo.grupos));
          return ok(res, { salvo: true });
        }
        // POST /cardapio/itens/:id/midia?media_type=  (corpo cru)
        if (metodo === "POST" && p[5] === "midia" && p.length === 6) {
          const arquivo = await lerBinario(req, LIMITE_MIDIA_BYTES);
          return ok(
            res,
            await comErroDoCardapio(() =>
              adicionarMidiaAoItem({
                venueId: venue.id,
                itemId: p[4]!,
                arquivo,
                contentType: url.searchParams.get("media_type") ?? "",
              }),
            ),
            201,
          );
        }
        // DELETE /cardapio/itens/:id/midia/:midiaId
        if (metodo === "DELETE" && p[5] === "midia" && p.length === 7) {
          await comErroDoCardapio(() => removerMidiaDoItem({ venueId: venue.id, itemId: p[4]!, midiaId: p[6]! }));
          return ok(res, { removido: true });
        }
        // POST /cardapio/itens/:id/midia/:midiaId/capa
        if (metodo === "POST" && p[5] === "midia" && p[7] === "capa" && p.length === 8) {
          await comErroDoCardapio(() => definirCapaDoItem({ venueId: venue.id, itemId: p[4]!, midiaId: p[6]! }));
          return ok(res, { salvo: true });
        }
      }

      // ---- banners ----
      if (acao === "banners") {
        if (metodo === "POST" && p.length === 4) {
          const corpo = (await lerJson(req)) as DadosDoBanner;
          return ok(res, await comErroDoCardapio(() => criarBanner(venue.id, corpo)), 201);
        }
        if (metodo === "PATCH" && p.length === 5) {
          const corpo = (await lerJson(req)) as DadosDoBanner;
          await comErroDoCardapio(() => atualizarBanner(venue.id, p[4]!, corpo));
          return ok(res, { salvo: true });
        }
        if (metodo === "DELETE" && p.length === 5) {
          await comErroDoCardapio(() => apagarBanner(venue.id, p[4]!));
          return ok(res, { removido: true });
        }
        // POST /cardapio/banners/:id/midia?media_type=  — foto ou vídeo
        if (metodo === "POST" && p[5] === "midia" && p.length === 6) {
          const arquivo = await lerBinario(req, LIMITE_MIDIA_BYTES);
          return ok(
            res,
            await comErroDoCardapio(() =>
              trocarMidiaDoBanner({
                venueId: venue.id,
                bannerId: p[4]!,
                arquivo,
                contentType: url.searchParams.get("media_type") ?? "",
              }),
            ),
          );
        }
      }

      // ---- promoções ----
      if (acao === "promocoes") {
        if (metodo === "POST" && p.length === 4) {
          const corpo = (await lerJson(req)) as DadosDaPromocao;
          return ok(res, await comErroDoCardapio(() => criarPromocao(venue.id, corpo)), 201);
        }
        if (metodo === "PATCH" && p.length === 5) {
          const corpo = (await lerJson(req)) as DadosDaPromocao;
          await comErroDoCardapio(() => atualizarPromocao(venue.id, p[4]!, corpo));
          return ok(res, { salvo: true });
        }
        if (metodo === "DELETE" && p.length === 5) {
          await comErroDoCardapio(() => apagarPromocao(venue.id, p[4]!));
          return ok(res, { removido: true });
        }
      }

      throw erro(404, "not_found", `Rota ${metodo} /v1/venues/${slug}/cardapio/${p.slice(3).join("/")} não existe.`);
    }

    // GET | POST /v1/venues/:slug/pesquisa/convites — mandar a pesquisa ao cliente
    if (recurso === "pesquisa" && p[3] === "convites" && p.length === 4) {
      if (metodo === "GET") {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        return ok(res, await comErroDePesquisa(() => listarConvites(venue.id)));
      }
      if (metodo === "POST") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        return ok(res, await comErroDePesquisa(() => convidarParaPesquisa(venue, corpo)), 201);
      }
    }

    // DELETE /v1/venues/:slug/pesquisa/convites/:id — apaga um disparo.
    // O link daquele convite morre e o número sai da trava de repetição;
    // a resposta, se existir, fica.
    if (
      metodo === "DELETE" &&
      recurso === "pesquisa" &&
      p[3] === "convites" &&
      p.length === 5
    ) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await comErroDePesquisa(() => apagarConvite(venue.id, p[4]!));
      return ok(res, { apagado: true });
    }

    // ============================================================
    // A base de clientes da casa
    // ============================================================
    //
    // Não é um módulo: é da CASA. Uma casa que só comprou o CMV cadastra
    // clientes na mão e manda parabéns; quem tem Zig e agente vê a base
    // encher sozinha. Por isso a permissão é a mesma das reservas, e não
    // uma de módulo.

    // GET | PUT /v1/venues/:slug/clientes/config — o parabéns de aniversário.
    // Antes da rota de :id de propósito: "config" não é um id.
    if (recurso === "clientes" && p[3] === "config" && p.length === 4) {
      if (metodo === "GET") {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        return ok(res, await comErroDeClientes(() => configDeClientes(venue.id)));
      }
      if (metodo === "PUT") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        return ok(
          res,
          await comErroDeClientes(() =>
            salvarConfigDeClientes(venue.id, {
              aniversario_ativo:
                corpo.aniversario_ativo === undefined ? undefined : Boolean(corpo.aniversario_ativo),
              aniversario_hora: numeroOuNulo(corpo.aniversario_hora) ?? undefined,
              aniversario_antecedencia: numeroOuNulo(corpo.aniversario_antecedencia) ?? undefined,
              // `textoOpcional` devolve undefined para "" — e "" aqui é como a
              // tela diz "volte ao texto padrão". Sem isto, limpar o campo
              // viraria um salvamento que não faz nada.
              aniversario_texto:
                corpo.aniversario_texto === undefined
                  ? undefined
                  : String(corpo.aniversario_texto ?? "").trim() || null,
              aniversario_teto_por_dia: numeroOuNulo(corpo.aniversario_teto_por_dia) ?? undefined,
            }),
          ),
        );
      }
    }

    // POST /v1/venues/:slug/clientes/planilha?confirmar=1
    //
    // O arquivo (.xlsx ou .csv) vai cru no corpo. Sem `confirmar` é só a
    // PRÉVIA: quantas pessoas valem, quantas trazem aniversário, quantas já
    // estão na base e quais linhas foram recusadas com o motivo. Ninguém
    // despeja mil linhas na base de clientes sem antes ver esse resumo.
    //
    // Antes da rota de :id de propósito: "planilha" não é um id.
    if (metodo === "POST" && recurso === "clientes" && p[3] === "planilha" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const arquivo = await lerBinario(req, LIMITE_ARQUIVO_BYTES);
      if (arquivo.length === 0) throw erro(400, "invalid_request", "O arquivo chegou vazio.");

      const lida = await lerPlanilhaDeClientes(arquivo);
      const comAniversario = lida.pessoas.filter(
        (pessoa) => lerNascimento(pessoa.nascimento).dia !== null,
      ).length;

      // Aniversário que a planilha trouxe mas o leitor não entendeu é o
      // silêncio mais caro daqui: a pessoa entra na base sem data, e a casa
      // só descobre no ano seguinte, quando o parabéns não sai. Dizer o
      // número na prévia transforma isso em "ah, minha coluna está errada".
      const dataIlegivel = lida.pessoas.filter(
        (pessoa) => pessoa.nascimento !== null && lerNascimento(pessoa.nascimento).dia === null,
      ).length;

      if (url.searchParams.get("confirmar") !== "1") {
        return ok(res, {
          previa: true,
          validos: lida.pessoas.length,
          com_aniversario: comAniversario,
          data_ilegivel: dataIlegivel,
          recusadas: lida.recusadas.slice(0, 30),
          total_recusadas: lida.recusadas.length,
          amostra: lida.pessoas.slice(0, 8),
        });
      }

      // Uma linha ruim não pode derrubar as outras novecentas: a planilha é
      // de gente de verdade, e importar 900 e avisar sobre 3 é infinitamente
      // melhor do que recusar o arquivo inteiro por causa de 3.
      let importados = 0;
      const falhas: LinhaRecusada[] = [];
      for (const [i, pessoa] of lida.pessoas.entries()) {
        try {
          await registrarCliente(venue.id, "planilha", {
            telefone: pessoa.telefone,
            nome: pessoa.nome,
            nascimento: pessoa.nascimento,
            email: pessoa.email,
            observacoes: pessoa.observacoes,
          });
          importados++;
        } catch (e) {
          falhas.push({ linha: i + 1, motivo: (e as Error).message });
        }
      }

      return ok(
        res,
        {
          previa: false,
          importados,
          com_aniversario: comAniversario,
          data_ilegivel: dataIlegivel,
          recusadas: [...lida.recusadas, ...falhas].slice(0, 30),
          total_recusadas: lida.recusadas.length + falhas.length,
        },
        201,
      );
    }

    // GET | POST /v1/venues/:slug/clientes
    if (recurso === "clientes" && p.length === 3) {
      if (metodo === "GET") {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const origem = url.searchParams.get("origem");
        const lista = await comErroDeClientes(() =>
          listarClientesDaCasa(venue.id, {
            busca: url.searchParams.get("busca") ?? undefined,
            origem: (origem as OrigemDeCliente | null) ?? undefined,
            comAniversario: url.searchParams.get("aniversario") === "1",
            mes: Number(url.searchParams.get("mes")) || undefined,
            limite: Number(url.searchParams.get("limite")) || undefined,
          }),
        );
        // A nota que cada um deu, quando a casa tem a pesquisa. Numa consulta
        // só, e sem travar a lista: casa sem o módulo recebe o mapa vazio e a
        // etiqueta simplesmente não aparece.
        const notas = await notasPorCliente(venue.id, lista.map((c) => c.id));
        return ok(res, lista.map((c) => ({ ...c, nps: notas.get(c.id) ?? null })));
      }
      if (metodo === "POST") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        return ok(
          res,
          await comErroDeClientes(() =>
            registrarCliente(venue.id, "manual", {
              telefone: texto(corpo, "telefone"),
              nome: textoOpcional(corpo, "nome") ?? null,
              nascimento: textoOpcional(corpo, "nascimento") ?? null,
              email: textoOpcional(corpo, "email") ?? null,
              documento: textoOpcional(corpo, "documento") ?? null,
              observacoes: textoOpcional(corpo, "observacoes") ?? null,
            }),
          ),
          201,
        );
      }
    }

    // GET /v1/venues/:slug/clientes/:id/avaliacoes — o que esta pessoa achou
    // da casa. Vive na ficha do cliente, não numa tela separada: é sobre ela.
    if (
      metodo === "GET" &&
      recurso === "clientes" &&
      p[4] === "avaliacoes" &&
      p.length === 5
    ) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDePesquisa(() => avaliacoesDoCliente(venue.id, p[3]!)));
    }

    // POST /v1/venues/:slug/clientes/zig — puxar a Zig agora, na mão.
    //
    // A varredura já faz isto sozinha de hora em hora. O botão existe porque
    // "está funcionando?" precisa de uma resposta em cinco segundos, e não no
    // dia seguinte — e porque no primeiro dia ninguém quer esperar o relógio.
    if (
      metodo === "POST" &&
      recurso === "clientes" &&
      p[3] === "zig" &&
      p.length === 4
    ) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = (await lerJson(req).catch(() => ({}))) as Record<string, unknown>;
      const dia = typeof corpo.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(corpo.dia)
        ? corpo.dia
        : undefined;
      return ok(
        res,
        await comErroDePesquisa(() =>
          alimentarBasePelaZig(venue, { dia, forcar: corpo.forcar === true }),
        ),
      );
    }

    // GET /v1/venues/:slug/clientes/:id/visitas — quando veio e quanto gastou.
    if (
      metodo === "GET" &&
      recurso === "clientes" &&
      p[4] === "visitas" &&
      p.length === 5
    ) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDeClientes(() => visitasDoCliente(venue.id, p[3]!)));
    }

    // PATCH | DELETE /v1/venues/:slug/clientes/:id
    if (recurso === "clientes" && p.length === 4) {
      if (metodo === "PATCH") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        // Aqui o vazio APAGA: quem abriu a ficha e limpou o campo quis limpar.
        // É o oposto da coleta automática, e é de propósito.
        const campo = (nome: string) =>
          corpo[nome] === undefined ? undefined : String(corpo[nome] ?? "");
        return ok(
          res,
          await comErroDeClientes(() =>
            editarCliente(venue.id, p[3]!, {
              nome: campo("nome"),
              nascimento: campo("nascimento"),
              email: campo("email"),
              documento: campo("documento"),
              observacoes: campo("observacoes"),
              descadastrado:
                corpo.descadastrado === undefined ? undefined : Boolean(corpo.descadastrado),
            }),
          ),
        );
      }
      if (metodo === "DELETE") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        await comErroDeClientes(() => apagarCliente(venue.id, p[3]!));
        return ok(res, { apagado: true });
      }
    }

    // GET /v1/venues/:slug/aniversariantes?dias=N — quem faz aniversário nos
    // próximos N dias, com o parabéns deste ano já marcado.
    if (metodo === "GET" && recurso === "aniversariantes" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const dias = Math.min(Math.max(Number(url.searchParams.get("dias")) || 30, 1), 366);
      return ok(res, await comErroDeClientes(() => proximosAniversariantes(venue, dias)));
    }

    // POST /v1/venues/:slug/aniversariantes/enviar — o "Mandar agora" do
    // painel. Ignora a HORA configurada, nunca a trava de um por ano.
    if (
      metodo === "POST" &&
      recurso === "aniversariantes" &&
      p[3] === "enviar" &&
      p.length === 4
    ) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = (await lerJson(req).catch(() => ({}))) as Record<string, unknown>;
      // Com a lista, manda só para quem o dono marcou; sem ela, a lista do dia.
      const escolhidos = Array.isArray(corpo.clientes)
        ? corpo.clientes.filter((v): v is string => typeof v === "string")
        : [];
      return ok(
        res,
        await comErroDeClientes(() =>
          mandarParabens(venue, { forcar: true, clienteIds: escolhidos }),
        ),
      );
    }

    // POST /v1/venues/:slug/pesquisa/convites/planilha?confirmar=1
    //
    // O arquivo (.xlsx ou .csv) vai cru no corpo. Sem `confirmar` é só a
    // prévia: quantos telefones valem, quais linhas foram recusadas e quantos
    // já foram convidados há pouco — ninguém dispara cem mensagens sem antes
    // ver esse resumo. Com `confirmar=1`, os convites saem de verdade.
    if (
      metodo === "POST" &&
      recurso === "pesquisa" &&
      p[3] === "convites" &&
      p[4] === "planilha" &&
      p.length === 5
    ) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const arquivo = await lerBinario(req, LIMITE_ARQUIVO_BYTES);
      if (arquivo.length === 0) throw erro(400, "invalid_request", "O arquivo chegou vazio.");

      return ok(
        res,
        await comErroDePesquisa(async () => {
          const lida = await lerPlanilhaDeClientes(arquivo);

          // A trava do "não repetir" vale também para a planilha — o prazo é
          // o mesmo configurado para a Zig (30 dias por padrão, mesmo sem Zig).
          let naoRepetirDias = 30;
          try {
            naoRepetirDias = (await configZig(venue.id)).nao_repetir_dias;
          } catch {
            /* tabela da Zig ainda sem migração — vale o padrão */
          }
          const recentes = await telefonesConvidadosRecentemente(
            venue.id,
            naoRepetirDias,
            new Date(),
          );
          const ineditos = lida.pessoas.filter((c) => !recentes.has(c.telefone));
          const repetidos = lida.pessoas.length - ineditos.length;

          if (url.searchParams.get("confirmar") !== "1") {
            return {
              previa: true,
              validos: ineditos.length,
              repetidos,
              recusadas: lida.recusadas.slice(0, 30),
              amostra: ineditos.slice(0, 8),
            };
          }

          let enviados = 0;
          for (const c of ineditos) {
            try {
              await enviarConvite(venue, { telefone: c.telefone, nome: c.nome, origem: "planilha" });
              enviados++;
            } catch (e) {
              console.error(`[pesquisa] planilha: convite para ${c.telefone} falhou: ${(e as Error).message}`);
            }
          }
          return { previa: false, enviados, repetidos, recusadas: lida.recusadas.slice(0, 30) };
        }),
        201,
      );
    }

    // GET | PUT /v1/venues/:slug/pesquisa/zig — a conexão com a Zig
    if (recurso === "pesquisa" && p[3] === "zig" && p.length === 4) {
      const chave = await exigirChave(req, metodo === "GET" ? "reservations:read" : "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      if (metodo === "GET") {
        return ok(res, zigParaOPainel(await comErroDePesquisa(() => configZig(venue.id))));
      }
      if (metodo === "PUT") {
        const corpo = (await lerJson(req)) as Record<string, unknown>;
        const config = await comErroDePesquisa(() =>
          salvarConfigZig(venue.id, {
            // undefined = não mexe; "" = apaga. É como o X das telas funciona.
            token: typeof corpo.token === "string" ? corpo.token.trim() : undefined,
            loja: typeof corpo.loja === "string" ? corpo.loja.trim() : undefined,
            ativo: typeof corpo.ativo === "boolean" ? corpo.ativo : undefined,
            hora_envio: inteiroOpcional(corpo.hora_envio, 0, 23),
            teto_por_dia: inteiroOpcional(corpo.teto_por_dia, 1, 500),
            nao_repetir_dias: inteiroOpcional(corpo.nao_repetir_dias, 0, 365),
          }),
        );
        return ok(res, zigParaOPainel(config));
      }
    }

    // POST /v1/venues/:slug/pesquisa/zig/testar — token e loja valem?
    if (metodo === "POST" && recurso === "pesquisa" && p[3] === "zig" && p[4] === "testar" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = (await lerJson(req).catch(() => ({}))) as Record<string, unknown>;
      return ok(
        res,
        await comErroDePesquisa(async () => {
          // Testa o que está na tela, caindo no que está salvo: dá para
          // conferir o token antes de salvar E conferir o que já foi salvo.
          const salvo = await configZig(venue.id);
          const token = (typeof corpo.token === "string" && corpo.token.trim()) || salvo.token;
          const loja = (typeof corpo.loja === "string" && corpo.loja.trim()) || salvo.loja;
          if (!token || !loja) {
            throw new ErroDePesquisa(400, "Preencha o token e a loja antes de testar.");
          }
          return await testarZig({ token, loja });
        }),
      );
    }

    // GET /v1/venues/:slug/pesquisa/zig/visitantes?dia=AAAA-MM-DD
    //
    // A lista de quem esteve na casa no dia, com o gasto de cada um — SEM
    // mandar nada. Buscar é olhar; convidar é a rota de baixo, de propósito.
    if (metodo === "GET" && recurso === "pesquisa" && p[3] === "zig" && p[4] === "visitantes" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(
        res,
        await comErroDePesquisa(() =>
          listarVisitantes(venue, url.searchParams.get("dia") ?? undefined, venue.timezone),
        ),
      );
    }

    // POST /v1/venues/:slug/pesquisa/zig/convidar — só para os marcados
    if (metodo === "POST" && recurso === "pesquisa" && p[3] === "zig" && p[4] === "convidar" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = (await lerJson(req)) as Record<string, unknown>;
      const dia = typeof corpo.dia === "string" ? corpo.dia : "";
      const clientes = (Array.isArray(corpo.clientes) ? corpo.clientes : [])
        .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
        .map((c) => ({
          telefone: typeof c.telefone === "string" ? c.telefone : "",
          nome: typeof c.nome === "string" ? c.nome : null,
        }))
        .filter((c) => c.telefone !== "");
      return ok(res, await comErroDePesquisa(() => convidarEscolhidos(venue, dia, clientes)), 201);
    }

    // ---- Vendas: o relatório do PDV baixa o estoque ----

    // POST /v1/venues/:slug/vendas/importar?media_type=&nome=&data=
    //
    // O arquivo vai cru no corpo, como as outras rotas de upload. Aqui só
    // lê, casa e guarda para revisão — a baixa é um segundo passo, e essa
    // separação é o que garante que alguém viu o que a IA entendeu.
    if (metodo === "POST" && recurso === "vendas" && p[3] === "importar" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);

      const mediaType = url.searchParams.get("media_type") ?? "";
      if (!tipoDeVendasAceito(mediaType)) {
        throw erro(400, "invalid_request", "Mande CSV, Excel, PDF ou uma foto do relatório.");
      }
      const arquivo = await lerBinario(req, LIMITE_ARQUIVO_BYTES);
      if (arquivo.length === 0) throw erro(400, "invalid_request", "O arquivo chegou vazio.");

      const hoje = new Date().toISOString().slice(0, 10);
      const resultado = await comErroDeEstoque(() =>
        importarVendas({
          venueId: venue.id,
          arquivo,
          mediaType,
          arquivoNome: url.searchParams.get("nome") ?? "relatório",
          dataPadrao: url.searchParams.get("data") ?? hoje,
          criadoPor: null,
        }),
      );
      return ok(res, resultado, 201);
    }

    // GET /v1/venues/:slug/vendas — histórico de importações
    if (metodo === "GET" && recurso === "vendas" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDeEstoque(() => listarImportacoes(venue.id)));
    }

    // GET /v1/venues/:slug/vendas/:id — a importação com as linhas
    if (metodo === "GET" && recurso === "vendas" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await comErroDeEstoque(() => obterImportacao(venue.id, p[3]!)));
    }

    // PATCH /v1/venues/:slug/vendas/itens/:id — corrige o alvo e ENSINA
    if (metodo === "PATCH" && recurso === "vendas" && p[3] === "itens" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = (await lerJson(req)) as Record<string, unknown>;
      await comErroDeEstoque(() =>
        corrigirItem({
          venueId: venue.id,
          itemId: p[4]!,
          fichaId: typeof corpo.ficha_id === "string" ? corpo.ficha_id : null,
          insumoId: typeof corpo.insumo_id === "string" ? corpo.insumo_id : null,
          ignorar: corpo.ignorar === true,
          aprender: corpo.aprender !== false,
        }),
      );
      return ok(res, { salvo: true });
    }

    // POST /v1/venues/:slug/vendas/:id/baixar — mexe no estoque
    if (metodo === "POST" && recurso === "vendas" && p[4] === "baixar" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const r = await comErroDeEstoque(() =>
        baixarVendas({ venueId: venue.id, importacaoId: p[3]!, usuario: null }),
      );
      // A baixa mudou os saldos — é a hora de saber o que vai faltar. No
      // máximo um aviso por dia, e quem garante é o índice único.
      await avisarEstoqueBaixo({
        venueId: venue.id,
        fuso: venue.timezone,
        hojeISO: hojeNaCasa(venue.timezone),
      });
      return ok(res, r);
    }

    // DELETE /v1/venues/:slug/vendas/:id — descarta antes de baixar
    if (metodo === "DELETE" && recurso === "vendas" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await comErroDeEstoque(() => descartarImportacao(venue.id, p[3]!));
      return ok(res, { descartada: true });
    }

    // GET /v1/venues/:slug/consumo?inicio=&fim= — teórico × real
    if (metodo === "GET" && recurso === "consumo" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const hoje = new Date().toISOString().slice(0, 10);
      return ok(
        res,
        await comErroDeEstoque(() =>
          teoricoVersusReal({
            venueId: venue.id,
            inicio: url.searchParams.get("inicio") ?? hoje.slice(0, 8) + "01",
            fim: url.searchParams.get("fim") ?? hoje,
          }),
        ),
      );
    }

    // POST /v1/venues/:slug/compras/ler-nota?media_type=image/jpeg
    //
    // A foto vai crua no corpo, como nas outras rotas de arquivo do painel:
    // ~25% menos bytes que base64 dentro de JSON, e a doca costuma estar num
    // canto de sinal ruim.
    if (metodo === "POST" && recurso === "compras" && p[3] === "ler-nota" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);

      const mediaType = url.searchParams.get("media_type") ?? "";
      if (!tipoAceito(mediaType)) {
        throw erro(400, "invalid_request", "Mande uma foto (JPG, PNG ou WebP).");
      }
      const imagem = await lerBinario(req, LIMITE_FOTO_BYTES);
      if (imagem.length === 0) throw erro(400, "invalid_request", "A foto chegou vazia.");

      const nota = await lerNota({ imagem, mediaType });
      const linhas = await comErroDeEstoque(() =>
        casarLinhas({ venueId: venue.id, linhas: nota.linhas }),
      );
      const soma = somaConfere(nota);

      return ok(res, {
        fornecedor: nota.fornecedor,
        documento: nota.documento,
        data_emissao: nota.dataEmissao,
        valor_total: nota.valorTotal,
        linhas,
        avisos: nota.avisos,
        // A tela avisa quando a soma não fecha: é o sinal de linha pulada, o
        // erro que ninguém percebe olhando a mercadoria.
        soma_confere: soma.confere,
        soma_das_linhas: soma.soma,
      });
    }

    // POST /v1/venues/:slug/compras — pedido ou compra avulsa
    if (metodo === "POST" && recurso === "compras" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);

      const origem = textoOpcional(corpo, "origem") ?? "pedido";
      if (origem !== "pedido" && origem !== "avulsa") {
        throw erro(400, "invalid_request", 'Origem deve ser "pedido" ou "avulsa".');
      }
      const id = await comErroDeEstoque(() =>
        criarCompra({
          venueId: venue.id,
          localId: texto(corpo, "local_id"),
          origem,
          fornecedor: textoOpcional(corpo, "fornecedor") ?? null,
          fornecedorId: textoOpcional(corpo, "fornecedor_id") ?? null,
          documento: textoOpcional(corpo, "documento") ?? null,
          dataCompra: textoOpcional(corpo, "data_compra") ?? null,
          dataPrevista: textoOpcional(corpo, "data_prevista") ?? null,
          extracaoIa: (corpo as Record<string, unknown>).extracao_ia,
          itens: itensDaCompra(corpo),
          criadoPor: null,
        }),
      );
      return ok(res, { id }, 201);
    }

    // PUT /v1/venues/:slug/compras/:id/itens — o que a doca conferiu
    if (metodo === "PUT" && recurso === "compras" && p[4] === "itens" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);
      await comErroDeEstoque(() => substituirItens(p[3]!, itensDaCompra(corpo)));
      return ok(res, { salvo: true });
    }

    // POST /v1/venues/:slug/compras/:id/enviar
    if (metodo === "POST" && recurso === "compras" && p[4] === "enviar" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      await findVenueBySlugInOrg(chave.org_id, slug);
      await comErroDeEstoque(() => enviarPedido(p[3]!));
      return ok(res, { enviado: true });
    }

    // PATCH /v1/venues/:slug/compras/:id — altera os dados de cabeçalho
    if (metodo === "PATCH" && recurso === "compras" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = (await lerJson(req)) as Record<string, unknown>;
      await comErroDeEstoque(() =>
        atualizarCompra({
          venueId: venue.id,
          compraId: p[3]!,
          fornecedor: "fornecedor" in corpo ? (corpo.fornecedor as string | null) : undefined,
          fornecedorId: "fornecedor_id" in corpo ? (corpo.fornecedor_id as string | null) : undefined,
          documento: "documento" in corpo ? (corpo.documento as string | null) : undefined,
          dataCompra: "data_compra" in corpo ? (corpo.data_compra as string | null) : undefined,
          dataPrevista: "data_prevista" in corpo ? (corpo.data_prevista as string | null) : undefined,
          localId: typeof corpo.local_id === "string" ? corpo.local_id : undefined,
          observacoes: "observacoes" in corpo ? (corpo.observacoes as string | null) : undefined,
        }),
      );
      return ok(res, { salvo: true });
    }

    // DELETE /v1/venues/:slug/compras/:id — apaga (só o que nunca entrou)
    if (metodo === "DELETE" && recurso === "compras" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await comErroDeEstoque(() => excluirCompra(venue.id, p[3]!));
      return ok(res, { excluida: true });
    }

    // POST /v1/venues/:slug/compras/:id/cancelar — só antes de receber
    if (metodo === "POST" && recurso === "compras" && p[4] === "cancelar" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await comErroDeEstoque(() => cancelarCompra(venue.id, p[3]!));
      return ok(res, { cancelada: true });
    }

    // POST /v1/venues/:slug/compras/:id/receber — dá entrada no estoque
    if (metodo === "POST" && recurso === "compras" && p[4] === "receber" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      await findVenueBySlugInOrg(chave.org_id, slug);
      // A foto dos custos vem ANTES da entrada: o recebimento atualiza o
      // custo médio, e depois dele o "preço antigo" não existe mais.
      const fotoDosCustos = await fotografarCustosDaCompra(p[3]!);
      await comErroDeEstoque(() => receberCompra(p[3]!, null));
      await avisarAumentoDePreco(fotoDosCustos, p[3]!);
      // As divergências voltam junto: quem acabou de receber é quem pode
      // cobrar o fornecedor, e mandá-la procurar noutra tela é garantir que
      // ninguém cobre.
      return ok(res, {
        recebida: true,
        divergencias: await comErroDeEstoque(() => divergenciasDaCompra(p[3]!)),
      });
    }

    // ---- Avaliações do Google ----

    // GET /v1/venues/:slug/avaliacoes — fila + histórico + perfil, numa ida só
    if (metodo === "GET" && recurso === "avaliacoes" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const [perfil, fila, historico] = await Promise.all([
        perfilDoVenue(venue.id),
        filaDeAprovacao(venue.id),
        historicoDeAvaliacoes(venue.id),
      ]);
      return ok(res, { perfil, fila, historico });
    }

    // POST /v1/venues/:slug/avaliacoes — lança uma avaliação na mão e já redige
    if (metodo === "POST" && recurso === "avaliacoes" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);

      const nota = Number(corpo.nota);
      if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
        throw erro(400, "invalid_request", "A nota precisa ser um número inteiro de 1 a 5.");
      }
      return ok(
        res,
        await adicionarAvaliacaoManual({
          venue,
          autor: textoOpcional(corpo, "autor") ?? null,
          nota,
          comentario: textoOpcional(corpo, "comentario") ?? null,
        }),
        201,
      );
    }

    // PUT /v1/venues/:slug/avaliacoes-perfil — conexão e regras do perfil
    if (metodo === "PUT" && recurso === "avaliacoes-perfil" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);
      const nota = Number(corpo.nota_automatica);

      // Só o que veio no corpo entra na configuração. A tela salva em partes —
      // o dono aperta "já adicionei" só com a conta, o operador salva só o
      // local_id — e campo ausente não pode apagar o que já foi configurado.
      const configuracao: Record<string, unknown> = {};
      if (Number.isInteger(nota)) configuracao.nota_automatica = nota;
      if ("assinatura" in corpo) configuracao.assinatura = textoOpcional(corpo, "assinatura") ?? "";
      if ("tom" in corpo) configuracao.tom = textoOpcional(corpo, "tom") ?? "";

      return ok(
        res,
        await salvarPerfil({
          venueId: venue.id,
          contaGerente: texto(corpo, "conta_gerente"),
          ...("local_id" in corpo ? { localId: textoOpcional(corpo, "local_id") ?? null } : {}),
          configuracao,
        }),
      );
    }

    if (metodo === "GET" && recurso === "events" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await listAllEvents(venue.id));
    }

    // POST /v1/venues:slug/events — evento único, ou série se vier "recorrencia"
    if (metodo === "POST" && recurso === "events" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);

      const startsAt = new Date(texto(corpo, "starts_at"));
      if (Number.isNaN(startsAt.getTime())) {
        throw erro(400, "invalid_request", "starts_at precisa ser uma data ISO 8601 válida.");
      }
      const cover = corpo.cover_charge;
      const base = {
        venue_id: venue.id,
        kind: textoOpcional(corpo, "kind") ?? "musica",
        title: texto(corpo, "title"),
        description: textoOpcional(corpo, "description") ?? null,
        starts_at: startsAt.toISOString(),
        cover_charge: typeof cover === "number" ? cover : null,
      };

      const recorrencia = corpo.recorrencia;
      if (recorrencia && typeof recorrencia === "object" && !Array.isArray(recorrencia)) {
        const r = recorrencia as Record<string, unknown>;
        const freq = r.freq;
        if (freq !== "weekly" && freq !== "daily") {
          throw erro(400, "invalid_request", 'recorrencia.freq precisa ser "weekly" ou "daily".');
        }
        const days = Array.isArray(r.days) ? r.days.filter((d): d is string => typeof d === "string") : undefined;
        const until = typeof r.until === "string" && r.until ? new Date(r.until) : undefined;
        if (until && Number.isNaN(until.getTime())) {
          throw erro(400, "invalid_request", "recorrencia.until precisa ser uma data válida.");
        }
        try {
          const eventos = await createVenueEventSeries(base, { freq, days, until }, venue.timezone);
          return ok(res, eventos, 201);
        } catch (e) {
          throw erro(400, "invalid_request", e instanceof Error ? e.message : "Recorrência inválida.");
        }
      }

      const evento = await createVenueEvent(base);
      return ok(res, evento, 201);
    }

    // DELETE /v1/venues:slug/events/series:seriesId — futuras ocorrências da série
    if (metodo === "DELETE" && recurso === "events" && p[3] === "series" && p.length === 5) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await deleteVenueEventSeries(p[4]!, venue.id);
      return ok(res, { removido: true });
    }

    // POST /v1/venues:slug/events/series:seriesId/renew — mais ~12 semanas
    if (metodo === "POST" && recurso === "events" && p[3] === "series" && p.length === 6 && p[5] === "renew") {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      try {
        const eventos = await renewVenueEventSeries(p[4]!, venue.id, venue.timezone);
        return ok(res, eventos, 201);
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Não foi possível renovar.");
      }
    }

    if (metodo === "GET" && recurso === "info") {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await listVenueInfo(venue.id));
    }

    // POST /v1/venues/:slug/info — cria ou atualiza um tópico (upsert)
    if (metodo === "POST" && recurso === "info" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const corpo = await lerJson(req);
      try {
        const info = await createVenueInfo({
          venueId: venue.id,
          topic: texto(corpo, "topic"),
          content: texto(corpo, "content"),
        });
        return ok(res, info, 201);
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
      }
    }

    // DELETE /v1/venues/:slug/info/:id
    if (metodo === "DELETE" && recurso === "info" && p.length === 4) {
      const chave = await exigirChave(req, "reservations:write");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      await deleteVenueInfo(p[3]!, venue.id);
      return ok(res, { removido: true });
    }

    // GET | POST /v1/venues/:slug/checklists — modelos do módulo Checklist
    if (recurso === "checklists" && p.length === 3) {
      if (metodo === "GET") {
        const chave = await exigirChave(req, "reservations:read");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        return ok(res, await listChecklists(venue.id));
      }
      if (metodo === "POST") {
        const chave = await exigirChave(req, "reservations:write");
        const venue = await findVenueBySlugInOrg(chave.org_id, slug);
        const corpo = await lerJson(req);
        try {
          const checklist = await createChecklist({
            venueId: venue.id,
            name: texto(corpo, "name"),
            description: textoOpcional(corpo, "description") ?? null,
            items: validarItens(corpo.items),
            schedule: validarAgenda(corpo.schedule),
          });
          return ok(res, checklist, 201);
        } catch (e) {
          throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
        }
      }
    }

    // GET /v1/venues/:slug/checklist-runs — histórico de execuções
    if (metodo === "GET" && recurso === "checklist-runs" && p.length === 3) {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      const [runs, modelos] = await Promise.all([
        listRuns(venue.id),
        listChecklists(venue.id),
      ]);
      const nomes = new Map(modelos.map((c) => [c.id, c.name]));
      return ok(
        res,
        runs.map((r) => ({ ...r, checklist_nome: nomes.get(r.checklist_id) ?? "—", answers: undefined, token: undefined })),
      );
    }

    // GET /v1/venues/:slug/conversations?canal=&status=&humanas=1
    if (metodo === "GET" && recurso === "conversations") {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(
        res,
        await listConversations({
          venueId: venue.id,
          canal: url.searchParams.get("canal"),
          status: url.searchParams.get("status"),
          apenasHumanas: url.searchParams.get("humanas") === "1",
        }),
      );
    }

    // GET /v1/venues/:slug/metrics — números do painel
    if (metodo === "GET" && recurso === "metrics") {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await metricasDoVenue(venue.id, venue.timezone));
    }

    // GET /v1/venues/:slug/pontos — saldo do plano, consumo por motor e
    // quanto tempo a sobra dura em cada um deles
    if (metodo === "GET" && recurso === "pontos") {
      const chave = await exigirChave(req, "reservations:read");
      const venue = await findVenueBySlugInOrg(chave.org_id, slug);
      return ok(res, await extratoDePontos(venue));
    }
  }

  // ---- Autenticação de pessoas ----
  // Sem chave de API: são justamente as rotas de quem ainda não tem sessão.
  if (p[0] === "auth") {
    // POST /v1/auth/login — e-mail e senha em troca do par de tokens
    if (metodo === "POST" && p[1] === "login" && p.length === 2) {
      const corpo = await lerJson(req);
      try {
        const tokens = await entrar(texto(corpo, "email"), texto(corpo, "senha"));
        return ok(res, tokens);
      } catch (e) {
        if (e instanceof ErroDeAcesso) throw erro(e.status, "unauthorized", e.message);
        throw e;
      }
    }

    // POST /v1/auth/refresh — troca o token de renovação por um par novo
    if (metodo === "POST" && p[1] === "refresh" && p.length === 2) {
      const corpo = await lerJson(req);
      try {
        return ok(res, await renovar(texto(corpo, "refresh_token")));
      } catch (e) {
        if (e instanceof ErroDeAcesso) throw erro(e.status, "unauthorized", e.message);
        throw e;
      }
    }

    // POST /v1/auth/recuperar — sempre responde igual, exista o e-mail ou não
    if (metodo === "POST" && p[1] === "recuperar" && p.length === 2) {
      const corpo = await lerJson(req);
      const destino = textoOpcional(corpo, "redirect") ?? "";
      await pedirTrocaDeSenha(texto(corpo, "email"), destino);
      return ok(res, { enviado: true });
    }

    // POST /v1/auth/senha — define senha nova (recuperação ou troca voluntária)
    if (metodo === "POST" && p[1] === "senha" && p.length === 2) {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!token) throw erro(401, "unauthorized", "Link de troca de senha inválido.");
      const corpo = await lerJson(req);
      try {
        // Os tokens novos vão junto: a troca de senha derruba a sessão que
        // veio no cabeçalho, e sem um par novo o painel continuaria usando o
        // token morto — telas em branco logo depois de "salvar senha".
        const tokens = await trocarSenha(token, texto(corpo, "senha"));
        return ok(res, { trocada: true, sessao: tokens });
      } catch (e) {
        if (e instanceof ErroDeAcesso) throw erro(e.status, "invalid_request", e.message);
        throw e;
      }
    }

    // GET /v1/auth/me — quem sou eu, para o painel montar o menu
    if (metodo === "GET" && p[1] === "me" && p.length === 2) {
      // A única rota que atende quem ainda não trocou a senha ditada: é por
      // ela que o painel fica sabendo que tem de mostrar a tela de troca.
      const acesso = await exigirChave(req, "reservations:read", { senhaProvisoriaOk: true });
      return ok(res, {
        nome: acesso.name,
        org_id: acesso.org_id,
        plataforma_admin: acesso.plataformaAdmin,
        escopos: acesso.scopes,
        // Null = sem restrição. O painel usa para apagar da colmeia os favos
        // que esta pessoa não pode abrir — esconder é conveniência; a trava
        // de verdade é conferida em cada rota.
        modulos: acesso.modulos ?? null,
        // O painel tranca tudo até a troca quando isto é verdadeiro.
        senha_provisoria: acesso.senhaProvisoria === true,
      });
    }
  }

  // ---- Pessoas e acessos da casa ----
  //
  // Fora de /venues de propósito: acesso é da ORGANIZAÇÃO, não de um
  // estabelecimento. E fora de qualquer módulo — toda casa tem gente, tenha
  // comprado o que tiver comprado.
  if (p[0] === "equipe") {
    const chave = await exigirChave(req, "reservations:read");
    const podeMexer = podeGerirEquipe(chave.papel ?? "", chave.plataformaAdmin);

    if (metodo === "GET" && p.length === 1) {
      return ok(res, {
        papeis: PAPEIS,
        pode_mexer: podeMexer,
        eu: chave.userId,
        pessoas: await comErroDeEquipe(() => listarEquipe(chave.org_id)),
      });
    }

    // Id que não é uuid nunca chega ao banco: sem isto, um `undefined` que
    // escape da tela vira "invalid input syntax for type uuid" na cara de
    // quem só queria cadastrar um funcionário.
    if (p.length >= 2 && !/^[0-9a-f-]{36}$/i.test(p[1] ?? "")) {
      throw erro(400, "invalid_request", "Pessoa não identificada. Recarregue a página e tente de novo.");
    }

    // Daqui para baixo, mexe. Operação e leitura não passam.
    if (!podeMexer) {
      throw erro(403, "forbidden", "Só o dono e o gerente mexem em acessos.");
    }

    if (metodo === "POST" && p.length === 1) {
      const corpo = (await lerJson(req)) as Record<string, unknown>;
      const r = await comErroDeEquipe(() =>
        criarPessoa({
          orgId: chave.org_id,
          email: texto(corpo, "email"),
          nome: texto(corpo, "nome"),
          papel: texto(corpo, "papel"),
          modulos: Array.isArray(corpo.modulos) ? (corpo.modulos as string[]) : null,
        }),
      );
      return ok(res, r, 201);
    }

    if (metodo === "PATCH" && p.length === 2) {
      const corpo = (await lerJson(req)) as Record<string, unknown>;
      await comErroDeEquipe(() =>
        atualizarPessoa({
          orgId: chave.org_id,
          userId: p[1]!,
          papel: typeof corpo.papel === "string" ? corpo.papel : undefined,
          modulos: "modulos" in corpo ? (corpo.modulos as string[] | null) : undefined,
        }),
      );
      return ok(res, { salvo: true });
    }

    if (metodo === "DELETE" && p.length === 2) {
      await comErroDeEquipe(() =>
        removerPessoa({ orgId: chave.org_id, userId: p[1]!, euMesmo: chave.userId }),
      );
      return ok(res, { removida: true });
    }

    if (metodo === "POST" && p[2] === "senha" && p.length === 3) {
      const senha = await comErroDeEquipe(() =>
        redefinirSenha({ orgId: chave.org_id, userId: p[1]! }),
      );
      return ok(res, { senha_inicial: senha });
    }
  }

  // ---- Administração da plataforma (equipe Brasa Food) ----
  // GET /v1/admin/resumo — números da carteira inteira
  if (metodo === "GET" && p[0] === "admin" && p[1] === "resumo" && p.length === 2) {
    await exigirAdminDaPlataforma(req);
    return ok(res, resumirPlataforma(await listarClientes()));
  }

  // PUT /v1/admin/venues/:venueId/modulos — liga, desliga ou reendereça um
  // módulo do cliente. Só a equipe Brasa Food: é a linha do contrato.
  if (metodo === "PUT" && p[0] === "admin" && p[1] === "venues" && p[3] === "modulos" && p.length === 4) {
    await exigirAdminDaPlataforma(req);
    const corpo = await lerJson(req);
    const modulo = texto(corpo, "modulo");
    const ativo = (corpo as Record<string, unknown>).ativo;
    if (typeof ativo !== "boolean") {
      throw erro(400, "invalid_request", "Informe `ativo` como verdadeiro ou falso.");
    }

    // Ausente = não mexe no endereço; vazio = apaga. Sem essa diferença,
    // ligar um módulo apagaria a URL já cadastrada.
    const temUrl = Object.prototype.hasOwnProperty.call(corpo, "url");
    const bruta = textoOpcional(corpo, "url");
    if (bruta && !/^https:\/\//i.test(bruta)) {
      throw erro(400, "invalid_request", "O endereço precisa começar com https://");
    }

    await definirModulo({
      venueId: p[2]!,
      modulo,
      ativo,
      url: temUrl ? (bruta ?? null) : undefined,
    });
    return ok(res, { salvo: true });
  }

  if (p[0] === "admin" && p[1] === "clientes") {
    // GET /v1/admin/clientes — carteira de clientes
    if (metodo === "GET" && p.length === 2) {
      await exigirAdminDaPlataforma(req);
      return ok(res, await listarClientes());
    }

    // PATCH /v1/admin/clientes/:orgId — dados comerciais (status, mensalidade)
    if (metodo === "PATCH" && p.length === 3) {
      await exigirAdminDaPlataforma(req);
      const corpo = await lerJson(req);
      const dados: { status_pagamento?: string; mensalidade?: number; vencimento_dia?: number } = {};

      const status = textoOpcional(corpo, "status_pagamento");
      if (status) {
        if (!["ativo", "atrasado", "suspenso", "cortesia", "cancelado"].includes(status)) {
          throw erro(400, "invalid_request", "Status de pagamento inválido.");
        }
        dados.status_pagamento = status;
      }
      if (typeof corpo.mensalidade === "number") dados.mensalidade = corpo.mensalidade;
      if (typeof corpo.vencimento_dia === "number") dados.vencimento_dia = corpo.vencimento_dia;

      if (Object.keys(dados).length === 0) {
        throw erro(400, "invalid_request", "Nada para atualizar.");
      }
      await atualizarComercial(p[2]!, dados);
      return ok(res, { atualizado: true });
    }

    // POST /v1/admin/clientes — cria organização, estabelecimento, agente,
    // conta do dono e chave do conector numa tacada
    if (metodo === "POST" && p.length === 2) {
      await exigirAdminDaPlataforma(req);
      const corpo = await lerJson(req);
      const plano = texto(corpo, "plano");
      if (!["essencial", "profissional", "casa_cheia", "cortesia"].includes(plano)) {
        throw erro(400, "invalid_request", "Plano inválido.");
      }
      try {
        const criado = await criarCliente({
          nome: texto(corpo, "nome"),
          slug: textoOpcional(corpo, "slug"),
          cidade: textoOpcional(corpo, "cidade"),
          timezone: texto(corpo, "timezone"),
          plano: plano as DadosDoCliente["plano"],
          emailDono: texto(corpo, "email"),
          telefone: textoOpcional(corpo, "telefone"),
          observacoes: textoOpcional(corpo, "observacoes"),
        });
        return ok(res, criado, 201);
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Não deu para cadastrar.");
      }
    }
  }

  // ---- Conversas ----
  if (p[0] === "conversations" && p.length >= 2) {
    const escopo = metodo === "GET" ? "reservations:read" : "reservations:write";
    const chave = await exigirChave(req, escopo);

    const encontrado = await getConversationInOrg(p[1]!, chave.org_id);
    if (!encontrado) throw erro(404, "not_found", "Conversa não encontrada.");
    const { conversa, mensagens } = encontrado;

    // GET /v1/conversations/:id — conversa com o histórico
    if (metodo === "GET" && p.length === 2) {
      const metaConversa = (conversa.metadata ?? {}) as Record<string, unknown>;
      return ok(res, {
        id: conversa.id,
        titulo: conversa.title,
        canal: conversa.channel,
        status: conversa.status,
        // O telefone legível gravado pelo canal; o external_id é o endereço
        // técnico (pode ser um id interno do WhatsApp, ilegível).
        contato:
          typeof metaConversa.contato === "string" ? metaConversa.contato : conversa.external_id,
        atendimento: atendimentoDe(conversa),
        mensagens: mensagens.map((m) => ({
          id: m.id,
          papel: m.role,
          texto: m.content,
          // Marca posta por registrarMensagemHumana: separa o que a pessoa
          // escreveu do que o agente respondeu.
          origem:
            m.blocks && typeof m.blocks === "object" && !Array.isArray(m.blocks)
              ? ((m.blocks as Record<string, unknown>).origem ?? null)
              : null,
          em: m.created_at,
        })),
      });
    }

    // DELETE /v1/conversations/:id — apaga o histórico; reservas sobrevivem
    if (metodo === "DELETE" && p.length === 2) {
      await apagarConversa(conversa.id);
      return ok(res, { apagada: true });
    }

    // POST /v1/conversations/:id/close — encerra ({"reabrir":true} reabre)
    if (metodo === "POST" && p[2] === "close" && p.length === 3) {
      const corpo = await lerJson(req);
      const atualizada = await definirStatusConversa({
        conversationId: conversa.id,
        status: corpo.reabrir === true ? "open" : "closed",
      });
      return ok(res, { status: atualizada.status });
    }

    // POST /v1/conversations/:id/takeover — assumir ou devolver ao agente
    if (metodo === "POST" && p[2] === "takeover" && p.length === 3) {
      const corpo = await lerJson(req);
      const devolver = corpo.devolver === true;
      const atualizada = await definirAtendimento({
        conversationId: conversa.id,
        por: devolver ? "agente" : "humano",
        quem: textoOpcional(corpo, "quem") ?? chave.name,
      });
      return ok(res, atendimentoDe(atualizada));
    }

    // POST /v1/conversations/:id/messages — resposta escrita por uma pessoa
    if (metodo === "POST" && p[2] === "messages" && p.length === 3) {
      const corpo = await lerJson(req);
      const texto_ = texto(corpo, "texto").trim();
      if (!texto_) throw erro(400, "invalid_request", "A mensagem não pode ser vazia.");

      // Enquanto o agente responde, uma resposta manual sairia junto com a dele
      // e o cliente receberia duas vozes na mesma conversa.
      if (atendimentoDe(conversa).por !== "humano") {
        throw erro(
          409,
          "conflict",
          "Assuma o atendimento antes de responder — o agente ainda está respondendo esta conversa.",
        );
      }

      const msg = await registrarMensagemHumana({
        conversationId: conversa.id,
        texto: texto_,
        autor: textoOpcional(corpo, "autor") ?? chave.name,
      });
      return ok(res, { id: msg.id, em: msg.created_at }, 201);
    }
  }

  // DELETE /v1/events/:id?venue=<slug>
  if (metodo === "DELETE" && p[0] === "events" && p.length === 2) {
    const chave = await exigirChave(req, "reservations:write");
    const slug = url.searchParams.get("venue");
    if (!slug) throw erro(400, "invalid_request", 'Informe o estabelecimento em "?venue=".');
    const venue = await findVenueBySlugInOrg(chave.org_id, slug);
    await deleteVenueEvent(p[1]!, venue.id);
    return ok(res, { removido: true });
  }

  // POST /v1/reservations/:id/approve | /reject | /cancel
  // POST /v1/avaliacoes/:id/aprovar|descartar
  if (metodo === "POST" && p[0] === "avaliacoes" && p.length === 3) {
    const chave = await exigirChave(req, "reservations:write");
    const acao = p[2]!;
    if (acao !== "aprovar" && acao !== "descartar" && acao !== "colada") {
      throw erro(404, "not_found", `Ação "${acao}" não existe.`);
    }

    const encontrado = await avaliacaoComOrg(p[1]!);
    // Mesma resposta para "não existe" e "é de outra organização".
    if (!encontrado || encontrado.orgId !== chave.org_id) {
      throw erro(404, "not_found", "Avaliação não encontrada.");
    }

    if (acao === "descartar") {
      return ok(res, await descartarResposta(encontrado.avaliacao.id));
    }

    // Enquanto a publicação é manual, quem confirma que a resposta chegou ao
    // Google é a pessoa que colou. Sem isso a resposta ficaria para sempre na
    // lista de "prontas para colar", e ninguém saberia o que já foi feito.
    if (acao === "colada") {
      return ok(res, await marcarPublicada(encontrado.avaliacao.id));
    }

    // O texto editado à mão vem junto: o dono corrige a resposta na hora de
    // aprovar, e é justamente nas avaliações que mais importam que ele corrige.
    const corpo = await lerJson(req);
    const editado = textoOpcional(corpo, "texto");
    if (editado !== undefined && editado.trim() === "") {
      throw erro(400, "invalid_request", "A resposta não pode ficar vazia.");
    }
    return ok(
      res,
      await aprovarResposta({
        id: encontrado.avaliacao.id,
        ...(editado ? { texto: editado.trim() } : {}),
      }),
    );
  }

  if (metodo === "POST" && p[0] === "reservations" && p.length === 3) {
    const chave = await exigirChave(req, "reservations:write");
    const acao = p[2]!;
    if (acao !== "approve" && acao !== "reject" && acao !== "cancel") {
      throw erro(404, "not_found", `Ação "${acao}" não existe.`);
    }

    const encontrado = await getReservationWithVenue(p[1]!);
    // Mesma resposta para "não existe" e "é de outra organização".
    if (!encontrado || encontrado.venue.org_id !== chave.org_id) {
      throw erro(404, "not_found", "Reserva não encontrada.");
    }

    // Cancelar não passa pelo fluxo de decisão: nenhuma notificação
    // automática — cancelamento pela casa merece uma mensagem humana.
    if (acao === "cancel") {
      try {
        return ok(res, await cancelReservation(encontrado.reservation.id));
      } catch (e) {
        throw erro(409, "conflict", e instanceof Error ? e.message : "Conflito ao cancelar.");
      }
    }

    const corpo = await lerJson(req);
    const motivo = textoOpcional(corpo, "motivo");
    if (acao === "reject" && !motivo) {
      throw erro(400, "invalid_request", 'Recusar exige "motivo": o cliente precisa saber por quê.');
    }

    try {
      const { reserva, notificacao } = await decidirReserva({
        reservationId: encontrado.reservation.id,
        status: acao === "approve" ? "approved" : "rejected",
        motivo,
        venue: encontrado.venue,
      });
      return ok(res, {
        ...reserva,
        // O painel mostra se o cliente foi realmente avisado.
        notificacao: notificacao
          ? { status: notificacao.status, canal: notificacao.channel, erro: notificacao.error }
          : null,
      });
    } catch (e) {
      // reviewReservation só atualiza quando ainda está pendente.
      throw erro(409, "conflict", e instanceof Error ? e.message : "Conflito ao decidir.");
    }
  }

  // PATCH | DELETE /v1/reservations/:id — editar dados ou apagar de vez
  if ((metodo === "PATCH" || metodo === "DELETE") && p[0] === "reservations" && p.length === 2) {
    const chave = await exigirChave(req, "reservations:write");
    const encontrado = await getReservationWithVenue(p[1]!);
    if (!encontrado || encontrado.venue.org_id !== chave.org_id) {
      throw erro(404, "not_found", "Reserva não encontrada.");
    }

    if (metodo === "DELETE") {
      await deleteReservation(encontrado.reservation.id);
      return ok(res, { removido: true });
    }

    const corpo = await lerJson(req);
    const dados: DadosReserva = {};
    if ("customer_name" in corpo) dados.customer_name = texto(corpo, "customer_name");
    if ("customer_phone" in corpo) dados.customer_phone = texto(corpo, "customer_phone");
    if ("party_size" in corpo) {
      if (typeof corpo.party_size !== "number") {
        throw erro(400, "invalid_request", 'O campo "party_size" precisa ser um número.');
      }
      dados.party_size = corpo.party_size;
    }
    if ("reserved_for" in corpo) dados.reserved_for = texto(corpo, "reserved_for");
    // Campos anuláveis: mandar "" ou null limpa o valor.
    if ("area_preference" in corpo) dados.area_preference = textoOpcional(corpo, "area_preference") ?? null;
    if ("occasion" in corpo) dados.occasion = textoOpcional(corpo, "occasion") ?? null;
    if ("notes" in corpo) dados.notes = textoOpcional(corpo, "notes") ?? null;

    try {
      return ok(res, await updateReservation(encontrado.reservation.id, dados));
    } catch (e) {
      throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
    }
  }

  // GET /v1/reservations/:id/notifications
  if (metodo === "GET" && p[0] === "reservations" && p[2] === "notifications" && p.length === 3) {
    const chave = await exigirChave(req, "reservations:read");
    const encontrado = await getReservationWithVenue(p[1]!);
    if (!encontrado || encontrado.venue.org_id !== chave.org_id) {
      throw erro(404, "not_found", "Reserva não encontrada.");
    }
    return ok(res, await listNotificationsForReservation(encontrado.reservation.id));
  }

  // ---- Checklists (gestão pelo painel) ----

  // POST /v1/checklists/gerar — a IA conversa antes de montar as perguntas.
  // Corpo: {mensagens:[{papel:"usuario"|"ia", texto}]}. Resposta: ou
  // {tipo:"pergunta", texto} (a IA quer saber mais) ou {tipo:"itens", itens}.
  if (metodo === "POST" && p[0] === "checklists" && p[1] === "gerar" && p.length === 2) {
    await exigirChave(req, "reservations:write");
    const corpo = await lerJson(req);
    const brutas = Array.isArray(corpo.mensagens) ? corpo.mensagens : [];
    const mensagens: MensagemGeracao[] = brutas
      .map((m) => {
        const o = (m ?? {}) as Record<string, unknown>;
        return {
          papel: o.papel === "ia" ? ("ia" as const) : ("usuario" as const),
          texto: typeof o.texto === "string" ? o.texto.trim() : "",
        };
      })
      .filter((m) => m.texto)
      .slice(-12);
    // Compatibilidade com o formato antigo ({descricao}).
    const descricaoLegada = textoOpcional(corpo, "descricao");
    if (mensagens.length === 0 && descricaoLegada) {
      mensagens.push({ papel: "usuario", texto: descricaoLegada });
    }
    try {
      return ok(res, await conversarGeracao(mensagens));
    } catch (e) {
      throw erro(400, "invalid_request", e instanceof Error ? e.message : "Não deu para gerar.");
    }
  }

  // PATCH | DELETE /v1/checklists/:id?venue=slug
  if ((metodo === "PATCH" || metodo === "DELETE") && p[0] === "checklists" && p.length === 2) {
    const chave = await exigirChave(req, "reservations:write");
    const slug = url.searchParams.get("venue");
    if (!slug) throw erro(400, "invalid_request", 'Informe o estabelecimento em "?venue=".');
    const venue = await findVenueBySlugInOrg(chave.org_id, slug);

    if (metodo === "DELETE") {
      await deleteChecklist(p[1]!, venue.id);
      return ok(res, { removido: true });
    }

    const corpo = await lerJson(req);
    try {
      const mudancas: Parameters<typeof updateChecklist>[2] = {};
      if ("name" in corpo) mudancas.name = texto(corpo, "name");
      if ("description" in corpo) mudancas.description = textoOpcional(corpo, "description") ?? null;
      if ("items" in corpo) mudancas.items = validarItens(corpo.items) as never;
      if ("schedule" in corpo) mudancas.schedule = validarAgenda(corpo.schedule) as never;
      if ("active" in corpo) mudancas.active = corpo.active === true;
      return ok(res, await updateChecklist(p[1]!, venue.id, mudancas));
    } catch (e) {
      throw erro(400, "invalid_request", e instanceof Error ? e.message : "Dados inválidos.");
    }
  }

  // POST /v1/checklists/:id/disparar?venue=slug — envia o link agora
  if (metodo === "POST" && p[0] === "checklists" && p[2] === "disparar" && p.length === 3) {
    const chave = await exigirChave(req, "reservations:write");
    const slug = url.searchParams.get("venue");
    if (!slug) throw erro(400, "invalid_request", 'Informe o estabelecimento em "?venue=".');
    const venue = await findVenueBySlugInOrg(chave.org_id, slug);
    const checklist = await getChecklistInVenue(p[1]!, venue.id);
    if (!checklist) throw erro(404, "not_found", "Checklist não encontrado.");
    const { run, criadaAgora } = await dispararChecklist(checklist, venue);
    return ok(res, { run_id: run.id, criada_agora: criadaAgora, token: run.token });
  }

  // GET /v1/checklist-runs/:id?venue=slug — execução completa, com fotos assinadas
  if (metodo === "GET" && p[0] === "checklist-runs" && p.length === 2) {
    const chave = await exigirChave(req, "reservations:read");
    const slug = url.searchParams.get("venue");
    if (!slug) throw erro(400, "invalid_request", 'Informe o estabelecimento em "?venue=".');
    const venue = await findVenueBySlugInOrg(chave.org_id, slug);
    const run = await getRunInVenue(p[1]!, venue.id);
    if (!run) throw erro(404, "not_found", "Execução não encontrada.");
    const checklist = await getChecklistInVenue(run.checklist_id, venue.id);

    const respostas = Array.isArray(run.answers) ? (run.answers as unknown as RespostaItem[]) : [];
    const comFotos = await Promise.all(
      respostas.map(async (r) => ({
        ...r,
        foto_url: r.foto ? await urlAssinadaDaFoto(r.foto) : null,
      })),
    );
    return ok(res, {
      ...run,
      token: undefined,
      answers: comFotos,
      checklist: checklist ? { name: checklist.name, items: itensDe(checklist) } : null,
    });
  }

  // ---- Checklist público (quem executa, via token — sem chave de API) ----
  if (p[0] === "checklist-publico" && p.length >= 2) {
    const run = await getRunByToken(p[1]!);
    if (!run) throw erro(404, "not_found", "Este link de checklist não existe ou foi trocado.");
    const checklist = await getChecklistInVenue(run.checklist_id, run.venue_id);
    if (!checklist) throw erro(404, "not_found", "O checklist deste link foi removido.");
    const { data: venueRow } = await db()
      .from("venues")
      .select("id, name, timezone")
      .eq("id", run.venue_id)
      .single();
    if (!venueRow) throw erro(404, "not_found", "Estabelecimento não encontrado.");

    // GET /v1/checklist-publico/:token — perguntas e estado
    //
    // Concluído, o mesmo link vira a PRESTAÇÃO DE CONTAS: quem recebe o
    // resumo no WhatsApp abre e vê cada resposta e cada foto, sem login e
    // sem caçar a execução no painel.
    if (metodo === "GET" && p.length === 2) {
      const concluida = run.status === "concluida";
      if (!concluida) await marcarEmAndamento(run);
      return ok(res, {
        checklist: checklist.name,
        descricao: checklist.description,
        venue: venueRow.name,
        data: run.scheduled_for,
        status: run.status,
        executor: run.executor_nome,
        itens: itensDe(checklist),
        ...(concluida
          ? {
              concluido_em: run.completed_at,
              resumo: run.resumo_ia,
              alertas: Array.isArray(run.alertas_ia) ? run.alertas_ia : [],
              respostas: await respostasDaRun(run, checklist),
            }
          : {}),
      });
    }

    // POST /v1/checklist-publico/:token/foto?item=ID — corpo binário
    if (metodo === "POST" && p[2] === "foto" && p.length === 3) {
      if (run.status === "concluida") {
        throw erro(409, "conflict", "Esta execução já foi concluída.");
      }
      const itemId = url.searchParams.get("item");
      if (!itemId || !itensDe(checklist).some((i) => i.id === itemId)) {
        throw erro(400, "invalid_request", "Item da foto não encontrado neste checklist.");
      }
      const arquivo = await lerBinario(req, LIMITE_FOTO_BYTES);
      if (arquivo.length === 0) throw erro(400, "invalid_request", "Foto vazia.");
      const contentType = req.headers["content-type"] ?? "image/jpeg";
      const caminho = await salvarFotoDeItem(run, itemId, arquivo, String(contentType));
      return ok(res, { foto: caminho }, 201);
    }

    // POST /v1/checklist-publico/:token/concluir — respostas + análise da IA
    if (metodo === "POST" && p[2] === "concluir" && p.length === 3) {
      const corpo = await lerJson(req);
      const brutas = Array.isArray(corpo.respostas) ? corpo.respostas : [];
      const respostas: RespostaItem[] = brutas.map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return {
          item: typeof o.item === "string" ? o.item : "",
          valor: typeof o.valor === "string" ? o.valor : null,
          foto: typeof o.foto === "string" ? o.foto : null,
          observacao: typeof o.observacao === "string" && o.observacao.trim() ? o.observacao.trim() : null,
        };
      });
      try {
        const resultado = await concluirRun({
          run,
          checklist,
          venue: venueRow,
          executorNome: texto(corpo, "executor"),
          respostas,
        });
        return ok(res, { concluida: true, resumo: resultado.resumo, alertas: resultado.alertas });
      } catch (e) {
        throw erro(400, "invalid_request", e instanceof Error ? e.message : "Não deu para concluir.");
      }
    }
  }

  // ---- Cardápio público (QR code da mesa) ----
  //
  // Sem chave de API, como a pesquisa: quem abre é o cliente sentado na mesa.
  // Por aqui só se LÊ o cardápio, e se GRAVA o que é do cliente — curtida,
  // comentário (que entra pendente) e o chamado do garçom. Cada gravação tem
  // limite de ritmo por endereço; é o que separa "uma mesa" de "um script".
  if (p[0] === "cardapio-publico" && p.length >= 2) {
    const venue = await venueDaPesquisa(p[1]!);
    if (!venue) throw erro(404, "not_found", "Casa não encontrada.");
    // A casa que não contratou (ou cancelou) o cardápio não o exibe: o QR
    // impresso continuaria abrindo um cardápio de um módulo que não se paga.
    if (!(await temModulo(venue.id, "cardapio-digital"))) {
      throw erro(404, "not_found", "Cardápio não disponível.");
    }

    // GET /v1/cardapio-publico/:casa
    if (metodo === "GET" && p.length === 2) {
      const cardapio = await comErroDoCardapio(() => cardapioPublico(venue));
      return ok(res, { ...cardapio, casa: { ...cardapio.casa, ...marcaDaCasa(venue) } });
    }

    // GET | POST /v1/cardapio-publico/:casa/itens/:id/comentarios
    if (p[2] === "itens" && p[4] === "comentarios" && p.length === 5) {
      if (metodo === "GET") {
        return ok(res, await comErroDoCardapio(() => comentariosLiberados(venue.id, p[3]!)));
      }
      if (metodo === "POST") {
        if (!LIMITES_DO_CARDAPIO.comentar.permitir(`${ipDe(req)}:${venue.id}`)) {
          throw erro(429, "rate_limited", "Muitos comentários seguidos. Espere alguns minutos.");
        }
        const corpo = await lerJson(req);
        const dados = await comErroDoCardapio(async () => validarComentario(corpo));
        return ok(res, await comErroDoCardapio(() => comentarItem({ venueId: venue.id, itemId: p[3]!, ...dados })), 201);
      }
    }

    // POST /v1/cardapio-publico/:casa/itens/:id/curtir  { desfazer?: true }
    if (metodo === "POST" && p[2] === "itens" && p[4] === "curtir" && p.length === 5) {
      if (!LIMITES_DO_CARDAPIO.curtir.permitir(`${ipDe(req)}:${venue.id}`)) {
        throw erro(429, "rate_limited", "Calma — muitas curtidas seguidas.");
      }
      const corpo = await lerJson(req);
      return ok(res, await comErroDoCardapio(() => curtirItem({ venueId: venue.id, itemId: p[3]!, desfazer: corpo.desfazer === true })));
    }

    // POST /v1/cardapio-publico/:casa/garcom  { mesa, pedido }
    if (metodo === "POST" && p[2] === "garcom" && p.length === 3) {
      if (!LIMITES_DO_CARDAPIO.garcom.permitir(`${ipDe(req)}:${venue.id}`)) {
        throw erro(429, "rate_limited", "O garçom já foi chamado. Espere um pouco.");
      }
      const corpo = await lerJson(req);
      return ok(
        res,
        await chamarGarcom({
          venue,
          mesa: textoOpcional(corpo, "mesa") ?? null,
          pedido: textoOpcional(corpo, "pedido") ?? null,
        }),
      );
    }

    throw erro(404, "not_found", "Rota do cardápio não existe.");
  }

  // ---- Pesquisa pública (QR code da mesa e link do WhatsApp) ----
  //
  // Sem chave de API: quem responde é o cliente da casa, no celular dele, sem
  // conta em lugar nenhum. O que substitui a chave é o alcance: por aqui só se
  // LÊ o que já está impresso no cartaz e se GRAVA uma resposta.
  if (p[0] === "pesquisa-publica" && p.length >= 2) {
    const porConvite = p[1] === "convite";
    const identificador = porConvite ? p[2] : p[1];
    if (!identificador) throw erro(404, "not_found", "Pesquisa não encontrada.");

    const convite = porConvite
      ? await comErroDePesquisa(async () => {
          const achado = await conviteDoToken(identificador);
          if (!achado) throw new ErroDePesquisa(404, "Este link não vale mais.");
          return achado;
        })
      : null;

    const venue = await venueDaPesquisa(convite?.venue_id ?? identificador);
    if (!venue) throw erro(404, "not_found", "Casa não encontrada.");

    // A casa que não contratou (ou cancelou) o módulo não responde por aqui.
    // Sem esta conferência, o cartaz impresso continuaria recebendo resposta
    // depois do cancelamento — e a casa veria dado entrando num módulo pelo
    // qual não paga mais.
    if (!(await temModulo(venue.id, "pesquisa"))) {
      throw erro(404, "not_found", "Pesquisa não disponível.");
    }

    const config = await comErroDePesquisa(() => configDaPesquisa(venue.id));

    if (metodo === "GET") {
      if (!config.ativa) {
        return ok(res, { ativa: false, casa: venue.name, ...marcaDaCasa(venue) });
      }
      // As perguntas da casa. Sem pesquisa montada a tela continua funcionando
      // com a nota geral e as etiquetas — quem acabou de comprar o módulo
      // imprime o QR e já recebe resposta, em vez de o cliente achar um
      // formulário vazio na mesa.
      const modelo = await comErroDeModelo(() => pesquisaAtiva(venue.id));
      // O dia da VISITA decide quais perguntas aparecem. Pelo convite do
      // WhatsApp ele vem da Zig (a pessoa foi ontem); pelo QR da mesa é
      // agora mesmo, no calendário da casa. Sem isto, a pergunta do rodízio
      // de segunda a quinta chegaria a quem foi no sábado — e a nota que
      // essa pessoa inventa entra na média do rodízio.
      const diaDaVisita = convite?.dia_visita ?? hojeNaCasa(venue.timezone);
      return ok(res, {
        ativa: true,
        casa: venue.name,
        ...marcaDaCasa(venue),
        saudacao: config.saudacao,
        etiquetas: [...ETIQUETAS],
        perguntas: itensDoDia(modelo?.itens ?? [], diaDaVisita),
        dia_visita: diaDaVisita,
        perguntar_atendente: config.perguntar_atendente,
        atendente_posicao: config.atendente_posicao,
        perguntar_comentario: config.perguntar_comentario,
        premio: config.premio_ativo
          ? { titulo: config.premio_titulo, regras: config.premio_regras }
          : null,
        // Só quem está ativo: o cliente não pode elogiar quem não trabalha
        // mais aqui, e o nome de um demitido na lista é constrangimento.
        atendentes: config.perguntar_atendente
          ? (await comErroDePesquisa(() => listarAtendentes(venue.id))).map((a) => ({
              id: a.id,
              nome: a.apelido?.trim() || a.nome,
              funcao: a.funcao,
            }))
          : [],
        convidado: convite?.nome ?? null,
      });
    }

    if (metodo === "POST") {
      const corpo = (await lerJson(req)) as Record<string, unknown>;
      return ok(
        res,
        await comErroDePesquisa(() =>
          registrarResposta({
            venueId: venue.id,
            fuso: venue.timezone,
            casaNome: venue.name,
            nota: Number(corpo.nota),
            itens: corpo.itens,
            elogios: corpo.elogios,
            criticas: corpo.criticas,
            comentario: textoOpcional(corpo, "comentario") ?? null,
            atendenteId: textoOpcional(corpo, "atendente_id") ?? null,
            atendenteNota: numeroOuNulo(corpo.atendente_nota),
            mesa: textoOpcional(corpo, "mesa") ?? null,
            origem: convite ? "whatsapp" : "qrcode",
            conviteId: convite?.id ?? null,
            clienteNome: textoOpcional(corpo, "cliente_nome") ?? null,
            clienteContato: textoOpcional(corpo, "cliente_contato") ?? null,
          }),
        ),
        201,
      );
    }

    throw erro(405, "method_not_allowed", "Método não suportado aqui.");
  }

  // ---- Instagram (API oficial da Meta) ----
  // O webhook NÃO usa chave de API: quem chama é a Meta. A segurança é o
  // verify token (GET de verificação) e a assinatura HMAC do corpo (POST).
  if (p[0] === "instagram" && p[1] === "webhook" && p.length === 2) {
    if (metodo === "GET") {
      const challenge = verificarWebhook(url.searchParams);
      if (challenge === null) {
        throw erro(403, "forbidden", "Verificação do webhook recusada.");
      }
      // A Meta espera o challenge cru, sem envelope JSON.
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(challenge);
      return;
    }

    if (metodo === "POST") {
      const bruto = await lerBinario(req, 1_000_000);
      const assinatura = req.headers["x-hub-signature-256"];
      if (!assinaturaValida(bruto, Array.isArray(assinatura) ? assinatura[0] : assinatura)) {
        throw erro(403, "forbidden", "Assinatura do webhook inválida.");
      }
      let corpo: unknown;
      try {
        corpo = JSON.parse(bruto.toString("utf8"));
      } catch {
        throw erro(400, "invalid_request", "Corpo do webhook não é JSON.");
      }
      // Processa antes de responder: em serverless, o trabalho morre junto
      // com a resposta. O agente responde em segundos; a Meta espera.
      await processarWebhookInstagram(corpo as Parameters<typeof processarWebhookInstagram>[0]);
      return ok(res, { recebido: true });
    }
  }

  // GET /v1/instagram/status — configuração do canal, para a aba Canais
  if (metodo === "GET" && p[0] === "instagram" && p[1] === "status" && p.length === 2) {
    await exigirChave(req, "reservations:write");
    return ok(res, estadoInstagram());
  }

  // ---- WhatsApp (Baileys) ----
  // Com conector no processo (PC/VPS): responde direto, ao vivo. Sem conector
  // (Vercel): ponte pelo banco — o site lê o estado que o conector publica e
  // enfileira comandos que ele consome em ~5s. Ver src/ponteWhatsapp.ts.
  if (p[0] === "whatsapp" && p.length === 2) {
    const chave = await exigirChave(req, "reservations:write");

    if (metodo === "GET" && p[1] === "status") {
      if (conectorWhatsapp) {
        const estado = conectorWhatsapp.estado() as Record<string, unknown>;
        return ok(res, { ...estado, versao: versaoDoCodigo(), fonte: "local" });
      }
      const slug = url.searchParams.get("venue");
      const venue = slug
        ? await findVenueBySlugInOrg(chave.org_id, slug)
        : (await listVenuesInOrg(chave.org_id))[0];
      if (!venue) throw erro(404, "not_found", "Nenhum estabelecimento cadastrado.");
      const papel = papelValido(url.searchParams.get("papel"));
      const estado = lerEstadoPonte(venue.settings ?? null, papel);
      if (!estado) {
        // Nunca houve conector publicando: nem heartbeat velho existe.
        return ok(res, {
          status: "sem_conector",
          qr: null,
          telefone: null,
          agentSlug: null,
          venueSlug: venue.slug,
          versao: null,
          papel,
          fonte: "ponte",
        });
      }
      return ok(res, { ...estado, papel, fonte: "ponte" });
    }

    if (metodo === "POST" && p[1] === "conectar") {
      const corpo = await lerJson(req);
      const venueSlug = texto(corpo, "venue");
      const papel = papelValido(textoOpcional(corpo, "papel"));

      // O número administrativo não tem agente: ele só envia. Exigir um aqui
      // impediria justamente o cliente que comprou Checklist sem Agente de
      // conectar — o caso que motivou a separação.
      const agentSlug = papel === "agente" ? texto(corpo, "agent") : "";

      // O conector responde por esta organização: confira antes de subir.
      const venue = await findVenueBySlugInOrg(chave.org_id, venueSlug);
      if (papel === "agente") {
        const agentes = await listAgentsInOrg(chave.org_id);
        if (!agentes.some((a) => a.slug === agentSlug)) {
          throw erro(404, "not_found", `Agente "${agentSlug}" não encontrado nesta organização.`);
        }
      }

      if (conectorWhatsapp) {
        await conectorWhatsapp.iniciar({ agentSlug, venueSlug, venueId: venue.id, papel });
        return ok(res, conectorWhatsapp.estado());
      }
      await criarComandoPonte(venue.id, papel, { acao: "conectar", agent: agentSlug || undefined });
      return ok(res, { na_fila: true, acao: "conectar", papel });
    }

    if (metodo === "POST" && p[1] === "desconectar") {
      if (conectorWhatsapp) {
        await conectorWhatsapp.parar();
        return ok(res, conectorWhatsapp.estado());
      }
      const corpo = await lerJson(req);
      const slug = textoOpcional(corpo, "venue");
      const papel = papelValido(textoOpcional(corpo, "papel"));
      const venue = slug
        ? await findVenueBySlugInOrg(chave.org_id, slug)
        : (await listVenuesInOrg(chave.org_id))[0];
      if (!venue) throw erro(404, "not_found", "Nenhum estabelecimento cadastrado.");
      await criarComandoPonte(venue.id, papel, { acao: "desconectar" });
      return ok(res, { na_fila: true, acao: "desconectar", papel });
    }
  }

  throw erro(404, "not_found", `Rota ${metodo} /v1/${p.join("/")} não existe.`);
}

// ============================================================
// POST /v1/runs — com streaming SSE opcional
// ============================================================
async function executarAgente(
  req: IncomingMessage,
  res: ServerResponse,
  chave: Acesso,
  url: URL,
): Promise<void> {
  const corpo = await lerJson(req);
  const agentSlug = texto(corpo, "agent");
  const userMessage = texto(corpo, "input");
  const venueSlug = textoOpcional(corpo, "venue");
  const channel = textoOpcional(corpo, "channel") ?? "api";
  const externalId = textoOpcional(corpo, "external_id");

  // O agente precisa pertencer à organização da chave.
  const agentes = await listAgentsInOrg(chave.org_id);
  if (!agentes.some((a) => a.slug === agentSlug)) {
    throw erro(404, "not_found", `Agente "${agentSlug}" não encontrado nesta organização.`);
  }
  if (venueSlug) await findVenueBySlugInOrg(chave.org_id, venueSlug);

  const querStream =
    url.searchParams.get("stream") === "true" ||
    (req.headers.accept ?? "").includes("text/event-stream");

  if (!querStream) {
    try {
      const resultado = await runAgent({ agentSlug, userMessage, channel, externalId, venueSlug });
      return ok(res, {
        conversation_id: resultado.conversationId,
        output: resultado.text,
        stop_reason: resultado.stopReason,
      });
    } catch (e) {
      // 402 e não 500: não é defeito do sistema, é plano a renovar. O código
      // distingue "quebrou" de "acabou" para quem integra pela API.
      if (e instanceof PlanoBloqueadoError) throw erro(402, "pontos_esgotados", e.message);
      throw e;
    }
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const enviar = (evento: AgentStreamEvent | { type: "error"; message: string }): void => {
    res.write(`event: ${evento.type}\ndata: ${JSON.stringify(evento)}\n\n`);
  };

  try {
    await runAgent({ agentSlug, userMessage, channel, externalId, venueSlug, onEvent: enviar });
  } catch (e) {
    // Cabeçalhos já foram enviados: o erro tem de viajar pelo próprio stream.
    enviar({ type: "error", message: e instanceof Error ? e.message : "Falha na execução." });
  } finally {
    res.end();
  }
}

// ============================================================
// Arquivos estáticos (painel web)
// ============================================================
const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  // Sem estes dois, robots.txt e sitemap.xml saem como
  // application/octet-stream e o buscador os ignora — servidos, mas inúteis.
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

// Rotas "bonitas" sem extensão — a mesma coisa que o rewrite faz na Vercel.
// A raiz é a página de vendas: quem chega pela primeira vez não pode cair
// numa caixa pedindo uma chave sem saber o que é o produto.
//
// A landing é o próprio index.html, e não um rewrite de "/" para outro
// arquivo, porque na Vercel os rewrites só valem quando NENHUM arquivo casa
// com a rota — um index.html no diretório público ganharia da regra e a
// landing nunca apareceria. O painel virou app.html pelo mesmo motivo.
const PAGINAS_LIMPAS: Record<string, string> = {
  "/": "index.html",
  "/app": "app.html",
  "/painel": "app.html",
  "/entrar": "app.html",
  "/checklist": "checklist.html",
  "/pesquisa": "pesquisa.html",
  "/privacidade": "privacidade.html",
  "/termos": "termos.html",
};

async function servirEstatico(res: ServerResponse, caminho: string): Promise<void> {
  // /cardapio/<casa> é a página do cardápio: a casa vai no caminho porque é
  // o que fica bonito num QR code impresso, e a página lê o slug do endereço.
  const relativo = caminho.startsWith("/cardapio/")
    ? "cardapio.html"
    : (PAGINAS_LIMPAS[caminho] ?? caminho.slice(1));

  // normalize resolve "..", e o prefixo é conferido depois — sem isso,
  // "/../.env" escaparia do diretório público.
  const alvo = normalize(join(PUBLIC_DIR, relativo));
  if (!alvo.startsWith(PUBLIC_DIR)) {
    throw erro(403, "forbidden", "Caminho fora do diretório público.");
  }

  try {
    const conteudo = await readFile(alvo);
    res.writeHead(200, {
      "content-type": TIPOS[extname(alvo)] ?? "application/octet-stream",
      "content-length": conteudo.length,
      // no-cache (não no-store): o navegador pode guardar, mas revalida a
      // cada uso. Sem isto, um módulo JS importado por outro (api.js, as
      // telas em pages/) fica preso em cache até o usuário limpar na mão —
      // só o arquivo referenciado direto no HTML seria atualizado.
      "cache-control": "no-cache",
    });
    res.end(conteudo);
  } catch {
    throw erro(404, "not_found", "Página não encontrada.");
  }
}

// ============================================================
// Handler
// ============================================================
export interface OpcoesApp {
  /**
   * Servir o painel a partir de `public/`.
   *
   * Ligado no servidor Node; desligado na Vercel, onde o CDN serve os
   * estáticos antes de a função ser chamada.
   */
  servirEstaticos?: boolean;
}

export function criarHandler(opcoes: OpcoesApp = {}) {
  const servirEstaticos = opcoes.servirEstaticos ?? true;

  return function handler(req: IncomingMessage, res: ServerResponse): void {
    const traceId = randomUUID();
    res.setHeader("x-trace-id", traceId);

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    void rotear(req, res, url, traceId, servirEstaticos).catch((e: unknown) => {
      // Streaming já começou: não dá para trocar por uma resposta de erro.
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e && typeof e === "object" && "status" in e && "code" in e) {
        return falha(res, e as ErroHttp);
      }
      console.error(`[${traceId}]`, e);
      falha(res, erro(500, "internal_error", "Erro interno. Consulte o trace-id no log."));
    });
  };
}
