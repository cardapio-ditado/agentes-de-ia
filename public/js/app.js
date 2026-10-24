import { ErroApi, chaveSalva, esquecerChave, get, post, salvarChave, salvarSessao } from "./api.js";
import { ICONES, avisar, el, icone, limpar } from "./ui.js";
import { painel } from "./pages/painel.js";
import { hoje } from "./pages/hoje.js";
import { trilha } from "./pages/trilha.js";
import { abrirAjuda } from "./ajuda.js";
import { clientes } from "./pages/clientes.js";
import { plataforma } from "./pages/plataforma.js";
import { conversas } from "./pages/conversas.js";
import { reservas } from "./pages/reservas.js";
import { programacao } from "./pages/programacao.js";
import { jogos } from "./pages/jogos.js";
import { canaisDaCasa } from "./pages/canaisDaCasa.js";
import { integracoes } from "./pages/integracoes.js";
import { pessoas } from "./pages/pessoas.js";
import { agentes } from "./pages/agentes.js";
import { agente } from "./pages/agente.js";
import { empresa } from "./pages/empresa.js";
import { agenteSabe } from "./pages/agenteSabe.js";
import { organizacao } from "./pages/organizacao.js";
import { checklists } from "./pages/checklists.js";
import { execucoes } from "./pages/execucoes.js";
import { avaliacoes } from "./pages/avaliacoes.js";
import { compras } from "./pages/compras.js";
import { cadastros } from "./pages/cadastros.js";
import { fichas } from "./pages/fichas.js";
import { contagem } from "./pages/contagem.js";
import { estoque } from "./pages/estoque.js";
import { kardex } from "./pages/kardex.js";
import { cmvPainel } from "./pages/cmvPainel.js";
import { engenhariaCardapio } from "./pages/engenhariaCardapio.js";
import { vendas } from "./pages/vendas.js";
import { pesquisa } from "./pages/pesquisa.js";
import { pesquisaAjustes } from "./pages/pesquisaAjustes.js";
// Dois "clientes" no produto, e são coisas diferentes: `clientes` (acima) é a
// carteira da Brasa Food — as CASAS que pagam —, e `clientesDaCasa` é a base
// de uma casa: a gente que bebe no bar. Os nomes precisam brigar aqui, no
// import, e não numa tela onde alguém veria a lista errada.
import { clientesDaCasa } from "./pages/clientesDaCasa.js";
import { pesquisaRespostas } from "./pages/pesquisaRespostas.js";
import { producao } from "./pages/producao.js";
import { cardapioDigital } from "./pages/cardapioDigital.js";
import { rh } from "./pages/rh.js";

/**
 * Casca do painel: barra lateral, roteamento por hash e estado compartilhado.
 *
 * Cada tela é uma função `(raiz, ctx)` que desenha dentro de <main>. O roteador
 * limpa o main e chama a tela — sem framework, sem build.
 */

/**
 * Uma página que junta duas ou três telas em abas.
 *
 * O menu tinha uma linha por tela, e uma casa com tudo contratado chegava a
 * quarenta linhas — o mentorado se perdia antes de achar a que usava todo
 * dia. Telas que respondem à mesma pergunta ("o atendente", "a programação",
 * "o estoque") viram uma porta só, e a aba fica no endereço
 * (#estoque:historico) para F5, voltar e link direto continuarem valendo.
 *
 * Trocar de aba é trocar de endereço: o roteador limpa os timers da aba
 * anterior pelo mesmo caminho de sempre.
 */
function comAbas(paginaId, abas) {
  return async (raiz, ctx) => {
    const atual = abas.find((a) => a.id === ctx.aba) ?? abas[0];
    if (atual.subtitulo) document.getElementById("subtitulo-pagina").textContent = atual.subtitulo;
    const corpo = el("div", {});
    raiz.append(
      el(
        "div",
        { classe: "abas abas-pagina", role: "tablist" },
        abas.map((a) =>
          el("button", {
            classe: `aba${a.id === atual.id ? " aba-ativa" : ""}`,
            type: "button",
            role: "tab",
            "aria-selected": String(a.id === atual.id),
            texto: a.rotulo,
            onclick: () => {
              location.hash = `#${paginaId}:${a.id}`;
            },
          }),
        ),
      ),
      corpo,
    );
    try {
      await atual.render(corpo, ctx);
    } catch (e) {
      // Sessão vencida sobe para o roteador, que pede login. O resto fica
      // DENTRO da aba: as outras abas continuam ali para trocar.
      if (e instanceof ErroApi && e.status === 401) throw e;
      limpar(corpo).append(
        el("div", { classe: "cartao" }, [
          el("h2", { texto: "Não deu para carregar esta aba" }),
          el("p", { classe: "muted", texto: e.message }),
        ]),
      );
    }
  };
}

/**
 * Endereços antigos que viraram aba de outra página (ou mudaram de módulo).
 * Link guardado, favorito e botão de outra tela continuam chegando.
 */
const APELIDOS = {
  jogos: "programacao:jogos",
  agentes: "atendente:agentes",
  "agente-sabe": "atendente:sabe",
  agente: "atendente:testar",
  canais: "canais-casa",
  "pesquisa-respostas": "pesquisa:respostas",
  kardex: "estoque:historico",
};

/** O ícone do Hoje — o mesmo do botão no rodapé da lateral. */
const SOL =
  "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 100-10 5 5 0 000 10z";

/** Os grupos do menu lateral, na ordem em que aparecem. */
const GRUPOS = { dia: "Dia a dia", analise: "Análise", configurar: "Configurar" };

