import { del, get, patch, post, postArquivo, put } from "../api.js";
import { avisar, dataHora, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * O que a casa configura na pesquisa, em quatro abas.
 *
 * Separado do painel de propósito: o dono abre o painel toda semana e esta
 * tela três vezes na vida — no dia que instala, no dia que troca o prêmio e no
 * dia que contrata alguém. Misturar as duas coisas faria a tela que importa
 * abrir cheia de formulário.
 */

const ABAS = [
  ["perguntas", "As perguntas"],
  ["qrcode", "QR code da mesa"],
  ["equipe", "Quem atende"],
  ["premio", "O prêmio"],
  ["convites", "Enviar para o cliente"],
];

export async function pesquisaAjustes(raiz, ctx) {
  let abaAtual = "perguntas";
  const conteudo = el("div", { classe: "pilha" });

  const barra = el(
    "div",
    { classe: "abas" },
    ABAS.map(([id, rotulo]) =>
      el("button", {
        classe: `aba ${id === abaAtual ? "aba-ativa" : ""}`.trim(),
        type: "button",
        texto: rotulo,
        "data-aba": id,
        onclick: () => {
          abaAtual = id;
          for (const b of barra.querySelectorAll("[data-aba]")) {
            b.classList.toggle("aba-ativa", b.dataset.aba === id);
          }
          desenhar();
        },
      }),
    ),
  );

  raiz.append(el("div", { classe: "pilha" }, [barra, conteudo]));
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    try {
      const telas = { perguntas: telaPerguntas, qrcode: telaQrcode, equipe: telaEquipe, premio: telaPremio, convites: telaConvites };
      limpar(conteudo).append(await telas[abaAtual](ctx, desenhar));
    } catch (e) {
      limpar(conteudo).append(vazio("Não deu para carregar", e.message));
    }
  }
}

/* ============ As perguntas da casa ============ */

const TIPOS_DE_PERGUNTA = [
  ["nota", "Nota de 0 a 10"],
  ["estrelas", "Estrelas (1 a 5)"],
  ["sim_nao", "Sim ou não"],
  ["texto", "Resposta escrita"],
];

/**
 * Montar a pesquisa, como se monta um checklist.
 *
 * O caminho principal é a IA: uma tela em branco com "adicione uma pergunta"
 * produz pesquisa de três perguntas genéricas, e pesquisa genérica não muda
 * decisão nenhuma. Quem quiser mexer à mão mexe — tudo fica editável depois.
 */
async function telaPerguntas(ctx, recarregar) {
  const dados = await get(`/v1/venues/${ctx.venue}/pesquisa/modelos`);
  const ativa = dados.pesquisas.find((p) => p.ativa) ?? null;

  return el("div", { classe: "pilha" }, [
    blocoCriar(ctx, recarregar, dados.categorias),
    ativa
      ? editorDaPesquisa(ctx, ativa, dados.categorias, recarregar)
      : el("section", { classe: "cartao" }, [
          el("h3", { texto: "Nenhuma pesquisa montada ainda" }),
          el("p", {
            classe: "muted",
            texto: "Sem pesquisa própria, o QR code pergunta só a nota geral. Monte a sua acima para ter nota separada por assunto.",
          }),
        ]),
    dados.pesquisas.filter((p) => !p.ativa).length > 0
      ? listaDeModelos(ctx, dados.pesquisas, recarregar)
      : null,
  ]);
}

/**
 * Os dois caminhos para criar uma pesquisa, lado a lado.
 *
 * À mão não é o "modo avançado": é o caminho de quem já sabe o que quer
 * perguntar, e de quem tentou pela IA e prefere terminar sozinho. Esconder
 * essa porta obriga a conversar com a IA para chegar a uma tabela que está
 * ali do lado.
 */
function blocoCriar(ctx, recarregar, categorias) {
  const area = el("div");
  let aberto = null;

  function abrir(qual, construir) {
    // Clicar de novo no mesmo botão fecha: é como se sai de um caminho que
    // não era o desejado, sem precisar recarregar a tela.
    if (aberto === qual) {
      aberto = null;
      limpar(area);
    } else {
      aberto = qual;
      limpar(area).append(construir());
    }
    for (const b of botoes) b.classList.toggle("btn-primario", b.dataset.qual === aberto);
  }

  const botoes = [
    el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Montar com IA",
      "data-qual": "ia",
      onclick: () => abrir("ia", () => blocoMontagemIA(ctx, recarregar, categorias)),
    }),
    el("button", {
      classe: "btn btn-peq",
      type: "button",
      texto: "Criar à mão",
      "data-qual": "mao",
      onclick: () => abrir("mao", () => blocoManual(ctx, recarregar, categorias)),
    }),
  ];

  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "Criar uma pesquisa" }),
        el("p", {
          classe: "muted",
          texto: "Converse com a IA e ela propõe as perguntas, ou escreva você mesmo. Nos dois casos dá para editar tudo depois.",
        }),
      ]),
      el("div", { classe: "linha-campos" }, botoes),
    ]),
    area,
  ]);
}

/** A tabela vazia, para quem já sabe o que quer perguntar. */
function blocoManual(ctx, recarregar, categorias) {
  const nome = el("input", { value: "Pesquisa da casa", required: true });
  // Uma linha já preenchida com um exemplo: a tabela totalmente vazia não
  // mostra como uma pergunta se parece, e o primeiro clique vira dúvida.
  const editor = editorDeItens(
    [{ categoria: "Comida", pergunta: "A comida agradou?", tipo: "nota", obrigatorio: false }],
    categorias,
  );

  return el("div", { style: "margin-top:14px" }, [
    el("p", {
      classe: "muted",
      texto: "Cada linha é uma pergunta. O ASSUNTO é o que agrupa as notas no painel — perguntas do mesmo assunto aparecem na mesma tela do cliente.",
    }),
    el("div", { classe: "campo", style: "margin-top:10px;max-width:360px" }, [
      el("label", { texto: "Nome da pesquisa" }),
      nome,
    ]),
    editor.elemento,
    el("button", {
      classe: "btn btn-primario",
      type: "button",
      texto: "Salvar e usar esta pesquisa",
      style: "margin-top:12px",
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          await post(`/v1/venues/${ctx.venue}/pesquisa/modelos`, {
            nome: nome.value.trim(),
            itens: editor.ler(),
            ativar: true,
          });
          avisar("Pesquisa no ar. O QR code da mesa já pergunta isso.", "ok");
          await recarregar();
        } catch (err) {
          avisar(err.message, "erro");
          e.target.disabled = false;
        }
      },
    }),
  ]);
}

function blocoMontagemIA(ctx, recarregar, categorias) {
  const conversa = [];
  const historico = el("div", { classe: "pilha", style: "gap:10px" });
  const proposta = el("div");

  const campo = el("textarea", {
    rows: 3,
    placeholder:
      "Ex.: bar com música ao vivo em Cuiabá, 120 lugares, área externa. Ando desconfiado que a cozinha está demorando nos fins de semana.",
    style: "width:100%;font-family:inherit;font-size:0.95rem",
  });

  const enviar = el("button", {
    classe: "btn btn-primario",
    type: "button",
    texto: "Conversar com a IA",
    onclick: falar,
  });

  // Recomeçar do zero: depois de duas rodadas a conversa carrega o contexto
  // errado, e insistir nela é mais trabalhoso que começar de novo. Sem este
  // botão o único jeito era sair da tela e voltar.
  const recomecar = el("button", {
    classe: "btn btn-peq",
    type: "button",
    texto: "Começar de novo",
    hidden: true,
    onclick: () => {
      conversa.length = 0;
      limpar(historico);
      limpar(proposta);
      campo.value = "";
      enviar.textContent = "Conversar com a IA";
      recomecar.hidden = true;
    },
  });

  return el("div", { style: "margin-top:14px" }, [
    el("p", {
      classe: "muted",
      texto: "Conte que tipo de casa é a sua e o que você quer descobrir. A IA pergunta o que faltar e monta as perguntas — você confere antes de valer.",
    }),
    historico,
    el("div", { classe: "campo campo-largo", style: "margin-top:10px" }, [campo]),
    el("div", { classe: "linha-campos" }, [enviar, recomecar]),
    proposta,
  ]);

  function balao(papel, texto) {
    return el("div", { classe: `balao ${papel === "ia" ? "balao-assistant" : "balao-user"}` }, [
      el("span", { classe: "balao-meta", texto: papel === "ia" ? "IA" : "Você" }),
      el("span", { texto }),
    ]);
  }

  async function falar() {
    const dito = campo.value.trim();
    if (!dito) return avisar("Escreva alguma coisa para a IA trabalhar.", "erro");

    conversa.push({ papel: "usuario", texto: dito });
    historico.append(balao("usuario", dito));
    campo.value = "";
    enviar.disabled = true;
    enviar.textContent = "Pensando…";
    limpar(proposta);

    try {
      const r = await post(`/v1/venues/${ctx.venue}/pesquisa/montar`, { mensagens: conversa });
      if (r.tipo === "pergunta") {
        conversa.push({ papel: "ia", texto: r.texto });
        historico.append(balao("ia", r.texto));
      } else {
        // O turno da IA PRECISA entrar no histórico, e com a lista dentro.
        //
        // Sem ele, a próxima mensagem da pessoa virava o segundo "usuario"
        // seguido e a API recusava a conversa inteira — era por isso que
        // acrescentar uma informação depois de a IA gerar não gerava nada.
        // E com a lista dentro, o pedido seguinte ("acrescente uma sobre
        // estacionamento") parte do que já existe em vez de recomeçar do zero.
        // A lista vai como TEXTO legível, e não como JSON cru: é assim que o
        // modelo entende o que já propôs quando o pedido seguinte for "tira a
        // de preço". Guardá-la é o que faz a continuação partir do que existe
        // em vez de recomeçar do zero.
        conversa.push({
          papel: "ia",
          texto:
            "Perguntas que propus:\n" +
            r.itens
              .map((i, n) => `${n + 1}. [${i.categoria}] ${i.pergunta} (${i.tipo})`)
              .join("\n"),
        });
        historico.append(
          balao("ia", `Montei ${r.itens.length} perguntas — confira abaixo. Pode pedir para mudar, tirar ou acrescentar.`),
        );
        proposta.append(revisarProposta(ctx, r.itens, categorias, recarregar));
      }
      recomecar.hidden = false;
      campo.placeholder = "Ex.: acrescente uma pergunta sobre o estacionamento e tira a de preço.";
    } catch (e) {
      avisar(e.message, "erro");
    } finally {
      enviar.disabled = false;
      enviar.textContent = "Continuar a conversa";
    }
  }
}

