import { get } from "../api.js";
import { dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * As respostas uma a uma, como o cliente as preencheu.
 *
 * O painel responde "como andam as coisas" — média, NPS, nota por categoria.
 * Nenhuma média responde "por que ESSA pessoa foi embora chateada", e é essa a
 * pergunta que faz alguém pegar o telefone.
 *
 * As notas por pergunta já eram gravadas desde o começo; viravam "Cozinha:
 * 4,2" no painel e não apareciam em mais lugar nenhum. O dono via QUE alguém
 * reclamou e nunca DO QUÊ.
 */

const PERIODOS = [
  ["7", "7 dias"],
  ["30", "30 dias"],
  ["90", "90 dias"],
  ["365", "1 ano"],
];

const FILTROS = [
  ["", "Todas"],
  ["6", "Só quem saiu insatisfeito (0 a 6)"],
  ["8", "Tudo abaixo de 9"],
];

export async function pesquisaRespostas(raiz, ctx) {
  const lista = el("div", { classe: "pilha" });
  const detalhe = el("div");

  const periodo = el(
    "select",
    { classe: "select" },
    PERIODOS.map(([v, r]) => el("option", { value: v, texto: r, selected: v === "30" })),
  );
  const filtro = el(
    "select",
    { classe: "select" },
    FILTROS.map(([v, r]) => el("option", { value: v, texto: r })),
  );
  periodo.addEventListener("change", carregar);
  filtro.addEventListener("change", carregar);

  raiz.append(
    el("div", { classe: "pilha" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Respostas, uma a uma" }),
          el("p", {
            classe: "muted",
            texto: "Clique numa linha para ler tudo o que a pessoa respondeu, pergunta por pergunta.",
          }),
        ]),
        el("div", { classe: "linha-campos" }, [
          el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Período" }), periodo]),
          el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Mostrar" }), filtro]),
        ]),
      ]),
      detalhe,
      lista,
    ]),
  );

  await carregar();

  async function carregar() {
    limpar(detalhe);
    limpar(lista).append(el("p", { classe: "muted", texto: "Carregando…" }));

    const nota = filtro.value ? `&nota_max=${filtro.value}` : "";
    let respostas;
    try {
      respostas = await get(`/v1/venues/${ctx.venue}/pesquisa/respostas?dias=${periodo.value}${nota}`);
    } catch (e) {
      limpar(lista).append(vazio("Não deu para carregar", e.message));
      return;
    }

    limpar(lista);
    if (respostas.length === 0) {
      lista.append(
        vazio(
          "Nenhuma resposta neste período",
          "Aumente o período, ou mude o filtro para “Todas”.",
        ),
      );
      return;
    }

    lista.append(tabela(respostas, abrir));
  }

  async function abrir(id) {
    limpar(detalhe).append(el("p", { classe: "muted", texto: "Abrindo…" }));
    try {
      const r = await get(`/v1/venues/${ctx.venue}/pesquisa/respostas/${id}`);
      limpar(detalhe).append(cartaoDaResposta(r, () => limpar(detalhe)));
      detalhe.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      limpar(detalhe).append(vazio("Não deu para abrir", e.message));
    }
  }
}

/* ---------- a lista ---------- */

function tabela(respostas, aoClicar) {
  return el("section", { classe: "cartao" }, [
    el("div", { classe: "rolagem-x" }, [
      el("table", { classe: "planilha planilha-clicavel" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { texto: "Quando" }),
            el("th", { classe: "col-num", texto: "Nota" }),
            el("th", { texto: "Cliente" }),
            el("th", { texto: "Mesa" }),
            el("th", { texto: "O que disse" }),
          ]),
        ]),
        el(
          "tbody",
          {},
          respostas.map((r) => {
            const linha = el("tr", { style: "cursor:pointer" }, [
              el("td", { texto: dataHora(r.created_at) }),
              el("td", { classe: "col-num" }, [etiqueta(String(r.nota), classeDaNota(r.nota))]),
              el("td", {}, [
                el("strong", { texto: r.cliente_nome || "Anônimo" }),
                r.cliente_contato ? el("small", { classe: "muted", texto: r.cliente_contato }) : null,
              ]),
              el("td", { texto: r.mesa || "—" }),
              // Quebra o `nowrap` da planilha de propósito: é a coluna que
              // precisa ser lida, e é o motivo de a tela existir.
              el("td", { style: "white-space:normal;max-width:44ch" }, [
                el("span", { texto: resumoDoQueDisse(r) }),
              ]),
            ]);
            linha.addEventListener("click", () => aoClicar(r.id));
            return linha;
          }),
        ),
      ]),
    ]),
  ]);
}

