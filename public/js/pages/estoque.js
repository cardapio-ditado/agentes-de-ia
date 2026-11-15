import { del, get, patch, post } from "../api.js";
import { ICONES, acaoIcone, avisar, botaoVoltar, buscador, campoDeBusca, comIcone, dinheiro, el, esqueleto, estadoDeErro, etiqueta, indicador, limpar, tabelaDeDados, vazio } from "../ui.js";
import { abrirKardex } from "./kardex.js";
import { botaoDePdf, imprimirRelatorio } from "../relatorio.js";

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
    limpar(conteudo).append(esqueleto({ cartoes: 3, linhas: 8 }));
    let posicao, locais, insumos;
    try {
      [posicao, locais, insumos] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/estoque/posicao`),
        get(`/v1/venues/${ctx.venue}/estoque-locais`),
        get(`/v1/venues/${ctx.venue}/insumos`),
      ]);
    } catch (e) {
      limpar(conteudo).append(estadoDeErro("Não foi possível carregar o estoque", e.message, desenhar));
      return;
    }
    limpar(conteudo);

    const norm = (t) => (t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    let textoDaBusca = "";
    const numeros = el("div", { classe: "grade" });
    const lista = el("div", {});

    // O filtro por estoque vem dos próprios dados: cada linha da posição já
    // diz de que local é. Um seletor a mais, zero ida ao servidor.
    const nomesDeLocais = [...new Set(posicao.map((p) => p.local_nome))].sort();
    const seletorLocal = el(
      "select",
      { classe: "select", "aria-label": "Local de estoque" },
      [
        el("option", { value: "", texto: "Todos os estoques" }),
        ...nomesDeLocais.map((nome) => el("option", { value: nome, texto: nome })),
      ],
    );
    seletorLocal.addEventListener("change", () => desenharLista());

    /** As linhas que o filtro da tela deixa passar — a tabela, os números e o PDF usam as mesmas. */
    const filtrar = () => {
      const alvo = norm(textoDaBusca.trim());
      const local = seletorLocal.value;
      return posicao.filter((p) => (!local || p.local_nome === local) && (!alvo || norm(p.insumo).includes(alvo)));
    };

    /**
     * Tabela, e não cartão por item.
     *
     * A posição de uma casa de verdade tem dezenas ou centenas de insumos, e
     * cartão gasta uma tela inteira para mostrar oito. Tabela mostra trinta
     * sem rolar — e posição de estoque se LÊ em varredura, comparando linhas,
     * que é exatamente o que coluna alinhada faz e cartão desfaz.
     */
    const desenharLista = () => {
      const filtradas = filtrar();
      const local = seletorLocal.value;

      // Os números acompanham o filtro: com "Câmara fria" escolhida, o valor
      // é o que está parado NA câmara — que é a pergunta de quem filtrou.
      const valorFiltrado = filtradas.reduce((t, p) => t + Number(p.valor), 0);
      const itens = new Set(filtradas.map((p) => p.insumo_id)).size;
      const semSaldo = filtradas.filter((p) => Number(p.quantidade) <= 0).length;
      limpar(numeros).append(
        indicador({
          rotulo: local ? `Parado em ${local}` : "Parado em estoque",
          valor: dinheiro(valorFiltrado),
          nota: "quantidade × custo médio",
          iconePath: ICONES.cifrao,
          cor: "marca",
        }),
        indicador({
          rotulo: "Itens com posição",
          valor: String(itens),
          nota: local ? "neste estoque" : `em ${nomesDeLocais.length} ${nomesDeLocais.length === 1 ? "estoque" : "estoques"}`,
          iconePath: ICONES.caixa,
          cor: "areia",
        }),
        indicador({
          rotulo: "Zerados ou negativos",
          valor: String(semSaldo),
          nota: semSaldo > 0 ? "conferir na contagem" : "nenhum item sem saldo",
          iconePath: ICONES.alerta,
          cor: "musgo",
          tom: semSaldo > 0 ? "alerta" : undefined,
        }),
      );

      limpar(lista);
      if (filtradas.length === 0) {
        const filtrando = Boolean(local || textoDaBusca.trim());
        lista.append(
          filtrando
            ? vazio("Nada com esse filtro", "Mude a busca ou o estoque para ver os outros itens.")
            : vazio("Nada em estoque ainda", "Receba uma compra e a posição aparece aqui."),
        );
        return;
      }

      const mostrarLocal = !local;
      const semSaldoNaLinha = (p) => Number(p.quantidade) <= 0;
      // 18.4 → "18,4": número na tela é no jeito brasileiro.
      const qtd = (p) => `${Number(p.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${p.unidade}`;
      lista.append(
        tabelaDeDados({
          colunas: [
            { rotulo: "Item", principal: true },
            mostrarLocal ? { rotulo: "Estoque", largura: "18%" } : null,
            { rotulo: "Quantidade", num: true, largura: "150px" },
            { rotulo: "Custo médio", num: true, largura: "140px" },
            { rotulo: "Valor", num: true, largura: "150px" },
            { rotulo: "", acoes: true, largura: "64px" },
          ].filter(Boolean),
          linhas: filtradas.map((p) => ({
            // A linha inteira leva ao histórico do produto, já no item certo.
            aoClicar: () => abrirKardex({ aba: "produto", id: p.insumo_id, nome: p.insumo }),
            celulas: [
              p.insumo,
              mostrarLocal ? p.local_nome : undefined,
              semSaldoNaLinha(p) ? el("span", { classe: "erro", style: "font-weight:600", texto: qtd(p) }) : qtd(p),
              dinheiro(Number(p.custo_medio)),
              dinheiro(Number(p.valor)),
              acaoIcone({ iconePath: ICONES.relogio, rotulo: "Ver o histórico do item", aoClicar: () => abrirKardex({ aba: "produto", id: p.insumo_id, nome: p.insumo }) }),
            ].filter((c) => c !== undefined),
          })),
          rodape: [`${filtradas.length} ${filtradas.length === 1 ? "linha" : "linhas"}`, mostrarLocal ? null : undefined, null, null, dinheiro(valorFiltrado), null].filter((c) => c !== undefined),
        }),
      );
    };

    const busca = campoDeBusca({
      rotulo: "Buscar no estoque",
      placeholder: "Buscar item no estoque…",
      atalho: true,
      aoMudar: (texto) => {
        textoDaBusca = texto;
        desenharLista();
      },
    });

    // O PDF sai com o filtro da tela: escolhido "Câmara fria", é a posição
    // da câmara — que é o papel que o gerente quer na mão.
    const posicaoEmPdf = () => {
      const linhas = filtrar();
      const local = seletorLocal.value;
      const total = linhas.reduce((t, p) => t + Number(p.valor), 0);
      imprimirRelatorio({
        tipo: "Custos e estoque",
        titulo: "Posição do estoque",
        periodo: `${local || "Todos os estoques"} · ${new Date().toLocaleDateString("pt-BR")}`,
        selos: [
          { valor: dinheiro(total), rotulo: "parado em estoque" },
          { valor: String(linhas.length), rotulo: "itens" },
        ],
        secoes: [{
          titulo: "Do mais valioso para o menos",
          colunas: [{ rotulo: "Item" }, { rotulo: "Estoque" }, { rotulo: "Quantidade", num: true }, { rotulo: "Custo médio", num: true }, { rotulo: "Valor", num: true }],
          linhas: linhas.map((p) => [p.insumo, p.local_nome, `${p.quantidade} ${p.unidade}`, dinheiro(Number(p.custo_medio)), dinheiro(Number(p.valor))]),
          total: ["Total", "", "", "", dinheiro(total)],
        }],
        arquivo: `estoque-${new Date().toISOString().slice(0, 10)}`,
      });
    };

    // As ações da tela, no cabeçalho: é olhando a posição que a pessoa
    // percebe "isso está no lugar errado" ou "isso venceu".
    ctx.definirAcoes(
      botaoDePdf(posicaoEmPdf, "Posição em PDF"),
      el("button", { classe: "btn", type: "button", onclick: gerenciarLocais }, comIcone(ICONES.local, "Locais")),
      el("button", { classe: "btn", type: "button", onclick: () => movimentar("perda") }, comIcone(ICONES.lixeira, "Registrar perda")),
      el("button", { classe: "btn", type: "button", onclick: () => movimentar("transferir") }, comIcone(ICONES.transferir, "Transferir")),
    );

    conteudo.append(
      el("section", { classe: "pilha" }, [
        numeros,
        el("div", { classe: "barra-filtros" }, [busca, seletorLocal]),
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
      // Etapa interna: as ações da posição saem do cabeçalho.
      ctx.definirAcoes();
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
            botaoVoltar(desenhar),
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
                  acaoIcone({
                    iconePath: ICONES.editar,
                    rotulo: "Renomear este estoque",
                    aoClicar: async () => {
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
      // Etapa interna: as ações da posição saem do cabeçalho.
      ctx.definirAcoes();
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
                  placeholder: "Digite o nome do item…",
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
                // A chave da AÇÃO: nasce quando o botão é apertado pela primeira
                // vez e só troca depois que deu certo. Clique duplo, 4G que
                // caiu no meio, "tentar de novo" — o servidor vê a mesma chave
                // e não move duas vezes.
                ev.target._chave ??= crypto.randomUUID();
                try {
                  if (modo === "transferir") {
                    await post(`/v1/venues/${ctx.venue}/estoque/transferir`, {
                      insumo_id: insumo.id,
                      de_local: deLocal.value,
                      para_local: paraLocal.value,
                      quantidade: Number(qtd.value),
                      chave: ev.target._chave,
                    });
                    avisar("Transferido.", "ok");
                  } else {
                    await post(`/v1/venues/${ctx.venue}/estoque/perda`, {
                      insumo_id: insumo.id,
                      local_id: deLocal.value,
                      quantidade: Number(qtd.value),
                      motivo: motivo.value,
                      chave: ev.target._chave,
                    });
                    avisar("Perda registrada.", "ok");
                  }
                  ev.target._chave = null;
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
