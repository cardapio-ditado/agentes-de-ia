import { get, post } from "../api.js";
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

  const hoje = new Date();
  const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const paraIso = (d) => d.toISOString().slice(0, 10);

  let inicio = paraIso(primeiroDia);
  let fim = paraIso(hoje);

  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Calculando…" }));
    let dados;
    try {
      dados = await get(`/v1/venues/${ctx.venue}/cmv?inicio=${inicio}&fim=${fim}`);
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
