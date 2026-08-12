// Painel de operação. Sem build step: JS puro, módulo nativo.
// A chave de API fica no localStorage deste navegador e viaja em cada
// requisição no header Authorization.

const CHAVE_STORAGE = "agentes.api_key";

const estado = {
  chave: localStorage.getItem(CHAVE_STORAGE) ?? "",
  venue: null,
  agente: null,
};

const $ = (sel) => document.querySelector(sel);

// ============================================================
// Cliente da API
// ============================================================
async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`/v1${caminho}`, {
    ...opcoes,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${estado.chave}`,
      ...(opcoes.headers ?? {}),
    },
  });

  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok || !corpo?.success) {
    throw new Error(corpo?.error?.message ?? `Falha na requisição (${resposta.status}).`);
  }
  return corpo.data;
}

function avisar(mensagem, tipo = "info") {
  const el = document.createElement("div");
  el.className = `aviso aviso-${tipo}`;
  el.textContent = mensagem;
  $("#avisos").append(el);
  setTimeout(() => el.remove(), 4000);
}

// ============================================================
// Acesso
// ============================================================
$("#form-acesso").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  estado.chave = $("#campo-chave").value.trim();
  const erro = $("#erro-acesso");
  erro.hidden = true;

  try {
    await iniciar();
    localStorage.setItem(CHAVE_STORAGE, estado.chave);
  } catch (e) {
    erro.textContent = e.message;
    erro.hidden = false;
  }
});

$("#btn-sair").addEventListener("click", () => {
  localStorage.removeItem(CHAVE_STORAGE);
  location.reload();
});

async function iniciar() {
  const [venues, agentes] = await Promise.all([api("/venues"), api("/agents")]);

  if (venues.length === 0) {
    throw new Error("Nenhum estabelecimento cadastrado nesta organização. Rode `npm run seed`.");
  }

  const seletorVenue = $("#seletor-venue");
  seletorVenue.innerHTML = venues
    .map((v) => `<option value="${v.slug}">${escapar(v.name)}</option>`)
    .join("");
  estado.venue = venues[0].slug;

  const seletorAgente = $("#seletor-agente");
  seletorAgente.innerHTML = agentes
    .map((a) => `<option value="${a.slug}">${escapar(a.name)}</option>`)
    .join("");
  estado.agente = agentes[0]?.slug ?? null;

  $("#tela-acesso").hidden = true;
  $("#painel").hidden = false;

  await Promise.all([carregarReservas(), carregarEventos()]);
}

$("#seletor-venue").addEventListener("change", async (evento) => {
  estado.venue = evento.target.value;
  await Promise.all([carregarReservas(), carregarEventos()]);
});

$("#seletor-agente").addEventListener("change", (evento) => {
  estado.agente = evento.target.value;
});

// ============================================================
// Abas
// ============================================================
for (const aba of document.querySelectorAll(".aba")) {
  aba.addEventListener("click", () => {
    for (const outra of document.querySelectorAll(".aba")) {
      outra.setAttribute("aria-selected", String(outra === aba));
    }
    for (const painel of document.querySelectorAll(".painel-aba")) {
      painel.hidden = painel.id !== `painel-${aba.dataset.aba}`;
    }
  });
}

// ============================================================
// Reservas
// ============================================================
$("#btn-recarregar").addEventListener("click", () => void carregarReservas());

async function carregarReservas() {
  const lista = $("#lista-reservas");
  try {
    const reservas = await api(`/venues/${estado.venue}/reservations`);
    lista.replaceChildren(...reservas.map(cartaoReserva));

    const contador = $("#contador-reservas");
    contador.textContent = String(reservas.length);
    contador.hidden = reservas.length === 0;
  } catch (e) {
    avisar(e.message, "erro");
  }
}

function cartaoReserva(reserva) {
  const cartao = document.createElement("article");
  cartao.className = "cartao";

  const quando = new Date(reserva.reserved_for).toLocaleString("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
  });

  const opcionais = [
    reserva.area_preference && ["Área", reserva.area_preference],
    reserva.occasion && ["Ocasião", reserva.occasion],
    reserva.notes && ["Observação", reserva.notes],
  ].filter(Boolean);

  cartao.innerHTML = `
    <div class="reserva-topo">
      <div>
        <div class="reserva-quando">${escapar(quando)}</div>
        <strong>${escapar(reserva.customer_name)}</strong> ·
        ${reserva.party_size} pessoa(s)
      </div>
      <span class="etiqueta">${escapar(reserva.source_channel)}</span>
    </div>
    <div class="reserva-dados">
      <span>Telefone: ${escapar(reserva.customer_phone)}</span>
      ${reserva.customer_email ? `<span>E-mail: ${escapar(reserva.customer_email)}</span>` : ""}
      ${opcionais.map(([k, v]) => `<span>${k}: ${escapar(v)}</span>`).join("")}
    </div>
    <div class="reserva-acoes">
      <button class="btn btn-sucesso" data-acao="approve">Aprovar</button>
      <button class="btn btn-perigo" data-acao="reject">Recusar</button>
      <span class="protocolo">${escapar(reserva.id)}</span>
    </div>
  `;

  for (const botao of cartao.querySelectorAll("[data-acao]")) {
    botao.addEventListener("click", () => void decidir(reserva, botao));
  }
  return cartao;
}

async function decidir(reserva, botao) {
  const acao = botao.dataset.acao;
  let motivo;

  if (acao === "reject") {
    // A recusa exige justificativa — o cliente precisa saber por quê.
    motivo = prompt("Motivo da recusa (será informado ao cliente):");
    if (motivo === null) return;
    if (motivo.trim() === "") {
      avisar("A recusa precisa de um motivo.", "erro");
      return;
    }
  }

  const botoes = botao.parentElement.querySelectorAll("button");
  for (const b of botoes) b.disabled = true;

  try {
    await api(`/reservations/${reserva.id}/${acao}`, {
      method: "POST",
      body: JSON.stringify({ motivo }),
    });
    avisar(acao === "approve" ? "Reserva aprovada." : "Reserva recusada.", "sucesso");
    await carregarReservas();
  } catch (e) {
    avisar(e.message, "erro");
    for (const b of botoes) b.disabled = false;
  }
}

// ============================================================
// Programação
// ============================================================
async function carregarEventos() {
  const lista = $("#lista-eventos");
  try {
    const eventos = await api(`/venues/${estado.venue}/events`);
    lista.replaceChildren(...eventos.map(cartaoEvento));
  } catch (e) {
    avisar(e.message, "erro");
  }
}

function cartaoEvento(evento) {
  const cartao = document.createElement("article");
  cartao.className = "cartao";

  const quando = new Date(evento.starts_at).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const passado = new Date(evento.starts_at) < new Date();

  cartao.innerHTML = `
    <div class="reserva-topo">
      <div>
        <div class="reserva-quando">${escapar(quando)}${passado ? " · já passou" : ""}</div>
        <strong>${escapar(evento.title)}</strong>
        ${evento.description ? `<div class="muted">${escapar(evento.description)}</div>` : ""}
      </div>
      <span class="etiqueta">${escapar(evento.kind)}</span>
    </div>
    <div class="reserva-dados">
      <span>${
        evento.cover_charge > 0
          ? `Couvert: R$ ${Number(evento.cover_charge).toFixed(2)}`
          : "Entrada franca"
      }</span>
    </div>
    <div class="reserva-acoes">
      <button class="btn btn-perigo" data-remover>Remover</button>
    </div>
  `;

  cartao.querySelector("[data-remover]").addEventListener("click", async (e) => {
    if (!confirm(`Remover "${evento.title}"?`)) return;
    e.target.disabled = true;
    try {
      await api(`/events/${evento.id}?venue=${encodeURIComponent(estado.venue)}`, {
        method: "DELETE",
      });
      avisar("Item removido.", "sucesso");
      await carregarEventos();
    } catch (erro) {
      avisar(erro.message, "erro");
      e.target.disabled = false;
    }
  });

  return cartao;
}

$("#form-evento").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const botao = evento.target.querySelector("button[type=submit]");
  botao.disabled = true;

  const couvert = $("#ev-couvert").value;
  try {
    await api(`/venues/${estado.venue}/events`, {
      method: "POST",
      body: JSON.stringify({
        title: $("#ev-titulo").value,
        kind: $("#ev-tipo").value,
        // datetime-local não traz fuso; new Date() interpreta no fuso do
        // navegador, que é o de quem opera a casa.
        starts_at: new Date($("#ev-data").value).toISOString(),
        description: $("#ev-descricao").value,
        cover_charge: couvert === "" ? 0 : Number(couvert),
      }),
    });
    evento.target.reset();
    avisar("Item adicionado à programação.", "sucesso");
    await carregarEventos();
  } catch (e) {
    avisar(e.message, "erro");
  } finally {
    botao.disabled = false;
  }
});

// ============================================================
// Chat com streaming (SSE sobre fetch — EventSource não faz POST)
// ============================================================
const sessaoChat = `painel-${Date.now()}`;

$("#form-chat").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const campo = $("#campo-mensagem");
  const mensagem = campo.value.trim();
  if (!mensagem || !estado.agente) return;

  campo.value = "";
  adicionarBalao("usuario", mensagem);
  const balaoAgente = adicionarBalao("agente", "");

  try {
    const resposta = await fetch("/v1/runs?stream=true", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${estado.chave}`,
      },
      body: JSON.stringify({
        agent: estado.agente,
        venue: estado.venue,
        input: mensagem,
        channel: "painel",
        external_id: sessaoChat,
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => null);
      throw new Error(corpo?.error?.message ?? `Falha (${resposta.status}).`);
    }

    await consumirSse(resposta, balaoAgente);
    await carregarReservas();
  } catch (e) {
    balaoAgente.textContent = `Erro: ${e.message}`;
    balaoAgente.style.color = "var(--erro)";
  }
});

