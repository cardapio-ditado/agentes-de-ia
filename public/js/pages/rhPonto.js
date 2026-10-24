import { del, get, patch, post } from "../api.js";
import { avisar, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";
import { botaoDePdf, imprimirRelatorio } from "../relatorio.js";

/**
 * RH — Fase 3: o ponto do dia, do lado do gestor.
 *
 * O tablet registra; esta tela confere. Uma linha por pessoa que foi escalada
 * ou que bateu ponto — quem não fez nenhum dos dois não é notícia e não
 * aparece.
 *
 * Correção nunca apaga por baixo: vira batida com autor e motivo. É essa
 * linha que responde "por que o ponto da Cida mudou" numa discussão seis
 * meses depois.
 */

const NOME_DA_BATIDA = {
  entrada: "Entrada",
  pausa: "Pausa",
  volta: "Volta",
  saida: "Saída",
};

const NOME_DA_SITUACAO = {
  trabalha: "Escalado",
  folga: "Folga",
  ferias: "Férias",
  atestado: "Atestado",
  falta: "Falta",
};

/** Cinco minutos de tolerância: relógio de tablet não é ponto eletrônico. */
const TOLERANCIA_MIN = 5;

export function criarPonto(corpo, ctx) {
  let dia = null;
  let dados = null;
  let abertaId = null;
  let mostrandoTotens = false;
  let totens = [];

  return { desenhar, recarregar };

  async function recarregar() {
    try {
      const busca = dia ? `?dia=${dia}` : "";
      dados = await get(`/v1/venues/${ctx.venue}/rh/ponto${busca}`);
      dia = dados.dia;
      if (mostrandoTotens) totens = await get(`/v1/venues/${ctx.venue}/rh/totens`);
    } catch (e) {
      limpar(corpo).append(vazio("Não deu para carregar o ponto", e.message));
      return;
    }
    desenhar();
  }

  function desenhar() {
    if (!dados) {
      void recarregar();
      return;
    }
    limpar(corpo);
    corpo.append(cabecalho());
    if (mostrandoTotens) corpo.append(painelDeTotens());

    if (dados.pessoas.length === 0) {
      corpo.append(
        vazio(
          "Nada neste dia",
          "Ninguém escalado e ninguém bateu ponto. Monte a escala na aba ao lado, ou espere as batidas do tablet.",
        ),
      );
      return;
    }

    corpo.append(tabela());
    if (abertaId) corpo.append(detalhe());
  }

  async function resumoDoMesEmPdf(mes) {
    let r;
    try {
      r = await get(`/v1/venues/${ctx.venue}/rh/resumo?mes=${mes}`);
    } catch (e) {
      avisar(e.message, "erro");
      return;
    }
    const horas = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;
    const nomeDoMes = new Date(`${mes}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    imprimirRelatorio({
      tipo: "RH",
      titulo: "Resumo do mês para a contabilidade",
      periodo: r.de ? `${nomeDoMes} (${diaBr(r.de)} a ${diaBr(r.ate)})` : nomeDoMes,
      selos: [
        { valor: String(r.linhas.length), rotulo: "pessoas" },
        { valor: String(r.linhas.reduce((t, l) => t + l.faltas, 0)), rotulo: "faltas", ruim: r.linhas.some((l) => l.faltas > 0) },
        { valor: dinheiro(r.linhas.reduce((t, l) => t + l.gorjeta, 0)), rotulo: "gorjeta no mês" },
      ],
      secoes: [{
        nota: "Dias, horas, faltas e atrasos saem do ponto do tablet; a gorjeta, do acerto semanal. O cálculo da folha continua com a contabilidade.",
        colunas: [
          { rotulo: "Pessoa" }, { rotulo: "Cargo" }, { rotulo: "Dias", num: true }, { rotulo: "Horas", num: true },
          { rotulo: "Noturnas", num: true }, { rotulo: "Faltas", num: true }, { rotulo: "Atrasos", num: true },
          { rotulo: "Férias", num: true }, { rotulo: "Gorjeta", num: true },
        ],
        linhas: r.linhas.map((l) => ({
          destaque: l.faltas > 0,
          celulas: [
            l.nome, [l.cargo, l.vinculo].filter(Boolean).join(" · "), String(l.dias_trabalhados), horas(l.minutos_trabalhados),
            horas(l.minutos_noturnos), String(l.faltas), l.atrasos ? `${l.atrasos} (${l.minutos_de_atraso} min)` : "0",
            l.dias_de_ferias ? `${l.dias_de_ferias} d` : "—", dinheiro(l.gorjeta),
          ],
        })),
        vazio: "Ninguém com movimento no mês.",
      }],
      assinaturas: ["Responsável pela casa"],
      arquivo: `rh-resumo-${mes}`,
      paisagem: true,
    });
  }

  /* ================= Cabeçalho ================= */

  function cabecalho() {
    const naCasa = dados.pessoas.filter((p) => p.resumo.aberto).length;
    const atrasados = dados.pessoas.filter((p) => (p.atraso ?? 0) > TOLERANCIA_MIN).length;
    const faltas = dados.pessoas.filter((p) => p.faltou).length;

    return el("div", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: `Ponto de ${diaBr(dados.dia)}` }),
          el("p", {
            classe: "muted",
            texto: `${naCasa} na casa agora · ${atrasados} atraso(s) · ${faltas} falta(s). O dia da casa segue a virada configurada nos Ajustes.`,
          }),
        ]),
        el("div", { classe: "reserva-acoes" }, [
          el("button", { classe: "btn btn-peq", type: "button", texto: "‹ Ontem", onclick: () => trocarDia(-1) }),
          el("button", { classe: "btn btn-peq", type: "button", texto: "Hoje", onclick: () => trocarDia(null) }),
          el("button", { classe: "btn btn-peq", type: "button", texto: "Amanhã ›", onclick: () => trocarDia(1) }),
        ]),
      ]),
      el("div", { classe: "reserva-acoes" }, [
        // O mês do contador: o mesmo resumo que já existia para colar no
        // WhatsApp, agora em PDF — e do mês deste dia, para o fechamento do
        // mês passado sair navegando até ele.
        botaoDePdf(() => resumoDoMesEmPdf(String(dados.dia).slice(0, 7)), "Resumo do mês"),
        el("button", {
          classe: "btn",
          type: "button",
          texto: mostrandoTotens ? "Fechar tablets" : "Tablets do ponto",
          onclick: async () => {
            mostrandoTotens = !mostrandoTotens;
            await recarregar();
          },
        }),
      ]),
    ]);
  }

  function trocarDia(passo) {
    dia = passo === null ? null : somarDias(dados.dia, passo);
    abertaId = null;
    void recarregar();
  }

  /* ================= A tabela do dia ================= */

  function tabela() {
    return el("div", { classe: "rolagem-x" }, [
      el("table", { classe: "planilha" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { texto: "Pessoa" }),
            el("th", { texto: "Escalado" }),
            el("th", { texto: "Entrada" }),
            el("th", { texto: "Saída" }),
            el("th", { classe: "col-num", texto: "Trabalhado" }),
            el("th", { classe: "col-num", texto: "Noturno" }),
            el("th", { texto: "Situação" }),
          ]),
        ]),
        el(
          "tbody",
          {},
          dados.pessoas.map((pessoa) => linha(pessoa)),
        ),
      ]),
    ]);
  }

  function linha(pessoa) {
    const atrasado = (pessoa.atraso ?? 0) > TOLERANCIA_MIN;
    const aberta = abertaId === pessoa.atendente_id;

    return el(
      "tr",
      {
        style: `cursor:pointer;${aberta ? "outline:2px solid var(--marca);outline-offset:-2px" : ""}`,
        classe: pessoa.faltou || atrasado ? "linha-atencao" : "",
        onclick: () => {
          abertaId = aberta ? null : pessoa.atendente_id;
          desenhar();
          if (!aberta) corpo.querySelector(".detalhe-ponto")?.scrollIntoView({ behavior: "smooth", block: "center" });
        },
      },
      [
        el("td", {}, [
          el("strong", { texto: pessoa.nome }),
          pessoa.batidas.length ? el("small", { classe: "muted", texto: `${pessoa.batidas.length} batida(s)` }) : null,
        ]),
        el("td", { texto: pessoa.escalado ?? "—" }),
        el("td", {}, [
          document.createTextNode(pessoa.resumo.primeira_entrada ?? "—"),
          pessoa.atraso !== null && pessoa.atraso !== 0
            ? el("small", {
                classe: "muted",
                texto: pessoa.atraso > 0 ? `${pessoa.atraso} min depois` : `${Math.abs(pessoa.atraso)} min antes`,
              })
            : null,
        ]),
        el("td", { texto: pessoa.resumo.ultima_saida ?? (pessoa.resumo.aberto ? "na casa" : "—") }),
        el("td", { classe: "col-num", texto: emHoras(pessoa.resumo.minutos_trabalhados) }),
        el("td", { classe: "col-num", texto: pessoa.resumo.minutos_noturnos ? emHoras(pessoa.resumo.minutos_noturnos) : "—" }),
        el("td", {}, [
          pessoa.faltou
            ? etiqueta("faltou", "etiqueta-alerta")
            : pessoa.resumo.aberto
              ? etiqueta("na casa", "etiqueta-ok")
              : atrasado
                ? etiqueta(`atraso de ${pessoa.atraso} min`, "etiqueta-alerta")
                : pessoa.batidas.length
                  ? etiqueta("fechado", "")
                  : etiqueta(NOME_DA_SITUACAO[pessoa.situacao_escala] ?? "sem escala", ""),
        ]),
      ],
    );
  }

  /* ================= Detalhe e correção ================= */

  function detalhe() {
    const pessoa = dados.pessoas.find((p) => p.atendente_id === abertaId);
    if (!pessoa) return el("div", {});

    const tipo = el(
      "select",
      { classe: "select" },
      Object.entries(NOME_DA_BATIDA).map(([id, nome]) => el("option", { value: id, texto: nome })),
    );
    const hora = el("input", { classe: "input", type: "time", value: "18:00" });
    const motivo = el("input", { classe: "input", type: "text", placeholder: "Esqueceu de bater na entrada" });

    return el("section", { classe: "cartao detalhe-ponto" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: `${pessoa.nome} · ${diaBr(dados.dia)}` }),
          el("p", {
            classe: "muted",
            texto: `Trabalhado ${emHoras(pessoa.resumo.minutos_trabalhados)} · pausa ${emHoras(
              pessoa.resumo.minutos_pausa,
            )} · noturno ${emHoras(pessoa.resumo.minutos_noturnos)}.`,
          }),
        ]),
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Fechar",
          onclick: () => {
            abertaId = null;
            desenhar();
          },
        }),
      ]),

      pessoa.batidas.length
        ? el(
            "div",
            { classe: "tabela" },
            pessoa.batidas.map((batida) =>
              el("div", { classe: "linha-tabela" }, [
                el("div", { classe: "linha-principal", style: "flex:1" }, [
                  el("strong", { texto: `${NOME_DA_BATIDA[batida.tipo] ?? batida.tipo} às ${horaDe(batida.momento)}` }),
                  el("span", {
                    classe: "muted",
                    texto:
                      batida.origem === "gestor"
                        ? `lançada por ${batida.editado_por ?? "gerência"}${batida.motivo ? ` · ${batida.motivo}` : ""}`
                        : "batida no tablet",
                  }),
                ]),
                batida.origem === "gestor" ? etiqueta("corrigida", "etiqueta-alerta") : null,
                el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: "Corrigir hora",
                  onclick: () => corrigir(batida),
                }),
                el("button", {
                  classe: "btn btn-peq btn-perigo",
                  type: "button",
                  texto: "Apagar",
                  onclick: async (e) => {
                    if (!confirm("Apagar esta batida? A hora trabalhada é recalculada.")) return;
                    e.target.disabled = true;
                    try {
                      await del(`/v1/venues/${ctx.venue}/rh/ponto/${batida.id}`);
                      avisar("Batida apagada.", "ok");
                      await recarregar();
                    } catch (err) {
                      avisar(err.message, "erro");
                      e.target.disabled = false;
                    }
                  },
                }),
              ]),
            ),
          )
        : el("p", { classe: "muted", texto: "Nenhuma batida neste dia." }),

      el("h4", { texto: "Lançar batida que faltou", style: "margin:18px 0 0" }),
      el("p", {
        classe: "muted",
        texto: "Fica registrado como lançamento da gerência, com seu nome e o motivo — é isso que vale numa discussão depois.",
      }),
      el("div", { classe: "grade" }, [
        el("div", { classe: "campo" }, [el("label", { texto: "O quê" }), tipo]),
        el("div", { classe: "campo" }, [el("label", { texto: "Hora" }), hora]),
        el("div", { classe: "campo" }, [el("label", { texto: "Motivo" }), motivo]),
      ]),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Lançar",
          onclick: async (e) => {
            if (!motivo.value.trim()) {
              avisar("Escreva o motivo do lançamento.", "erro");
              return;
            }
            e.target.disabled = true;
            try {
              await post(`/v1/venues/${ctx.venue}/rh/ponto`, {
                atendente_id: pessoa.atendente_id,
                dia: dados.dia,
                tipo: tipo.value,
                hora: hora.value,
                motivo: motivo.value.trim(),
              });
              avisar("Batida lançada.", "ok");
              await recarregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      ]),
    ]);
  }

  async function corrigir(batida) {
    const novaHora = prompt("Nova hora (formato 18:30):", horaDe(batida.momento));
    if (!novaHora) return;
    const porque = prompt("Motivo da correção:");
    if (!porque) {
      avisar("Sem motivo, a correção não é registrada.", "erro");
      return;
    }
    try {
      // A hora digitada é a da casa; o servidor guarda o instante. Mandamos a
      // data do dia junto para não depender do fuso do navegador.
      await patch(`/v1/venues/${ctx.venue}/rh/ponto/${batida.id}`, {
        momento: `${dados.dia}T${novaHora}:00`,
        motivo: porque,
      });
      avisar("Batida corrigida.", "ok");
      await recarregar();
    } catch (e) {
      avisar(e.message, "erro");
    }
  }

  /* ================= Tablets ================= */

  function painelDeTotens() {
    const nome = el("input", { classe: "input", type: "text", placeholder: "Tablet da cozinha" });

    return el("section", { classe: "cartao" }, [
      el("h3", { texto: "Tablets do ponto" }),
      el("p", {
        classe: "muted",
        texto:
          "Abra o endereço no tablet uma vez e deixe a página aberta. Quem tiver o endereço bate ponto, então não mande em grupo — se vazar, desative aqui e crie outro.",
      }),
      totens.length
        ? el(
            "div",
            { classe: "tabela" },
            totens.map((t) =>
              el("div", { classe: "linha-tabela" }, [
                el("div", { classe: "linha-principal", style: "flex:1;min-width:220px" }, [
                  el("strong", { texto: t.nome }),
                  el("span", {
                    classe: "muted",
                    style: "word-break:break-all",
                    texto: `${location.origin}/ponto/${t.token}`,
                  }),
                  el("span", {
                    classe: "muted",
                    texto: t.ultimo_uso_em ? `último uso em ${dataBr(t.ultimo_uso_em)}` : "nunca usado",
                  }),
                ]),
                t.ativo ? null : etiqueta("desativado", ""),
                el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: "Copiar link",
                  onclick: async () => {
                    try {
                      await navigator.clipboard.writeText(`${location.origin}/ponto/${t.token}`);
                      avisar("Link copiado. Abra no tablet e deixe a página aberta.", "ok");
                    } catch {
                      avisar("Copie o endereço que está na tela.", "erro");
                    }
                  },
                }),
                el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: t.ativo ? "Desativar" : "Reativar",
                  onclick: async (e) => {
                    e.target.disabled = true;
                    try {
                      await patch(`/v1/venues/${ctx.venue}/rh/totens/${t.id}`, { ativo: !t.ativo });
                      await recarregar();
                    } catch (err) {
                      avisar(err.message, "erro");
                      e.target.disabled = false;
                    }
                  },
                }),
                el("button", {
                  classe: "btn btn-peq btn-perigo",
                  type: "button",
                  texto: "Apagar",
                  onclick: async (e) => {
                    if (!confirm("Apagar este tablet? O endereço dele para de funcionar na hora.")) return;
                    e.target.disabled = true;
                    try {
                      await del(`/v1/venues/${ctx.venue}/rh/totens/${t.id}`);
                      avisar("Tablet apagado.", "ok");
                      await recarregar();
                    } catch (err) {
                      avisar(err.message, "erro");
                      e.target.disabled = false;
                    }
                  },
                }),
              ]),
            ),
          )
        : el("p", { classe: "muted", texto: "Nenhum tablet cadastrado ainda." }),
      el("div", { classe: "grade" }, [el("div", { classe: "campo" }, [el("label", { texto: "Nome do tablet" }), nome])]),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Criar tablet",
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              const t = await post(`/v1/venues/${ctx.venue}/rh/totens`, { nome: nome.value.trim() });
              avisar(`Tablet criado. Abra ${t.endereco} no aparelho.`, "ok");
              await recarregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      ]),
    ]);
  }
}

/* ================= Miudezas ================= */

function somarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diaBr(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

function dataBr(iso) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function horaDe(iso) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function emHoras(minutos) {
  const m = Number(minutos) || 0;
  const h = Math.floor(Math.abs(m) / 60);
  const resto = Math.abs(m) % 60;
  const sinal = m < 0 ? "-" : "";
  return resto === 0 ? `${sinal}${h}h` : `${sinal}${h}h${String(resto).padStart(2, "0")}`;
}
