import { get } from "../api.js";
import { dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * O painel da pesquisa: o que os clientes acham, num relance.
 *
 * A ordem das seções é a ordem das perguntas que o dono realmente faz, nesta
 * sequência: "estou melhorando ou piorando?", "quem eu preciso ligar de volta
 * hoje?", "o que estão falando?", "quem da equipe está indo bem?".
 *
 * O alerta dos detratores vem ANTES dos gráficos de propósito. Um cliente que
 * deu nota 3 ontem ainda dá para recuperar com um telefonema; enterrado
 * embaixo de três gráficos, ele nunca é visto — e a pesquisa vira enfeite.
 */

const PERIODOS = [
  ["7", "7 dias"],
  ["30", "30 dias"],
  ["90", "90 dias"],
  ["365", "1 ano"],
];

export async function pesquisa(raiz, ctx) {
  const conteudo = el("div", { classe: "pilha" });

  const seletor = el(
    "select",
    { classe: "select" },
    PERIODOS.map(([v, r]) => el("option", { value: v, texto: r, selected: v === "30" })),
  );
  seletor.addEventListener("change", carregar);

  raiz.append(
    el("div", { classe: "pilha" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "O que os clientes acham" }),
          el("p", { classe: "muted", texto: "Respostas do QR code da mesa e dos links enviados." }),
        ]),
        el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Período" }), seletor]),
      ]),
      conteudo,
    ]),
  );

  await carregar();

  async function carregar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let dados;
    try {
      dados = await get(`/v1/venues/${ctx.venue}/pesquisa?dias=${seletor.value}`);
    } catch (e) {
      limpar(conteudo).append(vazio("Não deu para carregar", e.message));
      return;
    }

    limpar(conteudo);

    if (dados.resumo.respostas === 0) {
      conteudo.append(
        vazio(
          "Nenhuma resposta ainda",
          "Imprima o QR code em “Ajustes da pesquisa” e ponha na mesa — ou mande o link para quem já veio.",
        ),
      );
      return;
    }

    conteudo.append(
      indicadores(dados),
      dados.aBater.length > 0 ? cartaoDetratores(dados.aBater) : null,
      // As notas por assunto vêm logo depois do alerta: é a resposta para "o
      // problema é a cozinha ou o salão?", que a nota geral nunca deu.
      cartaoCategorias(dados.categorias ?? []),
      linhaDoTempo(dados.linha),
      cartaoNuvem(dados.nuvem),
      el("div", { classe: "grade-2" }, [
        cartaoEtiquetas("O que agradou", dados.elogios, "ok"),
        cartaoEtiquetas("O que incomodou", dados.criticas, "perigo"),
      ]),
      cartaoRanking(dados.ranking),
    );
  }
}

/* ---------- os números do topo ---------- */

function indicadores(dados) {
  const { resumo, anterior } = dados;

  return el("div", { classe: "grade" }, [
    indicador("NPS", String(resumo.nps), textoDaVariacao(resumo.nps, anterior?.nps), true),
    // A recomendação e a experiência lado a lado, e nunca uma no lugar da
    // outra. NPS alto com experiência baixa é a casa que ainda tem crédito
    // com o cliente e está gastando — e é o que nenhum dos dois números
    // conta sozinho.
    indicador(
      "Nota de recomendação",
      resumo.media.toFixed(1).replace(".", ","),
      `de 0 a 10 · ${resumo.respostas} respostas`,
    ),
    indicador(
      "Média da experiência",
      dados.mediaDaExperiencia === null || dados.mediaDaExperiencia === undefined
        ? "—"
        : dados.mediaDaExperiencia.toFixed(1).replace(".", ","),
      dados.mediaDaExperiencia === null || dados.mediaDaExperiencia === undefined
        ? "monte a pesquisa por categoria para ver"
        : textoDaVariacao(dados.mediaDaExperiencia, dados.experienciaAntes),
    ),
    indicador(
      "Promotores",
      `${percentual(resumo.promotores, resumo.respostas)}%`,
      `${resumo.promotores} deram 9 ou 10`,
    ),
    indicador(
      "Detratores",
      `${percentual(resumo.detratores, resumo.respostas)}%`,
      `${resumo.detratores} deram 6 ou menos`,
    ),
  ]);
}

