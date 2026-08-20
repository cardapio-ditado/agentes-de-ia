import { ErroApi, chaveSalva, esquecerChave, get, post, salvarChave, salvarSessao } from "./api.js";
import { ICONES, avisar, el, icone, limpar } from "./ui.js";
import { painel } from "./pages/painel.js";
import { clientes } from "./pages/clientes.js";
import { plataforma } from "./pages/plataforma.js";
import { conversas } from "./pages/conversas.js";
import { reservas } from "./pages/reservas.js";
import { programacao } from "./pages/programacao.js";
import { canais } from "./pages/canais.js";
import { canaisDaCasa } from "./pages/canaisDaCasa.js";
import { pessoas } from "./pages/pessoas.js";
import { agentes } from "./pages/agentes.js";
import { agente } from "./pages/agente.js";
import { empresa } from "./pages/empresa.js";
import { agenteSabe } from "./pages/agenteSabe.js";
import { organizacao } from "./pages/organizacao.js";
import { checklists } from "./pages/checklists.js";
import { execucoes } from "./pages/execucoes.js";
import { avaliacoes } from "./pages/avaliacoes.js";
import { recebimento } from "./pages/recebimento.js";
import { compras } from "./pages/compras.js";
import { cadastros } from "./pages/cadastros.js";
import { fichas } from "./pages/fichas.js";
import { contagem } from "./pages/contagem.js";
import { estoque } from "./pages/estoque.js";
import { cmvPainel } from "./pages/cmvPainel.js";
import { vendas } from "./pages/vendas.js";
import { producao } from "./pages/producao.js";

/**
 * Casca do painel: barra lateral, roteamento por hash e estado compartilhado.
 *
 * Cada tela é uma função `(raiz, ctx)` que desenha dentro de <main>. O roteador
 * limpa o main e chama a tela — sem framework, sem build.
 */

