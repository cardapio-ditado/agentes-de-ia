import { get } from "../api.js";
import { dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Engenharia de cardápio: qual prato reprecificar, divulgar ou tirar.
 *
 * O painel do CMV diz QUANTO a casa gasta; esta tela diz ONDE decidir. A
 * matriz é a clássica popularidade × margem, e a ordem da lista é a ordem da
 * decisão: o burro de carga primeiro, porque é o problema que parece sucesso
 * — o prato campeão de venda que deixa pouco dinheiro. O balcão comemora, o
 * caixa não.
 */

const QUADRANTES = {
  burro_de_carga: {
    icone: "🐴",
    titulo: "Burros de carga",
    resumo: "Vendem muito, rendem pouco. É aqui que a casa mais perde sem perceber.",
    acao: "Suba um pouco o preço, ou enxugue o custo da ficha. Ninguém deixa de pedir o campeão por um real.",
    classe: "etiqueta-perigo",
  },
  peso_morto: {
    icone: "🪦",
    titulo: "Pesos mortos",
    resumo: "Vendem pouco e rendem pouco.",
    acao: "Candidatos a sair do cardápio — cada um ocupa cozinha, estoque e espaço no menu.",
    classe: "etiqueta-alerta",
  },
  enigma: {
    icone: "🧩",
    titulo: "Enigmas",
    resumo: "Rendem bem, mas pouca gente pede.",
    acao: "Divulgue: destaque no cardápio, sugestão do garçom, foto. Margem boa só falta público.",
    classe: "etiqueta-info",
  },
  estrela: {
    icone: "⭐",
    titulo: "Estrelas",
    resumo: "Vendem muito e rendem bem.",
    acao: "Proteja: não mexa no preço sem medir, e garanta que nunca falte insumo.",
    classe: "etiqueta-ok",
  },
};

export async function engenhariaCardapio(raiz, ctx) {
  const conteudo = el("div", { classe: "pilha" });

  const hoje = new Date();
  const inicioPadrao = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const campoInicio = el("input", { classe: "campo", type: "date", value: dataISO(inicioPadrao) });
  const campoFim = el("input", { classe: "campo", type: "date", value: dataISO(hoje) });
  campoInicio.addEventListener("change", carregar);
  campoFim.addEventListener("change", carregar);

  raiz.append(
    el("div", { classe: "pilha" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Engenharia de cardápio" }),
          el("p", {
            classe: "muted",
            texto: "Cada prato num quadrante: o que proteger, o que reprecificar, o que divulgar e o que tirar.",
          }),
        ]),
        el("div", { classe: "linha-campos" }, [
          el("label", { classe: "campo-rotulado" }, [el("span", { texto: "De" }), campoInicio]),
          el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Até" }), campoFim]),
        ]),
      ]),
      conteudo,
    ]),
  );

  await carregar();

  async function carregar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Calculando…" }));
    let dados;
    try {
      dados = await get(
        `/v1/venues/${ctx.venue}/cmv/engenharia?inicio=${campoInicio.value}&fim=${campoFim.value}`,
      );
    } catch (e) {
      limpar(conteudo).append(vazio("Não deu para calcular", e.message));
      return;
    }

    limpar(conteudo);
    if (dados.pratos.length === 0) {
      conteudo.append(
        vazio(
          "Nenhuma venda classificável no período",
          "Importe e baixe um relatório de vendas em Vendas — e confira se os produtos estão casados com fichas ou insumos.",
        ),
      );
      if (dados.semPreco?.length) conteudo.append(cartaoSemPreco(dados.semPreco));
      return;
    }

    for (const chave of ["burro_de_carga", "peso_morto", "enigma", "estrela"]) {
      const pratos = dados.pratos.filter((p) => p.quadrante === chave);
      if (pratos.length > 0) conteudo.append(cartaoQuadrante(chave, pratos));
    }
    if (dados.semPreco?.length) conteudo.append(cartaoSemPreco(dados.semPreco));
  }
}

function cartaoQuadrante(chave, pratos) {
  const q = QUADRANTES[chave];
  return el("section", { classe: `cartao ${chave === "burro_de_carga" ? "cartao-atencao" : ""}` }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: `${q.icone}  ${q.titulo}` }),
        el("p", { classe: "muted", texto: q.resumo }),
      ]),
      etiqueta(`${pratos.length}`, q.classe),
    ]),
    el("div", { classe: "rolagem-x", style: "margin-top:10px" }, [
      el("table", { classe: "planilha" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { texto: "Prato" }),
            el("th", { classe: "col-num", texto: "Vendidos" }),
            el("th", { classe: "col-num", texto: "Preço médio" }),
            el("th", { classe: "col-num", texto: "Custo" }),
            el("th", { classe: "col-num", texto: "Margem" }),
            el("th", { classe: "col-num", texto: "Margem no período" }),
          ]),
        ]),
        el(
          "tbody",
          {},
          pratos.map((p) =>
            el("tr", {}, [
              el("td", {}, [el("strong", { texto: p.nome })]),
              el("td", { classe: "col-num", texto: String(Math.round(p.vendidos)) }),
              el("td", { classe: "col-num", texto: dinheiro(p.precoMedio) }),
              el("td", { classe: "col-num", texto: dinheiro(p.custoUnitario) }),
              el("td", { classe: "col-num" }, [
                etiqueta(`${p.margemPct}%`, p.margemPct < 50 ? "etiqueta-perigo" : "etiqueta-ok"),
              ]),
              el("td", { classe: "col-num", texto: dinheiro(p.margemTotal) }),
            ]),
          ),
        ),
      ]),
    ]),
    el("p", { classe: "muted", style: "margin-top:8px", texto: `O que fazer: ${q.acao}` }),
  ]);
}

function cartaoSemPreco(itens) {
  return el("section", { classe: "cartao" }, [
    el("h3", { texto: "Vendidos sem preço em lugar nenhum" }),
    el("p", {
      classe: "muted",
      texto:
        "Estes saíram no relatório mas não têm valor na venda nem preço na ficha — impossível medir a margem. " +
        "Preencha o preço de venda na ficha técnica para eles entrarem na análise.",
    }),
    el(
      "ul",
      { style: "margin:10px 0 0;padding-left:20px" },
      itens.map((i) => el("li", { texto: `${i.nome} — ${Math.round(i.vendidos)} vendidos` })),
    ),
  ]);
}

function dataISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
