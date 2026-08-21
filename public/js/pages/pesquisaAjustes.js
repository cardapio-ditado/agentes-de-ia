import { del, get, patch, post, put } from "../api.js";
import { avisar, dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * O que a casa configura na pesquisa, em quatro abas.
 *
 * Separado do painel de propósito: o dono abre o painel toda semana e esta
 * tela três vezes na vida — no dia que instala, no dia que troca o prêmio e no
 * dia que contrata alguém. Misturar as duas coisas faria a tela que importa
 * abrir cheia de formulário.
 */

const ABAS = [
  ["qrcode", "QR code da mesa"],
  ["equipe", "Quem atende"],
  ["premio", "O prêmio"],
  ["convites", "Enviar para o cliente"],
];

export async function pesquisaAjustes(raiz, ctx) {
  let abaAtual = "qrcode";
  const conteudo = el("div", { classe: "pilha" });

  const barra = el(
    "div",
    { classe: "abas" },
    ABAS.map(([id, rotulo]) =>
      el("button", {
        classe: `aba ${id === abaAtual ? "aba-ativa" : ""}`.trim(),
        type: "button",
        texto: rotulo,
        "data-aba": id,
        onclick: () => {
          abaAtual = id;
          for (const b of barra.querySelectorAll("[data-aba]")) {
            b.classList.toggle("aba-ativa", b.dataset.aba === id);
          }
          desenhar();
        },
      }),
    ),
  );

  raiz.append(el("div", { classe: "pilha" }, [barra, conteudo]));
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    try {
      const telas = { qrcode: telaQrcode, equipe: telaEquipe, premio: telaPremio, convites: telaConvites };
      limpar(conteudo).append(await telas[abaAtual](ctx, desenhar));
    } catch (e) {
      limpar(conteudo).append(vazio("Não deu para carregar", e.message));
    }
  }
}

/* ============ QR code ============ */

async function telaQrcode(ctx) {
  const caixa = el("div", { classe: "pilha" });

  const mesa = el("input", { placeholder: "Ex.: 7 (deixe vazio para um QR geral)" });
  const area = el("div");

  async function gerar() {
    limpar(area).append(el("p", { classe: "muted", texto: "Gerando…" }));
    const busca = mesa.value.trim() ? `?mesa=${encodeURIComponent(mesa.value.trim())}` : "";
    const dados = await get(`/v1/venues/${ctx.venue}/pesquisa/qrcode${busca}`);

    limpar(area).append(
      el("div", { classe: "cartaz-qr" }, [
        el("img", { src: dados.png, alt: "QR code da pesquisa", classe: "qr-imagem" }),
        el("div", {}, [
          el("h3", { texto: dados.mesa ? `Mesa ${dados.mesa}` : "QR code da casa" }),
          el("p", {
            classe: "muted",
            texto: "Imprima e cole na mesa. O cliente aponta a câmera e responde em 30 segundos.",
          }),
          el("p", { classe: "bloco-codigo", texto: dados.url }),
          el("div", { classe: "linha-campos" }, [
            el("button", {
              classe: "btn btn-primario btn-peq",
              type: "button",
              texto: "Imprimir",
              // `window.print()` da própria página: o CSS de impressão esconde
              // o painel e deixa só o cartaz. Abrir uma janela nova seria
              // bloqueado pelo navegador na metade dos celulares.
              onclick: () => window.print(),
            }),
            el("button", {
              classe: "btn btn-peq",
              type: "button",
              texto: "Copiar link",
              onclick: async (e) => {
                try {
                  await navigator.clipboard.writeText(dados.url);
                  avisar("Link copiado.", "ok");
                } catch {
                  // Sem permissão de área de transferência (acontece em
                  // navegador embutido): o link está na tela para copiar à mão.
                  avisar("Copie o link que está na tela.", "erro");
                  e.target.blur();
                }
              },
            }),
          ]),
        ]),
      ]),
    );
  }

  caixa.append(
    el("section", { classe: "cartao" }, [
      el("h3", { texto: "QR code para a mesa" }),
      el("p", {
        classe: "muted",
        texto: "Um QR por mesa deixa você saber de qual mesa veio cada resposta. Sem mesa, funciona igual — só não identifica o lugar.",
      }),
      el("div", { classe: "linha-campos", style: "margin-top:12px" }, [
        el("label", { classe: "campo-rotulado", style: "flex:1" }, [
          el("span", { texto: "Número da mesa (opcional)" }),
          mesa,
        ]),
        el("button", { classe: "btn btn-primario", type: "button", texto: "Gerar QR code", onclick: gerar }),
      ]),
    ]),
    area,
  );

  await gerar();
  return caixa;
}

