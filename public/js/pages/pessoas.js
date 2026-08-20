import { del, get, patch, post } from "../api.js";
import { avisar, dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Pessoas e acessos: quem entra no painel desta casa.
 *
 * Até esta tela existir, dar acesso a um gerente significava emprestar a
 * senha do dono — e aí ninguém mais sabe quem lançou a contagem, quem
 * recebeu a nota, quem apagou a compra. O login individual não é
 * formalidade: é o que faz o histórico ter dono.
 *
 * A senha inicial aparece UMA VEZ, para ditar. Não guardamos senha legível
 * em lugar nenhum, e mandar por e-mail exigiria SMTP próprio — num bar,
 * ditar funciona melhor: o gerente está do lado.
 */

const NOME_DO_MODULO = {
  "agentes-ia": "Agentes de IA",
  "cardapio-digital": "Cardápio Digital",
  checklist: "Checklist",
  avaliacoes: "Avaliações",
  cmv: "CMV Inteligente",
};

export async function pessoas(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let dados, modulosDaCasa;
    try {
      [dados, modulosDaCasa] = await Promise.all([
        get("/v1/equipe"),
        // Só faz sentido liberar módulo que a casa tem.
        get(`/v1/venues/${ctx.venue}/modulos`).catch(() => []),
      ]);
    } catch (e) {
      limpar(conteudo).append(vazio("Acessos indisponíveis", e.message));
      return;
    }
    limpar(conteudo);

    const contratados = (modulosDaCasa ?? []).filter((m) => m.ativo).map((m) => m.modulo ?? m.id);
    const nomeDoPapel = (id) => dados.papeis.find((p) => p.id === id)?.nome ?? id;

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Pessoas e acessos" }),
            el("p", { classe: "muted", texto: "Cada pessoa com o seu login — é o que faz o histórico ter dono." }),
          ]),
          dados.pode_mexer
            ? el("button", { classe: "btn btn-primario", type: "button", texto: "+ Nova pessoa", onclick: formulario })
            : null,
        ].filter(Boolean)),

        !dados.pode_mexer
          ? el("p", { classe: "aviso aviso-alerta", texto: "Só o dono e o gerente podem criar ou alterar acessos." })
          : null,

        el("div", { classe: "rolagem-x" }, [
          el("table", { classe: "planilha" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { texto: "Pessoa" }),
                el("th", { texto: "Pode fazer" }),
                el("th", { texto: "Módulos" }),
                el("th", { texto: "Último acesso" }),
                el("th", { texto: "" }),
              ]),
            ]),
            el("tbody", {}, dados.pessoas.map(linhaPessoa)),
          ]),
        ]),
      ].filter(Boolean)),
    );

    function linhaPessoa(p) {
      const souEu = p.userId === dados.eu;
      const dono = p.papel === "owner";
      const modulos =
        p.modulos === null
          ? "todos"
          : p.modulos.length === 0
            ? "nenhum"
            : p.modulos.map((m) => NOME_DO_MODULO[m] ?? m).join(", ");

      return el("tr", {}, [
        el("td", {}, [
          el("strong", { texto: p.nome || p.email }),
          el("small", { classe: "muted", texto: p.nome ? ` ${p.email}` : "" }),
        ]),
        el("td", {}, [
          etiqueta(nomeDoPapel(p.papel), dono ? "etiqueta-ok" : ""),
          souEu ? el("small", { classe: "muted", texto: " você" }) : null,
        ].filter(Boolean)),
        el("td", { texto: modulos }),
        el("td", { texto: p.ultimoAcesso ? dataHora(p.ultimoAcesso) : "nunca entrou" }),
        el("td", { classe: "col-acoes" },
          !dados.pode_mexer || dono
            ? []
            : [
                el("button", {
                  classe: "btn-icone",
                  type: "button",
                  title: "Alterar o que essa pessoa pode fazer",
                  texto: "✏️",
                  onclick: () => formulario(p),
                }),
                el("button", {
                  classe: "btn-icone",
                  type: "button",
                  title: "Gerar uma senha nova",
                  texto: "🔑",
                  onclick: () => novaSenha(p),
                }),
                souEu
                  ? null
                  : el("button", {
                      classe: "btn-icone",
                      type: "button",
                      title: "Tirar o acesso",
                      texto: "🗑",
                      onclick: () => remover(p),
                    }),
              ].filter(Boolean),
        ),
      ]);
    }

    async function novaSenha(p) {
      if (!confirm(`Gerar uma senha nova para ${p.nome || p.email}? A antiga deixa de funcionar na hora.`)) return;
      try {
        const r = await post(`/v1/equipe/${p.userId}/senha`, {});
        mostrarSenha(p.nome || p.email, p.email, r.senha_inicial);
      } catch (e) {
        avisar(e.message, "erro");
      }
    }

    async function remover(p) {
      if (
        !confirm(
          `Tirar o acesso de ${p.nome || p.email}?\n\nA conta é apagada e a pessoa não entra mais. O que ela já fez continua no histórico.`,
        )
      ) return;
      try {
        await del(`/v1/equipe/${p.userId}`);
        avisar("Acesso removido.", "ok");
        desenhar();
      } catch (e) {
        avisar(e.message, "erro");
      }
    }

    /**
     * A senha aparece uma vez, grande, para ditar em voz alta. Some quando a
     * pessoa fecha — e aí só resta gerar outra, que é o certo.
     */
    function mostrarSenha(nome, email, senha) {
      limpar(conteudo).append(
        el("section", { classe: "pilha" }, [
          el("h2", { texto: "Anote agora" }),
          el("div", { classe: "cartao", style: "text-align:center;padding:28px 16px" }, [
            el("p", { classe: "muted", texto: `Acesso de ${nome}` }),
            el("p", { style: "font-size:1.1rem;margin:4px 0", texto: email }),
            el("p", {
              style: "font-size:2.2rem;font-weight:800;margin:12px 0;letter-spacing:2px",
              texto: senha,
            }),
            el("p", { classe: "muted", texto: "Esta senha não aparece de novo. Se perder, gere outra pela chave 🔑." }),
          ]),
          el("p", {
            classe: "aviso aviso-alerta",
            texto: "Peça para a pessoa trocar a senha no primeiro acesso, em Entrar → Esqueci minha senha.",
          }),
          el("button", { classe: "btn btn-primario btn-grande", type: "button", texto: "Anotei, pode fechar", onclick: desenhar }),
        ]),
      );
    }

    function formulario(existente) {
      limpar(conteudo);
      const nome = el("input", { classe: "campo", value: existente?.nome ?? "", placeholder: "Maria Souza" });
      const email = el("input", {
        classe: "campo",
        type: "email",
        value: existente?.email ?? "",
        placeholder: "maria@email.com",
        disabled: !!existente,
      });

      // Papel: dono não entra na lista — é a conta da contratação.
      const papeis = dados.papeis.filter((p) => p.id !== "owner");
      const escolhido = el(
        "select",
        { classe: "select" },
        papeis.map((p) =>
          el("option", { value: p.id, texto: p.nome, selected: (existente?.papel ?? "member") === p.id }),
        ),
      );
      const ajudaPapel = el("small", { classe: "muted" });
      const atualizarAjuda = () => {
        ajudaPapel.textContent = papeis.find((p) => p.id === escolhido.value)?.descricao ?? "";
      };
      escolhido.addEventListener("change", atualizarAjuda);
      atualizarAjuda();

      // Módulos: null = todos. A caixa "todos" ligada esconde a lista, porque
      // é o caso comum e ninguém quer marcar cinco caixas para o gerente.
      const todos = el("input", { type: "checkbox", checked: existente ? existente.modulos === null : true });
      const caixas = contratados.map((id) =>
        el("label", { classe: "campo-caixa" }, [
          el("input", {
            type: "checkbox",
            value: id,
            checked: existente?.modulos ? existente.modulos.includes(id) : false,
          }),
          el("span", { texto: NOME_DO_MODULO[id] ?? id }),
        ]),
      );
      const listaModulos = el("div", { classe: "pilha", hidden: todos.checked }, caixas);
      todos.addEventListener("change", () => {
        listaModulos.hidden = todos.checked;
      });

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("h2", { texto: existente ? `Acesso de ${existente.nome || existente.email}` : "Nova pessoa" }),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
          ]),
          el("div", { classe: "cartao pilha" }, [
            el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Nome" }), nome]),
            el("label", { classe: "campo-rotulado" }, [
              el("span", { texto: "E-mail (é com ele que entra)" }),
              email,
              existente ? el("small", { classe: "muted", texto: "O e-mail não muda. Para trocar, remova e crie de novo." }) : null,
            ].filter(Boolean)),
            el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Pode fazer" }), escolhido, ajudaPapel]),
            el("div", { classe: "campo-rotulado" }, [
              el("span", { texto: "Módulos que enxerga" }),
              el("label", { classe: "campo-caixa" }, [
                todos,
                el("span", { texto: "Todos os módulos da casa" }),
              ]),
              listaModulos,
            ]),
            el("button", {
              classe: "btn btn-primario btn-grande",
              type: "button",
              texto: existente ? "Salvar" : "Criar acesso",
              onclick: async (ev) => {
                const modulos = todos.checked
                  ? null
                  : caixas
                      .map((c) => c.querySelector("input"))
                      .filter((i) => i.checked)
                      .map((i) => i.value);
                ev.target.disabled = true;
                try {
                  if (existente) {
                    await patch(`/v1/equipe/${existente.userId}`, { papel: escolhido.value, modulos });
                    avisar("Acesso atualizado.", "ok");
                    desenhar();
                  } else {
                    if (nome.value.trim().length < 2) {
                      ev.target.disabled = false;
                      return avisar("Diga o nome da pessoa.", "erro");
                    }
                    const r = await post("/v1/equipe", {
                      nome: nome.value,
                      email: email.value,
                      papel: escolhido.value,
                      modulos,
                    });
                    mostrarSenha(r.pessoa.nome, r.pessoa.email, r.senhaInicial);
                  }
                } catch (e) {
                  avisar(e.message, "erro");
                  ev.target.disabled = false;
                }
              },
            }),
          ]),
        ]),
      );
    }
  }
}
