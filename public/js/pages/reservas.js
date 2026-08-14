import { del, get, patch, post } from "../api.js";
import { avisar, dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Fila de aprovação.
 *
 * O agente coleta os dados e para: nenhuma reserva é confirmada ao cliente sem
 * uma pessoa decidir aqui. Recusar exige motivo — o cliente precisa saber o porquê.
 *
 * Reservas nunca somem sozinhas do banco: a confirmada sai desta tela 6 horas
 * depois do horário, mas a linha continua lá com o status dela. Excluir é a
 * exceção (dado de teste, lançamento errado); cancelar preserva o histórico.
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

  /** Cartão da confirmada: mapa do serviço, mas a vida muda — dá para editar,
   *  cancelar (fica no histórico) ou excluir (some de vez). */
  function cartaoConfirmada(r) {
    const areaEdicao = el("div", {});

    const cartao = el("article", { classe: "cartao" }, [
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
      areaEdicao,
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Editar",
          onclick: () => alternarEdicao(areaEdicao, r),
        }),
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Cancelar reserva",
          onclick: async (e) => {
            if (!confirm(`Cancelar a reserva de ${r.customer_name}? O cliente NÃO é avisado automaticamente — combine com ele pelo WhatsApp.`)) return;
            e.target.disabled = true;
            try {
              await post(`/v1/reservations/${r.id}/cancel`, {});
              avisar("Reserva cancelada. Lembre de avisar o cliente.", "ok");
              await carregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
        botaoExcluir(r),
      ]),
    ]);

    return cartao;
  }

  function cartaoReserva(r) {
    const motivo = el("input", { placeholder: "Motivo (obrigatório para recusar)" });
    const areaEdicao = el("div", {});

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
      areaEdicao,
      el("div", { style: "margin-top:12px" }, [motivo]),
      el("div", { classe: "reserva-acoes" }, [
        btnAprovar,
        btnRecusar,
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Editar",
          onclick: () => alternarEdicao(areaEdicao, r),
        }),
        botaoExcluir(r),
      ]),
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
        // distingue os três casos em vez de dizer só "pronto".
        const n = res.notificacao;
        if (!n) {
          avisar("Decisão registrada. Nenhuma notificação foi disparada.", "ok");
        } else if (n.status === "sent") {
          avisar("Decisão registrada e cliente avisado no WhatsApp.", "ok");
        } else if (n.status === "pending") {
          avisar(
            "Decisão registrada. A mensagem entra na fila e o WhatsApp do bar envia em segundos.",
            "ok",
          );
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

  /** Excluir é para dado de teste ou lançamento errado — apaga de vez, sem
   *  histórico. Cancelamento de verdade usa "Cancelar reserva". */
  function botaoExcluir(r) {
    return el("button", {
      classe: "btn btn-perigo btn-peq",
      type: "button",
      texto: "Excluir",
      onclick: async (e) => {
        if (!confirm(`Excluir DE VEZ a reserva de ${r.customer_name}? Isso apaga também o histórico dela. Para cancelamento normal, use "Cancelar reserva".`)) return;
        e.target.disabled = true;
        try {
          await del(`/v1/reservations/${r.id}`);
          avisar("Reserva excluída.", "ok");
          await carregar();
        } catch (err) {
          avisar(err.message, "erro");
          e.target.disabled = false;
        }
      },
    });
  }

  /** Abre (ou fecha, se já aberto) o formulário de edição dentro do cartão. */
  function alternarEdicao(area, r) {
    if (area.childElementCount > 0) {
      limpar(area);
      return;
    }

    const nome = el("input", { value: r.customer_name });
    const telefone = el("input", { value: r.customer_phone });
    const pessoas = el("input", { type: "number", min: "1", value: String(r.party_size) });
    const quando = el("input", { type: "datetime-local", value: paraDatetimeLocal(r.reserved_for) });
    const areaPref = el("input", { value: r.area_preference ?? "", placeholder: "Área (opcional)" });
    const obs = el("input", { value: r.notes ?? "", placeholder: "Observações (opcional)" });

    area.append(
      el("div", { classe: "pilha", style: "margin-top:12px;gap:8px" }, [
        campo("Nome", nome),
        campo("Telefone", telefone),
        campo("Pessoas", pessoas),
        campo("Data e hora", quando),
        campo("Área", areaPref),
        campo("Observações", obs),
        el("div", { classe: "reserva-acoes" }, [
          el("button", {
            classe: "btn btn-primario btn-peq",
            type: "button",
            texto: "Salvar",
            onclick: async (e) => {
              const quandoData = new Date(quando.value);
              if (Number.isNaN(quandoData.getTime())) {
                avisar("Data e hora inválidas.", "erro");
                return;
              }
              e.target.disabled = true;
              try {
                await patch(`/v1/reservations/${r.id}`, {
                  customer_name: nome.value,
                  customer_phone: telefone.value,
                  party_size: Number(pessoas.value),
                  reserved_for: quandoData.toISOString(),
                  area_preference: areaPref.value,
                  notes: obs.value,
                });
                avisar("Reserva atualizada.", "ok");
                await carregar();
              } catch (err) {
                avisar(err.message, "erro");
                e.target.disabled = false;
              }
            },
          }),
          el("button", {
            classe: "btn btn-peq",
            type: "button",
            texto: "Descartar",
            onclick: () => limpar(area),
          }),
        ]),
      ]),
    );
  }

  function campo(rotulo, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
  }

  /** ISO (UTC) → valor de <input type="datetime-local"> no fuso do navegador. */
  function paraDatetimeLocal(iso) {
    const d = new Date(iso);
    const dois = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
  }

  function linha(rotulo, valor) {
    return el("div", { classe: "linha-dado" }, [
      el("span", { texto: rotulo }),
      el("strong", { texto: String(valor) }),
    ]);
  }
}
