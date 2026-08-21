import { del, get, patch, post, put } from "../api.js";
import { avisar, dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

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
    blocoMontagemIA(ctx, recarregar, dados.categorias),
    ativa
      ? editorDaPesquisa(ctx, ativa, dados.categorias, recarregar)
      : el("section", { classe: "cartao" }, [
          el("h3", { texto: "Nenhuma pesquisa montada ainda" }),
          el("p", {
            classe: "muted",
            texto: "Sem pesquisa própria, o QR code pergunta só a nota geral. Monte a sua acima para ter nota separada por assunto.",
          }),
        ]),
    dados.pesquisas.length > 1 ? listaDeModelos(ctx, dados.pesquisas, recarregar) : null,
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

  const corpo = el("div", { hidden: true, style: "margin-top:12px" }, [
    el("p", {
      classe: "muted",
      texto: "Conte que tipo de casa é a sua e o que você quer descobrir. A IA pergunta o que faltar e monta as perguntas — você confere antes de valer.",
    }),
    historico,
    el("div", { classe: "campo campo-largo", style: "margin-top:10px" }, [campo]),
    el("div", { classe: "linha-campos" }, [enviar]),
    proposta,
  ]);

  const alternar = el("button", {
    classe: "btn btn-primario btn-peq",
    type: "button",
    texto: "Montar com IA",
    onclick: () => {
      corpo.hidden = !corpo.hidden;
      alternar.textContent = corpo.hidden ? "Montar com IA" : "Fechar";
    },
  });

  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "A IA monta a pesquisa com você" }),
        el("p", { classe: "muted", texto: "Ela pergunta como é a casa e propõe as perguntas certas." }),
      ]),
      alternar,
    ]),
    corpo,
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
        historico.append(balao("ia", `Montei ${r.itens.length} perguntas — confira abaixo.`));
        proposta.append(revisarProposta(ctx, r.itens, categorias, recarregar));
      }
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
function editorDeItens(itens, categorias) {
  const corpo = el("tbody");
  const elemento = el("div", { classe: "pilha", style: "margin-top:12px;gap:8px" }, [
    el("div", { classe: "rolagem-x" }, [
      el("table", { classe: "planilha" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { texto: "Assunto" }),
            el("th", { texto: "Pergunta" }),
            el("th", { texto: "Como responde" }),
            el("th", { texto: "Obrig." }),
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
        onclick: () => corpo.append(linha({ categoria: "Geral", pergunta: "", tipo: "nota", obrigatorio: false })),
      }),
    ]),
  ]);

  for (const item of itens) corpo.append(linha(item));

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
    };

    // `datalist` e não `select`: a lista sugere os assuntos comuns e continua
    // aceitando "Estacionamento" ou "Palco", que só existem em algumas casas.
    const sugestoes = el("datalist", { id: lista }, categorias.map((c) => el("option", { value: c })));

    const tr = el("tr", {}, [
      el("td", {}, [campos.categoria, sugestoes]),
      el("td", {}, [campos.pergunta]),
      el("td", {}, [campos.tipo]),
      el("td", {}, [campos.obrigatorio]),
      el("td", { classe: "col-acoes" }, [
        el("button", {
          classe: "btn-icone",
          type: "button",
          title: "Remover",
          texto: "🗑️",
          onclick: () => tr.remove(),
        }),
      ]),
    ]);
    tr._campos = campos;
    return tr;
  }

  return {
    elemento,
    ler: () =>
      [...corpo.children]
        .map((tr) => ({
          id: undefined,
          categoria: tr._campos.categoria.value.trim(),
          pergunta: tr._campos.pergunta.value.trim(),
          tipo: tr._campos.tipo.value,
          obrigatorio: tr._campos.obrigatorio.checked,
        }))
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
  const [config, premios] = await Promise.all([
    get(`/v1/venues/${ctx.venue}/pesquisa/config`),
    get(`/v1/venues/${ctx.venue}/pesquisa/premios`),
  ]);

  const campos = {
    ativa: caixaDeMarcar("Pesquisa ligada", config.ativa),
    premio_ativo: caixaDeMarcar("Dar prêmio a quem responde", config.premio_ativo),
    perguntar_atendente: caixaDeMarcar("Perguntar quem atendeu", config.perguntar_atendente),
    perguntar_comentario: caixaDeMarcar("Pedir um comentário escrito", config.perguntar_comentario),
    saudacao: el("input", { value: config.saudacao ?? "", placeholder: "Como foi sua visita?" }),
    premio_titulo: el("input", { value: config.premio_titulo, required: true }),
    premio_regras: el("input", { value: config.premio_regras ?? "", placeholder: "Válido de terça a quinta, não acumula" }),
    premio_validade_dias: el("input", { type: "number", min: "1", max: "365", value: String(config.premio_validade_dias) }),
    agradecimento: el("input", { value: config.agradecimento ?? "", placeholder: "Obrigado! Te esperamos de novo." }),
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
          perguntar_comentario: campos.perguntar_comentario.querySelector("input").checked,
          saudacao: campos.saudacao.value.trim(),
          agradecimento: campos.agradecimento.value.trim(),
          premio_titulo: campos.premio_titulo.value.trim(),
          premio_regras: campos.premio_regras.value.trim(),
          premio_validade_dias: Number(campos.premio_validade_dias.value),
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
    el("button", { classe: "btn btn-primario", type: "submit", texto: "Salvar", style: "margin-top:12px" }),
  ]);

  return el("div", { classe: "pilha" }, [form, cartaoResgate(ctx, recarregar), cartaoCupons(premios)]);
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
  const convites = await get(`/v1/venues/${ctx.venue}/pesquisa/convites`);

  const telefone = el("input", { type: "tel", placeholder: "(65) 99999-0000", required: true });
  const nome = el("input", { placeholder: "Nome do cliente (opcional)" });
  const mensagem = el("input", { placeholder: "Deixe vazio para usar o texto padrão" });

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
    el("div", { classe: "grade", style: "margin-top:12px" }, [
      campo("WhatsApp com DDD", telefone),
      campo("Nome", nome),
      campo("Mensagem", mensagem),
    ]),
    el("button", { classe: "btn btn-primario", type: "submit", texto: "Enviar convite", style: "margin-top:12px" }),
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
                ]),
              ),
            ),
          ]),
        ]),
  ]);

  return el("div", { classe: "pilha" }, [form, lista]);
}

/* ============ peças ============ */

function campo(rotulo, controle) {
  return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
}

function caixaDeMarcar(rotulo, marcado) {
  const entrada = el("input", { type: "checkbox", checked: marcado });
  return el("label", { classe: "check-linha" }, [entrada, el("span", { texto: rotulo })]);
}