/* ============ Quem atende ============ */

async function telaEquipe(ctx, recarregar) {
  const equipe = await get(`/v1/venues/${ctx.venue}/pesquisa/atendentes?todos=1`);

  const nome = el("input", { placeholder: "Nome completo", required: true });
  const apelido = el("input", { placeholder: "Como o cliente chama (opcional)" });
  const funcao = el("input", { placeholder: "Salão, bar, cozinha…" });

  const form = el("form", {
    classe: "cartao",
    onsubmit: async (e) => {
      e.preventDefault();
      const botao = form.querySelector("button[type=submit]");
      botao.disabled = true;
      try {
        await post(`/v1/venues/${ctx.venue}/pesquisa/atendentes`, {
          nome: nome.value.trim(),
          apelido: apelido.value.trim() || undefined,
          funcao: funcao.value.trim() || undefined,
        });
        avisar("Pessoa cadastrada.", "ok");
        await recarregar();
      } catch (err) {
        avisar(err.message, "erro");
        botao.disabled = false;
      }
    },
  }, [
    el("h3", { texto: "Cadastrar quem atende" }),
    el("p", {
      classe: "muted",
      texto: "Só quem aparece aqui pode ser elogiado pelo cliente — e só quem é elogiado entra no ranking.",
    }),
    el("div", { classe: "grade", style: "margin-top:12px" }, [
      campo("Nome", nome),
      campo("Apelido", apelido),
      campo("Função", funcao),
    ]),
    el("button", { classe: "btn btn-primario", type: "submit", texto: "Adicionar", style: "margin-top:12px" }),
  ]);

  const lista = el("section", { classe: "cartao" }, [
    el("h3", { texto: `Equipe (${equipe.filter((a) => a.ativo).length} ativos)` }),
    equipe.length === 0
      ? el("p", { classe: "muted", texto: "Ninguém cadastrado ainda." })
      : el("div", { classe: "rolagem-x", style: "margin-top:10px" }, [
          el("table", { classe: "planilha" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { texto: "Nome" }),
                el("th", { texto: "Aparece como" }),
                el("th", { texto: "Função" }),
                el("th", { texto: "Situação" }),
                el("th", { classe: "col-acoes", texto: "" }),
              ]),
            ]),
            el(
              "tbody",
              {},
              equipe.map((a) =>
                el("tr", {}, [
                  el("td", { texto: a.nome }),
                  el("td", { texto: a.apelido || a.nome }),
                  el("td", { texto: a.funcao || "—" }),
                  el("td", {}, [
                    a.ativo ? etiqueta("ativo", "etiqueta-ok") : etiqueta("fora da lista"),
                  ]),
                  el("td", { classe: "col-acoes" }, [
                    el("button", {
                      classe: "btn-icone",
                      type: "button",
                      title: a.ativo ? "Tirar da lista do cliente" : "Voltar para a lista",
                      texto: a.ativo ? "🚫" : "↩️",
                      onclick: async () => {
                        try {
                          await patch(`/v1/venues/${ctx.venue}/pesquisa/atendentes/${a.id}`, { ativo: !a.ativo });
                          await recarregar();
                        } catch (err) {
                          avisar(err.message, "erro");
                        }
                      },
                    }),
                    el("button", {
                      classe: "btn-icone",
                      type: "button",
                      title: "Excluir",
                      texto: "🗑️",
                      onclick: async () => {
                        if (!confirm(`Excluir ${a.nome}? Se já tiver avaliações, ela só sai da lista e o histórico fica.`)) return;
                        try {
                          const r = await del(`/v1/venues/${ctx.venue}/pesquisa/atendentes/${a.id}`);
                          avisar(
                            r.apagado
                              ? "Removido."
                              : "Tem avaliações no histórico, então só saiu da lista do cliente.",
                            "ok",
                          );
                          await recarregar();
                        } catch (err) {
                          avisar(err.message, "erro");
                        }
                      },
                    }),
                  ]),
                ]),
              ),
            ),
          ]),
        ]),
  ]);

  return el("div", { classe: "pilha" }, [form, lista]);
}