/** O que a IA propôs, editável, antes de virar a pesquisa da casa. */
function revisarProposta(ctx, itens, categorias, recarregar) {
  const nome = el("input", { value: "Pesquisa da casa", required: true });
  const editor = editorDeItens(itens, categorias);

  return el("div", { classe: "cartao", style: "margin-top:14px;background:var(--fundo)" }, [
    el("h4", { texto: "Confira antes de valer" }),
    el("p", { classe: "muted", texto: "Mude o que quiser. Nada vai para a mesa antes de você salvar." }),
    el("div", { classe: "campo", style: "margin-top:10px;max-width:360px" }, [
      el("label", { texto: "Nome da pesquisa" }),
      nome,
    ]),
    editor.elemento,
    el("button", {
      classe: "btn btn-primario",
      type: "button",
      texto: "Salvar e usar esta pesquisa",
      style: "margin-top:12px",
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          await post(`/v1/venues/${ctx.venue}/pesquisa/modelos`, {
            nome: nome.value.trim(),
            itens: editor.ler(),
            ativar: true,
          });
          avisar("Pesquisa no ar. O QR code da mesa já pergunta isso.", "ok");
          await recarregar();
        } catch (err) {
          avisar(err.message, "erro");
          e.target.disabled = false;
        }
      },
    }),
  ]);
}

/** A pesquisa que está no ar, editável. */
function editorDaPesquisa(ctx, pesquisa, categorias, recarregar) {
  const nome = el("input", { value: pesquisa.nome, required: true });
  const editor = editorDeItens(pesquisa.itens, categorias);

  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "A pesquisa que está no ar" }),
        el("p", { classe: "muted", texto: "É esta que o QR code da mesa abre agora." }),
      ]),
      etiqueta("no ar", "etiqueta-ok"),
    ]),
    el("div", { classe: "campo", style: "margin-top:10px;max-width:360px" }, [
      el("label", { texto: "Nome" }),
      nome,
    ]),
    editor.elemento,
    el("div", { classe: "linha-campos", style: "margin-top:12px" }, [
      el("button", {
        classe: "btn btn-primario",
        type: "button",
        texto: "Salvar",
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            await patch(`/v1/venues/${ctx.venue}/pesquisa/modelos/${pesquisa.id}`, {
              nome: nome.value.trim(),
              itens: editor.ler(),
            });
            avisar("Pesquisa salva.", "ok");
            await recarregar();
          } catch (err) {
            avisar(err.message, "erro");
            e.target.disabled = false;
          }
        },
      }),
      el("button", {
        classe: "btn btn-peq",
        type: "button",
        texto: "Tirar do ar",
        title: "O QR code volta a perguntar só a nota geral.",
        onclick: async () => {
          try {
            await patch(`/v1/venues/${ctx.venue}/pesquisa/modelos/${pesquisa.id}`, { ativa: false });
            avisar("Pesquisa fora do ar.", "ok");
            await recarregar();
          } catch (err) {
            avisar(err.message, "erro");
          }
        },
      }),
    ]),
  ]);
}

/**
 * A lista de perguntas em linhas editáveis.
 *
 * Devolve o elemento e uma função para ler o que está na tela — em vez de
 * manter um estado paralelo que precisaria ser sincronizado a cada tecla.
 */
/** Os dias como o dono lê, na ordem da semana brasileira: 0 = domingo. */
const DIAS_DA_SEMANA = [
  [1, "seg"], [2, "ter"], [3, "qua"], [4, "qui"], [5, "sex"], [6, "sáb"], [0, "dom"],
];