// Cada página pertence a um módulo do hub; a lateral só mostra as do módulo
// em que o usuário entrou. `grupo` separa o que se usa todo dia do que se
// configura uma vez (sem grupo = dia a dia).
const PAGINAS = [
  // A primeira tela de quem entra: o que precisa de mim, e está tudo ligado.
  // Fora de qualquer módulo, como os Ajustes — junta todos eles.
  { id: "hoje", modulo: "hoje", rotulo: "Hoje", icone: SOL, render: hoje, subtitulo: "O que precisa de você e se está tudo funcionando" },

  { id: "painel", modulo: "agentes-ia", rotulo: "Painel", icone: ICONES.painel, render: painel, subtitulo: "Visão geral do movimento" },
  { id: "conversas", modulo: "agentes-ia", rotulo: "Conversas", icone: ICONES.conversas, render: conversas, subtitulo: "O que o atendente conversou com cada cliente" },
  { id: "reservas", modulo: "agentes-ia", rotulo: "Reservas", icone: ICONES.reservas, render: reservas, subtitulo: "Fila de aprovação" },
  {
    id: "programacao", modulo: "agentes-ia", rotulo: "Programação", icone: ICONES.programacao, subtitulo: "Shows, jogos e promoções",
    render: comAbas("programacao", [
      { id: "eventos", rotulo: "Shows e promoções", render: programacao, subtitulo: "Shows, jogos e promoções" },
      { id: "jogos", rotulo: "Jogos na TV", render: jogos, subtitulo: "Escolha os jogos que a casa vai transmitir" },
    ]),
  },
  {
    id: "atendente", modulo: "agentes-ia", grupo: "configurar", rotulo: "Atendente", icone: ICONES.agente, subtitulo: "Quem ele é, o que ele sabe da casa — e um teste antes de soltar para o cliente",
    render: comAbas("atendente", [
      { id: "agentes", rotulo: "Jeito e regras", render: agentes, subtitulo: "A personalidade e as regras do atendente" },
      { id: "sabe", rotulo: "O que ele sabe", render: agenteSabe, subtitulo: "Endereço, horários e as respostas às perguntas do cliente" },
      { id: "testar", rotulo: "Testar", render: agente, subtitulo: "Converse como se fosse um cliente" },
    ]),
  },

  // ---- Ajustes da casa: fora de qualquer módulo ----
  //
  // Empresa, pessoas, canais e chaves não são produto — são o que toda casa
  // tem. Moravam dentro de "Agentes de IA" por acidente histórico (o agente
  // foi o primeiro módulo), e por causa disso um cliente que comprasse só o
  // CMV não tinha onde cadastrar a própria casa nem criar login de gerente.
  // O roteiro da consultoria: primeiro dos Ajustes, porque é por ele que a
  // implantação começa e é nele que o mentorado confere o que falta.
  { id: "trilha", modulo: "ajustes", rotulo: "Implantação", icone: ICONES.checklist, render: trilha, subtitulo: "O passo a passo para a casa andar sozinha" },
  { id: "empresa", modulo: "ajustes", rotulo: "A casa", icone: ICONES.organizacao, render: empresa, subtitulo: "Nome, contato e o fuso horário que todos os módulos usam" },
  { id: "pessoas", modulo: "ajustes", rotulo: "Pessoas e acessos", icone: ICONES.pessoa, render: pessoas, subtitulo: "Quem entra no painel, e o que cada um pode fazer" },
  // Todos os números da casa numa tela só, organizados pela tarefa: o do
  // atendimento ao cliente morava em "Canais do agente", dentro de outro
  // módulo, e ninguém lembrava qual número fazia o quê.
  { id: "canais-casa", modulo: "ajustes", rotulo: "WhatsApp e Instagram", icone: ICONES.canais, render: canaisDaCasa, subtitulo: "Qual número atende o cliente, qual avisa a equipe e qual manda o parabéns" },
  // A Zig e os outros sistemas que a casa já usa. Nada aqui é premissa: cada
  // uso tem a sua chave, e a casa sem integração nenhuma usa o painel igual.
  { id: "integracoes", modulo: "ajustes", rotulo: "Integrações", icone: ICONES.plugue, render: integracoes, subtitulo: "Zig e os outros sistemas que a casa já usa — ligue só o que tiver" },
  { id: "organizacao", modulo: "ajustes", rotulo: "Estabelecimentos e chaves", icone: ICONES.painel, render: organizacao, subtitulo: "Unidades da rede, agentes e chaves de API" },

  // O cardápio mora DENTRO do painel agora: era um deploy à parte, com link
  // externo por cliente. Uma tela só, com abas — é o que a casa mexe todo dia.
  { id: "cardapio", modulo: "cardapio-digital", rotulo: "Cardápio", icone: ICONES.caixa, render: cardapioDigital, subtitulo: "Itens, fotos, banners, promoções e os comentários dos clientes" },

  // RH — Fase 1. Ficha, documento, admissão e desligamento. Não calcula folha:
  // entrega os números prontos para quem já fecha a folha da casa.
  { id: "rh", modulo: "rh", rotulo: "RH", icone: ICONES.pessoa, render: rh, subtitulo: "Ficha da equipe, documentos com validade, admissão e desligamento" },

  // O que se olha todo dia vem primeiro; o modelo se monta uma vez.
  { id: "execucoes", modulo: "checklist", rotulo: "Checklists feitos", icone: ICONES.relogio, render: execucoes, subtitulo: "Quem fez, quando, e o que a IA encontrou" },
  { id: "checklists", modulo: "checklist", grupo: "configurar", rotulo: "Modelos de checklist", icone: ICONES.checklist, render: checklists, subtitulo: "Rotinas da equipe: monte, agende e dispare" },

  // UM FAVO SÓ: o cliente, e tudo que ele diz da casa.
  //
  // Eram três portas para a mesma pessoa: quem veio (base), o que respondeu
  // (pesquisa) e o que escreveu no Google (avaliações). O dono abria uma para
  // saber quem era e outra para saber o que ele achou. Agora é uma.
  //
  // A base é da CASA — toda casa tem, e o favo acende para todo mundo. A
  // pesquisa e as avaliações se CONTRATAM: as telas delas trazem `requer` e
  // acendem só para quem comprou, sem favo próprio e sem 403 disfarçado de
  // tela em branco.
  { id: "clientes-casa", modulo: "clientes", rotulo: "Clientes", icone: ICONES.pessoa, render: clientesDaCasa, subtitulo: "A base da casa, os aniversários e as mensagens em massa" },
  {
    id: "pesquisa", modulo: "clientes", requer: "pesquisa", rotulo: "O que acham da casa", icone: ICONES.painel, subtitulo: "NPS, o que falam, e quem precisa de um telefonema hoje",
    render: comAbas("pesquisa", [
      { id: "resumo", rotulo: "Resumo", render: pesquisa, subtitulo: "NPS, o que falam, e quem precisa de um telefonema hoje" },
      { id: "respostas", rotulo: "Cada resposta", render: pesquisaRespostas, subtitulo: "Ler cada resposta inteira: o que escreveu e onde reclamou" },
    ]),
  },
  { id: "avaliacoes", modulo: "clientes", requer: "avaliacoes", rotulo: "Avaliações do Google", icone: ICONES.estrela, render: avaliacoes, subtitulo: "Fila de aprovação, tom da casa e histórico" },
  { id: "pesquisa-ajustes", modulo: "clientes", requer: "pesquisa", grupo: "configurar", rotulo: "Ajustes da pesquisa", icone: ICONES.organizacao, render: pesquisaAjustes, subtitulo: "QR code da mesa, equipe, prêmio e convites" },

  // A ordem é a do dia de trabalho: o que se faz toda manhã, depois os
  // números para analisar, por fim o que se cadastra uma vez e esquece.
  { id: "compras", modulo: "cmv", rotulo: "Compras e recebimento", icone: ICONES.caixa, render: compras, subtitulo: "Pedidos ao fornecedor e recebimento da mercadoria" },
  { id: "producao", modulo: "cmv", rotulo: "Produção", icone: ICONES.raio, render: producao, subtitulo: "A receita foi feita — os insumos saem do estoque" },
  { id: "vendas", modulo: "cmv", rotulo: "Vendas", icone: ICONES.raio, render: vendas, subtitulo: "O que foi vendido baixa o estoque pelas receitas" },
  { id: "contagem", modulo: "cmv", rotulo: "Contagem", icone: ICONES.atualizar, render: contagem, subtitulo: "O contado vira o saldo — e a quebra aparece em reais" },
  {
    id: "estoque", modulo: "cmv", rotulo: "Estoque", icone: ICONES.painel, subtitulo: "Posição, transferência, perda — e os locais de estoque",
    render: comAbas("estoque", [
      { id: "posicao", rotulo: "Quanto tem", render: estoque, subtitulo: "Posição, transferência, perda — e os locais de estoque" },
      { id: "historico", rotulo: "Histórico do produto", render: kardex, subtitulo: "Tudo que entrou e saiu, por produto e por fornecedor" },
    ]),
  },
  { id: "cmv-painel", modulo: "cmv", grupo: "analise", rotulo: "Painel do CMV", icone: ICONES.painel, render: cmvPainel, subtitulo: "Quanto do que a casa vendeu foi custo de mercadoria, com a conta aberta" },
  { id: "engenharia-cardapio", modulo: "cmv", grupo: "analise", rotulo: "O que vende e o que dá lucro", icone: ICONES.estrela, render: engenhariaCardapio, subtitulo: "O que proteger, reprecificar, divulgar e tirar do cardápio" },
  { id: "cadastros", modulo: "cmv", grupo: "configurar", rotulo: "Itens e fornecedores", icone: ICONES.organizacao, render: cadastros, subtitulo: "Itens, categorias e fornecedores — a base de tudo" },
  { id: "fichas", modulo: "cmv", grupo: "configurar", rotulo: "Receitas e custo do prato", icone: ICONES.checklist, render: fichas, subtitulo: "O que cada prato consome — e quanto custa" },

  // Módulo da equipe Brasa Food. Administrar a plataforma não é uma seção do
  // produto do cliente: são perguntas de negócios diferentes, e misturar as
  // duas faz o dono do restaurante ver menu que não é dele. O servidor confere
  // de novo em cada rota — esconder aqui é conveniência, não é a trava.
  { id: "visao-geral", modulo: "plataforma", plataforma: true, rotulo: "Visão geral", icone: ICONES.painel, render: plataforma, subtitulo: "Receita, custo de IA e saúde da carteira" },
  { id: "clientes", modulo: "plataforma", plataforma: true, rotulo: "Clientes", icone: ICONES.organizacao, render: clientes, subtitulo: "Carteira, saldo de pontos e situação de pagamento" },
];

