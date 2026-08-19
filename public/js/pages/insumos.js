import { del, get, patch, post } from "../api.js";
import { avisar, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Cadastro de insumos e de locais de estoque.
 *
 * Uma tela só para os dois porque um não vive sem o outro: insumo sem local
 * não tem onde ter saldo, e local sem insumo é uma prateleira vazia. Quem
 * está montando o módulo faz os dois na mesma sentada.
 *
 * O saldo aparece ao lado de cada insumo, mas NÃO se edita aqui — saldo só
 * muda por recebimento, produção ou contagem. Editar saldo na tela de
 * cadastro foi a causa raiz do bug histórico de contagem no Gorjeta.
 */

export async function insumos(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let lista, locais;
    try {
      [lista, locais] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/insumos`),
        get(`/v1/venues/${ctx.venue}/estoque-locais`),
      ]);
    } catch (e) {
      limpar(conteudo).append(vazio("Estoque indisponível", e.message));
      return;
    }
    limpar(conteudo);

    // ---- Locais ----
    const nomeLocal = el("input", { classe: "campo", placeholder: "Depósito, Adega, Freezer…" });
    conteudo.append(
      el("section", { classe: "cartao" }, [
        el("h3", { texto: "Onde o estoque mora" }),
        el("p", {
          classe: "muted",
          texto: "Cada lugar tem saldo próprio: a garrafa do bar não conta para a cozinha.",
        }),
        el("div", { classe: "lista" },
          locais.map((l) =>
            el("div", { classe: "cabecalho-secao" }, [
              el("span", {}, [
                el("strong", { texto: l.nome }),
                l.principal ? etiqueta(" recebe compras", "etiqueta-ok") : null,
              ].filter(Boolean)),
              el("button", {
                classe: "btn btn-peq",
                type: "button",
                texto: "Desativar",
                onclick: async () => {
                  if (!confirm(`Desativar ${l.nome}? O histórico fica; o local some das telas.`)) return;
                  try {
                    await del(`/v1/venues/${ctx.venue}/estoque-locais/${l.id}`);
                    desenhar();
                  } catch (e) {
                    avisar(e.message, "erro");
                  }
                },
              }),
            ]),
          ),
        ),
        el("div", { classe: "linha-campos" }, [
          nomeLocal,
          el("button", {
            classe: "btn",
            type: "button",
            texto: "+ Local",
            onclick: async () => {
              if (nomeLocal.value.trim().length < 2) return avisar("Dê um nome ao local.", "erro");
              try {
                await post(`/v1/venues/${ctx.venue}/estoque-locais`, { nome: nomeLocal.value });
                desenhar();
              } catch (e) {
                avisar(e.message, "erro");
              }
            },
          }),
        ]),
      ]),
    );

    // ---- Insumos ----
    const busca = el("input", { classe: "campo", placeholder: "Buscar insumo…" });
    const tabela = el("div", { classe: "lista" });

    const desenharLista = () => {
      const alvo = busca.value.trim().toLowerCase();
      const filtrados = alvo
        ? lista.filter((i) => i.nomeNormalizado.includes(alvo) || (i.codigo ?? "").includes(alvo))
        : lista;
      limpar(tabela);
      if (filtrados.length === 0) {
        tabela.append(vazio("Nenhum insumo", "Cadastre o que a casa compra: carne, cerveja, óleo…"));
      }
      for (const i of filtrados) tabela.append(cartaoInsumo(i));
    };
    busca.addEventListener("input", desenharLista);

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("h2", { texto: `${lista.length} insumo(s)` }),
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "+ Novo insumo",
            onclick: () => formulario(null),
          }),
        ]),
        busca,
        tabela,
      ]),
    );
    desenharLista();

    function cartaoInsumo(i) {
      const abaixoDoMinimo = i.estoqueMinimo !== null && i.saldo < i.estoqueMinimo;
      return el("article", { classe: `cartao ${abaixoDoMinimo ? "cartao-atencao" : ""}` }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("strong", { texto: i.nome }),
            el("p", {
              classe: "muted",
              texto: `${i.saldo} ${i.unidade} em estoque · custo médio ${dinheiro(i.custoMedio)}`,
            }),
          ]),
          el("div", {}, [
            abaixoDoMinimo ? etiqueta("comprar", "etiqueta-perigo") : null,
            el("button", {
              classe: "btn btn-peq",
              type: "button",
              texto: "Editar",
              onclick: () => formulario(i),
            }),
          ].filter(Boolean)),
        ]),
      ]);
    }

    function formulario(existente) {
      limpar(conteudo);
      const campos = {
        nome: el("input", { classe: "campo", value: existente?.nome ?? "", placeholder: "Tilápia congelada" }),
        unidade: el("input", { classe: "campo", value: existente?.unidade ?? "un", placeholder: "kg, L, un, cx" }),
        categoria: el("input", { classe: "campo", value: existente?.categoria ?? "", placeholder: "Proteína, Bebida… (opcional)" }),
        codigo: el("input", { classe: "campo", value: existente?.codigo ?? "", placeholder: "Código do fornecedor/PDV (opcional)" }),
        minimo: el("input", { classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.001", value: existente?.estoqueMinimo ?? "" }),
        tolerancia: el("input", { classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.5", min: "0", value: existente?.toleranciaPct ?? 0 }),
      };

      const linha = (rotulo, campo, ajuda) =>
        el("label", { classe: "campo-rotulado" }, [
          el("span", { texto: rotulo }),
          campo,
          ajuda ? el("small", { classe: "muted", texto: ajuda }) : null,
        ].filter(Boolean));

      conteudo.append(
        el("section", { classe: "cartao pilha" }, [
          el("h2", { texto: existente ? `Editar ${existente.nome}` : "Novo insumo" }),
          linha("Nome", campos.nome),
          linha("Unidade de medida", campos.unidade, "Como a casa conta: kg, litro, unidade, caixa."),
          linha("Categoria", campos.categoria),
          linha("Código", campos.codigo, "O da nota do fornecedor. Com ele, a foto casa sozinha."),
          linha("Estoque mínimo", campos.minimo, "Abaixo disso o insumo aparece marcado para compra."),
          linha(
            "Tolerância de entrega (%)",
            campos.tolerancia,
            "Quanto pode vir diferente do pedido sem virar cobrança. Carne pesada: 2–3%. Lata: 0.",
          ),
          el("div", { classe: "linha-campos" }, [
            el("button", {
              classe: "btn btn-primario",
              type: "button",
              texto: "Salvar",
              onclick: async () => {
                if (campos.nome.value.trim().length < 2) return avisar("Dê um nome ao insumo.", "erro");
                try {
                  const corpo = {
                    nome: campos.nome.value,
                    unidade: campos.unidade.value,
                    categoria: campos.categoria.value || null,
                    codigo: campos.codigo.value || null,
                    estoque_minimo: campos.minimo.value === "" ? null : Number(campos.minimo.value),
                    tolerancia_pct: Number(campos.tolerancia.value || 0),
                  };
                  if (existente) {
                    await patch(`/v1/venues/${ctx.venue}/insumos/${existente.id}`, corpo);
                  } else {
                    const r = await post(`/v1/venues/${ctx.venue}/insumos`, corpo);
                    // O POST devolve o existente quando o nome já estava lá —
                    // avisa em vez de fingir que criou.
                    if (!r.criado) avisar("Esse insumo já estava cadastrado — abrindo o existente.", "info");
                    if (!r.criado) {
                      await patch(`/v1/venues/${ctx.venue}/insumos/${r.insumo.id}`, corpo);
                    }
                  }
                  desenhar();
                } catch (e) {
                  avisar(e.message, "erro");
                }
              },
            }),
            existente
              ? el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: "Desativar insumo",
                  onclick: async () => {
                    if (!confirm(`Desativar ${existente.nome}? O histórico fica.`)) return;
                    try {
                      await patch(`/v1/venues/${ctx.venue}/insumos/${existente.id}`, { ativo: false });
                      desenhar();
                    } catch (e) {
                      avisar(e.message, "erro");
                    }
                  },
                })
              : null,
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
          ].filter(Boolean)),
        ]),
      );
    }
  }
}