function editorDeItens(itens, categorias) {
  const corpo = el("tbody");

  /**
   * QUANDO PERGUNTAR, por assunto.
   *
   * A regra mora em cada pergunta no banco, mas ninguém pensa "esta pergunta
   * é de segunda a quinta" — pensa "o rodízio é de segunda a quinta". Então
   * a tela edita por assunto e, ao salvar, carimba em todas as perguntas do
   * grupo. Ao abrir, lê de volta da primeira pergunta de cada assunto.
   */
  const regras = new Map(); // assunto -> { dias: Set, de, ate }
  for (const item of itens) {
    const nome = (item.categoria ?? "Geral").trim();
    if (regras.has(nome)) continue;
    regras.set(nome, {
      dias: new Set(Array.isArray(item.dias) ? item.dias : []),
      de: item.de ?? "",
      ate: item.ate ?? "",
    });
  }
  const regraDe = (nome) => {
    if (!regras.has(nome)) regras.set(nome, { dias: new Set(), de: "", ate: "" });
    return regras.get(nome);
  };

  const painelQuando = el("div", { classe: "pilha", style: "gap:6px" });
  function desenharQuando() {
    limpar(painelQuando);
    const assuntos = [...new Set([...corpo.children].map((tr) => tr._campos.categoria.value.trim() || "Geral"))];
    if (assuntos.length === 0) return;
    painelQuando.append(
      el("p", { classe: "muted", style: "margin:0", texto: "Quando perguntar — sem nada marcado, o assunto aparece sempre. Marque os dias da promoção, ou um período." }),
    );
    for (const nome of assuntos) {
      const r = regraDe(nome);
      const chips = DIAS_DA_SEMANA.map(([n, rotulo]) => {
        const b = el("button", {
          type: "button",
          classe: `btn btn-peq${r.dias.has(n) ? " btn-primario" : ""}`,
          texto: rotulo,
          "aria-pressed": String(r.dias.has(n)),
          onclick: () => {
            if (r.dias.has(n)) r.dias.delete(n); else r.dias.add(n);
            desenharQuando();
          },
        });
        return b;
      });
      const de = el("input", { type: "date", classe: "campo-celula", value: r.de, title: "Começa em", onchange: (e) => (r.de = e.target.value) });
      const ate = el("input", { type: "date", classe: "campo-celula", value: r.ate, title: "Termina em", onchange: (e) => (r.ate = e.target.value) });
      painelQuando.append(
        el("div", { classe: "linha-campos", style: "align-items:center;gap:6px;flex-wrap:wrap" }, [
          el("span", { style: "display:inline-flex;gap:2px" }, [
            el("button", { classe: "btn-icone", type: "button", texto: "▲", title: `Mover "${nome}" para antes do assunto anterior`, onclick: () => moverAssunto(nome, -1) }),
            el("button", { classe: "btn-icone", type: "button", texto: "▼", title: `Mover "${nome}" para depois do próximo assunto`, onclick: () => moverAssunto(nome, 1) }),
          ]),
          el("strong", { texto: nome, style: "min-width:140px" }),
          ...chips,
          el("span", { classe: "muted", texto: "de" }),
          de,
          el("span", { classe: "muted", texto: "até" }),
          ate,
        ]),
      );
    }
  }
  // Assunto renomeado, linha nova, linha removida: o painel acompanha.
  corpo.addEventListener("change", desenharQuando);

  /* ---- Ordem: arrastar pela alça, ou setas ----
   *
   * A ordem das linhas É a ordem em que o cliente vê as perguntas — e a
   * ordem dos assuntos é a ordem em que os grupos aparecem pela primeira
   * vez. Não existe campo "posição": reordenar aqui e salvar já basta.
   *
   * Só a alça é arrastável, e não a linha inteira: uma linha `draggable`
   * atrapalha selecionar texto nos campos dela. As setas existem porque
   * arrastar no celular é loteria.
   */
  let arrastando = null;
  corpo.addEventListener("dragover", (e) => {
    if (!arrastando) return;
    e.preventDefault();
    const alvo = e.target.closest("tr");
    if (!alvo || alvo === arrastando) return;
    const caixa = alvo.getBoundingClientRect();
    const depois = e.clientY > caixa.top + caixa.height / 2;
    corpo.insertBefore(arrastando, depois ? alvo.nextSibling : alvo);
  });
  corpo.addEventListener("drop", (e) => e.preventDefault());

  /** Move uma linha um passo para cima ou para baixo. */
  function moverLinha(tr, passo) {
    const vizinha = passo < 0 ? tr.previousElementSibling : tr.nextElementSibling;
    if (!vizinha) return;
    corpo.insertBefore(passo < 0 ? tr : vizinha, passo < 0 ? vizinha : tr);
    desenharQuando();
  }

  /**
   * Move um ASSUNTO inteiro: todas as linhas dele, em bloco, para antes do
   * assunto anterior ou depois do próximo. É o que muda a ordem das telas
   * que o cliente vê — "Comida" antes de "Atendimento", ou o contrário.
   */
  function moverAssunto(nome, passo) {
    const linhas = [...corpo.children];
    const assuntoDe = (tr) => tr._campos.categoria.value.trim() || "Geral";
    const ordem = [...new Set(linhas.map(assuntoDe))];
    const i = ordem.indexOf(nome);
    const j = i + passo;
    if (i < 0 || j < 0 || j >= ordem.length) return;
    const minhas = linhas.filter((tr) => assuntoDe(tr) === nome);
    const delas = linhas.filter((tr) => assuntoDe(tr) === ordem[j]);
    if (passo < 0) for (const tr of minhas) corpo.insertBefore(tr, delas[0]);
    else for (const tr of minhas.reverse()) corpo.insertBefore(tr, delas[delas.length - 1].nextSibling);
    desenharQuando();
  }

  const elemento = el("div", { classe: "pilha", style: "margin-top:12px;gap:8px" }, [
    el("div", { classe: "rolagem-x" }, [
      el("table", { classe: "planilha" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { texto: "", title: "Arraste pela alça, ou use as setas, para mudar a ordem em que o cliente vê as perguntas" }),
            el("th", { texto: "Assunto" }),
            el("th", { texto: "Pergunta" }),
            el("th", { texto: "Como responde" }),
            el("th", { texto: "Obrig." }),
            el("th", { texto: "Entrada", title: "A pergunta que abre o assunto — \"Você comeu o rodízio?\". As outras só aparecem se a resposta for sim. Só vale em pergunta de sim ou não." }),
            el("th", { texto: "É o NPS", title: "A pergunta \"o quanto você indicaria esta casa\". Marque uma: é ela que vira a nota da avaliação." }),
            el("th", { classe: "col-acoes", texto: "" }),
          ]),
        ]),
        corpo,
      ]),
    ]),
    el("div", { classe: "linha-campos" }, [
      el("button", {
        classe: "btn btn-peq",
        type: "button",
        texto: "+ Pergunta",
        onclick: () => {
          corpo.append(linha({ categoria: "Geral", pergunta: "", tipo: "nota", obrigatorio: false }));
          desenharQuando();
        },
      }),
    ]),
    painelQuando,
  ]);

  for (const item of itens) corpo.append(linha(item));
  desenharQuando();

  function linha(item) {
    const lista = `categorias-${Math.random().toString(36).slice(2, 8)}`;
    const campos = {
      categoria: el("input", { value: item.categoria ?? "Geral", list: lista, classe: "campo-celula", style: "width:140px" }),
      pergunta: el("input", { value: item.pergunta ?? "", style: "width:100%;min-width:220px" }),
      tipo: el(
        "select",
        { classe: "campo-celula", style: "width:150px" },
        TIPOS_DE_PERGUNTA.map(([v, r]) => el("option", { value: v, texto: r, selected: v === item.tipo })),
      ),
      obrigatorio: el("input", { type: "checkbox", checked: item.obrigatorio === true }),
      // Só habilita em "sim ou não": é o "sim" que abre o resto do assunto.
      portao: el("input", {
        type: "checkbox",
        checked: item.portao === true,
        disabled: item.tipo !== "sim_nao",
        title: "Esta pergunta abre o assunto: as outras só aparecem se a resposta for sim",
      }),
      // Rádio e não caixa: só uma pergunta pode ser a do NPS, e o rádio diz
      // isso sozinho — marcar outra desmarca a anterior, sem mensagem de erro.
      nps: el("input", {
        type: "radio",
        name: "pergunta-do-nps",
        checked: item.nps === true,
        title: "Esta é a pergunta que vira a nota da avaliação",
      }),
    };
    campos.tipo.addEventListener("change", () => {
      const ehSimNao = campos.tipo.value === "sim_nao";
      campos.portao.disabled = !ehSimNao;
      if (!ehSimNao) campos.portao.checked = false;
    });

    // `datalist` e não `select`: a lista sugere os assuntos comuns e continua
    // aceitando "Estacionamento" ou "Palco", que só existem em algumas casas.
    const sugestoes = el("datalist", { id: lista }, categorias.map((c) => el("option", { value: c })));

    const alca = el("span", {
      classe: "alca-arrastar",
      texto: "⋮⋮",
      title: "Arraste para mudar a ordem",
      style: "cursor:grab;user-select:none;color:var(--texto-fraco,#888);padding:0 4px",
    });
    const tr = el("tr", {}, [
      el("td", { style: "white-space:nowrap" }, [
        alca,
        el("button", { classe: "btn-icone", type: "button", texto: "▲", title: "Subir", onclick: () => moverLinha(tr, -1) }),
        el("button", { classe: "btn-icone", type: "button", texto: "▼", title: "Descer", onclick: () => moverLinha(tr, 1) }),
      ]),
      el("td", {}, [campos.categoria, sugestoes]),
      el("td", {}, [campos.pergunta]),
      el("td", {}, [campos.tipo]),
      el("td", {}, [campos.obrigatorio]),
      el("td", {}, [campos.portao]),
      el("td", {}, [campos.nps]),
      el("td", { classe: "col-acoes" }, [
        el("button", {
          classe: "btn-icone",
          type: "button",
          title: "Remover",
          texto: "🗑️",
          onclick: () => {
            tr.remove();
            desenharQuando();
          },
        }),
      ]),
    ]);
    tr._campos = campos;
    // O id sobrevive ao salvar: sem ele o servidor sorteia outro a cada
    // salvamento, e a resposta de ontem deixa de apontar para a pergunta de hoje.
    tr._id = typeof item.id === "string" && item.id ? item.id : undefined;

    // Só a alça arrasta (ver comentário em `arrastando`).
    alca.addEventListener("mousedown", () => tr.setAttribute("draggable", "true"));
    alca.addEventListener("mouseup", () => tr.removeAttribute("draggable"));
    tr.addEventListener("dragstart", (e) => {
      arrastando = tr;
      tr.style.opacity = "0.5";
      e.dataTransfer.effectAllowed = "move";
      // Firefox só inicia o arrasto com algum dado.
      e.dataTransfer.setData("text/plain", "");
    });
    tr.addEventListener("dragend", () => {
      tr.style.opacity = "";
      tr.removeAttribute("draggable");
      arrastando = null;
      desenharQuando();
    });
    return tr;
  }

  return {
    elemento,
    ler: () =>
      [...corpo.children]
        .map((tr) => {
          const categoria = tr._campos.categoria.value.trim() || "Geral";
          const r = regraDe(categoria);
          return {
            id: tr._id,
            categoria,
            pergunta: tr._campos.pergunta.value.trim(),
            tipo: tr._campos.tipo.value,
            obrigatorio: tr._campos.obrigatorio.checked,
            portao: tr._campos.portao.checked,
            nps: tr._campos.nps.checked,
            // A regra do assunto, carimbada em cada pergunta dele.
            dias: [...r.dias],
            de: r.de || null,
            ate: r.ate || null,
          };
        })
        // Linha em branco é a que o dono adicionou e desistiu de preencher:
        // mandá-la ao servidor só produziria um erro de validação.
        .filter((i) => i.pergunta),
  };
}

