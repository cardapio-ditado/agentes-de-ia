import { get } from "../api.js";
import { el, esqueleto, estadoDeErro, etiqueta, tabelaDeDados, vazio } from "../ui.js";

/** O que está configurado nesta organização: estabelecimentos e agentes. */
export async function organizacao(raiz, ctx) {
  raiz.replaceChildren(esqueleto({ linhas: 3 }));
  let venues, agentes;
  try {
    [venues, agentes] = await Promise.all([get("/v1/venues"), get("/v1/agents")]);
  } catch (e) {
    raiz.replaceChildren(estadoDeErro("Não deu para carregar os estabelecimentos", e.message, () => organizacao(raiz, ctx)));
    return;
  }
  raiz.replaceChildren();

  raiz.append(
    el("div", { classe: "pilha" }, [
      el("section", { classe: "pilha-fina" }, [
        el("div", {}, [
          el("h2", { texto: "Estabelecimentos" }),
          el("p", { classe: "muted", texto: "Cada um tem programação, reservas e conversas próprias." }),
        ]),
        venues.length === 0
          ? vazio("Nenhuma casa cadastrada", "Avise o suporte da Brasa Food para cadastrar a primeira.")
          : tabelaDeDados({
              colunas: [
                { rotulo: "Estabelecimento", principal: true },
                { rotulo: "Fuso horário", largura: "30%" },
                { rotulo: "Situação", largura: "160px" },
              ],
              estreita: true,
              linhas: venues.map((v) => ({
                celulas: [
                  v.name,
                  v.timezone ?? null,
                  v.slug === ctx.venue ? etiqueta("em uso", "etiqueta-ok") : etiqueta(v.slug),
                ],
              })),
            }),
      ]),

      el("section", { classe: "cartao" }, [
        el("h2", { texto: "Atendentes virtuais" }),
        el("p", {
          classe: "muted",
          texto: `${agentes.length === 1 ? "1 atendente virtual ligado" : `${agentes.length} atendentes virtuais ligados`}. Para mudar o jeito e as regras, abra o módulo Atendente virtual, em Atendente virtual → Jeito e regras.`,
        }),
      ]),

      el("section", { classe: "cartao" }, [
        // Criar e cancelar chave ainda é comando de quem cuida do servidor.
        // O dono precisa saber a quem pedir, não o nome do comando.
        el("h2", { texto: "Chaves de acesso de máquinas" }),
        el("p", {
          classe: "muted",
          texto:
            "Por segurança, uma chave só aparece no momento em que é criada — depois ninguém consegue ver de novo, nem a Brasa Food. Para criar uma nova ou cancelar uma antiga, avise o suporte da Brasa Food.",
        }),
      ]),
    ]),
  );
}
