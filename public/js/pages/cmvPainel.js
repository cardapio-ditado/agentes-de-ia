import { get, post, put } from "../api.js";
import { avisar, dinheiro, el, limpar, vazio } from "../ui.js";

/**
 * O painel do CMV — o número que justifica o módulo inteiro.
 *
 * O percentual é o protagonista, grande no topo: "CMV de 32%" é o que o dono
 * compara com o mês passado e com o vizinho. Os componentes (estoque
 * inicial, compras, estoque final, faturamento) vêm abaixo, porque é neles
 * que se confere quando o percentual assusta.
 *
 * O lançamento do faturamento mora AQUI, e não numa tela própria: sem
 * denominador não há percentual, e a tela que mostra o buraco é a melhor
 * hora para tapá-lo.
 */

export async function cmvPainel(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);
  const cartaoAvisos = el("div");
  raiz.append(cartaoAvisos);
  void desenharAvisos(ctx, cartaoAvisos);
  const cartaoConciliacao = el("div");
  raiz.append(cartaoConciliacao);
  void desenharConciliacao(ctx, cartaoConciliacao);

  const hoje = new Date();
  const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const paraIso = (d) => d.toISOString().slice(0, 10);

  let inicio = paraIso(primeiroDia);
  let fim = paraIso(hoje);

  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Calculando…" }));
    let dados;
    let consumo = [];
    try {
      dados = await get(`/v1/venues/${ctx.venue}/cmv?inicio=${inicio}&fim=${fim}`);
      // O comparativo é bônus: se a casa ainda não importa vendas, ele vem
      // vazio e a tela segue inteira.
      consumo = await get(`/v1/venues/${ctx.venue}/consumo?inicio=${inicio}&fim=${fim}`).catch(() => []);
    } catch (e) {
      limpar(conteudo).append(vazio("CMV indisponível", e.message));
      return;
    }
    limpar(conteudo);

    const p = dados.periodo ?? {};
    const percentual = p.cmv_percentual;

    const campoInicio = el("input", { classe: "campo", type: "date", value: inicio });
    const campoFim = el("input", { classe: "campo", type: "date", value: fim });
    const aplicar = () => {
      inicio = campoInicio.value;
      fim = campoFim.value;
      desenhar();
    };
    campoInicio.addEventListener("change", aplicar);
    campoFim.addEventListener("change", aplicar);

    const linhaDado = (rotulo, valor, ajuda) =>
      el("div", { classe: "cabecalho-secao" }, [
        el("span", {}, [
          el("span", { texto: rotulo }),
          ajuda ? el("small", { classe: "muted", texto: ` ${ajuda}` }) : null,
        ].filter(Boolean)),
        el("strong", { texto: valor }),
      ]);

    // O formulário de faturamento: a data de ontem por padrão, porque o
    // fechamento de um dia se lança na manhã seguinte.
    const ontem = new Date(hoje);
    ontem.setDate(ontem.getDate() - 1);
    const dataFat = el("input", { classe: "campo", type: "date", value: paraIso(ontem) });
    const valorFat = el("input", {
      classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.01", min: "0",
      placeholder: "0,00",
    });

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "linha-campos" }, [
          el("label", { classe: "campo-rotulado", style: "flex:1" }, [el("span", { texto: "De" }), campoInicio]),
          el("label", { classe: "campo-rotulado", style: "flex:1" }, [el("span", { texto: "Até" }), campoFim]),
        ]),

        // O número. Grande, e honesto: sem faturamento não há percentual, e
        // a tela diz o que falta em vez de mostrar um zero mentiroso.
        el("div", { classe: "cartao", style: "text-align:center;padding:28px 16px" }, [
          percentual !== null && percentual !== undefined
            ? el("div", {}, [
                el("p", { style: "font-size:3rem;font-weight:800;margin:0", texto: `${Number(percentual).toFixed(1)}%` }),
                el("p", { classe: "muted", texto: "CMV do período" }),
                el("p", {
                  classe: "muted",
                  texto:
                    Number(percentual) <= 32
                      ? "Dentro do saudável para bares (28–34%)."
                      : Number(percentual) <= 38
                        ? "Um pouco alto — vale olhar compras e quebra."
                        : "Alto. Confira as fichas, a quebra da contagem e os preços de compra.",
                }),
              ])
            : el("div", {}, [
                el("p", { style: "font-size:1.5rem;font-weight:700;margin:0", texto: "Sem faturamento no período" }),
                el("p", { classe: "muted", texto: "Lance o faturamento abaixo — sem ele o percentual não existe." }),
              ]),
        ]),

        el("div", { classe: "cartao" }, [
          el("h3", { texto: "A conta, aberta" }),
          linhaDado("Estoque inicial", dinheiro(Number(p.estoque_inicial ?? 0))),
          linhaDado("+ Compras", dinheiro(Number(p.compras ?? 0))),
          linhaDado("− Estoque final", dinheiro(Number(p.estoque_final ?? 0))),
          linhaDado("= CMV", dinheiro(Number(p.cmv ?? 0)), "o que foi consumido, em reais"),
          linhaDado("÷ Faturamento", dinheiro(Number(p.faturamento ?? 0)), "líquido, sem gorjeta"),
        ]),

        el("div", { classe: "cartao" }, [
          el("h3", { texto: "Lançar faturamento do dia" }),
          el("p", { classe: "muted", texto: "Valor líquido, sem gorjeta e sem taxa de serviço. Relançar corrige — não soma." }),
          el("div", { classe: "linha-campos" }, [
            el("label", { classe: "campo-rotulado", style: "flex:1" }, [el("span", { texto: "Dia" }), dataFat]),
            el("label", { classe: "campo-rotulado", style: "flex:1" }, [el("span", { texto: "Valor (R$)" }), valorFat]),
          ]),
          el("button", {
            classe: "btn btn-primario btn-grande",
            type: "button",
            texto: "Lançar",
            onclick: async (ev) => {
              if (valorFat.value === "") return avisar("Informe o valor do dia.", "erro");
              ev.target.disabled = true;
              try {
                await post(`/v1/venues/${ctx.venue}/faturamento`, {
                  data: dataFat.value,
                  valor: Number(valorFat.value),
                });
                avisar("Faturamento lançado.", "ok");
                desenhar();
              } catch (e) {
                avisar(e.message, "erro");
                ev.target.disabled = false;
              }
            },
          }),
        ]),

        // Teórico × real: o número que só existe quando a venda baixa por
        // ficha. As receitas dizem que os pratos vendidos consumiram tanto;
        // a contagem diz que sumiu tanto. A diferença tem nome, item a item.
        consumo.filter((c) => Math.abs(Number(c.diferenca_valor)) >= 1).length > 0
          ? el("div", { classe: "cartao pilha" }, [
              el("h3", { texto: "Onde o dinheiro está escapando" }),
              el("p", {
                classe: "muted",
                texto: "As fichas dizem quanto os pratos vendidos consumiram; o estoque diz quanto sumiu. A diferença é quebra, porção passada do ponto, ficha desatualizada ou desvio.",
              }),
              el("div", { classe: "rolagem-x" }, [
                el("table", { classe: "planilha" }, [
                  el("thead", {}, [
                    el("tr", {}, [
                      el("th", { texto: "Item" }),
                      el("th", { classe: "col-num", texto: "Fichas dizem" }),
                      el("th", { classe: "col-num", texto: "Sumiu" }),
                      el("th", { classe: "col-num", texto: "Diferença" }),
                      el("th", { classe: "col-num", texto: "Em reais" }),
                    ]),
                  ]),
                  el("tbody", {},
                    consumo
                      .filter((c) => Math.abs(Number(c.diferenca_valor)) >= 1)
                      .slice(0, 15)
                      .map((c) =>
                        el("tr", { classe: Number(c.diferenca_valor) > 0 ? "linha-atencao" : "" }, [
                          el("td", { texto: c.insumo }),
                          el("td", { classe: "col-num", texto: `${Number(c.teorico)} ${c.unidade}` }),
                          el("td", { classe: "col-num", texto: `${Number(c.real_consumido)} ${c.unidade}` }),
                          el("td", { classe: "col-num", texto: `${Number(c.diferenca) > 0 ? "+" : ""}${Number(c.diferenca)}` }),
                          el("td", { classe: "col-num" }, [
                            el("strong", { texto: dinheiro(Number(c.diferenca_valor)) }),
                          ]),
                        ]),
                      ),
                  ),
                ]),
              ]),
            ])
          : null,

        dados.faturamentos.length > 0
          ? el("div", { classe: "cartao" }, [
              el("h3", { texto: "Faturamento lançado no período" }),
              ...dados.faturamentos.map((f) =>
                el("div", { classe: "cabecalho-secao" }, [
                  el("span", { texto: f.data_referencia.split("-").reverse().join("/") }),
                  el("strong", { texto: dinheiro(Number(f.valor)) }),
                ]),
              ),
            ])
          : null,
      ].filter(Boolean)),
    );
  }
}


