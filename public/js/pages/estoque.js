import { del, get, patch, post } from "../api.js";
import { avisar, buscador, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";
import { abrirKardex } from "./kardex.js";

/**
 * Posição do estoque: o que há, onde, e quanto vale.
 *
 * A tela responde duas perguntas na ordem em que elas doem:
 *   1. quanto dinheiro está parado em estoque (o total no topo);
 *   2. em que ele está parado (a lista, do mais valioso para o menos).
 *
 * O "por que o saldo é esse" mora na página Kardex — o botão em cada linha
 * pula para lá já no item certo. Transferência e perda vivem aqui porque é
 * olhando a posição que a pessoa percebe "isso está no lugar errado" ou
 * "isso venceu" — a ação nasce do olhar, e mudar de tela no meio mata o
 * impulso.
 */

export async function estoque(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let posicao, locais, insumos;
    try {
      [posicao, locais, insumos] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/estoque/posicao`),
        get(`/v1/venues/${ctx.venue}/estoque-locais`),
        get(`/v1/venues/${ctx.venue}/insumos`),
      ]);
    } catch (e) {
      limpar(conteudo).append(vazio("Estoque indisponível", e.message));
      return;
    }
    limpar(conteudo);

    const totalRotulo = el("strong", {
      style: "font-size:1.3rem",
      texto: dinheiro(posicao.reduce((t, p) => t + Number(p.valor), 0)),
    });
    const lista = el("div", {});

    // O filtro por estoque vem dos próprios dados: cada linha da posição já
    // diz de que local é. Um seletor a mais, zero ida ao servidor.
    const nomesDeLocais = [...new Set(posicao.map((p) => p.local_nome))].sort();
    const seletorLocal = el(
      "select",
      { classe: "select" },
      [
        el("option", { value: "", texto: "Todos os estoques" }),
        ...nomesDeLocais.map((nome) => el("option", { value: nome, texto: nome })),
      ],
    );
    seletorLocal.addEventListener("change", () => desenharLista(busca.value));

    /**
     * Tabela, e não cartão por item.
     *
     * A posição de uma casa de verdade tem dezenas ou centenas de insumos, e
     * cartão gasta uma tela inteira para mostrar oito. Tabela mostra trinta
     * sem rolar — e posição de estoque se LÊ em varredura, comparando linhas,
     * que é exatamente o que coluna alinhada faz e cartão desfaz.
     */
    const desenharLista = (filtro = "") => {
      const norm = (t) => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const alvo = norm(filtro.trim());
      const local = seletorLocal.value;
      const filtradas = posicao.filter(
        (p) => (!local || p.local_nome === local) && (!alvo || norm(p.insumo).includes(alvo)),
      );

      // O total acompanha o filtro: com "Câmara fria" escolhida, o número do
      // topo é o valor parado NA câmara — que é a pergunta de quem filtrou.
      const valorFiltrado = filtradas.reduce((t, p) => t + Number(p.valor), 0);
      totalRotulo.textContent = dinheiro(valorFiltrado);

      limpar(lista);
      if (filtradas.length === 0) {
        lista.append(vazio("Nada em estoque", "Receba uma compra e a posição aparece aqui."));
        return;
      }

      const mostrarLocal = !local;
      lista.append(
        el("div", { classe: "cartao" }, [
          el("div", { classe: "rolagem-x" }, [
            el("table", { classe: "planilha" }, [
              el("thead", {}, [
                el("tr", {}, [
                  el("th", { texto: "Insumo" }),
                  mostrarLocal ? el("th", { texto: "Estoque" }) : null,
                  el("th", { classe: "col-num", texto: "Quantidade" }),
                  el("th", { classe: "col-num", texto: "Custo médio" }),
                  el("th", { classe: "col-num", texto: "Valor" }),
                  el("th", { classe: "col-acoes", texto: "" }),
                ].filter(Boolean)),
              ]),
              el(
                "tbody",
                {},
                filtradas.map((p) =>
                  el("tr", {}, [
                    el("td", {}, [el("strong", { texto: p.insumo })]),
                    mostrarLocal ? el("td", { texto: p.local_nome }) : null,
                    el("td", { classe: "col-num", texto: `${p.quantidade} ${p.unidade}` }),
                    el("td", { classe: "col-num", texto: dinheiro(Number(p.custo_medio)) }),
                    el("td", { classe: "col-num" }, [el("strong", { texto: dinheiro(Number(p.valor)) })]),
                    el("td", { classe: "col-acoes" }, [
                      el("button", {
                        classe: "btn btn-peq",
                        type: "button",
                        texto: "Kardex",
                        // Atalho: pula para a página Kardex já neste produto.
                        onclick: () => abrirKardex({ aba: "produto", id: p.insumo_id, nome: p.insumo }),
                      }),
                    ]),
                  ].filter(Boolean)),
                ),
              ),
            ]),
          ]),
        ]),
      );
    };

    const busca = el("input", { classe: "campo", placeholder: "🔍  Buscar no estoque…", style: "flex:1" });
    busca.addEventListener("input", () => desenharLista(busca.value));

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cartao" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: "Posição do estoque" }),
              el("p", { classe: "muted", texto: "Do mais valioso para o menos — é onde o dinheiro está parado." }),
            ]),
            totalRotulo,
          ]),
        ]),
        el("div", { classe: "linha-campos" }, [
          el("button", { classe: "btn", type: "button", texto: "⇄ Transferir", onclick: () => movimentar("transferir") }),
          el("button", { classe: "btn", type: "button", texto: "🗑 Registrar perda", onclick: () => movimentar("perda") }),
          el("button", { classe: "btn", type: "button", texto: "🏬 Locais de estoque", onclick: gerenciarLocais }),
        ]),
        el("div", { classe: "linha-campos" }, [
          el("label", { classe: "campo-rotulado", style: "min-width:200px" }, [
            el("span", { texto: "Estoque" }),
            seletorLocal,
          ]),
          busca,
        ]),
        lista,
      ]),
    );
    desenharLista();

    /**
     * Os lugares onde o estoque mora, com TIPO: principal (recebe compras
     * por padrão), produção (de onde a cozinha baixa) e geral. Só existe um
     * principal por casa — marcar um novo rebaixa o atual.
     */
    function gerenciarLocais() {
      limpar(conteudo);

      const ROTULO_DO_TIPO = {
        principal: ["Principal — recebe compras", "etiqueta-ok"],
        producao: ["Produção", "etiqueta-alerta"],
        geral: ["Geral", ""],
      };

      const nomeNovo = el("input", { classe: "campo", placeholder: "Depósito, Cozinha, Adega…", style: "flex:2" });
      const tipoNovo = el("select", { classe: "select", style: "flex:1" }, [
        el("option", { value: "geral", texto: "Geral" }),
        el("option", { value: "principal", texto: "Principal (recebe compras)" }),
        el("option", { value: "producao", texto: "Produção" }),
      ]);

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: "Locais de estoque" }),
              el("p", { classe: "muted", texto: "Cada lugar tem saldo próprio: a garrafa do bar não conta para a cozinha." }),
            ]),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
          ]),
          el("div", { classe: "tabela" },
            locais.map((l) => {
              const [rotulo, variante] = ROTULO_DO_TIPO[l.tipo] ?? [l.tipo, ""];
              const seletorTipo = el("select", { classe: "select select-peq" },
                Object.keys(ROTULO_DO_TIPO).map((t) =>
                  el("option", { value: t, texto: t === "principal" ? "principal" : t, selected: l.tipo === t }),
                ),
              );
              seletorTipo.addEventListener("change", async () => {
                try {
                  await patch(`/v1/venues/${ctx.venue}/estoque-locais/${l.id}`, { tipo: seletorTipo.value });
                  avisar(`${l.nome} agora é ${seletorTipo.value}.`, "ok");
                  locais = await get(`/v1/venues/${ctx.venue}/estoque-locais`);
                  gerenciarLocais();
                } catch (e) {
                  avisar(e.message, "erro");
                }
              });
              return el("div", { classe: "linha-tabela" }, [
                el("span", { classe: "linha-principal" }, [
                  el("strong", { texto: l.nome }),
                  etiqueta(rotulo, variante),
                ]),
                el("span", { classe: "linha-detalhes" }, [
                  el("button", {
                    classe: "btn-icone",
                    type: "button",
                    title: "Renomear este estoque",
                    texto: "✏️",
                    onclick: async () => {
                      const novo = prompt(`Novo nome para "${l.nome}":`, l.nome);
                      if (!novo || novo.trim().length < 2 || novo.trim() === l.nome) return;
                      try {
                        await patch(`/v1/venues/${ctx.venue}/estoque-locais/${l.id}`, { nome: novo });
                        avisar(`Renomeado para ${novo.trim()}.`, "ok");
                        locais = await get(`/v1/venues/${ctx.venue}/estoque-locais`);
                        gerenciarLocais();
                      } catch (e) {
                        avisar(e.message, "erro");
                      }
                    },
                  }),
                  seletorTipo,
                  el("button", {
                    classe: "btn btn-peq",
                    type: "button",
                    texto: "Desativar",
                    onclick: async () => {
                      if (!confirm(`Desativar ${l.nome}? O histórico fica; o local some das telas.`)) return;
                      try {
                        await del(`/v1/venues/${ctx.venue}/estoque-locais/${l.id}`);
                        locais = await get(`/v1/venues/${ctx.venue}/estoque-locais`);
                        gerenciarLocais();
                      } catch (e) {
                        avisar(e.message, "erro");
                      }
                    },
                  }),
                ]),
              ]);
            }),
          ),
          el("div", { classe: "cartao pilha" }, [
            el("h3", { texto: "Novo local" }),
            el("div", { classe: "linha-campos" }, [
              nomeNovo,
              tipoNovo,
              el("button", {
                classe: "btn btn-primario",
                type: "button",
                texto: "+ Criar",
                onclick: async () => {
                  if (nomeNovo.value.trim().length < 2) return avisar("Dê um nome ao local.", "erro");
                  try {
                    await post(`/v1/venues/${ctx.venue}/estoque-locais`, {
                      nome: nomeNovo.value,
                      tipo: tipoNovo.value,
                    });
                    locais = await get(`/v1/venues/${ctx.venue}/estoque-locais`);
                    gerenciarLocais();
                  } catch (e) {
                    avisar(e.message, "erro");
                  }
                },
              }),
            ]),
          ]),
        ]),
      );
    }

    function movimentar(modo) {
      limpar(conteudo);
      let insumo = null;
      const escolhido = el("p", { classe: "muted", texto: "Nenhum item escolhido ainda." });

      const deLocal = el("select", { classe: "select" },
        locais.map((l) => el("option", { value: l.id, texto: l.nome, selected: l.principal })));
      const paraLocal = el("select", { classe: "select" },
        locais.map((l, i) => el("option", { value: l.id, texto: l.nome, selected: i === 1 })));
      const qtd = el("input", { classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.001", min: "0" });
      const motivo = el("input", { classe: "campo", placeholder: "venceu, quebrou, caiu no chão…" });

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("h2", { texto: modo === "transferir" ? "Transferir entre estoques" : "Registrar perda" }),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Cancelar", onclick: desenhar }),
          ]),
          el("div", { classe: "cartao pilha" }, [
            el("label", { classe: "campo-rotulado" }, [
              el("span", { texto: "Item" }),
              buscador(
                insumos.map((i) => ({ rotulo: `${i.nome} (${i.saldo} ${i.unidade})`, valor: i })),
                {
                  placeholder: "🔍  Digite o nome do item…",
                  aoEscolher: (o) => {
                    insumo = o.valor;
                    escolhido.textContent = `${insumo.nome} — ${insumo.saldo} ${insumo.unidade} no total`;
                  },
                },
              ),
              escolhido,
            ]),
            el("label", { classe: "campo-rotulado" }, [
              el("span", { texto: modo === "transferir" ? "De" : "Onde estava" }),
              deLocal,
            ]),
            modo === "transferir"
              ? el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Para" }), paraLocal])
              : el("label", { classe: "campo-rotulado" }, [
                  el("span", { texto: "Motivo" }),
                  motivo,
                  el("small", { classe: "muted", texto: "É o motivo que separa quebra conhecida de desvio na contagem." }),
                ]),
            el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Quantidade" }), qtd]),
            el("button", {
              classe: "btn btn-primario btn-grande",
              type: "button",
              texto: modo === "transferir" ? "Transferir" : "Registrar perda",
              onclick: async (ev) => {
                if (!insumo) return avisar("Escolha o item.", "erro");
                if (!(Number(qtd.value) > 0)) return avisar("Informe a quantidade.", "erro");
                ev.target.disabled = true;
                try {
                  if (modo === "transferir") {
                    await post(`/v1/venues/${ctx.venue}/estoque/transferir`, {
                      insumo_id: insumo.id,
                      de_local: deLocal.value,
                      para_local: paraLocal.value,
                      quantidade: Number(qtd.value),
                    });
                    avisar("Transferido.", "ok");
                  } else {
                    await post(`/v1/venues/${ctx.venue}/estoque/perda`, {
                      insumo_id: insumo.id,
                      local_id: deLocal.value,
                      quantidade: Number(qtd.value),
                      motivo: motivo.value,
                    });
                    avisar("Perda registrada.", "ok");
                  }
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
    }
  }
}
