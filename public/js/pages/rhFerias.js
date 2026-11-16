import { del, get, post } from "../api.js";
import { ICONES, avisar, botaoVoltar, campoDeBusca, comIcone, comSigla, el, esqueleto, estadoDeErro, etiqueta, limpar, tabelaDeDados, vazio } from "../ui.js";

/**
 * RH — Fase 4: férias.
 *
 * A tela é um relógio, não um formulário. O que o dono precisa ver ao abrir é
 * quem está com o período perto de vencer — porque férias vencida vira
 * pagamento em dobro, e isso costuma aparecer tarde demais.
 *
 * São três olhares sobre o mesmo dado, e uma página por pessoa:
 *
 *   Pessoas — o time hoje, o calendário dos próximos meses e a lista.
 *   Prazos  — a casa inteira ordenada por quem vence primeiro.
 *   Alertas — o que precisa de decisão, em ordem de urgência.
 *
 * Clicar numa pessoa abre a história dela: a linha do tempo dos períodos, o
 * que tirou em cada um e o que falta.
 *
 * Nenhum valor em reais aqui: datas e dias. Terço, abono e recibo continuam
 * com a contabilidade.
 */

const NOME_DA_SITUACAO = {
  pedido: "Esperando decisão",
  aprovado: "Aprovado",
  recusado: "Recusado",
  cancelado: "Cancelado",
};

const NOME_DO_PERIODO = {
  em_curso: "acumulando",
  a_conceder: "pode conceder",
  a_vencer: "vence em breve",
  vencido: "vencido",
  gozado: "gozado",
};

/**
 * A situação REAL de um lançamento vem das DATAS; o campo gravado só diz se
 * alguém decidiu. Quem está de férias hoje está de férias, esteja o pedido
 * como estiver.
 */
const CORES = {
  em_gozo: { fundo: "var(--ferias-fora)", texto: "var(--ferias-texto)", nome: "de férias agora" },
  agendada: { fundo: "var(--ferias-agendada)", texto: "var(--ferias-texto)", nome: "agendadas" },
  gozada: { fundo: "var(--ferias-tirada)", texto: "var(--ferias-texto)", nome: "tiradas" },
  a_decidir: { fundo: "var(--ferias-vencida)", texto: "var(--ferias-texto)", nome: "terminou sem decisão" },
};

const URGENCIAS = [
  { ate: -1, cor: "var(--ferias-vencida)", rotulo: "passou do prazo" },
  { ate: 60, cor: "var(--ferias-perto)", rotulo: "vence em até 60 dias" },
  { ate: 120, cor: "var(--ferias-agendada)", rotulo: "vence em até 120 dias" },
  { ate: Infinity, cor: "var(--ferias-tirada)", rotulo: "com folga" },
];

const urgencia = (dias) => URGENCIAS.find((u) => dias <= u.ate);

/** Altura de cada pista de barra dentro de uma linha do gráfico de prazos. */
const ALTURA_DA_PISTA = 17;