function listaDeModelos(ctx, pesquisas, recarregar) {
  return el("section", { classe: "cartao" }, [
    el("h3", { texto: "Outras pesquisas guardadas" }),
    el("p", { classe: "muted", texto: "Só uma fica no ar por vez — é a que o QR code da mesa abre." }),
    el(
      "div",
      { classe: "rolagem-x", style: "margin-top:10px" },
      [
        el("table", { classe: "planilha" }, [
          el(
            "tbody",
            {},
            pesquisas.filter((p) => !p.ativa).map((p) =>
              el("tr", {}, [
                el("td", {}, [el("strong", { texto: p.nome })]),
                el("td", { texto: `${p.itens.length} ${p.itens.length === 1 ? "pergunta" : "perguntas"}` }),
                el("td", { classe: "col-acoes" }, [
                  el("button", {
                    classe: "btn btn-peq",
                    type: "button",
                    texto: "Pôr no ar",
                    onclick: async () => {
                      try {
                        await patch(`/v1/venues/${ctx.venue}/pesquisa/modelos/${p.id}`, { ativa: true });
                        avisar(`"${p.nome}" está no ar.`, "ok");
                        await recarregar();
                      } catch (e) {
                        avisar(e.message, "erro");
                      }
                    },
                  }),
                  el("button", {
                    classe: "btn-icone",
                    type: "button",
                    title: "Apagar",
                    texto: "🗑️",
                    onclick: async () => {
                      if (!confirm(`Apagar "${p.nome}"? As respostas já recebidas continuam no painel.`)) return;
                      try {
                        await del(`/v1/venues/${ctx.venue}/pesquisa/modelos/${p.id}`);
                        await recarregar();
                      } catch (e) {
                        avisar(e.message, "erro");
                      }
                    },
                  }),
                ]),
              ]),
            ),
          ),
        ]),
      ],
    ),
  ]);
}

/* ============ QR code ============ */

async function telaQrcode(ctx) {
  const caixa = el("div", { classe: "pilha" });

  const mesa = el("input", { placeholder: "Ex.: 7 (deixe vazio para um QR geral)" });
  const area = el("div");

  async function gerar() {
    limpar(area).append(el("p", { classe: "muted", texto: "Gerando…" }));
    const busca = mesa.value.trim() ? `?mesa=${encodeURIComponent(mesa.value.trim())}` : "";
    const dados = await get(`/v1/venues/${ctx.venue}/pesquisa/qrcode${busca}`);

    limpar(area).append(
      el("div", { classe: "cartaz-qr" }, [
        el("img", { src: dados.png, alt: "QR code da pesquisa", classe: "qr-imagem" }),
        el("div", {}, [
          el("h3", { texto: dados.mesa ? `Mesa ${dados.mesa}` : "QR code da casa" }),
          el("p", {
            classe: "muted",
            texto: "Imprima e cole na mesa. O cliente aponta a câmera e responde em 30 segundos.",
          }),
          el("p", { classe: "bloco-codigo", texto: dados.url }),
          el("div", { classe: "linha-campos" }, [
            el("button", {
              classe: "btn btn-primario btn-peq",
              type: "button",
              texto: "Imprimir",
              // `window.print()` da própria página: o CSS de impressão esconde
              // o painel e deixa só o cartaz. Abrir uma janela nova seria
              // bloqueado pelo navegador na metade dos celulares.
              onclick: () => window.print(),
            }),
            el("button", {
              classe: "btn btn-peq",
              type: "button",
              texto: "Copiar link",
              onclick: async (e) => {
                try {
                  await navigator.clipboard.writeText(dados.url);
                  avisar("Link copiado.", "ok");
                } catch {
                  // Sem permissão de área de transferência (acontece em
                  // navegador embutido): o link está na tela para copiar à mão.
                  avisar("Copie o link que está na tela.", "erro");
                  e.target.blur();
                }
              },
            }),
          ]),
        ]),
      ]),
    );
  }

  caixa.append(
    el("section", { classe: "cartao" }, [
      el("h3", { texto: "QR code para a mesa" }),
      el("p", {
        classe: "muted",
        texto: "Um QR por mesa deixa você saber de qual mesa veio cada resposta. Sem mesa, funciona igual — só não identifica o lugar.",
      }),
      el("div", { classe: "linha-campos", style: "margin-top:12px" }, [
        el("label", { classe: "campo-rotulado", style: "flex:1" }, [
          el("span", { texto: "Número da mesa (opcional)" }),
          mesa,
        ]),
        el("button", { classe: "btn btn-primario", type: "button", texto: "Gerar QR code", onclick: gerar }),
      ]),
    ]),
    area,
  );

  await gerar();
  return caixa;
}

/* ============ Quem atende ============ */

async function telaEquipe(ctx, recarregar) {
  const equipe = await get(`/v1/venues/${ctx.venue}/pesquisa/atendentes?todos=1`);

  const nome = el("input", { placeholder: "Nome completo", required: true });
  const apelido = el("input", { placeholder: "Como o cliente chama (opcional)" });
  const funcao = el("input", { placeholder: "Salão, bar, cozinha…" });

  const form = el("form", {
    classe: "cartao",
    onsubmit: async (e) => {
      e.preventDefault();
      const botao = form.querySelector("button[type=submit]");
      botao.disabled = true;
      try {
        await post(`/v1/venues/${ctx.venue}/pesquisa/atendentes`, {
          nome: nome.value.trim(),
          apelido: apelido.value.trim() || undefined,
          funcao: funcao.value.trim() || undefined,
        });
        avisar("Pessoa cadastrada.", "ok");
        await recarregar();
      } catch (err) {
        avisar(err.message, "erro");
        botao.disabled = false;
      }
    },
  }, [
    el("h3", { texto: "Cadastrar quem atende" }),
    el("p", {
      classe: "muted",
      texto: "Só quem aparece aqui pode ser elogiado pelo cliente — e só quem é elogiado entra no ranking.",
    }),
    el("div", { classe: "grade", style: "margin-top:12px" }, [
      campo("Nome", nome),
      campo("Apelido", apelido),
      campo("Função", funcao),
    ]),
    el("button", { classe: "btn btn-primario", type: "submit", texto: "Adicionar", style: "margin-top:12px" }),
  ]);

  const lista = el("section", { classe: "cartao" }, [
    el("h3", { texto: `Equipe (${equipe.filter((a) => a.ativo).length} ativos)` }),
    equipe.length === 0
      ? el("p", { classe: "muted", texto: "Ninguém cadastrado ainda." })
      : el("div", { classe: "rolagem-x", style: "margin-top:10px" }, [
          el("table", { classe: "planilha" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { texto: "Nome" }),
                el("th", { texto: "Aparece como" }),
                el("th", { texto: "Função" }),
                el("th", { texto: "Situação" }),
                el("th", { classe: "col-acoes", texto: "" }),
              ]),
            ]),
            el(
              "tbody",
              {},
              equipe.map((a) =>
                el("tr", {}, [
                  el("td", { texto: a.nome }),
                  el("td", { texto: a.apelido || a.nome }),
                  el("td", { texto: a.funcao || "—" }),
                  el("td", {}, [
                    a.ativo ? etiqueta("ativo", "etiqueta-ok") : etiqueta("fora da lista"),
                  ]),
                  el("td", { classe: "col-acoes" }, [
                    el("button", {
                      classe: "btn-icone",
                      type: "button",
                      title: a.ativo ? "Tirar da lista do cliente" : "Voltar para a lista",
                      texto: a.ativo ? "🚫" : "↩️",
                      onclick: async () => {
                        try {
                          await patch(`/v1/venues/${ctx.venue}/pesquisa/atendentes/${a.id}`, { ativo: !a.ativo });
                          await recarregar();
                        } catch (err) {
                          avisar(err.message, "erro");
                        }
                      },
                    }),
                    el("button", {
                      classe: "btn-icone",
                      type: "button",
                      title: "Excluir",
                      texto: "🗑️",
                      onclick: async () => {
                        if (!confirm(`Excluir ${a.nome}? Se já tiver avaliações, ela só sai da lista e o histórico fica.`)) return;
                        try {
                          const r = await del(`/v1/venues/${ctx.venue}/pesquisa/atendentes/${a.id}`);
                          avisar(
                            r.apagado
                              ? "Removido."
                              : "Tem avaliações no histórico, então só saiu da lista do cliente.",
                            "ok",
                          );
                          await recarregar();
                        } catch (err) {
                          avisar(err.message, "erro");
                        }
                      },
                    }),
                  ]),
                ]),
              ),
            ),
          ]),
        ]),
  ]);

  return el("div", { classe: "pilha" }, [form, lista]);
}

/* ============ O prêmio ============ */

