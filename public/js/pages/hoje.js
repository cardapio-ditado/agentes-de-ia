import { get } from "../api.js";
import { el, limpar, vazio } from "../ui.js";

/**
 * Hoje: a primeira tela de quem abre o painel.
 *
 * Duas perguntas, nesta ordem: "o que precisa de mim?" e "está tudo
 * ligado?". Depois do desmame, ninguém da Brasa Food olha a casa todo dia —
 * o dono precisa enxergar sozinho que o número de avisos caiu antes de o
 * checklist das 17h não sair, e que tem reserva esperando antes de o
 * cliente desistir.
 *
 * Cada linha leva à tela onde se resolve. O servidor só manda o que a casa
 * contratou e o que esta pessoa pode abrir.
 */

const DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });

export async function hoje(raiz, ctx) {
  const conteudo = el("div", { classe: "pilha" });
  raiz.append(conteudo);
  conteudo.append(el("p", { classe: "muted", texto: "Olhando a casa…" }));

  await desenhar();
  // Um minuto é o bastante: é tela de abrir de manhã e deixar aberta no
  // caixa, não painel de bolsa.
  const timer = setInterval(() => desenhar().catch(() => {}), 60_000);
  ctx.aoSair(() => clearInterval(timer));

  async function desenhar() {
    let dados;
    let implantacao = null;
    try {
      [dados, implantacao] = await Promise.all([
        get(`/v1/venues/${encodeURIComponent(ctx.venue)}/hoje`),
        // A trilha é de quem configura; para a equipe, nem pergunta.
        ctx.podeConfigurar === false ? null : get(`/v1/venues/${encodeURIComponent(ctx.venue)}/trilha`).catch(() => null),
      ]);
    } catch (e) {
      limpar(conteudo).append(vazio("Não deu para olhar a casa agora", e.message));
      return;
    }

    const problemas = dados.saude.filter((s) => s.estado === "problema");
    const urgentes = dados.pendencias.filter((p) => p.urgente);
    const quantas = problemas.length + urgentes.length;

    limpar(conteudo).append(
      el("section", { classe: `cartao hoje-topo ${dados.tudo_certo ? "hoje-topo-ok" : "hoje-topo-atencao"}` }, [
        el("p", { classe: "hoje-dia", texto: DIA.format(new Date(`${dados.dia}T12:00:00`)) }),
        el("h2", {
          classe: "hoje-frase",
          texto: dados.tudo_certo
            ? "Tudo certo por aqui."
            : `${quantas} ${quantas === 1 ? "coisa precisa" : "coisas precisam"} de você agora.`,
        }),
        el("p", {
          classe: "muted",
          texto: dados.tudo_certo
            ? "Os números estão ligados e nada urgente está esperando. Veja abaixo o que dá para adiantar."
            : "Comece pelo que está em vermelho: é o que perde cliente ou dinheiro hoje.",
        }),
      ]),

      // Enquanto a implantação não termina, ela lembra o próximo passo aqui.
      implantacao?.proximo
        ? el("a", { classe: "cartao trilha-proximo hoje-implantacao", href: "#trilha" }, [
            el("span", { classe: "muted", texto: `Implantação: ${implantacao.feitos} de ${implantacao.total} passos` }),
            el("strong", { texto: `Próximo: ${implantacao.proximo.titulo}` }),
            el("span", { classe: "muted", texto: implantacao.proximo.explicacao }),
          ])
        : null,

      el("section", { classe: "cartao pilha" }, [
        el("h3", { texto: "O que precisa de você" }),
        dados.pendencias.length
          ? el("div", { classe: "tabela" }, dados.pendencias.map(linhaDePendencia))
          : el("p", { classe: "muted", texto: "Nada esperando por você. 🙌" }),
      ]),

      el("section", { classe: "cartao pilha" }, [
        el("h3", { texto: "Está tudo ligado?" }),
        el("div", { classe: "tabela" }, dados.saude.map((s) => linhaDeSinal(s, ctx.podeConfigurar !== false))),
        ctx.podeConfigurar === false && problemas.length
          ? el("p", { classe: "muted", texto: "Avise o dono ou o gerente: o conserto é nos Ajustes da casa." })
          : null,
      ]),
    );
  }
}

function linhaDePendencia(p) {
  return el("a", { classe: "linha-tabela linha-tarefa hoje-linha", href: `#${p.destino}` }, [
    el("span", { classe: `hoje-numero${p.urgente ? " hoje-numero-urgente" : ""}`, texto: String(p.quantidade) }),
    el("div", { classe: "linha-tarefa-texto" }, [
      el("strong", { texto: p.titulo }),
      el("span", { classe: "muted", texto: p.detalhe }),
    ]),
    el("span", { classe: "hoje-seta", "aria-hidden": "true", texto: "›" }),
  ]);
}

function linhaDeSinal(s, clicavel) {
  const classe = { ok: "ponto-ok", alerta: "ponto-alerta", problema: "ponto-problema" }[s.estado] ?? "ponto-alerta";
  // Quem é do dia a dia vê a saúde, mas o conserto é em tela que não é dele.
  const comSeta = clicavel && s.estado !== "ok";
  return el(clicavel ? "a" : "div", { classe: `linha-tabela linha-tarefa${clicavel ? " hoje-linha" : ""}`, href: clicavel ? `#${s.destino}` : null }, [
    el("span", { classe: `ponto-estado ${classe}`, "aria-label": s.estado === "ok" ? "funcionando" : s.estado === "alerta" ? "atenção" : "parado" }),
    el("div", { classe: "linha-tarefa-texto" }, [
      el("strong", { texto: s.titulo }),
      el("span", { classe: "muted", texto: s.detalhe }),
    ]),
    comSeta ? el("span", { classe: "hoje-seta", "aria-hidden": "true", texto: "›" }) : el("span", {}),
  ]);
}