export function criarFerias(corpo, ctx) {
  let dados = null;
  let aba = "pessoas";
  let pessoaAberta = null;
  let busca = "";
  let filtro = "todos";
  let lancando = false;

  return { desenhar, recarregar };

  async function recarregar() {
    if (!dados) limpar(corpo).append(esqueleto({ linhas: 6 }));
    try {
      dados = await get(`/v1/venues/${ctx.venue}/rh/ferias`);
    } catch (e) {
      ctx.definirAcoes?.();
      limpar(corpo).append(estadoDeErro("Não deu para carregar as férias", e.message, recarregar));
      return;
    }
    desenhar();
  }

  /* ================= Modelo de leitura ================= */

  /**
   * O que a tela precisa saber de cada pessoa, tudo calculado a partir dos
   * períodos que o servidor já mandou e dos lançamentos.
   */
  function lerPessoa(p) {
    const hoje = dados.hoje;
    const lancamentos = p.ferias.filter((f) => f.situacao === "aprovado" || f.situacao === "pedido");

    let emGozo = null;
    let proximaAgendada = null;
    let aDecidir = 0;
    let diasTirados = 0;
    let diasVendidos = 0;

    for (const f of lancamentos) {
      const sit = situacaoDoLancamento(f, hoje);
      if (sit === "em_gozo") emGozo = f;
      if (sit === "agendada" && (!proximaAgendada || f.inicio < proximaAgendada.inicio)) proximaAgendada = f;
      if (sit === "a_decidir") aDecidir += 1;
      if (f.situacao === "aprovado") {
        diasTirados += f.dias;
        diasVendidos += f.abono_dias || 0;
      }
    }

    let diasVencidos = 0;
    let diasATirar = 0;
    let proximoPrazo = null;
    let emCurso = null;
    for (const per of p.periodos) {
      if (per.situacao === "em_curso") { emCurso = per; continue; }
      if (per.situacao === "gozado" || per.dias_restantes <= 0) continue;
      if (per.situacao === "vencido") diasVencidos += per.dias_restantes;
      else {
        diasATirar += per.dias_restantes;
        if (!proximoPrazo || per.limite < proximoPrazo) proximoPrazo = per.limite;
      }
    }

    const fechados = p.periodos.filter((per) => per.situacao !== "em_curso").length;
    const pendencia = !p.admissao ? "sem_admissao"
      : diasVencidos > 0 ? "vencido"
        : diasATirar > 0 ? "a_tirar"
          : fechados > 0 ? "em_dia"
            // Admissão marcada para o futuro não gera período nenhum: dizer
            // "1º ano" ali faria parecer que o relógio já está correndo.
            : emCurso ? "primeiro_ano" : "sem_periodo";

    return {
      ...p,
      lancamentos,
      emGozo,
      proximaAgendada,
      aDecidir,
      diasTirados,
      diasVendidos,
      diasVencidos,
      diasATirar,
      proximoPrazo,
      emCurso,
      pendencia,
    };
  }

  // Declaração, não const: o `return` lá em cima sai da fábrica antes desta
  // linha, e um const aqui nunca chegaria a ser inicializado.
  function equipe() {
    return dados.pessoas.map(lerPessoa);
  }

  /** As frases curtas do cartão da pessoa: o que se precisa saber sem abrir. */
  function resumo(pes) {
    const partes = [];
    if (pes.emGozo) partes.push([`De férias até ${diaCurto(pes.emGozo.fim)}`, "etiqueta-info"]);
    else if (pes.proximaAgendada) partes.push([`Férias em ${diaCurto(pes.proximaAgendada.inicio)}`, "etiqueta-alerta"]);

    if (pes.pendencia === "vencido") partes.push([`${nDias(pes.diasVencidos)} ${pes.diasVencidos === 1 ? "vencido" : "vencidos"}`, "etiqueta-perigo"]);
    else if (pes.pendencia === "a_tirar") partes.push([`${nDias(pes.diasATirar)} até ${diaCurto(pes.proximoPrazo)}`, "etiqueta-alerta"]);
    else if (pes.pendencia === "em_dia") partes.push(["Em dia", "etiqueta-ok"]);
    else if (pes.pendencia === "primeiro_ano") partes.push([`1º ano fecha em ${diaCurto(pes.emCurso.fim)}`, ""]);
    else if (pes.pendencia === "sem_periodo") partes.push([`Entra em ${diaCurto(pes.admissao)}`, ""]);
    else partes.push(["Sem data de admissão", "etiqueta-alerta"]);

    if (pes.aDecidir > 0) partes.push([`${pes.aDecidir} a decidir`, "etiqueta-perigo"]);
    return partes;
  }

  /* ================= Desenho ================= */

  function desenhar() {
    if (!dados) {
      void recarregar();
      return;
    }
    // Uma pilha só: o espaço entre os blocos vem dela.
    const pilha = el("div", { classe: "pilha" });
    limpar(corpo).append(pilha);
    const time = equipe();

    if (pessoaAberta) {
      const pes = time.find((p) => p.atendente_id === pessoaAberta);
      if (pes) {
        ctx.definirAcoes?.();
        pilha.append(paginaDaPessoa(pes));
        return;
      }
      pessoaAberta = null;
    }

    pilha.append(cabecalho(time));
    if (lancando) pilha.append(cartaoDeLancamento(time, null));

    if (time.length === 0) {
      pilha.append(vazio("Ninguém na equipe ainda", 'Cadastre a equipe na aba "Equipe" para acompanhar as férias.'));
      return;
    }

    if (aba === "prazos") pilha.append(prazosDaCasa(time));
    else if (aba === "alertas") pilha.append(alertas(time));
    else pilha.append(panoramaDoTime(time), filtrosDaLista(), listaDePessoas(time));
  }

  function cabecalho(time) {
    const vencidos = time.filter((p) => p.pendencia === "vencido").length;
    const decidir = time.reduce((s, p) => s + p.aDecidir, 0);

    // Lançar férias é a ação da aba: vai para o cabeçalho da página.
    ctx.definirAcoes?.(
      el(
        "button",
        { classe: "btn btn-primario", type: "button", "aria-expanded": String(lancando), onclick: () => { lancando = !lancando; desenhar(); } },
        lancando ? [document.createTextNode("Fechar")] : comIcone(ICONES.mais, "Lançar férias"),
      ),
    );

    const OLHARES = [
      ["pessoas", "Pessoas"],
      ["prazos", "Prazos"],
      ["alertas", "Alertas"],
    ];
    return el("div", { classe: "barra-periodo" }, [
      // Três olhares sobre o mesmo dado: chaves lado a lado, e não outra
      // fileira de abas debaixo das abas do RH.
      el("div", { classe: "seletor-de-visao", role: "group", "aria-label": "Como ver as férias" },
        OLHARES.map(([id, rotulo]) =>
          el("button", {
            type: "button",
            "aria-pressed": String(aba === id),
            texto: rotulo,
            onclick: () => { aba = id; desenhar(); },
          }),
        ),
      ),
      el("div", { classe: "cel-etiquetas" }, [
        vencidos ? etiqueta(`${vencidos} com férias vencidas`, "etiqueta-perigo") : null,
        decidir ? etiqueta(`${decidir} a decidir`, "etiqueta-alerta") : null,
        !vencidos && !decidir ? etiqueta("ninguém com férias vencidas", "etiqueta-ok") : null,
      ]),
    ]);
  }

  /* ================= Pessoas: o panorama ================= */

  /**
   * O time numa barra só, em vez de quatro quadrados com números: cada cor é
   * uma situação, o tamanho é quanta gente está nela, e clicar filtra a lista.
   */
  function panoramaDoTime(time) {
    const segmentos = [
      { chave: "em_ferias", rotulo: "de férias agora", cor: CORES.em_gozo.fundo, texto: CORES.em_gozo.texto, valor: time.filter((p) => p.emGozo).length },
      { chave: "vencido", rotulo: "com férias vencidas", cor: "var(--ferias-vencida)", texto: "var(--ferias-texto)", valor: time.filter((p) => p.pendencia === "vencido" && !p.emGozo).length },
      { chave: "a_tirar", rotulo: "com dias a tirar", cor: "var(--ferias-agendada)", texto: "var(--ferias-texto)", valor: time.filter((p) => p.pendencia === "a_tirar" && !p.emGozo).length },
      { chave: "em_dia", rotulo: "em dia", cor: "var(--ferias-tirada)", texto: "var(--ferias-texto)", valor: time.filter((p) => (["em_dia", "primeiro_ano", "sem_periodo"].includes(p.pendencia)) && !p.emGozo).length },
    ];
    const total = segmentos.reduce((s, x) => s + x.valor, 0) || 1;

    return el("section", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("h3", { texto: "O time hoje" }),
        el("span", { classe: "muted", texto: `${total} ${total === 1 ? "pessoa" : "pessoas"} · clique numa cor para filtrar` }),
      ]),
      el("div", { classe: "ferias-barra-time" },
        segmentos.filter((s) => s.valor > 0).map((s) =>
          el("button", {
            type: "button",
            texto: String(s.valor),
            title: `${s.valor} ${s.rotulo}`,
            "aria-pressed": filtro === s.chave,
            style: `width:${(s.valor / total) * 100}%;background:${s.cor};color:${s.texto};opacity:${filtro !== "todos" && filtro !== s.chave ? 0.35 : 1}`,
            onclick: () => { filtro = filtro === s.chave ? "todos" : s.chave; desenhar(); },
          }),
        ),
      ),
      el("div", { classe: "ferias-legenda" },
        segmentos.map((s) =>
          el("button", {
            type: "button",
            onclick: () => { filtro = filtro === s.chave ? "todos" : s.chave; desenhar(); },
          }, [
            el("span", { classe: "ferias-cor", style: `background:${s.cor}` }),
            el("strong", { texto: String(s.valor) }),
            el("span", { texto: s.rotulo }),
          ]),
        ),
      ),
      calendarioDoTime(time),
    ]);
  }

  /** Quem está fora, quando e por quanto tempo — do mês passado a dez à frente. */
  function calendarioDoTime(time) {
    const janela = faixaDeMeses(dados.hoje, -1, 12);
    const linhas = time
      .map((pes) => ({
        pes,
        barras: pes.lancamentos.filter((f) => f.fim >= janela.de && f.inicio <= janela.ate),
      }))
      .filter((l) => l.barras.length > 0)
      .sort((a, b) => a.barras[0].inicio.localeCompare(b.barras[0].inicio));

    if (linhas.length === 0) {
      return el("div", {}, [
        el("h4", { texto: "Calendário de férias", style: "margin:20px 0 4px" }),
        el("p", { classe: "muted", texto: 'Nenhuma férias lançada nesta janela. Marque as próximas em "Lançar férias".' }),
      ]);
    }

    return el("div", {}, [
      el("h4", { texto: "Calendário de férias", style: "margin:20px 0 2px" }),
      el("p", { classe: "muted", texto: "Do mês passado aos próximos dez meses. Cada barra é um período; a linha laranja é hoje." }),
      el("div", { classe: "rolagem-x" }, [
        el("div", { classe: "ferias-gantt", style: "margin-top:10px" }, [
          cabecalhoDeMeses(janela, 132),
          el("div", { style: "position:relative" }, [
            el("div", { classe: "ferias-hoje", style: `left:calc(132px + (100% - 132px) * ${janela.pct(dados.hoje) / 100})` }),
            ...linhas.map(({ pes, barras }) =>
              el("div", { classe: "ferias-gantt-linha" }, [
                el("button", {
                  classe: "ferias-gantt-nome",
                  type: "button",
                  style: "width:132px",
                  texto: primeiroENome(pes.nome),
                  title: pes.nome,
                  onclick: () => abrir(pes.atendente_id),
                }),
                el("div", { classe: "ferias-trilho" }, [
                  grade(janela),
                  ...barras.map((f) => {
                    const cor = CORES[situacaoDoLancamento(f, dados.hoje)];
                    const esq = janela.pct(f.inicio);
                    const larg = Math.max(0.9, janela.pct(somarDias(f.fim, 1)) - esq);
                    return el("div", {
                      classe: "ferias-bloco",
                      style: `left:${esq}%;width:${larg}%;background:${cor.fundo};color:${cor.texto}`,
                      title: `${diaBr(f.inicio)} a ${diaBr(f.fim)} · ${nDias(f.dias)} · ${cor.nome}`,
                      texto: larg > 7 ? `${f.dias}d` : "",
                    });
                  }),
                ]),
              ]),
            ),
          ]),
        ]),
      ]),
      legendaDeCores(["gozada", "em_gozo", "agendada", "a_decidir"]),
    ]);
  }

  /* ================= Pessoas: a lista ================= */

  function filtrosDaLista() {
    const escolha = el("select", {
      classe: "select",
      "aria-label": "Mostrar quem",
      onchange: (e) => { filtro = e.target.value; desenhar(); },
    }, [
      ["todos", "Todas as pessoas"],
      ["em_ferias", "De férias agora"],
      ["vencido", "Com férias vencidas"],
      ["a_tirar", "Com dias a tirar"],
      ["em_dia", "Em dia"],
    ].map(([v, t]) => el("option", { value: v, texto: t, selected: filtro === v })));

    return el("div", { classe: "barra-filtros" }, [
      campoDeBusca({
        rotulo: "Procurar pessoa pelo nome",
        placeholder: "Procurar pessoa…",
        valor: busca,
        aoMudar: (texto) => {
          busca = texto;
          // Redesenhar só a lista: refazer a tela toda tiraria o foco do campo.
          const antiga = corpo.querySelector(".ferias-lista");
          if (antiga) antiga.replaceWith(listaDePessoas(equipe()));
        },
      }),
      escolha,
    ]);
  }

  function listaDePessoas(time) {
    const alvo = busca.trim().toLowerCase();
    const peso = (p) => (p.emGozo ? 0 : p.pendencia === "vencido" ? 1 : p.pendencia === "a_tirar" ? 2 : p.pendencia === "em_dia" ? 3 : 4);
    const visiveis = time
      .filter((p) => !alvo || p.nome.toLowerCase().includes(alvo))
      .filter((p) =>
        filtro === "todos" ? true
          : filtro === "em_ferias" ? !!p.emGozo
            : filtro === "em_dia" ? (["em_dia", "primeiro_ano", "sem_periodo"].includes(p.pendencia)) && !p.emGozo
              : p.pendencia === filtro && !p.emGozo)
      .sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome));

    if (visiveis.length === 0) {
      return el("div", { classe: "ferias-lista" }, [vazio("Ninguém com esse filtro", "Troque a busca ou volte para todas as pessoas.")]);
    }

    return el("div", { classe: "ferias-lista" }, [
      tabelaDeDados({
        colunas: [
          { rotulo: "Pessoa", principal: true },
          { rotulo: "Na casa desde", largura: "150px" },
          { rotulo: "Situação das férias", largura: "46%", quebra: true, larga: true },
        ],
        larguraMinima: "680px",
        linhas: visiveis.map((pes) => ({
          aoClicar: () => abrir(pes.atendente_id),
          classe: pes.pendencia === "vencido" ? "linha-perigo" : "",
          celulas: [
            comSigla(pes.nome, pes.funcao || null),
            pes.admissao ? diaBr(pes.admissao) : el("span", { classe: "muted", texto: "—" }),
            el("span", { classe: "cel-etiquetas" }, resumo(pes).map(([texto, cor]) => etiqueta(texto, cor))),
          ],
        })),
      }),
    ]);
  }

  /* ================= Prazos: a casa inteira ================= */

  function prazosDaCasa(time) {
    const janela = faixaDeMeses(dados.hoje, -1, 18);

    const linhas = time
      .map((pes) => {
        const abertos = pes.periodos
          .filter((p) => p.situacao !== "em_curso" && p.situacao !== "gozado" && p.dias_restantes > 0)
          .map((p) => ({ p, dias: p.dias_para_vencer }))
          .sort((a, b) => a.dias - b.dias);
        return {
          pes,
          abertos,
          maisUrgente: abertos.length ? abertos[0].dias : Infinity,
          // Dois saldos, não um: dizer "90 dias vencidos" quando 30 deles ainda
          // estão no prazo assusta por um número que não existe.
          vencidos: abertos.filter((a) => a.dias < 0).reduce((s, a) => s + a.p.dias_restantes, 0),
          saldo: abertos.reduce((s, a) => s + a.p.dias_restantes, 0),
          marcadas: pes.lancamentos.filter((f) => ["agendada", "em_gozo"].includes(situacaoDoLancamento(f, dados.hoje))),
        };
      })
      .filter((l) => l.abertos.length > 0 || l.pes.emCurso)
      .sort((a, b) => a.maisUrgente - b.maisUrgente || a.pes.nome.localeCompare(b.pes.nome));

    const conta = (teste) => linhas.filter(teste).length;
    const cartoes = [
      { rotulo: "Passaram do prazo", valor: conta((l) => l.maisUrgente < 0), cor: "var(--ferias-vencida)" },
      { rotulo: "Vencem em 60 dias", valor: conta((l) => l.maisUrgente >= 0 && l.maisUrgente <= 60), cor: "var(--ferias-perto)" },
      { rotulo: "Vencem em 120 dias", valor: conta((l) => l.maisUrgente > 60 && l.maisUrgente <= 120), cor: "var(--ferias-agendada)" },
      { rotulo: "Com folga", valor: conta((l) => l.maisUrgente > 120 && l.maisUrgente !== Infinity), cor: "var(--ferias-tirada)" },
      { rotulo: "Ainda acumulando", valor: conta((l) => l.maisUrgente === Infinity), cor: "var(--borda-forte)" },
    ];

    return el("div", {}, [
      el("div", { classe: "grade grade-compacta" },
        cartoes.map((c) =>
          el("div", { classe: "indicador" }, [
            el("div", { classe: "indicador-rotulo" }, [
              el("span", { classe: "ferias-cor", style: `background:${c.cor};height:14px;width:5px;border-radius:99px` }),
              el("span", { texto: c.rotulo }),
            ]),
            el("div", { classe: "indicador-valor", texto: String(c.valor) }),
          ]),
        ),
      ),
      el("section", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("h3", { texto: "Prazo para conceder, pessoa por pessoa" }),
          el("span", { classe: "muted", texto: `${linhas.length} ${linhas.length === 1 ? "pessoa" : "pessoas"} · quem vence primeiro no topo` }),
        ]),
        el("p", {
          classe: "muted",
          texto: "Cada barra termina na data-limite daquele período. Vermelho já passou; laranja vence em 60 dias; amarelo em 120; verde tem folga. Tracejado é o ano ainda acumulando. A faixa fina em cima são férias já marcadas.",
        }),
        linhas.length === 0
          ? vazio("Ninguém com período em aberto", "Quando alguém fechar o primeiro ano de casa, ele aparece aqui.")
          : el("div", { classe: "rolagem-x" }, [
            el("div", { classe: "ferias-gantt", style: "min-width:860px;margin-top:10px" }, [
              cabecalhoDeMeses(janela, 196),
              el("div", { style: "position:relative" }, [
                el("div", { classe: "ferias-hoje", style: `left:calc(196px + (100% - 196px) * ${janela.pct(dados.hoje) / 100})` }),
                ...linhas.map((l) => linhaDePrazo(l, janela)),
              ]),
            ]),
          ]),
        legendaDeUrgencia(),
      ]),
    ]);
  }

  function linhaDePrazo({ pes, abertos, maisUrgente, vencidos, saldo, marcadas }, janela) {
    const u = maisUrgente === Infinity ? null : urgencia(maisUrgente);
    const proximo = abertos[0];
    const quantas = abertos.length + (pes.emCurso ? 1 : 0);

    return el("div", { classe: "ferias-gantt-linha", style: `height:${alturaDaLinha(quantas)}px` }, [
      el("button", {
        classe: "ferias-gantt-nome",
        type: "button",
        style: "width:196px;display:flex;align-items:center;gap:9px",
        title: pes.nome,
        onclick: () => abrir(pes.atendente_id),
      }, [
        el("span", { classe: "ferias-cor", style: `background:${u ? u.cor : "var(--borda-forte)"};width:5px;height:28px;border-radius:99px` }),
        el("span", { classe: "linha-principal", style: "min-width:0" }, [
          el("strong", { texto: primeiroENome(pes.nome) }),
          el("span", {
            classe: "muted",
            texto: proximo
              ? maisUrgente < 0
                ? `${vencidos} ${vencidos === 1 ? "vencido" : "vencidos"} desde ${diaCurto(proximo.p.limite)}`
                  + (saldo > vencidos ? ` · mais ${saldo - vencidos} no prazo` : "")
                : `${nDias(saldo)} até ${diaCurto(proximo.p.limite)} (${maisUrgente}d)`
              : pes.emCurso ? `fecha o ano em ${diaCurto(pes.emCurso.fim)}` : "",
          }),
        ]),
      ]),
      el("div", { classe: "ferias-trilho" }, [
        grade(janela),
        // Uma pista por período: empilhadas, e não sobrepostas. A barra do
        // atraso e a do período que ainda está no prazo começam as duas na
        // borda esquerda, e uma cobria a outra.
        ...abertos.map(({ p, dias }, i) => barraDePrazo(p, dias, janela, pista(i, quantas))),
        // O ano ainda acumulando fica na última pista, tracejado.
        pes.emCurso ? barraDoAnoEmCurso(pes.emCurso, janela, pista(quantas - 1, quantas)) : null,
        ...marcadas.map((f) => {
          const cor = CORES[situacaoDoLancamento(f, dados.hoje)];
          const esq = janela.pct(f.inicio);
          return el("div", {
            classe: "ferias-faixa",
            style: `left:${esq}%;width:${Math.max(0.7, janela.pct(somarDias(f.fim, 1)) - esq)}%;background:${cor.fundo}`,
            title: `${cor.nome}: ${diaBr(f.inicio)} a ${diaBr(f.fim)} · ${nDias(f.dias)}`,
          });
        }),
      ]),
    ]);
  }

  function barraDoAnoEmCurso(per, janela, faixa) {
    const de = somarDias(per.fim, 1);
    if (per.limite < janela.de || de > janela.ate) return null;
    const esq = janela.pct(de);
    const larg = Math.max(0.9, janela.pct(per.limite) - esq);
    return el("div", {
      classe: "ferias-bloco ferias-bloco-curso",
      style: `left:${esq}%;width:${larg}%;${faixa}`,
      title: `Período ${diaBr(per.inicio)} a ${diaBr(per.fim)} ainda acumulando: 30 dias a conceder até ${diaBr(per.limite)}`,
      texto: larg > 11 ? `30d a partir de ${diaCurto(de)}` : "",
    });
  }

  /**
   * Altura de uma linha com n pistas, e onde a i-ésima pista começa.
   *
   * Declarações, não consts: o `return` do topo da fábrica sai antes daqui, e
   * um const nesta altura do arquivo nunca chegaria a ser inicializado.
   */
  function alturaDaLinha(n) {
    return Math.max(46, 14 + n * ALTURA_DA_PISTA);
  }

  function pista(i, n) {
    const topo = (alturaDaLinha(n) - n * ALTURA_DA_PISTA) / 2 + i * ALTURA_DA_PISTA;
    return `top:${topo}px;height:${ALTURA_DA_PISTA - 3}px;bottom:auto`;
  }

  function barraDePrazo(per, dias, janela, faixa) {
    const u = urgencia(dias);
    // Vencido: a barra vai da data-limite até hoje, para o atraso ter tamanho.
    const de = dias < 0 ? per.limite : somarDias(per.fim, 1);
    const ate = dias < 0 ? dados.hoje : per.limite;
    const titulo = `Período ${diaBr(per.inicio)} a ${diaBr(per.fim)}: ${nDias(per.dias_restantes)} a conceder até ${diaBr(per.limite)}`
      + (dias < 0 ? ` — passou há ${-dias} dias` : ` — faltam ${dias} dias`);

    if (ate < janela.de) {
      // Venceu antes da janela: marca no canto esquerdo para não sumir.
      return el("div", {
        classe: "ferias-bloco",
        style: `left:0;width:9%;background:${u.cor};color:var(--ferias-texto);${faixa}`,
        title: titulo,
        texto: `◀ ${per.dias_restantes}d`,
      });
    }
    const esq = janela.pct(de);
    const larg = Math.max(1, janela.pct(ate) - esq);
    return el("div", {
      classe: "ferias-bloco",
      style: `left:${esq}%;width:${larg}%;background:${u.cor};color:var(--ferias-texto);${faixa}`,
      title: titulo,
      texto: larg > 9
        ? (dias < 0 ? `${per.dias_restantes}d · vencido há ${-dias}d` : `${per.dias_restantes}d · até ${diaCurto(per.limite)}`)
        : "",
    });
  }

  /* ================= Alertas ================= */

  /**
   * O que precisa de ação, em ordem de urgência. Sai das mesmas datas das
   * outras abas — aqui vira uma lista de recados, um por assunto.
   */
  function alertas(time) {
    const lista = [];
    for (const pes of time) {
      if (!pes.admissao) {
        lista.push({
          pes, nivel: 3, rotulo: "cadastro",
          titulo: `${pes.nome} está sem data de admissão`,
          texto: "Sem a admissão na ficha não existe período aquisitivo, e as férias desta pessoa não são acompanhadas. Preencha na aba Equipe.",
        });
        continue;
      }
      for (const per of pes.periodos) {
        if (per.situacao === "vencido") {
          lista.push({
            pes, nivel: 0, rotulo: "urgente",
            titulo: `${pes.nome}: ${nDias(per.dias_restantes)} vencidos do período ${anoDe(per.inicio)}→${anoDe(per.fim)}`,
            texto: `O período de ${diaBr(per.inicio)} a ${diaBr(per.fim)} tinha de ser concedido até ${diaBr(per.limite)} — passou há ${-per.dias_para_vencer} dias. A partir daqui a lei manda pagar em dobro; fale com a contabilidade e marque as férias.`,
          });
        } else if (per.situacao === "a_vencer") {
          lista.push({
            pes, nivel: 1, rotulo: "alta",
            titulo: `${pes.nome}: o período ${anoDe(per.inicio)}→${anoDe(per.fim)} vence em ${per.dias_para_vencer} dias`,
            texto: `Faltam ${nDias(per.dias_restantes)} do período de ${diaBr(per.inicio)} a ${diaBr(per.fim)}, e o prazo é ${diaBr(per.limite)}. Marcar agora ainda dá para combinar com a escala.`,
          });
        } else if (per.situacao === "a_conceder" && per.dias_para_vencer <= 120 && per.dias_restantes > 0) {
          lista.push({
            pes, nivel: 2, rotulo: "média",
            titulo: `${pes.nome}: ${nDias(per.dias_restantes)} para conceder do período ${anoDe(per.inicio)}→${anoDe(per.fim)}`,
            texto: `Prazo em ${diaBr(per.limite)}, daqui a ${per.dias_para_vencer} dias. Ainda dá para escolher a melhor época para a casa.`,
          });
        }
      }
      for (const f of pes.lancamentos) {
        if (situacaoDoLancamento(f, dados.hoje) === "a_decidir") {
          lista.push({
            pes, nivel: 1, rotulo: "alta",
            titulo: `${pes.nome}: férias terminaram sem decisão`,
            texto: `O lançamento de ${diaBr(f.inicio)} a ${diaBr(f.fim)} continua esperando aprovação. Enquanto ninguém decide, esses ${f.dias} dias não quitam o período.`,
          });
        } else if (f.situacao === "pedido") {
          lista.push({
            pes, nivel: 2, rotulo: "média",
            titulo: `${pes.nome}: pedido esperando decisão`,
            texto: `${diaBr(f.inicio)} a ${diaBr(f.fim)}, ${nDias(f.dias)}. Aprovar já marca os dias na escala.`,
          });
        }
      }
    }
    lista.sort((a, b) => a.nivel - b.nivel || a.pes.nome.localeCompare(b.pes.nome));

    const cores = ["etiqueta-perigo", "etiqueta-alerta", "etiqueta-info", ""];

    return el("section", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("h3", { texto: "Alertas de férias" }),
        el("span", { classe: "muted", texto: `${lista.length} ${lista.length === 1 ? "recado" : "recados"}` }),
      ]),
      lista.length === 0
        ? vazio("Nada pendente", "Nenhum período vencendo, nenhum pedido esperando decisão.")
        : el("div", { classe: "tabela", style: "margin-top:10px" },
          lista.map((a) =>
            el("div", { classe: `linha-tabela ${a.nivel === 0 ? "linha-atencao" : ""}`.trim(), style: "align-items:flex-start" }, [
              el("div", { classe: "linha-principal", style: "flex:1;min-width:230px" }, [
                el("strong", { texto: a.titulo }),
                el("span", { classe: "muted", texto: a.texto }),
              ]),
              etiqueta(a.rotulo, cores[a.nivel]),
              el("button", {
                classe: "btn btn-peq",
                type: "button",
                texto: "Abrir",
                onclick: () => abrir(a.pes.atendente_id),
              }),
            ]),
          ),
        ),
    ]);
  }

  /* ================= A página de uma pessoa ================= */

  function abrir(id) {
    pessoaAberta = id;
    lancando = false;
    desenhar();
    corpo.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function paginaDaPessoa(pes) {
    return el("div", { classe: "pilha" }, [
      el("div", {}, [botaoVoltar(() => { pessoaAberta = null; desenhar(); }, "Todas as pessoas")]),
      fichaDoTopo(pes),
      pes.periodos.length === 0
        ? vazio(
          pes.admissao ? "Sem período aquisitivo ainda" : "Sem data de admissão na ficha",
          pes.admissao
            ? "O primeiro período fecha doze meses depois da admissão."
            : "Preencha a admissão na aba Equipe — é dela que sai todo o cálculo.",
        )
        : el("div", {}, [linhaDoTempo(pes), anoAAno(pes)]),
      cartaoDeLancamento([pes], pes),
    ]);
  }

  function fichaDoTopo(pes) {
    const cartoes = [
      {
        rotulo: "Dias vencidos",
        valor: pes.diasVencidos,
        nota: pes.diasVencidos > 0 ? "a lei manda pagar em dobro" : "nenhum",
      },
      {
        rotulo: "Dias a tirar",
        valor: pes.diasATirar,
        nota: pes.proximoPrazo ? `até ${diaBr(pes.proximoPrazo)}`
          : pes.emCurso ? `próximos 30 a partir de ${diaCurto(somarDias(pes.emCurso.fim, 1))}` : "nenhum",
      },
      {
        rotulo: "Dias já tirados",
        valor: pes.diasTirados,
        nota: pes.diasVendidos > 0 ? `mais ${nDias(pes.diasVendidos)} ${pes.diasVendidos === 1 ? "vendido" : "vendidos"}` : `em ${pes.periodos.filter((p) => p.dias_gozados > 0).length} períodos`,
      },
      {
        rotulo: "Próximas férias",
        valor: pes.emGozo ? "agora" : pes.proximaAgendada ? diaCurto(pes.proximaAgendada.inicio) : "—",
        nota: pes.emGozo ? `volta ${diaCurto(somarDias(pes.emGozo.fim, 1))}`
          : pes.proximaAgendada ? `${nDias(pes.proximaAgendada.dias)} · até ${diaCurto(pes.proximaAgendada.fim)}` : "nada marcado",
      },
    ];

    return el("section", { classe: `cartao ${pes.pendencia === "vencido" ? "cartao-atencao" : ""}`.trim() }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: pes.nome }),
          el("p", {
            classe: "muted",
            texto: [
              pes.funcao,
              pes.admissao ? `na casa desde ${diaBr(pes.admissao)} · ${tempoDeCasa(pes.admissao, dados.hoje)}` : "sem data de admissão",
            ].filter(Boolean).join(" · "),
          }),
        ]),
        el("div", { classe: "reserva-acoes", style: "flex-wrap:wrap" },
          resumo(pes).map(([texto, cor]) => etiqueta(texto, cor)),
        ),
      ]),
      el("div", { classe: "grade", style: "margin-top:14px" },
        cartoes.map((c) =>
          el("div", { classe: "indicador" }, [
            el("div", { classe: "indicador-rotulo" }, [el("span", { texto: c.rotulo })]),
            el("div", { classe: "indicador-valor", texto: String(c.valor) }),
            el("div", { classe: "indicador-nota", texto: c.nota }),
          ]),
        ),
      ),
    ]);
  }

  /**
   * Uma faixa por período: os doze meses trabalhados (escuro) e os doze do
   * prazo para conceder (claro). Os dias tirados aparecem no lugar em que
   * caíram; a linha laranja é hoje.
   */
  function linhaDoTempo(pes) {
    return el("section", { classe: "cartao" }, [
      el("h4", { texto: "Linha do tempo", style: "margin:0" }),
      el("p", { classe: "muted", texto: "Cada faixa é um período: doze meses trabalhados e, em seguida, doze meses de prazo para conceder." }),
      el("div", { style: "display:grid;gap:9px;margin-top:12px" },
        pes.periodos.map((per) => faixaDoPeriodo(pes, per)),
      ),
      legendaDoTempo(),
    ]);
  }

  function faixaDoPeriodo(pes, per) {
    const total = Math.max(1, diasEntre(per.inicio, per.limite));
    const pct = (iso) => Math.min(100, Math.max(0, ((diasEntre(per.inicio, iso) - 1) / total) * 100));
    const fimDoTrabalho = pct(somarDias(per.fim, 1));
    const hojeDentro = dados.hoje >= per.inicio && dados.hoje <= per.limite;
    const meusLancamentos = pes.lancamentos.filter((f) => f.periodo_inicio === per.inicio);

    return el("div", { classe: "ferias-tempo-linha" }, [
      el("div", { classe: "ferias-tempo-rotulo" }, [
        el("strong", { texto: `${anoDe(per.inicio)} → ${anoDe(per.fim)}` }),
        el("small", {
          classe: "muted",
          texto: per.situacao === "em_curso" ? "acumulando"
            : per.situacao === "gozado" ? "tirou tudo"
              : per.situacao === "vencido" ? `${per.dias_restantes}d vencidos`
                : `faltam ${per.dias_restantes}d`,
        }),
      ]),
      el("div", {
        classe: "ferias-tempo-trilho",
        title: `Trabalhou de ${diaBr(per.inicio)} a ${diaBr(per.fim)} · conceder até ${diaBr(per.limite)}`,
      }, [
        el("div", { classe: "ferias-tempo-trabalho", style: `width:${fimDoTrabalho}%` }),
        el("div", {
          classe: `ferias-tempo-prazo ${per.situacao === "vencido" ? "ferias-tempo-vencido" : ""}`.trim(),
          style: `left:${fimDoTrabalho}%`,
        }),
        ...meusLancamentos.map((f) => {
          const cor = CORES[situacaoDoLancamento(f, dados.hoje)];
          // Férias tiradas depois do prazo não cabem na faixa: vão para a ponta.
          const atrasada = f.inicio > per.limite;
          const esq = atrasada ? 97 : pct(f.inicio);
          const larg = atrasada ? 3 : Math.max(1.2, pct(somarDias(f.fim, 1)) - esq);
          return el("div", {
            classe: "ferias-tempo-bloco",
            style: `left:${esq}%;width:${larg}%;background:${cor.fundo}`,
            title: `${diaBr(f.inicio)} a ${diaBr(f.fim)} · ${nDias(f.dias)} · ${cor.nome}${atrasada ? " · tiradas depois do prazo" : ""}`,
          });
        }),
        hojeDentro ? el("div", { classe: "ferias-hoje", style: `left:${pct(dados.hoje)}%`, title: "Hoje" }) : null,
        el("span", { classe: "ferias-tempo-ponta ferias-tempo-ponta-esq", texto: mesAno(per.inicio) }),
        el("span", { classe: "ferias-tempo-ponta ferias-tempo-ponta-dir", texto: mesAno(per.limite) }),
      ]),
    ]);
  }

  /** Período a período, em frases — e os lançamentos de cada um. */
  function anoAAno(pes) {
    return el("section", { classe: "cartao" }, [
      el("h4", { texto: "Período a período", style: "margin:0 0 10px" }),
      el("div", { classe: "tabela" },
        pes.periodos.slice().reverse().map((per) => {
          const meus = pes.lancamentos.filter((f) => f.periodo_inicio === per.inicio);
          return el("div", { classe: `linha-tabela ${per.situacao === "vencido" ? "linha-atencao" : ""}`.trim(), style: "align-items:flex-start;flex-wrap:wrap" }, [
            el("div", { classe: "linha-principal", style: "min-width:210px" }, [
              el("strong", { texto: `${per.numero}º período · ${diaBr(per.inicio)} a ${diaBr(per.fim)}` }),
              el("span", {
                classe: "muted",
                texto: per.situacao === "em_curso"
                  ? `acumulando; depois de ${diaBr(per.fim)} são 30 dias a conceder até ${diaBr(per.limite)}`
                  : `30 dias de direito · conceder até ${diaBr(per.limite)}`,
              }),
            ]),
            el("div", { classe: "linha-principal", style: "flex:1;min-width:240px;gap:6px" }, [
              frasesDoPeriodo(per, meus),
              ...meus.map((f) => chipDeLancamento(f, meus.length > 1 ? `${meus.indexOf(f) + 1}º` : null)),
            ]),
            el("div", { classe: "reserva-acoes" }, [
              etiqueta(
                NOME_DO_PERIODO[per.situacao] ?? per.situacao,
                per.situacao === "gozado" ? "etiqueta-ok"
                  : per.situacao === "vencido" ? "etiqueta-perigo"
                    : per.situacao === "a_vencer" ? "etiqueta-alerta" : "",
              ),
            ]),
          ]);
        }),
      ),
    ]);
  }

  function frasesDoPeriodo(per, meus) {
    if (per.situacao === "em_curso") {
      return el("span", { classe: "muted", texto: `Em andamento: fecha o ano em ${diaBr(per.fim)}.` });
    }
    if (per.situacao === "gozado") {
      return el("span", {
        classe: "ferias-frase-ok",
        texto: `Tirou tudo — ${nDias(per.dias_gozados)}, último em ${diaBr(per.gozado_em)}.`,
      });
    }
    if (meus.length === 0) {
      return el("span", {
        classe: per.situacao === "vencido" ? "ferias-frase-alerta" : "muted",
        texto: per.situacao === "vencido"
          ? `Ainda não tirou: ${nDias(per.dias_restantes)} vencidos desde ${diaBr(per.limite)}.`
          : `Ainda não tirou: ${nDias(per.dias_restantes)} a conceder até ${diaBr(per.limite)} (${per.dias_para_vencer} dias).`,
      });
    }
    return el("span", {
      classe: per.situacao === "vencido" ? "ferias-frase-alerta" : "muted",
      texto: `Tirou ${per.dias_gozados} de 30 dias · ${per.situacao === "vencido"
        ? `${nDias(per.dias_restantes)} vencidos desde ${diaBr(per.limite)}`
        : `faltam ${nDias(per.dias_restantes)} até ${diaBr(per.limite)}`}.`,
    });
  }

  function chipDeLancamento(f, ordem) {
    const sit = situacaoDoLancamento(f, dados.hoje);
    const cor = CORES[sit];
    return el("div", { classe: "ferias-chip", style: `border-color:${cor.fundo}` }, [
      ordem ? el("span", { classe: "ferias-chip-ordem", texto: ordem }) : null,
      el("span", { classe: "ferias-cor", style: `background:${cor.fundo}` }),
      el("strong", { texto: `${diaBr(f.inicio)} a ${diaBr(f.fim)}` }),
      el("span", { classe: "muted", texto: `${nDias(f.dias)}${f.abono_dias ? ` + ${f.abono_dias} ${f.abono_dias === 1 ? "vendido" : "vendidos"}` : ""} · ${NOME_DA_SITUACAO[f.situacao] ?? f.situacao}` }),
      f.situacao === "pedido"
        ? el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "Aprovar", onclick: (e) => decidir(f.id, "aprovar", e.target) })
        : null,
      f.situacao === "pedido"
        ? el("button", { classe: "btn btn-peq", type: "button", texto: "Recusar", onclick: (e) => decidir(f.id, "recusar", e.target) })
        : null,
      f.situacao === "aprovado"
        ? el("button", { classe: "btn btn-peq", type: "button", texto: "Cancelar", onclick: (e) => decidir(f.id, "cancelar", e.target) })
        : null,
      el("button", {
        classe: "btn btn-peq btn-perigo",
        type: "button",
        texto: "Apagar",
        onclick: async (e) => {
          if (!confirm(`Apagar as férias de ${diaBr(f.inicio)} a ${diaBr(f.fim)}? Os ${f.dias} dias voltam para o saldo.`)) return;
          e.target.disabled = true;
          try {
            await del(`/v1/venues/${ctx.venue}/rh/ferias/${f.id}`);
            avisar("Lançamento apagado.", "ok");
            await recarregar();
          } catch (err) {
            avisar(err.message, "erro");
            e.target.disabled = false;
          }
        },
      }),
    ]);
  }

  async function decidir(id, acao, botao) {
    botao.disabled = true;
    try {
      await post(`/v1/venues/${ctx.venue}/rh/ferias/${id}/${acao}`, {});
      avisar(
        acao === "aprovar" ? "Férias aprovadas. Os dias já entraram na escala."
          : acao === "recusar" ? "Pedido recusado." : "Férias canceladas.",
        "ok",
      );
      await recarregar();
    } catch (e) {
      avisar(e.message, "erro");
      botao.disabled = false;
    }
  }

  /* ================= Lançar férias ================= */

  /**
   * Um formulário só, usado no topo (escolhendo a pessoa) e dentro da página
   * dela (pessoa já escolhida). Datas que já passaram entram como tiradas;
   * datas futuras ficam como pedido até alguém aprovar.
   */
  function cartaoDeLancamento(time, pessoaFixa) {
    const quem = el("select", { classe: "input" },
      time.map((p) => el("option", { value: p.atendente_id, texto: p.nome, selected: pessoaFixa?.atendente_id === p.atendente_id })),
    );
    const inicio = el("input", { classe: "input", type: "date" });
    const fim = el("input", { classe: "input", type: "date" });
    const abono = el("input", { classe: "input", type: "number", min: "0", max: "10", value: "0" });
    const observacao = el("input", { classe: "input", type: "text", placeholder: "Combinado com a equipe" });
    const previa = el("p", { classe: "muted", texto: "Escolha as datas para ver quantos dias são." });

    const recalcular = () => {
      if (!inicio.value || !fim.value || fim.value < inicio.value) {
        previa.textContent = "Escolha as datas para ver quantos dias são.";
        return;
      }
      const dias = diasEntre(inicio.value, fim.value);
      previa.textContent = fim.value < dados.hoje
        ? `${nDias(dias)} — as datas já passaram, então entra direto como tiradas e quita o período.`
        : `${nDias(dias)} — fica como pedido até alguém aprovar; ao aprovar, os dias entram na escala.`;
    };
    inicio.addEventListener("change", recalcular);
    fim.addEventListener("change", recalcular);

    return el("section", { classe: "cartao" }, [
      el("h4", { texto: pessoaFixa ? `Lançar férias de ${pessoaFixa.nome}` : "Lançar férias", style: "margin:0 0 4px" }),
      previa,
      el("div", { classe: "grade" }, [
        pessoaFixa ? null : el("div", { classe: "campo" }, [el("label", { texto: "Quem" }), quem]),
        el("div", { classe: "campo" }, [el("label", { texto: "Começa" }), inicio]),
        el("div", { classe: "campo" }, [el("label", { texto: "Termina" }), fim]),
        el("div", { classe: "campo" }, [el("label", { texto: "Dias vendidos (abono)" }), abono]),
        el("div", { classe: "campo" }, [el("label", { texto: "Observação" }), observacao]),
      ]),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Lançar",
          onclick: async (e) => {
            const alvo = pessoaFixa ? pessoaFixa.atendente_id : quem.value;
            if (!alvo) return avisar("Escolha quem vai tirar férias.", "erro");
            if (!inicio.value || !fim.value) return avisar("Informe o começo e o fim das férias.", "erro");
            e.target.disabled = true;
            try {
              const r = await post(`/v1/venues/${ctx.venue}/rh/ferias`, {
                atendente_id: alvo,
                inicio: inicio.value,
                fim: fim.value,
                abono_dias: Number(abono.value) || 0,
                observacao: observacao.value,
              });
              // Aviso não é erro: a lei permite com acordo, e travar faria o
              // gestor lançar por fora.
              avisar(r.avisos.length ? `Lançado. Atenção: ${r.avisos.join(" ")}` : "Lançado.", r.avisos.length ? "info" : "ok");
              lancando = false;
              if (!pessoaFixa) pessoaAberta = alvo;
              await recarregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      ]),
    ]);
  }

  /* ================= Peças compartilhadas ================= */

  function cabecalhoDeMeses(janela, larguraDoNome) {
    return el("div", { classe: "ferias-gantt-meses" }, [
      el("div", { style: `width:${larguraDoNome}px;flex-shrink:0` }),
      ...janela.meses.map((m) =>
        el("div", {
          classe: `ferias-gantt-mes ${m.slice(0, 7) === dados.hoje.slice(0, 7) ? "mes-atual" : ""}`.trim(),
          texto: nomeDoMes(m),
        }),
      ),
    ]);
  }

  function grade(janela) {
    return el("div", { classe: "ferias-grade" }, janela.meses.map(() => el("span", {})));
  }

  function legendaDeCores(chaves) {
    return el("div", { classe: "ferias-legenda" },
      chaves.map((k) =>
        el("span", {}, [
          el("span", { classe: "ferias-cor", style: `background:${CORES[k].fundo}` }),
          el("span", { texto: CORES[k].nome }),
        ]),
      ),
    );
  }

  function legendaDeUrgencia() {
    return el("div", { classe: "ferias-legenda" }, [
      ...URGENCIAS.map((u) =>
        el("span", {}, [el("span", { classe: "ferias-cor", style: `background:${u.cor}` }), el("span", { texto: u.rotulo })]),
      ),
      el("span", {}, [el("span", { classe: "ferias-cor ferias-cor-tracejada" }), el("span", { texto: "ano acumulando" })]),
      el("span", {}, [el("span", { classe: "ferias-cor", style: "background:var(--marca);width:3px;height:13px" }), el("span", { texto: "hoje" })]),
    ]);
  }

  function legendaDoTempo() {
    return el("div", { classe: "ferias-legenda" }, [
      el("span", {}, [el("span", { classe: "ferias-cor", style: "background:var(--borda-forte)" }), el("span", { texto: "12 meses trabalhados" })]),
      el("span", {}, [el("span", { classe: "ferias-cor ferias-cor-vazia" }), el("span", { texto: "prazo para conceder" })]),
      ...["gozada", "em_gozo", "agendada"].map((k) =>
        el("span", {}, [el("span", { classe: "ferias-cor", style: `background:${CORES[k].fundo}` }), el("span", { texto: CORES[k].nome })]),
      ),
      el("span", {}, [el("span", { classe: "ferias-cor", style: "background:var(--marca);width:3px;height:13px" }), el("span", { texto: "hoje" })]),
    ]);
  }
}