/* ============ O prêmio ============ */

async function telaPremio(ctx, recarregar) {
  const [config, premios] = await Promise.all([
    get(`/v1/venues/${ctx.venue}/pesquisa/config`),
    get(`/v1/venues/${ctx.venue}/pesquisa/premios`),
  ]);

  const campos = {
    ativa: caixaDeMarcar("Pesquisa ligada", config.ativa),
    premio_ativo: caixaDeMarcar("Dar prêmio a quem responde", config.premio_ativo),
    perguntar_atendente: caixaDeMarcar("Perguntar quem atendeu", config.perguntar_atendente),
    perguntar_comentario: caixaDeMarcar("Pedir um comentário escrito", config.perguntar_comentario),
    saudacao: el("input", { value: config.saudacao ?? "", placeholder: "Como foi sua visita?" }),
    premio_titulo: el("input", { value: config.premio_titulo, required: true }),
    premio_regras: el("input", { value: config.premio_regras ?? "", placeholder: "Válido de terça a quinta, não acumula" }),
    premio_validade_dias: el("input", { type: "number", min: "1", max: "365", value: String(config.premio_validade_dias) }),
    agradecimento: el("input", { value: config.agradecimento ?? "", placeholder: "Obrigado! Te esperamos de novo." }),
  };

  const form = el("form", {
    classe: "cartao",
    onsubmit: async (e) => {
      e.preventDefault();
      const botao = form.querySelector("button[type=submit]");
      botao.disabled = true;
      try {
        await put(`/v1/venues/${ctx.venue}/pesquisa/config`, {
          ativa: campos.ativa.querySelector("input").checked,
          premio_ativo: campos.premio_ativo.querySelector("input").checked,
          perguntar_atendente: campos.perguntar_atendente.querySelector("input").checked,
          perguntar_comentario: campos.perguntar_comentario.querySelector("input").checked,
          saudacao: campos.saudacao.value.trim(),
          agradecimento: campos.agradecimento.value.trim(),
          premio_titulo: campos.premio_titulo.value.trim(),
          premio_regras: campos.premio_regras.value.trim(),
          premio_validade_dias: Number(campos.premio_validade_dias.value),
        });
        avisar("Ajustes salvos.", "ok");
        await recarregar();
      } catch (err) {
        avisar(err.message, "erro");
      } finally {
        botao.disabled = false;
      }
    },
  }, [
    el("h3", { texto: "Como a pesquisa se comporta" }),
    el("div", { classe: "grade-2", style: "margin-top:12px" }, [
      campos.ativa,
      campos.premio_ativo,
      campos.perguntar_atendente,
      campos.perguntar_comentario,
    ]),
    el("div", { classe: "grade", style: "margin-top:14px" }, [
      campo("Pergunta de abertura", campos.saudacao),
      campo("Mensagem de agradecimento", campos.agradecimento),
      campo("Qual é o prêmio", campos.premio_titulo),
      campo("Regras do prêmio", campos.premio_regras),
      campo("Validade do cupom (dias)", campos.premio_validade_dias),
    ]),
    el("p", {
      classe: "muted",
      style: "margin-top:8px",
      texto: "Mudar o prêmio não mexe nos cupons já entregues: cada um continua valendo o que prometeu a quem respondeu.",
    }),
    el("button", { classe: "btn btn-primario", type: "submit", texto: "Salvar", style: "margin-top:12px" }),
  ]);

  return el("div", { classe: "pilha" }, [form, cartaoResgate(ctx, recarregar), cartaoCupons(premios)]);
}

