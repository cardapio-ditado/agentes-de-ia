import { get, post } from "../api.js";
import { avisar, buscador, el, limpar, vazio } from "../ui.js";

/**
 * Produção: a receita foi feita, os insumos saem do estoque.
 *
 * A tela é pequena de propósito — três decisões e um botão. Quem registra
 * produção é a cozinha no fim do preparo, e o registro que dá trabalho é o
 * registro que não acontece: aí o insumo some sem baixa e a contagem acusa
 * quebra falsa.
 *
 * Só fichas CONFERIDAS aparecem: produzir por uma ficha que a IA sugeriu e
 * ninguém conferiu baixaria do estoque uma quantidade inventada — o servidor
 * recusa, e a tela nem oferece.
 */

export async function producao(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);

  let fichas = [];
  let locais = [];
  try {
    [fichas, locais] = await Promise.all([
      get(`/v1/venues/${ctx.venue}/fichas`),
      get(`/v1/venues/${ctx.venue}/estoque-locais`),
    ]);
  } catch (e) {
    conteudo.append(vazio("Produção indisponível", e.message));
    return;
  }

  const confirmadas = fichas.filter((f) => f.confirmada_em);
  if (confirmadas.length === 0) {
    conteudo.append(
      vazio(
        "Nenhuma ficha conferida",
        "Monte e confira uma ficha técnica primeiro — é ela que diz o que a produção consome.",
      ),
    );
    return;
  }

  let ficha = null;
  const escolhida = el("div", { classe: "cartao", hidden: true });
  const lotes = el("input", {
    classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.5", min: "0.5", value: 1,
  });
  const seletorLocal = el(
    "select",
    { classe: "select" },
    locais.map((l) => el("option", { value: l.id, texto: l.nome, selected: l.principal })),
  );

  const desenharEscolhida = () => {
    if (!ficha) return;
    escolhida.hidden = false;
    limpar(escolhida).append(
      el("strong", { texto: ficha.nome }),
      el("p", { classe: "muted", texto: `Rende ${ficha.rendimento} porção(ões) por lote.` }),
      // O que vai sair do estoque, ANTES do botão: a surpresa boa é nenhuma.
      ...(ficha.ficha_insumos ?? []).map((fi) =>
        el("p", {
          classe: "muted",
          texto: `− ${fi.quantidade} × lotes de ${fi.insumos?.nome ?? "?"}`,
        }),
      ),
    );
  };

  conteudo.append(
    el("section", { classe: "pilha" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Registrar produção" }),
          el("p", { classe: "muted", texto: "A receita foi feita — os ingredientes saem do estoque." }),
        ]),
      ]),
      el("div", { classe: "cartao pilha" }, [
        el("label", { classe: "campo-rotulado" }, [
          el("span", { texto: "O que foi produzido" }),
          buscador(
            confirmadas.map((f) => ({ rotulo: f.nome, valor: f })),
            {
              placeholder: "🔍  Digite o nome da ficha…",
              aoEscolher: (o) => {
                ficha = o.valor;
                desenharEscolhida();
              },
            },
          ),
        ]),
        escolhida,
        el("div", { classe: "linha-campos" }, [
          el("label", {}, [el("span", { texto: "Quantas vezes a receita" }), lotes]),
          el("label", {}, [el("span", { texto: "De qual estoque saem os insumos" }), seletorLocal]),
        ]),
        el("button", {
          classe: "btn btn-primario btn-grande",
          type: "button",
          texto: "Registrar produção",
          onclick: async (ev) => {
            if (!ficha) return avisar("Escolha a ficha.", "erro");
            if (!(Number(lotes.value) > 0)) return avisar("Informe quantas vezes a receita foi feita.", "erro");
            ev.target.disabled = true;
            try {
              await post(`/v1/venues/${ctx.venue}/producoes`, {
                ficha_id: ficha.id,
                local_id: seletorLocal.value,
                lotes: Number(lotes.value),
              });
              avisar(`Produção registrada — insumos baixados do estoque.`, "ok");
              ficha = null;
              escolhida.hidden = true;
              lotes.value = 1;
            } catch (e) {
              avisar(e.message, "erro");
            }
            ev.target.disabled = false;
          },
        }),
      ]),
    ]),
  );
}
