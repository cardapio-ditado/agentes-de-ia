import { del, get, patch, post } from "../api.js";
import { ICONES, acaoIcone, avisar, campoDeFormulario, comIcone, dataHora, el, esqueleto, estadoDeErro, etiqueta, faixaDeAviso, indicador, limpar, plural, tabelaDeDados, vazio } from "../ui.js";
import { botaoDePdf, imprimirRelatorio } from "../relatorio.js";

/**
 * Fila de aprovação.
 *
 * O agente coleta os dados e para: nenhuma reserva é confirmada ao cliente sem
 * uma pessoa decidir aqui. Recusar exige motivo — o cliente precisa saber o porquê.
 *
 * Reservas nunca somem sozinhas do banco: a confirmada sai desta tela 6 horas
 * depois do horário, mas a linha continua lá com o status dela. Excluir é a
 * exceção (dado de teste, lançamento errado); cancelar preserva o histórico.
 */
export async function reservas(raiz, ctx) {
  const lista = el("div", { classe: "lista fila-de-reservas" });
  const listaConfirmadas = el("div", { classe: "pilha-fina" });
  const numeros = el("div", { classe: "grade" });
  // O editor de uma confirmada abre acima da tabela, e não dentro da linha.
  const edicaoDaConfirmada = el("div", {});
  let confirmadasAgora = [];

  /**
   * A lista da recepção: quem vem, a que horas, quantos, onde quer sentar.
   * Um papel na porta resolve o que o celular no bolso não resolve na hora
   * do aperto. Agrupada por dia, na ordem do horário.
   */
  function listaDaRecepcao() {
    const diaDe = (iso) => new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const ordenadas = [...confirmadasAgora].sort((a, b) => a.reserved_for.localeCompare(b.reserved_for));
    const dias = [...new Set(ordenadas.map((r) => diaDe(r.reserved_for)))];
    imprimirRelatorio({
      tipo: "Atendente virtual",
      titulo: "Reservas confirmadas",
      periodo: `impresso em ${new Date().toLocaleDateString("pt-BR")}`,
      selos: [
        { valor: String(ordenadas.length), rotulo: "reservas" },
        { valor: String(ordenadas.reduce((t, r) => t + Number(r.party_size || 0), 0)), rotulo: "pessoas" },
      ],
      secoes: dias.length
        ? dias.map((dia) => {
            const doDia = ordenadas.filter((r) => diaDe(r.reserved_for) === dia);
            return {
              titulo: `${dia} — ${doDia.reduce((t, r) => t + Number(r.party_size || 0), 0)} pessoas`,
              colunas: [{ rotulo: "Hora" }, { rotulo: "Nome" }, { rotulo: "Pessoas", num: true }, { rotulo: "Telefone" }, { rotulo: "Área / ocasião / obs." }, { rotulo: "Chegou" }],
              linhas: doDia.map((r) => [
                hora(r.reserved_for),
                r.customer_name,
                String(r.party_size),
                r.customer_phone ?? "",
                [r.area_preference, r.occasion, r.notes].filter(Boolean).join(" · "),
                "☐",
              ]),
            };
          })
        : [{ titulo: "Reservas", paragrafos: ["Nenhuma reserva confirmada por vir."] }],
      arquivo: `reservas-${new Date().toISOString().slice(0, 10)}`,
    });
  }

  ctx.definirAcoes?.(
    botaoDePdf(listaDaRecepcao, "Lista da recepção"),
    el("button", { classe: "btn", type: "button", onclick: carregar }, comIcone(ICONES.atualizar, "Atualizar")),
  );

  const titulo = (texto, detalhe) => el("div", {}, [el("h2", { texto }), el("p", { classe: "muted", texto: detalhe })]);
  raiz.append(
    el("section", { classe: "pilha" }, [
      numeros,
      titulo("Fila de aprovação", "Reservas anotadas pelo atendente virtual ou pedidas no site da casa, aguardando decisão."),
      lista,
      titulo("Confirmadas — próximas", "O que a casa tem para receber: reservas aprovadas que ainda vão acontecer."),
      edicaoDaConfirmada,
      listaConfirmadas,
      // Os avisos automáticos se configuram uma vez: ficam por último, para
      // não empurrar a fila de todo dia para baixo.
      await blocoDeAvisos(ctx),
      // A porta por onde entram as reservas do formulário da própria casa.
      ctx.podeConfigurar === false ? null : await blocoDoSite(ctx),
    ]),
  );

  await carregar();

  async function carregar() {
    limpar(lista).append(esqueleto({ linhas: 3 }));
    limpar(listaConfirmadas);
    limpar(edicaoDaConfirmada);

    let pendentes, confirmadas;
    try {
      [pendentes, confirmadas] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/reservations`),
        get(`/v1/venues/${ctx.venue}/reservations?status=approved`),
      ]);
    } catch (e) {
      limpar(numeros);
      limpar(lista).append(estadoDeErro("Não deu para carregar as reservas", e.message, carregar));
      return;
    }

    confirmadasAgora = confirmadas;
    desenharNumeros(pendentes, confirmadas);
    limpar(lista);
    if (pendentes.length === 0) {
      lista.append(vazio("Nenhuma reserva na fila", "Tudo decidido por aqui."));
      ctx.atualizarContador("reservas", 0);
    } else {
      ctx.atualizarContador("reservas", pendentes.length);
      for (const r of pendentes) lista.append(cartaoReserva(r));
    }

    if (confirmadas.length === 0) {
      listaConfirmadas.append(vazio("Nenhuma reserva confirmada por vir"));
    } else {
      listaConfirmadas.append(tabelaDasConfirmadas(confirmadas));
    }
  }

  /** Os números saem das duas listas que a tela já carregou. */
  function desenharNumeros(pendentes, confirmadas) {
    const pessoas = confirmadas.reduce((t, r) => t + Number(r.party_size || 0), 0);
    const proxima = [...confirmadas].sort((a, b) => a.reserved_for.localeCompare(b.reserved_for))[0];
    limpar(numeros).append(
      indicador({
        rotulo: "Na fila",
        valor: pendentes.length,
        nota: pendentes.length ? "o cliente está esperando a resposta" : "nada para decidir agora",
        iconePath: ICONES.relogio,
        cor: "marca",
        tom: pendentes.length ? "alerta" : undefined,
      }),
      indicador({ rotulo: "Confirmadas por vir", valor: confirmadas.length, nota: confirmadas.length === 1 ? "reserva aprovada" : "reservas aprovadas", iconePath: ICONES.reservas, cor: "musgo" }),
      indicador({ rotulo: "Pessoas esperadas", valor: pessoas, nota: "somando as confirmadas", iconePath: ICONES.pessoas, cor: "areia" }),
      indicador({
        rotulo: "Próxima reserva",
        valor: proxima ? dataHora(proxima.reserved_for) : "—",
        nota: proxima ? `${proxima.customer_name} · ${plural(proxima.party_size, "pessoa", "pessoas")}` : "nenhuma por vir",
        iconePath: ICONES.calendario,
        cor: "pinho",
      }),
    );
  }

  /**
   * As confirmadas em tabela, na ordem do horário: é o mapa do serviço. A
   * vida muda — dá para editar, cancelar (fica no histórico) ou excluir
   * (some de vez).
   */
  function tabelaDasConfirmadas(confirmadas) {
    const ordenadas = [...confirmadas].sort((a, b) => a.reserved_for.localeCompare(b.reserved_for));
    return tabelaDeDados({
      colunas: [
        { rotulo: "Cliente", principal: true },
        { rotulo: "Para", largura: "150px" },
        { rotulo: "Pessoas", num: true, largura: "90px" },
        { rotulo: "Área, ocasião e observações", largura: "32%", quebra: true, larga: true },
        { rotulo: "Ações", largura: "150px", acoes: true },
      ],
      larguraMinima: "860px",
      linhas: ordenadas.map((r) => ({
        celulas: [
          el("span", {}, [document.createTextNode(r.customer_name), r.customer_phone ? el("small", { texto: r.customer_phone }) : null]),
          dataHora(r.reserved_for),
          String(r.party_size),
          [r.area_preference, r.occasion, r.notes].filter(Boolean).join(" · ") || null,
          el("span", { classe: "grupo-acoes" }, [
            acaoIcone({
              iconePath: ICONES.editar,
              rotulo: `Editar a reserva de ${r.customer_name}`,
              aoClicar: () => {
                const jaAberta = edicaoDaConfirmada.dataset.reserva === r.id && edicaoDaConfirmada.childElementCount > 0;
                limpar(edicaoDaConfirmada);
                edicaoDaConfirmada.dataset.reserva = r.id;
                if (jaAberta) return;
                const area = el("div", {});
                edicaoDaConfirmada.append(el("section", { classe: "cartao" }, [el("h3", { texto: `Editar a reserva de ${r.customer_name}` }), area]));
                alternarEdicao(area, r, () => limpar(edicaoDaConfirmada));
                edicaoDaConfirmada.scrollIntoView({ behavior: "smooth", block: "center" });
              },
            }),
            acaoIcone({
              iconePath: ICONES.fechar,
              rotulo: "Cancelar a reserva (fica no histórico)",
              aoClicar: async (e) => {
                if (!confirm(`Cancelar a reserva de ${r.customer_name}? O cliente NÃO é avisado automaticamente — combine com ele pelo WhatsApp.`)) return;
                const botao = e.currentTarget;
                botao.disabled = true;
                try {
                  await post(`/v1/reservations/${r.id}/cancel`, {});
                  avisar("Reserva cancelada. Lembre de avisar o cliente.", "ok");
                  await carregar();
                } catch (err) {
                  avisar(err.message, "erro");
                  botao.disabled = false;
                }
              },
            }),
            acaoIcone({
              iconePath: ICONES.lixeira,
              rotulo: "Excluir de vez (dado de teste ou lançamento errado)",
              variante: "perigo",
              aoClicar: async (e) => {
                if (!confirm(`Excluir DE VEZ a reserva de ${r.customer_name}? Isso apaga também o histórico dela. Para cancelamento normal, use "Cancelar reserva".`)) return;
                const botao = e.currentTarget;
                botao.disabled = true;
                try {
                  await del(`/v1/reservations/${r.id}`);
                  avisar("Reserva excluída.", "ok");
                  await carregar();
                } catch (err) {
                  avisar(err.message, "erro");
                  botao.disabled = false;
                }
              },
            }),
          ]),
        ],
      })),
    });
  }

  function cartaoReserva(r) {
    const motivo = el("input", { placeholder: "Motivo (obrigatório para recusar)", "aria-label": "Motivo da recusa (obrigatório para recusar)" });
    const areaEdicao = el("div", {});

    const btnAprovar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Aprovar",
      onclick: () => decidir("approve"),
    });
    const btnRecusar = el("button", {
      classe: "btn btn-perigo btn-peq",
      type: "button",
      texto: "Recusar",
      onclick: () => decidir("reject"),
    });

    const cartao = el("article", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: r.customer_name }),
          el("p", { classe: "muted", texto: r.customer_phone }),
        ]),
        el("div", { classe: "cel-etiquetas" }, [
          r.source_channel === "link" ? etiqueta("Pelo site") : null,
          etiqueta(plural(r.party_size, "pessoa", "pessoas"), "etiqueta-info"),
        ]),
      ]),
      linha("Para", dataHora(r.reserved_for)),
      r.area_preference ? linha("Área", r.area_preference) : null,
      r.occasion ? linha("Ocasião", r.occasion) : null,
      r.notes ? linha("Observações", r.notes) : null,
      linha("Pedida em", dataHora(r.created_at)),
      areaEdicao,
      el("div", { style: "margin-top:12px" }, [motivo]),
      el("div", { classe: "reserva-acoes" }, [
        btnAprovar,
        btnRecusar,
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Editar",
          onclick: () => alternarEdicao(areaEdicao, r),
        }),
        botaoExcluir(r),
      ]),
    ]);

    async function decidir(acao) {
      if (acao === "reject" && !motivo.value.trim()) {
        avisar("Recusar exige um motivo — o cliente precisa saber por quê.", "erro");
        motivo.focus();
        return;
      }
      btnAprovar.disabled = true;
      btnRecusar.disabled = true;

      try {
        const res = await post(`/v1/reservations/${r.id}/${acao}`, {
          motivo: motivo.value.trim() || undefined,
        });

        // A decisão fica gravada mesmo se a mensagem não sair; por isso o aviso
        // distingue os três casos em vez de dizer só "pronto".
        const n = res.notificacao;
        if (!n) {
          avisar("Decisão registrada. Nenhuma notificação foi disparada.", "ok");
        } else if (n.status === "sent") {
          avisar("Decisão registrada e cliente avisado no WhatsApp.", "ok");
        } else if (n.status === "pending") {
          avisar(
            "Decisão registrada. A mensagem entra na fila e o WhatsApp do bar envia em segundos.",
            "ok",
          );
        } else {
          avisar(`Decisão registrada, mas o aviso ao cliente falhou: ${n.erro ?? n.status}.`, "erro");
        }
        await carregar();
      } catch (e) {
        avisar(e.message, "erro");
        btnAprovar.disabled = false;
        btnRecusar.disabled = false;
      }
    }

    return cartao;
  }

  /** Excluir é para dado de teste ou lançamento errado — apaga de vez, sem
   *  histórico. Cancelamento de verdade usa "Cancelar reserva". */
  function botaoExcluir(r) {
    return el("button", {
      classe: "btn btn-perigo btn-peq",
      type: "button",
      texto: "Excluir",
      onclick: async (e) => {
        if (!confirm(`Excluir DE VEZ a reserva de ${r.customer_name}? Isso apaga também o histórico dela. Para cancelamento normal, use "Cancelar reserva".`)) return;
        e.target.disabled = true;
        try {
          await del(`/v1/reservations/${r.id}`);
          avisar("Reserva excluída.", "ok");
          await carregar();
        } catch (err) {
          avisar(err.message, "erro");
          e.target.disabled = false;
        }
      },
    });
  }

  /** Abre (ou fecha, se já aberto) o formulário de edição dentro do cartão. */
  function alternarEdicao(area, r, aoDescartar = () => limpar(area)) {
    if (area.childElementCount > 0) {
      limpar(area);
      return;
    }

    const nome = el("input", { value: r.customer_name });
    const telefone = el("input", { value: r.customer_phone });
    const pessoas = el("input", { type: "number", min: "1", value: String(r.party_size) });
    const quando = el("input", { type: "datetime-local", value: paraDatetimeLocal(r.reserved_for) });
    const areaPref = el("input", { value: r.area_preference ?? "", placeholder: "Área (opcional)" });
    const obs = el("input", { value: r.notes ?? "", placeholder: "Observações (opcional)" });

    area.append(
      el("div", { classe: "form-grade formulario", style: "margin-top:12px" }, [
        campo("Nome", nome),
        campo("Telefone", telefone),
        campo("Pessoas", pessoas),
        campo("Data e hora", quando),
        campo("Área", areaPref),
        campo("Observações", obs),
        el("div", { classe: "reserva-acoes" }, [
          el("button", {
            classe: "btn btn-primario btn-peq",
            type: "button",
            texto: "Salvar",
            onclick: async (e) => {
              const quandoData = new Date(quando.value);
              if (Number.isNaN(quandoData.getTime())) {
                avisar("Data e hora inválidas.", "erro");
                return;
              }
              e.target.disabled = true;
              try {
                await patch(`/v1/reservations/${r.id}`, {
                  customer_name: nome.value,
                  customer_phone: telefone.value,
                  party_size: Number(pessoas.value),
                  reserved_for: quandoData.toISOString(),
                  area_preference: areaPref.value,
                  notes: obs.value,
                });
                avisar("Reserva atualizada.", "ok");
                await carregar();
              } catch (err) {
                avisar(err.message, "erro");
                e.target.disabled = false;
              }
            },
          }),
          el("button", {
            classe: "btn btn-peq",
            type: "button",
            texto: "Descartar",
            onclick: aoDescartar,
          }),
        ]),
      ]),
    );
  }

  function campo(rotulo, controle) {
    return campoDeFormulario(rotulo, controle);
  }

  /** ISO (UTC) → valor de <input type="datetime-local"> no fuso do navegador. */
  function paraDatetimeLocal(iso) {
    const d = new Date(iso);
    const dois = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
  }

  function linha(rotulo, valor) {
    return el("div", { classe: "linha-dado" }, [
      el("span", { texto: rotulo }),
      el("strong", { texto: String(valor) }),
    ]);
  }
}

/**
 * Os dois avisos automáticos das reservas.
 *
 * Ficam aqui, e não em "A casa": são ajustes DA RESERVA, e quem os procura
 * está justamente olhando a fila. Recolhido por padrão — configura-se uma vez
 * e não se mexe mais, e aberto ele empurraria a fila para baixo todo dia.
 */
async function blocoDeAvisos(ctx) {
  let venue;
  try {
    venue = await get(`/v1/venues/${ctx.venue}`);
  } catch {
    // Sem os ajustes a fila continua funcionando; é isso que importa aqui.
    return null;
  }

  const gestor = el("input", {
    type: "tel",
    value: venue.reservas_avisar_whatsapp ?? "",
    placeholder: "(65) 99999-0000",
  });

  const minutos = el(
    "select",
    { classe: "select" },
    [
      ["0", "Não lembrar"],
      ["30", "30 minutos antes"],
      ["60", "1 hora antes"],
      ["120", "2 horas antes"],
      ["180", "3 horas antes"],
      ["360", "6 horas antes"],
      ["720", "12 horas antes"],
      ["1440", "1 dia antes"],
    ].map(([v, r]) =>
      el("option", { value: v, texto: r, selected: Number(v) === Number(venue.reserva_lembrete_minutos ?? 60) }),
    ),
  );

  const salvar = el("button", {
    classe: "btn btn-primario",
    type: "button",
    texto: "Salvar",
    onclick: async () => {
      salvar.disabled = true;
      try {
        await patch(`/v1/venues/${ctx.venue}`, {
          reservas_avisar_whatsapp: gestor.value.trim(),
          reserva_lembrete_minutos: Number(minutos.value),
        });
        avisar("Ajustes salvos.", "ok");
      } catch (e) {
        avisar(e.message, "erro");
      } finally {
        salvar.disabled = false;
      }
    },
  });

  const corpo = el("div", { hidden: true, style: "margin-top:12px" }, [
    el("div", { classe: "grade-2" }, [
      el("div", { classe: "campo" }, [
        el("label", { texto: "Avisar quem analisa as reservas" }),
        gestor,
        el("small", {
          classe: "muted",
          texto:
            "Assim que o atendente virtual registrar uma reserva, esta pessoa recebe no WhatsApp o nome, o horário e a observação — sem precisar abrir o painel. Deixe vazio para não avisar ninguém.",
        }),
      ]),
      el("div", { classe: "campo" }, [
        el("label", { texto: "Lembrar o cliente antes da reserva" }),
        minutos,
        el("small", {
          classe: "muted",
          texto:
            "Só para reservas já aprovadas, e só quem reservou com antecedência. A mensagem convida a avisar se não puder vir — é o que libera a mesa a tempo.",
        }),
      ]),
    ]),
    el("div", { classe: "linha-campos", style: "margin-top:12px" }, [salvar]),
    el("p", {
      classe: "muted",
      style: "margin-top:6px",
      texto: "As duas mensagens saem pelo número de avisos da casa, configurado em Ajustes → WhatsApp e Instagram.",
    }),
  ]);

  const alternar = el("button", {
    classe: "btn btn-peq",
    type: "button",
    texto: "Ajustar",
    onclick: () => {
      corpo.hidden = !corpo.hidden;
      alternar.textContent = corpo.hidden ? "Ajustar" : "Fechar";
    },
  });

  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "Avisos automáticos" }),
        el("p", {
          classe: "muted",
          texto: resumoDosAvisos(venue),
        }),
      ]),
      alternar,
    ]),
    corpo,
  ]);
}

/**
 * Reservas que chegam pelo formulário do site da casa.
 *
 * O formulário mora em outro sistema; ele avisa este endereço a cada
 * pré-reserva, e daí em diante ela é uma reserva como as outras: cai na fila,
 * a gerência recebe o aviso, o cliente recebe a confirmação e o lembrete.
 *
 * A chave aparece UMA vez, na hora em que é gerada — aqui só se guarda o
 * resumo dela. Quem a perde gera outra, e a antiga para de valer.
 */
async function blocoDoSite(ctx) {
  let dados;
  try {
    dados = await get(`/v1/venues/${ctx.venue}/reservas-link`);
  } catch {
    // Sem isto a fila continua funcionando; é ela que importa nesta tela.
    return null;
  }

  const resumo = el("p", { classe: "muted" });
  const corpo = el("div", { hidden: true, style: "margin-top:12px" });
  const alternar = el("button", {
    classe: "btn btn-peq",
    type: "button",
    texto: "Ajustar",
    "aria-expanded": "false",
    onclick: () => {
      corpo.hidden = !corpo.hidden;
      alternar.textContent = corpo.hidden ? "Ajustar" : "Fechar";
      alternar.setAttribute("aria-expanded", String(!corpo.hidden));
    },
  });

  /** Um valor para copiar: campo só de leitura com o botão ao lado. */
  function copiavel(rotulo, valor, ajuda, oQue) {
    const campo = el("input", { type: "text", value: valor, readonly: true, onfocus: (e) => e.target.select() });
    const botao = el("button", {
      classe: "btn",
      type: "button",
      texto: "Copiar",
      "aria-label": `Copiar ${oQue}`,
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(valor);
          avisar(`${oQue[0].toUpperCase()}${oQue.slice(1)} copiado.`, "ok");
        } catch {
          campo.focus();
          avisar("Não deu para copiar sozinho. O texto está selecionado: copie à mão.", "erro");
        }
      },
    });
    return campoDeFormulario(rotulo, el("div", { classe: "campo-com-botao" }, [campo, botao]), { ajuda });
  }

  function desenhar(chaveNova = null) {
    resumo.textContent = resumoDoSite(dados);
    const gerar = el("button", {
      classe: dados.tem_chave ? "btn" : "btn btn-primario",
      type: "button",
      texto: dados.tem_chave ? "Trocar a chave" : "Gerar chave",
      onclick: async () => {
        if (dados.tem_chave && !confirm("Trocar a chave? A chave atual para de valer na hora: o formulário do site só volta a avisar depois que a nova for cadastrada lá.")) return;
        gerar.disabled = true;
        try {
          const r = await post(`/v1/venues/${ctx.venue}/reservas-link/chave`, {});
          dados = { ...dados, tem_chave: true, chave_criada_em: new Date().toISOString() };
          desenhar(r.chave);
        } catch (e) {
          avisar(e.message, "erro");
          gerar.disabled = false;
        }
      },
    });
    const desligar = dados.tem_chave
      ? el("button", {
          classe: "btn btn-perigo",
          type: "button",
          texto: "Desligar",
          onclick: async () => {
            if (!confirm("Desligar o recebimento? As reservas feitas no site deixam de chegar aqui, e ninguém é avisado delas pelo WhatsApp, até uma nova chave ser gerada e cadastrada lá.")) return;
            desligar.disabled = true;
            try {
              await del(`/v1/venues/${ctx.venue}/reservas-link/chave`);
              dados = { ...dados, tem_chave: false, chave_criada_em: null };
              desenhar();
              avisar("Recebimento desligado.", "ok");
            } catch (e) {
              avisar(e.message, "erro");
              desligar.disabled = false;
            }
          },
        })
      : null;

    limpar(corpo).append(
      chaveNova
        ? el("div", { classe: "pilha-fina", style: "margin-bottom:12px" }, [
            faixaDeAviso({
              tom: "alerta",
              titulo: "Copie a chave agora",
              detalhe: "Ela aparece só desta vez. Cadastre no sistema do site e não mande por mensagem nem cole em conversa: quem tem a chave consegue criar reserva em nome da casa.",
            }),
            copiavel("Chave", chaveNova, "Se perder, é só trocar: a antiga para de valer.", "chave"),
          ])
        : null,
      el("div", { classe: "grade-2" }, [
        copiavel("Endereço que recebe o aviso", dados.endereco, "O sistema do site envia para cá a cada pré-reserva (método POST, corpo em JSON).", "endereço"),
        copiavel("Nome do cabeçalho da chave", dados.cabecalho, "A chave vai neste cabeçalho, em toda chamada.", "nome do cabeçalho"),
      ]),
      el("div", { classe: "linha-campos", style: "margin-top:12px" }, [gerar, desligar]),
      el("p", {
        classe: "muted",
        style: "margin-top:6px",
        texto:
          "A reserva do site entra na fila de aprovação como as outras. Quem analisa recebe o aviso, e o cliente recebe a confirmação e o lembrete — tudo pelos números da casa.",
      }),
    );
  }

  desenhar();
  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [el("div", {}, [el("h3", { texto: "Reservas pelo site da casa" }), resumo]), alternar]),
    corpo,
  ]);
}

/** O estado em uma frase — para saber se está ligado sem abrir. */
function resumoDoSite(dados) {
  if (!dados.tem_chave) return "Desligado. As reservas feitas no formulário do site não chegam aqui.";
  const partes = ["Ligado"];
  if (dados.recebidas > 0) {
    partes.push(`${plural(dados.recebidas, "reserva recebida", "reservas recebidas")}`);
    if (dados.ultima_recebida_em) partes.push(`a última em ${dataHora(dados.ultima_recebida_em)}`);
  } else {
    partes.push("nenhuma reserva recebida ainda");
  }
  return `${partes.join(" · ")}.`;
}

/** O estado atual em uma frase — para não precisar abrir para saber. */
function resumoDosAvisos(venue) {
  const partes = [];
  const gestor = (venue.reservas_avisar_whatsapp ?? "").trim();
  partes.push(gestor ? `Reserva nova avisa ${gestor}` : "Ninguém é avisado de reserva nova");

  const minutos = Number(venue.reserva_lembrete_minutos ?? 60);
  if (minutos === 0) partes.push("cliente não recebe lembrete");
  else if (minutos < 60) partes.push(`cliente lembrado ${minutos} min antes`);
  else if (minutos === 60) partes.push("cliente lembrado 1 hora antes");
  else if (minutos < 1440) partes.push(`cliente lembrado ${minutos / 60} horas antes`);
  else partes.push("cliente lembrado 1 dia antes");

  return `${partes.join(" · ")}.`;
}