function resumoDoQueDisse(r) {
  if (r.comentario) return r.comentario;
  const criticas = (r.criticas ?? []).join(", ");
  if (criticas) return `Marcou: ${criticas}`;
  const elogios = (r.elogios ?? []).join(", ");
  if (elogios) return `Elogiou: ${elogios}`;
  return "Só deu a nota";
}

function classeDaNota(nota) {
  if (nota >= 9) return "etiqueta-ok";
  if (nota >= 7) return "etiqueta-alerta";
  return "etiqueta-perigo";
}

/* ---------- a resposta inteira ---------- */

/**
 * A folha A4 da avaliação — desenhada para o papel, não copiada da tela.
 *
 * O cartão do painel é feito para rolar num monitor; papel não rola, e o que
 * cabe numa folha é o que a equipe lê. Então os números viram selos no topo
 * (é o que se olha primeiro num PDF aberto no celular), a fala do cliente
 * ganha destaque logo abaixo, e as notas por assunto vão para duas colunas —
 * cada linha é curta, e uma coluna só gastaria metade da folha em branco.
 */
function folhaDaAvaliacao(r) {
  const media = mediaDaExperiencia(r.itens ?? []);
  const casa = document.getElementById("marca-org")?.textContent || "Brasa Food";

  const porCategoria = new Map();
  for (const item of r.itens ?? []) {
    if (!porCategoria.has(item.categoria)) porCategoria.set(item.categoria, []);
    porCategoria.get(item.categoria).push(item);
  }
  const categorias = [...porCategoria.entries()]
    .map(([nome, itens]) => ({ nome, itens, media: mediaDe(itens) }))
    .sort((a, b) => (a.media ?? 99) - (b.media ?? 99));

  const selo = (valor, rotulo, ruim) =>
    el("div", { classe: `folha-selo ${ruim ? "ruim" : ""}`.trim() }, [
      el("b", { texto: valor }),
      el("span", { texto: rotulo }),
    ]);

  const tags = (rotulo, valores, classe) => {
    const lista = (valores ?? []).filter(Boolean);
    if (lista.length === 0) return null;
    return el("div", { classe: "folha-tags" }, [
      el("span", { classe: "folha-rotulo", texto: rotulo }),
      ...lista.map((v) => el("span", { classe: `folha-tag ${classe}`, texto: v })),
    ]);
  };

  return el("div", { classe: "folha" }, [
    el("div", { classe: "folha-topo" }, [
      el("span", { classe: "folha-casa", texto: casa }),
      el("span", { classe: "folha-tipo", texto: `Avaliação de cliente · ${dataHora(r.created_at)}` }),
    ]),

    el("div", { classe: "folha-selos" }, [
      selo(String(r.nota), "Recomendação", r.nota <= 6),
      media !== null ? selo(numero(media), "Experiência", media < 6) : null,
      el("div", { classe: "folha-quem" }, [
        el("b", { texto: r.cliente_nome || "Cliente anônimo" }),
        el("span", { texto: linhaDeContexto(r) }),
        r.cliente_contato ? el("span", { texto: r.cliente_contato }) : null,
      ]),
    ]),

    r.comentario ? el("p", { classe: "folha-citacao", texto: `“${r.comentario}”` }) : null,

    tags("Agradou", r.elogios, "bom"),
    tags("Incomodou", r.criticas, "ruim"),

    categorias.length > 0
      ? el("div", {}, [
          el("div", { classe: "folha-secao", texto: "Notas por assunto" }),
          el(
            "div",
            { classe: "folha-assuntos" },
            categorias.map((c) =>
              el("div", { classe: "folha-assunto" }, [
                el("div", { classe: "folha-assunto-topo" }, [
                  el("span", { texto: c.nome }),
                  el("span", {
                    classe: "folha-assunto-nota",
                    texto: c.media === null ? "—" : numero(c.media),
                  }),
                ]),
                ...c.itens.map((i) =>
                  el("div", { classe: `folha-pergunta ${i.nota !== null && i.nota < 6 ? "ruim" : ""}`.trim() }, [
                    el("span", { texto: i.pergunta }),
                    el("b", { texto: i.nota === null ? "—" : numero(i.nota) }),
                  ]),
                ),
              ]),
            ),
          ),
        ])
      : null,

    el("div", { classe: "folha-rodape" }, [
      el("span", {
        texto: r.atendente_nome
          ? `Atendeu: ${r.atendente_nome}${r.atendente_nota ? ` — ${estrelas(r.atendente_nota)}` : ""}`
          : "Sem atendente indicado",
      }),
      el("span", { texto: r.premio ? `Cupom ${r.premio.codigo}` : "" }),
    ]),
  ]);
}

