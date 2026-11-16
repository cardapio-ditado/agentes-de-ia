import { get } from "../api.js";
import { ICONES, avisar, botaoVoltar, comIcone, dataHora, el, esqueleto, estadoDeErro, etiqueta, indicador, limpar, tabelaDeDados, vazio } from "../ui.js";
import { botaoDePdf, imprimirRelatorio } from "../relatorio.js";

const STATUS = {
  pendente: ["Aguardando", ""],
  em_andamento: ["Em andamento", "etiqueta-alerta"],
  concluida: ["Concluída", "etiqueta-ok"],
};

/**
 * Execuções: o registro de quem fez, quando, e o que a IA encontrou.
 *
 * A lista é o mapa do dia; abrir uma execução mostra resposta por resposta,
 * com as fotos como prova e os alertas da IA em destaque.
 */
export async function execucoes(raiz, ctx) {
  const lista = el("div", { classe: "pilha" });
  const detalhe = el("div", {});
  let runs = [];

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

  raiz.append(el("div", { classe: "pilha" }, [lista, detalhe]));

  await carregar();

  async function carregar() {
    // A lista e o detalhe dividem a tela: abrir um checklist troca a lista
    // por ele, e "Voltar" devolve a lista como estava.
    detalhe.hidden = true;
    lista.hidden = false;
    limpar(detalhe);
    limpar(lista).append(esqueleto({ cartoes: 4, linhas: 5 }));
    try {
      runs = await get(`/v1/venues/${ctx.venue}/checklist-runs`);
    } catch (e) {
      ctx.definirAcoes?.();
      limpar(lista).append(estadoDeErro("Não deu para carregar os checklists feitos", e.message, carregar));
      return;
    }
    desenharLista();
  }

  function desenharLista() {
    detalhe.hidden = true;
    lista.hidden = false;
    ctx.definirAcoes?.(
      botaoDePdf(relatorioDaSemana, "Semana em PDF"),
      el("button", { classe: "btn", type: "button", onclick: carregar }, comIcone(ICONES.atualizar, "Atualizar")),
    );
    limpar(lista);

    if (runs.length === 0) {
      lista.append(
        vazio(
          "Nenhum checklist feito ainda",
          'Crie um modelo em "Modelos de checklist" e clique em "Disparar agora" para testar.',
          el("a", { classe: "btn btn-primario", href: "#checklists", texto: "Ver os modelos" }),
        ),
      );
      return;
    }

    // Os números são da lista que está na tela — a mesma que a tabela mostra.
    const alertasDe = (r) => (Array.isArray(r.alertas_ia) ? r.alertas_ia.length : 0);
    const concluidos = runs.filter((r) => r.status === "concluida").length;
    const abertos = runs.length - concluidos;
    const comAlerta = runs.filter((r) => alertasDe(r) > 0).length;
    const rodadasPuladas = runs.reduce((t, r) => t + (r.status === "concluida" && r.rodadas_previstas ? Math.max(0, r.rodadas_previstas - r.rodadas_feitas) : 0), 0);

    lista.append(
      el("div", { classe: "grade" }, [
        indicador({ rotulo: "Na lista", valor: runs.length, nota: runs.length === 1 ? "checklist disparado" : "checklists disparados", iconePath: ICONES.checklist, cor: "areia" }),
        indicador({ rotulo: "Concluídos", valor: concluidos, nota: abertos ? `${abertos} ainda ${abertos === 1 ? "aberto" : "abertos"}` : "todos concluídos", iconePath: ICONES.relogio, cor: "musgo" }),
        indicador({ rotulo: "Com alerta da IA", valor: comAlerta, nota: comAlerta ? "abra para ver o que ela apontou" : "nada apontado", iconePath: ICONES.alerta, cor: "marca", tom: comAlerta ? "alerta" : undefined }),
        indicador({ rotulo: "Rodadas puladas", valor: rodadasPuladas, nota: rodadasPuladas ? "em checklists já encerrados" : "nenhuma rodada pulada", iconePath: ICONES.atualizar, cor: "pinho", tom: rodadasPuladas ? "alerta" : undefined }),
      ]),
      tabelaDeDados({
        colunas: [
          { rotulo: "Checklist", principal: true },
          { rotulo: "Dia", largura: "120px" },
          { rotulo: "Quem fez", largura: "16%" },
          { rotulo: "Rodadas", largura: "150px" },
          { rotulo: "Alertas da IA", largura: "130px" },
          { rotulo: "Situação", largura: "150px" },
        ],
        larguraMinima: "860px",
        linhas: runs.map((r) => {
          const [rotulo, variante] = STATUS[r.status] ?? [r.status, ""];
          const alertas = alertasDe(r);
          return {
            aoClicar: () => abrir(r.id),
            classe: alertas > 0 ? "linha-atencao" : "",
            celulas: [
              r.checklist_nome,
              dataCurta(r.scheduled_for),
              r.executor_nome || el("span", { classe: "muted", texto: "—" }),
              // Checklist de rodadas: "9 de 11" é o que se lê na linha, sem
              // abrir — e é o número que diz se a noite foi bem cuidada.
              r.rodadas_previstas
                ? etiqueta(
                    `${r.rodadas_feitas} de ${r.rodadas_previstas}`,
                    r.rodadas_feitas === r.rodadas_previstas ? "etiqueta-ok" : r.status === "concluida" ? "etiqueta-alerta" : "",
                  )
                : el("span", { classe: "muted", texto: "—" }),
              alertas > 0 ? etiqueta(`${alertas} ${alertas === 1 ? "alerta" : "alertas"}`, "etiqueta-alerta") : el("span", { classe: "muted", texto: "nenhum" }),
              etiqueta(rotulo, variante),
            ],
          };
        }),
      }),
    );
  }

  async function abrir(id) {
    ctx.definirAcoes?.();
    lista.hidden = true;
    detalhe.hidden = false;
    limpar(detalhe).append(esqueleto({ linhas: 5 }));
    let r;
    try {
      r = await get(`/v1/checklist-runs/${id}?venue=${encodeURIComponent(ctx.venue)}`);
    } catch (e) {
      avisar(e.message, "erro");
      desenharLista();
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
          botaoVoltar(desenharLista, "Checklists feitos"),
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
