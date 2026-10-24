import { el } from "./ui.js";

/**
 * Relatório em PDF, de qualquer tela.
 *
 * Sem biblioteca e sem rota nova: monta uma folha A4 escondida, manda
 * imprimir e deixa o "Salvar como PDF" do aparelho fazer o resto — o mesmo
 * caminho da folha de avaliação da pesquisa, que já roda no celular do
 * gerente. Funciona no computador do escritório, no tablet do caixa e no
 * celular; e o PDF sai do jeito que a tela está (o período, o filtro).
 *
 * Cada tela só descreve o que vai no papel:
 *
 *   imprimirRelatorio({
 *     tipo: "Custos e estoque", titulo: "CMV do período", periodo: "01/10 a 24/10",
 *     selos: [{ valor: "31,2%", rotulo: "CMV" }],
 *     secoes: [{ titulo: "A conta", colunas: [...], linhas: [[...]], total: [...] }],
 *     assinaturas: ["Gerente"],
 *     arquivo: "cmv-2026-10",
 *   });
 *
 * As tabelas repetem o cabeçalho em cada página (thead), e linha não se
 * parte no meio — é o que separa um relatório de uma tela impressa.
 */

export function imprimirRelatorio({
  tipo,
  titulo,
  periodo = "",
  selos = [],
  secoes = [],
  assinaturas = [],
  arquivo,
  paisagem = false,
}) {
  const casa = document.getElementById("marca-org")?.textContent?.trim() || "Brasa Food";
  const geradoEm = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  const folha = el("div", { classe: "folha folha-relatorio" }, [
    el("div", { classe: "folha-topo" }, [
      el("div", {}, [
        el("div", { classe: "folha-casa", texto: casa }),
        el("div", { classe: "relatorio-titulo", texto: titulo }),
      ]),
      el("div", { style: "text-align:right" }, [
        el("div", { classe: "folha-tipo", texto: tipo }),
        periodo ? el("div", { classe: "relatorio-periodo", texto: periodo }) : null,
      ]),
    ]),

    selos.length
      ? el("div", { classe: "folha-selos relatorio-selos" }, selos.map((s) =>
          el("div", { classe: `folha-selo${s.ruim ? " ruim" : ""}` }, [
            el("b", { texto: s.valor }),
            el("span", { texto: s.rotulo }),
          ])))
      : null,

    ...secoes.map(secao),

    assinaturas.length
      ? el("div", { classe: "relatorio-assinaturas" }, assinaturas.map((quem) =>
          el("div", { classe: "relatorio-assinatura" }, [el("span", { texto: quem })])))
      : null,

    el("div", { classe: "relatorio-rodape", texto: `Gerado em ${geradoEm} pelo Brasa Food` }),
  ]);

  // O título da página vira o NOME DO ARQUIVO na maioria dos navegadores:
  // "cmv-ditado-popular-2026-10.pdf" diz o que é no grupo do WhatsApp.
  const tituloAntes = document.title;
  document.title = nomeDeArquivo(`${arquivo || titulo}-${casa}`);

  // Paisagem só para quem precisa (o acerto com oito colunas). O @page vive
  // num <style> próprio que nasce e morre com a impressão.
  const pagina = el("style", { texto: `@page { size: A4 ${paisagem ? "landscape" : "portrait"}; margin: 12mm; }` });
  document.head.append(pagina);
  document.body.append(folha);
  document.documentElement.setAttribute("data-imprimindo", "1");

  const limpar = () => {
    document.documentElement.removeAttribute("data-imprimindo");
    folha.remove();
    pagina.remove();
    document.title = tituloAntes;
  };
  // `afterprint` cobre o caminho normal; o tempo é a rede de segurança para
  // celular que não dispara o evento e deixaria a folha pendurada.
  addEventListener("afterprint", limpar, { once: true });
  setTimeout(limpar, 60_000);
  print();
}

function secao(s) {
  if (!s) return null;
  const corpo = [];
  if (s.titulo) corpo.push(el("h2", { classe: "relatorio-secao", texto: s.titulo }));
  if (s.nota) corpo.push(el("p", { classe: "relatorio-nota", texto: s.nota }));
  for (const p of s.paragrafos ?? []) corpo.push(el("p", { classe: "relatorio-paragrafo", texto: p }));
  if (s.pares) {
    corpo.push(el("table", { classe: "relatorio-tabela relatorio-pares" }, [
      el("tbody", {}, s.pares.map(([rotulo, valor, forte]) =>
        el("tr", { classe: forte ? "relatorio-forte" : "" }, [el("td", { texto: rotulo }), el("td", { classe: "num", texto: valor })]))),
    ]));
  }
  if (s.colunas) {
    const numerica = s.colunas.map((c) => Boolean(c.num));
    const celula = (tag, valor, i) => el(tag, { classe: numerica[i] ? "num" : "", texto: valor ?? "" });
    corpo.push(
      s.linhas.length
        ? el("table", { classe: "relatorio-tabela" }, [
            el("thead", {}, [el("tr", {}, s.colunas.map((c, i) => celula("th", c.rotulo, i)))]),
            el("tbody", {}, s.linhas.map((linha) =>
              el("tr", { classe: linha.destaque ? "relatorio-destaque" : "" }, (linha.celulas ?? linha).map((v, i) => celula("td", v, i))))),
            s.total ? el("tfoot", {}, [el("tr", {}, s.total.map((v, i) => celula("td", v, i)))]) : null,
          ])
        : el("p", { classe: "relatorio-nota", texto: s.vazio ?? "Nada no período." }),
    );
  }
  return el("section", { classe: "relatorio-bloco" }, corpo);
}

function nomeDeArquivo(texto) {
  return String(texto ?? "relatorio")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** O botão padrão "Baixar PDF", igual em toda tela. */
export function botaoDePdf(aoClicar, texto = "Baixar PDF") {
  return el("button", {
    classe: "btn btn-peq",
    type: "button",
    texto: `⤓ ${texto}`,
    title: "Abre a impressão: escolha “Salvar como PDF” para guardar ou mandar no WhatsApp",
    onclick: aoClicar,
  });
}

/** 2026-10-24 → 24/10/2026 */
export function dataBr(iso) {
  return iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "";
}
