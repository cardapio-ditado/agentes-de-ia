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

      el("section", {}, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Agentes" }),
            el("p", { classe: "muted", texto: "Personalidade, modelo e esforço de raciocínio." }),
          ]),
        ]),
        agentes.length === 0
          ? vazio("Nenhum agente habilitado")
          : el(
              "div",
              { classe: "lista" },
              agentes.map((a) =>
                el("article", { classe: "cartao" }, [
                  el("div", { classe: "cabecalho-secao" }, [
                    el("div", { style: "min-width:0" }, [
                      el("h3", { texto: a.name }),
                      el("p", { classe: "muted", texto: a.description ?? "" }),
                    ]),
                    etiqueta(a.enabled ? "ativo" : "desativado", a.enabled ? "etiqueta-ok" : ""),
                  ]),
                  el("div", { classe: "linha-dado" }, [
                    el("span", { texto: "Modelo" }),
                    el("strong", { texto: a.model }),
                  ]),
                  el("div", { classe: "linha-dado" }, [
                    el("span", { texto: "Esforço de raciocínio" }),
                    el("strong", { texto: a.effort }),
                  ]),
                ]),
              ),
            ),
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
