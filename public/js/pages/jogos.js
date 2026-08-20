import { get, post } from "../api.js";
import { avisar, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Jogos: a agenda esportiva que vira programação da casa.
 *
 * Escolher é o ponto da tela. Um bar não transmite tudo — passa o jogo do
 * time da cidade, o clássico e a final. Importar a rodada inteira encheria a
 * agenda de partidas que ninguém vai passar, e o agente responderia "sim, vai
 * passar" para um cliente que chegaria e não veria jogo nenhum.
 *
 * Por isso nada entra sozinho: marca-se o que vai passar e clica em incluir.
 */

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export async function jogos(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);

  let competicaoAtual = null;
  /** Ids marcados nesta sessão da tela. */
  const marcados = new Set();

  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Buscando os jogos…" }));
    let dados;
    try {
      const busca = competicaoAtual ? `?competicao=${competicaoAtual}` : "";
      dados = await get(`/v1/venues/${ctx.venue}/jogos${busca}`);
    } catch (e) {
      limpar(conteudo).append(
        vazio("Não consegui buscar os jogos", e.message),
        el("p", {
          classe: "muted",
          texto: "A agenda continua funcionando normalmente — dá para cadastrar o jogo à mão em Programação.",
        }),
      );
      return;
    }
    limpar(conteudo);
    marcados.clear();

    if (!dados.configurado) {
      conteudo.append(
        vazio(
          "Busca de jogos não configurada",
          "Falta a chave do serviço de jogos nesta instalação. Fale com a equipe Brasa Food.",
        ),
      );
      return;
    }

    competicaoAtual = dados.competicao;

    const seletor = el(
      "select",
      { classe: "select" },
      dados.competicoes.map((c) =>
        el("option", { value: c.id, texto: c.nome, selected: c.id === dados.competicao }),
      ),
    );
    seletor.addEventListener("change", () => {
      competicaoAtual = Number(seletor.value);
      desenhar();
    });

    const lista = el("div", { classe: "tabela" });
    const rodape = el("div", { classe: "cartao cartao-total", hidden: true });

    const atualizarRodape = () => {
      rodape.hidden = marcados.size === 0;
      limpar(rodape).append(
        el("div", { classe: "cabecalho-secao" }, [
          el("span", { texto: `${marcados.size} jogo(s) marcado(s)` }),
          el("button", {
            classe: "btn btn-primario btn-grande",
            type: "button",
            texto: "Incluir na programação",
            onclick: incluir,
          }),
        ]),
      );
    };

    for (const jogo of dados.jogos) lista.append(linhaJogo(jogo));

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", {}, [
          el("h2", { texto: "Jogos" }),
          el("p", {
            classe: "muted",
            texto: "Marque os que a casa vai transmitir. Só o que você marcar entra na programação e o agente passa a contar.",
          }),
        ]),
        el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Competição" }), seletor]),
        dados.jogos.length === 0
          ? vazio("Nenhum jogo nos próximos 30 dias", "Pode ser pausa no campeonato. Tente outra competição.")
          : lista,
        rodape,
      ]),
    );

    function linhaJogo(jogo) {
      const quando = new Date(jogo.quando);
      const dia = `${DIAS[quando.getDay()]} ${String(quando.getDate()).padStart(2, "0")}/${String(quando.getMonth() + 1).padStart(2, "0")}`;
      const hora = quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      if (jogo.jaNaAgenda) {
        return el("div", { classe: "linha-tabela" }, [
          el("span", { classe: "linha-principal" }, [
            el("strong", { texto: `${jogo.mandante} x ${jogo.visitante}` }),
            el("small", { classe: "muted", texto: `${dia} · ${hora}${jogo.estadio ? ` · ${jogo.estadio}` : ""}` }),
          ]),
          el("span", { classe: "linha-detalhes" }, [etiqueta("já na agenda", "etiqueta-ok")]),
        ]);
      }

      const caixa = el("input", { type: "checkbox", value: String(jogo.id) });
      caixa.addEventListener("change", () => {
        if (caixa.checked) marcados.add(jogo.id);
        else marcados.delete(jogo.id);
        atualizarRodape();
      });

      return el("label", { classe: "linha-tabela linha-clicavel" }, [
        el("span", { classe: "linha-principal" }, [
          el("span", { style: "display:flex;align-items:center;gap:8px" }, [
            caixa,
            el("strong", { texto: `${jogo.mandante} x ${jogo.visitante}` }),
          ]),
          el("small", { classe: "muted", texto: `${dia} · ${hora}${jogo.estadio ? ` · ${jogo.estadio}` : ""}` }),
        ]),
        el("span", { classe: "linha-detalhes" }, [
          el("small", { classe: "muted", texto: jogo.rodada ?? "" }),
        ]),
      ]);
    }

    async function incluir(ev) {
      const escolhidos = dados.jogos.filter((j) => marcados.has(j.id));
      if (escolhidos.length === 0) return;
      ev.target.disabled = true;
      ev.target.textContent = "Incluindo…";
      try {
        const r = await post(`/v1/venues/${ctx.venue}/jogos`, { jogos: escolhidos });
        avisar(
          r.jaExistiam > 0
            ? `${r.criados} incluído(s); ${r.jaExistiam} já estava(m) na agenda.`
            : `${r.criados} jogo(s) na programação. O agente já sabe contar.`,
          "ok",
        );
        desenhar();
      } catch (e) {
        avisar(e.message, "erro");
        ev.target.disabled = false;
        ev.target.textContent = "Incluir na programação";
      }
    }
  }
}
