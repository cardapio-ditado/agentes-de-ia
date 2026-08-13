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
          ? vazio("Nenhum estabelecimento", "Rode `npm run seed` para criar o primeiro.")
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
        el("h2", { texto: "Agentes" }),
        el("p", {
          classe: "muted",
          texto: `${agentes.length} agente(s) habilitado(s). A criação e a edição ficam na seção Agentes, na barra lateral.`,
        }),
      ]),

      el("section", { classe: "cartao" }, [
        el("h2", { texto: "Chaves de API" }),
        el("p", {
          classe: "muted",
          texto:
            "O banco guarda só o SHA-256 de cada chave — não há como exibir uma chave existente, nem mesmo aqui. Para criar outra, rode `npm run criar-chave`; para revogar, preencha revoked_at na tabela api_keys.",
        }),
      ]),
    ]),
  );
}