/**
 * Os avisos do CMV: quem recebe e a partir de quanto cada coisa vira
 * mensagem no WhatsApp.
 *
 * Fica no fim do painel, num cartão recolhido, porque se configura uma vez e
 * nunca mais — o mesmo racional do cartão de avisos das reservas.
 */
async function desenharAvisos(ctx, raiz) {
  let config;
  try {
    config = await get(`/v1/venues/${ctx.venue}/cmv/avisos`);
  } catch {
    return; // Sem a rota (versão antiga no ar), o painel segue sem o cartão.
  }

  const detalhes = el("details", { classe: "cartao" });
  const resumo = el("summary", {}, [
    el("strong", { texto: "Avisos no WhatsApp" }),
    el("span", {
      classe: "muted",
      style: "margin-left:8px",
      texto: config.avisar_whatsapp
        ? `ligados para ${config.avisar_whatsapp}`
        : "desligados — ninguém recebe",
    }),
  ]);

  const numero = el("input", {
    value: config.avisar_whatsapp ?? "",
    placeholder: "(65) 99999-8888 — vazio desliga tudo",
  });
  const numeroContagem = el("input", {
    value: config.contagem_whatsapp ?? "",
    placeholder: "vazio = o lembrete vai para o número de cima",
  });
  const pct = el("input", { type: "number", min: "1", max: "100", value: String(config.aumento_preco_pct) });
  const reais = el("input", { type: "number", min: "0", step: "10", value: String(config.divergencia_reais) });
  const estoque = el("input", { type: "checkbox", checked: config.avisar_estoque });
  const lembrete = el("input", { type: "number", min: "0", max: "90", value: String(config.lembrete_contagem_dias ?? 0) });

  const salvar = el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "Salvar avisos" });
  salvar.addEventListener("click", async () => {
    salvar.disabled = true;
    try {
      await put(`/v1/venues/${ctx.venue}/cmv/avisos`, {
        avisar_whatsapp: numero.value.trim(),
        contagem_whatsapp: numeroContagem.value.trim(),
        aumento_preco_pct: Number(pct.value),
        divergencia_reais: Number(reais.value),
        avisar_estoque: estoque.checked,
        lembrete_contagem_dias: Number(lembrete.value),
      });
      avisar("Avisos do CMV salvos.", "ok");
      limpar(raiz);
      await desenharAvisos(ctx, raiz);
    } catch (e) {
      avisar(e.message, "erro");
    } finally {
      salvar.disabled = false;
    }
  });

  detalhes.append(
    resumo,
    el("div", { classe: "pilha", style: "margin-top:12px" }, [
      el("p", {
        classe: "muted",
        texto:
          "Três avisos, direto no WhatsApp: fornecedor que subiu o preço (na hora do recebimento), " +
          "contagem que divergiu do sistema, e insumo que vai faltar (no máximo um aviso por dia).",
      }),
      el("div", { classe: "campo" }, [
        el("label", { texto: "WhatsApp de quem gerencia o estoque (preço, divergência, vai faltar)" }),
        numero,
      ]),
      el("div", { classe: "campo" }, [
        el("label", { texto: "WhatsApp de quem faz a contagem (recebe o lembrete de contar)" }),
        numeroContagem,
      ]),
      el("div", { classe: "linha-campos" }, [
        el("div", { classe: "campo", style: "flex:1" }, [
          el("label", { texto: "Avisar aumento a partir de (%)" }),
          pct,
        ]),
        el("div", { classe: "campo", style: "flex:1" }, [
          el("label", { texto: "Avisar divergência a partir de (R$)" }),
          reais,
        ]),
      ]),
      el("label", { classe: "check-linha" }, [estoque, el("span", { texto: "Avisar quando um insumo for faltar" })]),
      el("div", { classe: "campo", style: "max-width:280px" }, [
        el("label", { texto: "Lembrar de contar a cada (dias) — 0 desliga" }),
        lembrete,
      ]),
      el("p", {
        classe: "muted",
        texto: "O CMV só é honesto com contagem em cadência. O lembrete chega uma vez por atraso — contou, o ciclo zera.",
      }),
      salvar,
    ]),
  );
  raiz.append(detalhes);
}


