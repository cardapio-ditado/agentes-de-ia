import { get, post } from "../api.js";
import { avisar, dataHora, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Contagem de estoque.
 *
 * Quem conta está DENTRO do estoque, de pé, com o celular numa mão e a outra
 * mexendo em caixa. E a tela é de contagem CEGA de propósito: o saldo do
 * sistema não aparece enquanto se conta. Mostrar o número induz a confirmar
 * em vez de contar — e contagem que confirma o sistema não acha desvio
 * nenhum, que é exatamente o que ela existe para achar.
 *
 * Item não preenchido fica DE FORA e permanece como está. Não contado não é
 * zero: zerar o que ninguém olhou transformaria toda contagem parcial num
 * massacre de saldos. Contar só a prateleira de bebidas hoje é uso legítimo.
 */

export async function contagem(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);

  let locais = [];
  let insumos = [];
  let historico = [];
  try {
    [locais, insumos, historico] = await Promise.all([
      get(`/v1/venues/${ctx.venue}/estoque-locais`),
      get(`/v1/venues/${ctx.venue}/insumos`),
      get(`/v1/venues/${ctx.venue}/contagens`),
    ]);
  } catch (e) {
    conteudo.append(vazio("Contagem indisponível", e.message));
    return;
  }

  if (locais.length === 0 || insumos.length === 0) {
    conteudo.append(
      vazio("Nada para contar ainda", "Cadastre locais e insumos em “Insumos e estoques”."),
    );
    return;
  }

  desenharAbertura();

  function desenharAbertura() {
    limpar(conteudo);

    const seletorLocal = el(
      "select",
      { classe: "select" },
      locais.map((l) => el("option", { value: l.id, texto: l.nome, selected: l.principal })),
    );

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Contagem de estoque" }),
            el("p", {
              classe: "muted",
              texto: "Conte o que está na prateleira. O que você contar vira o saldo — sem tolerância.",
            }),
          ]),
        ]),

        el("div", { classe: "cartao" }, [
          el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Onde vai contar" }), seletorLocal]),
          el("button", {
            classe: "btn btn-primario btn-grande",
            type: "button",
            texto: "Começar a contar",
            onclick: () => desenharContagem(seletorLocal.value),
          }),
          el("p", {
            classe: "muted",
            texto: "Pode contar só uma parte: o que ficar em branco não muda.",
          }),
        ]),

        historico.length > 0
          ? el("div", { classe: "cartao" }, [
              el("h3", { texto: "Últimas contagens" }),
              ...historico.slice(0, 8).map((c) =>
                el("div", { classe: "cabecalho-secao" }, [
                  el("span", {}, [
                    el("strong", { texto: c.local }),
                    el("p", { classe: "muted", texto: `${dataHora(c.created_at)} · ${c.itens} item(ns)` }),
                  ]),
                  // A quebra é o resumo que importa do histórico: quanto
                  // sumiu, em dinheiro, naquela conferência.
                  c.quebra < 0
                    ? etiqueta(`quebra ${dinheiro(Math.abs(c.quebra))}`, "etiqueta-perigo")
                    : etiqueta("sem quebra", "etiqueta-ok"),
                ]),
              ),
            ])
          : null,
      ].filter(Boolean)),
    );
  }

  function desenharContagem(localId) {
    limpar(conteudo);
    const local = locais.find((l) => l.id === localId);

    /** insumoId -> quantidade digitada. Ausente = não contado. */
    const contados = new Map();

    const busca = el("input", {
      classe: "campo",
      placeholder: "Buscar item… (pula direto pro que está na mão)",
    });
    const lista = el("div", { classe: "lista" });
    const progresso = el("span", { classe: "muted" });

    const atualizarProgresso = () => {
      progresso.textContent = `${contados.size} de ${insumos.length} contados`;
    };

    const desenharLista = () => {
      const alvo = busca.value.trim().toLowerCase();
      const filtrados = alvo
        ? insumos.filter((i) => i.nomeNormalizado.includes(alvo))
        : insumos;
      limpar(lista);
      for (const i of filtrados) lista.append(linhaDeContagem(i));
      atualizarProgresso();
    };
    busca.addEventListener("input", desenharLista);

    function linhaDeContagem(insumo) {
      const campo = el("input", {
        classe: "campo-numero",
        type: "number",
        inputmode: "decimal",
        step: "0.001",
        min: "0",
        value: contados.has(insumo.id) ? contados.get(insumo.id) : "",
        // Nenhum saldo do sistema aqui, de propósito: contagem cega. O
        // número do sistema aparece DEPOIS, na comparação.
        placeholder: insumo.unidade,
        onchange: (ev) => {
          if (ev.target.value === "") contados.delete(insumo.id);
          else contados.set(insumo.id, Number(ev.target.value));
          atualizarProgresso();
        },
      });
      return el("div", { classe: `cartao ${contados.has(insumo.id) ? "" : ""}` }, [
        el("div", { classe: "linha-campos" }, [
          el("label", { style: "flex:2" }, [
            el("span", {}, [el("strong", { texto: insumo.nome })]),
            el("small", { classe: "muted", texto: insumo.categoria ?? "" }),
          ]),
          el("label", { style: "flex:1" }, [el("span", { texto: `Contei (${insumo.unidade})` }), campo]),
        ]),
      ]);
    }

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: `Contando: ${local?.nome ?? ""}` }),
            progresso,
          ]),
          el("button", {
            classe: "btn btn-peq",
            type: "button",
            texto: "Cancelar",
            onclick: () => {
              if (contados.size === 0 || confirm("Sair sem processar? O que você contou se perde.")) {
                desenharAbertura();
              }
            },
          }),
        ]),
        busca,
        lista,
        el("div", { classe: "cartao cartao-total" }, [
          el("button", {
            classe: "btn btn-primario btn-grande",
            type: "button",
            texto: "Processar contagem",
            onclick: (ev) => processar(ev.target, localId),
          }),
          el("p", {
            classe: "muted",
            texto: "O contado vira o saldo. O que ficou em branco não muda.",
          }),
        ]),
      ]),
    );
    desenharLista();

    async function processar(botao, localId) {
      if (contados.size === 0) return avisar("Nenhum item contado ainda.", "erro");

      const emBranco = insumos.length - contados.size;
      // A confirmação diz a consequência, não pede permissão vazia: é a
      // última chance de perceber que faltou uma prateleira.
      if (
        emBranco > 0 &&
        !confirm(`${contados.size} contado(s). ${emBranco} em branco vão FICAR COMO ESTÃO. Processar?`)
      ) {
        return;
      }

      botao.disabled = true;
      botao.textContent = "Processando…";
      try {
        const r = await post(`/v1/venues/${ctx.venue}/contagens`, {
          local_id: localId,
          itens: [...contados.entries()].map(([insumoId, quantidade]) => ({
            insumo_id: insumoId,
            quantidade,
          })),
        });
        mostrarResultado(r);
      } catch (e) {
        avisar(e.message, "erro");
        botao.disabled = false;
        botao.textContent = "Processar contagem";
      }
    }
  }

  function mostrarResultado(r) {
    limpar(conteudo);
    const faltas = r.ajustes.filter((a) => a.diferenca < 0);
    const sobras = r.ajustes.filter((a) => a.diferenca > 0);
    const quebraTotal = faltas.reduce((t, a) => t + a.valor, 0);

    const linhaAjuste = (a) =>
      el("div", { classe: "cabecalho-secao" }, [
        el("span", {}, [
          el("strong", { texto: a.insumo }),
          el("p", {
            classe: "muted",
            texto: `sistema ${a.sistema} → contado ${a.contado} ${a.unidade}`,
          }),
        ]),
        el("strong", { texto: dinheiro(a.valor) }),
      ]);

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cartao" }, [
          el("h2", { texto: "✓ Contagem processada" }),
          el("p", {
            classe: "muted",
            texto:
              r.ajustes.length === 0
                ? `${r.contados} item(ns) conferidos — tudo batia com o sistema.`
                : `${r.contados} item(ns) conferidos, ${r.ajustes.length} ajustado(s).`,
          }),
        ]),

        faltas.length > 0
          ? el("div", { classe: "cartao cartao-atencao" }, [
              el("div", { classe: "cabecalho-secao" }, [
                el("h3", { texto: "Faltou (quebra)" }),
                el("strong", { texto: dinheiro(Math.abs(quebraTotal)) }),
              ]),
              el("p", {
                classe: "muted",
                texto: "O que o sistema esperava e não estava lá: consumo sem lançamento, perda ou desvio.",
              }),
              ...faltas.map(linhaAjuste),
            ])
          : null,

        sobras.length > 0
          ? el("div", { classe: "cartao" }, [
              el("h3", { texto: "Sobrou" }),
              el("p", {
                classe: "muted",
                texto: "Mais na prateleira do que no sistema: compra não lançada ou baixa duplicada.",
              }),
              ...sobras.map(linhaAjuste),
            ])
          : null,

        el("button", {
          classe: "btn btn-primario btn-grande",
          type: "button",
          texto: "Nova contagem",
          onclick: desenharAbertura,
        }),
      ].filter(Boolean)),
    );
  }
}
