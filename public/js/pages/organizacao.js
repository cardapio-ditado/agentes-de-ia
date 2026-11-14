import { get } from "../api.js";
import { el, etiqueta, vazio } from "../ui.js";

/** O que está configurado nesta organização: estabelecimentos e agentes. */
export async function organizacao(raiz, ctx) {
  const [venues, agentes] = await Promise.all([get("/v1/venues"), get("/v1/agents")]);

  raiz.append(
    el("div", { classe: "pilha" }, [
      el("section", {}, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Estabelecimentos" }),
            el("p", { classe: "muted", texto: "Cada um tem programação, reservas e conversas próprias." }),
          ]),
        ]),
        venues.length === 0
          ? vazio("Nenhuma casa cadastrada", "Avise o suporte da Brasa Food para cadastrar a primeira.")
          : el(
              "div",
              { classe: "lista" },
              venues.map((v) =>
                el("article", { classe: "cartao" }, [
                  el("div", { classe: "cabecalho-secao" }, [
                    el("div", {}, [
                      el("h3", { texto: v.name }),
                      el("p", { classe: "muted", texto: v.timezone ?? "" }),
                    ]),
                    v.slug === ctx.venue ? etiqueta("em uso", "etiqueta-ok") : etiqueta(v.slug),
                  ]),
                ]),
              ),
            ),
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