// Cada página pertence a um módulo do hub; a lateral só mostra as do módulo
// em que o usuário entrou.
const PAGINAS = [
  { id: "painel", modulo: "agentes-ia", rotulo: "Painel", icone: ICONES.painel, render: painel, subtitulo: "Visão geral do movimento" },
  { id: "conversas", modulo: "agentes-ia", rotulo: "Conversas", icone: ICONES.conversas, render: conversas, subtitulo: "Atendimentos do agente" },
  { id: "reservas", modulo: "agentes-ia", rotulo: "Reservas", icone: ICONES.reservas, render: reservas, subtitulo: "Fila de aprovação" },
  { id: "programacao", modulo: "agentes-ia", rotulo: "Programação", icone: ICONES.programacao, render: programacao, subtitulo: "Shows, jogos e promoções" },
  { id: "agentes", modulo: "agentes-ia", rotulo: "Agentes", icone: ICONES.agente, render: agentes, subtitulo: "Monte a personalidade e as regras" },
  { id: "agente-sabe", modulo: "agentes-ia", rotulo: "O que o agente sabe", icone: ICONES.organizacao, render: agenteSabe, subtitulo: "Endereço, horários e as respostas às perguntas do cliente" },
  { id: "canais", modulo: "agentes-ia", rotulo: "Canais do agente", icone: ICONES.canais, render: canais, subtitulo: "O número que o agente atende, e o Instagram" },
  { id: "agente", modulo: "agentes-ia", rotulo: "Testar agente", icone: ICONES.raio, render: agente, subtitulo: "Converse como se fosse um cliente" },

  // ---- Ajustes da casa: fora de qualquer módulo ----
  //
  // Empresa, pessoas, canais e chaves não são produto — são o que toda casa
  // tem. Moravam dentro de "Agentes de IA" por acidente histórico (o agente
  // foi o primeiro módulo), e por causa disso um cliente que comprasse só o
  // CMV não tinha onde cadastrar a própria casa nem criar login de gerente.
  { id: "empresa", modulo: "ajustes", rotulo: "A casa", icone: ICONES.organizacao, render: empresa, subtitulo: "Nome, contato e o fuso horário que todos os módulos usam" },
  { id: "pessoas", modulo: "ajustes", rotulo: "Pessoas e acessos", icone: ICONES.pessoa, render: pessoas, subtitulo: "Quem entra no painel, e o que cada um pode fazer" },
  { id: "canais-casa", modulo: "ajustes", rotulo: "WhatsApp da casa", icone: ICONES.canais, render: canaisDaCasa, subtitulo: "O número que envia checklist, avisos e confirmações" },
  { id: "organizacao", modulo: "ajustes", rotulo: "Estabelecimentos e chaves", icone: ICONES.painel, render: organizacao, subtitulo: "Unidades da rede, agentes e chaves de API" },

  { id: "checklists", modulo: "checklist", rotulo: "Checklists", icone: ICONES.checklist, render: checklists, subtitulo: "Rotinas da equipe: monte, agende e dispare" },
  { id: "execucoes", modulo: "checklist", rotulo: "Execuções", icone: ICONES.relogio, render: execucoes, subtitulo: "Quem fez, quando, e o que a IA encontrou" },

  { id: "avaliacoes", modulo: "avaliacoes", rotulo: "Avaliações", icone: ICONES.estrela, render: avaliacoes, subtitulo: "Fila de aprovação, tom da casa e histórico" },

  // A ordem é a do dia de trabalho: o número primeiro, depois o que se faz
  // toda manhã, depois o que se faz às vezes, por fim o que se cadastra uma
  // vez e esquece.
  { id: "cmv-painel", modulo: "cmv", rotulo: "Painel do CMV", icone: ICONES.painel, render: cmvPainel, subtitulo: "O percentual do período, com a conta aberta" },
  { id: "recebimento", modulo: "cmv", rotulo: "Receber mercadoria", icone: ICONES.caixa, render: recebimento, subtitulo: "Fotografe a nota, confira o que chegou, dê entrada" },
  { id: "compras", modulo: "cmv", rotulo: "Compras", icone: ICONES.reservas, render: compras, subtitulo: "Monte e envie pedidos ao fornecedor" },
  { id: "producao", modulo: "cmv", rotulo: "Produção", icone: ICONES.raio, render: producao, subtitulo: "A receita foi feita — os insumos saem do estoque" },
  { id: "vendas", modulo: "cmv", rotulo: "Vendas", icone: ICONES.raio, render: vendas, subtitulo: "O relatório do seu PDV baixa o estoque pelas fichas" },
  { id: "contagem", modulo: "cmv", rotulo: "Contagem", icone: ICONES.atualizar, render: contagem, subtitulo: "O contado vira o saldo — e a quebra aparece em reais" },
  { id: "estoque", modulo: "cmv", rotulo: "Estoque", icone: ICONES.painel, render: estoque, subtitulo: "Posição, extrato, transferência, perda — e os locais de estoque" },
  { id: "cadastros", modulo: "cmv", rotulo: "Cadastros", icone: ICONES.organizacao, render: cadastros, subtitulo: "Itens, categorias e fornecedores — a base de tudo" },
  { id: "fichas", modulo: "cmv", rotulo: "Fichas técnicas", icone: ICONES.checklist, render: fichas, subtitulo: "O que cada prato consome — e quanto custa" },

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
    nome: "Agentes de IA",
    descricao:
      "Atendimento no WhatsApp e Instagram: reservas, programação e dúvidas respondidas na hora.",
    icone:
      "M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z",
    // Posição na colmeia, em passos de favo a partir do centro (x em larguras,
    // y em alturas de hexágono).
    pos: { x: 0, y: -1 },
  },
  {
    id: "cardapio-digital",
    nome: "Cardápio Digital",
    descricao: "QR code na mesa, cardápio sempre atualizado e pedidos sem fila no balcão.",
    icone: "M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z",
    // O cardápio é um deploy separado, com domínio próprio de cada cliente. O
    // endereço vem do banco (venue_modulos.url) e o favo abre noutra aba: o
    // painel continua onde estava, para quem só foi conferir um preço.
    externo: true,
    pos: { x: -0.75, y: 0.5 },
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
    id: "avaliacoes",
    nome: "Avaliações do Google",
    descricao:
      "Toda avaliação respondida, no tom da casa. Nota baixa nunca sai sem alguém ler.",
    icone: ICONES.estrela,
    pos: { x: 0.75, y: -0.5 },
  },
  {
    id: "cmv",
    nome: "CMV Inteligente",
    descricao:
      "Estoque, compras e fichas técnicas. Foto da nota vira entrada, e o custo de cada prato aparece sozinho.",
    icone: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    pos: { x: -0.75, y: -0.5 },
  },
  // ---- Fora da colmeia ----
  //
  // A colmeia é a vitrine do que a casa COMPROU. Estes dois não são produto:
  // um é a mesa da equipe Brasa Food, o outro é a configuração da própria
  // casa — que existe para todo cliente, tenha comprado o que tiver
  // comprado. Ambos vivem em botões no cabeçalho.
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