/** Preenchido no login por /v1/auth/me. */
let souPlataforma = false;

/**
 * Falso para o perfil Equipe (e o Só leitura): a lateral esconde o grupo
 * "Configurar" e os Ajustes da casa. O servidor recusa a escrita do mesmo
 * jeito — aqui é para não mostrar a quem só usa o dia a dia um botão que
 * não é para ele.
 */
let podeConfigurar = true;

/**
 * A pessoa entrou com a senha que alguém ditou para ela e ainda não escolheu
 * a sua. Enquanto isto for verdade, o painel não abre.
 */
let trocaObrigatoria = false;

/**
 * Módulos que ESTA PESSOA pode abrir. Null = sem restrição.
 *
 * Diferente de `modulosDoCliente`, que é o que a CASA contratou. As duas
 * perguntas são independentes e as duas precisam valer: o conferente de doca
 * trabalha numa casa que tem cinco módulos e só enxerga um.
 */
let meusModulos = null;

/**
 * Módulos contratados pelo estabelecimento aberto agora.
 *
 * Mapa de id -> { ativo, url }. Vazio significa "ainda não carregou", não
 * "não tem nada": quem lê precisa esperar, senão a colmeia pisca apagada
 * antes de acender.
 */
let modulosDoCliente = new Map();

let moduloAtual = "agentes-ia";

/**
 * Módulos do hub: cada solução do Brasa Food é uma porta.
 *
 * Aqui só está o que o módulo É — nome, ícone, lugar na colmeia. Se ele acende
 * para ESTE cliente quem diz é o banco (`venue_modulos`), carregado no login.
 * Antes era uma bandeira fixa no código, igual para todo mundo: quem só tinha
 * o cardápio via "Agentes de IA" aceso e entrava.
 */
const MODULOS = [
  {
    id: "agentes-ia",
    nome: "Atendente virtual",
    descricao:
      "Atendimento no WhatsApp e Instagram: reservas, programação e dúvidas respondidas na hora.",
    // O número do atendente mora nos Ajustes da casa, junto com os outros —
    // mas quem configura o atendente procura aqui. Um atalho, não uma cópia.
    atalhos: [{ rotulo: "WhatsApp e Instagram", icone: ICONES.canais, destino: "canais-casa", grupo: "configurar" }],
    icone:
      "M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z",
    // Posição na colmeia, em passos de favo a partir do centro (x em larguras,
    // y em alturas de hexágono).
    pos: { x: 0, y: -1 },
  },
  {
    id: "cardapio-digital",
    nome: "Cardápio Digital",
    descricao:
      "QR code na mesa, cardápio com foto e vídeo, curtidas e comentários dos clientes — e o garçom chamado pelo celular.",
    icone: "M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z",
    // Foi um deploy separado, com domínio por cliente e link em
    // venue_modulos.url. Agora é tela do painel e página pública do próprio
    // Brasa (/cardapio/<casa>); a coluna `url` ficou sem uso.
    pos: { x: -0.75, y: 0.5 },
  },
  {
    id: "rh",
    nome: "RH",
    descricao:
      "A equipe organizada: ficha de cada um, documento com aviso de vencimento, admissão guiada e desligamento registrado. A folha continua com a contabilidade.",
    icone: ICONES.pessoa,
    pos: { x: 0.75, y: -0.5 },
  },
  {
    id: "checklist",
    nome: "Checklist Inteligente",
    descricao:
      "Rotinas de abertura e fechamento com link no WhatsApp, fotos como prova e a IA conferindo cada resposta.",
    icone: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
    pos: { x: 0.75, y: 0.5 },
  },
  {
    id: "cmv",
    nome: "Custos e estoque",
    descricao:
      "Estoque, compras e receitas. Foto da nota vira entrada, e o custo de cada prato aparece sozinho.",
    icone: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    pos: { x: -0.75, y: -0.5 },
  },
  {
    id: "clientes",
    nome: "Clientes",
    descricao:
      "Quem já esteve na casa e o que ele diz dela: a base (à mão, Zig, WhatsApp), o parabéns de aniversário, a pesquisa com QR na mesa e as avaliações do Google respondidas no tom da casa.",
    icone: ICONES.pessoa,
    // Não se compra: a base de clientes é da CASA, não de um módulo. Quem só
    // comprou o CMV cadastra clientes na mão e manda parabéns do mesmo jeito.
    // A pesquisa (Voz do Cliente) mora AQUI DENTRO e é ela que se contrata:
    // suas telas acendem ou apagam conforme o contrato, sem favo próprio.
    daCasa: true,
    // Quem tem acesso restrito só à pesquisa (ou só às avaliações) continua
    // entrando por este favo — ele é a porta das duas agora.
    tambem: ["pesquisa", "avaliacoes"],
    // Embaixo do centro: o primeiro que o olho encontra depois dos de cima.
    pos: { x: 0, y: 1 },
  },
  // ---- Fora da colmeia ----
  //
  // A colmeia é a vitrine do que a casa COMPROU. Estes dois não são produto:
  // um é a mesa da equipe Brasa Food, o outro é a configuração da própria
  // casa — que existe para todo cliente, tenha comprado o que tiver
  // comprado. Ambos vivem em botões no cabeçalho.
  {
    id: "hoje",
    nome: "Hoje",
    descricao: "O que precisa de você hoje, e se os números estão ligados.",
    icone: SOL,
    // Não é módulo contratado: junta o que a casa tem.
    interno: true,
  },
  {
    id: "ajustes",
    nome: "Ajustes da casa",
    descricao: "Dados da casa, pessoas com acesso, canais de WhatsApp e chaves.",
    icone: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H8a1.65 1.65 0 001-1.51V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V8a1.65 1.65 0 001.51 1H22a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
    // Não é módulo contratado: toda casa tem.
    interno: true,
  },
  {
    id: "plataforma",
    nome: "Administração",
    descricao:
      "Carteira de clientes, receita, custo de IA e cadastro de cliente novo. Só a equipe Brasa Food.",
    icone: "M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01",
    somentePlataforma: true,
    interno: true,
  },
];

