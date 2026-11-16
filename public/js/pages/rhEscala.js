import { del, get, patch, post } from "../api.js";
import { avisar, el, esqueleto, estadoDeErro, etiqueta, hojeNaCasa, limpar, navegadorDePeriodo, plural, vazio } from "../ui.js";

/**
 * RH — Fase 2: a grade da semana.
 *
 * Uma tabela: pessoas nas linhas, os sete dias nas colunas. Clicar numa
 * célula abre o editor daquele dia daquela pessoa — turno, folga, férias,
 * atestado. Publicar manda para cada um o horário DELE no WhatsApp, não a
 * foto da grade inteira.
 *
 * Enquanto não publica, é rascunho: dá para montar a semana aos poucos sem
 * incomodar ninguém.
 */

const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

const SITUACOES = [
  ["trabalha", "Trabalha"],
  ["folga", "Folga"],
  ["ferias", "Férias"],
  ["atestado", "Atestado"],
  ["falta", "Falta"],
];

const COR_DA_SITUACAO = {
  folga: "",
  ferias: "etiqueta-ok",
  atestado: "etiqueta-alerta",
  falta: "etiqueta-alerta",
};

/** Turnos que quase toda casa tem. Só sugestão: dá para apagar e criar outros. */
const TURNOS_SUGERIDOS = [
  { nome: "Almoço", inicio: "11:00", fim: "15:00", ordem: 1 },
  { nome: "Noite", inicio: "18:00", fim: "00:00", ordem: 2 },
  { nome: "Fechamento", inicio: "22:00", fim: "04:00", ordem: 3 },
];

