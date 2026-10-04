import { get, post, put } from "../api.js";
import { avisar, dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Avaliações do Google.
 *
 * As avaliações chegam pela API oficial do Google, via Make: o dono entrou
 * com a conta Google do perfil, e o cenário do Make traz cada avaliação
 * nova e publica a resposta que o Brasa Food escreveu. A regra de nota
 * decide o que sai sozinho e o que espera uma pessoa aqui na fila. Aprovar
 * publica em segundos.
 *
 * O colar-e-copiar continua existindo para a casa que ainda não ligou o
 * Google: a resposta aprovada fica aqui para copiar.
 *
 * A regra que não muda: 1 e 2 estrelas nunca são respondidas sem alguém ler.
 * O servidor decide isso — a tela só mostra o que foi decidido.
 */

/** A conta que a equipe registra no perfil; o cliente não a vê. */
const CONTA_GERENTE_PADRAO = "agente@brasafood.app";

const SITUACOES = {
  pendente: ["aguardando redação", ""],
  rascunho: ["esperando você", "etiqueta-alerta"],
  aprovada: ["publicando no Google", "etiqueta-info"],
  publicada: ["respondida", "etiqueta-ok"],
  sem_resposta: ["sem resposta", "etiqueta-alerta"],
  descartada: ["sem resposta (decidido)", ""],
  erro: ["falhou", "etiqueta-perigo"],
};

/** Os recortes do histórico, na ordem em que aparecem. */
const FILTROS = [
  ["todas", "Todas"],
  ["respondidas", "Respondidas"],
  ["sem_resposta", "Sem resposta"],
  ["baixas", "Nota 1 e 2"],
];

const NUMERO = new Intl.NumberFormat("pt-BR");
const NOTA = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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
  const aviso = el("div", { classe: "cartao alerta" });
  const regras = el("div", { classe: "cartao" });
  const resumo = el("p", { classe: "muted" });
  const filtros = el("div", { classe: "abas" });
  const historico = el("div", { classe: "lista" });
  const verMais = el("div", { classe: "reserva-acoes" });
  let filtroAtivo = "todas";

  raiz.append(
    el("section", { classe: "pilha" }, [
      aviso,

      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Responder uma avaliação à mão" }),
          el("p", { classe: "muted", texto: "Para uma avaliação que não veio pelo Google (ou para testar o tom): cole o texto, a IA responde, você copia." }),
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
          el("h2", { texto: "Aprovadas" }),
          el("p", { classe: "muted", texto: "Com o Google ligado, o Make publica em segundos e a avaliação vai para o histórico. Sem ele, copie e cole no Google." }),
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
        el("div", {}, [
          el("h2", { texto: "Avaliações no Google" }),
          resumo,
        ]),
      ]),
      filtros,
      historico,
      verMais,
    ]),
  );

  await carregar();

  async function carregar() {
    limpar(fila).append(el("p", { classe: "muted", texto: "Carregando…" }));
    limpar(prontas);
    limpar(historico);
    limpar(verMais);

    const dados = await get(`/v1/venues/${ctx.venue}/avaliacoes?filtro=${filtroAtivo}`);

    limpar(fila);
    if (dados.fila.length === 0) {
      fila.append(vazio("Nada esperando", "Nenhuma resposta pendente da sua leitura."));
      ctx.atualizarContador("avaliacoes", 0);
    } else {
      ctx.atualizarContador("avaliacoes", dados.fila.length);
      for (const a of dados.fila) fila.append(cartaoDaFila(a));
    }

    const liberadas = (dados.aprovadas ?? []).filter((a) => a.resposta);
    if (liberadas.length === 0) {
      prontas.append(vazio("Nenhuma resposta esperando ser publicada"));
    } else {
      for (const a of liberadas) prontas.append(cartaoPronta(a));
    }

    limpar(regras).append(...formularioDeRegras(dados.perfil));
    desenharAviso(dados.perfil);
    desenharResumo(dados.perfil, dados.resumo);
    desenharFiltros();
    mostrarPagina(dados.historico, true);
  }

  // ---------- Histórico: igual ao Google ----------

  /** "★ 4,6 · 1.234 avaliações · 980 respondidas · 254 sem resposta". */
  function desenharResumo(perfil, r) {
    const partes = [];
    if (perfil?.nota_media) partes.push(`★ ${NOTA.format(perfil.nota_media)} no Google`);
    const total = perfil?.total_avaliacoes ?? r?.conhecidas ?? 0;
    partes.push(`${NUMERO.format(total)} ${total === 1 ? "avaliação" : "avaliações"}`);
    if (r) {
      partes.push(`${NUMERO.format(r.respondidas)} respondidas`);
      partes.push(`${NUMERO.format(r.sem_resposta)} sem resposta`);
      if (perfil?.total_avaliacoes && r.conhecidas < perfil.total_avaliacoes) {
        partes.push(`${NUMERO.format(perfil.total_avaliacoes - r.conhecidas)} ainda não importadas`);
      }
    }
    resumo.textContent = partes.join(" · ");
  }

  function desenharFiltros() {
    limpar(filtros).append(
      ...FILTROS.map(([valor, rotulo]) =>
        el("button", {
          classe: `aba ${valor === filtroAtivo ? "aba-ativa" : ""}`.trim(),
          type: "button",
          texto: rotulo,
          onclick: async () => {
            if (filtroAtivo === valor) return;
            filtroAtivo = valor;
            desenharFiltros();
            limpar(historico).append(el("p", { classe: "muted", texto: "Carregando…" }));
            limpar(verMais);
            const pagina = await get(`/v1/venues/${ctx.venue}/avaliacoes/historico?filtro=${filtroAtivo}`);
            mostrarPagina(pagina, true);
          },
        }),
      ),
    );
  }

  /** Mostra uma página e, se ela veio cheia, oferece a próxima. */
  function mostrarPagina(itens, primeira) {
    if (primeira) limpar(historico);
    limpar(verMais);
    if (itens.length === 0 && primeira) {
      historico.append(
        vazio(
          filtroAtivo === "todas" ? "Nenhuma avaliação ainda" : "Nada neste recorte",
          filtroAtivo === "todas" ? "Com o Google ligado, use \"Importar histórico do Google\" na configuração técnica para trazer tudo o que já está lá." : "",
        ),
      );
      return;
    }
    for (const a of itens) historico.append(cartaoDoHistorico(a));
    const ultima = itens[itens.length - 1];
    if (itens.length >= 50 && ultima?.avaliada_em) {
      const botao = el("button", {
        classe: "btn btn-peq",
        type: "button",
        texto: "Ver mais antigas",
        onclick: async () => {
          botao.disabled = true;
          try {
            const pagina = await get(
              `/v1/venues/${ctx.venue}/avaliacoes/historico?filtro=${filtroAtivo}&antes=${encodeURIComponent(ultima.avaliada_em)}`,
            );
            mostrarPagina(pagina, false);
          } catch (err) {
            avisar(err.message, "erro");
            botao.disabled = false;
          }
        },
      });
      verMais.append(botao);
    }
  }

  /** O recado do topo: ligado ao Google, ou ainda no colar-e-copiar. */
  function desenharAviso(perfil) {
    const ligado = Boolean(perfil?.make_webhook_url);
    limpar(aviso).append(
      el("p", {}, [
        el("strong", { texto: ligado ? "Ligado ao Google. " : "Ainda não ligado ao Google. " }),
        document.createTextNode(
          ligado
            ? "Avaliação nova entra aqui em algumas horas (o servidor confere o Google a cada 4 horas). As de nota alta são respondidas sozinhas, conforme a regra abaixo; as de nota baixa esperam o seu OK — ao aprovar, a resposta é publicada em segundos."
            : "Por enquanto: cole a avaliação, a IA escreve, você copia e cola no Google. Para ligar o Google, fale com a equipe Brasa Food.",
        ),
      ]),
    );
    aviso.classList.toggle("alerta", !ligado);
    aviso.classList.toggle("aviso-ok", ligado);
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
        avisar(acao === "aprovar" ? "Aprovada. Publicando no Google." : "Avaliação sem resposta.", "ok");
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
      title: "Use só se você mesmo colou a resposta no Google",
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
      el("p", { classe: "muted", texto: "Aguardando o Make publicar. Se demorar mais de alguns minutos, a equipe Brasa Food confere o cenário." }),
      el("div", { classe: "reserva-acoes" }, [botaoCopiar(a.resposta), jaColei]),
    ]);
  }

  /** Copiar para colar no Google — o caminho de quem ainda não ligou o Google. */
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

  /**
   * Um cartão por avaliação, como no Google: quem, quando, a nota, o que
   * escreveu — e embaixo a resposta da casa (ou o botão para a IA redigir).
   */
  function cartaoDoHistorico(a) {
    const [rotulo, variante] = SITUACOES[a.resposta_status] ?? [a.resposta_status, ""];
    const respondida = a.resposta_status === "publicada" && a.resposta;
    const podeRedigir = ["sem_resposta", "descartada", "pendente", "erro"].includes(a.resposta_status);

    return el("article", { classe: `cartao avaliacao ${respondida ? "" : "avaliacao-aberta"}`.trim() }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: a.autor || "Cliente do Google" }),
          el("p", { classe: "muted", texto: a.avaliada_em ? dataCurta(a.avaliada_em) : "" }),
        ]),
        el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" }, [
          etiqueta(`${estrelas(a.nota)} ${a.nota}`, classeDaNota(a.nota)),
          etiqueta(rotulo, variante),
        ]),
      ]),
      a.comentario
        ? el("p", { classe: "avaliacao-texto", texto: a.comentario })
        : el("p", { classe: "muted", texto: "Só a nota, sem comentário." }),
      respondida
        ? el("div", { classe: "avaliacao-resposta" }, [
            el("p", { classe: "avaliacao-resposta-de", texto: `Resposta da casa${a.publicada_em ? ` · ${dataCurta(a.publicada_em)}` : ""}` }),
            el("p", { texto: a.resposta }),
          ])
        : null,
      a.ultimo_erro ? el("p", { classe: "muted", texto: `Erro: ${a.ultimo_erro}` }) : null,
      podeRedigir ? el("div", { classe: "reserva-acoes" }, [botaoRedigir(a)]) : null,
    ]);
  }

  /** A IA escreve, e a avaliação vai para "Esperando você" — nunca sai sozinha. */
  function botaoRedigir(a) {
    const botao = el("button", {
      classe: "btn btn-peq",
      type: "button",
      texto: "Responder com a IA",
      title: "A IA redige e a resposta espera o seu OK na fila de cima",
      onclick: async () => {
        botao.disabled = true;
        botao.textContent = "Redigindo…";
        try {
          await post(`/v1/avaliacoes/${a.id}/redigir`, {});
          avisar("Resposta redigida — está em \"Esperando você\", no alto da tela.", "ok");
          await carregar();
        } catch (err) {
          avisar(err.message, "erro");
          botao.disabled = false;
          botao.textContent = "Responder com a IA";
        }
      },
    });
    return botao;
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
          "Decide o que é publicado sozinho, sem passar por você. Nota 1 e 2 sempre passam por você — não há como desligar.",
      }),
      campo("Assinatura", assinatura),
      campo("Tom da casa", tom),
      el("div", { classe: "reserva-acoes" }, [salvar]),
      blocoTecnico(perfil, conta),
    ];
  }

  /** O que só a equipe Brasa Food mexe. Nada aqui é pedido ao cliente. */
  function blocoTecnico(perfil, conta) {
    const contaGerente = el("input", { value: conta, placeholder: "Conta Google que autorizou no Make" });
    const localId = el("input", {
      placeholder: "accounts/…/locations/…",
      value: perfil?.local_nome ?? perfil?.local_id ?? "",
    });
    const makeWebhook = el("input", { placeholder: "https://hook.us2.make.com/…", value: perfil?.make_webhook_url ?? "" });

    const salvar = el("button", {
      classe: "btn btn-peq",
      type: "button",
      texto: "Salvar configuração técnica",
      onclick: async () => {
        salvar.disabled = true;
        try {
          const r = await put(`/v1/venues/${ctx.venue}/avaliacoes-perfil`, {
            conta_gerente: contaGerente.value.trim() || conta,
            local_id: localId.value.trim(),
            make_webhook_url: makeWebhook.value.trim(),
          });
          avisar(r.webhook_segredo ? "Configuração salva. O segredo da casa está no banco; a equipe põe o mesmo no cenário do Make." : "Configuração salva.", "ok");
          await carregar();
        } catch (err) {
          avisar(err.message, "erro");
          salvar.disabled = false;
        }
      },
    });

    return el("details", { style: "margin-top:16px" }, [
      el("summary", { texto: "Configuração técnica (equipe Brasa Food)" }),
      el("p", { classe: "muted", texto: "O Google entra pelo Make: a conta do dono autoriza lá, e os dois cenários (ler avaliações, publicar aprovadas) chamam este painel com o segredo da casa." }),
      campo("Conta Google que autorizou", contaGerente),
      campo("Local no Google (accounts/…/locations/…)", localId),
      campo("Webhook do Make que publica as aprovadas", makeWebhook),
      perfil?.ultima_sincronizacao
        ? el("p", { classe: "muted", texto: `Última avaliação recebida pelo Make: ${dataHora(perfil.ultima_sincronizacao)}` })
        : null,
      perfil?.importado_em
        ? el("p", { classe: "muted", texto: `Histórico do Google importado em ${dataHora(perfil.importado_em)}.` })
        : el("p", { classe: "muted", texto: "O histórico do Google ainda não foi importado: só as avaliações novas estão aqui." }),
      perfil?.ultimo_erro
        ? el("p", { classe: "muted", texto: `Último erro: ${perfil.ultimo_erro}` })
        : null,
      el("div", { classe: "reserva-acoes" }, [salvar, perfil?.make_webhook_url ? botaoImportar() : null]),
    ]);
  }

  /** Pede ao Make o histórico inteiro, página a página. Pode repetir: nada duplica. */
  function botaoImportar() {
    const botao = el("button", {
      classe: "btn btn-peq",
      type: "button",
      texto: "Importar histórico do Google",
      onclick: async () => {
        botao.disabled = true;
        try {
          await post(`/v1/venues/${ctx.venue}/avaliacoes/importar`, {});
          avisar("Importando. Cada página de 50 leva alguns segundos — recarregue daqui a pouco.", "ok");
        } catch (err) {
          avisar(err.message, "erro");
        } finally {
          botao.disabled = false;
        }
      },
    });
    return botao;
  }

  /** Dia e mês, como o Google mostra; o ano só quando não é o atual. */
  function dataCurta(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const mesmoAno = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString("pt-BR", mesmoAno ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "short", year: "numeric" });
  }

  function campo(rotulo, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
  }
}
