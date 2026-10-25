import { del, get, post, put } from "../api.js";
import { avisar, dinheiro, el, etiqueta, indicador, limpar, vazio } from "../ui.js";
import { botaoDePdf, imprimirRelatorio } from "../relatorio.js";

/**
 * RH — Indicadores: os números de gente, o clima e quem pode estar saindo.
 *
 * O dono de bar sente a rotatividade no bolso e não no número: "sempre tem
 * gente nova". Aqui ela vira número (quantos saíram, quanto custou, quantos
 * saíram ainda na experiência) — e, ao lado, o que dá para fazer antes: o
 * clima da equipe e quem está dando sinal.
 */
export function criarIndicadores(corpo, ctx) {
  return { recarregar };

  async function recarregar() {
    limpar(corpo).append(el("p", { classe: "muted", texto: "Calculando…" }));
    let ind, clima;
    try {
      [ind, clima] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/rh/indicadores`),
        get(`/v1/venues/${ctx.venue}/rh/clima`).catch(() => ({ perguntas: [], rodadas: [] })),
      ]);
    } catch (e) {
      limpar(corpo).append(vazio("Indicadores indisponíveis", e.message));
      return;
    }
    const ultimoClima = clima.rodadas.find((r) => r.visivel) ?? null;
    const anosEMeses = (dias) => (dias === null ? "—" : dias < 365 ? `${Math.round(dias / 30)} meses` : `${(dias / 365).toFixed(1).replace(".", ",")} anos`);

    limpar(corpo).append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Indicadores de gente" }),
          el("p", { classe: "muted", texto: "Os últimos 12 meses. Os números saem das fichas, da escala e das ocorrências registradas." }),
        ]),
        botaoDePdf(() => relatorio(ind, clima), "Relatório em PDF"),
      ]),
      el("div", { classe: "grade" }, [
        indicador({ rotulo: "Na casa", valor: String(ind.na_casa), nota: `tempo médio de casa: ${anosEMeses(ind.tempo_medio_de_casa_dias)}` }),
        indicador({ rotulo: "Saídas em 12 meses", valor: String(ind.saidas_12m), nota: ind.turnover_12m === null ? "" : `${String(ind.turnover_12m).replace(".", ",")}% da equipe`, destaque: ind.saidas_12m > ind.na_casa / 2 }),
        indicador({ rotulo: "Saíram na experiência", valor: String(ind.saidas_na_experiencia_12m), nota: "em até 90 dias — sinal de contratação ou integração", destaque: ind.saidas_na_experiencia_12m > 0 }),
        indicador({ rotulo: "Custo da rotatividade", valor: ind.custo_estimado_12m === null ? "—" : dinheiro(ind.custo_estimado_12m), nota: "estimativa: cerca de um salário por saída" }),
      ]),
      cartaoDoRisco(ind.risco),
      cartaoDoClima(clima, ultimoClima),
      cartaoDosMeses(ind.meses),
      ind.motivos.length
        ? el("section", { classe: "cartao pilha" }, [
            el("h3", { texto: "Por que saíram" }),
            el("div", { classe: "tabela" }, ind.motivos.map((m) => el("div", { classe: "linha-tabela" }, [el("span", { texto: m.motivo }), el("strong", { texto: String(m.vezes) })]))),
            el("p", { classe: "muted", texto: "Anote o motivo no desligamento: é daqui que sai o que mudar." }),
          ])
        : null,
    );
  }

  function cartaoDoRisco(risco) {
    return el("section", { classe: `cartao pilha${risco.some((r) => r.nivel === "alto") ? " cartao-atencao" : ""}` }, [
      el("div", {}, [
        el("h3", { texto: "Quem pode estar para sair" }),
        el("p", { classe: "muted", texto: "Sinais que costumam vir antes do pedido de demissão. Uma conversa agora sai mais barato que contratar de novo." }),
      ]),
      risco.length
        ? el("div", { classe: "tabela" }, risco.map((r) =>
            el("div", { classe: "linha-tabela" }, [
              el("div", { classe: "linha-principal", style: "flex:1;min-width:0" }, [
                el("strong", { texto: `${r.nome}${r.funcao ? ` · ${r.funcao}` : ""}` }),
                el("span", { classe: "muted", style: "white-space:normal", texto: r.sinais.join(" · ") }),
              ]),
              etiqueta(r.nivel === "alto" ? "conversar já" : "ficar de olho", r.nivel === "alto" ? "etiqueta-perigo" : "etiqueta-alerta"),
            ])))
        : el("p", { classe: "muted", texto: "Ninguém com sinal agora. 👍" }),
    ]);
  }

  function cartaoDoClima(clima, ultimo) {
    const nomes = Object.fromEntries(clima.perguntas.map((p) => [p.id, p.texto]));
    return el("section", { classe: "cartao pilha" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: "Clima da equipe" }),
          el("p", { classe: "muted", texto: "Pesquisa anônima de um minuto pelo WhatsApp. O resultado só aparece com 3 respostas ou mais." }),
        ]),
        el("button", {
          classe: "btn btn-primario btn-peq",
          type: "button",
          texto: "Mandar a pesquisa do mês",
          onclick: async (e) => {
            if (!confirm("Mandar a pesquisa de clima deste mês no WhatsApp de cada um da equipe?")) return;
            e.target.disabled = true;
            try {
              const r = await post(`/v1/venues/${ctx.venue}/rh/clima`, {});
              avisar(`Pesquisa enviada para ${r.enviados} pessoa(s).${r.sem_telefone.length ? ` Sem WhatsApp na ficha: ${r.sem_telefone.join(", ")}.` : ""}`, "ok");
              await recarregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      ]),
      ultimo
        ? el("div", { classe: "pilha" }, [
            el("div", { classe: "grade" }, [
              indicador({ rotulo: `eNPS de ${ultimo.mes.split("-").reverse().join("/")}`, valor: String(ultimo.enps), nota: `${ultimo.respostas} de ${ultimo.convidados} responderam · de −100 a 100`, destaque: ultimo.enps < 0 }),
              ...Object.entries(ultimo.notas ?? {}).map(([id, n]) => indicador({ rotulo: nomes[id] ?? id, valor: n === null ? "—" : `${String(n).replace(".", ",")} / 5`, destaque: n !== null && n < 3 })),
            ]),
            ultimo.comentarios.length
              ? el("div", { classe: "tabela" }, ultimo.comentarios.map((c) => el("div", { classe: "linha-tabela" }, [el("span", { style: "white-space:normal", texto: `“${c}”` })])))
              : null,
          ])
        : el("p", { classe: "muted", texto: clima.rodadas.length ? `A pesquisa de ${clima.rodadas[0].mes.split("-").reverse().join("/")} tem ${clima.rodadas[0].respostas} resposta(s) — aparece com 3.` : "Nenhuma pesquisa ainda." }),
      clima.rodadas.length > 1
        ? el("p", { classe: "muted", texto: `Evolução do eNPS: ${clima.rodadas.filter((r) => r.visivel).reverse().map((r) => `${r.mes.slice(5)}/${r.mes.slice(2, 4)}: ${r.enps}`).join(" · ") || "—"}` })
        : null,
    ]);
  }

  function cartaoDosMeses(meses) {
    return el("section", { classe: "cartao pilha" }, [
      el("h3", { texto: "Mês a mês" }),
      el("div", { classe: "rolagem-x" }, [
        el("table", { classe: "planilha" }, [
          el("thead", {}, [el("tr", {}, ["Mês", "Na casa", "Entraram", "Saíram", "Rotatividade", "Faltas", "Atrasos"].map((t, i) => el("th", { classe: i ? "col-num" : "", texto: t })))]),
          el("tbody", {}, meses.map((m) =>
            el("tr", {}, [
              el("td", { texto: `${m.mes.slice(5)}/${m.mes.slice(0, 4)}` }),
              el("td", { classe: "col-num", texto: String(m.ativos) }),
              el("td", { classe: "col-num", texto: String(m.admissoes) }),
              el("td", { classe: "col-num", texto: String(m.desligamentos) }),
              el("td", { classe: "col-num", texto: m.turnover === null ? "—" : `${String(m.turnover).replace(".", ",")}%` }),
              el("td", { classe: "col-num", texto: String(m.faltas) }),
              el("td", { classe: "col-num", texto: String(m.atrasos) }),
            ]))),
        ]),
      ]),
    ]);
  }

  function relatorio(ind, clima) {
    const ultimo = clima.rodadas.find((r) => r.visivel) ?? null;
    imprimirRelatorio({
      tipo: "RH",
      titulo: "Indicadores de gente",
      periodo: "últimos 12 meses",
      selos: [
        { valor: String(ind.na_casa), rotulo: "na casa" },
        { valor: String(ind.saidas_12m), rotulo: "saídas em 12 meses", ruim: ind.saidas_12m > ind.na_casa / 2 },
        { valor: String(ind.saidas_na_experiencia_12m), rotulo: "saíram na experiência", ruim: ind.saidas_na_experiencia_12m > 0 },
        { valor: ultimo ? String(ultimo.enps) : "—", rotulo: "eNPS (clima)" },
      ],
      secoes: [
        {
          titulo: "Mês a mês",
          colunas: [{ rotulo: "Mês" }, { rotulo: "Na casa", num: true }, { rotulo: "Entraram", num: true }, { rotulo: "Saíram", num: true }, { rotulo: "Rotatividade", num: true }, { rotulo: "Faltas", num: true }, { rotulo: "Atrasos", num: true }],
          linhas: ind.meses.map((m) => [`${m.mes.slice(5)}/${m.mes.slice(0, 4)}`, String(m.ativos), String(m.admissoes), String(m.desligamentos), m.turnover === null ? "—" : `${String(m.turnover).replace(".", ",")}%`, String(m.faltas), String(m.atrasos)]),
        },
        ind.risco.length
          ? { titulo: "Quem pode estar para sair", colunas: [{ rotulo: "Pessoa" }, { rotulo: "Sinais" }], linhas: ind.risco.map((r) => ({ destaque: r.nivel === "alto", celulas: [r.nome, r.sinais.join(" · ")] })) }
          : null,
        ind.motivos.length ? { titulo: "Por que saíram", colunas: [{ rotulo: "Motivo" }, { rotulo: "Vezes", num: true }], linhas: ind.motivos.map((m) => [m.motivo, String(m.vezes)]) } : null,
        ind.custo_estimado_12m !== null ? { nota: `Custo estimado da rotatividade nos 12 meses: ${dinheiro(ind.custo_estimado_12m)} (cerca de um salário por saída: anúncio, treino, ritmo perdido e rescisão).` } : null,
      ],
      arquivo: "rh-indicadores",
    });
  }
}

/**
 * RH — Contratação: os candidatos que chegam pelo link "Trabalhe conosco",
 * e a lista de extras de fim de semana, com a nota de como foi.
 */
export function criarContratacao(corpo, ctx) {
  let filtro = "vaga";
  return { recarregar };

  async function recarregar() {
    limpar(corpo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let dados;
    try {
      dados = await get(`/v1/venues/${ctx.venue}/rh/candidatos`);
    } catch (e) {
      limpar(corpo).append(vazio("Contratação indisponível", e.message));
      return;
    }
    const lista = dados.candidatos.filter((c) => c.tipo === filtro);
    const NOME_DA_SITUACAO = { novo: "novo", conversando: "conversando", contratado: "contratado", nao_serve: "não serve", disponivel: "disponível" };

    limpar(corpo).append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Contratação" }),
          el("p", { classe: "muted", texto: "Ponha o link no Instagram e no balcão: quem quer trabalhar na casa cai aqui." }),
        ]),
        el("div", { classe: "reserva-acoes" }, [
          el("button", {
            classe: "btn btn-peq",
            type: "button",
            texto: "Copiar link do Trabalhe conosco",
            onclick: async () => {
              await navigator.clipboard?.writeText(dados.link).catch(() => {});
              prompt("Link copiado:", dados.link);
            },
          }),
          el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: filtro === "extra" ? "+ Extra" : "+ Candidato", onclick: () => formulario(null) }),
        ]),
      ]),
      el("div", { classe: "abas" }, [["vaga", "Candidatos a vaga"], ["extra", "Lista de extras"]].map(([id, rotulo]) =>
        el("button", { classe: `aba${filtro === id ? " aba-ativa" : ""}`, type: "button", texto: `${rotulo} (${dados.candidatos.filter((c) => c.tipo === id).length})`, onclick: () => { filtro = id; recarregar(); } }))),
      lista.length
        ? el("div", { classe: "tabela" }, lista.map((c) =>
            el("div", { classe: "linha-tabela" }, [
              el("div", { classe: "linha-principal", style: "flex:1;min-width:0" }, [
                el("strong", { texto: `${c.nome}${c.funcao ? ` · ${c.funcao}` : ""}` }),
                el("span", { classe: "muted", style: "white-space:normal", texto: [c.nota ? `${"★".repeat(c.nota)} da última vez` : null, c.ultima_vez ? `última vez ${c.ultima_vez.split("-").reverse().join("/")}` : null, c.experiencia, c.observacoes].filter(Boolean).join(" · ") || (c.origem === "link" ? "veio pelo link" : "") }),
              ]),
              el("div", { classe: "reserva-acoes", style: "margin:0" }, [
                etiqueta(NOME_DA_SITUACAO[c.situacao] ?? c.situacao, c.situacao === "contratado" || c.situacao === "disponivel" ? "etiqueta-ok" : c.situacao === "nao_serve" ? "" : "etiqueta-alerta"),
                c.telefone
                  ? el("a", { classe: "btn btn-peq", href: `https://wa.me/${c.telefone.length <= 11 ? `55${c.telefone}` : c.telefone}`, target: "_blank", rel: "noopener", texto: filtro === "extra" ? "Chamar" : "WhatsApp" })
                  : null,
                el("button", { classe: "btn btn-peq", type: "button", texto: "Editar", onclick: () => formulario(c) }),
                el("button", {
                  classe: "btn-icone",
                  type: "button",
                  title: "Apagar",
                  texto: "🗑",
                  onclick: async () => {
                    if (!confirm(`Apagar ${c.nome}?`)) return;
                    try {
                      await del(`/v1/venues/${ctx.venue}/rh/candidatos/${c.id}`);
                      await recarregar();
                    } catch (e) {
                      avisar(e.message, "erro");
                    }
                  },
                }),
              ]),
            ])))
        : vazio(filtro === "extra" ? "Nenhum extra na lista" : "Nenhum candidato ainda", filtro === "extra" ? "Guarde aqui quem fez extra e foi bem: no próximo sábado cheio, é só chamar." : "Mande o link do Trabalhe conosco no Instagram da casa."),
    );
  }

  function formulario(c) {
    const extra = (c?.tipo ?? filtro) === "extra";
    const nome = el("input", { classe: "input", value: c?.nome ?? "" });
    const telefone = el("input", { classe: "input", type: "tel", value: c?.telefone ?? "" });
    const funcao = el("input", { classe: "input", value: c?.funcao ?? "", placeholder: "Garçom, bar, cozinha…" });
    const situacao = el("select", { classe: "select" }, (extra ? [["disponivel", "Disponível"], ["nao_serve", "Não chamar mais"]] : [["novo", "Novo"], ["conversando", "Conversando"], ["contratado", "Contratado"], ["nao_serve", "Não serve"]]).map(([v, t]) =>
      el("option", { value: v, texto: t, selected: (c?.situacao ?? (extra ? "disponivel" : "novo")) === v })));
    const nota = el("select", { classe: "select" }, [["", "—"], ["5", "★★★★★ ótimo"], ["4", "★★★★ bom"], ["3", "★★★ ok"], ["2", "★★ fraco"], ["1", "★ ruim"]].map(([v, t]) => el("option", { value: v, texto: t, selected: String(c?.nota ?? "") === v })));
    const ultima = el("input", { classe: "input", type: "date", value: c?.ultima_vez ?? "" });
    const obs = el("textarea", { classe: "input", rows: 2, texto: c?.observacoes ?? "" });
    limpar(corpo).append(
      el("div", { classe: "cabecalho-secao" }, [
        el("h2", { texto: c ? c.nome : extra ? "Novo extra" : "Novo candidato" }),
        el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: recarregar }),
      ]),
      el("section", { classe: "cartao pilha" }, [
        el("div", { classe: "grade grade-2" }, [
          el("div", { classe: "campo" }, [el("label", { texto: "Nome" }), nome]),
          el("div", { classe: "campo" }, [el("label", { texto: "WhatsApp" }), telefone]),
          el("div", { classe: "campo" }, [el("label", { texto: "Função" }), funcao]),
          el("div", { classe: "campo" }, [el("label", { texto: "Situação" }), situacao]),
          extra ? el("div", { classe: "campo" }, [el("label", { texto: "Como foi da última vez" }), nota]) : null,
          extra ? el("div", { classe: "campo" }, [el("label", { texto: "Última vez que trabalhou" }), ultima]) : null,
        ]),
        c?.experiencia ? el("p", { classe: "muted", texto: `Experiência (contada por ele): ${c.experiencia}` }) : null,
        el("div", { classe: "campo" }, [el("label", { texto: "Observações" }), obs]),
        el("div", { classe: "reserva-acoes" }, [
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "Salvar",
            onclick: async (e) => {
              e.target.disabled = true;
              const dados = { nome: nome.value, telefone: telefone.value, funcao: funcao.value, tipo: extra ? "extra" : "vaga", situacao: situacao.value, nota: extra ? nota.value : null, ultima_vez: extra ? ultima.value : null, observacoes: obs.value, experiencia: c?.experiencia ?? null };
              try {
                if (c) await put(`/v1/venues/${ctx.venue}/rh/candidatos/${c.id}`, dados);
                else await post(`/v1/venues/${ctx.venue}/rh/candidatos`, dados);
                avisar("Salvo.", "ok");
                await recarregar();
              } catch (err) {
                avisar(err.message, "erro");
                e.target.disabled = false;
              }
            },
          }),
        ]),
      ].filter(Boolean)),
    );
  }
}