async function consumirSse(resposta, balao) {
  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += decodificador.decode(value, { stream: true });

    // Frames SSE são separados por linha em branco; o último pedaço
    // pode estar incompleto e volta para o buffer.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const linhaDados = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!linhaDados) continue;

      let evento;
      try {
        evento = JSON.parse(linhaDados.slice(6));
      } catch {
        continue;
      }
      aplicarEvento(evento, balao);
    }
  }
}

function aplicarEvento(evento, balao) {
  if (evento.type === "text_delta") {
    balao.textContent += evento.text;
  } else if (evento.type === "tool_use") {
    adicionarBalao("ferramenta", `→ ${evento.name}`);
  } else if (evento.type === "tool_result" && evento.isError) {
    adicionarBalao("ferramenta", `✗ ${evento.name} falhou`);
  } else if (evento.type === "error") {
    balao.textContent += `\n[erro] ${evento.message}`;
    balao.style.color = "var(--erro)";
  }
  rolarChat();
}

function adicionarBalao(tipo, texto) {
  const balao = document.createElement("div");
  balao.className = `balao balao-${tipo}`;
  balao.textContent = texto;
  $("#chat").append(balao);
  rolarChat();
  return balao;
}

function rolarChat() {
  const chat = $("#chat");
  chat.scrollTop = chat.scrollHeight;
}

// ============================================================
// Utilidades
// ============================================================
function escapar(valor) {
  const div = document.createElement("div");
  div.textContent = String(valor ?? "");
  return div.innerHTML;
}

// Sessão anterior guardada: tenta entrar direto.
if (estado.chave) {
  iniciar().catch(() => {
    localStorage.removeItem(CHAVE_STORAGE);
    estado.chave = "";
  });
}
