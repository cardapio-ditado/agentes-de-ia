import { del, get, post } from "../api.js";
import { avisar, buscador, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Fichas técnicas: o que cada prato consome.
 *
 * É a ponte entre a venda e o estoque, e o número que ela produz — custo por
 * porção — é o que o dono usa para precificar. Por isso a regra dura da
 * tela: ficha NÃO CONFERIDA não mostra custo. Mostrar um custo pela metade
 * (ingredientes faltando) é pior que não mostrar, porque o número parece
 * pronto e o preço do cardápio é decidido em cima dele.
 */

export async function fichas(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let lista, insumos;
    try {
      [lista, insumos] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/fichas`),
        get(`/v1/venues/${ctx.venue}/insumos`),
      ]);
    } catch (e) {
      limpar(conteudo).append(vazio("Fichas indisponíveis", e.message));
      return;
    }
    limpar(conteudo);

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Fichas técnicas" }),
            el("p", { classe: "muted", texto: "O que cada prato consome — e quanto custa cada porção." }),
          ]),
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "+ Nova ficha",
            onclick: () => formulario(null),
          }),
        ]),
        el("div", { classe: "lista" },
          lista.length === 0
            ? [vazio("Nenhuma ficha ainda", "Comece pelos pratos que mais saem — é onde o custo importa.")]
            : lista.map(cartaoFicha),
        ),
      ]),
    );

    function cartaoFicha(f) {
      const custo = f.custo_porcao;
      const margem =
        custo !== null && f.preco_venda
          ? Math.round((1 - custo / Number(f.preco_venda)) * 100)
          : null;
      return el("article", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("strong", { texto: f.nome }),
            el("p", {
              classe: "muted",
              texto:
                custo === null
                  ? "Custo aparece depois de conferir os ingredientes."
                  : `Custo por porção ${dinheiro(custo)}${
                      f.preco_venda ? ` · vende a ${dinheiro(Number(f.preco_venda))}` : ""
                    }${margem !== null ? ` · margem ${margem}%` : ""}`,
            }),
          ]),
          el("div", {}, [
            f.confirmada_em ? etiqueta("conferida", "etiqueta-ok") : etiqueta("conferir", "etiqueta-alerta"),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Editar", onclick: () => formulario(f) }),
          ]),
        ]),
      ]);
    }

    function formulario(existente) {
      limpar(conteudo);
      const ingredientes = (existente?.ficha_insumos ?? []).map((fi) => ({
        insumoId: fi.insumos?.id,
        quantidade: Number(fi.quantidade),
      }));

      const nome = el("input", { classe: "campo", value: existente?.nome ?? "", placeholder: "Isca de tilápia" });
      const rendimento = el("input", {
        classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.1", min: "0.1",
        value: existente?.rendimento ?? 1,
      });
      const precoVenda = el("input", {
        classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.01",
        value: existente?.preco_venda ?? "",
      });
      const listaIng = el("div", { classe: "lista" });
      const custoPrevia = el("strong", {});

      const recalcular = () => {
        const total = ingredientes.reduce((t, ing) => {
          const insumo = insumos.find((i) => i.id === ing.insumoId);
          return t + (Number(ing.quantidade) || 0) * (insumo?.custoMedio ?? 0);
        }, 0);
        const rend = Number(rendimento.value) || 1;
        custoPrevia.textContent = dinheiro(total / rend);
      };
      rendimento.addEventListener("input", recalcular);

      const desenharIngredientes = () => {
        limpar(listaIng);
        ingredientes.forEach((ing, i) => {
          const insumo = insumos.find((x) => x.id === ing.insumoId);
          listaIng.append(
            el("div", { classe: "cabecalho-secao" }, [
              el("span", { texto: `${insumo?.nome ?? "?"}` }),
              el("div", { classe: "linha-campos" }, [
                el("input", {
                  classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.001", min: "0",
                  value: ing.quantidade ?? "",
                  title: `em ${insumo?.unidade ?? "un"}`,
                  onchange: (ev) => { ing.quantidade = Number(ev.target.value); recalcular(); },
                }),
                el("button", {
                  classe: "btn btn-peq", type: "button", texto: "×",
                  onclick: () => { ingredientes.splice(i, 1); desenharIngredientes(); },
                }),
              ]),
            ]),
          );
        });
        recalcular();
      };

      const seletor = buscador(
        insumos.map((i) => ({ rotulo: `${i.nome} (${i.unidade})`, valor: i })),
        {
          placeholder: "🔍  Adicionar ingrediente…",
          aoEscolher: (o) => {
            ingredientes.push({ insumoId: o.valor.id, quantidade: null });
            desenharIngredientes();
          },
        },
      );

      const salvar = async (confirmar) => {
        if (nome.value.trim().length < 2) return avisar("Dê um nome à ficha.", "erro");
        const validos = ingredientes.filter((i) => i.insumoId && i.quantidade > 0);
        if (confirmar && validos.length === 0) {
          // Confirmar ficha vazia liberaria custo zero — "lucro puro" falso.
          return avisar("Confira com ao menos um ingrediente com quantidade.", "erro");
        }
        try {
          await post(`/v1/venues/${ctx.venue}/fichas`, {
            id: existente?.id ?? null,
            nome: nome.value,
            rendimento: Number(rendimento.value) || 1,
            preco_venda: precoVenda.value === "" ? null : Number(precoVenda.value),
            ingredientes: validos.map((i) => ({ insumo_id: i.insumoId, quantidade: i.quantidade })),
            confirmar,
          });
          avisar(confirmar ? "Ficha conferida — o custo já vale." : "Ficha salva.", "ok");
          desenhar();
        } catch (e) {
          avisar(e.message, "erro");
        }
      };

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("h2", { texto: existente ? `Editar ${existente.nome}` : "Nova ficha" }),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
          ]),
          el("div", { classe: "cartao pilha" }, [
            el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Nome do prato ou preparo" }), nome]),
            el("div", { classe: "linha-campos" }, [
              el("label", {}, [
                el("span", { texto: "Rende quantas porções" }),
                rendimento,
              ]),
              el("label", {}, [el("span", { texto: "Preço de venda (R$)" }), precoVenda]),
            ]),
            seletor,
            listaIng,
            el("div", { classe: "cabecalho-secao" }, [
              el("span", { texto: "Custo por porção (prévia)" }),
              custoPrevia,
            ]),
          ]),
          el("div", { classe: "linha-campos" }, [
            el("button", { classe: "btn", type: "button", texto: "Salvar rascunho", onclick: () => salvar(false) }),
            el("button", {
              classe: "btn btn-primario",
              type: "button",
              texto: "Salvar e conferir",
              onclick: () => salvar(true),
            }),
          ]),
          existente
            ? el("button", {
                classe: "btn btn-peq", type: "button", texto: "Excluir ficha",
                onclick: async () => {
                  if (!confirm(`Excluir ${existente.nome}? As produções passadas ficam no histórico.`)) return;
                  try {
                    await del(`/v1/venues/${ctx.venue}/fichas/${existente.id}`);
                    desenhar();
                  } catch (e) {
                    avisar(e.message, "erro");
                  }
                },
              })
            : null,
        ].filter(Boolean)),
      );
      desenharIngredientes();
    }
  }
}