/**
 * Favos vazios: a colmeia mostra para onde ela ainda cresce.
 *
 * CUIDADO ao mexer: cada posição aqui tem que estar LIVRE em MODULOS. Os
 * vazios são desenhados por último, então um vazio na mesma casa de um
 * módulo cobre o módulo — e o favo some sem erro nenhum na tela. Foi o que
 * aconteceu quando o RH nasceu em (0.75, -0.5), que era vazio.
 */
const FAVOS_VAZIOS = [
  { x: 1.5, y: 0 },
  { x: -1.5, y: 0 },
];

const app = document.getElementById("app");
const telaAcesso = document.getElementById("tela-acesso");
const telaHub = document.getElementById("tela-hub");
const nav = document.getElementById("nav");
const main = document.getElementById("pagina");
const seletorVenue = document.getElementById("seletor-venue");

/** A tela aberta agora — o botão "?" abre a ajuda dela. */
let paginaAtual = null;

/** Limpezas registradas pela tela atual (timers, listeners). */
let limpezas = [];

const ctx = {
  venue: null,
  agente: null,
  /** A aba pedida no endereço (#pagina:aba), para a tela abrir nela. */
  aba: null,
  /** Esta pessoa mexe na configuração da casa? (falso = perfil Equipe) */
  podeConfigurar: true,
  definirAgente(slug) {
    ctx.agente = slug;
  },
  aoSair(fn) {
    limpezas.push(fn);
  },
  /**
   * A casa contratou este módulo?
   *
   * Para telas que mostram um pedaço a mais quando outro módulo existe — a
   * ficha do cliente exibindo o que ele achou da casa, por exemplo. É só para
   * DESENHAR: o servidor confere de novo em cada rota, e é lá que está a
   * trava. Aqui é para não prometer ao dono um botão que não vai funcionar.
   */
  temModulo(id) {
    return modulosDoCliente.get(id)?.ativo === true;
  },
  atualizarContador(id, valor) {
    const alvo = nav.querySelector(`[data-pagina="${id}"] .nav-contador`);
    if (!alvo) return;
    alvo.textContent = String(valor);
    alvo.hidden = !valor;
  },
};

// ============ Tema ============
const TEMA = "agentes.tema";

function aplicarTema(tema) {
  document.documentElement.setAttribute("data-tema", tema);
  localStorage.setItem(TEMA, tema);
}

aplicarTema(
  localStorage.getItem(TEMA) ??
    (matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro"),
);

document.getElementById("btn-tema").addEventListener("click", () => {
  aplicarTema(document.documentElement.getAttribute("data-tema") === "escuro" ? "claro" : "escuro");
});

// ============ Menu ============
const RECOLHIDA = "agentes.lateral";
if (localStorage.getItem(RECOLHIDA) === "1") app.setAttribute("data-recolhida", "1");

// Um único botão alterna nos dois sentidos — recolhida ficava sem volta antes.
document.getElementById("btn-recolher").addEventListener("click", () => {
  const recolhida = app.hasAttribute("data-recolhida");
  if (recolhida) app.removeAttribute("data-recolhida");
  else app.setAttribute("data-recolhida", "1");
  localStorage.setItem(RECOLHIDA, recolhida ? "0" : "1");
});

document.getElementById("btn-menu").addEventListener("click", () => {
  // No celular a lateral vira gaveta por cima do conteúdo.
  app.setAttribute("data-menu", "1");
});

document.getElementById("cortina").addEventListener("click", () => app.removeAttribute("data-menu"));

document.getElementById("btn-sair").addEventListener("click", () => {
  esquecerChave();
  location.reload();
});

// ============ Navegação ============
function montarNav() {
  // Escolher estabelecimento não faz sentido enquanto se olha a carteira
  // inteira: o módulo de administração é sobre TODOS os clientes, e um
  // seletor dizendo "Ditado Popular" ali é só ruído que confunde.
  seletorVenue.closest(".topo-acoes").hidden = moduloAtual === "plataforma";

  limpar(nav);
  const atalhos = (MODULOS.find((m) => m.id === moduloAtual)?.atalhos ?? []).filter((a) => podeConfigurar || a.grupo !== "configurar").map((a) => ({
    id: a.destino,
    rotulo: a.rotulo,
    icone: a.icone,
    grupo: a.grupo,
    atalho: true,
  }));
  const itens = [...paginasVisiveis(), ...atalhos];
  // Os grupos só aparecem quando há mais de um: um título "Dia a dia" em
  // cima de uma linha só é ruído.
  const grupos = Object.keys(GRUPOS).filter((g) => itens.some((p) => (p.grupo ?? "dia") === g));
  for (const g of grupos) {
    if (grupos.length > 1) nav.append(el("div", { classe: "nav-grupo", texto: GRUPOS[g] }));
    for (const p of itens.filter((i) => (i.grupo ?? "dia") === g)) {
      nav.append(
        el(
          "a",
          // title vira tooltip — é como se sabe o que é cada ícone na lateral recolhida.
          {
            classe: "nav-item",
            href: `#${p.id}`,
            "data-pagina": p.atalho ? null : p.id,
            title: p.rotulo,
            // Atalho para um endereço que já é o atual não dispara hashchange.
            onclick: p.atalho
              ? (e) => {
                  if (location.hash === `#${p.id}`) {
                    e.preventDefault();
                    irPara(p.id, { podeTrocarDeModulo: true });
                  }
                }
              : null,
          },
          [
            icone(p.icone),
            el("span", { classe: "nav-rotulo", texto: p.rotulo }),
            el("span", { classe: "nav-contador", hidden: true, texto: "0" }),
          ],
        ),
      );
    }
  }
}

async function irPara(endereco, { podeTrocarDeModulo = false } = {}) {
  // "#estoque:historico" = página estoque, aba historico. Endereço antigo
  // passa pelo apelido antes: virou aba, ou mudou de módulo.
  const [base, aba] = (APELIDOS[endereco.split(":")[0]] && !endereco.includes(":")
    ? APELIDOS[endereco]
    : endereco
  ).split(":");
  const id = base;

  // Só as páginas do módulo atual contam; hash de outro módulo cai na
  // primeira página deste — o hub é quem troca de módulo.
  //
  // Páginas de plataforma também somem daqui, e não só do menu: sem isto,
  // digitar #clientes na barra de endereço abriria o formulário de cadastro
  // para um cliente comum. Ele quebraria no servidor (403), mas mostrar uma
  // tela que não vai funcionar é confundir sem motivo. A trava de verdade
  // continua sendo a do servidor — esta é conveniência, não segurança.
  const doModulo = paginasVisiveis();

  // A exceção: um clique da própria pessoa num link para a tela de outro
  // módulo (o atalho "WhatsApp e Instagram" do atendente). Só no clique —
  // a âncora que o navegador guardou da última visita não pode arrastar
  // quem acabou de entrar no CMV de volta para o atendente.
  const deFora = podeTrocarDeModulo && !doModulo.some((p) => p.id === id) ? PAGINAS.find((p) => p.id === id) : null;
  const moduloDeFora = deFora ? MODULOS.find((m) => m.id === deFora.modulo) : null;
  if (moduloDeFora && moduloAceso(moduloDeFora)) {
    moduloAtual = moduloDeFora.id;
    sessionStorage.setItem("brasa.modulo", moduloAtual);
    montarNav();
    return irPara(endereco);
  }

  const pagina = doModulo.find((p) => p.id === id) ?? doModulo[0];
  // Módulo sem nenhuma tela para esta pessoa (tudo nele é de configurar):
  // volta para a colmeia em vez de quebrar.
  if (!pagina) return mostrarHub();
  ctx.aba = pagina.id === id ? (aba ?? null) : null;

  // A tela anterior pode ter deixado timers rodando.
  for (const fn of limpezas) {
    try {
      fn();
    } catch {
      /* limpeza com defeito não pode impedir a troca de tela */
    }
  }
  limpezas = [];

  for (const a of nav.querySelectorAll(".nav-item")) {
    if (a.dataset.pagina === pagina.id) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }

  document.getElementById("titulo-pagina").textContent = pagina.rotulo;
  paginaAtual = pagina;
  document.getElementById("subtitulo-pagina").textContent = pagina.subtitulo ?? "";
  app.removeAttribute("data-menu");

  limpar(main);
  try {
    await pagina.render(main, ctx);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 401) return pedirChave("A chave foi revogada ou expirou.");
    limpar(main).append(
      el("div", { classe: "cartao" }, [
        el("h2", { texto: "Não deu para carregar esta tela" }),
        el("p", { classe: "muted", texto: e.message }),
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Tentar de novo",
          style: "margin-top:10px",
          onclick: () => irPara(endereco),
        }),
      ]),
    );
  }
}

