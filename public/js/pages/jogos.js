import { get, post } from "../api.js";
import { avisar, diaCurtoNaCasa, el, etiqueta, horaNaCasa, limpar, vazio } from "../ui.js";

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

    competicaoAtual = dados.competicao;

    const seletor = el(
      "select",
      { classe: "select" },
      dados.competicoes.map((c) =>
        el("option", { value: c.id, texto: c.nome, selected: c.id === dados.competicao }),
      ),
    );
    seletor.addEventListener("change", () => {
      // Sem Number(): o código da competição é texto ("bra.copa_do_brazil"),
      // e convertê-lo dava NaN — a URL saía com competicao=NaN, o servidor
      // não reconhecia e caía no primeiro da lista. Trocar de campeonato
      // sempre voltava para o Brasileirão, sem erro nenhum na tela.
      competicaoAtual = seletor.value;
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
      // No relógio da CASA, não no de quem olha: a API entrega o jogo em UTC,
      // e um jogo de 21h em Cuiabá é meia-noite em UTC — marcado pelo fuso do
      // navegador, ele apareceria no dia seguinte e com a hora errada.
      const dia = diaCurtoNaCasa(jogo.quando);
      const hora = horaNaCasa(jogo.quando);

      if (jogo.jaNaAgenda) {
        return el("div", { classe: "linha-tabela" }, [
          el("span", { classe: "linha-principal" }, [
            el("strong", { classe: "nome-inteiro", texto: `${jogo.mandante} x ${jogo.visitante}` }),
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
            el("strong", { classe: "nome-inteiro", texto: `${jogo.mandante} x ${jogo.visitante}` }),
          ]),
          // Rodada e estádio embaixo, junto da data: à direita eles roubavam
          // a largura do confronto, que é o que a pessoa lê para decidir.
          el("small", {
            classe: "muted",
            texto: [dia, hora, jogo.rodada, jogo.estadio].filter(Boolean).join(" · "),
          }),
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
