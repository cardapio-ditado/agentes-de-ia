import { get, post } from "../api.js";
import { ICONES, avisar, botaoVoltar, comIcone, dataHora, el, esqueleto, estadoDeErro, etiqueta, faixaDeAviso, hojeNaCasa, horaNaCasa, limpar, navegadorDePeriodo, plural, vazio } from "../ui.js";
import { botaoDePdf, imprimirRelatorio } from "../relatorio.js";

const STATUS = {
  pendente: ["Aguardando", ""],
  em_andamento: ["Em andamento", "etiqueta-alerta"],
  concluida: ["Concluída", "etiqueta-ok"],
};

/** A cor de cada dia, e como ela se diz em palavras. */
const SITUACAO = {
  feito: { rotulo: "Feito", curto: "feito" },
  com_problema: { rotulo: "Feito com problema", curto: "com problema" },
  nao_feito: { rotulo: "Não feito", curto: "não feito" },
  nao_saiu: { rotulo: "Link não saiu", curto: "link não saiu" },
  aguardando: { rotulo: "Em aberto", curto: "em aberto" },
  folga: { rotulo: "Fora da agenda", curto: "fora da agenda" },
};

const PERIODOS = [
  { id: "7", rotulo: "7 dias" },
  { id: "30", rotulo: "30 dias" },
  { id: "mes", rotulo: "Este mês" },
  { id: "mes-passado", rotulo: "Mês passado" },
];

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function somarDias(data, dias) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function ultimoDiaDoMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