/**
 * Gera o PDF pelo próprio navegador.
 *
 * Sem biblioteca e sem rota nova: monta a folha, manda imprimir e deixa o
 * "Salvar como PDF" do aparelho fazer o resto. Funciona no computador do
 * escritório e no celular do gerente — que é de onde o arquivo vai ser
 * encaminhado para a equipe.
 *
 * O título da página vira o NOME DO ARQUIVO na maioria dos navegadores, e
 * por isso ele é trocado antes de imprimir: "avaliacao-pedro-vidal-nota-4.pdf"
 * diz o que é no grupo do WhatsApp; "app.pdf" não diz nada.
 */
function imprimirAvaliacao(r) {
  const tituloAntes = document.title;
  const soLetras = (t) =>
    (t ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();

  const dia = new Date(r.created_at).toLocaleDateString("pt-BR").replaceAll("/", "-");
  document.title = `avaliacao-${soLetras(r.cliente_nome) || "anonimo"}-nota-${r.nota}-${dia}`;

  // A folha nasce agora e morre depois de imprimir: deixá-la no documento
  // faria a próxima avaliação aberta empilhar mais uma no papel.
  const folha = folhaDaAvaliacao(r);
  document.body.append(folha);
  document.documentElement.setAttribute("data-imprimindo", "1");

  const limpar = () => {
    document.documentElement.removeAttribute("data-imprimindo");
    folha.remove();
    document.title = tituloAntes;
  };
  // `afterprint` cobre o caminho normal; o tempo é a rede de segurança para
  // navegador que não dispara o evento (acontece em alguns celulares) e
  // deixaria a folha pendurada no documento.
  addEventListener("afterprint", limpar, { once: true });
  setTimeout(limpar, 60_000);

  print();
}

function cartaoDaResposta(r, fechar) {
  const fechado = el("button", { classe: "btn btn-peq", texto: "Fechar" });
  fechado.addEventListener("click", fechar);

  const botaoPdf = el("button", {
    classe: "btn btn-peq",
    type: "button",
    texto: "📄 Gerar PDF",
    title: "Abre a impressão — escolha “Salvar como PDF” para mandar à equipe",
  });

  // As perguntas ficam agrupadas por categoria, e as piores primeiro. É a
  // mesma razão do painel: a tela existe para achar o problema, e em ordem
  // alfabética "Ambiente 9" ficaria acima de "Cozinha 2".
  const porCategoria = new Map();
  for (const item of r.itens ?? []) {
    if (!porCategoria.has(item.categoria)) porCategoria.set(item.categoria, []);
    porCategoria.get(item.categoria).push(item);
  }
  const categorias = [...porCategoria.entries()]
    .map(([nome, itens]) => ({ nome, itens, media: mediaDe(itens) }))
    .sort((a, b) => (a.media ?? 99) - (b.media ?? 99));

  const cartao = el("section", { classe: `cartao ${r.nota <= 6 ? "cartao-atencao" : ""}` }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: `Nota ${r.nota} — ${r.cliente_nome || "Anônimo"}` }),
        el("p", { classe: "muted", texto: linhaDeContexto(r) }),
      ]),
      el("div", { classe: "linha-campos" }, [botaoPdf, fechado]),
    ]),

    // A recomendação e a experiência lado a lado. Elas discordam com
    // frequência, e é aí que ficam úteis: nota 9 com experiência 4 é o cliente
    // que gosta da casa e teve uma noite ruim — o mais fácil de recuperar.
    (() => {
      const media = mediaDaExperiencia(r.itens ?? []);
      if (media === null) return null;
      return el("p", { classe: "muted", style: "margin-top:4px" }, [
        el("span", { texto: "Recomendação " }),
        el("strong", { texto: String(r.nota) }),
        el("span", { texto: " · Média da experiência " }),
        el("strong", { texto: numero(media) }),
      ]);
    })(),

    r.cliente_contato
      ? el("p", { style: "margin-top:6px" }, [
          el("strong", { texto: "Contato: " }),
          el("span", { texto: r.cliente_contato }),
        ])
      : el("p", { classe: "muted", style: "margin-top:6px", texto: "Respondeu sem deixar contato." }),

    // O que ela escreveu vem ANTES das notas. É a única parte em que o cliente
    // fala com as palavras dele, e é o que responde "do que ele reclamou".
    r.comentario
      ? el("blockquote", { classe: "citacao", style: "margin-top:12px" }, [
          el("p", { texto: `"${r.comentario}"` }),
        ])
      : null,

    etiquetasDe("O que agradou", r.elogios, "etiqueta-ok"),
    etiquetasDe("O que incomodou", r.criticas, "etiqueta-perigo"),

    categorias.length > 0
      ? el("div", { style: "margin-top:16px" }, [
          el("h4", { texto: "Pergunta por pergunta" }),
          el("div", { classe: "pilha", style: "margin-top:8px" }, categorias.map(blocoDaCategoria)),
        ])
      : el("p", {
          classe: "muted",
          style: "margin-top:14px",
          texto:
            "Esta resposta veio antes de a casa montar a pesquisa por categoria — tem só a nota geral.",
        }),

    r.atendente_nome
      ? el("p", { classe: "muted", style: "margin-top:14px" }, [
          el("span", { texto: `Atendeu: ${r.atendente_nome}` }),
          r.atendente_nota ? el("span", { texto: ` — ${estrelas(r.atendente_nota)}` }) : null,
        ])
      : null,

    r.premio
      ? el("p", { classe: "muted", style: "margin-top:6px" }, [
          el("span", {
            texto: `Cupom ${r.premio.codigo} · ${r.premio.titulo}${r.premio.resgatado_em ? " · já resgatado" : ""}`,
          }),
        ])
      : null,
  ]);

  botaoPdf.addEventListener("click", () => imprimirAvaliacao(r));
  return cartao;
}