addEventListener("hashchange", () => irPara(location.hash.slice(1), { podeTrocarDeModulo: true }));

// ============ Acesso ============

/**
 * Acende as brasas de uma tela (login ou hub).
 *
 * Cada fagulha sai com tamanho, posição, ritmo e atraso sorteados — brasa de
 * verdade não sobe em fila. Roda uma vez por caixa; o CSS cuida do resto.
 */
function acenderBrasas(caixa) {
  if (!caixa || caixa.childElementCount > 0) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const QUANTAS = 16;
  for (let i = 0; i < QUANTAS; i++) {
    const f = document.createElement("span");
    f.className = "fagulha";
    // Maioria miúda, algumas graúdas — como numa churrasqueira.
    const tamanho = Math.random() < 0.3 ? 10 + Math.random() * 8 : 4 + Math.random() * 6;
    f.style.width = `${tamanho.toFixed(1)}px`;
    f.style.height = `${tamanho.toFixed(1)}px`;
    f.style.left = `${(2 + Math.random() * 96).toFixed(1)}%`;
    // Grande sobe mais devagar: peso.
    f.style.animationDuration = `${(14 - tamanho * 0.4 + Math.random() * 4).toFixed(1)}s`;
    f.style.animationDelay = `${(Math.random() * 10).toFixed(1)}s`;
    caixa.append(f);
  }
}

function pedirChave(mensagem) {
  acenderBrasas(telaAcesso.querySelector(".brasas"));
  app.hidden = true;
  telaHub.hidden = true;
  telaAcesso.hidden = false;
  const erro = document.getElementById("erro-acesso");
  erro.hidden = !mensagem;
  erro.textContent = mensagem ?? "";
}

// ============ Hub de módulos (colmeia) ============

const DICA_PADRAO = "Toque num favo aceso para entrar.";

/**
 * Este favo acende para o cliente aberto agora?
 *
 * Administração não é módulo contratado — é a mesa da equipe Brasa Food, e já
 * foi filtrada por `souPlataforma` antes de chegar aqui.
 */
function moduloAceso(m) {
  if (m.somentePlataforma) return true;
  // Os Ajustes são só configuração: o perfil Equipe não tem o que fazer lá.
  if (m.id === "ajustes" && !podeConfigurar) return false;
  // Ajustes da casa não se compra: toda casa tem a sua configuração, e sem
  // ela um cliente que só comprou Checklist não teria como conectar o
  // WhatsApp nem criar o login do gerente.
  if (m.interno) return true;
  // Nem a base de clientes: ela é da casa, e não um módulo contratado — não
  // existe linha de contrato para ela, e cobrar uma apagaria o favo de todo
  // mundo. Só a pergunta do CONTRATO é pulada; a da pessoa continua abaixo.
  if (!m.daCasa && modulosDoCliente.get(m.id)?.ativo !== true) return false;
  // A restrição da pessoa, por cima da contratação da casa. Vale para o favo
  // "da casa" também: o servidor recusa a base de clientes para quem tem
  // acesso restrito a outro módulo, e favo que abre em 403 é pior do que favo
  // que não abre.
  if (meusModulos === null) return true;
  return meusModulos.includes(m.id) || (m.tambem ?? []).some((id) => meusModulos.includes(id));
}

/**
 * As telas do módulo aberto que ESTA pessoa, NESTA casa, pode ver.
 *
 * Três filtros, na ordem: o módulo; plataforma só para a equipe Brasa Food;
 * e `requer` — a tela que depende de um contrato à parte (a pesquisa dentro
 * de Clientes) só aparece se a casa contratou e se a pessoa não está
 * restrita a outra coisa. É o mesmo que o servidor confere em cada rota:
 * esconder aqui é para não mostrar tela que vai abrir em 403.
 */
function paginasVisiveis() {
  return PAGINAS.filter((p) => {
    if (p.modulo !== moduloAtual) return false;
    if (p.plataforma && !souPlataforma) return false;
    if (p.grupo === "configurar" && !podeConfigurar) return false;
    if (p.requer) {
      if (modulosDoCliente.get(p.requer)?.ativo !== true) return false;
      if (meusModulos !== null && !meusModulos.includes(p.requer)) return false;
    }
    return true;
  });
}

/**
 * A colmeia: chama no centro, um favo por módulo em volta, filetes de
 * energia ligando tudo. As posições vêm de MODULOS/FAVOS_VAZIOS em passos
 * de favo; o CSS transforma em pixels. Células brotam em sequência.
 */