function indicador(rotulo, valor, nota, destaque = false) {
  return el("div", { classe: `indicador ${destaque ? "indicador-destaque" : ""}`.trim() }, [
    el("div", { classe: "indicador-rotulo" }, [el("span", { texto: rotulo })]),
    el("div", { classe: "indicador-valor", texto: valor }),
    nota ? el("div", { classe: "indicador-nota", texto: nota }) : null,
  ]);
}

function percentual(parte, total) {
  return total === 0 ? 0 : Math.round((parte / total) * 100);
}

/**
 * "+12 contra os 30 dias anteriores".
 *
 * Sem base de comparação, dizer "0" seria lido como queda no primeiro mês de
 * uso — quando na verdade não há com o que comparar.
 */
function textoDaVariacao(agora, antes) {
  if (antes === undefined || antes === null) return "sem período anterior para comparar";
  const diferenca = agora - antes;
  if (diferenca === 0) return "igual ao período anterior";
  return `${diferenca > 0 ? "+" : ""}${diferenca} contra o período anterior`;
}

/* ---------- quem precisa de um telefonema ---------- */

function cartaoDetratores(respostas) {
  return el("section", { classe: "cartao cartao-atencao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: `⚠️  ${respostas.length} ${respostas.length === 1 ? "cliente saiu insatisfeito" : "clientes saíram insatisfeitos"}` }),
        el("p", {
          classe: "muted",
          texto: "Um telefonema hoje ainda recupera. Depois de uma semana, ele já contou para os amigos.",
        }),
      ]),
      // A coluna "O que disse" mostra só o comentário geral. O que a pessoa
      // respondeu em cada pergunta — onde exatamente afundou — está na tela
      // de respostas, e sem este atalho ninguém descobre que ela existe.
      el("a", {
        classe: "btn btn-peq",
        href: "#pesquisa-respostas",
        texto: "Ler as respostas inteiras",
      }),
    ]),
    el(
      "div",
      { classe: "rolagem-x", style: "margin-top:10px" },
      [
        el("table", { classe: "planilha" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { texto: "Quando" }),
              el("th", { classe: "col-num", texto: "Nota" }),
              el("th", { texto: "Cliente" }),
              el("th", { texto: "O que disse" }),
            ]),
          ]),
          el(
            "tbody",
            {},
            respostas.map((r) =>
              el("tr", {}, [
                el("td", { texto: dataHora(r.created_at) }),
                el("td", { classe: "col-num" }, [etiqueta(String(r.nota), "etiqueta-perigo")]),
                el("td", {}, [
                  el("strong", { texto: r.cliente_nome || "Anônimo" }),
                  r.cliente_contato
                    ? el("small", { classe: "muted", texto: r.cliente_contato })
                    : null,
                ]),
                // O comentário quebra a regra do `white-space: nowrap` da
                // planilha de propósito: é a única coluna aqui que precisa ser
                // lida inteira, e é o motivo de o cartão existir.
                el("td", { style: "white-space:normal;max-width:38ch" }, [
                  el("span", { texto: r.comentario || textoDasEtiquetas(r) }),
                ]),
              ]),
            ),
          ),
        ]),
      ],
    ),
  ]);
}

function textoDasEtiquetas(r) {
  const criticas = (r.criticas ?? []).join(", ");
  return criticas ? `Marcou: ${criticas}` : "Sem comentário";
}

/* ---------- as notas por assunto ---------- */

