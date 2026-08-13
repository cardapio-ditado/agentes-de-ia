import { ErroApi, chaveSalva, esquecerChave, get, salvarChave } from "./api.js";
import { ICONES, avisar, el, icone, limpar } from "./ui.js";
import { painel } from "./pages/painel.js";
import { conversas } from "./pages/conversas.js";
import { reservas } from "./pages/reservas.js";
import { programacao } from "./pages/programacao.js";
import { canais } from "./pages/canais.js";
import { agentes } from "./pages/agentes.js";
import { agente } from "./pages/agente.js";
import { organizacao } from "./pages/organizacao.js";

/**
 * Casca do painel: barra lateral, roteamento por hash e estado compartilhado.
 *
 * Cada tela é uma função `(raiz, ctx)` que desenha dentro de <main>. O roteador
 * limpa o main e chama a tela — sem framework, sem build.
 */

const PAGINAS = [
  { id: "painel", rotulo: "Painel", icone: ICONES.painel, render: painel, subtitulo: "Visão geral do movimento" },
  { id: "conversas", rotulo: "Conversas", icone: ICONES.conversas, render: conversas, subtitulo: "Atendimentos do agente" },
  { id: "reservas", rotulo: "Reservas", icone: ICONES.reservas, render: reservas, subtitulo: "Fila de aprovação" },
  { id: "programacao", rotulo: "Programação", icone: ICONES.programacao, render: programacao, subtitulo: "Shows, jogos e informações da casa" },
  { id: "agentes", rotulo: "Agentes", icone: ICONES.agente, render: agentes, subtitulo: "Monte a personalidade e as regras" },
  { id: "canais", rotulo: "Canais", icone: ICONES.canais, render: canais, subtitulo: "Por onde o agente atende" },
  { id: "agente", rotulo: "Testar agente", icone: ICONES.raio, render: agente, subtitulo: "Converse como se fosse um cliente" },
  { id: "organizacao", rotulo: "Organização", icone: ICONES.organizacao, render: organizacao, subtitulo: "Estabelecimentos, agentes e chaves" },
];

const app = document.getElementById("app");
const telaAcesso = document.getElementById("tela-acesso");
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

document.getElementById("btn-recolher").addEventListener("click", () => {
  app.setAttribute("data-recolhida", "1");
  localStorage.setItem(RECOLHIDA, "1");
});

document.getElementById("btn-menu").addEventListener("click", () => {
  // No celular a lateral vira gaveta; no desktop, o botão a expande de volta.
  if (matchMedia("(max-width: 820px)").matches) app.setAttribute("data-menu", "1");
  else {
    app.removeAttribute("data-recolhida");
    localStorage.setItem(RECOLHIDA, "0");
  }
});

document.getElementById("cortina").addEventListener("click", () => app.removeAttribute("data-menu"));

document.getElementById("btn-sair").addEventListener("click", () => {
  esquecerChave();
  location.reload();
});

// ============ Navegação ============
function montarNav() {
  limpar(nav);
  for (const p of PAGINAS) {
    nav.append(
      el(
        "a",
        { classe: "nav-item", href: `#${p.id}`, "data-pagina": p.id },
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
  const pagina = PAGINAS.find((p) => p.id === id) ?? PAGINAS[0];

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
function pedirChave(mensagem) {
  app.hidden = true;
  telaAcesso.hidden = false;
  const erro = document.getElementById("erro-acesso");
  erro.hidden = !mensagem;
  erro.textContent = mensagem ?? "";
}

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
  app.hidden = false;

  limpar(seletorVenue);
  for (const v of venues) seletorVenue.append(el("option", { value: v.slug, texto: v.name }));

  const salvo = localStorage.getItem("agentes.venue");
  ctx.venue = venues.some((v) => v.slug === salvo) ? salvo : venues[0].slug;
  seletorVenue.value = ctx.venue;
  document.getElementById("marca-org").textContent =
    venues.find((v) => v.slug === ctx.venue)?.name ?? "";

  seletorVenue.addEventListener("change", () => {
    ctx.venue = seletorVenue.value;
    localStorage.setItem("agentes.venue", ctx.venue);
    document.getElementById("marca-org").textContent =
      venues.find((v) => v.slug === ctx.venue)?.name ?? "";
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
  await irPara(location.hash.slice(1));
  await contarPendentes();
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