function montarHub() {
  const colmeia = document.getElementById("colmeia");
  const descricao = document.getElementById("hub-desc");
  limpar(colmeia);

  // Filetes de energia, por baixo das células. O container mede 2.5
  // larguras por 3 alturas de favo — daí a conversão para %.
  const NS = "http://www.w3.org/2000/svg";
  const linhas = document.createElementNS(NS, "svg");
  linhas.setAttribute("class", "colmeia-linhas");
  linhas.setAttribute("aria-hidden", "true");
  const ligar = ({ x, y }, classe) => {
    const linha = document.createElementNS(NS, "line");
    linha.setAttribute("x1", "50%");
    linha.setAttribute("y1", "50%");
    linha.setAttribute("x2", `${50 + (x / 2.5) * 100}%`);
    linha.setAttribute("y2", `${50 + (y / 3) * 100}%`);
    linha.setAttribute("class", classe);
    linhas.append(linha);
  };
  // Só produto entra na colmeia. Ajustes e Administração vivem em botões no
  // cabeçalho: um é configuração da casa, o outro é a mesa da equipe — nenhum
  // dos dois é coisa que o cliente comprou.
  const visiveis = MODULOS.filter((m) => !m.interno);
  // Módulo novo ocupando uma casa que era vaga não pode ficar escondido
  // embaixo do favo vazio: quem chegou depois manda. Sem isto, o favo some da
  // tela sem erro nenhum — foi o que aconteceu com o RH.
  const ocupadas = new Set(visiveis.map((m) => `${m.pos.x},${m.pos.y}`));
  const vazios = FAVOS_VAZIOS.filter((f) => !ocupadas.has(`${f.x},${f.y}`));

  for (const m of visiveis) ligar(m.pos, moduloAceso(m) ? "linha linha-viva" : "linha");
  for (const f of vazios) ligar(f, "linha linha-apagada");
  colmeia.append(linhas);

  const posicao = ({ x, y }, ordem) => `--dx:${x};--dy:${y};--ordem:${ordem}`;

  // A troca reinicia a animação de fade — sem isto o texto pisca seco.
  const contar = (texto) => {
    descricao.classList.remove("trocando");
    void descricao.offsetWidth;
    descricao.textContent = texto;
    descricao.classList.add("trocando");
  };

  // O miolo é a marca, não um botão.
  colmeia.append(
    el(
      "div",
      { classe: "celula hex-centro", style: posicao({ x: 0, y: 0 }, 0), "aria-hidden": "true" },
      [
        el("img", { classe: "hex-chama", src: "/img/chama-brasa-food.png", alt: "" }),
        el("span", { classe: "hex-wordmark" }, [
          el("span", { texto: "Brasa" }),
          el("span", { classe: "hex-food", texto: "Food" }),
        ]),
      ],
    ),
  );

  visiveis.forEach((m, i) => {
    const aceso = moduloAceso(m);
    // Favo apagado agora quer dizer "não está no seu contrato", não "ainda não
    // existe". Dizer "em breve" para algo que já roda faria o cliente esperar
    // por uma coisa que ele só precisa pedir.
    const dica = aceso ? m.descricao : `${m.descricao} — não está no seu plano.`;
    colmeia.append(
      el(
        "button",
        {
          classe: `celula hex-modulo${aceso ? "" : " hex-apagado"}`,
          type: "button",
          style: posicao(m.pos, i + 1),
          // aria-disabled (e não disabled) para o favo "em breve" continuar
          // contando o que é ao passar o mouse ou focar.
          "aria-disabled": String(!aceso),
          "aria-label": `${m.nome}${aceso ? "" : " — não incluso no plano"}`,
          onclick: () =>
            aceso
              ? entrarNoModulo(m.id)
              : avisar(`${m.nome} não faz parte do seu plano. Fale com a gente para ativar.`, "info"),
          onmouseenter: () => contar(dica),
          onfocus: () => contar(dica),
        },
        [
          el("span", { classe: "hex-icone" }, [icone(m.icone, 22)]),
          el("span", { classe: "hex-nome", texto: m.nome }),
          el("span", {
            classe: `hex-etiqueta${aceso ? " hex-etiqueta-ativa" : ""}`,
            texto: aceso ? "Entrar" : "Ativar",
          }),
        ],
      ),
    );
  });

  vazios.forEach((f, i) => {
    colmeia.append(
      el("div", {
        classe: "celula hex-vazio",
        style: posicao(f, visiveis.length + 1 + i),
        "aria-hidden": "true",
        texto: "+",
      }),
    );
  });

  colmeia.addEventListener("mouseleave", () => contar(DICA_PADRAO));
  contar(DICA_PADRAO);
}

function mostrarHub() {
  acenderBrasas(telaHub.querySelector(".brasas"));
  telaAcesso.hidden = true;
  app.hidden = true;
  app.removeAttribute("data-menu");
  telaHub.hidden = false;
}

/** Abre um módulo: a lateral e as telas viram as dele. */
function entrarNoModulo(moduloId = "agentes-ia") {
  // A pesquisa deixou de ser favo e passou a morar em Clientes. Aba que
  // guardou "pesquisa" antes disso, e atalho antigo, chegam no lugar certo.
  if (moduloId === "pesquisa" || moduloId === "avaliacoes") moduloId = "clientes";
  const definicao = MODULOS.find((m) => m.id === moduloId);

  // Quem guardou o endereço de uma tela entraria por ela mesmo com o favo
  // apagado. As rotas do servidor são a trava de verdade; isto evita a tela
  // meio carregada, cheia de erro, que parece defeito e não falta de contrato.
  if (definicao && !moduloAceso(definicao)) {
    mostrarHub();
    return avisar(`${definicao.nome} não faz parte do seu plano.`, "info");
  }

  moduloAtual = PAGINAS.some((p) => p.modulo === moduloId) ? moduloId : "agentes-ia";
  // F5 dentro do módulo não deve voltar pro saguão — mas fechar o navegador
  // e voltar amanhã, sim. Por isso sessionStorage, que morre com a aba.
  sessionStorage.setItem("brasa.hub.visto", "1");
  sessionStorage.setItem("brasa.modulo", moduloAtual);
  montarNav();
  telaHub.hidden = true;
  app.hidden = false;
  irPara(location.hash.slice(1));
  if (moduloAtual === "agentes-ia") contarPendentes();
}

document.getElementById("btn-hub").addEventListener("click", mostrarHub);
document.getElementById("btn-sair-hub").addEventListener("click", () => {
  esquecerChave();
  location.reload();
});
// Os dois que não são favo: configuração da casa e a mesa da equipe.
document.getElementById("btn-ajustes").addEventListener("click", () => entrarNoModulo("ajustes"));
document.getElementById("btn-hoje").addEventListener("click", () => entrarNoModulo("hoje"));
document.getElementById("btn-ajuda").addEventListener("click", () => {
  if (paginaAtual) abrirAjuda({ pagina: paginaAtual.id, rotulo: paginaAtual.rotulo, admin: souPlataforma });
});
document.getElementById("btn-hoje-lateral").addEventListener("click", () => entrarNoModulo("hoje"));
document.getElementById("btn-plataforma").addEventListener("click", () => entrarNoModulo("plataforma"));

