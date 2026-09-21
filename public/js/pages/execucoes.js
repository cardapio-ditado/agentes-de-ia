import { get } from "../api.js";
import { avisar, dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

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
  const lista = el("div", { classe: "lista" });
  const detalhe = el("div", {});

  raiz.append(
    el("div", { classe: "pilha" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Execuções" }),
          el("p", { classe: "muted", texto: "Cada linha é um checklist disparado — clique para abrir." }),
        ]),
        el("button", { classe: "btn btn-peq", type: "button", texto: "Recarregar", onclick: carregar }),
      ]),
      lista,
      detalhe,
    ]),
  );

  await carregar();

  async function carregar() {
    limpar(lista).append(el("p", { classe: "muted", texto: "Carregando…" }));
    limpar(detalhe);
    const runs = await get(`/v1/venues/${ctx.venue}/checklist-runs`);
    limpar(lista);

    if (runs.length === 0) {
      lista.append(
        vazio("Nenhuma execução ainda", 'Crie um checklist e clique em "Disparar agora" para testar.'),
      );
      return;
    }

    for (const r of runs) {
      const [rotulo, variante] = STATUS[r.status] ?? [r.status, ""];
      const alertas = Array.isArray(r.alertas_ia) ? r.alertas_ia.length : 0;
      lista.append(
        el(
          "button",
          {
            classe: "cartao cartao-clicavel",
            type: "button",
            style: "text-align:left;width:100%;font:inherit;color:inherit;cursor:pointer",
            onclick: () => abrir(r.id),
          },
          [
            el("div", { classe: "cabecalho-secao" }, [
              el("div", {}, [
                el("h3", { texto: r.checklist_nome }),
                el("p", {
                  classe: "muted",
                  texto: `${dataCurta(r.scheduled_for)}${r.executor_nome ? ` · por ${r.executor_nome}` : ""}`,
                }),
              ]),
              el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" }, [
                // Checklist de rodadas: "9 de 11" é o que se lê na linha, sem
                // abrir — e é o número que diz se a noite foi bem cuidada.
                r.rodadas_previstas
                  ? etiqueta(
                      `${r.rodadas_feitas} de ${r.rodadas_previstas} rodadas`,
                      r.rodadas_feitas === r.rodadas_previstas ? "etiqueta-ok" : r.status === "concluida" ? "etiqueta-alerta" : "",
                    )
                  : null,
                alertas > 0 ? etiqueta(`${alertas} alerta(s)`, "etiqueta-alerta") : null,
                etiqueta(rotulo, variante),
              ]),
            ]),
          ],
        ),
      );
    }
  }

  async function abrir(id) {
    limpar(detalhe).append(el("p", { classe: "muted", texto: "Abrindo execução…" }));
    let r;
    try {
      r = await get(`/v1/checklist-runs/${id}?venue=${encodeURIComponent(ctx.venue)}`);
    } catch (e) {
      avisar(e.message, "erro");
      limpar(detalhe);
      return;
    }

    const itens = r.checklist?.items ?? [];
    const respostas = new Map((r.answers ?? []).map((a) => [a.item, a]));
    const alertas = Array.isArray(r.alertas_ia) ? r.alertas_ia : [];

    limpar(detalhe).append(
      el("section", { classe: "cartao", style: "margin-top:6px" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: r.checklist?.name ?? "Execução" }),
            el("p", {
              classe: "muted",
              texto: [
                dataCurta(r.scheduled_for),
                r.executor_nome ? `por ${r.executor_nome}` : null,
                r.completed_at ? `concluída em ${dataHora(r.completed_at)}` : null,
              ]
                .filter(Boolean)
                .join(" · "),
            }),
          ]),
          etiqueta(...(STATUS[r.status] ?? [r.status, ""])),
        ]),

        r.resumo_ia
          ? el("div", { classe: "cartao", style: "margin:10px 0;padding:12px" }, [
              el("strong", { texto: "Resumo da IA" }),
              el("p", { classe: "muted", style: "margin:4px 0 0", texto: r.resumo_ia }),
            ])
          : null,

        alertas.length > 0
          ? el("div", { classe: "cartao alerta", style: "margin:10px 0;padding:12px" }, [
              el("strong", { texto: "Pontos de atenção" }),
              el(
                "ul",
                { style: "margin:6px 0 0;padding-left:18px;line-height:1.7" },
                alertas.map((a) => el("li", { texto: String(a) })),
              ),
            ])
          : null,

        Array.isArray(r.rodadas) && r.rodadas.length > 0
          ? el("div", { classe: "pilha", style: "gap:10px;margin-top:10px" }, r.rodadas.map((rod) => blocoRodada(rod, itens)))
          : r.status === "concluida"
          ? el(
              "div",
              { classe: "pilha", style: "gap:8px;margin-top:10px" },
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
    detalhe.scrollIntoView({ behavior: "smooth", block: "start" });
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
