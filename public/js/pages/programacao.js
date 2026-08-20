import { del, get, post } from "../api.js";
import { avisar, dataHora, diaNaCasa, dinheiro, el, etiqueta, horaNaCasa, limpar, vazio } from "../ui.js";

const TIPOS = [
  ["musica", "Música"],
  ["jogo", "Jogo"],
  ["promocao", "Promoção"],
  ["evento", "Evento"],
  ["outro", "Outro"],
];

const DIAS_SEMANA = [
  ["seg", "Seg"],
  ["ter", "Ter"],
  ["qua", "Qua"],
  ["qui", "Qui"],
  ["sex", "Sex"],
  ["sab", "Sáb"],
  ["dom", "Dom"],
];

// Um evento sem data final vira ~12 semanas de linhas no banco de uma vez —
// perto do fim, a série ganha um aviso pra renovar.
const AVISO_RENOVACAO_DIAS = 14;

/** Agenda do estabelecimento: é daqui que o agente tira o que contar. */
export async function programacao(raiz, ctx) {
  const lista = el("div", { classe: "lista" });
  const calendario = el("div", { hidden: true });

  /** Tudo que veio do servidor. Os filtros trabalham em cima disto. */
  let eventosCarregados = [];
  let visao = "lista";
  /** Primeiro dia do mês que o calendário mostra. */
  let mesVisivel = inicioDoMes(new Date());

  const campos = {
    titulo: el("input", { required: true, placeholder: "Samba de Raiz — Grupo X" }),
    tipo: el("select", {}, TIPOS.map(([v, r]) => el("option", { value: v, texto: r }))),
    data: el("input", { type: "datetime-local", required: true }),
    couvert: el("input", { type: "number", min: "0", step: "0.01", placeholder: "0" }),
    descricao: el("input", { placeholder: "Roda de samba na área externa" }),
  };

  const repeticao = el(
    "select",
    {},
    [
      ["none", "Não se repete"],
      ["weekly", "Toda semana"],
      ["daily", "Todo dia"],
    ].map(([v, r]) => el("option", { value: v, texto: r })),
  );

  const checksDias = DIAS_SEMANA.map(([valor, rotulo]) => {
    const caixa = el("input", { type: "checkbox", value: valor, id: `dia-${valor}` });
    return { valor, caixa, item: el("label", { classe: "check-dia" }, [caixa, el("span", { texto: rotulo })]) };
  });
  const areaDias = el("div", { classe: "campo campo-largo", hidden: true }, [
    el("label", { texto: "Em quais dias" }),
    el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" }, checksDias.map((c) => c.item)),
  ]);

  const temDataFinal = el("input", { type: "checkbox", id: "tem-data-final" });
  const campoAte = el("input", { type: "date", hidden: true });
  const areaAte = el("div", { classe: "campo campo-largo", hidden: true }, [
    el("label", {}, [
      temDataFinal,
      el("span", { texto: " Definir uma data final", style: "margin-left:6px" }),
    ]),
    el("p", {
      classe: "muted",
      texto: "Sem data final cadastramos as próximas ~12 semanas; perto do fim o painel avisa pra renovar.",
    }),
    campoAte,
  ]);

  // Sem repetição só a data única aparece; com repetição, os dias (se semanal)
  // e a data final entram no lugar.
  repeticao.addEventListener("change", () => {
    const semanal = repeticao.value === "weekly";
    const recorrente = repeticao.value !== "none";
    areaDias.hidden = !semanal;
    areaAte.hidden = !recorrente;
    // Ajuda quem só quer marcar "toda quarta" sem clicar duas vezes: pré-marca
    // o dia da semana da data já escolhida.
    if (semanal && campos.data.value && checksDias.every((c) => !c.caixa.checked)) {
      const idx = (new Date(campos.data.value).getDay() + 6) % 7;
      checksDias[idx].caixa.checked = true;
    }
  });
  temDataFinal.addEventListener("change", () => {
    campoAte.hidden = !temDataFinal.checked;
  });

  const form = el("form", { classe: "cartao", onsubmit: criar }, [
    el("h3", { texto: "Novo item na programação" }),
    el("div", { classe: "grade", style: "margin-top:12px" }, [
      campo("Título", campos.titulo),
      campo("Tipo", campos.tipo),
      campo("Data e hora (primeira, se repetir)", campos.data),
      campo("Repetição", repeticao),
      areaDias,
      areaAte,
      campo("Couvert (R$)", campos.couvert),
      el("div", { classe: "campo campo-largo" }, [
        el("label", { texto: "Descrição" }),
        campos.descricao,
      ]),
    ]),
    el("button", { classe: "btn btn-primario", type: "submit", texto: "Adicionar", style: "margin-top:12px" }),
  ]);

  /* ---------- filtros e visões ---------- */

  const filtroTipo = el("select", { classe: "select" }, [
    el("option", { value: "", texto: "Todos os tipos" }),
    ...TIPOS.map(([v, r]) => el("option", { value: v, texto: r })),
  ]);
  filtroTipo.addEventListener("change", desenhar);

  // Na lista, o período é um recorte pronto — "o que vem por aí" é o que se
  // olha 90% das vezes. No calendário, o período É o mês na tela, então o
  // seletor dá lugar à navegação entre meses.
  const filtroPeriodo = el("select", { classe: "select" }, [
    el("option", { value: "futuros", texto: "Próximos" }),
    el("option", { value: "30", texto: "Próximos 30 dias" }),
    el("option", { value: "passados", texto: "Já aconteceram" }),
    el("option", { value: "tudo", texto: "Tudo" }),
  ]);
  filtroPeriodo.addEventListener("change", desenhar);

  const tituloMes = el("strong", { style: "min-width:11ch;text-align:center" });
  const navegacaoMes = el("div", { classe: "linha-campos", style: "align-items:center" }, [
    el("button", {
      classe: "btn btn-peq", type: "button", texto: "‹", title: "Mês anterior",
      onclick: () => { mesVisivel = somarMeses(mesVisivel, -1); desenhar(); },
    }),
    tituloMes,
    el("button", {
      classe: "btn btn-peq", type: "button", texto: "›", title: "Próximo mês",
      onclick: () => { mesVisivel = somarMeses(mesVisivel, 1); desenhar(); },
    }),
    el("button", {
      classe: "btn btn-peq", type: "button", texto: "Hoje",
      onclick: () => { mesVisivel = inicioDoMes(new Date()); desenhar(); },
    }),
  ]);

  const rotuloPeriodo = el("label", { classe: "campo-rotulado", style: "flex:1" }, [
    el("span", { texto: "Período" }),
    filtroPeriodo,
    navegacaoMes,
  ]);

  function botaoVisao(id, texto) {
    return el("button", {
      classe: `aba ${visao === id ? "aba-ativa" : ""}`.trim(),
      type: "button",
      texto,
      "data-visao": id,
      onclick: () => {
        visao = id;
        for (const b of raiz.querySelectorAll("[data-visao]")) {
          b.classList.toggle("aba-ativa", b.dataset.visao === id);
        }
        desenhar();
      },
    });
  }

  raiz.append(
    el("div", { classe: "pilha" }, [
      form,
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Agenda" }),
            el("p", { classe: "muted", texto: "O agente cita estes itens quando o cliente pergunta." }),
          ]),
          el("div", { classe: "abas" }, [botaoVisao("lista", "Lista"), botaoVisao("calendario", "Calendário")]),
        ]),
        el("div", { classe: "linha-campos" }, [
          el("label", { classe: "campo-rotulado", style: "flex:1" }, [
            el("span", { texto: "Tipo" }),
            filtroTipo,
          ]),
          rotuloPeriodo,
        ]),
        lista,
        calendario,
      ]),
    ]),
  );

  await carregarEventos();

  async function carregarEventos() {
    limpar(lista).append(el("p", { classe: "muted", texto: "Carregando…" }));
    eventosCarregados = await get(`/v1/venues/${ctx.venue}/events`);
    desenhar();
  }

  /** Redesenha a visão atual com os filtros aplicados. Não vai ao servidor. */
  function desenhar() {
    const noCalendario = visao === "calendario";
    lista.hidden = noCalendario;
    calendario.hidden = !noCalendario;
    // No calendário o período é o mês navegado; o seletor sairia sobrando e
    // ainda daria a impressão de que os dois recortes se somam.
    filtroPeriodo.hidden = noCalendario;
    navegacaoMes.hidden = !noCalendario;

    if (noCalendario) desenharCalendario();
    else desenharLista();
  }

  /** Aplica os filtros. O de período só vale na lista. */
  function filtrados({ comPeriodo }) {
    const tipo = filtroTipo.value;
    const agora = new Date();
    return eventosCarregados.filter((ev) => {
      if (tipo && ev.kind !== tipo) return false;
      if (!comPeriodo) return true;
      const quando = new Date(ev.starts_at);
      switch (filtroPeriodo.value) {
        case "futuros":
          return quando >= agora;
        case "30":
          return quando >= agora && quando <= new Date(agora.getTime() + 30 * 864e5);
        case "passados":
          return quando < agora;
        default:
          return true;
      }
    });
  }

  function desenharLista() {
    limpar(lista);
    const eventos = filtrados({ comPeriodo: true });

    if (eventos.length === 0) {
      lista.append(
        eventosCarregados.length === 0
          ? vazio("Nada cadastrado", "Sem programação, o agente não tem o que contar da casa.")
          : vazio("Nada neste recorte", "Nenhum item bate com o tipo e o período escolhidos."),
      );
      return;
    }

    const { solos, series } = agruparPorSerie(eventos);
    for (const ev of solos) lista.append(cartaoSolo(ev));
    for (const ocorrencias of series.values()) lista.append(cartaoSerie(ocorrencias));
  }

  /**
   * O mês inteiro numa grade.
   *
   * É a visão que responde "que dia está vazio?" — pergunta que a lista não
   * responde, porque nela um buraco na agenda é a ausência de uma linha, e
   * ninguém enxerga o que não está escrito.
   *
   * A grade começa no domingo da semana do dia 1 e vai até completar a última
   * semana, para os dias do mês vizinho aparecerem apagados no lugar certo em
   * vez de a primeira semana começar torta.
   */
  function desenharCalendario() {
    limpar(calendario);
    tituloMes.textContent = mesVisivel
      .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      .replace(/^./, (c) => c.toUpperCase());

    // Um balde por dia, para a montagem da grade ser uma consulta e não uma
    // varredura por célula.
    const porDia = new Map();
    for (const ev of filtrados({ comPeriodo: false })) {
      // O dia do evento no relógio da casa. `chaveDoDia` serve para as
      // células, que são datas civis montadas por componente; para um
      // INSTANTE, agrupar pelo fuso do navegador jogaria o show de sábado às
      // 22h na casinha de domingo.
      const chave = diaNaCasa(ev.starts_at);
      if (!porDia.has(chave)) porDia.set(chave, []);
      porDia.get(chave).push(ev);
    }
    for (const doDia of porDia.values()) {
      doDia.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    }

    const primeiro = new Date(mesVisivel);
    const inicioGrade = new Date(primeiro);
    inicioGrade.setDate(1 - primeiro.getDay());

    // Semanas INTEIRAS que cobrem o mês: 5 na maioria, 6 quando o mês começa
    // tarde na semana (agosto/2026 e maio/2027 são assim). Cortar por número
    // fixo de células deixaria a última linha pela metade, com a grade
    // desalinhada justamente nos meses mais compridos.
    const diasNoMes = new Date(mesVisivel.getFullYear(), mesVisivel.getMonth() + 1, 0).getDate();
    const totalCelulas = Math.ceil((primeiro.getDay() + diasNoMes) / 7) * 7;

    const celulas = [];
    const hoje = chaveDoDia(new Date());
    for (let i = 0; i < totalCelulas; i++) {
      const dia = new Date(inicioGrade);
      dia.setDate(inicioGrade.getDate() + i);

      const chave = chaveDoDia(dia);
      const doMes = dia.getMonth() === mesVisivel.getMonth();
      const doDia = porDia.get(chave) ?? [];

      celulas.push(
        el("div", { classe: `dia-cal ${doMes ? "" : "dia-fora"} ${chave === hoje ? "dia-hoje" : ""}`.trim() }, [
          el("span", { classe: "dia-numero", texto: String(dia.getDate()) }),
          ...doDia.map((ev) =>
            el("span", {
              classe: `item-cal item-${ev.kind}`,
              // O detalhe completo no title: a célula é estreita e cortar o
              // nome da atração é o mesmo que não mostrar.
              title: `${horaNaCasa(ev.starts_at)} — ${ev.title}${ev.description ? `\n${ev.description}` : ""}`,
              texto: `${horaNaCasa(ev.starts_at)} ${ev.title}`,
            }),
          ),
        ]),
      );
    }

    calendario.append(
      el("div", { classe: "grade-cal" }, [
        ...["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) =>
          el("span", { classe: "cabecalho-cal", texto: d }),
        ),
        ...celulas,
      ]),
      el("p", { classe: "muted", texto: "Cada faixa é um item da agenda. Passe o mouse para ver o detalhe; para editar ou excluir, use a Lista." }),
    );
  }

  // `function` e não `const`: `mesVisivel` é inicializado no topo da tela
  // chamando `inicioDoMes`, e uma seta declarada aqui embaixo só existe a
  // partir desta linha — a tela quebraria antes de desenhar.
  function inicioDoMes(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function somarMeses(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
  }
  /** Dia no fuso de quem olha — o mesmo critério que agrupa os eventos. */
  function chaveDoDia(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }


  function agruparPorSerie(eventos) {
    const solos = [];
    const series = new Map();
    for (const ev of eventos) {
      if (!ev.series_id) {
        solos.push(ev);
        continue;
      }
      if (!series.has(ev.series_id)) series.set(ev.series_id, []);
      series.get(ev.series_id).push(ev);
    }
    for (const ocorrencias of series.values()) ocorrencias.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    return { solos, series };
  }

  function cartaoSolo(ev) {
    const futuro = new Date(ev.starts_at) > new Date();
    return el("article", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", { style: "min-width:0" }, [
          el("h3", { texto: ev.title }),
          el("p", { classe: "muted", texto: ev.description ?? "" }),
        ]),
        etiqueta(rotuloTipo(ev.kind), futuro ? "etiqueta-ok" : ""),
      ]),
      linha("Quando", dataHora(ev.starts_at)),
      linha("Couvert", dinheiro(ev.cover_charge)),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-perigo btn-peq",
          type: "button",
          texto: "Remover",
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await del(`/v1/events/${ev.id}?venue=${encodeURIComponent(ctx.venue)}`);
              avisar("Item removido.", "ok");
              await carregarEventos();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      ]),
    ]);
  }

  function cartaoSerie(ocorrencias) {
    const agora = new Date();
    const primeira = ocorrencias[0];
    const futuras = ocorrencias.filter((o) => new Date(o.starts_at) > agora);
    const proxima = futuras[0];
    const ultima = ocorrencias[ocorrencias.length - 1];
    const regra = primeira.recurrence;
    const terminandoEmBreve =
      regra?.indefinite &&
      futuras.length > 0 &&
      (new Date(ultima.starts_at) - agora) / (1000 * 60 * 60 * 24) <= AVISO_RENOVACAO_DIAS;

    const botaoRemover = el("button", {
      classe: "btn btn-perigo btn-peq",
      type: "button",
      texto: "Remover próximas",
      onclick: async (e) => {
        if (!confirm(`Remover as ${futuras.length} ocorrências futuras de "${primeira.title}"? As já passadas ficam no histórico.`)) return;
        e.target.disabled = true;
        try {
          await del(`/v1/venues/${ctx.venue}/events/series/${primeira.series_id}`);
          avisar("Ocorrências futuras removidas.", "ok");
          await carregarEventos();
        } catch (err) {
          avisar(err.message, "erro");
          e.target.disabled = false;
        }
      },
    });

    const acoes = [botaoRemover];
    if (terminandoEmBreve) {
      acoes.unshift(
        el("button", {
          classe: "btn btn-primario btn-peq",
          type: "button",
          texto: "Renovar mais 12 semanas",
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await post(`/v1/venues/${ctx.venue}/events/series/${primeira.series_id}/renew`, {});
              avisar("Série renovada por mais ~12 semanas.", "ok");
              await carregarEventos();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      );
    }

    return el("article", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", { style: "min-width:0" }, [
          el("h3", { texto: primeira.title }),
          el("p", { classe: "muted", texto: primeira.description ?? "" }),
        ]),
        etiqueta(rotuloTipo(primeira.kind), futuras.length > 0 ? "etiqueta-ok" : ""),
      ]),
      linha("Repetição", resumoRecorrencia(regra)),
      linha("Próxima", proxima ? dataHora(proxima.starts_at) : "Nenhuma futura"),
      linha("Ocorrências futuras", String(futuras.length)),
      linha("Couvert", dinheiro(primeira.cover_charge)),
      terminandoEmBreve
        ? el("p", { classe: "muted", style: "color:var(--perigo)" }, [
            el("strong", { texto: "Essa série está acabando" }),
            el("span", { texto: ` — última ocorrência em ${dataHora(ultima.starts_at)}.` }),
          ])
        : null,
      el("div", { classe: "reserva-acoes" }, acoes),
    ]);
  }

  function resumoRecorrencia(regra) {
    if (!regra) return "—";
    const rotulos = Object.fromEntries(DIAS_SEMANA.map(([v, r]) => [v, r]));
    const quando =
      regra.freq === "daily" ? "Todo dia" : `Toda ${(regra.days ?? []).map((d) => rotulos[d] ?? d).join(", ")}`;
    return regra.indefinite ? `${quando} — sem data final` : `${quando} — até ${dataCurta(regra.until)}`;
  }

  function dataCurta(iso) {
    const [ano, mes, dia] = iso.split("-");
    return `${dia}/${mes}/${ano}`;
  }

  async function criar(e) {
    e.preventDefault();
    const botao = form.querySelector("button[type=submit]");

    let recorrencia;
    if (repeticao.value !== "none") {
      const dias = checksDias.filter((c) => c.caixa.checked).map((c) => c.valor);
      if (repeticao.value === "weekly" && dias.length === 0) {
        avisar("Selecione ao menos um dia da semana.", "erro");
        return;
      }
      recorrencia = {
        freq: repeticao.value,
        days: repeticao.value === "weekly" ? dias : undefined,
        // meio-dia local evita virar o dia ao converter pra UTC perto da meia-noite
        until: temDataFinal.checked && campoAte.value ? new Date(`${campoAte.value}T12:00:00`).toISOString() : undefined,
      };
    }

    botao.disabled = true;
    try {
      await post(`/v1/venues/${ctx.venue}/events`, {
        title: campos.titulo.value.trim(),
        kind: campos.tipo.value,
        // datetime-local não tem fuso; o navegador interpreta como hora local,
        // que é justamente a hora da casa.
        starts_at: new Date(campos.data.value).toISOString(),
        description: campos.descricao.value.trim() || undefined,
        cover_charge: campos.couvert.value ? Number(campos.couvert.value) : undefined,
        recorrencia,
      });
      avisar(recorrencia ? "Série adicionada à programação." : "Adicionado à programação.", "ok");
      form.reset();
      repeticao.dispatchEvent(new Event("change"));
      await carregarEventos();
    } catch (err) {
      avisar(err.message, "erro");
    } finally {
      botao.disabled = false;
    }
  }

  function campo(rotulo, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
  }

  function linha(rotulo, valor) {
    return el("div", { classe: "linha-dado" }, [
      el("span", { texto: rotulo }),
      el("strong", { texto: String(valor) }),
    ]);
  }

  function rotuloTipo(k) {
    return TIPOS.find(([v]) => v === k)?.[1] ?? k;
  }
}