function cartaoResgate(ctx, recarregar) {
  const codigo = el("input", { placeholder: "Ex.: BYNZ4J", style: "text-transform:uppercase" });
  const resultado = el("div");

  async function resgatar() {
    limpar(resultado);
    try {
      const r = await post(`/v1/venues/${ctx.venue}/pesquisa/premios/resgatar`, { codigo: codigo.value });
      resultado.append(
        el("div", { classe: "aviso aviso-ok", style: "margin-top:10px" }, [
          el("strong", { texto: `✅  ${r.titulo}` }),
          el("p", { style: "margin:4px 0 0", texto: `Cupom ${r.codigo} baixado agora. Pode entregar.` }),
        ]),
      );
      codigo.value = "";
      await recarregar();
    } catch (e) {
      resultado.append(
        el("div", { classe: "aviso aviso-perigo", style: "margin-top:10px" }, [
          el("strong", { texto: "❌  Não pode entregar" }),
          el("p", { style: "margin:4px 0 0", texto: e.message }),
        ]),
      );
    }
  }

  return el("section", { classe: "cartao" }, [
    el("h3", { texto: "Baixar um cupom no balcão" }),
    el("p", {
      classe: "muted",
      texto: "Digite o código que o cliente mostrar. O sistema confere se vale e marca como usado na hora.",
    }),
    el("div", { classe: "linha-campos", style: "margin-top:12px" }, [
      el("label", { classe: "campo-rotulado", style: "flex:1" }, [el("span", { texto: "Código" }), codigo]),
      el("button", { classe: "btn btn-primario", type: "button", texto: "Conferir e baixar", onclick: resgatar }),
    ]),
    resultado,
  ]);
}

function cartaoCupons(premios) {
  const agora = Date.now();
  const abertos = premios.filter((p) => !p.resgatado_em && Date.parse(p.expira_em) > agora);
  const usados = premios.filter((p) => p.resgatado_em);

  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "Cupons emitidos" }),
        el("p", {
          classe: "muted",
          texto: `${abertos.length} em aberto · ${usados.length} já usados · ${premios.length} no total`,
        }),
      ]),
    ]),
    premios.length === 0
      ? el("p", { classe: "muted", texto: "Nenhum cupom emitido ainda." })
      : el("div", { classe: "rolagem-x", style: "margin-top:10px" }, [
          el("table", { classe: "planilha" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { texto: "Código" }),
                el("th", { texto: "Cliente" }),
                el("th", { classe: "col-num", texto: "Nota" }),
                el("th", { texto: "Situação" }),
                el("th", { texto: "Vale até" }),
              ]),
            ]),
            el(
              "tbody",
              {},
              premios.slice(0, 60).map((p) => {
                const vencido = !p.resgatado_em && Date.parse(p.expira_em) <= agora;
                return el("tr", {}, [
                  el("td", {}, [el("strong", { texto: p.codigo })]),
                  el("td", {}, [
                    el("span", { texto: p.cliente_nome || "Anônimo" }),
                    p.cliente_contato ? el("small", { classe: "muted", texto: p.cliente_contato }) : null,
                  ]),
                  el("td", { classe: "col-num", texto: p.nota == null ? "—" : String(p.nota) }),
                  el("td", {}, [
                    p.resgatado_em
                      ? etiqueta(`usado ${dataHora(p.resgatado_em)}`, "etiqueta-ok")
                      : vencido
                        ? etiqueta("vencido", "etiqueta-perigo")
                        : etiqueta("em aberto", "etiqueta-alerta"),
                  ]),
                  el("td", { texto: new Date(p.expira_em).toLocaleDateString("pt-BR") }),
                ]);
              }),
            ),
          ]),
        ]),
  ]);
}

