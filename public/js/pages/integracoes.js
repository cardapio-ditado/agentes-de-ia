import { get, post, put } from "../api.js";
import { avisar, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Integrações: os sistemas que a casa já usa e que o Brasa Food pode ler.
 *
 * Nada aqui é premissa. Uma casa sem Zig usa o painel inteiro do mesmo jeito
 * — as vendas entram por relatório, os clientes pelo WhatsApp e pela
 * planilha. A integração é um atalho que a casa LIGA, e cada uso dela tem a
 * sua chave: ligar a Zig não baixa estoque sozinho nem manda convite para
 * ninguém sem a casa escolher.
 */
export async function integracoes(raiz, ctx) {
  const conteudo = el("div", { classe: "pilha" });
  raiz.append(conteudo);
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let dados;
    try {
      dados = await get(`/v1/venues/${ctx.venue}/integracoes`);
    } catch (e) {
      limpar(conteudo).append(vazio("Integrações indisponíveis", e.message));
      return;
    }
    limpar(conteudo).append(
      el("p", {
        classe: "muted",
        texto: "Ligue só o que a casa usa. Sem nenhuma integração, o painel funciona do mesmo jeito: as vendas entram por relatório e os clientes pelo WhatsApp.",
      }),
      cartaoDaZig(dados.zig),
      cartaoOutroPdv(),
      cartaoDosCanais(),
      cartaoDoGoogle(),
    );
  }

  /* ---------- Zig ---------- */

  function cartaoDaZig(zig) {
    if (!zig) {
      return el("section", { classe: "cartao" }, [
        cabecalho("Zig", null),
        el("p", { classe: "muted", texto: "A tabela da Zig ainda não existe no banco desta instalação. Fale com a equipe Brasa Food." }),
      ]);
    }
    return el("section", { classe: "cartao pilha" }, [
      cabecalho("Zig", zig.conectada ? etiqueta("conectada", "etiqueta-ok") : etiqueta("não conectada", "")),
      el("p", {
        classe: "muted",
        texto: "O sistema de comanda e pagamento do bar. Conectada, ela traz o que foi vendido e quem é cada cliente.",
      }),
      zig.conectada ? conexaoFeita(zig) : formularioDeConexao(zig),
      zig.conectada ? usosDaZig(zig) : null,
    ]);
  }

  function formularioDeConexao(zig) {
    const token = el("input", { type: "password", placeholder: "Cole o token de integração", autocomplete: "off" });
    const loja = el("input", { value: zig.loja ?? "", placeholder: "Identificador da loja" });

    const testar = el("button", {
      classe: "btn",
      type: "button",
      texto: "Testar",
      onclick: async () => {
        testar.disabled = true;
        try {
          const r = await post(`/v1/venues/${ctx.venue}/integracoes/zig/testar`, {
            token: token.value.trim() || undefined,
            loja: loja.value.trim() || undefined,
          });
          avisar(`A Zig respondeu: token e loja valem (${r.eventos} evento(s) recente(s)).`, "ok");
        } catch (e) {
          avisar(e.message, "erro");
        } finally {
          testar.disabled = false;
        }
      },
    });

    const conectar = el("button", {
      classe: "btn btn-primario",
      type: "button",
      texto: "Conectar",
      onclick: async () => {
        if (!token.value.trim() || !loja.value.trim()) {
          avisar("Preencha o token e a loja.", "erro");
          return;
        }
        conectar.disabled = true;
        try {
          // Testa antes de gravar: token errado guardado é integração que
          // parece ligada e não entrega nada.
          await post(`/v1/venues/${ctx.venue}/integracoes/zig/testar`, { token: token.value.trim(), loja: loja.value.trim() });
          await put(`/v1/venues/${ctx.venue}/integracoes/zig`, { token: token.value.trim(), loja: loja.value.trim() });
          avisar("Zig conectada. Escolha abaixo o que ela liga aqui.", "ok");
          await desenhar();
        } catch (e) {
          avisar(e.message, "erro");
          conectar.disabled = false;
        }
      },
    });

    return el("div", { classe: "pilha" }, [
      el("div", { classe: "grade" }, [campo("Token de integração", token), campo("Loja", loja)]),
      el("p", {
        classe: "muted",
        texto: "Os dois ficam no painel da Zig, em Integrações. O token fica só no nosso banco; você desconecta quando quiser.",
      }),
      el("div", { classe: "linha-campos" }, [conectar, testar]),
    ]);
  }

  function conexaoFeita(zig) {
    const desconectar = el("button", {
      classe: "btn",
      type: "button",
      texto: "Desconectar",
      onclick: async () => {
        if (!confirm("Desconectar a Zig? As vendas param de entrar sozinhas e o convite automático da pesquisa é desligado.")) return;
        desconectar.disabled = true;
        try {
          await put(`/v1/venues/${ctx.venue}/integracoes/zig`, { token: "" });
          avisar("Zig desconectada.", "ok");
          await desenhar();
        } catch (e) {
          avisar(e.message, "erro");
          desconectar.disabled = false;
        }
      },
    });
    const testar = el("button", {
      classe: "btn",
      type: "button",
      texto: "Testar",
      onclick: async () => {
        testar.disabled = true;
        try {
          const r = await post(`/v1/venues/${ctx.venue}/integracoes/zig/testar`, {});
          avisar(`A Zig respondeu (${r.eventos} evento(s) recente(s)).`, "ok");
        } catch (e) {
          avisar(e.message, "erro");
        } finally {
          testar.disabled = false;
        }
      },
    });
    return el("div", { classe: "linha-campos" }, [
      el("p", { classe: "muted", style: "margin:0", texto: `Loja ${zig.loja} · token …${zig.token_final ?? ""}` }),
      el("div", { classe: "reserva-acoes", style: "margin:0 0 0 auto" }, [testar, desconectar]),
    ]);
  }

  /** Cada uso da Zig, com a sua chave. O que depende de outro módulo diz qual. */
  function usosDaZig(zig) {
    const temCmv = ctx.temModulo("cmv");
    const temPesquisa = ctx.temModulo("pesquisa");
    return el("div", { classe: "pilha", style: "margin-top:6px" }, [
      el("h4", { classe: "integracao-titulo", texto: "O que a Zig liga aqui" }),
      temCmv
        ? chave({
          titulo: "Vendas no estoque",
          texto: "Todo dia às 6h a noite de ontem entra em CMV → Vendas. Se todo produto vendido tiver ficha ou insumo, o estoque baixa sozinho; o que não tiver espera você decidir. Ligue quando o cadastro de fichas estiver pronto.",
          ligado: zig.vendas_no_estoque,
          campo: "vendas_no_estoque",
        })
        : uso("Vendas no estoque", "Faz parte do módulo CMV, que a casa não contratou."),
      uso("Base de clientes", "Quem passa pela casa entra na base com telefone e aniversário. Sempre ligado com a Zig conectada: não manda nada para ninguém."),
      temPesquisa
        ? uso(
          "Convite da pesquisa",
          zig.ativo
            ? "Ligado: quem esteve ontem recebe o convite no horário escolhido. Ajuste em Clientes → Ajustes da pesquisa."
            : "Desligado. Para convidar sozinho quem esteve ontem, ligue em Clientes → Ajustes da pesquisa.",
        )
        : null,
    ]);
  }

  function chave({ titulo, texto, ligado, campo }) {
    const entrada = el("input", { type: "checkbox", checked: ligado });
    entrada.addEventListener("change", async () => {
      entrada.disabled = true;
      try {
        await put(`/v1/venues/${ctx.venue}/integracoes/zig`, { [campo]: entrada.checked });
        avisar(`${titulo}: ${entrada.checked ? "ligado" : "desligado"}.`, "ok");
      } catch (e) {
        entrada.checked = !entrada.checked;
        avisar(e.message, "erro");
      } finally {
        entrada.disabled = false;
      }
    });
    return el("label", { classe: "integracao-uso" }, [
      entrada,
      el("span", {}, [el("strong", { texto: titulo }), el("span", { classe: "muted", texto: texto })]),
    ]);
  }

  function uso(titulo, texto) {
    return el("div", { classe: "integracao-uso integracao-uso-fixo" }, [
      el("span", { classe: "integracao-ponto", "aria-hidden": "true" }),
      el("span", {}, [el("strong", { texto: titulo }), el("span", { classe: "muted", texto: texto })]),
    ]);
  }

  /* ---------- As outras portas ---------- */

  function cartaoOutroPdv() {
    return el("section", { classe: "cartao" }, [
      cabecalho("Outro sistema de caixa", etiqueta("sem conectar", "")),
      el("p", {
        classe: "muted",
        texto: ctx.temModulo("cmv")
          ? "Colibri, Saipos, Consumer ou uma planilha: mande o relatório de vendas em CMV → Vendas. A IA lê qualquer formato e baixa o estoque pelas fichas."
          : "Colibri, Saipos, Consumer ou uma planilha: com o módulo CMV, o relatório de vendas baixa o estoque pelas fichas.",
      }),
    ]);
  }

  function cartaoDosCanais() {
    return el("section", { classe: "cartao" }, [
      cabecalho("WhatsApp e Instagram", null),
      el("p", { classe: "muted", texto: "Qual número atende o cliente, qual avisa a equipe, qual manda o parabéns — e o Instagram." }),
      el("div", { classe: "reserva-acoes" }, [
        el("button", { classe: "btn btn-peq", type: "button", texto: "Abrir", onclick: () => { location.hash = "#canais-casa"; } }),
      ]),
    ]);
  }

  function cartaoDoGoogle() {
    return el("section", { classe: "cartao" }, [
      cabecalho("Google", null),
      el("p", {
        classe: "muted",
        texto: ctx.temModulo("avaliacoes")
          ? "As avaliações do Perfil da Empresa, respondidas no tom da casa. Em Clientes → Avaliações do Google."
          : "As avaliações do Perfil da Empresa, respondidas no tom da casa, fazem parte do módulo Avaliações.",
      }),
    ]);
  }

  function cabecalho(titulo, selo) {
    return el("div", { classe: "cabecalho-secao" }, [el("h3", { texto: titulo }), selo]);
  }

  function campo(rotulo, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
  }
}
