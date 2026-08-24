import { del, get, patch, post, put } from "../api.js";
import { avisar, buscador, dataHora, dinheiro, el, etiqueta, ICONES, indicador, limpar, vazio } from "../ui.js";

/**
 * Compras — a tela cheia, no desenho do Gorjeta.
 *
 * Indicadores do mês em cima, filtros no meio, e a tabela embaixo com TUDO
 * que uma compra tem: fornecedor, documento, data, destino, itens, valor,
 * situação — e as AÇÕES na própria linha. Receber mercadoria fica ao lado
 * da compra: o caminhão chegou, acha-se o pedido, toca em Receber e confere
 * ali. A tela "Receber" continua existindo para a doca (foto da nota e
 * compra avulsa), mas o caminho pedido→entrega mora aqui.
 */

const SITUACAO = {
  rascunho: ["montando", ""],
  pedido: ["aguardando entrega", "etiqueta-alerta"],
  recebida: ["recebida", "etiqueta-ok"],
  cancelada: ["cancelada", ""],
};

/** Valor da compra para a lista: o real quando recebida, o estimado antes. */
function valorDaCompra(c) {
  if (Number(c.valor_total) > 0) return Number(c.valor_total);
  return (c.compra_itens ?? []).reduce(
    (t, it) => t + Number(it.quantidade_pedida ?? 0) * Number(it.custo_unitario_pedido ?? 0),
    0,
  );
}

function dataCurta(iso) {
  return iso ? iso.split("-").reverse().join("/") : "—";
}

import { recebimento } from "./recebimento.js";

/**
 * Compras e recebimento na MESMA tela, em abas.
 *
 * Eram duas entradas de menu, e a separação era do código, não da vida: quem
 * monta o pedido é quem confere quando o caminhão chega, e o recebimento é o
 * segundo tempo da mesma jogada. Menu é mapa do trabalho de quem usa — cada
 * entrada a mais é uma decisão a mais para quem só quer dar entrada na nota.
 */
export async function compras(raiz, ctx) {
  let abaAtual = "pedidos";
  const corpo = el("div", {});

  const ABAS = [
    ["pedidos", "Pedidos"],
    ["receber", "Receber mercadoria"],
  ];
  const barra = el(
    "div",
    { classe: "abas" },
    ABAS.map(([id, rotulo]) =>
      el("button", {
        classe: `aba ${id === abaAtual ? "aba-ativa" : ""}`.trim(),
        type: "button",
        texto: rotulo,
        "data-aba": id,
        onclick: async () => {
          abaAtual = id;
          for (const b of barra.querySelectorAll("[data-aba]")) {
            b.classList.toggle("aba-ativa", b.dataset.aba === id);
          }
          limpar(corpo);
          if (id === "receber") await recebimento(corpo, ctx);
          else await paginaPedidos(corpo, ctx);
        },
      }),
    ),
  );

  raiz.append(el("div", { classe: "pilha" }, [barra, corpo]));
  await paginaPedidos(corpo, ctx);
}

