import { get, patch, post } from "../api.js";
import { avisar, buscador, dataHora, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Fornecedores.
 *
 * O campo que trabalha aqui é o CICLO: "entrega a cada 7 dias" é o que
 * transforma consumo médio em quantidade a pedir na sugestão de compra. O
 * resto (CNPJ, telefone) é agenda — útil, mas não é por ele que a tela
 * existe.
 *
 * Cada insumo pode apontar seu fornecedor de costume; é isso que agrupa a
 * sugestão em pedidos prontos, um por fornecedor.
 */

export async function fornecedores(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let lista, insumos;
    try {
      [lista, insumos] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/fornecedores`),
        get(`/v1/venues/${ctx.venue}/insumos`),
      ]);
    } catch (e) {
      limpar(conteudo).append(vazio("Fornecedores indisponíveis", e.message));
      return;
    }
    limpar(conteudo);

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Fornecedores" }),
            el("p", { classe: "muted", texto: "O ciclo de entrega alimenta a sugestão de compra." }),
          ]),
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "+ Novo fornecedor",
            onclick: () => formulario(null),
          }),
        ]),
        el("div", { classe: "lista" },
          lista.length === 0
            ? [vazio("Nenhum fornecedor", "Cadastre de quem a casa compra — leva um minuto.")]
            : lista.map((f) =>
                el("article", { classe: "cartao" }, [
                  el("div", { classe: "cabecalho-secao" }, [
                    el("div", {}, [
                      el("strong", { texto: f.nome }),
                      el("p", {
                        classe: "muted",
                        texto: `entrega a cada ${f.cicloCompraDias} dia(s)${f.telefone ? ` · ${f.telefone}` : ""}`,
                      }),
                    ]),
                    el("div", { classe: "linha-campos" }, [
                      el("button", { classe: "btn btn-peq", type: "button", texto: "Kardex", onclick: () => kardex(f) }),
                      el("button", { classe: "btn btn-peq", type: "button", texto: "Editar", onclick: () => formulario(f) }),
                    ]),
                  ]),
                ]),
              ),
        ),
      ]),
    );

    /**
     * O kardex do fornecedor: a conta corrente das compras dele.
     *
     * Duas metades, e a segunda é a que rende dinheiro: o extrato das compras
     * (com o acumulado — quanto já foi parar neste fornecedor) e o histórico
     * de preço por insumo, do que mais subiu para o que menos. "Vocês subiram
     * a picanha três vezes este ano" só se fala com a lista na mão.
     */
    async function kardex(f) {
      limpar(conteudo).append(el("p", { classe: "muted", texto: "Montando o kardex…" }));
      let k;
      try {
        k = await get(`/v1/venues/${ctx.venue}/fornecedores/${f.id}/kardex`);
      } catch (e) {
        limpar(conteudo).append(vazio("Kardex indisponível", e.message));
        return;
      }

      limpar(conteudo).append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cartao" }, [
            el("div", { classe: "cabecalho-secao" }, [
              el("div", {}, [
                el("h2", { texto: `Kardex — ${k.fornecedor}` }),
                el("p", { classe: "muted", texto: `${k.compras.length} compra(s) recebida(s)` }),
              ]),
              el("div", { classe: "linha-campos" }, [
                el("strong", { style: "font-size:1.3rem", texto: dinheiro(k.total_geral) }),
                el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
              ]),
            ]),
          ]),

          k.precos.length > 0
            ? el("div", { classe: "cartao" }, [
                el("h3", { texto: "Preço por insumo — quem mais subiu primeiro" }),
                el("div", { classe: "rolagem-x", style: "margin-top:10px" }, [
                  el("table", { classe: "planilha" }, [
                    el("thead", {}, [
                      el("tr", {}, [
                        el("th", { texto: "Insumo" }),
                        el("th", { classe: "col-num", texto: "Compras" }),
                        el("th", { classe: "col-num", texto: "Primeiro preço" }),
                        el("th", { classe: "col-num", texto: "Último preço" }),
                        el("th", { classe: "col-num", texto: "Variação" }),
                      ]),
                    ]),
                    el(
                      "tbody",
                      {},
                      k.precos.map((pr) =>
                        el("tr", {}, [
                          el("td", {}, [el("strong", { texto: pr.insumo })]),
                          el("td", { classe: "col-num", texto: String(pr.compras) }),
                          el("td", { classe: "col-num", texto: dinheiro(pr.primeiro_custo) }),
                          el("td", { classe: "col-num", texto: dinheiro(pr.ultimo_custo) }),
                          el("td", { classe: "col-num" }, [
                            pr.variacao_pct === null
                              ? el("span", { classe: "muted", texto: "—" })
                              : etiqueta(
                                  `${pr.variacao_pct > 0 ? "+" : ""}${pr.variacao_pct}%`,
                                  pr.variacao_pct > 0 ? "etiqueta-perigo" : "etiqueta-ok",
                                ),
                          ]),
                        ]),
                      ),
                    ),
                  ]),
                ]),
              ])
            : null,

          el("div", { classe: "cartao" }, [
            el("h3", { texto: "Compras recebidas — a conta corrente" }),
            k.compras.length === 0
              ? el("p", { classe: "muted", style: "margin-top:8px", texto: "Nenhuma compra recebida deste fornecedor ainda." })
              : el("div", { classe: "rolagem-x", style: "margin-top:10px" }, [
                  el("table", { classe: "planilha" }, [
                    el("thead", {}, [
                      el("tr", {}, [
                        el("th", { texto: "Quando" }),
                        el("th", { texto: "Itens" }),
                        el("th", { classe: "col-num", texto: "Valor" }),
                        el("th", { classe: "col-num", texto: "Acumulado" }),
                      ]),
                    ]),
                    el(
                      "tbody",
                      {},
                      k.compras.map((c) =>
                        el("tr", {}, [
                          el("td", { texto: dataHora(c.quando) }),
                          // Os itens na própria linha, resumidos: abrir compra a
                          // compra para saber o que veio é o que se faz no
                          // módulo de Compras; aqui a leitura é corrida.
                          el("td", { style: "white-space:normal;max-width:44ch" }, [
                            el("span", {
                              classe: "muted",
                              texto: c.itens.map((i) => `${i.quantidade} ${i.unidade} ${i.insumo}`).join(" · "),
                            }),
                          ]),
                          el("td", { classe: "col-num" }, [el("strong", { texto: dinheiro(c.total) })]),
                          el("td", { classe: "col-num", texto: dinheiro(c.acumulado) }),
                        ]),
                      ),
                    ),
                  ]),
                ]),
          ]),
        ]),
      );
    }

    function formulario(existente) {
      limpar(conteudo);
      const campos = {
        nome: el("input", { classe: "campo", value: existente?.nome ?? "", placeholder: "Atacadão, Açougue Central…" }),
        ciclo: el("input", { classe: "campo-numero", type: "number", inputmode: "numeric", min: "1", max: "60", value: existente?.cicloCompraDias ?? 7 }),
        telefone: el("input", { classe: "campo", value: existente?.telefone ?? "", placeholder: "(65) 9 9999-9999" }),
        email: el("input", { classe: "campo", type: "email", value: existente?.email ?? "" }),
        cnpj: el("input", { classe: "campo", value: existente?.cnpj ?? "" }),
        obs: el("input", { classe: "campo", value: existente?.observacoes ?? "", placeholder: "Pedido mínimo, prazo, contato…" }),
      };
      const linha = (rotulo, campo, ajuda) =>
        el("label", { classe: "campo-rotulado" }, [
          el("span", { texto: rotulo }),
          campo,
          ajuda ? el("small", { classe: "muted", texto: ajuda }) : null,
        ].filter(Boolean));

      // Amarrar os insumos ao fornecedor aqui, na mesma tela: é agora que a
      // pessoa está pensando "o que eu compro dele?".
      const doFornecedor = existente
        ? insumos.filter((i) => i.fornecedorId === existente.id)
        : [];
      const listaVinculos = el("div", { classe: "lista" });
      const desenharVinculos = () => {
        limpar(listaVinculos);
        for (const i of doFornecedor) {
          listaVinculos.append(
            el("div", { classe: "cabecalho-secao" }, [
              el("span", { texto: i.nome }),
              el("button", {
                classe: "btn btn-peq", type: "button", texto: "×",
                onclick: async () => {
                  try {
                    await patch(`/v1/venues/${ctx.venue}/insumos/${i.id}`, { fornecedor_id: null });
                    doFornecedor.splice(doFornecedor.indexOf(i), 1);
                    desenharVinculos();
                  } catch (e) { avisar(e.message, "erro"); }
                },
              }),
            ]),
          );
        }
      };

      conteudo.append(
        el("section", { classe: "cartao pilha" }, [
          el("h2", { texto: existente ? `Editar ${existente.nome}` : "Novo fornecedor" }),
          linha("Nome", campos.nome),
          linha("Entrega a cada quantos dias", campos.ciclo, "É este número que diz para quantos dias a sugestão de compra pede."),
          linha("WhatsApp / telefone", campos.telefone),
          linha("E-mail", campos.email),
          linha("CNPJ", campos.cnpj),
          linha("Observações", campos.obs),

          existente
            ? el("div", {}, [
                el("h3", { texto: "O que se compra dele" }),
                listaVinculos,
                buscador(
                  insumos.filter((i) => i.fornecedorId !== existente.id)
                    .map((i) => ({ rotulo: i.nome, valor: i })),
                  {
                    placeholder: "🔍  Adicionar insumo deste fornecedor…",
                    aoEscolher: async (o) => {
                      try {
                        await patch(`/v1/venues/${ctx.venue}/insumos/${o.valor.id}`, { fornecedor_id: existente.id });
                        o.valor.fornecedorId = existente.id;
                        doFornecedor.push(o.valor);
                        desenharVinculos();
                      } catch (e) { avisar(e.message, "erro"); }
                    },
                  },
                ),
              ])
            : null,

          el("div", { classe: "linha-campos" }, [
            el("button", {
              classe: "btn btn-primario",
              type: "button",
              texto: "Salvar",
              onclick: async () => {
                if (campos.nome.value.trim().length < 2) return avisar("Dê um nome ao fornecedor.", "erro");
                try {
                  await post(`/v1/venues/${ctx.venue}/fornecedores`, {
                    id: existente?.id ?? null,
                    nome: campos.nome.value,
                    ciclo_compra_dias: Number(campos.ciclo.value) || 7,
                    telefone: campos.telefone.value || null,
                    email: campos.email.value || null,
                    cnpj: campos.cnpj.value || null,
                    observacoes: campos.obs.value || null,
                  });
                  desenhar();
                } catch (e) { avisar(e.message, "erro"); }
              },
            }),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
          ]),
        ].filter(Boolean)),
      );
      desenharVinculos();
    }
  }
}