async function telaPremio(ctx, recarregar) {
  const [config, premios, venue] = await Promise.all([
    get(`/v1/venues/${ctx.venue}/pesquisa/config`),
    get(`/v1/venues/${ctx.venue}/pesquisa/premios`),
    get(`/v1/venues/${ctx.venue}`),
  ]);

  const campos = {
    ativa: caixaDeMarcar("Pesquisa ligada", config.ativa),
    premio_ativo: caixaDeMarcar("Dar prêmio a quem responde", config.premio_ativo),
    perguntar_atendente: caixaDeMarcar("Perguntar quem atendeu", config.perguntar_atendente),
    atendente_posicao: el("select", { classe: "select" }, [
      el("option", { value: "fim", texto: "No fim da pesquisa", selected: config.atendente_posicao !== "apos_nps" }),
      el("option", { value: "apos_nps", texto: "Logo depois da nota de recomendação", selected: config.atendente_posicao === "apos_nps" }),
    ]),
    perguntar_comentario: caixaDeMarcar("Pedir um comentário escrito", config.perguntar_comentario),
    saudacao: el("input", { value: config.saudacao ?? "", placeholder: "Como foi sua visita?" }),
    premio_titulo: el("input", { value: config.premio_titulo, required: true }),
    premio_regras: el("input", { value: config.premio_regras ?? "", placeholder: "Válido de terça a quinta, não acumula" }),
    premio_validade_dias: el("input", { type: "number", min: "1", max: "365", value: String(config.premio_validade_dias) }),
    agradecimento: el("input", { value: config.agradecimento ?? "", placeholder: "Obrigado! Te esperamos de novo." }),
    detrator_avisar_whatsapp: el("input", {
      value: config.detrator_avisar_whatsapp ?? "",
      placeholder: "(65) 99999-8888 — vazio não avisa ninguém",
    }),
    detrator_nota_maxima: el("input", {
      type: "number",
      min: "0",
      max: "10",
      value: String(config.detrator_nota_maxima ?? 6),
    }),
  };

  const form = el("form", {
    classe: "cartao",
    onsubmit: async (e) => {
      e.preventDefault();
      const botao = form.querySelector("button[type=submit]");
      botao.disabled = true;
      try {
        await put(`/v1/venues/${ctx.venue}/pesquisa/config`, {
          ativa: campos.ativa.querySelector("input").checked,
          premio_ativo: campos.premio_ativo.querySelector("input").checked,
          perguntar_atendente: campos.perguntar_atendente.querySelector("input").checked,
          atendente_posicao: campos.atendente_posicao.value,
          perguntar_comentario: campos.perguntar_comentario.querySelector("input").checked,
          saudacao: campos.saudacao.value.trim(),
          agradecimento: campos.agradecimento.value.trim(),
          premio_titulo: campos.premio_titulo.value.trim(),
          premio_regras: campos.premio_regras.value.trim(),
          premio_validade_dias: Number(campos.premio_validade_dias.value),
          detrator_avisar_whatsapp: campos.detrator_avisar_whatsapp.value.trim(),
          detrator_nota_maxima: Number(campos.detrator_nota_maxima.value),
        });
        avisar("Ajustes salvos.", "ok");
        await recarregar();
      } catch (err) {
        avisar(err.message, "erro");
      } finally {
        botao.disabled = false;
      }
    },
  }, [
    el("h3", { texto: "Como a pesquisa se comporta" }),
    el("div", { classe: "grade-2", style: "margin-top:12px" }, [
      campos.ativa,
      campos.premio_ativo,
      campos.perguntar_atendente,
      campos.perguntar_comentario,
    ]),
    el("div", { classe: "grade", style: "margin-top:14px" }, [
      campo("Onde perguntar quem atendeu", campos.atendente_posicao),
      campo("Pergunta de abertura", campos.saudacao),
      campo("Mensagem de agradecimento", campos.agradecimento),
      campo("Qual é o prêmio", campos.premio_titulo),
      campo("Regras do prêmio", campos.premio_regras),
      campo("Validade do cupom (dias)", campos.premio_validade_dias),
    ]),
    el("p", {
      classe: "muted",
      style: "margin-top:8px",
      texto:
        "O cupom só vale a partir do dia seguinte: é prêmio pela PRÓXIMA visita, não desconto na conta de hoje. " +
        "Mudar o prêmio não mexe nos cupons já entregues — cada um continua valendo o que prometeu a quem respondeu.",
    }),

    el("h3", { texto: "A cara da casa", style: "margin-top:22px" }),
    el("p", {
      classe: "muted",
      texto:
        "A pesquisa é a única tela que o SEU cliente vê. Com a logo e a cor do bar, ela é do bar — " +
        "quem escaneia o QR na mesa não cai numa página de outra empresa.",
    }),
    cartaoDaMarca(ctx, venue, recarregar),

    el("h3", { texto: "Aviso de nota baixa", style: "margin-top:22px" }),
    el("p", {
      classe: "muted",
      texto:
        "Quando entrar uma nota ruim, esse WhatsApp recebe na hora: a nota, o que puxou para baixo, " +
        "o que a pessoa escreveu e como falar com ela. É a chance de ligar no mesmo dia e recuperar o cliente — " +
        "depois de dois dias já não é recuperação, é constrangimento.",
    }),
    el("div", { classe: "grade", style: "margin-top:12px" }, [
      campoComValorSalvo(
        "WhatsApp que recebe o aviso",
        campos.detrator_avisar_whatsapp,
        config.detrator_avisar_whatsapp,
        async () => {
          try {
            await put(`/v1/venues/${ctx.venue}/pesquisa/config`, { detrator_avisar_whatsapp: "" });
            avisar("Aviso desligado — ninguém mais recebe.", "ok");
            await recarregar();
          } catch (e) {
            avisar(e.message, "erro");
          }
        },
      ),
      campo("Avisar quando a nota for até", campos.detrator_nota_maxima),
    ]),
    el("p", {
      classe: "muted",
      style: "margin-top:8px",
      texto:
        "6 é a régua do NPS: de 0 a 6 o cliente é considerado detrator. Aumente para saber de mais casos, " +
        "diminua para receber só os graves. Campo do WhatsApp vazio desliga o aviso.",
    }),
    el("button", { classe: "btn btn-primario", type: "submit", texto: "Salvar", style: "margin-top:12px" }),
  ]);

  return el("div", { classe: "pilha" }, [form, cartaoResgate(ctx, recarregar), cartaoCupons(premios)]);
}

/**
 * Sobe a logo e escolhe a cor.
 *
 * Fica num cartão próprio, e não no formulário de cima, porque a logo grava na
 * hora que a pessoa escolhe o arquivo — não tem "salvar". Misturar as duas
 * coisas no mesmo Salvar faria a pessoa escolher o arquivo, sair da tela e
 * descobrir depois que a logo tinha subido mas a cor não.
 */
function cartaoDaMarca(ctx, venue, recarregar) {
  const corSalva = venue.cor_marca || "";
  const previa = el("div", { classe: "previa-marca" });
  const arquivo = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/svg+xml" });
  const cor = el("input", { type: "color" });
  const corTexto = el("input", { placeholder: "#c1121f", style: "max-width:140px" });

  const cartao = el("section", { classe: "cartao", style: "margin-top:12px" }, [
    previa,
    el("div", { classe: "grade-2", style: "margin-top:12px" }, [
      campo("Logo da casa (PNG, JPG, WEBP ou SVG, até 8 MB)", arquivo),
      campoComValorSalvo(
        "Cor da casa",
        el("div", { classe: "linha-cor" }, [cor, corTexto]),
        corSalva,
        async () => {
          try {
            await patch(`/v1/venues/${ctx.venue}`, { cor_marca: "" });
            avisar("Cor apagada. A pesquisa volta ao laranja da Brasa.", "ok");
            await recarregar();
          } catch (e) {
            avisar(e.message, "erro");
          }
        },
      ),
    ]),
    el("p", {
      classe: "muted",
      style: "margin-top:8px",
      texto:
        "Pode mandar a foto do letreiro direto do celular: o sistema reduz sozinho antes de guardar. " +
        "A cor tinge o fundo e os botões da pesquisa, e a cor da letra por cima é calculada — " +
        "casa que escolhe um tom claro ganha letra escura, para o cliente conseguir ler no sol.",
    }),
  ]);

  // Os dois campos de cor são o MESMO valor: o seletor para quem quer escolher
  // no olho, o texto para quem recebeu "#c1121f" do designer e quer colar.
  cor.addEventListener("input", () => {
    corTexto.value = cor.value;
    salvarCor(cor.value);
  });
  corTexto.addEventListener("change", () => salvarCor(corTexto.value.trim()));

  arquivo.addEventListener("change", async () => {
    const escolhido = arquivo.files?.[0];
    if (!escolhido) return;
    arquivo.disabled = true;
    try {
      const pronto = await reduzirImagem(escolhido);
      await postArquivo(
        `/v1/venues/${ctx.venue}/logo?media_type=${encodeURIComponent(pronto.type || "")}`,
        pronto,
      );
      avisar("Logo atualizada.", "ok");
      await recarregar();
    } catch (e) {
      avisar(e.message, "erro");
    } finally {
      arquivo.disabled = false;
    }
  });

  desenharMarca();
  return cartao;

  function desenharMarca() {
    cor.value = venue.cor_marca || "#ff6b35";
    corTexto.value = venue.cor_marca || "";

    limpar(previa);
    if (venue.logo_url) {
      // O X fica EM CIMA da imagem, no canto. É onde a pessoa procura para
      // apagar uma foto — o mesmo lugar do WhatsApp, do Instagram e de
      // qualquer app que aceite imagem. Um botão "Remover logo" ao lado
      // funciona, mas obriga a ler antes de agir.
      const x = el("button", {
        classe: "chip-x chip-x-sobre",
        type: "button",
        texto: "✕",
        title: "Apagar a logo",
        "aria-label": "Apagar a logo",
      });
      x.addEventListener("click", async () => {
        x.disabled = true;
        try {
          await del(`/v1/venues/${ctx.venue}/logo`);
          avisar("Logo apagada. A pesquisa volta a usar a marca da Brasa.", "ok");
          await recarregar();
        } catch (e) {
          avisar(e.message, "erro");
          x.disabled = false;
        }
      });
      previa.append(
        el("div", { classe: "logo-caixa" }, [
          el("img", { src: venue.logo_url, alt: "Logo da casa", classe: "logo-previa" }),
          x,
        ]),
      );
    } else {
      previa.append(
        el("p", { classe: "muted", texto: "Sem logo ainda — a pesquisa mostra a marca da Brasa Food." }),
      );
    }
  }

  async function salvarCor(valor) {
    try {
      await patch(`/v1/venues/${ctx.venue}`, { cor_marca: valor });
      avisar("Cor salva.", "ok");
    } catch (e) {
      avisar(e.message, "erro");
    }
  }
}