/**
 * A nota de cada categoria, da pior para a melhor.
 *
 * Da pior para a melhor porque a tela existe para achar problema. Em ordem
 * alfabética, "Ambiente" com 9,1 ficaria acima de "Tempo de espera" com 4,2 —
 * e o que precisa de ação estaria embaixo, onde ninguém rola.
 */
function cartaoCategorias(categorias) {
  if (categorias.length === 0) {
    return el("section", { classe: "cartao" }, [
      el("h3", { texto: "Notas por assunto" }),
      el("p", {
        classe: "muted",
        texto: "Monte a pesquisa da casa em “Ajustes da pesquisa” para ter nota separada por comida, atendimento, ambiente — o que importar para você.",
      }),
    ]);
  }

  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "Notas por assunto" }),
        el("p", { classe: "muted", texto: "Da pior para a melhor. Abra para ver pergunta por pergunta." }),
      ]),
    ]),
    el("div", { classe: "categorias" }, categorias.map(linhaDaCategoria)),
  ]);
}

function linhaDaCategoria(c) {
  const faixa = c.media >= 9 ? "ok" : c.media >= 7 ? "alerta" : "perigo";

  const detalhe = el(
    "div",
    { classe: "categoria-perguntas" },
    c.perguntas.map((p) =>
      el("div", { classe: "categoria-pergunta" }, [
        el("span", { texto: p.pergunta }),
        el("strong", { texto: virgula(p.media) }),
        el("small", { classe: "muted", texto: `${p.respostas} resp.` }),
      ]),
    ),
  );

  const resumo = el("summary", { classe: "categoria-linha" }, [
    el("span", { classe: "categoria-nome", texto: c.categoria }),
    el("span", { classe: "categoria-trilho" }, [
      el("span", { classe: `categoria-preenche faixa-${faixa}`, style: `width:${c.media * 10}%` }),
    ]),
    el("strong", { classe: `categoria-nota faixa-texto-${faixa}`, texto: virgula(c.media) }),
    el("small", { classe: "muted categoria-variacao", texto: variacao(c.media, c.antes) }),
  ]);

  return el("details", { classe: "categoria" }, [resumo, detalhe]);
}

function virgula(n) {
  return n.toFixed(1).replace(".", ",");
}

/** "+0,4" contra o período anterior. Sem base, o campo fica vazio. */
function variacao(agora, antes) {
  if (antes === null || antes === undefined) return "";
  const d = Math.round((agora - antes) * 10) / 10;
  if (d === 0) return "igual";
  return `${d > 0 ? "▲" : "▼"} ${virgula(Math.abs(d))}`;
}

/* ---------- a linha do tempo ---------- */

/**
 * A evolução da nota, dia a dia.
 *
 * SVG desenhado à mão: uma biblioteca de gráfico custaria mais bytes que o
 * painel inteiro para desenhar uma linha de dez pontos.
 */