// ---------- Entrada por e-mail e senha ----------
const formAcesso = document.getElementById("form-acesso");
const formChave = document.getElementById("form-chave");

function mostrarErroAcesso(id, mensagem) {
  const alvo = document.getElementById(id);
  alvo.hidden = !mensagem;
  alvo.textContent = mensagem ?? "";
}

formAcesso.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("campo-email").value.trim();
  const senha = document.getElementById("campo-senha").value;
  const lembrar = document.getElementById("campo-lembrar")?.checked ?? true;
  if (!email || !senha) return;

  const botao = formAcesso.querySelector("button[type=submit]");
  botao.disabled = true;
  botao.textContent = "Entrando…";
  mostrarErroAcesso("erro-acesso", null);
  try {
    // Sem `post()`: ainda não há sessão, e mandar Authorization com um token
    // velho aqui faria o servidor recusar um login legítimo.
    //
    // Com prazo: sem ele, um servidor que não responde deixa o botão em
    // "Entrando…" para sempre, e a pessoa fica olhando uma tela que nunca
    // vai mudar sem saber se a culpa é da senha, da internet ou de nós.
    const resposta = await fetch("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, senha }),
      signal: AbortSignal.timeout(30_000),
    }).catch((e) => {
      throw new Error(
        navigator.onLine === false
          ? "Seu aparelho está sem internet. Confira a conexão e tente de novo."
          : e?.name === "TimeoutError"
            ? "O servidor demorou demais para responder. Tente de novo em instantes."
            : "Não deu para falar com o servidor. Confira a internet e tente de novo.",
      );
    });
    const corpo = await resposta.json();
    if (!resposta.ok || corpo?.success === false) {
      throw new Error(corpo?.error?.message ?? "Não deu para entrar.");
    }
    salvarSessao(corpo.data, { lembrar });
    await iniciar();
  } catch (erro) {
    mostrarErroAcesso("erro-acesso", erro.message);
  } finally {
    botao.disabled = false;
    botao.textContent = "Entrar";
  }
});

document.getElementById("btn-esqueci").addEventListener("click", async () => {
  const email = document.getElementById("campo-email").value.trim();
  if (!email) {
    return mostrarErroAcesso("erro-acesso", "Escreva seu e-mail antes — é para lá que o link vai.");
  }
  await fetch("/v1/auth/recuperar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, redirect: `${location.origin}/app` }),
  }).catch(() => {});
  // Resposta igual exista ou não o e-mail: dizer "não encontrei" entregaria
  // a lista de quem é cliente a quem ficar testando endereços.
  mostrarErroAcesso("erro-acesso", "Se esse e-mail tiver conta, o link de troca chega em instantes.");
});

// ---------- Definir senha nova ----------
//
// O Supabase manda o link de recuperação com os tokens no FRAGMENTO da URL
// (#access_token=...&type=recovery). Fragmento não vai para o servidor, então
// quem tem que reconhecê-lo é esta página — sem isto o cliente clica no link
// do e-mail, cai no painel e não acontece nada.
const formNovaSenha = document.getElementById("form-nova-senha");
let tokenDeTroca = null;

function verificarLinkDeRecuperacao() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!hash.includes("access_token")) return false;

  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  if (!token) return false;

  tokenDeTroca = token;
  // Limpa o endereço na hora: token em URL fica no histórico do navegador e
  // vaza em print de tela ou link compartilhado.
  history.replaceState(null, "", location.pathname + location.search);

  acenderBrasas(telaAcesso.querySelector(".brasas"));
  app.hidden = true;
  telaHub.hidden = true;
  telaAcesso.hidden = false;
  formAcesso.hidden = true;
  formChave.hidden = true;
  formNovaSenha.hidden = false;
  document.getElementById("campo-nova-senha").focus();
  return true;
}

/**
 * Tranca o painel na tela de senha até a pessoa escolher a sua.
 *
 * Reaproveita o formulário da recuperação: é a mesma pergunta, e manter uma
 * tela só significa que qualquer melhoria nela vale para os dois caminhos. A
 * diferença é o token — aqui é o da sessão que acabou de abrir, não o de um
 * link de e-mail.
 */
function exigirTrocaDeSenha() {
  trocaObrigatoria = true;
  tokenDeTroca = chaveSalva();

  acenderBrasas(telaAcesso.querySelector(".brasas"));
  app.hidden = true;
  telaHub.hidden = true;
  telaAcesso.hidden = false;
  formAcesso.hidden = true;
  formChave.hidden = true;
  formNovaSenha.hidden = false;

  // O aviso explica POR QUE a tela apareceu. Sem ele, quem acabou de entrar
  // com a senha certa acha que ela não funcionou.
  mostrarErroAcesso(
    "erro-nova-senha",
    "Sua senha foi criada por outra pessoa e ditada para você. Escolha uma senha sua para continuar.",
  );
  document.getElementById("campo-nova-senha").focus();
}

// Erro some ao digitar. Sem isto, quando o próprio navegador barra o envio
// (o minlength do campo), a mensagem da tentativa anterior fica na tela
// contradizendo o que a pessoa acabou de corrigir.
for (const id of ["campo-nova-senha", "campo-nova-senha-2"]) {
  document.getElementById(id).addEventListener("input", () =>
    mostrarErroAcesso("erro-nova-senha", null),
  );
}