/* ============ Convites ============ */

async function telaConvites(ctx, recarregar) {
  const convites = await get(`/v1/venues/${ctx.venue}/pesquisa/convites`);

  const telefone = el("input", { type: "tel", placeholder: "(65) 99999-0000", required: true });
  const nome = el("input", { placeholder: "Nome do cliente (opcional)" });
  const mensagem = el("input", { placeholder: "Deixe vazio para usar o texto padrão" });

  const form = el("form", {
    classe: "cartao",
    onsubmit: async (e) => {
      e.preventDefault();
      const botao = form.querySelector("button[type=submit]");
      botao.disabled = true;
      try {
        const r = await post(`/v1/venues/${ctx.venue}/pesquisa/convites`, {
          telefone: telefone.value,
          nome: nome.value.trim() || undefined,
          mensagem: mensagem.value.trim() || undefined,
        });
        avisar(
          r.enfileirado
            ? "Convite na fila — sai pelo WhatsApp da casa em instantes."
            : "Convite criado, mas o envio falhou. Confira o WhatsApp da casa em Ajustes.",
          r.enfileirado ? "ok" : "erro",
        );
        await recarregar();
      } catch (err) {
        avisar(err.message, "erro");
        botao.disabled = false;
      }
    },
  }, [
    el("h3", { texto: "Mandar a pesquisa para um cliente" }),
    el("p", {
      classe: "muted",
      texto: "Sai pelo WhatsApp da casa (o administrativo), nunca pelo número do agente. Cada link vale uma resposta só.",
    }),
    el("div", { classe: "grade", style: "margin-top:12px" }, [
      campo("WhatsApp com DDD", telefone),
      campo("Nome", nome),
      campo("Mensagem", mensagem),
    ]),
    el("button", { classe: "btn btn-primario", type: "submit", texto: "Enviar convite", style: "margin-top:12px" }),
  ]);

  const respondidos = convites.filter((c) => c.respondido_em).length;

  const lista = el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "Convites enviados" }),
        el("p", {
          classe: "muted",
          texto:
            convites.length === 0
              ? "Nenhum convite ainda."
              : `${respondidos} de ${convites.length} responderam (${Math.round((respondidos / convites.length) * 100)}%).`,
        }),
      ]),
    ]),
    convites.length === 0
      ? null
      : el("div", { classe: "rolagem-x", style: "margin-top:10px" }, [
          el("table", { classe: "planilha" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { texto: "Cliente" }),
                el("th", { texto: "WhatsApp" }),
                el("th", { texto: "Enviado" }),
                el("th", { texto: "Situação" }),
              ]),
            ]),
            el(
              "tbody",
              {},
              convites.slice(0, 80).map((c) =>
                el("tr", {}, [
                  el("td", { texto: c.nome || "—" }),
                  el("td", { texto: c.telefone }),
                  el("td", { texto: c.enviado_em ? dataHora(c.enviado_em) : "na fila" }),
                  el("td", {}, [
                    c.respondido_em
                      ? etiqueta(`respondeu ${dataHora(c.respondido_em)}`, "etiqueta-ok")
                      : etiqueta("aguardando"),
                  ]),
                ]),
              ),
            ),
          ]),
        ]),
  ]);

  return el("div", { classe: "pilha" }, [form, lista]);
}

/* ============ peças ============ */

function campo(rotulo, controle) {
  return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
}

function caixaDeMarcar(rotulo, marcado) {
  const entrada = el("input", { type: "checkbox", checked: marcado });
  return el("label", { classe: "check-linha" }, [entrada, el("span", { texto: rotulo })]);
}
