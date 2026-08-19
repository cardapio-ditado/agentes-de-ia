import { get, post, postArquivo, put } from "../api.js";
import { avisar, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Recebimento de mercadoria.
 *
 * Desenhada para a doca: de pé, com o entregador esperando, às vezes com a
 * mão suja e o celular na outra. Isso manda em tudo aqui — alvo de toque
 * grande, teclado numérico, e o mínimo de digitação possível. Toda decisão
 * que economiza um toque vale mais que qualquer enfeite.
 *
 * Dois caminhos, porque a casa compra de dois jeitos:
 *
 *   PEDIDO   encomendado antes; a tela mostra pedido x recebido lado a lado
 *            e destaca o que divergiu.
 *   AVULSA   comprou na rua e lança depois; a nota É o pedido, e não há
 *            divergência possível.
 *
 * A foto da nota preenche as linhas, mas NADA entra no estoque sem alguém
 * tocar em "Dar entrada". A IA transcreve; quem responde pelo estoque é a
 * pessoa que viu a mercadoria.
 */

/** Como cada casamento foi feito — a tela diz o quanto dá para confiar. */
const ORIGEM_DO_CASAMENTO = {
  codigo: ["código da nota", "etiqueta-ok"],
  apelido: ["já conhecido", "etiqueta-ok"],
  nome_exato: ["nome igual", "etiqueta-ok"],
  nome_parecido: ["parecido — confira", "etiqueta-alerta"],
  nenhum: ["escolha o insumo", "etiqueta-perigo"],
};

export async function recebimento(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);

  let locais = [];
  let insumos = [];
  try {
    [locais, insumos] = await Promise.all([
      get(`/v1/venues/${ctx.venue}/estoque-locais`),
      get(`/v1/venues/${ctx.venue}/insumos`),
    ]);
  } catch (e) {
    conteudo.append(vazio("Estoque indisponível", e.message));
    return;
  }

  if (locais.length === 0) {
    conteudo.append(
      vazio(
        "Nenhum local de estoque",
        "Cadastre onde a mercadoria fica (cozinha, bar, depósito) antes de receber.",
      ),
    );
    return;
  }

  /** Estado da conferência em andamento. */
  let linhas = [];
  let compra = null;

  desenharAbertura();

  function desenharAbertura() {
    limpar(conteudo);
    compra = null;
    linhas = [];

    const seletorLocal = el(
      "select",
      { classe: "select" },
      locais.map((l) => el("option", { value: l.id, texto: l.nome, selected: l.principal })),
    );
    const arquivo = el("input", {
      type: "file",
      accept: "image/*",
      // `capture` faz o celular abrir a câmera direto, sem passar pela
      // galeria — um toque a menos com o entregador esperando.
      capture: "environment",
      hidden: true,
      onchange: (ev) => lerFoto(ev.target.files?.[0], seletorLocal.value),
    });

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Receber mercadoria" }),
            el("p", {
              classe: "muted",
              texto: "Fotografe a nota. Confira o que chegou. Dê entrada.",
            }),
          ]),
        ]),

        el("div", { classe: "cartao" }, [
          el("label", { texto: "Onde vai guardar" }),
          seletorLocal,

          arquivo,
          el("button", {
            classe: "btn btn-primario btn-grande",
            type: "button",
            texto: "📷  Fotografar a nota",
            onclick: () => arquivo.click(),
          }),

          el("p", { classe: "muted", texto: "ou" }),
          el("button", {
            classe: "btn",
            type: "button",
            texto: "Lançar sem foto",
            onclick: () => comecarNaMao(seletorLocal.value),
          }),
        ]),
      ]),
    );
  }

  async function lerFoto(arquivo, localId) {
    if (!arquivo) return;

    limpar(conteudo).append(
      el("div", { classe: "cartao" }, [
        el("p", { texto: "Lendo a nota…" }),
        el("p", { classe: "muted", texto: "Leva uns segundos. Pode guardar o celular." }),
      ]),
    );

    try {
      const lida = await postArquivo(
        `/v1/venues/${ctx.venue}/compras/ler-nota?media_type=${encodeURIComponent(arquivo.type)}`,
        arquivo,
      );
      linhas = lida.linhas.map((l) => ({
        ...l,
        // O que a nota diz é o ponto de partida do que chegou: quase sempre
        // veio o que está escrito, e quem confere só ajusta a exceção.
        quantidadeRecebida: l.quantidade,
        custoRecebido: l.valorUnitario,
        motivo: "",
      }));
      desenharConferencia({
        localId,
        origem: "avulsa",
        fornecedor: lida.fornecedor,
        documento: lida.documento,
        avisos: lida.avisos,
        somaConfere: lida.soma_confere,
        somaDasLinhas: lida.soma_das_linhas,
        valorTotalNota: lida.valor_total,
        extracaoIa: lida,
      });
    } catch (e) {
      limpar(conteudo).append(
        vazio("Não deu para ler a nota", e.message),
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Tentar de novo",
          onclick: desenharAbertura,
        }),
      );
    }
  }

  function comecarNaMao(localId) {
    linhas = [];
    desenharConferencia({ localId, origem: "avulsa", avisos: [], somaConfere: true });
  }

  function desenharConferencia(ctxConferencia) {
    limpar(conteudo);

    const lista = el("div", { classe: "lista" });
    const total = el("strong", {});

    const recalcular = () => {
      const soma = linhas.reduce(
        (t, l) => t + (Number(l.quantidadeRecebida) || 0) * (Number(l.custoRecebido) || 0),
        0,
      );
      total.textContent = dinheiro(soma);
    };

    function desenharLinhas() {
      limpar(lista);
      if (linhas.length === 0) {
        lista.append(vazio("Nenhum item", "Toque em “Adicionar item” para lançar na mão."));
      }
      linhas.forEach((linha, i) => lista.append(cartaoDaLinha(linha, i)));
      recalcular();
    }

    function cartaoDaLinha(linha, indice) {
      const [rotulo, variante] = ORIGEM_DO_CASAMENTO[linha.como] ?? ORIGEM_DO_CASAMENTO.nenhum;

      const seletorInsumo = el(
        "select",
        {
          classe: "select",
          onchange: (ev) => {
            linha.insumoId = ev.target.value || null;
            // Corrigir o casamento ENSINA o sistema: a próxima nota deste
            // fornecedor com a mesma grafia entra sozinha.
            if (linha.insumoId && linha.descricao) {
              post(`/v1/venues/${ctx.venue}/insumos/${linha.insumoId}/apelido`, {
                descricao: linha.descricao,
              }).catch(() => {
                /* aprender é bônus; não pode travar a conferência */
              });
            }
          },
        },
        [
          el("option", { value: "", texto: "— escolha o insumo —" }),
          ...insumos.map((i) =>
            el("option", { value: i.id, texto: i.nome, selected: i.id === linha.insumoId }),
          ),
        ],
      );

      const campoQtd = el("input", {
        classe: "campo-numero",
        type: "number",
        // inputmode decimal: o teclado do celular abre com vírgula, sem a
        // pessoa precisar procurar.
        inputmode: "decimal",
        step: "0.001",
        min: "0",
        value: linha.quantidadeRecebida ?? "",
        onchange: (ev) => {
          linha.quantidadeRecebida = ev.target.value === "" ? null : Number(ev.target.value);
          desenharLinhas();
        },
      });

      const campoCusto = el("input", {
        classe: "campo-numero",
        type: "number",
        inputmode: "decimal",
        step: "0.01",
        min: "0",
        value: linha.custoRecebido ?? "",
        onchange: (ev) => {
          linha.custoRecebido = ev.target.value === "" ? null : Number(ev.target.value);
          recalcular();
        },
      });

      const divergente =
        linha.quantidade != null &&
        linha.quantidadeRecebida != null &&
        Number(linha.quantidade) !== Number(linha.quantidadeRecebida);

      return el("article", { classe: `cartao ${divergente ? "cartao-atencao" : ""}` }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("strong", { texto: linha.descricao || "Item novo" }),
            linha.insumoNome
              ? el("p", { classe: "muted", texto: `→ ${linha.insumoNome}` })
              : null,
          ]),
          etiqueta(rotulo, variante),
        ].filter(Boolean)),

        // Só aparece quando o casamento não é certo: quem confere não deve
        // reler o que já está resolvido.
        linha.confianca < 0.9 ? seletorInsumo : null,

        el("div", { classe: "linha-campos" }, [
          el("label", {}, [
            el("span", { texto: linha.quantidade != null ? `Chegou (nota: ${linha.quantidade})` : "Chegou" }),
            campoQtd,
          ]),
          el("label", {}, [el("span", { texto: "R$ por unidade" }), campoCusto]),
        ]),

        divergente
          ? el("input", {
              classe: "campo",
              placeholder: "Por que diferente? (peso do açougue, faltou caixa…)",
              value: linha.motivo ?? "",
              onchange: (ev) => {
                linha.motivo = ev.target.value;
              },
            })
          : null,

        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Remover",
          onclick: () => {
            linhas.splice(indice, 1);
            desenharLinhas();
          },
        }),
      ].filter(Boolean));
    }

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Confira o que chegou" }),
            ctxConferencia.fornecedor
              ? el("p", { classe: "muted", texto: ctxConferencia.fornecedor })
              : null,
          ].filter(Boolean)),
          el("button", {
            classe: "btn btn-peq",
            type: "button",
            texto: "Cancelar",
            onclick: desenharAbertura,
          }),
        ]),

        // Os avisos da leitura vêm antes da lista: são o que a pessoa
        // precisa saber ANTES de conferir, não depois.
        ...(ctxConferencia.avisos ?? []).map((a) =>
          el("p", { classe: "aviso aviso-alerta", texto: `⚠ ${a}` }),
        ),

        ctxConferencia.somaConfere === false
          ? el("p", {
              classe: "aviso aviso-perigo",
              texto:
                `A soma dos itens (${dinheiro(ctxConferencia.somaDasLinhas)}) não bate com o total ` +
                `da nota (${dinheiro(ctxConferencia.valorTotalNota)}). Pode ter faltado uma linha — confira a nota.`,
            })
          : null,

        lista,

        el("button", {
          classe: "btn",
          type: "button",
          texto: "+ Adicionar item",
          onclick: () => {
            linhas.push({
              descricao: "",
              insumoId: null,
              insumoNome: null,
              como: "nenhum",
              confianca: 0,
              quantidade: null,
              quantidadeRecebida: null,
              custoRecebido: null,
              motivo: "",
            });
            desenharLinhas();
          },
        }),

        el("div", { classe: "cartao cartao-total" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("span", { texto: "Total do que chegou" }),
            total,
          ]),
          el("button", {
            classe: "btn btn-primario btn-grande",
            type: "button",
            texto: "Dar entrada no estoque",
            onclick: (ev) => darEntrada(ev.target, ctxConferencia),
          }),
          el("p", {
            classe: "muted",
            texto: "Depois disso o estoque se move. Para corrigir, só por contagem.",
          }),
        ]),
      ].filter(Boolean)),
    );

    desenharLinhas();
  }

  async function darEntrada(botao, ctxConferencia) {
    const semInsumo = linhas.filter((l) => !l.insumoId);
    if (semInsumo.length > 0) {
      return avisar(
        `${semInsumo.length} item(ns) sem insumo escolhido. Escolha ou remova antes de dar entrada.`,
        "erro",
      );
    }
    if (linhas.length === 0) return avisar("Nenhum item para dar entrada.", "erro");

    botao.disabled = true;
    botao.textContent = "Dando entrada…";
    try {
      const itens = linhas.map((l) => ({
        insumo_id: l.insumoId,
        descricao_nota: l.descricao || null,
        quantidade_recebida: l.quantidadeRecebida,
        custo_unitario_recebido: l.custoRecebido,
        divergencia_motivo: l.motivo || null,
      }));

      if (!compra) {
        compra = await post(`/v1/venues/${ctx.venue}/compras`, {
          local_id: ctxConferencia.localId,
          origem: ctxConferencia.origem,
          fornecedor: ctxConferencia.fornecedor ?? null,
          documento: ctxConferencia.documento ?? null,
          extracao_ia: ctxConferencia.extracaoIa ?? null,
          itens,
        });
      } else {
        await put(`/v1/venues/${ctx.venue}/compras/${compra.id}/itens`, { itens });
      }

      const r = await post(`/v1/venues/${ctx.venue}/compras/${compra.id}/receber`, {});
      mostrarResultado(r.divergencias ?? []);
    } catch (e) {
      avisar(e.message, "erro");
      botao.disabled = false;
      botao.textContent = "Dar entrada no estoque";
    }
  }

  function mostrarResultado(divergencias) {
    limpar(conteudo).append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cartao" }, [
          el("h2", { texto: "✓ Entrada registrada" }),
          el("p", { classe: "muted", texto: "O estoque já está atualizado." }),
        ]),

        // As divergências aparecem AQUI e não noutra tela: quem acabou de
        // receber é quem pode cobrar o fornecedor, e agora é a única hora em
        // que ele ainda está por perto.
        divergencias.length > 0
          ? el("div", { classe: "cartao cartao-atencao" }, [
              el("h3", { texto: "Diferenças para conversar com o fornecedor" }),
              ...divergencias.map((d) =>
                el("p", {
                  texto:
                    `${d.insumo_nome}: pediu ${d.quantidade_pedida}, veio ${d.quantidade_recebida} ` +
                    `(${d.diferenca_pct}%)${d.motivo ? ` — ${d.motivo}` : ""}`,
                }),
              ),
            ])
          : null,

        el("button", {
          classe: "btn btn-primario btn-grande",
          type: "button",
          texto: "Receber outra nota",
          onclick: desenharAbertura,
        }),
      ].filter(Boolean)),
    );
  }
}
