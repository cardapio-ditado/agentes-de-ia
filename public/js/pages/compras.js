import { get, post, put } from "../api.js";
import { avisar, dataHora, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Compras: o pedido ANTES da mercadoria.
 *
 * Aqui se monta e envia o pedido ao fornecedor; o recebimento acontece na
 * tela de Receber, quando o caminhão chega. A separação espelha a vida:
 * quem pede (gerente, no escritório, com calma) não é quem recebe
 * (conferente, na doca, com pressa) — e as duas telas são desenhadas para
 * pessoas diferentes em momentos diferentes.
 */

const SITUACAO = {
  rascunho: ["montando", ""],
  pedido: ["aguardando entrega", "etiqueta-alerta"],
  recebida: ["recebida", "etiqueta-ok"],
  cancelada: ["cancelada", ""],
};

export async function compras(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let lista, locais, insumos;
    try {
      [lista, locais, insumos] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/compras`),
        get(`/v1/venues/${ctx.venue}/estoque-locais`),
        get(`/v1/venues/${ctx.venue}/insumos`),
      ]);
    } catch (e) {
      limpar(conteudo).append(vazio("Compras indisponíveis", e.message));
      return;
    }
    limpar(conteudo);

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Compras" }),
            el("p", { classe: "muted", texto: "Monte o pedido aqui; a entrada acontece em Receber, quando chegar." }),
          ]),
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "+ Novo pedido",
            onclick: () => formularioPedido(),
          }),
        ]),
        el("div", { classe: "lista" },
          lista.length === 0
            ? [vazio("Nenhuma compra ainda", "O primeiro pedido leva um minuto.")]
            : lista.map(cartaoCompra),
        ),
      ]),
    );

    function cartaoCompra(c) {
      const [rotulo, variante] = SITUACAO[c.status] ?? [c.status, ""];
      return el("article", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("strong", { texto: c.fornecedor || "Sem fornecedor" }),
            el("p", {
              classe: "muted",
              texto: `${c.estoque_locais?.nome ?? ""} · ${dataHora(c.created_at)}${
                c.status === "recebida" ? ` · ${dinheiro(Number(c.valor_total))}` : ""
              }`,
            }),
          ]),
          etiqueta(rotulo, variante),
        ]),
      ]);
    }

    function formularioPedido() {
      limpar(conteudo);
      const linhas = [];

      const fornecedor = el("input", { classe: "campo", placeholder: "Fornecedor" });
      const seletorLocal = el(
        "select",
        { classe: "select" },
        locais.map((l) => el("option", { value: l.id, texto: l.nome, selected: l.principal })),
      );
      const listaItens = el("div", { classe: "lista" });
      const total = el("strong", {});

      const recalcular = () => {
        total.textContent = dinheiro(
          linhas.reduce((t, l) => t + (Number(l.qtd) || 0) * (Number(l.custo) || 0), 0),
        );
      };

      const desenharItens = () => {
        limpar(listaItens);
        linhas.forEach((linha, i) => {
          const insumo = insumos.find((x) => x.id === linha.insumoId);
          listaItens.append(
            el("article", { classe: "cartao" }, [
              el("div", { classe: "cabecalho-secao" }, [
                el("strong", { texto: insumo?.nome ?? "?" }),
                el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: "Remover",
                  onclick: () => {
                    linhas.splice(i, 1);
                    desenharItens();
                  },
                }),
              ]),
              el("div", { classe: "linha-campos" }, [
                el("label", {}, [
                  el("span", { texto: `Quantidade (${insumo?.unidade ?? "un"})` }),
                  el("input", {
                    classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.001",
                    value: linha.qtd ?? "",
                    onchange: (ev) => { linha.qtd = Number(ev.target.value); recalcular(); },
                  }),
                ]),
                el("label", {}, [
                  el("span", { texto: "R$ estimado/un" }),
                  el("input", {
                    classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.01",
                    // O custo médio da última compra já vem sugerido: quem
                    // pede raramente sabe o preço de cor, e o histórico é o
                    // melhor palpite disponível.
                    value: linha.custo ?? "",
                    onchange: (ev) => { linha.custo = Number(ev.target.value); recalcular(); },
                  }),
                ]),
              ]),
            ]),
          );
        });
        recalcular();
      };

      const seletorInsumo = el(
        "select",
        { classe: "select" },
        [
          el("option", { value: "", texto: "— adicionar insumo —" }),
          ...insumos.map((i) => el("option", { value: i.id, texto: `${i.nome} (${i.unidade})` })),
        ],
      );
      seletorInsumo.addEventListener("change", () => {
        if (!seletorInsumo.value) return;
        const insumo = insumos.find((x) => x.id === seletorInsumo.value);
        linhas.push({ insumoId: insumo.id, qtd: null, custo: insumo.custoMedio || null });
        seletorInsumo.value = "";
        desenharItens();
      });

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("h2", { texto: "Novo pedido" }),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Cancelar", onclick: desenhar }),
          ]),
          el("div", { classe: "cartao pilha" }, [
            el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Fornecedor" }), fornecedor]),
            el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Destino padrão" }), seletorLocal]),
            seletorInsumo,
          ]),
          listaItens,
          el("div", { classe: "cartao cartao-total" }, [
            el("div", { classe: "cabecalho-secao" }, [el("span", { texto: "Total estimado" }), total]),
            el("button", {
              classe: "btn btn-primario btn-grande",
              type: "button",
              texto: "Enviar pedido",
              onclick: async (ev) => {
                const validas = linhas.filter((l) => l.insumoId && l.qtd > 0);
                if (validas.length === 0) return avisar("Adicione ao menos um item com quantidade.", "erro");
                ev.target.disabled = true;
                try {
                  const r = await post(`/v1/venues/${ctx.venue}/compras`, {
                    local_id: seletorLocal.value,
                    origem: "pedido",
                    fornecedor: fornecedor.value || null,
                    itens: validas.map((l) => ({
                      insumo_id: l.insumoId,
                      quantidade_pedida: l.qtd,
                      custo_unitario_pedido: l.custo ?? null,
                    })),
                  });
                  await post(`/v1/venues/${ctx.venue}/compras/${r.id}/enviar`, {});
                  avisar("Pedido enviado. Quando chegar, confira em Receber.", "ok");
                  desenhar();
                } catch (e) {
                  avisar(e.message, "erro");
                  ev.target.disabled = false;
                }
              },
            }),
          ]),
        ]),
      );
      desenharItens();
    }
  }
}
