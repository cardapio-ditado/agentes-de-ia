import { get, post, put } from "../api.js";
import { avisar, dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Avaliações do Google.
 *
 * O fluxo de hoje é colar-e-copiar, e a tela é desenhada em volta dele: o
 * cliente cola a avaliação, a IA redige, ele copia a resposta e cola no
 * Google. Nada toca o Google sozinho — a automação por navegador foi
 * aposentada depois que o Google a sinalizou com CAPTCHA na primeira visita,
 * e a automação de verdade chega com a API oficial (pedido protocolado,
 * previsão setembro/2026). Quando ela chegar, esta tela ganha o botão
 * "Conectar com Google" e o colar-e-copiar se aposenta.
 *
 * A regra que não muda: 1 e 2 estrelas nunca são respondidas sem alguém ler.
 * O servidor decide isso — a tela só mostra o que foi decidido.
 */

/** A conta usada pela equipe na configuração técnica; o cliente não a vê. */
const CONTA_GERENTE_PADRAO = "agente@brasafood.app";

const SITUACOES = {
  pendente: ["aguardando redação", ""],
  rascunho: ["esperando você", "etiqueta-alerta"],
  aprovada: ["pronta para colar", "etiqueta-info"],
  publicada: ["respondida no Google", "etiqueta-ok"],
  descartada: ["sem resposta", ""],
  erro: ["falhou", "etiqueta-perigo"],
};

function estrelas(nota) {
  return "★".repeat(nota) + "☆".repeat(5 - nota);
}

/** Nota baixa merece destaque visual: é a que não pode ficar parada. */
function classeDaNota(nota) {
  if (nota <= 2) return "etiqueta-perigo";
  if (nota === 3) return "etiqueta-alerta";
  return "etiqueta-ok";
}

export async function avaliacoes(raiz, ctx) {
  const fila = el("div", { classe: "lista" });
  const prontas = el("div", { classe: "lista" });
  const regras = el("div", { classe: "cartao" });
  const historico = el("div", { classe: "lista" });

  raiz.append(
    el("section", { classe: "pilha" }, [
      // O recado que explica a fase atual — e o que vem aí.
      el("div", { classe: "cartao alerta" }, [
        el("p", {}, [
          el("strong", { texto: "Respostas automáticas chegam em setembro. " }),
          document.createTextNode(
            "Estamos ligando o Brasa Food direto ao Google: as avaliações boas serão " +
              "respondidas sozinhas e as de nota baixa vão esperar o seu OK. " +
              "Até lá funciona assim: cole a avaliação abaixo, a IA escreve, você copia e cola no Google.",
          ),
        ]),
      ]),

      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Responder uma avaliação" }),
          el("p", { classe: "muted", texto: "Cole o que o cliente escreveu no Google. A IA responde no tom da casa." }),
        ]),
      ]),
      formularioResponder(),

      el("div", { classe: "cabecalho-secao", style: "margin-top:10px" }, [
        el("div", {}, [
          el("h2", { texto: "Esperando você" }),
          el("p", { classe: "muted", texto: "Nota baixa para aqui, sempre: leia, ajuste se quiser e aprove." }),
        ]),
        el("button", { classe: "btn btn-peq", type: "button", texto: "Recarregar", onclick: carregar }),
      ]),
      fila,

      el("div", { classe: "cabecalho-secao", style: "margin-top:10px" }, [
        el("div", {}, [
          el("h2", { texto: "Prontas para colar no Google" }),
          el("p", { classe: "muted", texto: "Copie a resposta, cole no Google e marque como feita." }),
        ]),
      ]),
      prontas,

      el("div", { classe: "cabecalho-secao", style: "margin-top:10px" }, [
        el("div", {}, [
          el("h2", { texto: "Como a IA escreve" }),
          el("p", { classe: "muted", texto: "O tom da casa e o que poderá sair sem a sua revisão." }),
        ]),
      ]),
      regras,

      el("div", { classe: "cabecalho-secao", style: "margin-top:10px" }, [
        el("div", {}, [el("h2", { texto: "Histórico" })]),
      ]),
      historico,
    ]),
  );

  await carregar();

  async function carregar() {
    limpar(fila).append(el("p", { classe: "muted", texto: "Carregando…" }));
    limpar(prontas);
    limpar(historico);

    const dados = await get(`/v1/venues/${ctx.venue}/avaliacoes`);

    limpar(fila);
    if (dados.fila.length === 0) {
      fila.append(vazio("Nada esperando", "Nenhuma resposta pendente da sua leitura."));
      ctx.atualizarContador("avaliacoes", 0);
    } else {
      ctx.atualizarContador("avaliacoes", dados.fila.length);
      for (const a of dados.fila) fila.append(cartaoDaFila(a));
    }

    const liberadas = dados.historico.filter((a) => a.resposta_status === "aprovada" && a.resposta);
    if (liberadas.length === 0) {
      prontas.append(vazio("Nenhuma resposta esperando ser colada"));
    } else {
      for (const a of liberadas) prontas.append(cartaoPronta(a));
    }

    limpar(regras).append(...formularioDeRegras(dados.perfil));

    const resto = dados.historico.filter(
      (a) => a.resposta_status !== "aprovada" && a.resposta_status !== "rascunho",
    );
    if (resto.length === 0) {
      historico.append(vazio("Nenhuma avaliação concluída ainda"));
    } else {
      for (const a of resto) historico.append(cartaoDoHistorico(a));
    }
  }

  // ---------- Colar uma avaliação ----------

  function formularioResponder() {
    const autor = el("input", { placeholder: "Nome de quem avaliou (como aparece no Google)" });
    const nota = el("select", {}, [5, 4, 3, 2, 1].map((n) =>
      el("option", { value: String(n), texto: `${estrelas(n)} ${n}` }),
    ));
    const comentario = el("textarea", { rows: 3 });
    comentario.placeholder = "Cole aqui o texto da avaliação. Se for só nota, deixe em branco.";
    comentario.style.width = "100%";

    const botao = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Redigir resposta",
      onclick: async () => {
        botao.disabled = true;
        try {
          await post(`/v1/venues/${ctx.venue}/avaliacoes`, {
            autor: autor.value.trim(),
            nota: Number(nota.value),
            comentario: comentario.value.trim(),
          });
          avisar("Resposta redigida — veja logo abaixo.", "ok");
          autor.value = "";
          comentario.value = "";
          await carregar();
        } catch (err) {
          avisar(err.message, "erro");
        } finally {
          botao.disabled = false;
        }
      },
    });

    return el("div", { classe: "cartao" }, [
      campo("Quem avaliou", autor),
      campo("Nota", nota),
      campo("O que a pessoa escreveu", comentario),
      el("div", { classe: "reserva-acoes" }, [botao]),
    ]);
  }

  // ---------- Fila (nota baixa espera gente) ----------

  function cartaoDaFila(a) {
    // A resposta é editável antes de aprovar: o dono corrige justamente nas
    // avaliações que mais importam, e obrigá-lo a aprovar o texto como veio
    // faria dele refém de um rascunho.
    // O valor vai pela propriedade, não pelo atributo: em <textarea> o
    // conteúdo é filho de texto, e setAttribute("value") não preenche nada.
    const texto = el("textarea", { rows: 4 });
    texto.value = a.resposta ?? "";
    texto.style.width = "100%";

    const btnAprovar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Aprovar resposta",
      onclick: () => decidir("aprovar"),
    });
    const btnDescartar = el("button", {
      classe: "btn btn-peq",
      type: "button",
      texto: "Não responder",
      onclick: () => decidir("descartar"),
    });

    async function decidir(acao) {
      if (acao === "aprovar" && !texto.value.trim()) {
        avisar("A resposta não pode ficar vazia.", "erro");
        texto.focus();
        return;
      }
      if (acao === "descartar" && !confirm("Deixar esta avaliação sem resposta? Ela sai da fila.")) {
        return;
      }

      btnAprovar.disabled = true;
      btnDescartar.disabled = true;
      try {
        await post(
          `/v1/avaliacoes/${a.id}/${acao}`,
          acao === "aprovar" ? { texto: texto.value.trim() } : {},
        );
        avisar(
          acao === "aprovar" ? "Aprovada — agora copie e cole no Google." : "Avaliação sem resposta.",
          "ok",
        );
        await carregar();
      } catch (err) {
        avisar(err.message, "erro");
        btnAprovar.disabled = false;
        btnDescartar.disabled = false;
      }
    }

    return el("article", { classe: "cartao" }, [
      cabecalhoDaAvaliacao(a),
      a.comentario
        ? el("p", { texto: `"${a.comentario}"` })
        : el("p", { classe: "muted", texto: "Sem comentário, só a nota." }),
      el("p", { classe: "muted", style: "margin-top:12px", texto: "Resposta sugerida — edite se quiser:" }),
      texto,
      el("div", { classe: "reserva-acoes" }, [btnAprovar, btnDescartar]),
    ]);
  }

  // ---------- Prontas para colar ----------

  function cartaoPronta(a) {
    const jaColei = el("button", {
      classe: "btn btn-peq",
      type: "button",
      texto: "Já colei no Google",
      onclick: async () => {
        jaColei.disabled = true;
        try {
          await post(`/v1/avaliacoes/${a.id}/colada`, {});
          avisar("Marcada como respondida.", "ok");
          await carregar();
        } catch (err) {
          avisar(err.message, "erro");
          jaColei.disabled = false;
        }
      },
    });

    return el("article", { classe: "cartao" }, [
      cabecalhoDaAvaliacao(a),
      a.comentario ? el("p", { classe: "muted", texto: `"${a.comentario}"` }) : null,
      el("p", { style: "margin-top:10px", texto: a.resposta }),
      el("div", { classe: "reserva-acoes" }, [botaoCopiar(a.resposta), jaColei]),
    ]);
  }

  /** Copiar para colar no Google — é assim que a resposta chega lá hoje. */
  function botaoCopiar(pegarTexto) {
    return el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Copiar resposta",
      onclick: async (e) => {
        const texto = (typeof pegarTexto === "function" ? pegarTexto() : pegarTexto)?.trim();
        if (!texto) return avisar("Não há resposta para copiar.", "erro");
        try {
          await navigator.clipboard.writeText(texto);
          avisar("Copiada! Agora cole na resposta da avaliação, no Google.", "ok");
        } catch {
          avisar("Não consegui copiar sozinho — selecione o texto e use Ctrl+C.", "erro");
        }
      },
    });
  }

  function cabecalhoDaAvaliacao(a) {
    return el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: a.autor || "Cliente do Google" }),
        el("p", { classe: "muted", texto: a.avaliada_em ? dataHora(a.avaliada_em) : "" }),
      ]),
      etiqueta(`${estrelas(a.nota)} ${a.nota}`, classeDaNota(a.nota)),
    ]);
  }

  // ---------- Histórico ----------

  function cartaoDoHistorico(a) {
    const [rotulo, variante] = SITUACOES[a.resposta_status] ?? [a.resposta_status, ""];
    return el("article", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: a.autor || "Cliente do Google" }),
          el("p", { classe: "muted", texto: a.avaliada_em ? dataHora(a.avaliada_em) : "" }),
        ]),
        el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" }, [
          etiqueta(`${estrelas(a.nota)} ${a.nota}`, classeDaNota(a.nota)),
          etiqueta(rotulo, variante),
        ]),
      ]),
      a.comentario ? el("p", { texto: `"${a.comentario}"` }) : null,
      a.resposta ? el("p", { classe: "muted", texto: `Resposta: ${a.resposta}` }) : null,
      a.ultimo_erro ? el("p", { classe: "muted", texto: `Erro: ${a.ultimo_erro}` }) : null,
    ]);
  }

  // ---------- Regras ----------

  function formularioDeRegras(perfil) {
    const config = perfil?.configuracao ?? {};
    const conta = perfil?.conta_gerente || CONTA_GERENTE_PADRAO;

    const notaAutomatica = el("select", {}, [
      el("option", { value: "5", texto: "Só 5 estrelas" }),
      el("option", { value: "4", texto: "4 e 5 estrelas (recomendado)" }),
      el("option", { value: "3", texto: "3, 4 e 5 estrelas" }),
    ]);
    notaAutomatica.value = String(config.nota_automatica ?? 4);

    const assinatura = el("input", {
      placeholder: "Equipe Ditado Popular",
      value: config.assinatura ?? "",
    });
    const tom = el("textarea", { rows: 2 });
    tom.value = config.tom ?? "";
    tom.placeholder = "Informal, com bom humor, sem gírias forçadas.";
    tom.style.width = "100%";

    const salvar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Salvar regras",
      onclick: async () => {
        salvar.disabled = true;
        try {
          await put(`/v1/venues/${ctx.venue}/avaliacoes-perfil`, {
            conta_gerente: conta,
            nota_automatica: Number(notaAutomatica.value),
            assinatura: assinatura.value.trim(),
            tom: tom.value.trim(),
          });
          avisar("Regras salvas.", "ok");
          await carregar();
        } catch (err) {
          avisar(err.message, "erro");
          salvar.disabled = false;
        }
      },
    });

    return [
      campo("Responder sem sua revisão", notaAutomatica),
      el("p", {
        classe: "muted",
        texto:
          "Hoje isso decide o que pula a fila e já sai pronto para colar. Em setembro, com a " +
          "automática ligada, decide o que é publicado sozinho. Nota 1 e 2 sempre passam por você — não há como desligar.",
      }),
      campo("Assinatura", assinatura),
      campo("Tom da casa", tom),
      el("div", { classe: "reserva-acoes" }, [salvar]),
      blocoTecnico(perfil, conta),
    ];
  }

  /** O que só a equipe Brasa Food mexe. Nada aqui é pedido ao cliente. */
  function blocoTecnico(perfil, conta) {
    const contaGerente = el("input", { value: conta });
    const localId = el("input", {
      placeholder: "https://…",
      value: perfil?.local_id ?? "",
    });

    const salvar = el("button", {
      classe: "btn btn-peq",
      type: "button",
      texto: "Salvar configuração técnica",
      onclick: async () => {
        salvar.disabled = true;
        try {
          await put(`/v1/venues/${ctx.venue}/avaliacoes-perfil`, {
            conta_gerente: contaGerente.value.trim() || conta,
            local_id: localId.value.trim(),
          });
          avisar("Configuração salva.", "ok");
          await carregar();
        } catch (err) {
          avisar(err.message, "erro");
          salvar.disabled = false;
        }
      },
    });

    return el("details", { style: "margin-top:16px" }, [
      el("summary", { texto: "Configuração técnica (equipe Brasa Food)" }),
      campo("Conta gerente", contaGerente),
      campo("Endereço do perfil (local_id)", localId),
      perfil?.ultimo_erro
        ? el("p", { classe: "muted", texto: `Último erro: ${perfil.ultimo_erro}` })
        : null,
      el("div", { classe: "reserva-acoes" }, [salvar]),
    ]);
  }

  function campo(rotulo, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
  }
}
