import { get } from "../api.js";
import { buscador, dataHora, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Kardex: a conta corrente do estoque, num lugar só.
 *
 * Três leituras do mesmo livro-razão, em três abas:
 *   - Movimentação: tudo que aconteceu, com filtros — a visão de auditoria;
 *   - Kardex do produto: um insumo, cada entrada e saída, saldo após cada uma;
 *   - Kardex do fornecedor: as compras dele, o acumulado e o preço que subiu.
 *
 * Estas visões nasceram espalhadas (uma aba em Estoque, um botão em Posição,
 * outro em Fornecedores) e ninguém as achava. Consulta é diferente de
 * operação: quem transfere e registra perda está OPERANDO o estoque; quem
 * abre o kardex está CONFERINDO — e conferência merece uma porta própria no
 * menu. Os botões antigos continuam existindo como atalhos para cá.
 */

/** Chave do atalho: outra tela deixa aqui aonde o kardex deve abrir. */
export const ATALHO_KARDEX = "brasa.kardex";

/** Usado por Estoque e Fornecedores: pula para o kardex já na visão certa. */
export function abrirKardex(atalho) {
  sessionStorage.setItem(ATALHO_KARDEX, JSON.stringify(atalho));
  location.hash = "#kardex";
}

const NOME_DO_TIPO = {
  compra: "compra",
  venda: "venda",
  producao_entrada: "produção (entrada)",
  producao_saida: "produção (saída)",
  transferencia_entrada: "transferência (entrou)",
  transferencia_saida: "transferência (saiu)",
  perda: "perda",
  ajuste_contagem: "ajuste de contagem",
};

export async function kardex(raiz, ctx) {
  // O atalho vive uma navegação só: lido, morre. Sem isto, abrir o kardex
  // pelo menu amanhã ainda mostraria o insumo clicado ontem.
  let atalho = null;
  try {
    atalho = JSON.parse(sessionStorage.getItem(ATALHO_KARDEX));
  } catch {
    /* atalho quebrado = sem atalho */
  }
  sessionStorage.removeItem(ATALHO_KARDEX);

  let abaAtual = atalho?.aba ?? "movimentos";
  const conteudo = el("div", {});

  const ABAS = [
    ["movimentos", "Movimentação"],
    ["produto", "Kardex do produto"],
    ["fornecedor", "Kardex do fornecedor"],
  ];
  const barra = el(
    "div",
    { classe: "abas" },
    ABAS.map(([id, rotulo]) =>
      el("button", {
        classe: `aba ${id === abaAtual ? "aba-ativa" : ""}`.trim(),
        type: "button",
        texto: rotulo,
        "data-aba": id,
        onclick: () => trocarAba(id),
      }),
    ),
  );
  raiz.append(el("div", { classe: "pilha" }, [barra, conteudo]));

  async function trocarAba(id) {
    abaAtual = id;
    for (const b of barra.querySelectorAll("[data-aba]")) {
      b.classList.toggle("aba-ativa", b.dataset.aba === id);
    }
    if (id === "movimentos") await desenharMovimentos();
    else if (id === "produto") await desenharProduto();
    else await desenharFornecedor();
  }

  await trocarAba(abaAtual);

  // ============ Aba 1: tudo que aconteceu ============

  async function desenharMovimentos() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando a movimentação…" }));

    let insumos = [];
    try {
      insumos = await get(`/v1/venues/${ctx.venue}/insumos`);
    } catch {
      /* sem a lista, o filtro por insumo só não aparece */
    }

    const seletorInsumo = el(
      "select",
      { classe: "select" },
      [
        el("option", { value: "", texto: "Todos os insumos" }),
        ...insumos.map((i) => el("option", { value: i.id, texto: i.nome })),
      ],
    );
    const seletorTipo = el(
      "select",
      { classe: "select" },
      [
        el("option", { value: "", texto: "Todos os tipos" }),
        ...Object.entries(NOME_DO_TIPO).map(([v, r]) => el("option", { value: v, texto: r })),
      ],
    );
    const area = el("div");
    seletorInsumo.addEventListener("change", buscar);
    seletorTipo.addEventListener("change", buscar);

    limpar(conteudo).append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cartao" }, [
          el("h2", { texto: "Movimentação do estoque" }),
          el("p", { classe: "muted", texto: "Tudo que entrou, saiu, quebrou e ajustou, do mais novo para o mais velho. A posição diz onde o dinheiro está; aqui é por onde ele passou." }),
        ]),
        el("div", { classe: "linha-campos" }, [
          el("label", { classe: "campo-rotulado", style: "min-width:220px" }, [el("span", { texto: "Insumo" }), seletorInsumo]),
          el("label", { classe: "campo-rotulado", style: "min-width:180px" }, [el("span", { texto: "Tipo" }), seletorTipo]),
        ]),
        area,
      ]),
    );
    await buscar();

    async function buscar() {
      limpar(area).append(el("p", { classe: "muted", texto: "Buscando…" }));
      let movimentos;
      try {
        const filtros = new URLSearchParams();
        if (seletorInsumo.value) filtros.set("insumo", seletorInsumo.value);
        if (seletorTipo.value) filtros.set("tipo", seletorTipo.value);
        movimentos = await get(`/v1/venues/${ctx.venue}/estoque/movimentos?${filtros}`);
      } catch (e) {
        limpar(area).append(vazio("Movimentação indisponível", e.message));
        return;
      }
      limpar(area);
      if (movimentos.length === 0) {
        area.append(vazio("Nenhum movimento", "Mude os filtros, ou receba uma compra."));
        return;
      }
      area.append(
        el("div", { classe: "cartao" }, [
          el("div", { classe: "rolagem-x" }, [
            el("table", { classe: "planilha" }, [
              el("thead", {}, [
                el("tr", {}, [
                  el("th", { texto: "Quando" }),
                  el("th", { texto: "Tipo" }),
                  el("th", { texto: "Insumo" }),
                  el("th", { texto: "Estoque" }),
                  el("th", { classe: "col-num", texto: "Quantidade" }),
                  el("th", { classe: "col-num", texto: "Valor" }),
                  el("th", { texto: "Observação" }),
                ]),
              ]),
              el(
                "tbody",
                {},
                movimentos.map((m) =>
                  el("tr", {}, [
                    el("td", { texto: dataHora(m.criado_em) }),
                    el("td", {}, [etiqueta(NOME_DO_TIPO[m.tipo] ?? m.tipo, m.quantidade < 0 ? "etiqueta-perigo" : "etiqueta-ok")]),
                    el("td", {}, [el("strong", { texto: m.insumo })]),
                    el("td", { texto: m.local }),
                    el("td", {
                      classe: "col-num",
                      texto: `${m.quantidade > 0 ? "+" : ""}${m.quantidade} ${m.unidade}`,
                    }),
                    el("td", { classe: "col-num", texto: m.valor ? dinheiro(m.valor) : "—" }),
                    // A observação quebra o nowrap: é onde mora o "contado 88,
                    // sistema 90" que explica o movimento.
                    el("td", { style: "white-space:normal;max-width:32ch" }, [
                      el("span", { classe: "muted", texto: m.observacao ?? "" }),
                    ]),
                  ]),
                ),
              ),
            ]),
          ]),
        ]),
      );
    }
  }

  // ============ Aba 2: a conta corrente de UM produto ============

  async function desenharProduto() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));

    let insumos;
    try {
      insumos = await get(`/v1/venues/${ctx.venue}/insumos`);
    } catch (e) {
      limpar(conteudo).append(vazio("Kardex indisponível", e.message));
      return;
    }

    const area = el("div");
    limpar(conteudo).append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cartao" }, [
          el("h2", { texto: "Kardex do produto" }),
          el("p", { classe: "muted", texto: "A conta corrente de um insumo: cada entrada e saída, com o saldo depois de cada uma." }),
        ]),
        el("label", { classe: "campo-rotulado" }, [
          el("span", { texto: "Produto" }),
          buscador(
            insumos.map((i) => ({ rotulo: i.nome, valor: i })),
            {
              placeholder: "🔍  Digite o nome do produto…",
              aoEscolher: (o) => extratoDoProduto(o.valor.id, o.valor.nome),
            },
          ),
        ]),
        area,
      ]),
    );

    // Veio do botão Kardex da posição de estoque? Abre direto naquele item.
    if (atalho?.aba === "produto" && atalho.id) {
      const { id, nome } = atalho;
      atalho = null;
      await extratoDoProduto(id, nome ?? insumos.find((i) => i.id === id)?.nome ?? "");
    } else {
      area.append(el("p", { classe: "muted", texto: "Escolha um produto para abrir a conta corrente dele." }));
    }

    async function extratoDoProduto(insumoId, nome) {
      limpar(area).append(el("p", { classe: "muted", texto: "Abrindo o extrato…" }));
      let movimentos;
      try {
        movimentos = await get(`/v1/venues/${ctx.venue}/estoque/extrato/${insumoId}`);
      } catch (e) {
        limpar(area).append(vazio("Extrato indisponível", e.message));
        return;
      }
      limpar(area).append(
        el("div", { classe: "cartao" }, [
          el("h3", { texto: `Kardex — ${nome}` }),
          movimentos.length === 0
            ? el("p", { classe: "muted", style: "margin-top:8px", texto: "Nenhum movimento deste produto ainda." })
            : el("div", { classe: "rolagem-x", style: "margin-top:10px" }, [
                el("table", { classe: "planilha" }, [
                  el("thead", {}, [
                    el("tr", {}, [
                      el("th", { texto: "Quando" }),
                      el("th", { texto: "Movimento" }),
                      el("th", { texto: "Estoque" }),
                      el("th", { classe: "col-num", texto: "Entrada/Saída" }),
                      el("th", { classe: "col-num", texto: "Saldo após" }),
                      el("th", { texto: "Observação" }),
                    ]),
                  ]),
                  el(
                    "tbody",
                    {},
                    movimentos.map((m) =>
                      el("tr", {}, [
                        el("td", { texto: dataHora(m.criado_em) }),
                        el("td", { texto: NOME_DO_TIPO[m.tipo] ?? m.tipo }),
                        el("td", { texto: m.local_nome }),
                        el("td", { classe: "col-num" }, [
                          el("strong", {
                            style: Number(m.quantidade) < 0 ? "color:var(--marca-forte)" : "",
                            texto: `${Number(m.quantidade) > 0 ? "+" : ""}${m.quantidade}`,
                          }),
                        ]),
                        el("td", { classe: "col-num", texto: String(m.saldo_apos ?? "—") }),
                        el("td", { style: "white-space:normal;max-width:32ch" }, [
                          el("span", { classe: "muted", texto: m.observacao ?? "" }),
                        ]),
                      ]),
                    ),
                  ),
                ]),
              ]),
        ]),
      );
    }
  }

  // ============ Aba 3: a conta corrente de UM fornecedor ============

  async function desenharFornecedor() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));

    let fornecedores;
    try {
      fornecedores = await get(`/v1/venues/${ctx.venue}/fornecedores`);
    } catch (e) {
      limpar(conteudo).append(vazio("Kardex indisponível", e.message));
      return;
    }

    const area = el("div");
    limpar(conteudo).append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cartao" }, [
          el("h2", { texto: "Kardex do fornecedor" }),
          el("p", { classe: "muted", texto: "As compras dele, o acumulado — e o preço que mais subiu, para levar na conversa." }),
        ]),
        el("label", { classe: "campo-rotulado" }, [
          el("span", { texto: "Fornecedor" }),
          buscador(
            fornecedores.map((f) => ({ rotulo: f.nome, valor: f })),
            {
              placeholder: "🔍  Digite o nome do fornecedor…",
              aoEscolher: (o) => contaDoFornecedor(o.valor.id, o.valor.nome),
            },
          ),
        ]),
        area,
      ]),
    );

    if (atalho?.aba === "fornecedor" && atalho.id) {
      const { id, nome } = atalho;
      atalho = null;
      await contaDoFornecedor(id, nome ?? fornecedores.find((f) => f.id === id)?.nome ?? "");
    } else if (fornecedores.length === 0) {
      area.append(el("p", { classe: "muted", texto: "Cadastre um fornecedor em Cadastros e o kardex dele nasce aqui." }));
    } else {
      area.append(el("p", { classe: "muted", texto: "Escolha um fornecedor para abrir a conta corrente dele." }));
    }

    async function contaDoFornecedor(fornecedorId, nome) {
      limpar(area).append(el("p", { classe: "muted", texto: "Montando o kardex…" }));
      let k;
      try {
        k = await get(`/v1/venues/${ctx.venue}/fornecedores/${fornecedorId}/kardex`);
      } catch (e) {
        limpar(area).append(vazio("Kardex indisponível", e.message));
        return;
      }

      limpar(area).append(
        el("div", { classe: "pilha" }, [
          el("div", { classe: "cartao" }, [
            el("div", { classe: "cabecalho-secao" }, [
              el("div", {}, [
                el("h3", { texto: `Kardex — ${k.fornecedor ?? nome}` }),
                el("p", { classe: "muted", texto: `${k.compras.length} compra(s) recebida(s)` }),
              ]),
              el("strong", { style: "font-size:1.3rem", texto: dinheiro(k.total_geral) }),
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
                          // compra é o que se faz em Compras; aqui a leitura é
                          // corrida.
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
        ].filter(Boolean)),
      );
    }
  }
}
