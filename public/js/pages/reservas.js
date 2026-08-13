import { get, post } from "../api.js";
import { avisar, dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Fila de aprovação.
 *
 * O agente coleta os dados e para: nenhuma reserva é confirmada ao cliente sem
 * uma pessoa decidir aqui. Recusar exige motivo — o cliente precisa saber o porquê.
 */
export async function reservas(raiz, ctx) {
  const lista = el("div", { classe: "lista" });
  const listaConfirmadas = el("div", { classe: "lista" });

  raiz.append(
    el("section", { classe: "pilha" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Fila de aprovação" }),
          el("p", { classe: "muted", texto: "Reservas coletadas pelo agente, aguardando decisão." }),
        ]),
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Recarregar",
          onclick: carregar,
        }),
      ]),
      lista,

      el("div", { classe: "cabecalho-secao", style: "margin-top:10px" }, [
        el("div", {}, [
          el("h2", { texto: "Confirmadas — próximas" }),
          el("p", {
            classe: "muted",
            texto: "O que a casa tem para receber: reservas aprovadas que ainda vão acontecer.",
          }),
        ]),
      ]),
      listaConfirmadas,
    ]),
  );

  await carregar();

  async function carregar() {
    limpar(lista).append(el("p", { classe: "muted", texto: "Carregando…" }));
    limpar(listaConfirmadas);

    const [pendentes, confirmadas] = await Promise.all([
      get(`/v1/venues/${ctx.venue}/reservations`),
      get(`/v1/venues/${ctx.venue}/reservations?status=approved`),
    ]);

    limpar(lista);
    if (pendentes.length === 0) {
      lista.append(vazio("Nenhuma reserva na fila", "Tudo decidido por aqui."));
      ctx.atualizarContador("reservas", 0);
    } else {
      ctx.atualizarContador("reservas", pendentes.length);
      for (const r of pendentes) lista.append(cartaoReserva(r));
    }

    if (confirmadas.length === 0) {
      listaConfirmadas.append(vazio("Nenhuma reserva confirmada por vir"));
    } else {
      for (const r of confirmadas) listaConfirmadas.append(cartaoConfirmada(r));
    }
  }

  /** Cartão de leitura: a decisão já foi tomada, aqui é o mapa do serviço. */
  function cartaoConfirmada(r) {
    return el("article", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: r.customer_name }),
          el("p", { classe: "muted", texto: r.customer_phone }),
        ]),
        el("div", { style: "display:flex;gap:6px" }, [
          etiqueta(`${r.party_size} pessoas`, "etiqueta-info"),
          etiqueta("confirmada", "etiqueta-ok"),
        ]),
      ]),
      linha("Para", dataHora(r.reserved_for)),
      r.area_preference ? linha("Área", r.area_preference) : null,
      r.occasion ? linha("Ocasião", r.occasion) : null,
      r.notes ? linha("Observações", r.notes) : null,
    ]);
  }

  function cartaoReserva(r) {
    const motivo = el("input", { placeholder: "Motivo (obrigatório para recusar)" });

    const btnAprovar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Aprovar",
      onclick: () => decidir("approve"),
    });
    const btnRecusar = el("button", {
      classe: "btn btn-perigo btn-peq",
      type: "button",
      texto: "Recusar",
      onclick: () => decidir("reject"),
    });

    const cartao = el("article", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: r.customer_name }),
          el("p", { classe: "muted", texto: r.customer_phone }),
        ]),
        etiqueta(`${r.party_size} pessoas`, "etiqueta-info"),
      ]),
      linha("Para", dataHora(r.reserved_for)),
      r.area_preference ? linha("Área", r.area_preference) : null,
      r.occasion ? linha("Ocasião", r.occasion) : null,
      r.notes ? linha("Observações", r.notes) : null,
      linha("Pedida em", dataHora(r.created_at)),
      el("div", { style: "margin-top:12px" }, [motivo]),
      el("div", { classe: "reserva-acoes" }, [btnAprovar, btnRecusar]),
    ]);

    async function decidir(acao) {
      if (acao === "reject" && !motivo.value.trim()) {
        avisar("Recusar exige um motivo — o cliente precisa saber por quê.", "erro");
        motivo.focus();
        return;
      }
      btnAprovar.disabled = true;
      btnRecusar.disabled = true;

      try {
        const res = await post(`/v1/reservations/${r.id}/${acao}`, {
          motivo: motivo.value.trim() || undefined,
        });

        // A decisão fica gravada mesmo se a mensagem não sair; por isso o aviso
        // distingue os dois casos em vez de dizer só "pronto".
        const n = res.notificacao;
        if (!n) {
          avisar("Decisão registrada. Nenhuma notificação foi disparada.", "ok");
        } else if (n.status === "sent") {
          avisar(`Decisão registrada e cliente avisado por ${n.canal}.`, "ok");
        } else {
          avisar(`Decisão registrada, mas o aviso ao cliente falhou: ${n.erro ?? n.status}.`, "erro");
        }
        await carregar();
      } catch (e) {
        avisar(e.message, "erro");
        btnAprovar.disabled = false;
        btnRecusar.disabled = false;
      }
    }

    return cartao;
  }

  function linha(rotulo, valor) {
    return el("div", { classe: "linha-dado" }, [
      el("span", { texto: rotulo }),
      el("strong", { texto: String(valor) }),
    ]);
  }
}
