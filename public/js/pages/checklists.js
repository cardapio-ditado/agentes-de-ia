import { del, get, patch, post } from "../api.js";
import { avisar, el, etiqueta, limpar, vazio } from "../ui.js";

const DIAS = [
  ["seg", "Seg"],
  ["ter", "Ter"],
  ["qua", "Qua"],
  ["qui", "Qui"],
  ["sex", "Sex"],
  ["sab", "Sáb"],
  ["dom", "Dom"],
];

const TIPOS = [
  ["sim_nao", "Sim / Não"],
  ["texto", "Resposta em texto"],
  ["foto", "Foto"],
];

/**
 * Checklists: a lista dos modelos e o construtor.
 *
 * O construtor é deliberadamente simples: perguntas numa lista vertical, três
 * tipos, agenda por dias da semana. O botão de IA monta o rascunho inteiro a
 * partir de uma frase — ninguém precisa começar do zero.
 */
export async function checklists(raiz, ctx) {
  const area = el("div", { classe: "pilha" });
  raiz.append(area);
  await mostrarLista();

  // ============ Lista ============

  async function mostrarLista() {
    limpar(area).append(el("p", { classe: "muted", texto: "Carregando…" }));
    const lista = await get(`/v1/venues/${ctx.venue}/checklists`);

    limpar(area).append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Modelos de checklist" }),
          el("p", {
            classe: "muted",
            texto:
              "No horário agendado, quem executa recebe o link no WhatsApp — abre no celular, sem instalar nada.",
          }),
        ]),
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Novo checklist",
          onclick: () => mostrarEditor(null),
        }),
      ]),
    );

    if (lista.length === 0) {
      area.append(
        vazio(
          "Nenhum checklist ainda",
          'Clique em "Novo checklist" — descreva a rotina e deixe a IA montar as perguntas.',
        ),
      );
      return;
    }

    for (const c of lista) area.append(cartao(c));
  }

  function resumoAgenda(agenda) {
    const dias = (agenda?.dias ?? [])
      .map((d) => DIAS.find(([v]) => v === d)?.[1] ?? d)
      .join(", ");
    if (!dias) return "Sem agenda — só disparo manual";
    const quem = agenda.responsavel_nome ? ` → ${agenda.responsavel_nome}` : "";
    return `${dias} · ${agenda.hora}${quem}`;
  }

  function cartao(c) {
    const btnDisparar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Disparar agora",
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await post(`/v1/checklists/${c.id}/disparar?venue=${encodeURIComponent(ctx.venue)}`, {});
          avisar(
            r.criada_agora
              ? "Link enviado para o WhatsApp do responsável."
              : "A execução de hoje já existia — o link é o mesmo.",
            "ok",
          );
        } catch (err) {
          avisar(err.message, "erro");
        } finally {
          e.target.disabled = false;
        }
      },
    });

    return el("article", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", { style: "min-width:0" }, [
          el("h3", { texto: c.name }),
          el("p", { classe: "muted", texto: c.description ?? "" }),
        ]),
        etiqueta(c.active ? "Ativo" : "Pausado", c.active ? "etiqueta-ok" : ""),
      ]),
      linha("Perguntas", String((c.items ?? []).length)),
      linha("Agenda", resumoAgenda(c.schedule)),
      c.schedule?.avisar_telefone ? linha("Resumo da IA vai para", c.schedule.avisar_telefone) : null,
      el("div", { classe: "reserva-acoes" }, [
        btnDisparar,
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Editar",
          onclick: () => mostrarEditor(c),
        }),
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: c.active ? "Pausar" : "Reativar",
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await patch(`/v1/checklists/${c.id}?venue=${encodeURIComponent(ctx.venue)}`, {
                active: !c.active,
              });
              await mostrarLista();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
        el("button", {
          classe: "btn btn-perigo btn-peq",
          type: "button",
          texto: "Excluir",
          onclick: async (e) => {
            if (!confirm(`Excluir "${c.name}"? As execuções antigas somem junto.`)) return;
            e.target.disabled = true;
            try {
              await del(`/v1/checklists/${c.id}?venue=${encodeURIComponent(ctx.venue)}`);
              avisar("Checklist excluído.", "ok");
              await mostrarLista();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      ]),
    ]);
  }

  // ============ Editor ============

  function mostrarEditor(existente) {
    let itens = (existente?.items ?? []).map((i) => ({ ...i }));
    const agenda = existente?.schedule ?? {};

    const campos = {
      nome: el("input", { required: true, placeholder: "Abertura do bar", value: existente?.name ?? "" }),
      descricao: el("input", {
        placeholder: "Rotina de abertura: limpeza, freezers, caixa…",
        value: existente?.description ?? "",
      }),
      hora: el("input", { type: "time", value: agenda.hora ?? "09:00" }),
      respNome: el("input", { placeholder: "Quem executa", value: agenda.responsavel_nome ?? "" }),
      respFone: el("input", { placeholder: "WhatsApp de quem executa", value: agenda.responsavel_telefone ?? "" }),
      avisarFone: el("input", { placeholder: "WhatsApp de quem recebe o resumo", value: agenda.avisar_telefone ?? "" }),
    };

    const checksDias = DIAS.map(([valor, rotulo]) => {
      const caixa = el("input", { type: "checkbox", value: valor });
      caixa.checked = (agenda.dias ?? []).includes(valor);
      return { valor, caixa, item: el("label", { classe: "check-dia" }, [caixa, el("span", { texto: rotulo })]) };
    });

    const listaItens = el("div", { classe: "pilha", style: "gap:8px" });

    const desenharItens = () => {
      limpar(listaItens);
      if (itens.length === 0) {
        listaItens.append(
          el("p", { classe: "muted", texto: "Nenhuma pergunta ainda — adicione ou gere com a IA." }),
        );
        return;
      }
      itens.forEach((item, i) => listaItens.append(linhaItem(item, i)));
    };

    const linhaItem = (item, i) => {
      const seletorTipo = el(
        "select",
        { classe: "select", onchange: (e) => (item.tipo = e.target.value) },
        TIPOS.map(([v, r]) => {
          const o = el("option", { value: v, texto: r });
          if (v === item.tipo) o.selected = true;
          return o;
        }),
      );
      const pergunta = el("input", {
        value: item.pergunta ?? "",
        placeholder: "Pergunta",
        oninput: (e) => (item.pergunta = e.target.value),
        style: "flex:1;min-width:200px",
      });
      const obrigatoria = el("input", { type: "checkbox" });
      obrigatoria.checked = item.obrigatorio !== false;
      obrigatoria.addEventListener("change", () => (item.obrigatorio = obrigatoria.checked));

      const mover = (delta) => {
        const j = i + delta;
        if (j < 0 || j >= itens.length) return;
        [itens[i], itens[j]] = [itens[j], itens[i]];
        desenharItens();
      };

      return el("div", { classe: "cartao", style: "padding:12px" }, [
        el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, [
          el("strong", { texto: String(i + 1), style: "min-width:1.4em;text-align:center" }),
          seletorTipo,
          pergunta,
          el("label", { style: "display:flex;gap:5px;align-items:center;font-size:12.5px" }, [
            obrigatoria,
            el("span", { texto: "obrigatória" }),
          ]),
          el("button", { classe: "btn btn-peq", type: "button", texto: "↑", title: "Subir", onclick: () => mover(-1) }),
          el("button", { classe: "btn btn-peq", type: "button", texto: "↓", title: "Descer", onclick: () => mover(1) }),
          el("button", {
            classe: "btn btn-perigo btn-peq",
            type: "button",
            texto: "✕",
            title: "Remover",
            onclick: () => {
              itens.splice(i, 1);
              desenharItens();
            },
          }),
        ]),
      ]);
    };

    const descricaoIA = el("input", {
      placeholder: "Ex.: abertura de bar com foco em limpeza, freezers e caixa",
      style: "flex:1;min-width:220px",
    });
    const btnGerar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Gerar perguntas com IA",
      onclick: async () => {
        const descricao = descricaoIA.value.trim() || campos.descricao.value.trim() || campos.nome.value.trim();
        if (!descricao) {
          avisar("Descreva a rotina em uma frase para a IA montar as perguntas.", "erro");
          descricaoIA.focus();
          return;
        }
        btnGerar.disabled = true;
        btnGerar.textContent = "Gerando…";
        try {
          const gerados = await post("/v1/checklists/gerar", { descricao });
          // A IA propõe; quem monta decide — os itens chegam editáveis, não gravados.
          itens = itens.concat(gerados);
          desenharItens();
          avisar(`${gerados.length} pergunta(s) geradas. Revise, ajuste e salve.`, "ok");
        } catch (e) {
          avisar(e.message, "erro");
        } finally {
          btnGerar.disabled = false;
          btnGerar.textContent = "Gerar perguntas com IA";
        }
      },
    });

    limpar(area).append(
      el("div", { classe: "cabecalho-secao" }, [
        el("h2", { texto: existente ? `Editar: ${existente.name}` : "Novo checklist" }),
        el("button", { classe: "btn btn-peq", type: "button", texto: "← Voltar", onclick: mostrarLista }),
      ]),

      el("section", { classe: "cartao" }, [
        el("div", { classe: "grade" }, [
          campo("Nome", campos.nome),
          campo("Descrição", campos.descricao),
        ]),
      ]),

      el("section", { classe: "cartao" }, [
        el("h3", { texto: "Perguntas" }),
        el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0" }, [
          descricaoIA,
          btnGerar,
        ]),
        listaItens,
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "+ Adicionar pergunta",
          style: "margin-top:10px",
          onclick: () => {
            itens.push({ tipo: "sim_nao", pergunta: "", obrigatorio: true });
            desenharItens();
          },
        }),
      ]),

      el("section", { classe: "cartao" }, [
        el("h3", { texto: "Agenda e responsáveis" }),
        el("p", {
          classe: "muted",
          texto: "Nos dias marcados, no horário definido, o link vai sozinho pro WhatsApp de quem executa.",
        }),
        el("div", { classe: "campo campo-largo", style: "margin-top:8px" }, [
          el("label", { texto: "Dias da semana" }),
          el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" }, checksDias.map((c) => c.item)),
        ]),
        el("div", { classe: "grade", style: "margin-top:10px" }, [
          campo("Horário do envio", campos.hora),
          campo("Nome de quem executa", campos.respNome),
          campo("WhatsApp de quem executa", campos.respFone),
          campo("WhatsApp de quem recebe o resumo da IA", campos.avisarFone),
        ]),
      ]),

      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: existente ? "Salvar alterações" : "Criar checklist",
          onclick: salvar,
        }),
        el("button", { classe: "btn", type: "button", texto: "Cancelar", onclick: mostrarLista }),
      ]),
    );
    desenharItens();

    async function salvar(e) {
      const corpo = {
        name: campos.nome.value.trim(),
        description: campos.descricao.value.trim() || undefined,
        items: itens,
        schedule: {
          dias: checksDias.filter((c) => c.caixa.checked).map((c) => c.valor),
          hora: campos.hora.value || "09:00",
          responsavel_nome: campos.respNome.value.trim(),
          responsavel_telefone: campos.respFone.value.trim(),
          avisar_telefone: campos.avisarFone.value.trim(),
        },
      };
      if (!corpo.name) {
        avisar("Dê um nome ao checklist.", "erro");
        campos.nome.focus();
        return;
      }
      e.target.disabled = true;
      try {
        if (existente) {
          await patch(`/v1/checklists/${existente.id}?venue=${encodeURIComponent(ctx.venue)}`, corpo);
          avisar("Checklist atualizado.", "ok");
        } else {
          await post(`/v1/venues/${ctx.venue}/checklists`, corpo);
          avisar("Checklist criado. Dispare agora para testar o link.", "ok");
        }
        await mostrarLista();
      } catch (err) {
        avisar(err.message, "erro");
        e.target.disabled = false;
      }
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
}