async function paginaPedidos(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);

  /** Linhas vindas da sugestão, esperando o formulário abrir com elas. */
  let prePreenchimento = null;
  let filtroStatus = "";
  let filtroTexto = "";

  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let lista, locais, insumos, fornecedoresLista;
    try {
      [lista, locais, insumos, fornecedoresLista] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/compras`),
        get(`/v1/venues/${ctx.venue}/estoque-locais`),
        get(`/v1/venues/${ctx.venue}/insumos`),
        get(`/v1/venues/${ctx.venue}/fornecedores`),
      ]);
    } catch (e) {
      limpar(conteudo).append(vazio("Compras indisponíveis", e.message));
      return;
    }
    limpar(conteudo);

    // A sugestão aceita virou pedido: abre direto no formulário preenchido.
    if (prePreenchimento) {
      const linhas = prePreenchimento;
      prePreenchimento = null;
      formularioPedido(linhas);
      return;
    }

    // ---- Indicadores do mês (o desenho do Gorjeta) ----
    const mesAtual = new Date().toISOString().slice(0, 7);
    const doMes = lista.filter((c) => (c.data_compra ?? c.created_at ?? "").startsWith(mesAtual));
    const aguardando = lista.filter((c) => c.status === "pedido");
    const recebidasMes = doMes.filter((c) => c.status === "recebida");
    const valorAguardando = aguardando.reduce((t, c) => t + valorDaCompra(c), 0);
    const valorRecebidoMes = recebidasMes.reduce((t, c) => t + Number(c.valor_total), 0);

    // ---- Filtros ----
    const busca = el("input", {
      classe: "campo",
      placeholder: "🔍  Fornecedor ou documento…",
      style: "flex:2",
      value: filtroTexto,
    });
    const seletorStatus = el("select", { classe: "select", style: "flex:1" }, [
      el("option", { value: "", texto: "Todas as situações" }),
      el("option", { value: "pedido", texto: "Aguardando entrega", selected: filtroStatus === "pedido" }),
      el("option", { value: "recebida", texto: "Recebidas", selected: filtroStatus === "recebida" }),
      el("option", { value: "rascunho", texto: "Montando", selected: filtroStatus === "rascunho" }),
      el("option", { value: "cancelada", texto: "Canceladas", selected: filtroStatus === "cancelada" }),
    ]);

    const tabela = el("div", { classe: "rolagem-x" });
    const norm = (t) => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

    const desenharTabela = () => {
      filtroTexto = busca.value;
      filtroStatus = seletorStatus.value;
      const alvo = norm(filtroTexto.trim());
      let filtradas = lista;
      if (filtroStatus) filtradas = filtradas.filter((c) => c.status === filtroStatus);
      if (alvo) {
        filtradas = filtradas.filter(
          (c) => norm(c.fornecedor).includes(alvo) || norm(c.documento).includes(alvo),
        );
      }
      limpar(tabela);
      if (filtradas.length === 0) {
        tabela.append(vazio("Nenhuma compra aqui", filtroStatus || alvo ? "Ajuste os filtros." : "O primeiro pedido leva um minuto."));
        return;
      }
      // Planilha de verdade, como no Gorjeta: colunas fixas, uma compra por
      // linha, e o olho abre os itens da nota.
      tabela.append(
        el("table", { classe: "planilha" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { texto: "Fornecedor" }),
              el("th", { texto: "Nº nota" }),
              el("th", { texto: "Pedido" }),
              el("th", { texto: "Previsto" }),
              el("th", { texto: "Recebido" }),
              el("th", { classe: "col-num", texto: "Valor" }),
              el("th", { texto: "Situação" }),
              el("th", { texto: "Ações" }),
            ]),
          ]),
          el("tbody", {}, filtradas.map(linhaCompra)),
        ]),
      );
    };
    busca.addEventListener("input", desenharTabela);
    seletorStatus.addEventListener("change", desenharTabela);

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Compras" }),
            el("p", { classe: "muted", texto: "Pedido, entrega e conferência — tudo na mesma linha." }),
          ]),
          el("div", { classe: "linha-campos" }, [
            el("button", { classe: "btn", type: "button", texto: "✨ Sugerir pedido", onclick: sugerirPedido }),
            el("button", { classe: "btn btn-primario", type: "button", texto: "+ Novo pedido", onclick: () => formularioPedido() }),
          ]),
        ]),
        el("div", { classe: "grade" }, [
          indicador({
            rotulo: "Compras no mês",
            valor: String(doMes.length),
            nota: `${recebidasMes.length} recebida(s)`,
            iconePath: ICONES.reservas,
          }),
          indicador({
            rotulo: "Aguardando entrega",
            valor: String(aguardando.length),
            nota: valorAguardando > 0 ? `${dinheiro(valorAguardando)} a caminho` : "nada pendente",
            iconePath: ICONES.relogio,
            destaque: aguardando.length > 0,
          }),
          indicador({
            rotulo: "Comprado no mês",
            valor: dinheiro(valorRecebidoMes),
            nota: "o que já entrou no estoque",
            iconePath: ICONES.caixa,
          }),
          indicador({
            rotulo: "Fornecedores",
            valor: String(fornecedoresLista.length),
            nota: "cadastrados",
            iconePath: ICONES.pessoa,
          }),
        ]),
        el("div", { classe: "linha-campos" }, [busca, seletorStatus]),
        tabela,
      ]),
    );
    desenharTabela();

    /* ---------- a linha da tabela, com as ações ---------- */

    function linhaCompra(c) {
      const [rotulo, variante] = SITUACAO[c.status] ?? [c.status, ""];
      const nItens = (c.compra_itens ?? []).length;
      const valor = valorDaCompra(c);
      const estimado = c.status !== "recebida" && Number(c.valor_total) === 0 && valor > 0;

      const acoes = [
        el("button", {
          classe: "btn-icone",
          type: "button",
          title: "Ver os itens desta nota",
          texto: "👁",
          onclick: () => detalheCompra(c.id),
        }),
      ];
      if (c.status === "pedido" || c.status === "rascunho") {
        acoes.push(
          el("button", {
            classe: "btn-icone",
            type: "button",
            title: "Receber esta compra",
            texto: "📦",
            onclick: () => receberInline(c.id),
          }),
        );
      }
      if (c.status !== "recebida") {
        acoes.push(
          el("button", {
            classe: "btn-icone",
            type: "button",
            title: "Excluir esta compra",
            texto: "🗑",
            onclick: () => excluirCompraInteira(c),
          }),
        );
      }

      return el("tr", {}, [
        el("td", {}, [
          el("strong", { texto: c.fornecedor || (c.origem === "avulsa" ? "Compra avulsa" : "—") }),
          el("small", { classe: "muted", texto: nItens > 0 ? ` ${nItens} item(ns) · ${c.estoque_locais?.nome ?? ""}` : ` ${c.estoque_locais?.nome ?? ""}` }),
        ]),
        el("td", { texto: c.documento || "—" }),
        el("td", { texto: dataCurta(c.data_compra) }),
        el("td", { texto: c.data_prevista ? dataCurta(c.data_prevista) : "—" }),
        el("td", { texto: c.recebida_em ? dataCurta(c.recebida_em.slice(0, 10)) : "—" }),
        el("td", { classe: "col-num" }, [el("strong", { texto: valor > 0 ? `${estimado ? "~" : ""}${dinheiro(valor)}` : "—" })]),
        el("td", {}, [etiqueta(rotulo, variante)]),
        el("td", { classe: "col-acoes" }, acoes),
      ]);
    }

    /**
     * Excluir some com a compra e os itens dela — por isso só existe para o
     * que nunca entrou no estoque (o servidor confere de novo). Cancelar
     * guarda o histórico; excluir é para o pedido criado por engano.
     */
    async function excluirCompraInteira(c) {
      const nome = c.fornecedor || (c.origem === "avulsa" ? "compra avulsa" : "esta compra");
      if (!confirm(`Excluir ${nome} de ${dataCurta(c.data_compra)}? Some da lista e do histórico — para guardar o registro, use Cancelar.`)) return;
      try {
        await del(`/v1/venues/${ctx.venue}/compras/${c.id}`);
        avisar("Compra excluída.", "ok");
        desenhar();
      } catch (e) {
        avisar(e.message, "erro");
      }
    }

    /* ---------- alterar os dados da compra ---------- */

    function editarDadosCompra(c) {
      limpar(conteudo);

      let fornecedorEscolhido = null;
      const fornecedorAtual = el("p", { texto: `Fornecedor: ${c.fornecedor || "—"}` });
      const lupaFornecedor = buscador(
        fornecedoresLista.map((f) => ({ rotulo: f.nome, valor: f })),
        {
          placeholder: "🔍  Trocar o fornecedor…",
          aoEscolher: (o) => {
            fornecedorEscolhido = o.valor;
            fornecedorAtual.textContent = `Fornecedor: ${o.valor.nome}`;
          },
        },
      );
      const documento = el("input", { classe: "campo", value: c.documento ?? "", placeholder: "Nº do pedido ou da nota" });
      const dataCompra = el("input", { classe: "campo", type: "date", value: c.data_compra ?? "" });
      const dataPrevista = el("input", { classe: "campo", type: "date", value: c.data_prevista ?? "" });
      const seletorLocal = el(
        "select",
        { classe: "select" },
        locais.map((l) => el("option", { value: l.id, texto: l.nome, selected: l.id === c.local_id })),
      );
      const observacoes = el("input", { classe: "campo", value: c.observacoes ?? "", placeholder: "Observações" });

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("h2", { texto: "Alterar dados da compra" }),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: () => detalheCompra(c.id) }),
          ]),
          el("div", { classe: "cartao pilha" }, [
            el("label", { classe: "campo-rotulado" }, [
              el("span", { texto: "Fornecedor (do cadastro)" }),
              lupaFornecedor,
              fornecedorAtual,
            ]),
            el("div", { classe: "linha-campos" }, [
              el("label", {}, [el("span", { texto: "Nº nota / documento" }), documento]),
              el("label", {}, [el("span", { texto: "Destino padrão" }), seletorLocal]),
            ]),
            el("div", { classe: "linha-campos" }, [
              el("label", {}, [el("span", { texto: "Data da compra" }), dataCompra]),
              el("label", {}, [el("span", { texto: "Entrega prevista" }), dataPrevista]),
            ]),
            el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Observações" }), observacoes]),
            el("button", {
              classe: "btn btn-primario btn-grande",
              type: "button",
              texto: "Salvar dados",
              onclick: async (ev) => {
                ev.target.disabled = true;
                try {
                  const corpoReq = {
                    documento: documento.value || null,
                    data_compra: dataCompra.value || null,
                    data_prevista: dataPrevista.value || null,
                    local_id: seletorLocal.value,
                    observacoes: observacoes.value || null,
                  };
                  if (fornecedorEscolhido) {
                    corpoReq.fornecedor = fornecedorEscolhido.nome;
                    corpoReq.fornecedor_id = fornecedorEscolhido.id;
                  }
                  await patch(`/v1/venues/${ctx.venue}/compras/${c.id}`, corpoReq);
                  avisar("Dados da compra alterados.", "ok");
                  detalheCompra(c.id);
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

    /* ---------- receber ao lado da compra ---------- */

    /**
     * A conferência do pedido, sem sair de Compras: cada item com o que foi
     * pedido, o que veio (já preenchido com o pedido — o normal é bater) e o
     * custo. Divergiu, pede o motivo. Confirmou, entra no estoque.
     */
    async function receberInline(compraId) {
      limpar(conteudo).append(el("p", { classe: "muted", texto: "Abrindo a conferência…" }));
      let c;
      try {
        c = await get(`/v1/venues/${ctx.venue}/compras/${compraId}`);
      } catch (e) {
        avisar(e.message, "erro");
        return desenhar();
      }
      limpar(conteudo);

      const itens = (c.compra_itens ?? []).map((it) => ({
        insumoId: it.insumo_id,
        nome: it.insumos?.nome ?? it.descricao_nota ?? "?",
        unidade: it.insumos?.unidade ?? "",
        descricao: it.descricao_nota ?? null,
        localId: it.local_id ?? null,
        pedida: it.quantidade_pedida === null ? null : Number(it.quantidade_pedida),
        recebida: Number(it.quantidade_recebida ?? it.quantidade_pedida ?? 0),
        custo: Number(it.custo_unitario_recebido ?? it.custo_unitario_pedido ?? 0),
        motivo: it.divergencia_motivo ?? "",
      }));

      const total = el("strong", {});
      const recalcular = () => {
        total.textContent = dinheiro(itens.reduce((t, i) => t + i.recebida * i.custo, 0));
      };

      // Itens em planilha, não em caixas: uma nota tem vinte linhas, e a
      // conferência é correr o dedo por elas — não rolar vinte cartões.
      const corpoTabela = el("tbody", {});
      const desenharItens = () => {
        limpar(corpoTabela);
        itens.forEach((i, idx) => {
          const divergiu = () => i.pedida !== null && i.recebida !== i.pedida;
          const celulaTotal = el("td", { classe: "col-num", texto: dinheiro(i.recebida * i.custo) });
          const linhaMotivo = el("tr", { classe: "linha-motivo", hidden: !divergiu() }, [
            el("td", { colspan: "6" }, [
              el("input", {
                classe: "campo",
                placeholder: "O que houve? faltou 1 caixa, peso do açougue, veio vencido…",
                value: i.motivo,
                onchange: (ev) => { i.motivo = ev.target.value; },
              }),
            ]),
          ]);
          const linha = el("tr", { classe: divergiu() ? "linha-atencao" : "" }, [
            el("td", {}, [
              el("strong", { texto: i.nome }),
              el("small", { classe: "muted", texto: i.unidade ? ` ${i.unidade}` : "" }),
            ]),
            el("td", { classe: "col-num", texto: i.pedida !== null ? String(i.pedida) : "—" }),
            el("td", {}, [
              el("input", {
                classe: "campo-numero campo-celula", type: "number", inputmode: "decimal", step: "0.001", min: "0",
                value: i.recebida,
                onchange: (ev) => {
                  i.recebida = Number(ev.target.value);
                  linhaMotivo.hidden = !divergiu();
                  linha.classList.toggle("linha-atencao", divergiu());
                  celulaTotal.textContent = dinheiro(i.recebida * i.custo);
                  recalcular();
                },
              }),
            ]),
            el("td", {}, [
              el("input", {
                classe: "campo-numero campo-celula", type: "number", inputmode: "decimal", step: "0.01", min: "0",
                value: i.custo || "",
                onchange: (ev) => {
                  i.custo = Number(ev.target.value);
                  celulaTotal.textContent = dinheiro(i.recebida * i.custo);
                  recalcular();
                },
              }),
            ]),
            celulaTotal,
            el("td", { classe: "col-acoes" }, [
              el("button", {
                classe: "btn-icone",
                type: "button",
                title: "Tirar este item da nota",
                texto: "✕",
                onclick: () => {
                  itens.splice(idx, 1);
                  desenharItens();
                  recalcular();
                },
              }),
            ]),
          ]);
          corpoTabela.append(linha, linhaMotivo);
        });
      };
      desenharItens();

      // Veio coisa fora do pedido? Acontece — o caminhão traz o que tem.
      const lupaAdicionar = buscador(
        insumos.map((i) => ({ rotulo: `${i.nome} (${i.unidade})`, valor: i })),
        {
          placeholder: "🔍  Veio algo fora do pedido? Adicione aqui…",
          aoEscolher: (o) => {
            itens.push({
              insumoId: o.valor.id,
              nome: o.valor.nome,
              unidade: o.valor.unidade,
              descricao: null,
              localId: null,
              pedida: null,
              recebida: 0,
              custo: o.valor.custoMedio || 0,
              motivo: "",
            });
            desenharItens();
            recalcular();
          },
        },
      );

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: `Receber de ${c.fornecedor || "fornecedor"}` }),
              el("p", { classe: "muted", texto: `Pedido de ${dataCurta(c.data_compra)} · destino ${c.estoque_locais?.nome ?? ""}` }),
            ]),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
          ]),
          el("p", { classe: "aviso aviso-alerta", texto: "Confira o que CHEGOU. Zero significa \"não veio\" — e vira cobrança, não entrada." }),
          el("div", { classe: "rolagem-x" }, [
            el("table", { classe: "planilha" }, [
              el("thead", {}, [
                el("tr", {}, [
                  el("th", { texto: "Item" }),
                  el("th", { classe: "col-num", texto: "Pedido" }),
                  el("th", { texto: "Veio" }),
                  el("th", { texto: "R$/un" }),
                  el("th", { classe: "col-num", texto: "Total" }),
                  el("th", { texto: "" }),
                ]),
              ]),
              corpoTabela,
            ]),
          ]),
          lupaAdicionar,
          el("div", { classe: "cartao cartao-total" }, [
            el("div", { classe: "cabecalho-secao" }, [el("span", { texto: "Total recebido" }), total]),
            el("button", {
              classe: "btn btn-primario btn-grande",
              type: "button",
              texto: "Confirmar recebimento",
              onclick: async (ev) => {
                ev.target.disabled = true;
                ev.target.textContent = "Dando entrada…";
                try {
                  await put(`/v1/venues/${ctx.venue}/compras/${c.id}/itens`, {
                    itens: itens.map((i) => ({
                      insumo_id: i.insumoId,
                      local_id: i.localId,
                      descricao_nota: i.descricao,
                      quantidade_pedida: i.pedida,
                      quantidade_recebida: i.recebida,
                      custo_unitario_recebido: i.custo,
                      divergencia_motivo: i.motivo || null,
                    })),
                  });
                  const r = await post(`/v1/venues/${ctx.venue}/compras/${c.id}/receber`, {});
                  const divergencias = r.divergencias ?? [];
                  avisar(
                    divergencias.length > 0
                      ? `Entrada feita — ${divergencias.length} divergência(s) para cobrar do fornecedor.`
                      : "Entrada feita. Pedido e entrega bateram.",
                    divergencias.length > 0 ? "alerta" : "ok",
                  );
                  detalheCompra(c.id);
                } catch (e) {
                  avisar(e.message, "erro");
                  ev.target.disabled = false;
                  ev.target.textContent = "Confirmar recebimento";
                }
              },
            }),
          ]),
        ]),
      );
      recalcular();
    }

    /* ---------- a compra por dentro ---------- */

    async function detalheCompra(compraId) {
      limpar(conteudo).append(el("p", { classe: "muted", texto: "Abrindo a compra…" }));
      let c;
      try {
        c = await get(`/v1/venues/${ctx.venue}/compras/${compraId}`);
      } catch (e) {
        avisar(e.message, "erro");
        return desenhar();
      }
      limpar(conteudo);

      const [rotulo, variante] = SITUACAO[c.status] ?? [c.status, ""];
      const itensCompra = c.compra_itens ?? [];
      const recebida = c.status === "recebida";
      const dado = (nome, valor) =>
        valor
          ? el("div", { classe: "cabecalho-secao" }, [el("span", { classe: "muted", texto: nome }), el("strong", { texto: valor })])
          : null;

      const linhaItem = (it) => {
        const pedida = it.quantidade_pedida === null ? null : Number(it.quantidade_pedida);
        const veio = it.quantidade_recebida === null ? null : Number(it.quantidade_recebida);
        const custo = Number(it.custo_unitario_recebido ?? it.custo_unitario_pedido ?? 0);
        const qtdParaTotal = veio ?? pedida ?? 0;
        const divergente = recebida && pedida !== null && veio !== null && veio !== pedida;
        const unidade = it.insumos?.unidade ?? "";
        return el("tr", { classe: divergente ? "linha-atencao" : "" }, [
          el("td", {}, [
            el("strong", { texto: it.insumos?.nome ?? it.descricao_nota ?? "?" }),
            it.divergencia_motivo || it.estoque_locais?.nome
              ? el("small", {
                  classe: "muted",
                  texto: [it.estoque_locais?.nome ? `→ ${it.estoque_locais.nome}` : null, it.divergencia_motivo || null]
                    .filter(Boolean).join(" · "),
                })
              : null,
          ].filter(Boolean)),
          el("td", { classe: "col-num", texto: pedida !== null ? `${pedida} ${unidade}` : "—" }),
          el("td", { classe: "col-num" }, [
            el("span", { texto: veio !== null ? `${veio} ${unidade}` : "—" }),
            divergente ? etiqueta(veio > pedida ? " a mais" : " a menos", "etiqueta-perigo") : null,
          ].filter(Boolean)),
          el("td", { classe: "col-num", texto: custo ? dinheiro(custo) : "—" }),
          el("td", { classe: "col-num" }, [el("strong", { texto: dinheiro(qtdParaTotal * custo) })]),
        ]);
      };

      const tabelaItens = el("div", { classe: "rolagem-x" }, [
        el("table", { classe: "planilha" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { texto: "Item" }),
              el("th", { classe: "col-num", texto: "Pedido" }),
              el("th", { classe: "col-num", texto: "Recebido" }),
              el("th", { classe: "col-num", texto: "R$/un" }),
              el("th", { classe: "col-num", texto: "Total" }),
            ]),
          ]),
          el("tbody", {}, itensCompra.map(linhaItem)),
        ]),
      ]);

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: c.fornecedor || (c.origem === "avulsa" ? "Compra avulsa" : "Compra") }),
              el("p", { classe: "muted", texto: `Criada em ${dataHora(c.created_at)}` }),
            ]),
            el("div", {}, [
              etiqueta(rotulo, variante),
              el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
            ]),
          ]),
          el("div", { classe: "cartao" }, [
            dado("Destino padrão", c.estoque_locais?.nome),
            dado("Documento", c.documento),
            dado("Data da compra", dataCurta(c.data_compra)),
            dado("Entrega prevista", c.data_prevista ? dataCurta(c.data_prevista) : null),
            dado("Recebida em", c.recebida_em ? dataHora(c.recebida_em) : null),
            c.observacoes ? el("p", { classe: "muted", texto: c.observacoes }) : null,
          ].filter(Boolean)),
          el("div", { classe: "pilha" }, [
            el("h3", { texto: `Itens (${itensCompra.length})` }),
            tabelaItens,
          ]),
          el("div", { classe: "cartao cartao-total" }, [
            el("div", { classe: "cabecalho-secao" }, [
              el("span", { texto: recebida ? "Total recebido" : "Total estimado" }),
              el("strong", {
                texto: dinheiro(
                  Number(c.valor_total) ||
                    itensCompra.reduce((t, it) => {
                      const q = Number(it.quantidade_recebida ?? it.quantidade_pedida ?? 0);
                      return t + q * Number(it.custo_unitario_recebido ?? it.custo_unitario_pedido ?? 0);
                    }, 0),
                ),
              }),
            ]),
            c.status === "pedido" || c.status === "rascunho"
              ? el("div", { classe: "linha-campos" }, [
                  el("button", {
                    classe: "btn btn-primario btn-grande",
                    type: "button",
                    texto: "📦 Receber esta compra",
                    onclick: () => receberInline(c.id),
                  }),
                  el("button", {
                    classe: "btn btn-peq",
                    type: "button",
                    texto: "✏️ Alterar itens",
                    onclick: () => editarPedido(c),
                  }),
                  el("button", {
                    classe: "btn btn-peq",
                    type: "button",
                    texto: "✏️ Alterar dados",
                    onclick: () => editarDadosCompra(c),
                  }),
                  el("button", {
                    classe: "btn btn-peq",
                    type: "button",
                    texto: "Cancelar pedido",
                    onclick: async () => {
                      if (!confirm("Cancelar este pedido? Ele fica no histórico como cancelado e não entra no estoque.")) return;
                      try {
                        await post(`/v1/venues/${ctx.venue}/compras/${c.id}/cancelar`, {});
                        avisar("Pedido cancelado.", "ok");
                        desenhar();
                      } catch (e) {
                        avisar(e.message, "erro");
                      }
                    },
                  }),
                  el("button", {
                    classe: "btn btn-peq",
                    type: "button",
                    texto: "🗑 Excluir compra",
                    onclick: () => excluirCompraInteira(c),
                  }),
                ])
              : null,
          ].filter(Boolean)),
        ]),
      );
    }

    /* ---------- alterar um pedido que ainda não chegou ---------- */

    /**
     * Mexer no pedido antes da entrega: mudar quantidade, tirar item, pôr
     * item. Depois de recebida não se altera — a entrada já é movimento no
     * razão, e razão não se reescreve.
     */
    function editarPedido(c) {
      limpar(conteudo);
      const linhas = (c.compra_itens ?? []).map((it) => ({
        insumoId: it.insumo_id,
        nome: it.insumos?.nome ?? it.descricao_nota ?? "?",
        unidade: it.insumos?.unidade ?? "",
        descricao: it.descricao_nota ?? null,
        localId: it.local_id ?? null,
        qtd: it.quantidade_pedida === null ? null : Number(it.quantidade_pedida),
        custo: Number(it.custo_unitario_pedido ?? 0),
      }));

      const total = el("strong", {});
      const recalcular = () => {
        total.textContent = dinheiro(linhas.reduce((t, l) => t + (l.qtd ?? 0) * (l.custo || 0), 0));
      };

      const corpoTabela = el("tbody", {});
      const desenharLinhas = () => {
        limpar(corpoTabela);
        linhas.forEach((l, idx) => {
          const celulaTotal = el("td", { classe: "col-num", texto: dinheiro((l.qtd ?? 0) * (l.custo || 0)) });
          corpoTabela.append(
            el("tr", {}, [
              el("td", {}, [
                el("strong", { texto: l.nome }),
                el("small", { classe: "muted", texto: l.unidade ? ` ${l.unidade}` : "" }),
              ]),
              el("td", {}, [
                el("input", {
                  classe: "campo-numero campo-celula", type: "number", inputmode: "decimal", step: "0.001", min: "0",
                  value: l.qtd ?? "",
                  onchange: (ev) => {
                    l.qtd = Number(ev.target.value);
                    celulaTotal.textContent = dinheiro((l.qtd ?? 0) * (l.custo || 0));
                    recalcular();
                  },
                }),
              ]),
              el("td", {}, [
                el("input", {
                  classe: "campo-numero campo-celula", type: "number", inputmode: "decimal", step: "0.01", min: "0",
                  value: l.custo || "",
                  onchange: (ev) => {
                    l.custo = Number(ev.target.value);
                    celulaTotal.textContent = dinheiro((l.qtd ?? 0) * (l.custo || 0));
                    recalcular();
                  },
                }),
              ]),
              celulaTotal,
              el("td", { classe: "col-acoes" }, [
                el("button", {
                  classe: "btn-icone",
                  type: "button",
                  title: "Tirar este item do pedido",
                  texto: "✕",
                  onclick: () => {
                    linhas.splice(idx, 1);
                    desenharLinhas();
                    recalcular();
                  },
                }),
              ]),
            ]),
          );
        });
      };
      desenharLinhas();
      recalcular();

      const lupaAdicionar = buscador(
        insumos.map((i) => ({ rotulo: `${i.nome} (${i.unidade})`, valor: i })),
        {
          placeholder: "🔍  Adicionar item ao pedido…",
          aoEscolher: (o) => {
            linhas.push({
              insumoId: o.valor.id,
              nome: o.valor.nome,
              unidade: o.valor.unidade,
              descricao: null,
              localId: null,
              qtd: null,
              custo: o.valor.custoMedio || 0,
            });
            desenharLinhas();
            recalcular();
          },
        },
      );

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: `Alterar pedido — ${c.fornecedor || "sem fornecedor"}` }),
              el("p", { classe: "muted", texto: "Mude quantidades, tire ou acrescente itens. Vale até a entrega chegar." }),
            ]),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: () => detalheCompra(c.id) }),
          ]),
          el("div", { classe: "rolagem-x" }, [
            el("table", { classe: "planilha" }, [
              el("thead", {}, [
                el("tr", {}, [
                  el("th", { texto: "Item" }),
                  el("th", { texto: "Quantidade" }),
                  el("th", { texto: "R$/un" }),
                  el("th", { classe: "col-num", texto: "Total" }),
                  el("th", { texto: "" }),
                ]),
              ]),
              corpoTabela,
            ]),
          ]),
          lupaAdicionar,
          el("div", { classe: "cartao cartao-total" }, [
            el("div", { classe: "cabecalho-secao" }, [el("span", { texto: "Total estimado" }), total]),
            el("button", {
              classe: "btn btn-primario btn-grande",
              type: "button",
              texto: "Salvar alterações",
              onclick: async (ev) => {
                const validas = linhas.filter((l) => l.insumoId && l.qtd > 0);
                if (validas.length === 0) return avisar("O pedido precisa de ao menos um item com quantidade.", "erro");
                ev.target.disabled = true;
                try {
                  await put(`/v1/venues/${ctx.venue}/compras/${c.id}/itens`, {
                    itens: validas.map((l) => ({
                      insumo_id: l.insumoId,
                      local_id: l.localId,
                      descricao_nota: l.descricao,
                      quantidade_pedida: l.qtd,
                      custo_unitario_pedido: l.custo || null,
                    })),
                  });
                  avisar("Pedido alterado.", "ok");
                  detalheCompra(c.id);
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

    /* ---------- novo pedido ---------- */

    function formularioPedido(prePreenchidas) {
      limpar(conteudo);
      const linhas = prePreenchidas ?? [];

      // Pedido só sai com fornecedor DO CADASTRO: pedido é compromisso com
      // alguém que existe — nome digitado solto vira "Frigorifico", "frigo",
      // "Frigorífico Silva" e três históricos para o mesmo CNPJ. Nota sem
      // pedido (compra de rua) continua livre, mas isso é na tela Receber.
      if (fornecedoresLista.length === 0) {
        conteudo.append(
          el("section", { classe: "pilha" }, [
            el("div", { classe: "cabecalho-secao" }, [
              el("h2", { texto: "Novo pedido" }),
              el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
            ]),
            vazio(
              "Cadastre um fornecedor primeiro",
              "Pedido é para fornecedor cadastrado. Vá em Cadastros → Fornecedores, leva um minuto — compra avulsa (de rua) continua na tela Receber.",
            ),
          ]),
        );
        return;
      }

      let fornecedorEscolhido = null;
      const fornecedorEscolhidoLinha = el("p", { classe: "muted", texto: "Nenhum fornecedor escolhido ainda." });
      const lupaFornecedor = buscador(
        fornecedoresLista.map((f) => ({ rotulo: `${f.nome} · entrega a cada ${f.cicloCompraDias}d`, valor: f })),
        {
          placeholder: "🔍  Escolher fornecedor cadastrado…",
          aoEscolher: (o) => {
            fornecedorEscolhido = o.valor;
            fornecedorEscolhidoLinha.textContent = `Fornecedor: ${o.valor.nome}`;
            fornecedorEscolhidoLinha.classList.remove("muted");
          },
        },
      );
      const documento = el("input", { classe: "campo", placeholder: "Nº do pedido ou da nota (opcional)" });
      const dataPrevista = el("input", { classe: "campo", type: "date" });
      const seletorLocal = el(
        "select",
        { classe: "select" },
        locais.map((l) => el("option", { value: l.id, texto: l.nome, selected: l.principal })),
      );
      const listaItens = el("div", { classe: "lista" });
      const total = el("strong", {});

      const recalcular = () => {
        total.textContent = dinheiro(
          linhas.reduce((t, l) => t + (Number(l.qtd) || 0) * (Number(l.custo) || 0), 0),
        );
      };

      const desenharItens = () => {
        limpar(listaItens);
        linhas.forEach((linha, i) => {
          const insumo = insumos.find((x) => x.id === linha.insumoId);
          listaItens.append(
            el("article", { classe: "cartao" }, [
              el("div", { classe: "cabecalho-secao" }, [
                el("strong", { texto: insumo?.nome ?? "?" }),
                el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: "Remover",
                  onclick: () => {
                    linhas.splice(i, 1);
                    desenharItens();
                  },
                }),
              ]),
              el("div", { classe: "linha-campos" }, [
                el("label", {}, [
                  el("span", { texto: `Quantidade (${insumo?.unidade ?? "un"})` }),
                  el("input", {
                    classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.001",
                    value: linha.qtd ?? "",
                    onchange: (ev) => { linha.qtd = Number(ev.target.value); recalcular(); },
                  }),
                ]),
                el("label", {}, [
                  el("span", { texto: "R$ estimado/un" }),
                  el("input", {
                    classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.01",
                    // O custo médio da última compra já vem sugerido: quem
                    // pede raramente sabe o preço de cor, e o histórico é o
                    // melhor palpite disponível.
                    value: linha.custo ?? "",
                    onchange: (ev) => { linha.custo = Number(ev.target.value); recalcular(); },
                  }),
                ]),
              ]),
            ]),
          );
        });
        recalcular();
      };

      const seletorInsumo = buscador(
        insumos.map((i) => ({ rotulo: `${i.nome} (${i.unidade})`, valor: i })),
        {
          placeholder: "🔍  Adicionar insumo…",
          aoEscolher: (o) => {
            linhas.push({ insumoId: o.valor.id, qtd: null, custo: o.valor.custoMedio || null });
            desenharItens();
          },
        },
      );

      conteudo.append(
        el("section", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("h2", { texto: "Novo pedido" }),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Cancelar", onclick: desenhar }),
          ]),
          el("div", { classe: "cartao pilha" }, [
            el("label", { classe: "campo-rotulado" }, [
              el("span", { texto: "Fornecedor (do cadastro)" }),
              lupaFornecedor,
              fornecedorEscolhidoLinha,
            ]),
            el("div", { classe: "linha-campos" }, [
              el("label", {}, [el("span", { texto: "Documento" }), documento]),
              el("label", {}, [el("span", { texto: "Entrega prevista" }), dataPrevista]),
            ]),
            el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Destino padrão" }), seletorLocal]),
            seletorInsumo,
          ]),
          listaItens,
          el("div", { classe: "cartao cartao-total" }, [
            el("div", { classe: "cabecalho-secao" }, [el("span", { texto: "Total estimado" }), total]),
            el("button", {
              classe: "btn btn-primario btn-grande",
              type: "button",
              texto: "Enviar pedido",
              onclick: async (ev) => {
                if (!fornecedorEscolhido) return avisar("Escolha o fornecedor — pedido é para fornecedor cadastrado.", "erro");
                const validas = linhas.filter((l) => l.insumoId && l.qtd > 0);
                if (validas.length === 0) return avisar("Adicione ao menos um item com quantidade.", "erro");
                ev.target.disabled = true;
                try {
                  const r = await post(`/v1/venues/${ctx.venue}/compras`, {
                    local_id: seletorLocal.value,
                    origem: "pedido",
                    fornecedor: fornecedorEscolhido.nome,
                    fornecedor_id: fornecedorEscolhido.id,
                    documento: documento.value || null,
                    data_prevista: dataPrevista.value || null,
                    itens: validas.map((l) => ({
                      insumo_id: l.insumoId,
                      quantidade_pedida: l.qtd,
                      custo_unitario_pedido: l.custo ?? null,
                    })),
                  });
                  await post(`/v1/venues/${ctx.venue}/compras/${r.id}/enviar`, {});
                  avisar("Pedido enviado. Quando o caminhão chegar, toque em Receber na linha dele.", "ok");
                  desenhar();
                } catch (e) {
                  avisar(e.message, "erro");
                  ev.target.disabled = false;
                }
              },
            }),
          ]),
        ]),
      );
      desenharItens();
    }
  }

  /**
   * Monta o pedido a partir do consumo real.
   *
   * O algoritmo prevê por DIA DA SEMANA (sábado não consome como terça) e
   * pede para o horizonte do ciclo do fornecedor. A pessoa corta o que não
   * quer — a sugestão preenche, não decide.
   */
  async function sugerirPedido() {
    limpar(conteudo).append(
      el("p", { classe: "muted", texto: "Calculando pelo consumo das últimas 4 semanas…" }),
    );
    let sugestoes;
    try {
      sugestoes = await get(`/v1/venues/${ctx.venue}/estoque/sugestao-compra`);
    } catch (e) {
      avisar(e.message, "erro");
      return desenhar();
    }
    if (sugestoes.length === 0) {
      avisar("Nada a pedir por enquanto: o estoque cobre o consumo previsto.", "info");
      return desenhar();
    }
    limpar(conteudo);
    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Sugestão de pedido" }),
            el("p", { classe: "muted", texto: "Pelo consumo real, dia da semana a dia da semana. Corte o que não quiser." }),
          ]),
          el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: () => desenhar() }),
        ]),
        el("div", { classe: "lista" },
          sugestoes.map((s) =>
            el("article", { classe: "cartao" }, [
              el("div", { classe: "cabecalho-secao" }, [
                el("div", {}, [
                  el("strong", { texto: s.insumo }),
                  el("p", {
                    classe: "muted",
                    texto: `consumo ${s.consumo_medio_diario}/dia · previsto ${s.demanda_prevista} · em estoque ${s.saldo_atual}` +
                      (s.fornecedor ? ` · ${s.fornecedor}` : ""),
                  }),
                ]),
                el("strong", { texto: `${s.quantidade_sugerida} ${s.unidade}` }),
              ]),
            ]),
          ),
        ),
        el("div", { classe: "cartao cartao-total" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("span", { texto: "Custo estimado" }),
            el("strong", { texto: dinheiro(sugestoes.reduce((t, s) => t + Number(s.custo_estimado), 0)) }),
          ]),
          el("button", {
            classe: "btn btn-primario btn-grande",
            type: "button",
            texto: "Usar como pedido",
            onclick: () => {
              prePreenchimento = sugestoes.map((s) => ({
                insumoId: s.insumo_id,
                qtd: Number(s.quantidade_sugerida),
                custo: Number(s.custo_estimado) / Number(s.quantidade_sugerida) || null,
              }));
              desenhar();
            },
          }),
        ]),
      ]),
    );
  }
}