/** Maior lado da logo depois de reduzida. */
const LADO_MAXIMO_DA_LOGO = 900;

/**
 * Reduz a imagem no navegador antes de subir.
 *
 * A logo que a casa tem à mão quase nunca é um arquivo de designer: é a foto
 * do letreiro tirada no celular, com 4000 pixels de largura e 8 MB. Subir isso
 * como está resolveria o problema do dono e criaria o do cliente — ele abriria
 * a pesquisa no 4G do bar e esperaria oito megabytes por uma imagem que vai
 * aparecer com 62 pixels de altura.
 *
 * Reduzir aqui, e não no servidor, é o que faz o upload ser rápido também para
 * quem está subindo. E é aqui que dá para fazer sem biblioteca nenhuma: o
 * navegador já sabe decodificar e redesenhar imagem.
 *
 * SVG passa direto: é vetor, já é pequeno, e jogá-lo num canvas o
 * transformaria em bitmap — perderia justamente a qualidade que o formato tem.
 */
async function reduzirImagem(arquivo) {
  if (arquivo.type === "image/svg+xml") return arquivo;
  if (typeof createImageBitmap !== "function") return arquivo;

  let imagem;
  try {
    imagem = await createImageBitmap(arquivo);
  } catch {
    // Formato que o navegador não decodifica: manda como veio e deixa o
    // servidor recusar com a mensagem dele. Melhor que "não deu" sem motivo.
    return arquivo;
  }

  const maior = Math.max(imagem.width, imagem.height);
  // Já é pequena o bastante: mexer só perderia qualidade e trocaria um PNG com
  // transparência por outro sem ganho nenhum.
  if (maior <= LADO_MAXIMO_DA_LOGO && arquivo.size <= 400 * 1024) {
    imagem.close?.();
    return arquivo;
  }

  const escala = Math.min(1, LADO_MAXIMO_DA_LOGO / maior);
  const tela = document.createElement("canvas");
  tela.width = Math.round(imagem.width * escala);
  tela.height = Math.round(imagem.height * escala);
  const pincel = tela.getContext("2d");
  pincel.drawImage(imagem, 0, 0, tela.width, tela.height);
  imagem.close?.();

  // PNG e não JPEG: logo com fundo transparente vira um retângulo branco em
  // JPEG, e o dono acha que o sistema estragou a arte dele.
  const blob = await new Promise((resolve) => tela.toBlob(resolve, "image/png"));
  if (!blob) return arquivo;
  // Se a redução engordou (acontece com foto rica em cor), fica o original.
  if (blob.size >= arquivo.size) return arquivo;
  return new File([blob], "logo.png", { type: "image/png" });
}

function cartaoResgate(ctx, recarregar) {
  const codigo = el("input", { placeholder: "Ex.: BYNZ4J", style: "text-transform:uppercase" });
  const resultado = el("div");

  async function resgatar() {
    limpar(resultado);
    try {
      const r = await post(`/v1/venues/${ctx.venue}/pesquisa/premios/resgatar`, { codigo: codigo.value });
      resultado.append(
        el("div", { classe: "aviso aviso-ok", style: "margin-top:10px" }, [
          el("strong", { texto: `✅  ${r.titulo}` }),
          el("p", { style: "margin:4px 0 0", texto: `Cupom ${r.codigo} baixado agora. Pode entregar.` }),
        ]),
      );
      codigo.value = "";
      await recarregar();
    } catch (e) {
      resultado.append(
        el("div", { classe: "aviso aviso-perigo", style: "margin-top:10px" }, [
          el("strong", { texto: "❌  Não pode entregar" }),
          el("p", { style: "margin:4px 0 0", texto: e.message }),
        ]),
      );
    }
  }

  return el("section", { classe: "cartao" }, [
    el("h3", { texto: "Baixar um cupom no balcão" }),
    el("p", {
      classe: "muted",
      texto: "Digite o código que o cliente mostrar. O sistema confere se vale, se já foi usado e se a data chegou — cupom ganho hoje só vale a partir de amanhã.",
    }),
    el("div", { classe: "linha-campos", style: "margin-top:12px" }, [
      el("label", { classe: "campo-rotulado", style: "flex:1" }, [el("span", { texto: "Código" }), codigo]),
      el("button", { classe: "btn btn-primario", type: "button", texto: "Conferir e baixar", onclick: resgatar }),
    ]),
    resultado,
  ]);
}

function cartaoCupons(premios) {
  const agora = Date.now();
  const abertos = premios.filter((p) => !p.resgatado_em && Date.parse(p.expira_em) > agora);
  const usados = premios.filter((p) => p.resgatado_em);

  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "Cupons emitidos" }),
        el("p", {
          classe: "muted",
          texto: `${abertos.length} em aberto · ${usados.length} já usados · ${premios.length} no total`,
        }),
      ]),
    ]),
    premios.length === 0
      ? el("p", { classe: "muted", texto: "Nenhum cupom emitido ainda." })
      : el("div", { classe: "rolagem-x", style: "margin-top:10px" }, [
          el("table", { classe: "planilha" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { texto: "Código" }),
                el("th", { texto: "Cliente" }),
                el("th", { classe: "col-num", texto: "Nota" }),
                el("th", { texto: "Situação" }),
                el("th", { texto: "Vale até" }),
              ]),
            ]),
            el(
              "tbody",
              {},
              premios.slice(0, 60).map((p) => {
                const vencido = !p.resgatado_em && Date.parse(p.expira_em) <= agora;
                // Ainda na carência: o garçom precisa distinguir "não vale
                // AINDA" de "não vale MAIS" — as duas recusas soam iguais no
                // balcão e têm respostas opostas para o cliente.
                const esperando = !p.resgatado_em && p.liberado_em && Date.parse(p.liberado_em) > agora;
                return el("tr", {}, [
                  el("td", {}, [el("strong", { texto: p.codigo })]),
                  el("td", {}, [
                    el("span", { texto: p.cliente_nome || "Anônimo" }),
                    p.cliente_contato ? el("small", { classe: "muted", texto: p.cliente_contato }) : null,
                  ]),
                  el("td", { classe: "col-num", texto: p.nota == null ? "—" : String(p.nota) }),
                  el("td", {}, [
                    p.resgatado_em
                      ? etiqueta(`usado ${dataHora(p.resgatado_em)}`, "etiqueta-ok")
                      : vencido
                        ? etiqueta("vencido", "etiqueta-perigo")
                        : esperando
                          ? etiqueta(`vale a partir de ${new Date(p.liberado_em).toLocaleDateString("pt-BR")}`)
                          : etiqueta("em aberto", "etiqueta-alerta"),
                  ]),
                  el("td", { texto: new Date(p.expira_em).toLocaleDateString("pt-BR") }),
                ]);
              }),
            ),
          ]),
        ]),
  ]);
}

/* ============ Convites ============ */

