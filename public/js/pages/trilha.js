import { get, put } from "../api.js";
import { avisar, el, limpar, vazio } from "../ui.js";

/**
 * Implantação: o roteiro da consultoria, passo a passo, para esta casa.
 *
 * O mentor abre esta tela na primeira visita e o mentorado continua por
 * ela depois. Quase todo passo se confere sozinho; os que o sistema não tem
 * como ver (treinar a equipe, o desmame) se marcam aqui. Cada passo leva à
 * tela onde se faz.
 */
export async function trilha(raiz, ctx) {
  const conteudo = el("div", { classe: "pilha" });
  raiz.append(conteudo);
  await desenhar();

  async function desenhar() {
    let t;
    try {
      t = await get(`/v1/venues/${encodeURIComponent(ctx.venue)}/trilha`);
    } catch (e) {
      limpar(conteudo).append(vazio("Não deu para carregar a implantação", e.message));
      return;
    }
    const pct = t.total ? Math.round((t.feitos / t.total) * 100) : 0;

    const etapas = [];
    for (const p of t.passos) {
      let etapa = etapas.find((e) => e.nome === p.etapa);
      if (!etapa) etapas.push((etapa = { nome: p.etapa, passos: [] }));
      etapa.passos.push(p);
    }

    limpar(conteudo).append(
      el("section", { classe: "cartao pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: t.proximo ? `${t.feitos} de ${t.total} passos feitos` : "Implantação concluída" }),
            el("p", {
              classe: "muted",
              texto: t.proximo
                ? "O sistema confere sozinho a maior parte; os passos com “marcar” são para o mentor."
                : "A casa anda com as próprias pernas. A trilha fica aqui para conferir quando quiser.",
            }),
          ]),
          el("strong", { classe: "trilha-pct", texto: `${pct}%` }),
        ]),
        el("div", { classe: "trilha-barra", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, [
          el("span", { style: `width:${pct}%` }),
        ]),
        t.proximo
          ? el("a", { classe: "trilha-proximo", href: `#${t.proximo.destino}` }, [
              el("span", { classe: "muted", texto: "Próximo passo" }),
              el("strong", { texto: t.proximo.titulo }),
              el("span", { classe: "muted", texto: t.proximo.explicacao }),
            ])
          : null,
      ]),
      ...etapas.map((etapa) =>
        el("section", { classe: "cartao pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("h3", { texto: etapa.nome }),
            el("span", { classe: "muted", texto: `${etapa.passos.filter((p) => p.feito).length} de ${etapa.passos.length}` }),
          ]),
          el("div", { classe: "tabela" }, etapa.passos.map(linha)),
        ]),
      ),
    );
  }

  function linha(p) {
    const situacao = p.feito
      ? p.como === "automatico"
        ? "Feito — o sistema conferiu"
        : `Marcado como feito${p.marcado_por ? ` por ${p.marcado_por}` : ""}`
      : p.explicacao;

    // Marcar à mão: obrigatório nos passos manuais, e possível nos outros
    // enquanto o sistema não os viu (a casa que não usa fornecedor fixo).
    const podeMarcar = ctx.podeConfigurar !== false && p.como !== "automatico";
    const caixa = podeMarcar
      ? el("label", { classe: "trilha-marcar", title: "Marcar este passo como feito" }, [
          el("input", {
            type: "checkbox",
            checked: p.feito,
            onchange: async (e) => {
              e.target.disabled = true;
              try {
                await put(`/v1/venues/${encodeURIComponent(ctx.venue)}/trilha/${p.id}`, { feito: e.target.checked });
                await desenhar();
              } catch (err) {
                avisar(err.message, "erro");
                e.target.checked = !e.target.checked;
                e.target.disabled = false;
              }
            },
          }),
          el("span", { texto: p.manual ? "marcar" : "pular" }),
        ])
      : null;

    return el("div", { classe: `linha-tabela linha-tarefa${p.feito ? " trilha-feito" : ""}` }, [
      el("span", { classe: `trilha-check${p.feito ? " trilha-check-ok" : ""}`, "aria-label": p.feito ? "feito" : "por fazer", texto: p.feito ? "✓" : "" }),
      el("div", { classe: "linha-tarefa-texto" }, [
        el("strong", { texto: p.titulo }),
        el("span", { classe: "muted", texto: situacao }),
      ]),
      el("div", { classe: "trilha-acoes" }, [
        caixa,
        p.feito ? null : el("a", { classe: "btn btn-peq", href: `#${p.destino}`, texto: "Abrir" }),
      ]),
    ]);
  }
}