/* ================= Contas de calendário ================= */

function situacaoDoLancamento(f, hoje) {
  if (f.inicio <= hoje && f.fim >= hoje) return "em_gozo";
  if (f.inicio > hoje) return "agendada";
  return f.situacao === "aprovado" ? "gozada" : "a_decidir";
}

function comoData(iso) {
  return new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
}

function somarDias(iso, dias) {
  const d = comoData(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diasEntre(inicio, fim) {
  return Math.round((comoData(fim) - comoData(inicio)) / 86400000) + 1;
}

/** A janela do gráfico: N meses a partir de `deslocamento` meses de hoje. */
function faixaDeMeses(hoje, deslocamento, quantos) {
  const base = comoData(hoje);
  const primeiro = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + deslocamento, 1, 12));
  const meses = [];
  for (let i = 0; i < quantos; i += 1) {
    meses.push(new Date(Date.UTC(primeiro.getUTCFullYear(), primeiro.getUTCMonth() + i, 1, 12)).toISOString().slice(0, 10));
  }
  const de = meses[0];
  const ate = new Date(Date.UTC(primeiro.getUTCFullYear(), primeiro.getUTCMonth() + quantos, 0, 12)).toISOString().slice(0, 10);
  const total = Math.max(1, diasEntre(de, ate));
  return {
    de,
    ate,
    meses,
    pct: (iso) => Math.min(100, Math.max(0, ((diasEntre(de, iso) - 1) / total) * 100)),
  };
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function nomeDoMes(iso) {
  const [ano, mes] = String(iso).slice(0, 7).split("-");
  return `${MESES[Number(mes) - 1]}${mes === "01" ? `/${ano.slice(2)}` : ""}`;
}

function mesAno(iso) {
  const [ano, mes] = String(iso).slice(0, 7).split("-");
  return `${mes}/${ano.slice(2)}`;
}

function anoDe(iso) {
  return String(iso).slice(0, 4);
}

function diaBr(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

function diaCurto(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
}

function primeiroENome(nome) {
  return String(nome).split(" ").slice(0, 2).join(" ");
}

function tempoDeCasa(admissao, hoje) {
  const a = comoData(admissao);
  const h = comoData(hoje);
  let meses = (h.getUTCFullYear() - a.getUTCFullYear()) * 12 + (h.getUTCMonth() - a.getUTCMonth());
  if (h.getUTCDate() < a.getUTCDate()) meses -= 1;
  meses = Math.max(0, meses);
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  if (anos === 0) return `${resto} ${resto === 1 ? "mês" : "meses"}`;
  const emAnos = `${anos} ${anos === 1 ? "ano" : "anos"}`;
  return resto === 0 ? emAnos : `${emAnos} e ${resto} ${resto === 1 ? "mês" : "meses"}`;
}

/** "1 dia", "30 dias": o número com a palavra no singular ou no plural. */
function nDias(n) {
  return `${n} ${Number(n) === 1 ? "dia" : "dias"}`;
}
