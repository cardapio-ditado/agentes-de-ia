import { get, post } from "../api.js";
import { avisar, buscador, dataHora, dinheiro, el, limpar, vazio } from "../ui.js";

/**
 * Posição do estoque: o que há, onde, e quanto vale.
 *
 * A tela responde três perguntas na ordem em que elas doem:
 *   1. quanto dinheiro está parado em estoque (o total no topo);
 *   2. em que ele está parado (a lista, do mais valioso para o menos);
 *   3. por que o saldo é esse (o extrato, um toque no item).
 *
 * Transferência e perda vivem aqui porque é olhando a posição que a pessoa
 * percebe "isso está no lugar errado" ou "isso venceu" — a ação nasce do
 * olhar, e mudar de tela no meio mata o impulso.
 */

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

    const valorTotal = posicao.reduce((t, p) => t + Number(p.valor), 0);
    const lista = el("div", { classe: "lista" });

    const desenharLista = (filtro = "") => {
      const norm = (t) => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const alvo = norm(filtro.trim());
      const filtradas = alvo ? posicao.filter((p) => norm(p.insumo).includes(alvo)) : posicao;
      limpar(lista);
      if (filtradas.length === 0) {
        lista.append(vazio("Nada em estoque", "Receba uma compra e a posição aparece aqui."));
      }
      for (const p of filtradas) {
        lista.append(
          el("article", { classe: "cartao" }, [
            el("div", { classe: "cabecalho-secao" }, [
              el("div", {}, [
                el("strong", { texto: p.insumo }),
                el("p", { classe: "muted", texto: `${p.quantidade} ${p.unidade} em ${p.local_nome}` }),
              ]),
              el("div", {}, [
                el("strong", { texto: dinheiro(Number(p.valor)) }),
                el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: "Extrato",
                  onclick: () => extrato(p),
                }),
              ]),
            ]),
          ]),
        );
      }
    };

    const busca = el("input", { classe: "campo", placeholder: "🔍  Buscar no estoque…" });
    busca.addEventListener("input", () => desenharLista(busca.value));

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cartao" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: "Posição do estoque" }),
              el("p", { classe: "muted", texto: "Do mais valioso para o menos — é onde o dinheiro está parado." }),
            ]),
            el("strong", { style: "font-size:1.3rem", texto: dinheiro(valorTotal) }),
          ]),
        ]),
        el("div", { classe: "linha-campos" }, [
          el("button", { classe: "btn", type: "button", texto: "⇄ Transferir", onclick: () => movimentar("transferir") }),
          el("button", { classe: "btn", type: "button", texto: "🗑 Registrar perda", onclick: () => movimentar("perda") }),
        ]),
        busca,
        lista,
      ]),
    );
    desenharLista();

    async function extrato(p) {
      limpar(conteudo).append(el("p", { classe: "muted", texto: "Abrindo o extrato…" }));
      let movimentos;
      try {
        movimentos = await get(`/v1/venues/${ctx.venue}/estoque/extrato/${p.insumo_id}`);
      } catch (e) {
        limpar(conteudo).append(vazio("Extrato indisponível", e.message));
        return;
      }
      limpar(conteudo).append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: p.insumo }),
              el("p", { classe: "muted", texto: "Todo movimento, do mais novo para o mais velho. É a resposta de “por que o saldo é esse?”." }),
            ]),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
          ]),
          el("div", { classe: "lista" },
            movimentos.map((m) =>
              el("div", { classe: "cabecalho-secao cartao" }, [
                el("div", {}, [
                  el("strong", { texto: NOME_DO_TIPO[m.tipo] ?? m.tipo }),
                  el("p", { classe: "muted", texto: `${dataHora(m.criado_em)} · ${m.local_nome}${m.observacao ? ` · ${m.observacao}` : ""}` }),
                ]),
                el("strong", {
                  style: Number(m.quantidade) < 0 ? "color:var(--marca-forte)" : "color:var(--verde, #14532d)",
                  texto: `${Number(m.quantidade) > 0 ? "+" : ""}${m.quantidade}`,
                }),
              ]),
            ),
          ),
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
