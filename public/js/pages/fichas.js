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
          el("div", { classe: "linha-campos" }, [
            el("button", {
              classe: "btn",
              type: "button",
              texto: "✨ Sugerir com IA",
              onclick: () => pedirSugestao(),
            }),
            el("button", {
              classe: "btn btn-primario",
              type: "button",
              texto: "+ Nova ficha",
              onclick: () => formulario(null),
            }),
          ]),
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

    /**
     * Pede a receita à IA.
     *
     * O nome do prato é o suficiente; "como a casa faz" existe porque a
     * mesma isca de tilápia é empanada em Cuiabá e grelhada em outro lugar,
     * e uma frase muda a ficha inteira.
     */
    function pedirSugestao() {
      limpar(conteudo);
      const prato = el("input", { classe: "campo", placeholder: "Isca de tilápia" });
      const comoFaz = el("input", {
        classe: "campo",
        placeholder: "empanada na farinha de trigo, servida com limão (opcional)",
      });

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: "Sugerir ficha com IA" }),
              el("p", { classe: "muted", texto: "Diga o prato; a IA propõe os ingredientes com o que a casa tem cadastrado." }),
            ]),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
          ]),
          el("div", { classe: "cartao pilha" }, [
            el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Nome do prato" }), prato]),
            el("label", { classe: "campo-rotulado" }, [
              el("span", { texto: "Como a casa faz" }),
              comoFaz,
              el("small", { classe: "muted", texto: "Uma frase basta — muda bastante a receita proposta." }),
            ]),
            el("button", {
              classe: "btn btn-primario btn-grande",
              type: "button",
              texto: "✨ Propor ficha",
              onclick: async (ev) => {
                if (prato.value.trim().length < 2) return avisar("Diga o nome do prato.", "erro");
                ev.target.disabled = true;
                ev.target.textContent = "Pensando na receita…";
                try {
                  const sugestao = await post(`/v1/venues/${ctx.venue}/fichas/sugerir`, {
                    prato: prato.value,
                    observacao: comoFaz.value || null,
                  });
                  formulario(null, { ...sugestao, prato: prato.value.trim() });
                } catch (e) {
                  avisar(e.message, "erro");
                  ev.target.disabled = false;
                  ev.target.textContent = "✨ Propor ficha";
                }
              },
            }),
          ]),
        ]),
      );
    }

    function formulario(existente, sugestao) {
      limpar(conteudo);
      const ingredientes = sugestao
        ? sugestao.ingredientes.map((i) => ({
            insumoId: i.insumoId,
            quantidade: Number(i.quantidade),
            observacao: i.observacao ?? null,
          }))
        : (existente?.ficha_insumos ?? []).map((fi) => ({
            insumoId: fi.insumos?.id,
            quantidade: Number(fi.quantidade),
          }));

      const nome = el("input", {
        classe: "campo",
        value: sugestao?.prato ?? existente?.nome ?? "",
        placeholder: "Isca de tilápia",
      });
      const rendimento = el("input", {
        classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.1", min: "0.1",
        value: sugestao?.rendimento ?? existente?.rendimento ?? 1,
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
              el("span", {}, [
                el("span", { texto: `${insumo?.nome ?? "?"}` }),
                ing.observacao ? el("small", { classe: "muted", texto: ` — ${ing.observacao}` }) : null,
              ].filter(Boolean)),
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
            ingredientes: validos.map((i) => ({
              insumo_id: i.insumoId,
              quantidade: i.quantidade,
              observacao: i.observacao ?? null,
            })),
            confirmar,
          });
          avisar(confirmar ? "Ficha conferida — o custo já vale." : "Ficha salva.", "ok");
          desenhar();
        } catch (e) {
          avisar(e.message, "erro");
        }
      };

      // O que a receita pede e a casa não cadastrou. Fica à vista, com o
      // botão de cadastrar ao lado: sem isso a pessoa salva uma ficha pela
      // metade sem perceber, e o custo por porção sai menor que a verdade.
      const faltando = (sugestao?.faltando ?? []).slice();
      const listaFaltando = el("div", { classe: "tabela" });
      const blocoFaltando = el("div", { classe: "cartao pilha", hidden: faltando.length === 0 }, [
        el("strong", { texto: "Falta cadastrar" }),
        el("p", { classe: "muted", texto: "A receita usa isto, e a casa ainda não tem no cadastro. Sem eles, o custo sai menor que o real." }),
        listaFaltando,
      ]);

      const desenharFaltando = () => {
        limpar(listaFaltando);
        blocoFaltando.hidden = faltando.length === 0;
        faltando.forEach((f, i) => {
          listaFaltando.append(
            el("div", { classe: "linha-tabela" }, [
              el("span", { classe: "linha-principal" }, [
                el("strong", { texto: f.nome }),
                el("small", { classe: "muted", texto: `${f.quantidade || "?"} ${f.unidade} no lote` }),
              ]),
              el("span", { classe: "linha-detalhes" }, [
                el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: "+ Cadastrar e usar",
                  onclick: async (ev) => {
                    ev.target.disabled = true;
                    try {
                      const r = await post(`/v1/venues/${ctx.venue}/insumos`, {
                        nome: f.nome,
                        unidade: f.unidade,
                      });
                      // Entra na lista em memória para o cálculo do custo
                      // achar o insumo sem recarregar a tela e perder o que
                      // já foi digitado.
                      if (!insumos.some((x) => x.id === r.insumo.id)) insumos.push(r.insumo);
                      ingredientes.push({ insumoId: r.insumo.id, quantidade: f.quantidade || null });
                      faltando.splice(i, 1);
                      desenharFaltando();
                      desenharIngredientes();
                      avisar(`${f.nome} cadastrado. Confira o custo dele depois da primeira compra.`, "ok");
                    } catch (e) {
                      avisar(e.message, "erro");
                      ev.target.disabled = false;
                    }
                  },
                }),
                el("button", {
                  classe: "btn-icone",
                  type: "button",
                  title: "Não uso este ingrediente",
                  texto: "✕",
                  onclick: () => {
                    faltando.splice(i, 1);
                    desenharFaltando();
                  },
                }),
              ]),
            ]),
          );
        });
      };

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("h2", { texto: existente ? `Editar ${existente.nome}` : sugestao ? "Ficha proposta pela IA" : "Nova ficha" }),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
          ]),
          sugestao
            ? el("p", {
                classe: "aviso aviso-alerta",
                texto: "Isto é uma sugestão. Confira quantidade por quantidade com quem cozinha — é este número que vira o custo do prato e o preço no cardápio.",
              })
            : null,
          ...(sugestao?.avisos ?? []).map((a) => el("p", { classe: "aviso aviso-alerta", texto: a })),
          blocoFaltando,
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
      desenharFaltando();
    }
  }
}
