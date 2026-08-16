import { ErroApi, chaveSalva, esquecerChave, get, salvarChave } from "./api.js";
import { ICONES, avisar, el, icone, limpar } from "./ui.js";
import { painel } from "./pages/painel.js";
import { conversas } from "./pages/conversas.js";
import { reservas } from "./pages/reservas.js";
import { programacao } from "./pages/programacao.js";
import { canais } from "./pages/canais.js";
import { agentes } from "./pages/agentes.js";
import { agente } from "./pages/agente.js";
import { empresa } from "./pages/empresa.js";
import { organizacao } from "./pages/organizacao.js";
import { checklists } from "./pages/checklists.js";
import { execucoes } from "./pages/execucoes.js";

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
  { id: "empresa", modulo: "agentes-ia", rotulo: "Empresa", icone: ICONES.organizacao, render: empresa, subtitulo: "Endereço, horários e informações da casa" },
  { id: "agentes", modulo: "agentes-ia", rotulo: "Agentes", icone: ICONES.agente, render: agentes, subtitulo: "Monte a personalidade e as regras" },
  { id: "canais", modulo: "agentes-ia", rotulo: "Canais", icone: ICONES.canais, render: canais, subtitulo: "Por onde o agente atende" },
  { id: "agente", modulo: "agentes-ia", rotulo: "Testar agente", icone: ICONES.raio, render: agente, subtitulo: "Converse como se fosse um cliente" },
  { id: "organizacao", modulo: "agentes-ia", rotulo: "Organização", icone: ICONES.pessoa, render: organizacao, subtitulo: "Estabelecimentos, agentes e chaves" },

  { id: "checklists", modulo: "checklist", rotulo: "Checklists", icone: ICONES.checklist, render: checklists, subtitulo: "Rotinas da equipe: monte, agende e dispare" },
  { id: "execucoes", modulo: "checklist", rotulo: "Execuções", icone: ICONES.relogio, render: execucoes, subtitulo: "Quem fez, quando, e o que a IA encontrou" },
];

let moduloAtual = "agentes-ia";

/**
 * Módulos do hub: cada solução do Brasa é uma porta.
 *
 * Só "Agentes de IA" existe hoje; os demais aparecem como "Em breve" para o
 * cliente enxergar o tamanho do produto. Quando um módulo novo nascer, vira
 * `ativo: true` com a função `entrar` dele.
 */
const MODULOS = [
  {
    id: "agentes-ia",
    nome: "Agentes de IA",
    descricao:
      "Atendimento no WhatsApp e Instagram: reservas, programação e dúvidas respondidas na hora.",
    icone:
      "M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z",
    ativo: true,
    // Posição na colmeia, em passos de favo a partir do centro (x em larguras,
    // y em alturas de hexágono).
    pos: { x: 0, y: -1 },
  },
  {
    id: "cardapio-digital",
    nome: "Cardápio Digital",
    descricao: "QR code na mesa, cardápio sempre atualizado e pedidos sem fila no balcão.",
    icone: "M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z",
    ativo: false,
    pos: { x: -0.75, y: 0.5 },
  },
  {
    id: "checklist",
    nome: "Checklist Inteligente",
    descricao:
      "Rotinas de abertura e fechamento com link no WhatsApp, fotos como prova e a IA conferindo cada resposta.",
    icone: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
    ativo: true,
    pos: { x: 0.75, y: 0.5 },
  },
];

/** Favos vazios: a colmeia mostra para onde ela ainda cresce. */
const FAVOS_VAZIOS = [
  { x: -0.75, y: -0.5 },
  { x: 0.75, y: -0.5 },
  { x: 0, y: 1 },
];

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
  limpar(nav);
  for (const p of PAGINAS.filter((p) => p.modulo === moduloAtual)) {
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
  const doModulo = PAGINAS.filter((p) => p.modulo === moduloAtual);
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

const CHAMA_BRASA =
  "M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z";

const DICA_PADRAO = "Toque num favo aceso para entrar.";

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
  for (const m of MODULOS) ligar(m.pos, m.ativo ? "linha linha-viva" : "linha");
  for (const f of FAVOS_VAZIOS) ligar(f, "linha linha-apagada");
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
      [icone(CHAMA_BRASA, 34), el("span", { classe: "hex-wordmark", texto: "Brasa" })],
    ),
  );

  MODULOS.forEach((m, i) => {
    const dica = m.ativo ? m.descricao : `${m.descricao} — em breve.`;
    colmeia.append(
      el(
        "button",
        {
          classe: `celula hex-modulo${m.ativo ? "" : " hex-apagado"}`,
          type: "button",
          style: posicao(m.pos, i + 1),
          // aria-disabled (e não disabled) para o favo "em breve" continuar
          // contando o que é ao passar o mouse ou focar.
          "aria-disabled": String(!m.ativo),
          "aria-label": `${m.nome}${m.ativo ? "" : " — em breve"}`,
          onclick: () => (m.ativo ? entrarNoModulo(m.id) : avisar(`${m.nome} chega em breve.`, "info")),
          onmouseenter: () => contar(dica),
          onfocus: () => contar(dica),
        },
        [
          el("span", { classe: "hex-icone" }, [icone(m.icone, 22)]),
          el("span", { classe: "hex-nome", texto: m.nome }),
          el("span", {
            classe: `hex-etiqueta${m.ativo ? " hex-etiqueta-ativa" : ""}`,
            texto: m.ativo ? "Entrar" : "Em breve",
          }),
        ],
      ),
    );
  });

  FAVOS_VAZIOS.forEach((f, i) => {
    colmeia.append(
      el("div", {
        classe: "celula hex-vazio",
        style: posicao(f, MODULOS.length + 1 + i),
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

document.getElementById("form-acesso").addEventListener("submit", async (e) => {
  e.preventDefault();
  const chave = document.getElementById("campo-chave").value.trim();
  if (!chave) return;
  salvarChave(chave);
  await iniciar();
});

async function iniciar() {
  if (!chaveSalva()) return pedirChave();

  let venues;
  try {
    venues = await get("/v1/venues");
  } catch (e) {
    esquecerChave();
    return pedirChave(
      e instanceof ErroApi && e.status === 401
        ? "Chave inválida, revogada ou expirada."
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

  seletorVenue.addEventListener("change", () => {
    ctx.venue = seletorVenue.value;
    localStorage.setItem("agentes.venue", ctx.venue);
    document.getElementById("marca-org").textContent = nomeDoVenue();
    document.getElementById("hub-org").textContent = nomeDoVenue();
    irPara(location.hash.slice(1));
  });

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
