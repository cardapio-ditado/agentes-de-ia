import { get, post, put } from "../api.js";
import { avisar, dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Avaliações do Google.
 *
 * A tela existe antes da automação de propósito: com o lançamento manual dá
 * para ver o tom das respostas e corrigir o que estiver errado sem que nada
 * disso encoste num perfil de verdade. Errar o tom em público é caro; errar
 * aqui não custa nada.
 *
 * A regra que manda: 1 e 2 estrelas nunca são publicadas sem alguém ler. O
 * servidor decide isso — a tela só mostra o que foi decidido.
 */

const SITUACOES = {
  pendente: ["aguardando redação", ""],
  rascunho: ["esperando você", "etiqueta-alerta"],
  aprovada: ["liberada para publicar", "etiqueta-info"],
  publicada: ["publicada", "etiqueta-ok"],
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
  const conexao = el("div", { classe: "cartao" });
  const fila = el("div", { classe: "lista" });
  const historico = el("div", { classe: "lista" });

  raiz.append(
    el("section", { classe: "pilha" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Esperando você" }),
          el("p", {
            classe: "muted",
            texto:
              "Respostas redigidas que precisam da sua leitura. Nota 1 e 2 sempre param aqui.",
          }),
        ]),
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Recarregar",
          onclick: carregar,
        }),
      ]),
      fila,

      el("div", { classe: "cabecalho-secao", style: "margin-top:10px" }, [
        el("div", {}, [
          el("h2", { texto: "Conexão e regras" }),
          el("p", { classe: "muted", texto: "Como o agente escreve e o que sai sem revisão." }),
        ]),
      ]),
      conexao,

      el("div", { classe: "cabecalho-secao", style: "margin-top:10px" }, [
        el("div", {}, [
          el("h2", { texto: "Histórico" }),
          el("p", { classe: "muted", texto: "Tudo que passou por aqui." }),
        ]),
      ]),
      historico,
    ]),
  );

  await carregar();

  async function carregar() {
    limpar(fila).append(el("p", { classe: "muted", texto: "Carregando…" }));
    limpar(historico);

    const dados = await get(`/v1/venues/${ctx.venue}/avaliacoes`);

    limpar(fila);
    if (dados.fila.length === 0) {
      fila.append(vazio("Nada esperando", "Nenhuma resposta pendente de aprovação."));
      ctx.atualizarContador("avaliacoes", 0);
    } else {
      ctx.atualizarContador("avaliacoes", dados.fila.length);
      for (const a of dados.fila) fila.append(cartaoDaFila(a));
    }

    limpar(conexao).append(...formularioDeConexao(dados.perfil));

    if (dados.historico.length === 0) {
      historico.append(vazio("Nenhuma avaliação ainda"));
    } else {
      for (const a of dados.historico) historico.append(cartaoDoHistorico(a));
    }
  }

  // ---------- Fila ----------

  function cartaoDaFila(a) {
    // A resposta é editável antes de aprovar: o dono corrige justamente nas
    // avaliações que mais importam, e obrigá-lo a aprovar o texto como veio
    // faria dele refém de um rascunho.
    // O valor vai pela propriedade, não pelo atributo: em <textarea> o
    // conteúdo é filho de texto, e setAttribute("value") não preenche nada —
    // o rascunho apareceria em branco justamente na tela em que ele importa.
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
      if (
        acao === "descartar" &&
        !confirm("Deixar esta avaliação sem resposta? Ela sai da fila.")
      ) {
        return;
      }

      btnAprovar.disabled = true;
      btnDescartar.disabled = true;
      try {
        await post(
          `/v1/avaliacoes/${a.id}/${acao}`,
          acao === "aprovar" ? { texto: texto.value.trim() } : {},
        );
        avisar(acao === "aprovar" ? "Resposta liberada." : "Avaliação sem resposta.", "ok");
        await carregar();
      } catch (err) {
        avisar(err.message, "erro");
        btnAprovar.disabled = false;
        btnDescartar.disabled = false;
      }
    }

    return el("article", { classe: "cartao" }, [
      cabecalhoDaAvaliacao(a),
      a.comentario ? el("p", { texto: `"${a.comentario}"` }) : el("p", { classe: "muted", texto: "Sem comentário, só a nota." }),
      el("p", { classe: "muted", style: "margin-top:12px", texto: "Resposta sugerida — edite se quiser:" }),
      texto,
      el("div", { classe: "reserva-acoes" }, [btnAprovar, btnDescartar]),
    ]);
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
          a.liberacao === "automatica" ? etiqueta("automática", "") : null,
        ]),
      ]),
      a.comentario ? el("p", { texto: `"${a.comentario}"` }) : null,
      a.resposta ? el("p", { classe: "muted", texto: `Resposta: ${a.resposta}` }) : null,
      a.ultimo_erro ? el("p", { classe: "muted", texto: `Erro: ${a.ultimo_erro}` }) : null,
    ]);
  }

  // ---------- Conexão e regras ----------

  function formularioDeConexao(perfil) {
    const config = perfil?.configuracao ?? {};

    const contaGerente = el("input", {
      placeholder: "agente@brasafood.app",
      value: perfil?.conta_gerente ?? "",
    });
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
      texto: "Salvar",
      onclick: async () => {
        if (!contaGerente.value.trim()) {
          avisar("Informe a conta gerente.", "erro");
          contaGerente.focus();
          return;
        }
        salvar.disabled = true;
        try {
          await put(`/v1/venues/${ctx.venue}/avaliacoes-perfil`, {
            conta_gerente: contaGerente.value.trim(),
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
      el("p", { classe: "muted" }, [
        document.createTextNode(
          "O dono do restaurante adiciona esta conta como Gerente do perfil dele no Google. " +
            "Ele nunca entrega a senha, e revoga o acesso quando quiser.",
        ),
      ]),
      campo("Conta gerente", contaGerente),
      campo("Publicar sem revisão", notaAutomatica),
      el("p", { classe: "muted", texto: "Nota 1 e 2 sempre passam por você — não há como desligar." }),
      campo("Assinatura", assinatura),
      campo("Tom da casa", tom),
      el("div", { classe: "reserva-acoes" }, [salvar]),
      testarComAvaliacaoManual(),
    ];
  }

  /** Lançamento manual: serve para ajustar o tom antes de ligar a automação. */
  function testarComAvaliacaoManual() {
    const autor = el("input", { placeholder: "Marina S." });
    const nota = el("select", {}, [5, 4, 3, 2, 1].map((n) =>
      el("option", { value: String(n), texto: `${estrelas(n)} ${n}` }),
    ));
    const comentario = el("textarea", { rows: 2 });
    comentario.placeholder = "Demorou 40 minutos pra sair o prato…";
    comentario.style.width = "100%";

    const botao = el("button", {
      classe: "btn btn-peq",
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
          avisar("Avaliação lançada e resposta redigida.", "ok");
          await carregar();
        } catch (err) {
          avisar(err.message, "erro");
        } finally {
          botao.disabled = false;
        }
      },
    });

    return el("details", { style: "margin-top:16px" }, [
      el("summary", { texto: "Testar com uma avaliação de mentira" }),
      el("p", {
        classe: "muted",
        texto:
          "Lança uma avaliação só no seu painel — nada é enviado ao Google. Use para ver o tom antes de conectar de verdade.",
      }),
      campo("Autor", autor),
      campo("Nota", nota),
      campo("Comentário", comentario),
      el("div", { classe: "reserva-acoes" }, [botao]),
    ]);
  }

  function campo(rotulo, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
  }
}