function linhaDoTempo(pontos) {
  if (pontos.length < 2) {
    return el("section", { classe: "cartao" }, [
      el("h3", { texto: "Evolução" }),
      el("p", { classe: "muted", texto: "A linha aparece quando houver resposta em pelo menos dois dias." }),
    ]);
  }

  const L = 640;
  const A = 150;
  const margem = { cima: 12, baixo: 24, lado: 10 };

  const x = (i) => margem.lado + (i / (pontos.length - 1)) * (L - margem.lado * 2);
  // Escala fixa de 0 a 10, e não "do menor ao maior do período": com escala
  // automática, uma casa que oscila entre 9,1 e 9,4 vê um gráfico de montanha
  // russa e acha que está afundando.
  const y = (v) => margem.cima + (1 - v / 10) * (A - margem.cima - margem.baixo);

  const caminho = pontos.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.media).toFixed(1)}`).join(" ");
  const area = `${caminho} L${x(pontos.length - 1).toFixed(1)},${A - margem.baixo} L${x(0).toFixed(1)},${A - margem.baixo} Z`;

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${L} ${A}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Nota média por dia");
  svg.style.width = "100%";
  svg.style.height = "150px";

  // Linha do 7: abaixo dela o cliente já não é promotor. É a referência que
  // torna a curva legível sem eixo numerado.
  for (const referencia of [7, 9]) {
    const regua = document.createElementNS(NS, "line");
    regua.setAttribute("x1", String(margem.lado));
    regua.setAttribute("x2", String(L - margem.lado));
    regua.setAttribute("y1", String(y(referencia)));
    regua.setAttribute("y2", String(y(referencia)));
    regua.setAttribute("stroke", "var(--borda)");
    regua.setAttribute("stroke-dasharray", "4 5");
    svg.append(regua);
  }

  const preenchimento = document.createElementNS(NS, "path");
  preenchimento.setAttribute("d", area);
  preenchimento.setAttribute("fill", "var(--marca-suave)");

  const linha = document.createElementNS(NS, "path");
  linha.setAttribute("d", caminho);
  linha.setAttribute("fill", "none");
  linha.setAttribute("stroke", "var(--marca)");
  linha.setAttribute("stroke-width", "2.5");
  linha.setAttribute("stroke-linejoin", "round");
  linha.setAttribute("vector-effect", "non-scaling-stroke");

  svg.append(preenchimento, linha);

  for (const [i, ponto] of pontos.entries()) {
    const bola = document.createElementNS(NS, "circle");
    bola.setAttribute("cx", String(x(i)));
    bola.setAttribute("cy", String(y(ponto.media)));
    bola.setAttribute("r", "3.5");
    bola.setAttribute("fill", "var(--marca)");
    const dica = document.createElementNS(NS, "title");
    dica.textContent = `${diaCurto(ponto.dia)} · média ${ponto.media.toFixed(1).replace(".", ",")} · ${ponto.respostas} resposta${ponto.respostas === 1 ? "" : "s"}`;
    bola.append(dica);
    svg.append(bola);
  }

  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "Evolução da nota" }),
        el("p", { classe: "muted", texto: "As linhas tracejadas marcam 7 e 9 — abaixo de 7 o cliente é detrator." }),
      ]),
    ]),
    svg,
    el("div", { classe: "escala-datas" }, [
      el("small", { classe: "muted", texto: diaCurto(pontos[0].dia) }),
      el("small", { classe: "muted", texto: diaCurto(pontos[pontos.length - 1].dia) }),
    ]),
  ]);
}

function diaCurto(iso) {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

/* ---------- a nuvem ---------- */

/**
 * A nuvem de palavras.
 *
 * Tamanho = quantas pessoas falaram. Cor = a nota de quem falou. Sem a cor, a
 * palavra "demora" apareceria grande e bonita ao lado de "delícia", e o dono
 * comemoraria a reclamação.
 */
function cartaoNuvem(termos) {
  const corpo = el("div", { classe: "nuvem" });

  if (termos.length === 0) {
    corpo.append(
      el("p", { classe: "muted", texto: "Ainda não há comentários escritos suficientes para montar a nuvem." }),
    );
  } else {
    const maior = termos[0].mencoes;
    const menor = termos[termos.length - 1].mencoes;
    for (const t of termos) {
      // Raiz quadrada e não proporção direta: com proporção, um termo citado
      // 40 vezes ao lado de outro citado 2 fica quatro linhas mais alto e a
      // nuvem vira um título com legendas.
      const fatia = maior === menor ? 1 : (t.mencoes - menor) / (maior - menor);
      const tamanho = 14 + Math.sqrt(fatia) * 24;
      corpo.append(
        el("span", {
          classe: `termo termo-${t.tom}`,
          style: `font-size:${tamanho.toFixed(1)}px`,
          title: `${t.mencoes} ${t.mencoes === 1 ? "pessoa falou" : "pessoas falaram"} · nota média ${t.notaMedia.toFixed(1).replace(".", ",")}`,
          texto: t.termo,
        }),
      );
    }
  }

  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "O que estão falando" }),
        el("p", { classe: "muted", texto: "Quanto maior, mais gente falou. Verde é elogio, vermelho é reclamação." }),
      ]),
    ]),
    corpo,
  ]);
}

/* ---------- etiquetas ---------- */

function cartaoEtiquetas(titulo, contagens, cor) {
  if (contagens.length === 0) {
    return el("section", { classe: "cartao" }, [
      el("h3", { texto: titulo }),
      el("p", { classe: "muted", texto: "Ninguém marcou nada aqui no período." }),
    ]);
  }

  const maior = contagens[0].vezes;
  return el("section", { classe: "cartao" }, [
    el("h3", { texto: titulo }),
    el(
      "div",
      { classe: "etiquetas-barras" },
      contagens.map((c) =>
        el("div", { classe: "etiqueta-barra" }, [
          el("span", { texto: c.etiqueta }),
          el("span", { classe: "etiqueta-trilho" }, [
            el("span", {
              classe: `etiqueta-preenche etiqueta-preenche-${cor}`,
              // Mínimo de 6%: uma etiqueta com uma menção só ficaria com uma
              // barra invisível, e a linha pareceria defeito de renderização.
              style: `width:${Math.max((c.vezes / maior) * 100, 6)}%`,
            }),
          ]),
          el("strong", { classe: "etiqueta-vezes", texto: String(c.vezes) }),
        ]),
      ),
    ),
  ]);
}

/* ---------- ranking ---------- */

function cartaoRanking(postos) {
  if (postos.length === 0) {
    return el("section", { classe: "cartao" }, [
      el("h3", { texto: "Ranking da equipe" }),
      el("p", {
        classe: "muted",
        texto: "Cadastre quem atende em “Ajustes da pesquisa” para o cliente poder elogiar pelo nome.",
      }),
    ]);
  }

  const classificados = postos.filter((p) => p.classificado);
  const medalhas = ["🥇", "🥈", "🥉"];

  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "Ranking da equipe" }),
        el("p", {
          classe: "muted",
          texto: "Média das estrelas dadas pelos clientes. Quem tem menos de 5 avaliações ainda não entra na disputa.",
        }),
      ]),
    ]),
    el(
      "div",
      { classe: "rolagem-x", style: "margin-top:10px" },
      [
        el("table", { classe: "planilha" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { texto: "" }),
              el("th", { texto: "Pessoa" }),
              el("th", { classe: "col-num", texto: "Média" }),
              el("th", { classe: "col-num", texto: "Avaliações" }),
              el("th", { classe: "col-num", texto: "5 estrelas" }),
            ]),
          ]),
          el(
            "tbody",
            {},
            postos.map((p, i) =>
              el("tr", {}, [
                el("td", { texto: p.classificado && i < 3 ? medalhas[i] : "" }),
                el("td", {}, [
                  el("strong", { texto: p.nome }),
                  p.classificado
                    ? null
                    : el("small", {
                        classe: "muted",
                        texto: `faltam ${5 - p.avaliacoes} avaliações para entrar no ranking`,
                      }),
                ]),
                el("td", { classe: "col-num" }, [
                  el("span", { texto: "★".repeat(Math.round(p.media)), style: "color:var(--alerta)" }),
                  el("small", { classe: "muted", texto: p.media.toFixed(1).replace(".", ",") }),
                ]),
                el("td", { classe: "col-num", texto: String(p.avaliacoes) }),
                el("td", { classe: "col-num", texto: String(p.cincoEstrelas) }),
              ]),
            ),
          ),
        ]),
      ],
    ),
    classificados.length === 0
      ? el("p", {
          classe: "muted",
          style: "margin-top:10px",
          texto: "Ninguém tem avaliações suficientes ainda — o ranking fica assim até as primeiras 5 por pessoa.",
        })
      : null,
  ]);
}
