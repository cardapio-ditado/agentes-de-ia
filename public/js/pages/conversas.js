import { get, post } from "../api.js";
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
              el("span", { classe: "conversa-nome", texto: nome }),
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

    limpar(painelThread).append(
      el("div", { classe: "thread-topo" }, [
        el("div", { style: "min-width:0;flex:1" }, [
          el("h2", { texto: c.titulo || c.contato || "Conversa" }),
          el("p", { classe: "muted", texto: `${c.canal} · ${c.mensagens.length} mensagens` }),
        ]),
        assumida ? etiqueta("você está respondendo", "etiqueta-alerta") : etiqueta("agente ativo", "etiqueta-ok"),
        btnAssumir,
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