function linhaDeContexto(r) {
  const partes = [dataHora(r.created_at)];
  if (r.mesa) partes.push(`Mesa ${r.mesa}`);
  partes.push(r.origem === "whatsapp" ? "por link no WhatsApp" : "pelo QR da mesa");
  return partes.join(" · ");
}

function etiquetasDe(titulo, valores, classe) {
  const lista = (valores ?? []).filter(Boolean);
  if (lista.length === 0) return null;
  return el("div", { style: "margin-top:12px" }, [
    el("h4", { texto: titulo }),
    el(
      "div",
      { classe: "etiquetas", style: "margin-top:6px" },
      lista.map((t) => etiqueta(t, classe)),
    ),
  ]);
}

function blocoDaCategoria(c) {
  return el("div", { classe: "cartao-interno" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("h4", { texto: c.nome }),
      c.media === null ? null : etiqueta(numero(c.media), classeDaNota(c.media)),
    ]),
    el(
      "div",
      { classe: "pilha-fina", style: "margin-top:8px" },
      c.itens.map((i) =>
        el("div", { classe: "linha-pergunta" }, [
          el("div", {}, [
            el("span", { texto: i.pergunta }),
            // O que a pessoa escreveu NAQUELA pergunta. É onde mora o "do que
            // ela reclamou" quando ela não escreve no comentário geral.
            i.texto ? el("p", { classe: "citacao-fina", texto: `"${i.texto}"` }) : null,
          ]),
          el("strong", { texto: respostaLegivel(i) }),
        ]),
      ),
    ),
  ]);
}

/**
 * Como o cliente respondeu, na forma em que ele respondeu.
 *
 * Mostrar "10" onde ele clicou "Sim" faria o dono conferir a conta em vez de
 * ler a resposta. A nota normalizada serve para a média, não para a leitura.
 */
function respostaLegivel(i) {
  if (i.tipo === "sim_nao") return i.valor === "sim" || i.valor === "true" ? "Sim" : "Não";
  if (i.tipo === "estrelas") return estrelas(i.valor);
  if (i.tipo === "texto") return i.texto ? "" : "—";
  return i.nota === null ? (i.valor ?? "—") : numero(i.nota);
}

/**
 * As cinco posições sempre aparecem: "★☆☆☆☆", não "★".
 *
 * Só a estrela cheia não diz se foi 1 de 5 ou 1 de 3 — e uma estrela de cinco
 * é uma reclamação grave que ficaria com cara de elogio tímido.
 */
function estrelas(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const cheias = Math.min(Math.round(n), 5);
  return "★".repeat(cheias) + "☆".repeat(5 - cheias);
}

/**
 * A média de tudo o que o cliente pontuou nesta resposta.
 *
 * A mesma conta do servidor, repetida aqui: a tela já tem os itens na mão, e
 * mandar o número pronto obrigaria a rota de detalhe a calcular algo que ela
 * não usa para mais nada.
 */
function mediaDaExperiencia(itens) {
  return mediaDe(itens ?? []);
}

function mediaDe(itens) {
  const notas = itens.map((i) => i.nota).filter((n) => typeof n === "number");
  if (notas.length === 0) return null;
  return notas.reduce((s, n) => s + n, 0) / notas.length;
}

function numero(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}
