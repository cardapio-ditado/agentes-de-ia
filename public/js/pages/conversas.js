import { del, get, post } from "../api.js";
import { avisar, dataHora, desde, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Caixa de entrada: lista à esquerda, conversa à direita.
 *
 * "Assumir atendimento" silencia o agente naquela conversa — enquanto uma
 * pessoa estiver respondendo, o modelo não entra por cima.
 */
export async function conversas(raiz, ctx) {
  const filtros = { canal: "", status: "", humanas: false };
  let selecionada = null;

  const itens = el("div", { classe: "inbox-itens" });
  const painelThread = el("div", { classe: "thread" });

  const selCanal = el(
    "select",
    { classe: "select", onchange: (e) => ((filtros.canal = e.target.value), carregarLista()) },
    [
      el("option", { value: "", texto: "Todos os canais" }),
      el("option", { value: "whatsapp", texto: "WhatsApp" }),
      el("option", { value: "api", texto: "API / teste" }),
    ],
  );

  const selStatus = el(
    "select",
    { classe: "select", onchange: (e) => ((filtros.status = e.target.value), carregarLista()) },
    [
      el("option", { value: "", texto: "Todos os status" }),
      el("option", { value: "open", texto: "Abertas" }),
      el("option", { value: "closed", texto: "Fechadas" }),
    ],
  );

  const selQuem = el(
    "select",
    {
      classe: "select",
      onchange: (e) => ((filtros.humanas = e.target.value === "1"), carregarLista()),
    },
    [
      el("option", { value: "", texto: "Todas" }),
      el("option", { value: "1", texto: "Assumidas" }),
    ],
  );

  raiz.append(
    el("div", { classe: "inbox" }, [
      el("div", { classe: "inbox-lista" }, [
        el("div", { classe: "inbox-filtros" }, [selCanal, selStatus, selQuem]),
        itens,
      ]),
      painelThread,
    ]),
  );

  vazioThread("Escolha uma conversa", "A lista à esquerda mostra quem falou com o agente.");
  await carregarLista();

  async function carregarLista() {
    limpar(itens).append(el("p", { classe: "muted", style: "padding:14px", texto: "Carregando…" }));

    const busca = new URLSearchParams();
    if (filtros.canal) busca.set("canal", filtros.canal);
    if (filtros.status) busca.set("status", filtros.status);
    if (filtros.humanas) busca.set("humanas", "1");

    const lista = await get(`/v1/venues/${ctx.venue}/conversations?${busca}`);
    limpar(itens);

    if (lista.length === 0) {
      itens.append(
        vazio(
          "Nenhuma conversa",
          "Quando alguém falar com o agente pelo WhatsApp ou pela aba Testar agente, aparece aqui.",
        ),
      );
      return;
    }

    for (const c of lista) {
      const nome = c.titulo || c.contato || "Sem identificação";
      // Nome E telefone quando os dois existem — identifica sem abrir.
      const rotulo = c.titulo && c.contato ? `${c.titulo} · ${c.contato}` : nome;
      const previa = c.ultima_mensagem?.texto ?? "—";

      itens.append(
        el(
          "button",
          {
            classe: "conversa-item",
            type: "button",
            "aria-selected": String(c.id === selecionada),
            onclick: () => abrir(c.id),
          },
          [
            el("div", { classe: "conversa-linha" }, [
              el("span", { classe: "conversa-nome", texto: rotulo }),
              c.atendimento.por === "humano" ? etiqueta("você", "etiqueta-alerta") : null,
              el("span", { classe: "conversa-hora", texto: desde(c.atualizada_em) }),
            ]),
            el("div", { classe: "conversa-previa", texto: previa }),
            el("div", { classe: "conversa-linha" }, [
              etiqueta(c.canal === "whatsapp" ? "WhatsApp" : c.canal),
              c.status !== "open" ? etiqueta("fechada") : null,
            ]),
          ],
        ),
      );
    }
  }

  async function abrir(id) {
    selecionada = id;
    for (const b of itens.querySelectorAll(".conversa-item")) {
      b.setAttribute("aria-selected", "false");
    }
    limpar(painelThread).append(el("p", { classe: "muted", style: "padding:16px", texto: "Abrindo…" }));

    const c = await get(`/v1/conversations/${id}`);
    const assumida = c.atendimento.por === "humano";

    const corpo = el(
      "div",
      { classe: "thread-corpo" },
      c.mensagens
        .filter((m) => m.papel === "user" || m.papel === "assistant")
        .map((m) => {
          const humana = m.origem === "humano";
          const classe = m.papel === "user" ? "balao-user" : humana ? "balao-humano" : "balao-assistant";
          return el("div", { classe: `balao ${classe}`, title: dataHora(m.em) }, [
            el("span", {
              classe: "balao-meta",
              texto: m.papel === "user" ? "Cliente" : humana ? "Você" : "Agente",
            }),
            el("span", { texto: m.texto ?? "" }),
          ]);
        }),
    );

    const campo = el("textarea", {
      placeholder: assumida
        ? "Escreva sua resposta…"
        : "Assuma o atendimento para responder manualmente.",
      disabled: !assumida,
    });

    const btnEnviar = el("button", {
      classe: "btn btn-primario",
      type: "button",
      texto: "Enviar",
      disabled: !assumida,
      onclick: enviar,
    });

    const btnAssumir = el("button", {
      classe: assumida ? "btn btn-peq" : "btn btn-primario btn-peq",
      type: "button",
      texto: assumida ? "Devolver ao agente" : "Assumir atendimento",
      onclick: alternar,
    });

    const encerrada = c.status === "closed";
    const btnEncerrar = el("button", {
      classe: encerrada ? "btn btn-peq" : "btn btn-perigo btn-peq",
      type: "button",
      texto: encerrada ? "Reabrir" : "Encerrar",
      title: encerrada
        ? "Volta a aparecer entre as abertas."
        : "Marca como resolvida. Se o cliente escrever de novo, reabre sozinha.",
      onclick: encerrar,
    });

    const btnApagar = el("button", {
      classe: "btn btn-perigo btn-peq",
      type: "button",
      texto: "Apagar",
      title: "Apaga a conversa e o histórico para sempre. Reservas já feitas não são afetadas.",
      onclick: apagar,
    });

    limpar(painelThread).append(
      el("div", { classe: "thread-topo" }, [
        el("div", { style: "min-width:0;flex:1" }, [
          el("h2", { texto: c.titulo || c.contato || "Conversa" }),
          el("p", {
            classe: "muted",
            // Nome no título, telefone aqui — os dois visíveis quando existem.
            texto: [c.titulo && c.contato ? c.contato : null, c.canal, `${c.mensagens.length} mensagens`]
              .filter(Boolean)
              .join(" · "),
          }),
        ]),
        encerrada
          ? etiqueta("encerrada")
          : assumida
            ? etiqueta("você está respondendo", "etiqueta-alerta")
            : etiqueta("agente ativo", "etiqueta-ok"),
        btnAssumir,
        btnEncerrar,
        btnApagar,
      ]),
      corpo,
      el("div", { classe: "thread-rodape" }, [
        el("div", { classe: "linha-envio" }, [campo, btnEnviar]),
        !assumida
          ? el("p", {
              classe: "muted",
              texto:
                "Enquanto o agente responde, uma mensagem sua sairia junto com a dele e o cliente veria duas vozes.",
            })
          : null,
      ]),
    );

    corpo.scrollTop = corpo.scrollHeight;

    async function apagar() {
      const nome = c.titulo || c.contato || "esta conversa";
      // confirm nativo basta: apagar histórico é raro e irreversível — o
      // atrito extra aqui é proteção, não burocracia.
      if (!window.confirm(`Apagar ${nome} para sempre? O histórico não volta. Reservas já registradas continuam existindo.`)) {
        return;
      }
      btnApagar.disabled = true;
      try {
        await del(`/v1/conversations/${id}`);
        avisar("Conversa apagada. Se o cliente escrever de novo, começa do zero.", "ok");
        selecionada = null;
        vazioThread("Escolha uma conversa", "A lista à esquerda mostra quem falou com o agente.");
        await carregarLista();
      } catch (e) {
        avisar(e.message, "erro");
        btnApagar.disabled = false;
      }
    }

    async function encerrar() {
      btnEncerrar.disabled = true;
      try {
        await post(`/v1/conversations/${id}/close`, { reabrir: encerrada });
        avisar(
          encerrada ? "Conversa reaberta." : "Conversa encerrada e devolvida ao agente.",
          "ok",
        );
        await carregarLista();
        await abrir(id);
      } catch (e) {
        avisar(e.message, "erro");
        btnEncerrar.disabled = false;
      }
    }

    async function alternar() {
      btnAssumir.disabled = true;
      try {
        await post(`/v1/conversations/${id}/takeover`, { devolver: assumida });
        avisar(assumida ? "Agente reassumiu a conversa." : "Atendimento assumido.", "ok");
        await carregarLista();
        await abrir(id);
      } catch (e) {
        avisar(e.message, "erro");
        btnAssumir.disabled = false;
      }
    }

    async function enviar() {
      const texto = campo.value.trim();
      if (!texto) return;
      btnEnviar.disabled = true;
      try {
        await post(`/v1/conversations/${id}/messages`, { texto });
        campo.value = "";
        await abrir(id);
        await carregarLista();
      } catch (e) {
        avisar(e.message, "erro");
      } finally {
        btnEnviar.disabled = false;
      }
    }
  }

  function vazioThread(titulo, detalhe) {
    limpar(painelThread).append(el("div", { style: "margin:auto" }, [vazio(titulo, detalhe)]));
  }
}
