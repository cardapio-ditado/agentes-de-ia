import { del, get, patch, post, postArquivo } from "../api.js";
import { avisar, buscador, dataHora, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Importação de vendas: o relatório do PDV baixa o estoque.
 *
 * Três passos, sempre: mandar o arquivo, conferir o que a IA entendeu,
 * baixar. A conferência no meio não é burocracia — é a única chance de ver
 * o que ela leu antes de o estoque mexer, e um erro que passa aqui só
 * aparece na contagem do mês seguinte.
 *
 * O que não casou NÃO trava a importação: fica visível como "sem receita",
 * e a tela diz a verdade — "82% das vendas vão baixar" vale mais que 100%
 * com 18% de chute.
 */

const SITUACAO = {
  revisao: ["conferir", "etiqueta-alerta"],
  baixada: ["baixada", "etiqueta-ok"],
  descartada: ["descartada", ""],
};

const COMO = {
  codigo: "pelo código",
  apelido: "já aprendido",
  nome_exato: "nome igual",
  nome_parecido: "parecido — confira",
  humano: "você escolheu",
  nenhum: "não achei",
};

function dataCurta(iso) {
  return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
}

export async function vendas(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let lista;
    try {
      lista = await get(`/v1/venues/${ctx.venue}/vendas`);
    } catch (e) {
      limpar(conteudo).append(vazio("Vendas indisponíveis", e.message));
      return;
    }
    limpar(conteudo);

    const arquivo = el("input", {
      type: "file",
      accept: ".csv,.txt,.xlsx,.xls,.pdf,image/*",
      classe: "campo",
    });
    const dataPadrao = el("input", {
      classe: "campo",
      type: "date",
      value: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    });

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", {}, [
          el("h2", { texto: "Vendas" }),
          el("p", { classe: "muted", texto: "Mande o relatório do seu sistema; a IA lê e baixa o estoque pelas fichas." }),
        ]),

        el("div", { classe: "cartao pilha" }, [
          el("h3", { texto: "Importar relatório" }),
          el("p", { classe: "muted", texto: "Serve CSV, Excel, PDF ou uma foto do relatório — de qualquer sistema." }),
          el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Arquivo" }), arquivo]),
          el("label", { classe: "campo-rotulado" }, [
            el("span", { texto: "Dia das vendas" }),
            dataPadrao,
            el("small", { classe: "muted", texto: "Usado só nas linhas em que o relatório não disser a data." }),
          ]),
          el("button", {
            classe: "btn btn-primario btn-grande",
            type: "button",
            texto: "✨ Ler e conferir",
            onclick: (ev) => enviar(ev.target),
          }),
        ]),

        el("div", { classe: "pilha" }, [
          el("h3", { texto: "Importações" }),
          lista.length === 0
            ? vazio("Nenhuma importação ainda", "A primeira leva alguns minutos; da terceira em diante é um toque.")
            : el("div", { classe: "rolagem-x" }, [
                el("table", { classe: "planilha" }, [
                  el("thead", {}, [
                    el("tr", {}, [
                      el("th", { texto: "Arquivo" }),
                      el("th", { texto: "Período" }),
                      el("th", { texto: "Enviado" }),
                      el("th", { texto: "Situação" }),
                      el("th", { texto: "" }),
                    ]),
                  ]),
                  el("tbody", {}, lista.map(linhaImportacao)),
                ]),
              ]),
        ]),
      ]),
    );

    function linhaImportacao(i) {
      const [rotulo, variante] = SITUACAO[i.status] ?? [i.status, ""];
      return el("tr", {}, [
        el("td", {}, [
          el("strong", { texto: i.arquivo_nome || "relatório" }),
          el("small", { classe: "muted", texto: i.origem === "foto" ? " foto" : "" }),
        ]),
        el("td", {
          texto:
            i.periodo_inicio === i.periodo_fim
              ? dataCurta(i.periodo_inicio)
              : `${dataCurta(i.periodo_inicio)} a ${dataCurta(i.periodo_fim)}`,
        }),
        el("td", { texto: dataHora(i.criado_em) }),
        el("td", {}, [etiqueta(rotulo, variante)]),
        el("td", { classe: "col-acoes" }, [
          el("button", {
            classe: "btn-icone",
            type: "button",
            title: i.status === "baixada" ? "Ver o que foi baixado" : "Conferir e baixar",
            texto: "👁",
            onclick: () => revisar(i.id),
          }),
        ]),
      ]);
    }

    async function enviar(botao) {
      const f = arquivo.files?.[0];
      if (!f) return avisar("Escolha o arquivo do relatório.", "erro");
      botao.disabled = true;
      botao.textContent = "Lendo o relatório…";
      try {
        const tipo = f.type || tipoPeloNome(f.name);
        const r = await postArquivo(
          `/v1/venues/${ctx.venue}/vendas/importar?media_type=${encodeURIComponent(tipo)}` +
            `&nome=${encodeURIComponent(f.name)}&data=${dataPadrao.value}`,
          f,
        );
        avisar(`${r.total} produto(s) lido(s), ${r.casados} casaram sozinhos.`, "ok");
        revisar(r.importacaoId);
      } catch (e) {
        avisar(e.message, "erro");
        botao.disabled = false;
        botao.textContent = "✨ Ler e conferir";
      }
    }
  }

  /** O navegador nem sempre preenche o tipo de .csv e .xlsx — deduz pelo nome. */
  function tipoPeloNome(nome) {
    const n = nome.toLowerCase();
    if (n.endsWith(".csv")) return "text/csv";
    if (n.endsWith(".txt")) return "text/plain";
    if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (n.endsWith(".xls")) return "application/vnd.ms-excel";
    if (n.endsWith(".pdf")) return "application/pdf";
    return "application/octet-stream";
  }

  /* ---------- conferência ---------- */

  async function revisar(importacaoId) {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Abrindo a conferência…" }));
    let imp, fichas, insumos;
    try {
      [imp, fichas, insumos] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/vendas/${importacaoId}`),
        get(`/v1/venues/${ctx.venue}/fichas`),
        get(`/v1/venues/${ctx.venue}/insumos`),
      ]);
    } catch (e) {
      limpar(conteudo).append(vazio("Conferência indisponível", e.message));
      return;
    }
    limpar(conteudo);

    const jaBaixada = imp.status === "baixada";
    const pendentes = imp.itens.filter((i) => i.status === "pendente");
    const mapeados = imp.itens.filter((i) => i.status === "mapeado" || i.status === "baixado");

    const corpoTabela = el("tbody", {});
    const desenharLinhas = () => {
      limpar(corpoTabela);
      for (const it of imp.itens) corpoTabela.append(linhaItem(it));
    };

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: imp.arquivo_nome || "Relatório" }),
            el("p", {
              classe: "muted",
              texto: `${imp.itens.length} produto(s) · ${
                imp.periodo_inicio === imp.periodo_fim
                  ? dataCurta(imp.periodo_inicio)
                  : `${dataCurta(imp.periodo_inicio)} a ${dataCurta(imp.periodo_fim)}`
              }`,
            }),
          ]),
          el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
        ]),

        // A verdade sobre a cobertura, à vista: 82% baixando é honesto; 100%
        // com 18% de chute é o que faz o dono parar de confiar no número.
        el("div", { classe: "cartao", style: "text-align:center;padding:20px" }, [
          el("p", { style: "font-size:2.4rem;font-weight:800;margin:0", texto: `${imp.cobertura}%` }),
          el("p", { classe: "muted", texto: jaBaixada ? "das vendas baixaram o estoque" : "das vendas vão baixar o estoque" }),
          pendentes.length > 0
            ? el("p", {
                classe: "muted",
                texto: `${pendentes.length} produto(s) sem receita ligada — eles não baixam nada até você apontar o que são.`,
              })
            : null,
        ].filter(Boolean)),

        ...(imp.extracao_ia?.avisos ?? []).map((a) => el("p", { classe: "aviso aviso-alerta", texto: a })),

        el("div", { classe: "rolagem-x" }, [
          el("table", { classe: "planilha" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { texto: "Produto no relatório" }),
                el("th", { classe: "col-num", texto: "Qtd" }),
                el("th", { texto: "Dia" }),
                el("th", { texto: "Baixa de" }),
                el("th", { texto: "" }),
              ]),
            ]),
            corpoTabela,
          ]),
        ]),

        jaBaixada
          ? el("p", { classe: "aviso aviso-alerta", texto: `Baixada em ${dataHora(imp.baixada_em)}. O estoque já mexeu — isto aqui é só o registro.` })
          : el("div", { classe: "cartao cartao-total" }, [
              el("div", { classe: "cabecalho-secao" }, [
                el("span", { texto: "Vão baixar o estoque" }),
                el("strong", { texto: `${mapeados.length} de ${imp.itens.length}` }),
              ]),
              el("button", {
                classe: "btn btn-primario btn-grande",
                type: "button",
                texto: "Baixar do estoque",
                onclick: async (ev) => {
                  if (mapeados.length === 0) return avisar("Nenhuma linha está pronta para baixar.", "erro");
                  if (
                    !confirm(
                      `Baixar ${mapeados.length} venda(s) do estoque?\n\n` +
                        (pendentes.length > 0
                          ? `${pendentes.length} produto(s) sem receita NÃO vão baixar.\n\n`
                          : "") +
                        "Isto mexe no saldo e não se desfaz.",
                    )
                  ) return;
                  ev.target.disabled = true;
                  ev.target.textContent = "Baixando…";
                  try {
                    const r = await post(`/v1/venues/${ctx.venue}/vendas/${imp.id}/baixar`, {});
                    avisar(`${r.itens} venda(s) baixaram — ${r.movimentos} movimento(s) no estoque.`, "ok");
                    revisar(imp.id);
                  } catch (e) {
                    avisar(e.message, "erro");
                    ev.target.disabled = false;
                    ev.target.textContent = "Baixar do estoque";
                  }
                },
              }),
              el("button", {
                classe: "btn btn-peq",
                type: "button",
                texto: "🗑 Descartar importação",
                onclick: async () => {
                  if (!confirm("Descartar esta importação? Nada foi baixado ainda; o arquivo pode ser reenviado depois.")) return;
                  try {
                    await del(`/v1/venues/${ctx.venue}/vendas/${imp.id}`);
                    avisar("Importação descartada.", "ok");
                    desenhar();
                  } catch (e) {
                    avisar(e.message, "erro");
                  }
                },
              }),
            ]),
      ].filter(Boolean)),
    );
    desenharLinhas();

    function linhaItem(it) {
      const pendente = it.status === "pendente";
      const ignorado = it.status === "ignorado";
      const sugestao = pendente && it.alvo_nome;

      const alvo = ignorado
        ? el("span", { classe: "muted", texto: "não é venda de estoque" })
        : it.alvo_nome
          ? el("span", {}, [
              el("strong", { texto: it.alvo_nome }),
              el("small", { classe: "muted", texto: ` ${COMO[it.como] ?? it.como ?? ""}` }),
              it.impedimento === "ficha_nao_confirmada"
                ? etiqueta("ficha não conferida", "etiqueta-perigo")
                : null,
            ].filter(Boolean))
          : el("span", { classe: "muted", texto: "— sem receita ligada" });

      return el("tr", { classe: pendente ? "linha-atencao" : "" }, [
        el("td", {}, [
          el("strong", { texto: it.produto_externo }),
          it.codigo_externo ? el("small", { classe: "muted", texto: ` cód ${it.codigo_externo}` }) : null,
        ].filter(Boolean)),
        el("td", { classe: "col-num", texto: String(Number(it.quantidade)) }),
        el("td", { texto: dataCurta(it.data_venda) }),
        el("td", {}, [alvo]),
        el("td", { classe: "col-acoes" },
          jaBaixada
            ? []
            : [
                sugestao
                  ? el("button", {
                      classe: "btn btn-peq",
                      type: "button",
                      texto: "✓ É isso",
                      onclick: () => aceitar(it),
                    })
                  : null,
                el("button", {
                  classe: "btn-icone",
                  type: "button",
                  title: "Apontar o que este produto baixa",
                  texto: "✏️",
                  onclick: () => escolherAlvo(it),
                }),
                pendente
                  ? el("button", {
                      classe: "btn-icone",
                      type: "button",
                      title: "Não baixa estoque (couvert, taxa, serviço)",
                      texto: "✕",
                      onclick: () => ignorar(it),
                    })
                  : null,
              ].filter(Boolean),
        ),
      ]);
    }

    async function aceitar(it) {
      await salvarAlvo(it, it.ficha_id, it.insumo_id);
    }

    async function ignorar(it) {
      try {
        await patch(`/v1/venues/${ctx.venue}/vendas/itens/${it.id}`, { ignorar: true });
        revisar(imp.id);
      } catch (e) {
        avisar(e.message, "erro");
      }
    }

    async function salvarAlvo(it, fichaId, insumoId) {
      try {
        await patch(`/v1/venues/${ctx.venue}/vendas/itens/${it.id}`, {
          ficha_id: fichaId ?? null,
          insumo_id: insumoId ?? null,
        });
        avisar(`Aprendido: "${it.produto_externo}" já entra sozinho na próxima.`, "ok");
        revisar(imp.id);
      } catch (e) {
        avisar(e.message, "erro");
      }
    }

    /**
     * A escolha do que o produto baixa: uma ficha (prato) ou um insumo
     * (venda direta). Corrigir aqui ENSINA — e o mesmo produto nas outras
     * linhas do relatório é resolvido junto.
     */
    function escolherAlvo(it) {
      limpar(conteudo);
      const opcoes = [
        ...fichas
          .filter((f) => f.confirmada_em)
          .map((f) => ({ rotulo: `🍽 ${f.nome}`, valor: { fichaId: f.id, insumoId: null } })),
        ...insumos.map((i) => ({
          rotulo: `📦 ${i.nome} (${i.unidade})`,
          valor: { fichaId: null, insumoId: i.id },
        })),
      ];
      const naoConferidas = fichas.filter((f) => !f.confirmada_em).length;

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: it.produto_externo }),
              el("p", { classe: "muted", texto: "O que este produto tira do estoque?" }),
            ]),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: () => revisar(imp.id) }),
          ]),
          el("div", { classe: "cartao pilha" }, [
            el("p", { classe: "muted", texto: "🍽 prato: saem os insumos da ficha. 📦 item: sai ele mesmo (bebida, garrafa)." }),
            buscador(opcoes, {
              placeholder: "🔍  Buscar ficha ou item…",
              aoEscolher: (o) => salvarAlvo(it, o.valor.fichaId, o.valor.insumoId),
            }),
            naoConferidas > 0
              ? el("p", {
                  classe: "muted",
                  texto: `${naoConferidas} ficha(s) não aparecem aqui porque ainda não foram conferidas — ficha não conferida não baixa estoque.`,
                })
              : null,
            el("p", { classe: "muted", texto: "Escolhendo uma vez, o sistema aprende: nas próximas importações este nome entra sozinho." }),
          ].filter(Boolean)),
        ]),
      );
    }
  }
}