function somarMeses(mes, n) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** O período escolhido em datas, no dia da casa. */
function datasDoPeriodo(periodo, hoje) {
  if (periodo === "7") return { de: somarDias(hoje, -6), ate: hoje };
  if (periodo === "mes") return { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
  if (periodo === "mes-passado") {
    const mes = somarMeses(hoje.slice(0, 7), -1);
    return { de: `${mes}-01`, ate: ultimoDiaDoMes(mes) };
  }
  return { de: somarDias(hoje, -29), ate: hoje };
}

/** "hoje", "ontem", "ter 24/11". */
function diaFalado(data, hoje) {
  if (data === hoje) return "hoje";
  if (data === somarDias(hoje, -1)) return "ontem";
  const d = new Date(`${data}T12:00:00Z`);
  return `${DIAS_CURTOS[d.getUTCDay()]} ${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

function primeiroNome(nome) {
  return String(nome ?? "").split(/\s+/)[0] ?? "";
}

/** O filtro escolhido fica para a próxima visita — mas sem armazenamento, segue a tela. */
const CHAVE_FILTRO = "brasa.checklists.filtro";
function lerFiltro() {
  try {
    const f = JSON.parse(localStorage.getItem(CHAVE_FILTRO) ?? "{}");
    return { periodo: PERIODOS.some((p) => p.id === f.periodo) ? f.periodo : "30", executor: "", situacao: "" };
  } catch {
    return { periodo: "30", executor: "", situacao: "" };
  }
}
function guardarFiltro(filtro) {
  try {
    localStorage.setItem(CHAVE_FILTRO, JSON.stringify({ periodo: filtro.periodo }));
  } catch {
    /* sem armazenamento: o filtro vale só nesta visita */
  }
}

/**
 * Checklists: um cartão por checklist, em vez de uma linha por dia.
 *
 * A pergunta do dono é "o banheiro está sendo limpo?" — e a resposta está
 * nos dias de UM checklist juntos: a faixa das duas últimas semanas, quanto
 * foi cumprido, quem fez por último e o que se repete. Em cima, o que é para
 * hoje; clicando no cartão, o mês inteiro num calendário; clicando no dia, a
 * execução com cada resposta e cada foto.
 */
export async function execucoes(raiz, ctx) {
  const lista = el("div", { classe: "pilha" });
  const historico = el("div", { classe: "pilha" });
  const detalhe = el("div", {});
  let runs = [];
  let painel = null;
  const filtro = lerFiltro();

  function mostrar(qual) {
    lista.hidden = qual !== lista;
    historico.hidden = qual !== historico;
    detalhe.hidden = qual !== detalhe;
    scrollTo({ top: 0 });
  }

  /** O PDF da semana continua lendo as execuções — só quando pedido. */
  async function pdfDaSemana() {
    try {
      runs = await get(`/v1/venues/${ctx.venue}/checklist-runs`);
    } catch (e) {
      avisar(e.message, "erro");
      return;
    }
    relatorioDaSemana();
  }

  /** "Mandar de novo": o mesmo link vai outra vez para quem faz. */
  async function mandarDeNovo(checklist, botao) {
    botao.disabled = true;
    const texto = botao.textContent;
    botao.textContent = "Mandando…";
    try {
      await post(`/v1/checklists/${checklist.id}/disparar?venue=${encodeURIComponent(ctx.venue)}`, { reenviar: true });
      avisar(`O link de "${checklist.nome}" foi para o WhatsApp de quem faz.`, "ok");
      botao.textContent = "Enviado";
    } catch (e) {
      avisar(e.message, "erro");
      botao.textContent = texto;
      botao.disabled = false;
    }
  }

  function botaoMandarDeNovo(checklist, rotulo = "Mandar de novo") {
    const b = el("button", { classe: "btn btn-peq", type: "button", texto: rotulo });
    b.onclick = (ev) => {
      ev.stopPropagation();
      void mandarDeNovo(checklist, b);
    };
    return b;
  }

  /**
   * A semana dos checklists no papel: o que saiu, quem fez, o que ficou
   * pendente e os alertas da IA. É a folha da reunião de segunda.
   */
  function relatorioDaSemana() {
    const corte = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const daSemana = runs.filter((r) => String(r.scheduled_for).slice(0, 10) >= corte);
    const feitos = daSemana.filter((r) => r.status === "concluida").length;
    const comAlerta = daSemana.filter((r) => Array.isArray(r.alertas_ia) && r.alertas_ia.length);
    imprimirRelatorio({
      tipo: "Checklist",
      titulo: "Checklists da semana",
      periodo: `${dataCurta(corte)} a ${new Date().toLocaleDateString("pt-BR")}`,
      selos: [
        { valor: String(daSemana.length), rotulo: "disparados" },
        { valor: String(feitos), rotulo: "concluídos" },
        { valor: String(daSemana.length - feitos), rotulo: "não terminados", ruim: daSemana.length - feitos > 0 },
        { valor: String(comAlerta.length), rotulo: "com alerta da IA", ruim: comAlerta.length > 0 },
      ],
      secoes: [
        {
          titulo: "Cada checklist",
          colunas: [{ rotulo: "Dia" }, { rotulo: "Checklist" }, { rotulo: "Quem fez" }, { rotulo: "Situação" }, { rotulo: "Alertas", num: true }],
          linhas: daSemana.map((r) => ({
            destaque: r.status !== "concluida" || (r.rodadas_previstas && r.rodadas_feitas < r.rodadas_previstas),
            celulas: [
              dataCurta(r.scheduled_for),
              r.checklist_nome,
              r.executor_nome ?? "—",
              (STATUS[r.status]?.[0] ?? r.status) + (r.rodadas_previstas ? ` · ${r.rodadas_feitas} de ${r.rodadas_previstas} rodadas` : ""),
              String(Array.isArray(r.alertas_ia) ? r.alertas_ia.length : 0),
            ],
          })),
          vazio: "Nenhum checklist nos últimos 7 dias.",
        },
        comAlerta.length
          ? {
              titulo: "O que a IA apontou",
              colunas: [{ rotulo: "Dia" }, { rotulo: "Checklist" }, { rotulo: "Alerta" }],
              linhas: comAlerta.flatMap((r) => r.alertas_ia.map((a) => [dataCurta(r.scheduled_for), r.checklist_nome, String(a)])),
            }
          : null,
      ],
      assinaturas: ["Gerente"],
      arquivo: `checklists-semana-${corte}`,
    });
  }

  /** Uma execução, pergunta por pergunta — o comprovante de que foi feito. */
  function relatorioDaExecucao(r, itens, respostas, alertas) {
    const valorDe = (item, resposta) =>
      item.tipo === "foto"
        ? resposta?.foto_url ? "foto enviada" : "sem foto"
        : item.tipo === "sim_nao"
          ? resposta?.valor === "sim" ? "Sim" : resposta?.valor === "nao" ? "Não" : "sem resposta"
          : resposta?.valor ?? "—";
    const tabelaDe = (titulo, mapa) => ({
      titulo,
      colunas: [{ rotulo: "Pergunta" }, { rotulo: "Resposta" }, { rotulo: "Observação" }],
      linhas: itens.map((item) => ({
        destaque: item.tipo === "sim_nao" && mapa.get(item.id)?.valor === "nao",
        celulas: [item.pergunta, valorDe(item, mapa.get(item.id)), mapa.get(item.id)?.observacao ?? ""],
      })),
    });
    const rodadas = Array.isArray(r.rodadas) ? r.rodadas : [];
    imprimirRelatorio({
      tipo: "Checklist",
      titulo: r.checklist?.name ?? "Checklist",
      periodo: [dataCurta(r.scheduled_for), r.executor_nome ? `por ${r.executor_nome}` : null, r.completed_at ? `concluído ${dataHora(r.completed_at)}` : null].filter(Boolean).join(" · "),
      secoes: [
        r.resumo_ia || alertas.length
          ? { titulo: "O que a IA achou", paragrafos: [r.resumo_ia, ...alertas.map((a) => `Atenção: ${a}`)].filter(Boolean) }
          : null,
        ...(rodadas.length
          ? rodadas.map((rod) =>
              rod.concluida_em
                ? tabelaDe(`Rodada ${rod.numero} · ${rod.prevista} — feita ${new Date(rod.concluida_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${rod.executor_nome ? ` por ${rod.executor_nome}` : ""}`, new Map((rod.respostas ?? []).map((a) => [a.item, a])))
                : { titulo: `Rodada ${rod.numero} · ${rod.prevista}`, paragrafos: ["Ninguém fez esta rodada."] })
          : [tabelaDe("Respostas", respostas)]),
      ],
      assinaturas: ["Quem fez", "Gerente"],
      arquivo: `checklist-${r.checklist?.name ?? ""}-${String(r.scheduled_for).slice(0, 10)}`,
    });
  }

  raiz.append(el("div", { classe: "pilha" }, [lista, historico, detalhe]));

  await carregar();

  async function carregar() {
    mostrar(lista);
    limpar(lista).append(esqueleto({ cartoes: 3, linhas: 4 }));
    const { de, ate } = datasDoPeriodo(filtro.periodo, hojeNaCasa());
    try {
      painel = await get(`/v1/venues/${ctx.venue}/checklists-painel?de=${de}&ate=${ate}`);
    } catch (e) {
      ctx.definirAcoes?.();
      limpar(lista).append(estadoDeErro("Não deu para carregar os checklists", e.message, carregar));
      return;
    }
    desenharLista();
  }

  // ============================================================
  // A lista: hoje, os que ninguém faz, e um cartão por checklist
  // ============================================================

  function desenharLista() {
    mostrar(lista);
    ctx.definirAcoes?.(
      botaoDePdf(pdfDaSemana, "Semana em PDF"),
      el("button", { classe: "btn", type: "button", onclick: carregar }, comIcone(ICONES.atualizar, "Atualizar")),
    );
    limpar(lista);

    if (!painel || painel.checklists.length === 0) {
      lista.append(
        vazio(
          "Nenhum checklist ainda",
          'Crie um modelo em "Modelos de checklist" e clique em "Disparar agora" para testar.',
          el("a", { classe: "btn btn-primario", href: "#checklists", texto: "Ver os modelos" }),
        ),
      );
      return;
    }

    lista.append(barraDeFiltros(), blocoDeHoje());

    // O que ninguém faz vem antes de tudo: é o que o dono precisa resolver.
    for (const c of painel.checklists.filter((x) => x.nunca_feito)) {
      const n = c.nunca_feito;
      lista.append(
        faixaDeAviso({
          tom: "perigo",
          titulo: `${c.nome}: ninguém terminou nenhuma vez no período`,
          detalhe: `O link saiu ${plural(n.links, "vez", "vezes")}${n.abertos ? ` e foi aberto ${plural(n.abertos, "vez", "vezes")}` : " e nunca foi aberto"}. Vale conversar com ${c.responsavel || "quem faz"} ou conferir o WhatsApp cadastrado.`,
          acao: botaoMandarDeNovo(c),
        }),
      );
    }

    const visiveis = painel.checklists.filter(passaNoFiltro);
    lista.append(legenda());
    if (visiveis.length === 0) {
      lista.append(
        vazio(
          "Nenhum checklist com esse filtro",
          "Tente outro período, outra pessoa ou outra situação.",
          el("button", { classe: "btn", type: "button", texto: "Limpar filtros", onclick: () => { filtro.executor = ""; filtro.situacao = ""; desenharLista(); } }),
        ),
      );
      return;
    }
    lista.append(el("div", { classe: "chk-grade" }, visiveis.map(cartaoDoChecklist)));
  }

  function passaNoFiltro(c) {
    if (filtro.executor && !(c.por_executor[filtro.executor] > 0)) return false;
    if (filtro.situacao) {
      const n = filtro.situacao === "nao_feito" ? c.contagem.nao_feito + c.contagem.nao_saiu : c.contagem[filtro.situacao];
      if (!(n > 0)) return false;
    }
    return true;
  }

  function barraDeFiltros() {
    const botoes = PERIODOS.map((p) =>
      el("button", {
        classe: "fila-botao",
        type: "button",
        "aria-pressed": String(filtro.periodo === p.id),
        texto: p.rotulo,
        onclick: () => {
          if (filtro.periodo === p.id) return;
          filtro.periodo = p.id;
          guardarFiltro(filtro);
          void carregar();
        },
      }),
    );
    const quem = el("select", { classe: "select", "aria-label": "Quem fez" }, [
      el("option", { value: "", texto: "Qualquer pessoa" }),
      ...painel.executores.map((n) => el("option", { value: n, texto: n })),
    ]);
    quem.value = painel.executores.includes(filtro.executor) ? filtro.executor : "";
    quem.onchange = () => {
      filtro.executor = quem.value;
      desenharLista();
    };
    const situacao = el("select", { classe: "select", "aria-label": "Situação" }, [
      el("option", { value: "", texto: "Qualquer situação" }),
      el("option", { value: "feito", texto: "Com dias feitos" }),
      el("option", { value: "com_problema", texto: "Com problema" }),
      el("option", { value: "nao_feito", texto: "Com dias não feitos" }),
    ]);
    situacao.value = filtro.situacao;
    situacao.onchange = () => {
      filtro.situacao = situacao.value;
      desenharLista();
    };
    const [a1, m1, d1] = painel.de.split("-");
    const [a2, m2, d2] = painel.ate.split("-");
    return el("div", { classe: "chk-filtros" }, [
      el("div", { classe: "inbox-filas", role: "group", "aria-label": "Período" }, botoes),
      el("div", { classe: "chk-filtros-selects" }, [quem, situacao]),
      el("p", { classe: "muted chk-filtros-periodo", texto: `De ${d1}/${m1}${a1 !== a2 ? `/${a1}` : ""} a ${d2}/${m2}/${a2}` }),
    ]);
  }

  /** O que é para hoje, na ordem do relógio. */
  function blocoDeHoje() {
    const deHoje = painel.checklists
      .filter((c) => c.hoje)
      .sort((a, b) => a.hoje.hora.localeCompare(b.hoje.hora));
    const linhas = deHoje.map((c) => {
      const h = c.hoje;
      let texto;
      let tom = h.situacao;
      let acao = null;
      if (h.situacao === "feito" || h.situacao === "com_problema") {
        texto = `Feito${h.concluido_em ? ` às ${horaNaCasa(h.concluido_em)}` : ""}${h.executor ? ` por ${h.executor}` : ""}${h.situacao === "com_problema" ? " · com ponto de atenção" : ""}`;
      } else if (h.rodadas) {
        texto = `${h.rodadas.feitas} de ${h.rodadas.previstas} rodadas feitas${h.rodadas.puladas ? ` · ${plural(h.rodadas.puladas, "pulada", "puladas")}` : ""}`;
        if (h.rodadas.puladas) tom = "com_problema";
        if (h.situacao === "nao_feito") texto = "Nenhuma rodada feita";
        if (h.situacao === "aguardando" && h.run_id) acao = botaoMandarDeNovo(c, "Lembrar");
      } else if (h.situacao === "nao_feito") {
        texto = "Não foi feito";
      } else if (!h.run_id && painel.agora < h.hora) {
        texto = `O link sai às ${h.hora}`;
        tom = "folga";
      } else if (!h.run_id) {
        texto = `O link de hoje não saiu (era às ${h.hora})`;
        tom = "nao_saiu";
        acao = botaoMandarDeNovo(c, "Mandar agora");
      } else if (h.atrasado) {
        texto = `Atrasado: o link saiu às ${h.hora} e ninguém terminou`;
        tom = "nao_feito";
        acao = botaoMandarDeNovo(c);
      } else {
        texto = `Link enviado às ${h.hora} · ainda aberto`;
        acao = botaoMandarDeNovo(c, "Lembrar");
      }
      return el("li", { classe: "chk-hoje-linha" }, [
        el("span", { classe: `chk-ponto chk-${tom}`, "aria-hidden": "true" }),
        el("div", { classe: "chk-hoje-texto" }, [
          h.run_id
            ? el("button", { classe: "chk-link", type: "button", texto: c.nome, onclick: () => abrir(h.run_id, desenharLista) })
            : el("strong", { texto: c.nome }),
          el("span", { classe: "muted", texto: texto }),
        ]),
        el("span", { classe: "chk-hoje-hora", texto: h.hora }),
        acao,
      ]);
    });
    const feitos = deHoje.filter((c) => c.hoje.situacao === "feito" || c.hoje.situacao === "com_problema").length;
    return el("section", { classe: "cartao chk-hoje", "aria-labelledby": "chk-hoje-titulo" }, [
      el("div", { classe: "chk-hoje-topo" }, [
        el("h2", { id: "chk-hoje-titulo", texto: "Hoje" }),
        deHoje.length ? el("span", { classe: "muted", texto: `${feitos} de ${deHoje.length} feitos` }) : null,
      ]),
      deHoje.length
        ? el("ul", { classe: "chk-hoje-lista" }, linhas)
        : el("p", { classe: "muted", style: "margin:0", texto: "Nenhum checklist na agenda de hoje." }),
    ]);
  }

  function legenda() {
    const item = (s) => el("li", {}, [el("span", { classe: `chk-quadro chk-${s}`, "aria-hidden": "true" }), el("span", { texto: SITUACAO[s].rotulo })]);
    return el("ul", { classe: "chk-legenda", "aria-label": "Legenda das cores" }, ["feito", "com_problema", "nao_feito", "aguardando", "folga"].map(item));
  }

  /** Um quadradinho de um dia — a cor, e a frase para quem não vê a cor. */
  function quadroDoDia(d) {
    const quem = d.executores.length ? ` por ${d.executores.join(", ")}` : "";
    const frase = `${diaFalado(d.data, painel.hoje)}: ${SITUACAO[d.situacao].curto}${quem}${d.motivo ? ` (${d.motivo})` : ""}`;
    const deOutro = filtro.executor && (d.situacao === "feito" || d.situacao === "com_problema") && !d.executores.includes(filtro.executor);
    return el("span", { classe: `chk-quadro chk-${d.situacao}${deOutro ? " chk-de-outro" : ""}`, title: frase });
  }

  function cartaoDoChecklist(c) {
    const pct = c.cumprimento.percentual;
    const tomPct = pct === null ? "" : pct >= 90 ? "chk-pct-ok" : pct >= 60 ? "chk-pct-alerta" : "chk-pct-perigo";
    const contagem14 = c.faixa.reduce((t, d) => ({ ...t, [d.situacao]: (t[d.situacao] ?? 0) + 1 }), {});
    const resumo14 = ["feito", "com_problema", "nao_feito", "nao_saiu"]
      .filter((s) => contagem14[s])
      .map((s) => `${contagem14[s]} ${SITUACAO[s].curto}`)
      .join(", ");

    const linhaFiltro = filtro.executor
      ? el("p", { classe: "chk-linha", texto: `Feito por ${filtro.executor}: ${plural(c.por_executor[filtro.executor] ?? 0, "dia", "dias")} no período` })
      : filtro.situacao
        ? el("p", {
            classe: "chk-linha",
            texto: `${plural(filtro.situacao === "nao_feito" ? c.contagem.nao_feito + c.contagem.nao_saiu : c.contagem[filtro.situacao], "dia", "dias")} ${SITUACAO[filtro.situacao].curto} no período`,
          })
        : null;

    const ultimo = c.ultimo_feito
      ? `Último feito: ${diaFalado(c.ultimo_feito.data, painel.hoje)}${c.ultimo_feito.executor ? `, por ${c.ultimo_feito.executor}` : ""}`
      : "Ainda não foi feito nenhuma vez";

    const abrirHistorico = () => abrirHistoricoDo(c, painel.hoje.slice(0, 7));
    const cartao = el("article", { classe: "cartao chk-cartao", "aria-labelledby": `chk-nome-${c.id}` }, [
      el("div", { classe: "chk-cartao-topo" }, [
        el("div", { classe: "chk-cartao-nome" }, [
          el("h3", { id: `chk-nome-${c.id}`, texto: c.nome }),
          el("p", { classe: "muted", texto: [c.agenda, c.responsavel || null, c.ativo ? null : "desativado"].filter(Boolean).join(" · ") }),
        ]),
        el("div", { classe: `chk-pct ${tomPct}` }, [
          el("strong", { texto: pct === null ? "—" : `${pct}%` }),
          el("span", { texto: c.cumprimento.devidos ? `${c.cumprimento.feitos} de ${plural(c.cumprimento.devidos, c.cumprimento.unidade === "rodadas" ? "rodada" : "dia", c.cumprimento.unidade)}` : "nenhum dia ainda" }),
        ]),
      ]),
      el("div", { classe: "chk-faixa-bloco" }, [
        el("div", { classe: "chk-faixa", role: "img", "aria-label": `Últimos 14 dias: ${resumo14 || "nada na agenda"}` }, c.faixa.map(quadroDoDia)),
        el("div", { classe: "chk-faixa-datas muted", "aria-hidden": "true" }, [el("span", { texto: diaFalado(c.faixa[0].data, painel.hoje) }), el("span", { texto: "hoje" })]),
      ]),
      linhaFiltro,
      el("p", { classe: "chk-linha", texto: ultimo }),
      c.repeticoes.length
        ? el("ul", { classe: "chk-repete", "aria-label": "O que se repete" }, c.repeticoes.map((r) => el("li", { texto: r })))
        : null,
      el("div", { classe: "chk-cartao-acoes" }, [
        el("button", { classe: "btn btn-peq", type: "button", onclick: abrirHistorico }, comIcone(ICONES.relogio, "Ver o mês")),
      ]),
    ]);
    return cartao;
  }

  // ============================================================
  // O histórico de um checklist: o mês num calendário
  // ============================================================

  async function abrirHistoricoDo(c, mes) {
    mostrar(historico);
    ctx.definirAcoes?.();
    limpar(historico).append(esqueleto({ linhas: 6 }));
    let dados;
    try {
      dados = await get(`/v1/venues/${ctx.venue}/checklists-painel?checklist=${encodeURIComponent(c.id)}&de=${mes}-01&ate=${ultimoDiaDoMes(mes)}`);
    } catch (e) {
      avisar(e.message, "erro");
      desenharLista();
      return;
    }
    const resumo = dados.checklists[0];
    if (!resumo) {
      avisar("Este checklist não foi encontrado.", "erro");
      desenharLista();
      return;
    }
    const mesAtual = dados.hoje.slice(0, 7);
    const [ano, m] = mes.split("-").map(Number);
    const pct = resumo.cumprimento.percentual;

    // O calendário começa no domingo, como o da parede.
    const porData = new Map(resumo.dias.map((d) => [d.data, d]));
    const primeiro = `${mes}-01`;
    const vazios = new Date(`${primeiro}T12:00:00Z`).getUTCDay();
    const celulas = [];
    for (let i = 0; i < vazios; i += 1) celulas.push(el("div", { classe: "chk-dia chk-dia-vazio", "aria-hidden": "true" }));
    for (let data = primeiro; data <= ultimoDiaDoMes(mes); data = somarDias(data, 1)) {
      const d = porData.get(data);
      const numero = el("span", { classe: "chk-dia-numero", texto: String(Number(data.slice(8))) });
      if (!d) {
        celulas.push(el("div", { classe: "chk-dia chk-dia-futuro" }, [numero]));
        continue;
      }
      const quem = d.executores.length ? primeiroNome(d.executores[0]) + (d.executores.length > 1 ? ` +${d.executores.length - 1}` : "") : "";
      const rotulo = `${Number(data.slice(8))} de ${MESES[m - 1]}: ${SITUACAO[d.situacao].curto}${d.executores.length ? ` por ${d.executores.join(", ")}` : ""}${d.motivo ? ` (${d.motivo})` : ""}`;
      const filhos = [numero, el("span", { classe: "chk-dia-texto", texto: d.situacao === "folga" ? "" : quem || SITUACAO[d.situacao].curto })];
      celulas.push(
        d.run_id
          ? el("button", { classe: `chk-dia chk-${d.situacao}${data === dados.hoje ? " chk-dia-hoje" : ""}`, type: "button", "aria-label": rotulo, title: rotulo, onclick: () => abrir(d.run_id, () => abrirHistoricoDo(c, mes)) }, filhos)
          : el("div", { classe: `chk-dia chk-${d.situacao}${data === dados.hoje ? " chk-dia-hoje" : ""}`, role: "img", "aria-label": rotulo, title: rotulo }, filhos),
      );
    }

    const ruins = resumo.dias.filter((d) => d.situacao === "com_problema" || d.situacao === "nao_feito" || d.situacao === "nao_saiu").reverse();
    const quemFez = Object.entries(resumo.por_executor).sort((a, b) => b[1] - a[1]);

    limpar(historico).append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [el("h2", { texto: resumo.nome }), el("p", { classe: "muted", style: "margin:2px 0 0", texto: [resumo.agenda, resumo.responsavel || null].filter(Boolean).join(" · ") })]),
        botaoVoltar(desenharLista, "Todos os checklists"),
      ]),
      navegadorDePeriodo({
        titulo: `${MESES[m - 1]} de ${ano}`,
        detalhe: pct === null ? "nada na agenda ainda" : `${pct}% cumprido · ${resumo.cumprimento.feitos} de ${plural(resumo.cumprimento.devidos, resumo.cumprimento.unidade === "rodadas" ? "rodada" : "dia", resumo.cumprimento.unidade)}`,
        aoVoltar: () => abrirHistoricoDo(c, somarMeses(mes, -1)),
        aoAvancar: () => (mes < mesAtual ? abrirHistoricoDo(c, somarMeses(mes, 1)) : avisar("Esse mês ainda não chegou.")),
        rotuloAtual: "Este mês",
        aoIrParaAtual: mes === mesAtual ? null : () => abrirHistoricoDo(c, mesAtual),
      }),
      el("div", { classe: "chk-historico" }, [
        el("section", { classe: "cartao chk-calendario-cartao", "aria-label": `Calendário de ${MESES[m - 1]}` }, [
          el("div", { classe: "chk-calendario" }, [
            ...DIAS_CURTOS.map((d) => el("span", { classe: "chk-semana muted", "aria-hidden": "true", texto: d })),
            ...celulas,
          ]),
          legenda(),
          el("p", { classe: "muted", style: "margin:0;font-size:13px", texto: "Toque num dia para ver cada resposta e cada foto." }),
        ]),
        el("div", { classe: "pilha" }, [
          el("section", { classe: "cartao pilha-fina" }, [
            el("h3", { texto: "Quem fez" }),
            quemFez.length
              ? el("ul", { classe: "chk-quem" }, quemFez.map(([nome, n]) => el("li", {}, [el("span", { texto: nome }), el("strong", { texto: plural(n, "dia", "dias") })])))
              : el("p", { classe: "muted", style: "margin:0", texto: "Ninguém terminou neste mês." }),
          ]),
          resumo.repeticoes.length
            ? el("section", { classe: "cartao pilha-fina" }, [el("h3", { texto: "O que se repete" }), el("ul", { classe: "chk-repete" }, resumo.repeticoes.map((r) => el("li", { texto: r })))])
            : null,
          el("section", { classe: "cartao pilha-fina" }, [
            el("h3", { texto: "Dias com problema" }),
            ruins.length
              ? el(
                  "ul",
                  { classe: "chk-ruins" },
                  ruins.map((d) =>
                    el("li", {}, [
                      el("span", { classe: `chk-ponto chk-${d.situacao}`, "aria-hidden": "true" }),
                      d.run_id
                        ? el("button", { classe: "chk-link", type: "button", texto: diaFalado(d.data, dados.hoje), onclick: () => abrir(d.run_id, () => abrirHistoricoDo(c, mes)) })
                        : el("strong", { texto: diaFalado(d.data, dados.hoje) }),
                      el("span", { classe: "muted", texto: d.motivo ?? SITUACAO[d.situacao].curto }),
                    ]),
                  ),
                )
              : el("p", { classe: "muted", style: "margin:0", texto: "Nenhum neste mês." }),
          ]),
        ]),
      ]),
    );
  }

  /** Uma execução, pergunta por pergunta. `voltar` é para onde o Voltar leva. */
  async function abrir(id, voltar = desenharLista) {
    ctx.definirAcoes?.();
    mostrar(detalhe);
    limpar(detalhe).append(esqueleto({ linhas: 5 }));
    let r;
    try {
      r = await get(`/v1/checklist-runs/${id}?venue=${encodeURIComponent(ctx.venue)}`);
    } catch (e) {
      avisar(e.message, "erro");
      voltar();
      return;
    }

    const itens = r.checklist?.items ?? [];
    const respostas = new Map((r.answers ?? []).map((a) => [a.item, a]));
    const alertas = Array.isArray(r.alertas_ia) ? r.alertas_ia : [];
    ctx.definirAcoes?.(botaoDePdf(() => relatorioDaExecucao(r, itens, respostas, alertas), "Checklist em PDF"));

    limpar(detalhe).append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: r.checklist?.name ?? "Checklist" }),
            el("p", { classe: "muted cel-etiquetas" }, [
              etiqueta(...(STATUS[r.status] ?? [r.status, ""])),
              el("span", {
                texto: [
                  dataCurta(r.scheduled_for),
                  r.executor_nome ? `por ${r.executor_nome}` : null,
                  r.completed_at ? `concluída em ${dataHora(r.completed_at)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
              }),
            ]),
          ]),
          botaoVoltar(voltar),
        ]),

        r.resumo_ia
          ? el("div", { classe: "cartao" }, [
              el("strong", { texto: "Resumo da IA" }),
              el("p", { classe: "muted", style: "margin:4px 0 0", texto: r.resumo_ia }),
            ])
          : null,

        alertas.length > 0
          ? el("div", { classe: "cartao alerta" }, [
              el("strong", { texto: "Pontos de atenção" }),
              el(
                "ul",
                { style: "margin:6px 0 0;padding-left:18px;line-height:1.7" },
                alertas.map((a) => el("li", { texto: String(a) })),
              ),
            ])
          : null,

        Array.isArray(r.rodadas) && r.rodadas.length > 0
          ? el("div", { classe: "pilha-fina" }, r.rodadas.map((rod) => blocoRodada(rod, itens)))
          : r.status === "concluida"
          ? el(
              "div",
              { classe: "pilha-fina" },
              itens.map((item) => blocoResposta(item, respostas.get(item.id))),
            )
          : el("p", {
              classe: "muted",
              texto:
                r.status === "em_andamento"
                  ? "O link foi aberto — aguardando a equipe concluir."
                  : "O link ainda não foi aberto.",
            }),
      ]),
    );
  }

  /**
   * Uma rodada da noite: quando era, quando foi feita, por quem — e as
   * respostas dobradas, porque onze rodadas abertas de uma vez é uma parede.
   * A pulada fica em vermelho: é ela que o gestor abriu para achar.
   */
  function blocoRodada(rod, itens) {
    const feita = Boolean(rod.concluida_em);
    const respostas = new Map((rod.respostas ?? []).map((a) => [a.item, a]));
    const cabecalho = el("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap" }, [
      el("strong", { texto: `Rodada ${rod.numero} · ${rod.prevista}` }),
      feita
        ? el("span", {
            classe: "muted",
            texto: `feita ${new Date(rod.concluida_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${rod.executor_nome ? ` por ${rod.executor_nome}` : ""}`,
          })
        : etiqueta("ninguém fez", "etiqueta-perigo"),
    ]);
    if (!feita) return el("div", { classe: "cartao linha-perigo", style: "padding:12px" }, [cabecalho]);

    const detalhes = el("details", {}, [
      el("summary", { classe: "muted", style: "cursor:pointer;margin-top:6px", texto: "ver respostas" }),
      el("div", { classe: "pilha", style: "gap:6px;margin-top:8px" }, itens.map((item) => blocoResposta(item, respostas.get(item.id)))),
    ]);
    return el("div", { classe: "cartao", style: "padding:12px" }, [cabecalho, detalhes]);
  }

  function blocoResposta(item, resposta) {
    let valor;
    if (item.tipo === "foto") {
      valor = resposta?.foto_url
        ? el("a", { href: resposta.foto_url, target: "_blank", rel: "noopener" }, [
            el("img", {
              src: resposta.foto_url,
              alt: item.pergunta,
              style: "max-width:220px;max-height:160px;border-radius:10px;display:block",
            }),
          ])
        : el("span", { classe: "muted", texto: "Sem foto" });
    } else if (item.tipo === "sim_nao") {
      const v = resposta?.valor;
      valor =
        v === "sim"
          ? etiqueta("Sim", "etiqueta-ok")
          : v === "nao"
            ? etiqueta("Não", "etiqueta-alerta")
            : el("span", { classe: "muted", texto: "Sem resposta" });
    } else {
      valor = el("span", { texto: resposta?.valor ?? "—" });
    }

    return el("div", { classe: "cartao", style: "padding:12px" }, [
      el("div", { style: "display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap" }, [
        el("span", { texto: item.pergunta, style: "font-weight:600" }),
        valor,
      ]),
      resposta?.observacao
        ? el("p", { classe: "muted", style: "margin:6px 0 0", texto: `Obs.: ${resposta.observacao}` })
        : null,
    ]);
  }

  function dataCurta(iso) {
    const [ano, mes, dia] = String(iso).split("-");
    return `${dia}/${mes}/${ano}`;
  }
}
