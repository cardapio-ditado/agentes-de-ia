import { del, get, post } from "../api.js";
import { avisar, dataHora, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

const TIPOS = [
  ["musica", "Música"],
  ["jogo", "Jogo"],
  ["promocao", "Promoção"],
  ["evento", "Evento"],
  ["outro", "Outro"],
];

/** Programação e base de conhecimento: é daqui que o agente tira o que contar. */
export async function programacao(raiz, ctx) {
  const lista = el("div", { classe: "lista" });
  const infos = el("div", { classe: "lista" });

  const campos = {
    titulo: el("input", { required: true, placeholder: "Samba de Raiz — Grupo X" }),
    tipo: el("select", {}, TIPOS.map(([v, r]) => el("option", { value: v, texto: r }))),
    data: el("input", { type: "datetime-local", required: true }),
    couvert: el("input", { type: "number", min: "0", step: "0.01", placeholder: "0" }),
    descricao: el("input", { placeholder: "Roda de samba na área externa" }),
  };

  const form = el("form", { classe: "cartao", onsubmit: criar }, [
    el("h3", { texto: "Novo item na programação" }),
    el("div", { classe: "grade", style: "margin-top:12px" }, [
      campo("Título", campos.titulo),
      campo("Tipo", campos.tipo),
      campo("Data e hora", campos.data),
      campo("Couvert (R$)", campos.couvert),
      el("div", { classe: "campo campo-largo" }, [
        el("label", { texto: "Descrição" }),
        campos.descricao,
      ]),
    ]),
    el("button", { classe: "btn btn-primario", type: "submit", texto: "Adicionar", style: "margin-top:12px" }),
  ]);

  raiz.append(
    el("div", { classe: "pilha" }, [
      form,
      el("section", {}, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Agenda" }),
            el("p", { classe: "muted", texto: "O agente cita estes itens quando o cliente pergunta." }),
          ]),
        ]),
        lista,
      ]),
      el("section", {}, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Informações da casa" }),
            el("p", { classe: "muted", texto: "Estacionamento, wi-fi, pagamento, política de pets." }),
          ]),
        ]),
        infos,
      ]),
    ]),
  );

  await Promise.all([carregarEventos(), carregarInfos()]);

  async function carregarEventos() {
    limpar(lista).append(el("p", { classe: "muted", texto: "Carregando…" }));
    const eventos = await get(`/v1/venues/${ctx.venue}/events`);
    limpar(lista);

    if (eventos.length === 0) {
      lista.append(vazio("Nada cadastrado", "Sem programação, o agente não tem o que contar da casa."));
      return;
    }

    for (const ev of eventos) {
      const futuro = new Date(ev.starts_at) > new Date();
      lista.append(
        el("article", { classe: "cartao" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", { style: "min-width:0" }, [
              el("h3", { texto: ev.title }),
              el("p", { classe: "muted", texto: ev.description ?? "" }),
            ]),
            etiqueta(rotuloTipo(ev.kind), futuro ? "etiqueta-ok" : ""),
          ]),
          el("div", { classe: "linha-dado" }, [
            el("span", { texto: "Quando" }),
            el("strong", { texto: dataHora(ev.starts_at) }),
          ]),
          el("div", { classe: "linha-dado" }, [
            el("span", { texto: "Couvert" }),
            el("strong", { texto: dinheiro(ev.cover_charge) }),
          ]),
          el("div", { classe: "reserva-acoes" }, [
            el("button", {
              classe: "btn btn-perigo btn-peq",
              type: "button",
              texto: "Remover",
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  await del(`/v1/events/${ev.id}?venue=${encodeURIComponent(ctx.venue)}`);
                  avisar("Item removido.", "ok");
                  await carregarEventos();
                } catch (err) {
                  avisar(err.message, "erro");
                  e.target.disabled = false;
                }
              },
            }),
          ]),
        ]),
      );
    }
  }

  async function carregarInfos() {
    limpar(infos);
    const dados = await get(`/v1/venues/${ctx.venue}/info`);
    if (dados.length === 0) {
      infos.append(vazio("Nenhuma informação cadastrada"));
      return;
    }
    for (const i of dados) {
      infos.append(
        el("article", { classe: "cartao" }, [
          el("h3", { texto: i.topic }),
          el("p", { classe: "muted", texto: i.content }),
        ]),
      );
    }
  }

  async function criar(e) {
    e.preventDefault();
    const botao = form.querySelector("button[type=submit]");
    botao.disabled = true;
    try {
      await post(`/v1/venues/${ctx.venue}/events`, {
        title: campos.titulo.value.trim(),
        kind: campos.tipo.value,
        // datetime-local não tem fuso; o navegador interpreta como hora local,
        // que é justamente a hora da casa.
        starts_at: new Date(campos.data.value).toISOString(),
        description: campos.descricao.value.trim() || undefined,
        cover_charge: campos.couvert.value ? Number(campos.couvert.value) : undefined,
      });
      avisar("Adicionado à programação.", "ok");
      form.reset();
      await carregarEventos();
    } catch (err) {
      avisar(err.message, "erro");
    } finally {
      botao.disabled = false;
    }
  }

  function campo(rotulo, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
  }

  function rotuloTipo(k) {
    return TIPOS.find(([v]) => v === k)?.[1] ?? k;
  }
}