async function telaConvites(ctx, recarregar) {
  const [convites, config] = await Promise.all([
    get(`/v1/venues/${ctx.venue}/pesquisa/convites`),
    // O prêmio entra na mensagem por extenso; mostrar aqui o texto que VAI
    // sair evita a surpresa de descobrir o que foi prometido pelo print que
    // o cliente manda de volta.
    get(`/v1/venues/${ctx.venue}/pesquisa/config`).catch(() => null),
  ]);

  const telefone = el("input", { type: "tel", placeholder: "(65) 99999-0000", required: true });
  const nome = el("input", { placeholder: "Nome do cliente (opcional)" });
  const mensagem = el("input", { placeholder: "Deixe vazio para usar o texto padrão" });

  const premioNaMensagem =
    config?.premio_ativo && config.premio_titulo?.trim() ? config.premio_titulo.trim() : null;
  const previaDaMensagem = premioNaMensagem
    ? `Sai assim: “…São 30 segundos — e quem responde ganha ${premioNaMensagem.charAt(0).toLowerCase() + premioNaMensagem.slice(1)}.”`
    : "O prêmio está desligado, então a mensagem não promete nada. Ligue em “O prêmio” para citá-lo aqui.";

  const form = el("form", {
    classe: "cartao",
    onsubmit: async (e) => {
      e.preventDefault();
      const botao = form.querySelector("button[type=submit]");
      botao.disabled = true;
      try {
        const r = await post(`/v1/venues/${ctx.venue}/pesquisa/convites`, {
          telefone: telefone.value,
          nome: nome.value.trim() || undefined,
          mensagem: mensagem.value.trim() || undefined,
        });
        avisar(
          r.enfileirado
            ? "Convite na fila — sai pelo WhatsApp da casa em instantes."
            : "Convite criado, mas o envio falhou. Confira o WhatsApp da casa em Ajustes.",
          r.enfileirado ? "ok" : "erro",
        );
        await recarregar();
      } catch (err) {
        avisar(err.message, "erro");
        botao.disabled = false;
      }
    },
  }, [
    el("h3", { texto: "Mandar a pesquisa para um cliente" }),
    el("p", {
      classe: "muted",
      texto: "Sai pelo WhatsApp da casa (o administrativo), nunca pelo número do agente. Cada link vale uma resposta só.",
    }),
    el("p", { classe: "muted", style: "margin-top:6px", texto: previaDaMensagem }),
    el("div", { classe: "grade", style: "margin-top:12px" }, [
      campo("WhatsApp com DDD", telefone),
      campo("Nome", nome),
      campo("Mensagem", mensagem),
    ]),
    el("button", { classe: "btn btn-primario", type: "submit", texto: "Enviar convite", style: "margin-top:12px" }),
  ]);

  /* ---- A Zig: quem esteve ontem recebe o convite hoje ---- */

  let zig = null;
  try {
    zig = await get(`/v1/venues/${ctx.venue}/pesquisa/zig`);
  } catch {
    /* migração ainda não rodada — o cartão explica */
  }

  const zigToken = el("input", { type: "password", placeholder: zig?.token_salvo ? "Trocar o token…" : "Cole o token de integração da Zig" });
  const zigLoja = el("input", { value: zig?.loja ?? "", placeholder: "Identificador da loja na Zig" });
  const zigAtivo = caixaDeMarcar("Modo automático: mandar sozinho todo dia, sem escolher", zig?.ativo === true);
  const zigHora = el("input", { type: "number", min: "0", max: "23", value: String(zig?.hora_envio ?? 11) });
  const zigTeto = el("input", { type: "number", min: "1", max: "500", value: String(zig?.teto_por_dia ?? 80) });
  const zigRepetir = el("input", { type: "number", min: "0", max: "365", value: String(zig?.nao_repetir_dias ?? 30) });

  // Ontem, no relógio de quem está olhando a tela — o dia que se busca.
  const ontem = new Date(Date.now() - 86_400_000);
  const zigDia = el("input", {
    type: "date",
    classe: "campo",
    value: `${ontem.getFullYear()}-${String(ontem.getMonth() + 1).padStart(2, "0")}-${String(ontem.getDate()).padStart(2, "0")}`,
  });
  const areaVisitantes = el("div", {});

  const salvarZig = async () => {
    const corpo = {
      loja: zigLoja.value.trim(),
      ativo: zigAtivo.querySelector("input").checked,
      hora_envio: Number(zigHora.value),
      teto_por_dia: Number(zigTeto.value),
      nao_repetir_dias: Number(zigRepetir.value),
    };
    // Token só viaja quando a pessoa digitou um: campo vazio = não mexe.
    if (zigToken.value.trim()) corpo.token = zigToken.value.trim();
    await put(`/v1/venues/${ctx.venue}/pesquisa/zig`, corpo);
  };

  const cartaoZig = el("section", { classe: "cartao" }, [
    el("h3", { texto: "Buscar clientes na Zig" }),
    el("p", {
      classe: "muted",
      texto:
        "Busque quem esteve na casa, veja quanto cada um gastou e ESCOLHA quem recebe a pesquisa. " +
        "O token fica só no nosso banco e você apaga quando quiser.",
    }),
    !zig
      ? el("p", { classe: "muted", style: "margin-top:10px", texto: "A tabela da Zig ainda não existe no banco — rode o SQL desta versão e recarregue." })
      : el("div", { classe: "pilha", style: "margin-top:12px" }, [
          el("div", { classe: "grade" }, [
            campoComValorSalvo(
              "Token de integração",
              zigToken,
              zig.token_salvo ? `token salvo (…${zig.token_final})` : null,
              async () => {
                await put(`/v1/venues/${ctx.venue}/pesquisa/zig`, { token: "", ativo: false });
                avisar("Token apagado — o envio automático foi desligado junto.", "ok");
                await recarregar();
              },
            ),
            campo("Loja", zigLoja),
            campo("Hora do envio (da casa)", zigHora),
          ]),
          el("div", { classe: "grade" }, [
            campo("No máximo por dia", zigTeto),
            campo("Não repetir por (dias)", zigRepetir),
            el("div", { classe: "campo" }, [el("label", { texto: " " }), zigAtivo]),
          ]),
          zig.ultimo_dia
            ? el("p", { classe: "muted", texto: `Último dia buscado: ${zig.ultimo_dia}.` })
            : null,
          el("div", { classe: "linha-campos" }, [
            el("button", {
              classe: "btn btn-primario",
              type: "button",
              texto: "Salvar",
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  await salvarZig();
                  avisar("Conexão com a Zig salva.", "ok");
                  await recarregar();
                } catch (err) {
                  avisar(err.message, "erro");
                  e.target.disabled = false;
                }
              },
            }),
            el("button", {
              classe: "btn",
              type: "button",
              texto: "Testar conexão",
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  const r = await post(`/v1/venues/${ctx.venue}/pesquisa/zig/testar`, {
                    token: zigToken.value.trim() || undefined,
                    loja: zigLoja.value.trim() || undefined,
                  });
                  avisar(`A Zig respondeu: token e loja valem (${r.eventos} evento(s) recente(s)).`, "ok");
                } catch (err) {
                  avisar(err.message, "erro");
                } finally {
                  e.target.disabled = false;
                }
              },
            }),
            el("label", { classe: "campo-rotulado", style: "margin-left:auto" }, [
              el("span", { texto: "Dia" }),
              zigDia,
            ]),
            el("button", {
              classe: "btn",
              type: "button",
              texto: "Buscar clientes do dia",
              onclick: async (e) => {
                e.target.disabled = true;
                limpar(areaVisitantes).append(el("p", { classe: "muted", texto: "Buscando na Zig…" }));
                try {
                  const r = await get(
                    `/v1/venues/${ctx.venue}/pesquisa/zig/visitantes?dia=${zigDia.value}`,
                  );
                  desenharVisitantes(r);
                } catch (err) {
                  limpar(areaVisitantes);
                  avisar(err.message, "erro");
                } finally {
                  e.target.disabled = false;
                }
              },
            }),
          ]),
          areaVisitantes,
        ]),
  ].filter(Boolean));

  /**
   * A lista de quem esteve na casa, do maior gasto para o menor, com uma
   * caixinha por pessoa. Buscar não manda nada — mandar é o botão do rodapé,
   * que diz em cima de quantos vai agir.
   */
  function desenharVisitantes(r) {
    limpar(areaVisitantes);
    if (r.visitantes.length === 0) {
      areaVisitantes.append(el("p", { classe: "muted", texto: `Ninguém com telefone na Zig em ${r.dia}.` }));
      return;
    }

    const linhas = r.visitantes.map((v) => {
      const caixa = el("input", { type: "checkbox", disabled: v.ja_convidado });
      caixa.addEventListener("change", atualizarBotao);
      return { v, caixa };
    });

    const botaoEnviar = el("button", {
      classe: "btn btn-primario",
      type: "button",
      texto: "Enviar convite para os marcados",
      disabled: true,
      onclick: async (e) => {
        const marcados = linhas.filter((l) => l.caixa.checked).map((l) => ({ telefone: l.v.telefone, nome: l.v.nome }));
        if (marcados.length === 0) return;
        if (!confirm(`Mandar a pesquisa para ${marcados.length} cliente(s)?`)) return;
        e.target.disabled = true;
        try {
          const resp = await post(`/v1/venues/${ctx.venue}/pesquisa/zig/convidar`, {
            dia: r.dia,
            clientes: marcados,
          });
          avisar(
            `${resp.enviados} convite(s) na fila — saem espaçados pelo WhatsApp da casa.` +
              (resp.repetidos ? ` ${resp.repetidos} já tinha(m) sido convidado(s).` : ""),
            "ok",
          );
          await recarregar();
        } catch (err) {
          avisar(err.message, "erro");
          e.target.disabled = false;
        }
      },
    });

    function atualizarBotao() {
      const n = linhas.filter((l) => l.caixa.checked).length;
      botaoEnviar.disabled = n === 0;
      botaoEnviar.textContent = n === 0 ? "Enviar convite para os marcados" : `Enviar convite para ${n} marcado(s)`;
    }

    const quantosMaiores = el("input", { type: "number", min: "1", max: "500", value: "20", classe: "campo-numero", style: "width:70px" });
    const marcarMaiores = () => {
      const alvo = Number(quantosMaiores.value) || 20;
      let marcados = 0;
      for (const l of linhas) {
        if (l.v.ja_convidado) continue;
        l.caixa.checked = marcados < alvo;
        if (l.caixa.checked) marcados++;
      }
      atualizarBotao();
    };

    const jaConvidados = linhas.filter((l) => l.v.ja_convidado).length;
    areaVisitantes.append(
      el("div", { classe: "pilha", style: "margin-top:8px" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h4", { texto: `${r.visitantes.length} cliente(s) em ${r.dia}` }),
            el("p", {
              classe: "muted",
              texto:
                "Do maior gasto para o menor. Marque quem recebe a pesquisa" +
                (jaConvidados ? ` — ${jaConvidados} já convidado(s) há pouco aparecem travados.` : "."),
            }),
          ]),
          el("div", { classe: "linha-campos" }, [
            el("span", { classe: "muted", texto: "Marcar os" }),
            quantosMaiores,
            el("button", { classe: "btn btn-peq", type: "button", texto: "que mais gastaram", onclick: marcarMaiores }),
            el("button", {
              classe: "btn btn-peq",
              type: "button",
              texto: "Limpar",
              onclick: () => {
                for (const l of linhas) l.caixa.checked = false;
                atualizarBotao();
              },
            }),
          ]),
        ]),
        el("div", { classe: "rolagem-x" }, [
          el("table", { classe: "planilha" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { texto: "" }),
                el("th", { texto: "Cliente" }),
                el("th", { texto: "WhatsApp" }),
                el("th", { classe: "col-num", texto: "Gastou no dia" }),
                el("th", { texto: "" }),
              ]),
            ]),
            el(
              "tbody",
              {},
              linhas.map(({ v, caixa }) =>
                el("tr", {}, [
                  el("td", {}, [caixa]),
                  el("td", {}, [el("strong", { texto: v.nome || "—" })]),
                  el("td", { texto: v.telefone }),
                  el("td", { classe: "col-num" }, [
                    v.gasto_centavos > 0
                      ? el("strong", { texto: dinheiro(v.gasto_centavos / 100) })
                      : el("span", { classe: "muted", texto: "só check-in" }),
                  ]),
                  el("td", {}, [v.ja_convidado ? etiqueta("já convidado") : null].filter(Boolean)),
                ]),
              ),
            ),
          ]),
        ]),
        botaoEnviar,
      ]),
    );
  }

  /* ---- A planilha: para quem não tem Zig ---- */

  const arquivoPlanilha = el("input", { type: "file", accept: ".xlsx,.csv" });
  const resumoPlanilha = el("div", {});

  const mandarPlanilha = async (confirmar, botao) => {
    const f = arquivoPlanilha.files?.[0];
    if (!f) return avisar("Escolha o arquivo primeiro.", "erro");
    botao.disabled = true;
    try {
      const r = await postArquivo(
        `/v1/venues/${ctx.venue}/pesquisa/convites/planilha${confirmar ? "?confirmar=1" : ""}`,
        f,
      );
      limpar(resumoPlanilha);
      if (r.previa) {
        resumoPlanilha.append(
          el("p", {
            texto: `${r.validos} telefone(s) prontos para convidar · ${r.repetidos} já convidado(s) há pouco · ${r.recusadas.length} linha(s) recusada(s).`,
          }),
          r.recusadas.length
            ? el("ul", { classe: "muted", style: "margin:6px 0 0;padding-left:20px" },
                r.recusadas.slice(0, 8).map((x) => el("li", { texto: `linha ${x.linha}: ${x.motivo}` })))
            : null,
          r.validos > 0
            ? el("button", {
                classe: "btn btn-primario",
                type: "button",
                style: "margin-top:10px",
                texto: `Enviar ${r.validos} convite(s)`,
                onclick: (e2) => mandarPlanilha(true, e2.target),
              })
            : null,
        );
      } else {
        avisar(`${r.enviados} convite(s) na fila — saem espaçados pelo WhatsApp da casa.`, "ok");
        await recarregar();
      }
    } catch (err) {
      avisar(err.message, "erro");
    } finally {
      botao.disabled = false;
    }
  };

  const cartaoPlanilha = el("section", { classe: "cartao" }, [
    el("h3", { texto: "Importar planilha de clientes" }),
    el("p", {
      classe: "muted",
      texto:
        "Sem Zig? Exporte a lista de onde tiver e mande aqui (.xlsx ou .csv). " +
        "Basta uma coluna chamada telefone (ou whatsapp/celular) — nome é opcional. Primeiro você vê o resumo; nada sai sem confirmar.",
    }),
    el("div", { classe: "linha-campos", style: "margin-top:12px" }, [
      arquivoPlanilha,
      el("button", {
        classe: "btn",
        type: "button",
        texto: "Ler planilha",
        onclick: (e) => mandarPlanilha(false, e.target),
      }),
    ]),
    resumoPlanilha,
  ]);

  const respondidos = convites.filter((c) => c.respondido_em).length;

  const lista = el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "Convites enviados" }),
        el("p", {
          classe: "muted",
          texto:
            convites.length === 0
              ? "Nenhum convite ainda."
              : `${respondidos} de ${convites.length} responderam (${Math.round((respondidos / convites.length) * 100)}%).`,
        }),
      ]),
    ]),
    convites.length === 0
      ? null
      : el("div", { classe: "rolagem-x", style: "margin-top:10px" }, [
          el("table", { classe: "planilha" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { texto: "Cliente" }),
                el("th", { texto: "WhatsApp" }),
                el("th", { texto: "Enviado" }),
                el("th", { texto: "Situação" }),
                el("th", { classe: "col-acoes", texto: "" }),
              ]),
            ]),
            el(
              "tbody",
              {},
              convites.slice(0, 80).map((c) =>
                el("tr", {}, [
                  el("td", { texto: c.nome || "—" }),
                  el("td", { texto: c.telefone }),
                  el("td", { texto: c.enviado_em ? dataHora(c.enviado_em) : "na fila" }),
                  el("td", {}, [
                    c.respondido_em
                      ? etiqueta(`respondeu ${dataHora(c.respondido_em)}`, "etiqueta-ok")
                      : etiqueta("aguardando"),
                  ]),
                  el("td", { classe: "col-acoes" }, [
                    el("button", {
                      classe: "btn-icone",
                      type: "button",
                      texto: "✕",
                      title: "Excluir este convite — o link dele morre e o número pode ser convidado de novo",
                      onclick: async (e) => {
                        const quem = c.nome || c.telefone;
                        if (
                          !confirm(
                            `Excluir o convite de ${quem}?\n\n` +
                              `O link daquele convite deixa de funcionar e o número sai da trava ` +
                              `de "não repetir" — pode ser convidado de novo hoje.` +
                              (c.respondido_em ? `\n\nA resposta que ele deu FICA no painel.` : ""),
                          )
                        )
                          return;
                        e.target.disabled = true;
                        try {
                          await del(`/v1/venues/${ctx.venue}/pesquisa/convites/${c.id}`);
                          avisar(`Convite de ${quem} excluído.`, "ok");
                          await recarregar();
                        } catch (err) {
                          avisar(err.message, "erro");
                          e.target.disabled = false;
                        }
                      },
                    }),
                  ]),
                ]),
              ),
            ),
          ]),
        ]),
  ]);

  return el("div", { classe: "pilha" }, [form, cartaoZig, cartaoPlanilha, lista]);
}