/** Favos vazios: a colmeia mostra para onde ela ainda cresce. */
const FAVOS_VAZIOS = [{ x: 0, y: 1 }];

const app = document.getElementById("app");
const telaAcesso = document.getElementById("tela-acesso");
const telaHub = document.getElementById("tela-hub");
const nav = document.getElementById("nav");
const main = document.getElementById("pagina");
const seletorVenue = document.getElementById("seletor-venue");

/** Limpezas registradas pela tela atual (timers, listeners). */
let limpezas = [];

const ctx = {
  venue: null,
  agente: null,
  definirAgente(slug) {
    ctx.agente = slug;
  },
  aoSair(fn) {
    limpezas.push(fn);
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
  for (const p of PAGINAS.filter((p) => p.modulo === moduloAtual && (!p.plataforma || souPlataforma))) {
    nav.append(
      el(
        "a",
        // title vira tooltip — é como se sabe o que é cada ícone na lateral recolhida.
        { classe: "nav-item", href: `#${p.id}`, "data-pagina": p.id, title: p.rotulo },
        [
          icone(p.icone),
          el("span", { classe: "nav-rotulo", texto: p.rotulo }),
          el("span", { classe: "nav-contador", hidden: true, texto: "0" }),
        ],
      ),
    );
  }
}

async function irPara(id) {
  // Só as páginas do módulo atual contam; hash de outro módulo cai na
  // primeira página deste — o hub é quem troca de módulo.
  //
  // Páginas de plataforma também somem daqui, e não só do menu: sem isto,
  // digitar #clientes na barra de endereço abriria o formulário de cadastro
  // para um cliente comum. Ele quebraria no servidor (403), mas mostrar uma
  // tela que não vai funcionar é confundir sem motivo. A trava de verdade
  // continua sendo a do servidor — esta é conveniência, não segurança.
  const doModulo = PAGINAS.filter(
    (p) => p.modulo === moduloAtual && (!p.plataforma || souPlataforma),
  );
  const pagina = doModulo.find((p) => p.id === id) ?? doModulo[0];

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
          onclick: () => irPara(id),
        }),
      ]),
    );
  }
}

addEventListener("hashchange", () => irPara(location.hash.slice(1)));

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
  // Ajustes da casa não se compra: toda casa tem a sua configuração, e sem
  // ela um cliente que só comprou Checklist não teria como conectar o
  // WhatsApp nem criar o login do gerente.
  if (m.interno) return true;
  if (modulosDoCliente.get(m.id)?.ativo !== true) return false;
  // A restrição da pessoa, por cima da contratação da casa.
  return meusModulos === null || meusModulos.includes(m.id);
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
  const vazios = [...FAVOS_VAZIOS];

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
  const definicao = MODULOS.find((m) => m.id === moduloId);

  // Módulo que mora fora do painel abre noutra aba. O endereço é por cliente:
  // cada casa tem o seu domínio de cardápio.
  if (definicao?.externo) {
    const endereco = modulosDoCliente.get(moduloId)?.url;
    if (!endereco) {
      return avisar(
        `O endereço do ${definicao.nome} deste estabelecimento ainda não foi cadastrado.`,
        "erro",
      );
    }
    // noopener: sem ele a aba aberta pode mexer nesta pelo window.opener.
    return void window.open(endereco, "_blank", "noopener");
  }

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
    const resposta = await fetch("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, senha }),
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
    });
    const corpo = await resposta.json();
    if (!resposta.ok || corpo?.success === false) {
      throw new Error(corpo?.error?.message ?? "Não deu para salvar a senha.");
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
  } catch {
    souPlataforma = false;
    meusModulos = null;
  }
  document.getElementById("btn-plataforma").hidden = !souPlataforma;

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
  const direto =
    new URLSearchParams(location.search).has("direto") ||
    sessionStorage.getItem("brasa.hub.visto") === "1";
  if (direto) entrarNoModulo(sessionStorage.getItem("brasa.modulo") ?? "agentes-ia");
  else mostrarHub();
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