export function criarEscala(corpo, ctx) {
  let semana = null; // segunda-feira em ISO; null = deixa o servidor decidir
  let dados = null;
  let editando = null; // { atendenteId, data }
  let mostrandoTurnos = false;

  return { desenhar, recarregar };

  async function recarregar() {
    if (!dados) limpar(corpo).append(esqueleto({ linhas: 6 }));
    try {
      const busca = semana ? `?semana=${semana}` : "";
      dados = await get(`/v1/venues/${ctx.venue}/rh/escala${busca}`);
      semana = dados.semana;
    } catch (e) {
      ctx.definirAcoes?.();
      limpar(corpo).append(estadoDeErro("Não deu para carregar a escala", e.message, recarregar));
      return;
    }
    desenhar();
  }

  function desenhar() {
    if (!dados) {
      void recarregar();
      return;
    }
    // Uma pilha só: o espaço entre os blocos vem dela.
    const pilha = el("div", { classe: "pilha" });
    limpar(corpo).append(pilha);
    pilha.append(cabecalhoDaSemana());

    if (mostrandoTurnos) pilha.append(painelDeTurnos());

    if (dados.turnos.length === 0) {
      pilha.append(
        el("section", { classe: "cartao alerta" }, [
          el("strong", { texto: "Antes da escala, os turnos da casa" }),
          el("p", {
            classe: "muted",
            texto: "Cada casa tem os seus horários. Crie os turnos uma vez e eles servem para todas as semanas.",
          }),
          el("div", { classe: "reserva-acoes" }, [
            el("button", {
              classe: "btn btn-primario",
              type: "button",
              texto: "Criar turnos sugeridos",
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  for (const t of TURNOS_SUGERIDOS) {
                    await post(`/v1/venues/${ctx.venue}/rh/turnos`, t);
                  }
                  avisar("Turnos criados. Ajuste os horários se precisar.", "ok");
                  await recarregar();
                } catch (err) {
                  avisar(err.message, "erro");
                  e.target.disabled = false;
                }
              },
            }),
            el("button", {
              classe: "btn",
              type: "button",
              texto: "Criar do meu jeito",
              onclick: () => {
                mostrandoTurnos = true;
                desenhar();
              },
            }),
          ]),
        ]),
      );
      return;
    }

    if (dados.pessoas.length === 0) {
      pilha.append(
        vazio("Ninguém para escalar", 'Cadastre a equipe na aba "Equipe" e volte aqui para montar a semana.'),
      );
      return;
    }

    const alertas = cartaoDeAlertas();
    if (alertas) pilha.append(alertas);
    pilha.append(grade());
    if (editando) pilha.append(editorDaCelula());
  }

  /**
   * O que conferir antes de publicar: sétimo dia seguido, descanso curto,
   * semana acima de 44h, menor à noite.
   *
   * Fica ACIMA da grade, e não num canto: quem monta a escala com pressa só
   * lê o que está no caminho do botão de publicar. É aviso, não trava — a
   * regra de cada casa (convenção, 12x36, banco de horas) pode ser outra, e
   * quem sabe disso é o gestor com a contabilidade.
   */
  function cartaoDeAlertas() {
    const lista = dados.alertas ?? [];
    if (!lista.length) return null;
    return el("section", { classe: "cartao alerta" }, [
      el("strong", {
        texto: lista.length === 1 ? "1 ponto para conferir antes de publicar" : `${lista.length} pontos para conferir antes de publicar`,
      }),
      el(
        "ul",
        { style: "padding-left:18px;line-height:1.5;margin:8px 0" },
        lista.map((a) => el("li", { style: "margin-bottom:6px", texto: a.texto })),
      ),
      el("p", {
        classe: "muted",
        style: "margin:0",
        texto: "É um aviso, não uma trava: você pode publicar assim mesmo. A regra da sua casa pode ser diferente (convenção coletiva, 12x36, banco de horas) — na dúvida, confira com a contabilidade.",
      }),
    ]);
  }

  /* ================= Cabeçalho: semana, status, ações ================= */

  function cabecalhoDaSemana() {
    const fim = somarDias(dados.semana, 6);
    const publicada = Boolean(dados.publicada_em);

    // O que se faz com a semana inteira vai para o cabeçalho da página.
    ctx.definirAcoes?.(
      el("button", {
        classe: "btn",
        type: "button",
        "aria-expanded": String(mostrandoTurnos),
        texto: mostrandoTurnos ? "Fechar turnos" : "Turnos da casa",
        onclick: () => {
          mostrandoTurnos = !mostrandoTurnos;
          desenhar();
        },
      }),
      el("button", {
        classe: "btn",
        type: "button",
        texto: "Copiar semana anterior",
        onclick: (e) => copiarAnterior(e.target),
      }),
      el("button", {
        classe: "btn btn-primario",
        type: "button",
        texto: publicada ? "Publicar de novo e avisar" : "Publicar e avisar no WhatsApp",
        onclick: (e) => publicar(e.target),
      }),
    );

    return el("div", { classe: "pilha-fina" }, [
      el("div", { classe: "barra-periodo" }, [
        navegadorDePeriodo({
          titulo: `Semana de ${diaBr(dados.semana)} a ${diaBr(fim)}`,
          aoVoltar: () => trocarSemana(-7),
          aoAvancar: () => trocarSemana(7),
          rotuloAtual: "Esta semana",
          aoIrParaAtual: () => trocarSemana(null),
        }),
        publicada && dados.mudou_depois_de_publicar
          ? etiqueta("mudou depois de publicar", "etiqueta-alerta")
          : publicada
            ? etiqueta("publicada", "etiqueta-ok")
            : etiqueta("rascunho", ""),
      ]),
      el("p", { classe: "muted", texto: textoDoStatus() }),
    ]);
  }

  function textoDoStatus() {
    if (!dados.publicada_em) {
      return "Rascunho: ninguém foi avisado ainda. Monte a semana e publique quando estiver pronta.";
    }
    const quando = new Date(dados.publicada_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    const quem = dados.publicada_por ? ` por ${dados.publicada_por}` : "";
    const base = `Publicada em ${quando}${quem} · ${plural(dados.avisos_enviados, "aviso enviado", "avisos enviados")}.`;
    return dados.mudou_depois_de_publicar
      ? `${base} A grade mudou depois disso — publique de novo para a equipe saber.`
      : base;
  }

  function trocarSemana(dias) {
    semana = dias === null ? null : somarDias(dados.semana, dias);
    editando = null;
    void recarregar();
  }

  async function publicar(botao) {
    // Com alerta na tela, publicar pede um "sim" consciente — e só isso:
    // quem decide é o gestor.
    const pontos = (dados.alertas ?? []).length;
    if (
      pontos &&
      !confirm(
        `Esta semana tem ${pontos} ${pontos === 1 ? "ponto" : "pontos"} para conferir (folga, descanso ou horas) — a lista está acima da grade.\n\nPublicar e avisar a equipe assim mesmo?`,
      )
    ) {
      return;
    }
    botao.disabled = true;
    try {
      const r = await post(`/v1/venues/${ctx.venue}/rh/escala/publicar`, { semana: dados.semana });
      const partes = [`${plural(r.avisados, "aviso", "avisos")} na fila do WhatsApp.`];
      if (r.alertas) partes.push(`Publicada com ${plural(r.alertas, "ponto", "pontos")} de descanso para conferir.`);
      if (r.sem_telefone.length) {
        partes.push(`Sem telefone na ficha: ${r.sem_telefone.join(", ")}.`);
      }
      if (r.sem_escala) partes.push(`${plural(r.sem_escala, "pessoa", "pessoas")} sem nenhum dia nesta semana.`);
      avisar(partes.join(" "), r.sem_telefone.length ? "info" : "ok");
      await recarregar();
    } catch (e) {
      avisar(e.message, "erro");
      botao.disabled = false;
    }
  }

  async function copiarAnterior(botao) {
    botao.disabled = true;
    try {
      const r = await post(`/v1/venues/${ctx.venue}/rh/escala/copiar`, {
        de: somarDias(dados.semana, -7),
        para: dados.semana,
      });
      avisar(
        r.copiadas
          ? `${plural(r.copiadas, "lançamento copiado", "lançamentos copiados")}${r.ignoradas ? `, ${plural(r.ignoradas, "já existia", "já existiam")}` : ""}.`
          : "Nada a copiar: esta semana já tem tudo que a anterior tinha.",
        "ok",
      );
      await recarregar();
    } catch (e) {
      avisar(e.message, "erro");
    } finally {
      botao.disabled = false;
    }
  }

  /* ================= A grade ================= */

  function linhasDe(atendenteId, data) {
    return dados.linhas.filter((l) => l.atendente_id === atendenteId && l.data === data);
  }

  function turnoPorId(id) {
    return dados.turnos.find((t) => t.id === id) ?? null;
  }

  function grade() {
    return el("div", { classe: "rolagem-x" }, [
      el("table", { classe: "planilha" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { texto: "Pessoa" }),
            ...dados.dias.map((dia, i) =>
              // O dia de hoje ganha marca: é por ele que se começa a ler a semana.
              el("th", { classe: dia === hojeNaCasa() ? "coluna-hoje" : null, "aria-current": dia === hojeNaCasa() ? "date" : null }, [
                document.createTextNode(DIAS[i]),
                el("small", { classe: "muted", texto: diaBr(dia).slice(0, 5) }),
              ]),
            ),
          ]),
        ]),
        el(
          "tbody",
          {},
          dados.pessoas.map((pessoa) =>
            el("tr", {}, [
              el("td", {}, [
                el("strong", { texto: pessoa.apelido || pessoa.nome }),
                pessoa.funcao ? el("small", { classe: "muted", texto: pessoa.funcao }) : null,
              ]),
              ...dados.dias.map((dia) => celula(pessoa, dia)),
            ]),
          ),
        ),
      ]),
    ]);
  }

  function celula(pessoa, dia) {
    const minhas = linhasDe(pessoa.id, dia);
    const aberta = editando && editando.atendenteId === pessoa.id && editando.data === dia;

    const abrir = () => {
      editando = aberta ? null : { atendenteId: pessoa.id, data: dia };
      desenhar();
      if (!aberta) corpo.querySelector(".editor-escala")?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    return el(
      "td",
      {
        // A célula é o botão de lançar: recebe foco e responde ao teclado.
        classe: `escala-celula${aberta ? " escala-celula-aberta" : ""}${dia === hojeNaCasa() ? " coluna-hoje" : ""}`,
        tabindex: "0",
        role: "button",
        "aria-label": `${pessoa.apelido || pessoa.nome}, ${diaBr(dia)}: lançar ou mudar`,
        "aria-expanded": String(Boolean(aberta)),
        onclick: abrir,
        onkeydown: (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          abrir();
        },
      },
      minhas.length === 0
        ? [el("span", { classe: "muted", texto: "—" })]
        : minhas.map((linha) => {
            if (linha.situacao !== "trabalha") {
              const rotulo = SITUACOES.find(([id]) => id === linha.situacao)?.[1] ?? linha.situacao;
              return etiqueta(rotulo, COR_DA_SITUACAO[linha.situacao] ?? "");
            }
            const turno = turnoPorId(linha.turno_id);
            return el("div", {}, [
              el("strong", { texto: turno ? turno.nome : "Turno" }),
              el("small", {
                classe: "muted",
                texto: [turno ? `${horaCurta(turno.inicio)}–${horaCurta(turno.fim)}` : null, linha.funcao]
                  .filter(Boolean)
                  .join(" · "),
              }),
            ]);
          }),
    );
  }

  /* ================= Editor de uma célula ================= */

  function editorDaCelula() {
    const pessoa = dados.pessoas.find((p) => p.id === editando.atendenteId);
    const dia = editando.data;
    const minhas = linhasDe(editando.atendenteId, dia);

    const situacao = el(
      "select",
      { classe: "select", onchange: () => (linhaDoTurno.hidden = situacao.value !== "trabalha") },
      SITUACOES.map(([id, nome]) => el("option", { value: id, texto: nome })),
    );
    const turno = el(
      "select",
      { classe: "select" },
      dados.turnos
        .filter((t) => t.ativo)
        .map((t) => el("option", { value: t.id, texto: `${t.nome} (${horaCurta(t.inicio)}–${horaCurta(t.fim)})` })),
    );
    const funcao = el("input", {
      classe: "input",
      type: "text",
      placeholder: pessoa?.funcao || "Mesma função de sempre",
    });
    const observacao = el("input", { classe: "input", type: "text", placeholder: "Recado do dia (opcional)" });

    const linhaDoTurno = el("div", { classe: "campo" }, [el("label", { texto: "Turno" }), turno]);

    return el("section", { classe: "cartao editor-escala" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          // Só `||`: misturar `||` com `??` sem parênteses é erro de sintaxe
          // no navegador, e derruba a tela inteira em silêncio.
          el("h3", { texto: `${pessoa?.apelido || pessoa?.nome || "Pessoa"} · ${diaBr(dia)}` }),
          el("p", { classe: "muted", texto: "O que essa pessoa faz neste dia." }),
        ]),
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Fechar",
          onclick: () => {
            editando = null;
            desenhar();
          },
        }),
      ]),

      // O que já está lançado neste dia — inclusive dois turnos (almoço e noite).
      minhas.length
        ? el(
            "div",
            { classe: "tabela" },
            minhas.map((linha) => {
              const t = turnoPorId(linha.turno_id);
              const rotulo =
                linha.situacao === "trabalha"
                  ? `${t ? t.nome : "Turno"}${linha.funcao ? ` · ${linha.funcao}` : ""}`
                  : (SITUACOES.find(([id]) => id === linha.situacao)?.[1] ?? linha.situacao);
              return el("div", { classe: "linha-tabela" }, [
                el("div", { classe: "linha-principal", style: "flex:1" }, [
                  el("strong", { texto: rotulo }),
                  linha.observacao ? el("span", { classe: "muted", texto: linha.observacao }) : null,
                ]),
                el("button", {
                  classe: "btn btn-peq btn-perigo",
                  type: "button",
                  texto: "Tirar",
                  onclick: async (e) => {
                    e.target.disabled = true;
                    try {
                      await del(`/v1/venues/${ctx.venue}/rh/escala/${linha.id}`);
                      avisar("Tirado da escala.", "ok");
                      await recarregar();
                    } catch (err) {
                      avisar(err.message, "erro");
                      e.target.disabled = false;
                    }
                  },
                }),
              ]);
            }),
          )
        : null,

      el("div", { classe: "grade" }, [
        el("div", { classe: "campo" }, [el("label", { texto: "Situação" }), situacao]),
        linhaDoTurno,
        el("div", { classe: "campo" }, [el("label", { texto: "Função no dia" }), funcao]),
        el("div", { classe: "campo" }, [el("label", { texto: "Observação" }), observacao]),
      ]),

      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: minhas.length ? "Adicionar neste dia" : "Lançar",
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await post(`/v1/venues/${ctx.venue}/rh/escala`, {
                data: dia,
                atendente_id: editando.atendenteId,
                turno_id: situacao.value === "trabalha" ? turno.value : null,
                situacao: situacao.value,
                funcao: funcao.value,
                observacao: observacao.value,
              });
              avisar("Escala salva.", "ok");
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

  /* ================= Turnos da casa ================= */

  function painelDeTurnos() {
    const nome = el("input", { classe: "input", type: "text", placeholder: "Noite" });
    const inicio = el("input", { classe: "input", type: "time", value: "18:00" });
    const fim = el("input", { classe: "input", type: "time", value: "00:00" });

    return el("section", { classe: "cartao" }, [
      el("h3", { texto: "Turnos da casa" }),
      el("p", {
        classe: "muted",
        texto: "Turno que termina antes de começar atravessa a meia-noite — é o normal em bar, e a grade entende assim.",
      }),
      dados.turnos.length
        ? el(
            "div",
            { classe: "tabela" },
            dados.turnos.map((t) =>
              el("div", { classe: "linha-tabela" }, [
                el("div", { classe: "linha-principal", style: "flex:1" }, [
                  el("strong", { texto: t.nome }),
                  el("span", {
                    classe: "muted",
                    texto: `${horaCurta(t.inicio)} → ${horaCurta(t.fim)}${t.fim < t.inicio ? " (vira o dia)" : ""}`,
                  }),
                ]),
                t.ativo ? null : etiqueta("desativado", ""),
                el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: t.ativo ? "Desativar" : "Reativar",
                  onclick: async (e) => {
                    e.target.disabled = true;
                    try {
                      await patch(`/v1/venues/${ctx.venue}/rh/turnos/${t.id}`, { ativo: !t.ativo });
                      await recarregar();
                    } catch (err) {
                      avisar(err.message, "erro");
                      e.target.disabled = false;
                    }
                  },
                }),
                el("button", {
                  classe: "btn btn-peq btn-perigo",
                  type: "button",
                  texto: "Apagar",
                  onclick: async (e) => {
                    e.target.disabled = true;
                    try {
                      const r = await del(`/v1/venues/${ctx.venue}/rh/turnos/${t.id}`);
                      avisar(
                        r.apagado
                          ? "Turno apagado."
                          : "Este turno já tem escala lançada, então foi só desativado — o histórico fica.",
                        "ok",
                      );
                      await recarregar();
                    } catch (err) {
                      avisar(err.message, "erro");
                      e.target.disabled = false;
                    }
                  },
                }),
              ]),
            ),
          )
        : null,
      el("div", { classe: "grade" }, [
        el("div", { classe: "campo" }, [el("label", { texto: "Nome" }), nome]),
        el("div", { classe: "campo" }, [el("label", { texto: "Começa" }), inicio]),
        el("div", { classe: "campo" }, [el("label", { texto: "Termina" }), fim]),
      ]),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Criar turno",
          onclick: async (e) => {
            if (!nome.value.trim()) {
              avisar("Dê um nome ao turno.", "erro");
              return;
            }
            e.target.disabled = true;
            try {
              await post(`/v1/venues/${ctx.venue}/rh/turnos`, {
                nome: nome.value.trim(),
                inicio: inicio.value,
                fim: fim.value,
                ordem: dados.turnos.length + 1,
              });
              avisar("Turno criado.", "ok");
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
}

/* ================= Miudezas ================= */

function somarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diaBr(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

function horaCurta(hora) {
  const [h, m] = String(hora ?? "").split(":");
  const hh = Number(h);
  if (!Number.isFinite(hh)) return String(hora ?? "");
  return m && m !== "00" ? `${hh}h${m}` : `${hh}h`;
}