/**
 * O cache de saldo bate com o razão?
 *
 * Só aparece quando NÃO bate. Um saldo divergente é a tela mentindo em
 * silêncio: a contagem não fecha e ninguém sabe por quê. Aqui ele vira uma
 * lista com nome, e um botão que reescreve o cache a partir do histórico.
 */
async function desenharConciliacao(ctx, raiz) {
  let divergentes = [];
  try {
    divergentes = await get(`/v1/venues/${ctx.venue}/cmv/conciliacao`);
  } catch {
    return; // bônus: se falhar, o painel segue inteiro
  }
  limpar(raiz);
  if (!divergentes.length) return;

  const botao = el("button", {
    classe: "btn btn-primario",
    type: "button",
    texto: `Ressincronizar ${divergentes.length} saldo(s)`,
    onclick: async () => {
      botao.disabled = true;
      try {
        const r = await post(`/v1/venues/${ctx.venue}/cmv/conciliacao/ressincronizar`, {});
        avisar(`${r.divergentes_corrigidos} saldo(s) reescritos a partir do histórico.`, "ok");
        await desenharConciliacao(ctx, raiz);
      } catch (e) {
        avisar(e.message, "erro");
        botao.disabled = false;
      }
    },
  });

  raiz.append(
    el("section", { classe: "cartao alerta", style: "margin-top:14px" }, [
      el("h3", { texto: "Saldo na tela diferente do histórico" }),
      el("p", {
        classe: "muted",
        texto:
          "O saldo mostrado é um atalho; a verdade é o razão de movimentos. Os dois se separaram nestes itens — " +
          "a contagem não vai bater até ressincronizar.",
      }),
      el("div", { classe: "rolagem-x" }, [
        el("table", { classe: "planilha" }, [
          el("thead", {}, [el("tr", {}, [
            el("th", { texto: "Item" }), el("th", { texto: "Local" }),
            el("th", { texto: "Na tela" }), el("th", { texto: "No histórico" }), el("th", { texto: "Diferença" }),
          ])]),
          el("tbody", {}, divergentes.slice(0, 30).map((d) =>
            el("tr", {}, [
              el("td", { texto: d.insumo }),
              el("td", { texto: d.local }),
              el("td", { texto: `${d.saldo_cache} ${d.unidade}` }),
              el("td", { texto: `${d.saldo_historico} ${d.unidade}` }),
              el("td", { texto: `${d.diferenca > 0 ? "+" : ""}${d.diferenca}` }),
            ]),
          )),
        ]),
      ]),
      el("div", { style: "margin-top:10px" }, [botao]),
    ]),
  );
}
