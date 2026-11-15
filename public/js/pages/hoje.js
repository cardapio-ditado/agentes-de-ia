import { get } from "../api.js";
import { el, etiqueta, limpar, tabelaDeDados, vazio } from "../ui.js";

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
  // Aba escondida não pergunta nada ao servidor.
  const timer = setInterval(() => {
    if (!document.hidden) desenhar().catch(() => {});
  }, 60_000);
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
    const semPressa = dados.pendencias.filter((p) => !p.urgente);
    const foraDoNormal = dados.saude.filter((s) => s.estado !== "ok");
    const funcionando = dados.saude.filter((s) => s.estado === "ok");

    const podeAbrir = ctx.podeConfigurar !== false;
    limpar(conteudo).append(
      // Uma linha de situação, e não uma manchete: o que importa vem logo abaixo.
      el("div", { classe: `hoje-barra${dados.tudo_certo ? " hoje-barra-ok" : ""}` }, [
        el("strong", {
          texto: dados.tudo_certo
            ? "Tudo certo por aqui."
            : `${quantas} ${quantas === 1 ? "pendência precisa" : "pendências precisam"} de você agora.`,
        }),
        el("span", {
          classe: "muted",
          texto: dados.tudo_certo ? "Nada urgente esperando. Abaixo, o que dá para adiantar." : "Comece pelo que está em vermelho.",
        }),
        el("span", { classe: "hoje-dia", texto: DIA.format(new Date(`${dados.dia}T12:00:00`)) }),
      ]),

      // Enquanto a implantação não termina, ela lembra o próximo passo aqui.
      implantacao?.proximo
        ? el("a", { classe: "cartao trilha-proximo hoje-implantacao", href: "#trilha" }, [
            el("span", { classe: "muted", texto: `Implantação: ${implantacao.feitos} de ${implantacao.total} passos` }),
            el("strong", { texto: `Próximo: ${implantacao.proximo.titulo}` }),
            el("span", { classe: "muted", texto: implantacao.proximo.explicacao }),
          ])
        : null,

      el("div", { classe: "hoje-colunas" }, [
        el("section", { classe: "pilha-fina" }, [
          el("h2", { texto: "Pendências" }),
          dados.pendencias.length
            ? tabelaDeDados({
                colunas: [
                  { rotulo: "O que precisa de você", principal: true, largura: "44%" },
                  { rotulo: "Detalhe", quebra: true, larga: true, semRotulo: true },
                  { rotulo: "", largura: "36px", acoes: true, someNoCelular: true },
                ],
                estreita: true,
                // Urgente primeiro; o servidor já manda nessa ordem, a tela só garante.
                linhas: [...urgentes, ...semPressa].map((p) => ({
                  aoClicar: () => { location.hash = `#${p.destino}`; },
                  celulas: [
                    el("span", { classe: "cel-com-qtd" }, [
                      el("span", { classe: `cel-qtd${p.urgente ? " cel-qtd-urgente" : ""}`, texto: String(p.quantidade) }),
                      el("span", { texto: p.titulo }),
                    ]),
                    p.detalhe,
                    el("span", { classe: "cel-seta", "aria-hidden": "true", texto: "›" }),
                  ],
                })),
              })
            : vazio("Nada esperando por você", "Quando uma reserva, conta ou documento precisar de decisão, aparece aqui."),
        ]),

        el("section", { classe: "pilha-fina" }, [
          el("h2", { texto: "Conexões e integrações" }),
          tabelaDeDados({
            colunas: [
              { rotulo: "Serviço", principal: true, largura: "42%" },
              { rotulo: "Situação", quebra: true, larga: true, semRotulo: true },
            ],
            estreita: true,
            // O que está parado sobe; o que funciona fica embaixo, numa linha cada.
            linhas: [...foraDoNormal, ...funcionando].map((s) => ({
              aoClicar: podeAbrir && s.estado !== "ok" ? () => { location.hash = `#${s.destino}`; } : null,
              celulas: [
                s.titulo,
                el("span", {}, [
                  etiqueta(s.estado === "ok" ? "funcionando" : s.estado === "alerta" ? "atenção" : "parado", s.estado === "ok" ? "etiqueta-ok" : s.estado === "alerta" ? "etiqueta-alerta" : "etiqueta-perigo"),
                  el("span", { classe: "muted", texto: ` ${s.detalhe}` }),
                ]),
              ],
            })),
          }),
          ctx.podeConfigurar === false && problemas.length
            ? el("p", { classe: "muted", texto: "Avise o dono ou o gerente: o conserto é nos Ajustes da casa." })
            : null,
        ]),
      ]),
    );
  }
}

