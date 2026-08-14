import { del, get, post } from "../api.js";
import { avisar, dataHora, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

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

  raiz.append(
    el("div", { classe: "pilha" }, [
      form,
      el("section", {}, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Agenda" }),
            el("p", { classe: "muted", texto: "O agente cita estes itens quando o cliente pergunta." }),
          ]),
        ]),
        lista,
      ]),
    ]),
  );

  await carregarEventos();

  async function carregarEventos() {
    limpar(lista).append(el("p", { classe: "muted", texto: "Carregando…" }));
    const eventos = await get(`/v1/venues/${ctx.venue}/events`);
    limpar(lista);

    if (eventos.length === 0) {
      lista.append(vazio("Nada cadastrado", "Sem programação, o agente não tem o que contar da casa."));
      return;
    }

    const { solos, series } = agruparPorSerie(eventos);
    for (const ev of solos) lista.append(cartaoSolo(ev));
    for (const ocorrencias of series.values()) lista.append(cartaoSerie(ocorrencias));
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