formNovaSenha.addEventListener("submit", async (e) => {
  e.preventDefault();
  const senha = document.getElementById("campo-nova-senha").value;
  const repetida = document.getElementById("campo-nova-senha-2").value;
  mostrarErroAcesso("erro-nova-senha", null);

  if (senha !== repetida) {
    return mostrarErroAcesso("erro-nova-senha", "As duas senhas não são iguais.");
  }
  if (senha.length < 8) {
    return mostrarErroAcesso("erro-nova-senha", "A senha precisa ter pelo menos 8 caracteres.");
  }

  const botao = formNovaSenha.querySelector("button[type=submit]");
  botao.disabled = true;
  botao.textContent = "Salvando…";
  try {
    const resposta = await fetch("/v1/auth/senha", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokenDeTroca}` },
      body: JSON.stringify({ senha }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new Error("O servidor não respondeu. Tente salvar a senha de novo.");
    });
    const corpo = await resposta.json();
    if (!resposta.ok || corpo?.success === false) {
      throw new Error(corpo?.error?.message ?? "Não deu para salvar a senha.");
    }
    // Vindo da troca obrigatória, a pessoa JÁ está logada: mandá-la entrar
    // de novo seria pedir duas vezes a mesma senha que ela acabou de criar.
    //
    // Mas o token que ela tinha morreu junto com a senha antiga. O servidor
    // devolve um par novo justamente por isso — sem guardá-lo, o painel
    // seguiria com o token morto e as telas viriam vazias.
    if (trocaObrigatoria) {
      if (corpo.data?.sessao) {
        salvarSessao(corpo.data.sessao, { lembrar: !sessionStorage.getItem("agentes.chave") });
      }
      trocaObrigatoria = false;
      tokenDeTroca = null;
      formNovaSenha.hidden = true;
      formAcesso.hidden = false;
      return iniciar();
    }

    // Veio do link de recuperação: aqui a pessoa não estava logada, então o
    // par novo também serve — entra direto em vez de digitar a senha que
    // acabou de criar.
    if (corpo.data?.sessao) {
      salvarSessao(corpo.data.sessao, { lembrar: true });
      tokenDeTroca = null;
      formNovaSenha.hidden = true;
      formAcesso.hidden = false;
      return iniciar();
    }
    tokenDeTroca = null;
    formNovaSenha.hidden = true;
    formAcesso.hidden = false;
    mostrarErroAcesso("erro-acesso", "Senha salva! Entre com ela agora.");
  } catch (erro) {
    mostrarErroAcesso("erro-nova-senha", erro.message);
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar senha";
  }
});

// ---------- Entrada por chave (máquinas e transição) ----------
document.getElementById("btn-usar-chave").addEventListener("click", () => {
  formAcesso.hidden = true;
  formChave.hidden = false;
});
document.getElementById("btn-usar-senha").addEventListener("click", () => {
  formChave.hidden = true;
  formAcesso.hidden = false;
});

formChave.addEventListener("submit", async (e) => {
  e.preventDefault();
  const chave = document.getElementById("campo-chave").value.trim();
  if (!chave) return;
  salvarChave(chave);
  await iniciar();
});

async function iniciar() {
  // Antes de tudo: o link do e-mail de recuperação tem precedência sobre
  // qualquer sessão salva. Quem chega por ele veio justamente porque não
  // consegue entrar.
  if (verificarLinkDeRecuperacao()) return;

  if (!chaveSalva()) return pedirChave();

  let venues;
  try {
    venues = await get("/v1/venues");
  } catch (e) {
    esquecerChave();
    return pedirChave(
      e instanceof ErroApi && e.status === 401
        ? "Sua sessão expirou ou a credencial não vale mais. Entre de novo."
        : e.message,
    );
  }

  if (venues.length === 0) {
    return pedirChave("A chave é válida, mas não há estabelecimento nesta organização. Rode `npm run seed`.");
  }

  telaAcesso.hidden = true;

  limpar(seletorVenue);
  for (const v of venues) seletorVenue.append(el("option", { value: v.slug, texto: v.name }));

  const nomeDoVenue = () => venues.find((v) => v.slug === ctx.venue)?.name ?? "";
  const salvo = localStorage.getItem("agentes.venue");
  ctx.venue = venues.some((v) => v.slug === salvo) ? salvo : venues[0].slug;
  seletorVenue.value = ctx.venue;
  document.getElementById("marca-org").textContent = nomeDoVenue();
  document.getElementById("hub-org").textContent = nomeDoVenue();

  seletorVenue.addEventListener("change", async () => {
    ctx.venue = seletorVenue.value;
    localStorage.setItem("agentes.venue", ctx.venue);
    document.getElementById("marca-org").textContent = nomeDoVenue();
    document.getElementById("hub-org").textContent = nomeDoVenue();
    // Cada casa tem o seu contrato: trocar de estabelecimento sem recarregar
    // os módulos deixaria a colmeia mostrando o que a casa anterior comprou.
    await carregarModulos();
    montarHub();
    irPara(location.hash.slice(1));
  });

  try {
    const eu = await get("/v1/auth/me");
    souPlataforma = eu.plataforma_admin === true;
    meusModulos = Array.isArray(eu.modulos) ? eu.modulos : null;
    podeConfigurar = eu.pode_configurar !== false;

    // Senha ditada é senha que outra pessoa sabe. Enquanto ela não trocar, o
    // painel inteiro fica fechado — não adianta pedir depois, porque "depois"
    // nunca chega quando a tela já está aberta e o trabalho, começando.
    if (eu.senha_provisoria === true) return exigirTrocaDeSenha();
  } catch {
    souPlataforma = false;
    meusModulos = null;
  }
  ctx.podeConfigurar = podeConfigurar;
  document.getElementById("btn-plataforma").hidden = !souPlataforma;
  document.getElementById("btn-ajustes").hidden = !podeConfigurar;

  await carregarModulos();

  // A tela de Canais precisa saber qual agente vai atender no WhatsApp, e ela
  // pode ser a primeira que o usuário abre — sem isto, "Conectar" iria sem agente.
  try {
    const agentes = await get("/v1/agents");
    ctx.agente = agentes[0]?.slug ?? null;
  } catch {
    /* sem agente listado, a tela de Canais avisa ao tentar conectar */
  }

  montarNav();
  montarHub();

  // A colmeia recebe toda entrada nova. Só pula direto pro módulo quem:
  // - veio de um atalho explícito (?direto=1, como o iniciar-brasa.bat), ou
  // - já passou pelo hub nesta sessão e só deu F5 dentro do módulo.
  // A âncora (#reservas etc.) sozinha NÃO pula: o navegador guarda a da
  // última visita, e o hub sumia pra sempre depois do primeiro uso.
  const busca = new URLSearchParams(location.search);
  // A volta do login do Instagram: o dono saiu do painel para autorizar a
  // conta e o Instagram o devolve aqui com o resultado. Vai DIRETO para a
  // tela de onde saiu — cair no saguão, ou numa tela de outro módulo,
  // engolia o aviso e parecia que nada tinha acontecido.
  if (busca.has("instagram")) {
    location.hash = "#canais-casa";
    entrarNoModulo("ajustes");
    return;
  }
  // Entrada nova abre o Hoje: é a pergunta de quem chega de manhã, e a
  // colmeia continua a um clique ("Módulos"). F5 dentro de um módulo e o
  // atalho ?direto=1 voltam para onde estavam.
  const direto = busca.has("direto") || sessionStorage.getItem("brasa.hub.visto") === "1";
  if (direto) entrarNoModulo(sessionStorage.getItem("brasa.modulo") ?? "agentes-ia");
  else entrarNoModulo("hoje");
}

/**
 * O que este estabelecimento contratou.
 *
 * Falhando, o painel fica com o que o cliente sempre teve em vez de abrir uma
 * colmeia apagada — uma rede ruim não deve parecer contrato cancelado.
 */
async function carregarModulos() {
  try {
    const lista = await get(`/v1/venues/${ctx.venue}/modulos`);
    modulosDoCliente = new Map(lista.map((m) => [m.modulo, m]));
  } catch {
    modulosDoCliente = new Map(
      ["agentes-ia", "checklist", "avaliacoes"].map((id) => [id, { modulo: id, ativo: true, url: null }]),
    );
  }
}

/** Badge de reservas na lateral, para a fila não passar despercebida. */
async function contarPendentes() {
  try {
    const m = await get(`/v1/venues/${ctx.venue}/metrics`);
    ctx.atualizarContador("reservas", m.reservas.pendentes);
  } catch {
    /* o contador é enfeite: se falhar, a tela de reservas ainda mostra a fila */
  }
}

iniciar().catch((e) => avisar(e.message, "erro"));