/* ============ peças ============ */

function campo(rotulo, controle) {
  return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
}

/**
 * Um campo que mostra o que JÁ ESTÁ salvo, com um X para apagar.
 *
 * Um input com texto dentro não diz se aquilo está guardado ou se é algo que
 * a pessoa digitou e não salvou. E para apagar, a única saída era selecionar
 * tudo, apagar com o dedo e lembrar de salvar — três passos para desfazer
 * uma coisa. O X faz em um.
 */
function campoComValorSalvo(rotulo, controle, valorSalvo, aoRemover) {
  const bloco = el("div", { classe: "campo" }, [el("label", { texto: rotulo })]);

  if (valorSalvo) {
    const x = el("button", {
      classe: "chip-x",
      type: "button",
      texto: "✕",
      title: `Apagar ${valorSalvo}`,
      "aria-label": `Apagar ${valorSalvo}`,
    });
    x.addEventListener("click", async () => {
      x.disabled = true;
      try {
        await aoRemover();
      } finally {
        x.disabled = false;
      }
    });
    bloco.append(
      el("div", { classe: "valor-salvo" }, [
        el("span", { classe: "valor-salvo-texto", texto: valorSalvo }),
        x,
      ]),
    );
  }

  bloco.append(controle);
  return bloco;
}

function caixaDeMarcar(rotulo, marcado) {
  const entrada = el("input", { type: "checkbox", checked: marcado });
  return el("label", { classe: "check-linha" }, [entrada, el("span", { texto: rotulo })]);
}
