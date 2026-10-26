import { del, post, put } from "../api.js";
import { avisar, dinheiro, el, limpar } from "../ui.js";
import { dataBr } from "../relatorio.js";

/**
 * O formulário de uma conta a pagar ou a receber, e o da baixa.
 *
 * O parcelamento não é engessado: "gerar parcelas" só SUGERE (mensal, ou a
 * cada N dias), e cada parcela fica com a data e o valor editáveis — o
 * fornecedor que dá 28/56/84 dias, a entrada maior e o resto dividido, o
 * evento com sinal e saldo no dia. A soma aparece embaixo, e avisa se não
 * bate com o total.
 */

const hojeIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba" }).format(new Date());

export const NOME_DO_TIPO = {
  pagar: { conta: "conta a pagar", quem: "Fornecedor", acao: "Pagar", feito: "Pago", saiu: "De qual conta saiu" },
  receber: { conta: "conta a receber", quem: "Cliente", acao: "Receber", feito: "Recebido", saiu: "Em qual conta entrou" },
};

/** Valor digitado ("1.234,56" ou "1234.56") em número. */
export function lerValor(v) {
  const s = String(v ?? "").trim().replace(/[R$\s]/g, "");
  if (!s) return NaN;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const valorNoCampo = (n) => (n === null || n === undefined || n === "" ? "" : Number(n).toFixed(2).replace(".", ","));

/** Select de categorias do tipo, em grupos (categoria › subcategorias). */
export function seletorDeCategoria(cad, tipo, atual) {
  const doTipo = cad.categorias.filter((c) => c.tipo === (tipo === "receber" ? "receita" : "despesa") && (c.ativo || c.id === atual));
  const pais = doTipo.filter((c) => !c.pai_id);
  return el("select", { classe: "select" }, [
    el("option", { value: "", texto: "— escolha —" }),
    ...pais.map((p) => {
      const filhas = doTipo.filter((c) => c.pai_id === p.id);
      return filhas.length
        ? el("optgroup", { label: p.nome }, [
            el("option", { value: p.id, texto: `${p.nome} (geral)`, selected: p.id === atual }),
            ...filhas.map((f) => el("option", { value: f.id, texto: f.nome, selected: f.id === atual })),
          ])
        : el("option", { value: p.id, texto: p.nome, selected: p.id === atual });
    }),
  ]);
}

export function nomeDaCategoria(cad, id) {
  const c = cad.categorias.find((x) => x.id === id);
  if (!c) return "Sem categoria";
  const pai = c.pai_id ? cad.categorias.find((x) => x.id === c.pai_id) : null;
  return pai ? `${pai.nome} › ${c.nome}` : c.nome;
}

const seletor = (lista, atual, vazio = "—") =>
  el("select", { classe: "select" }, [
    el("option", { value: "", texto: vazio }),
    ...lista.filter((x) => x.ativo !== false || x.id === atual).map((x) => el("option", { value: x.id, texto: x.nome, selected: x.id === atual })),
  ]);

const campo = (rotulo, controle, ajuda) =>
  el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle, ajuda ? el("small", { classe: "muted", texto: ajuda }) : null]);

/**
 * Abre o formulário dentro de `corpo`. `existente` = editar UMA parcela.
 * `aoTerminar` volta para a lista.
 */
export function formularioDeConta(corpo, { ctx, cad, tipo, existente = null, aoTerminar }) {
  const n = NOME_DO_TIPO[tipo];
  const base = `/v1/venues/${ctx.venue}/financeiro`;
  const descricao = el("input", { classe: "input", value: existente?.descricao ?? "", placeholder: tipo === "pagar" ? "Ex.: Nota 1234 — bebidas" : "Ex.: Evento aniversário da Ana" });
  const fornecedor = seletor(cad.fornecedores, existente?.fornecedor_id, tipo === "pagar" ? "— sem fornecedor cadastrado —" : "— não é fornecedor —");
  const pessoa = el("input", { classe: "input", value: existente?.pessoa ?? "", placeholder: tipo === "pagar" ? "Ou escreva quem (ex.: Prefeitura)" : "Nome do cliente ou da empresa" });
  const categoria = seletorDeCategoria(cad, tipo, existente?.categoria_id);
  const documento = el("input", { classe: "input", value: existente?.documento ?? "", placeholder: "Nº da nota, do boleto, do contrato" });
  const forma = seletor(cad.formas, existente?.forma_id);
  const conta = seletor(cad.contas, existente?.conta_id, "— decidir na hora —");
  const competencia = el("input", { classe: "input", type: "month", value: (existente?.competencia ?? "").slice(0, 7) });
  const obs = el("textarea", { classe: "input", rows: 2, texto: existente?.observacoes ?? "" });

  // Ao escolher o fornecedor, a categoria, a forma e o prazo dele vêm juntos.
  fornecedor.addEventListener("change", () => {
    const f = cad.fornecedores.find((x) => x.id === fornecedor.value);
    if (!f) return;
    if (f.categoria_id && !categoria.value) categoria.value = f.categoria_id;
    if (f.forma_id && !forma.value) forma.value = f.forma_id;
    if (!existente && f.prazo_dias !== null && f.prazo_dias !== undefined && primeiro) {
      const d = new Date(`${hojeIso()}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + Number(f.prazo_dias));
      primeiro.value = d.toISOString().slice(0, 10);
    }
  });

  const cabecalho = el("div", { classe: "cabecalho-secao" }, [
    el("h2", { texto: existente ? existente.descricao : `Nova ${n.conta}` }),
    el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: aoTerminar }),
  ]);
  const dados = el("section", { classe: "cartao pilha" }, [
    campo("Descrição", descricao),
    el("div", { classe: "grade grade-2" }, [
      campo(n.quem, fornecedor),
      campo("Ou quem", pessoa),
      campo("Categoria", categoria),
      campo("Documento", documento),
      campo("Forma de pagamento", forma),
      campo(tipo === "pagar" ? "Pagar pela conta" : "Receber na conta", conta),
      campo("Mês do resultado (competência)", competencia, "A nota de outubro paga em novembro é custo de outubro. Vazio = mês do vencimento."),
    ]),
    campo("Observações", obs),
  ]);

  const comum = () => ({
    descricao: descricao.value,
    fornecedor_id: fornecedor.value || null,
    pessoa: pessoa.value,
    categoria_id: categoria.value || null,
    documento: documento.value,
    forma_id: forma.value || null,
    conta_id: conta.value || null,
    competencia: competencia.value ? `${competencia.value}-01` : undefined,
    observacoes: obs.value,
  });

  // ---- Editar uma parcela ----
  if (existente) {
    const venc = el("input", { classe: "input", type: "date", value: existente.vencimento });
    const valor = el("input", { classe: "input", inputmode: "decimal", value: valorNoCampo(existente.valor), disabled: existente.situacao === "pago" });
    const nasProximas = el("input", { type: "checkbox" });
    const pago = existente.situacao === "pago";
    limpar(corpo).append(
      cabecalho,
      pago
        ? el("p", { classe: "aviso-ok", texto: `${n.feito} em ${dataBr(existente.pago_em)}: ${dinheiro(Number(existente.valor_pago))}${Number(existente.juros) ? ` (juros ${dinheiro(Number(existente.juros))})` : ""}${Number(existente.desconto) ? ` (desconto ${dinheiro(Number(existente.desconto))})` : ""}` })
        : null,
      dados,
      el("section", { classe: "cartao pilha" }, [
        el("div", { classe: "grade grade-2" }, [
          campo(existente.parcelas ? `Vencimento da parcela ${existente.parcela}/${existente.parcelas}` : "Vencimento", venc),
          campo("Valor", valor, pago ? "Paga: estorne para mudar o valor." : null),
        ]),
        existente.grupo_id
          ? el("label", { classe: "linha-campos", style: "align-items:center;gap:8px" }, [nasProximas, el("span", { texto: "Levar descrição, categoria, fornecedor e forma para as próximas parcelas em aberto" })])
          : null,
      ]),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Salvar",
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await put(`${base}/lancamentos/${existente.id}`, { ...comum(), vencimento: venc.value, ...(pago ? {} : { valor: lerValor(valor.value) }), nas_proximas: nasProximas.checked });
              avisar("Salvo.", "ok");
              aoTerminar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
        !pago && existente.situacao === "aberto"
          ? el("button", { classe: "btn", type: "button", texto: n.acao, onclick: () => formularioDeBaixa(corpo, { ctx, cad, tipo, conta: existente, aoTerminar }) })
          : null,
        pago
          ? el("button", {
              classe: "btn",
              type: "button",
              texto: "Estornar pagamento",
              onclick: async () => {
                if (!confirm("Desfazer o pagamento? A conta volta para em aberto.")) return;
                try {
                  await post(`${base}/lancamentos/${existente.id}/estorno`, {});
                  avisar("Pagamento estornado.", "ok");
                  aoTerminar();
                } catch (err) {
                  avisar(err.message, "erro");
                }
              },
            })
          : null,
        !pago
          ? el("button", {
              classe: "btn btn-perigo",
              type: "button",
              texto: "Apagar",
              onclick: async () => {
                const grupo = existente.grupo_id && confirm("Apagar também as outras parcelas EM ABERTO desta conta?\n\nOK = todas em aberto · Cancelar = só esta");
                if (!grupo && !confirm("Apagar esta parcela?")) return;
                try {
                  await del(`${base}/lancamentos/${existente.id}${grupo ? "?grupo=1" : ""}`);
                  avisar("Apagado.", "ok");
                  aoTerminar();
                } catch (err) {
                  avisar(err.message, "erro");
                }
              },
            })
          : null,
      ]),
    );
    return;
  }

  // ---- Nova conta: valor e vencimentos ----
  let modo = "vista";
  let parcelas = [];
  const total = el("input", { classe: "input", inputmode: "decimal", placeholder: "0,00" });
  const primeiro = el("input", { classe: "input", type: "date", value: hojeIso() });
  const quantidade = el("input", { classe: "input", type: "number", min: 2, max: 120, value: 3 });
  const intervalo = el("select", { classe: "select" }, [
    el("option", { value: "mensal", texto: "Todo mês, no mesmo dia" }),
    el("option", { value: "7", texto: "A cada 7 dias" }),
    el("option", { value: "14", texto: "A cada 14 dias" }),
    el("option", { value: "28", texto: "A cada 28 dias" }),
    el("option", { value: "30", texto: "A cada 30 dias" }),
  ]);
  const jaPago = el("input", { type: "checkbox" });
  const pagoEm = el("input", { classe: "input", type: "date", value: hojeIso() });
  const areaModo = el("div", { classe: "pilha" });
  const areaParcelas = el("div", { classe: "pilha" });

  const desenharParcelas = () => {
    const soma = parcelas.reduce((s, p) => s + Math.round((lerValor(p.valor) || 0) * 100), 0) / 100;
    const alvo = lerValor(total.value);
    const recorrente = modo === "mensal";
    limpar(areaParcelas).append(
      ...parcelas.map((p, i) =>
        el("div", { classe: "linha-campos parcela-linha" }, [
          el("strong", { classe: "parcela-num", texto: `${i + 1}ª` }),
          el("input", { classe: "input", type: "date", value: p.vencimento, oninput: (e) => { p.vencimento = e.target.value; } }),
          el("input", { classe: "input", inputmode: "decimal", value: valorNoCampo(p.valor), oninput: (e) => { p.valor = e.target.value; desenharSoma(); } }),
          el("button", { classe: "btn-icone", type: "button", title: "Tirar esta parcela", texto: "✕", onclick: () => { parcelas.splice(i, 1); desenharParcelas(); } }),
        ]),
      ),
      parcelas.length
        ? el("div", { classe: "reserva-acoes", style: "margin:0" }, [
            el("button", {
              classe: "btn btn-peq",
              type: "button",
              texto: "+ parcela",
              onclick: () => {
                const ultima = parcelas[parcelas.length - 1];
                parcelas.push({ vencimento: ultima?.vencimento ?? hojeIso(), valor: recorrente ? ultima?.valor ?? "" : "" });
                desenharParcelas();
              },
            }),
            somaEl,
          ])
        : null,
    );
    desenharSoma(soma, alvo);
  };
  const somaEl = el("span", { classe: "muted" });
  const desenharSoma = () => {
    const soma = parcelas.reduce((s, p) => s + Math.round((lerValor(p.valor) || 0) * 100), 0) / 100;
    const alvo = lerValor(total.value);
    if (modo === "mensal") {
      somaEl.textContent = `${parcelas.length} meses · ${dinheiro(soma)} no total`;
      somaEl.className = "muted";
      return;
    }
    const bate = !(alvo > 0) || Math.abs(soma - alvo) < 0.005;
    const dif = Math.round(Math.abs(alvo - soma) * 100) / 100;
    somaEl.textContent = bate ? `Soma: ${dinheiro(soma)} ✓` : `Soma ${dinheiro(soma)}: ${soma > alvo ? `${dinheiro(dif)} a mais que o total` : `faltam ${dinheiro(dif)} para o total`}`;
    somaEl.className = bate ? "muted" : "texto-alerta";
  };

  const gerar = async () => {
    const valor = lerValor(total.value);
    if (!(valor > 0)) return avisar("Informe o valor.", "erro");
    try {
      if (modo === "mensal") {
        // Repetir todo mês: cada mês é o valor inteiro (o aluguel não se divide).
        const meses = Number(quantidade.value) || 12;
        const r = await post(`${base}/parcelas`, { total: valor * meses, quantidade: meses, primeiro: primeiro.value, intervalo: "mensal" });
        parcelas = r.map((p) => ({ vencimento: p.vencimento, valor }));
      } else {
        parcelas = await post(`${base}/parcelas`, { total: valor, quantidade: Number(quantidade.value), primeiro: primeiro.value, intervalo: intervalo.value });
      }
      desenharParcelas();
    } catch (err) {
      avisar(err.message, "erro");
    }
  };

  const desenharModo = () => {
    parcelas = [];
    limpar(areaParcelas);
    const botoesModo = el("div", { classe: "abas" }, [["vista", "Uma vez"], ["parcelado", "Parcelado"], ["mensal", "Repetir todo mês"]].map(([id, rotulo]) =>
      el("button", { classe: `aba${modo === id ? " aba-ativa" : ""}`, type: "button", texto: rotulo, onclick: () => { modo = id; desenharModo(); } })));
    const linhas = [botoesModo];
    if (modo === "vista") {
      linhas.push(
        el("div", { classe: "grade grade-2" }, [campo("Valor", total), campo("Vencimento", primeiro)]),
        el("label", { classe: "linha-campos", style: "align-items:center;gap:8px" }, [jaPago, el("span", { texto: tipo === "pagar" ? "Já está pago" : "Já recebi" })]),
        el("div", { classe: "grade grade-2", id: "area-ja-pago", hidden: true }, [campo(tipo === "pagar" ? "Pago em" : "Recebido em", pagoEm)]),
      );
    } else {
      linhas.push(
        el("div", { classe: "grade grade-2" }, [
          campo(modo === "mensal" ? "Valor de cada mês" : "Valor total", total),
          campo(modo === "mensal" ? "Primeiro mês vence em" : "1º vencimento", primeiro),
          campo(modo === "mensal" ? "Quantos meses" : "Quantas parcelas", quantidade),
          modo === "parcelado" ? campo("Intervalo", intervalo) : null,
        ]),
        el("div", {}, [el("button", { classe: "btn btn-peq", type: "button", texto: parcelas.length ? "Gerar de novo" : "Gerar parcelas", onclick: gerar })]),
        el("small", { classe: "muted", texto: "Depois de gerar, mude a data e o valor de qualquer parcela à vontade." }),
        areaParcelas,
      );
    }
    limpar(areaModo).append(...linhas);
    const area = areaModo.querySelector("#area-ja-pago");
    jaPago.onchange = () => { if (area) area.hidden = !jaPago.checked; };
  };
  if (modo === "mensal") quantidade.value = 12;
  desenharModo();

  limpar(corpo).append(
    cabecalho,
    dados,
    el("section", { classe: "cartao pilha" }, [el("h3", { texto: "Valor e vencimento" }), areaModo]),
    el("div", { classe: "reserva-acoes" }, [
      el("button", {
        classe: "btn btn-primario",
        type: "button",
        texto: "Lançar",
        onclick: async (e) => {
          const lista = modo === "vista" ? [{ vencimento: primeiro.value, valor: lerValor(total.value) }] : parcelas.map((p) => ({ vencimento: p.vencimento, valor: lerValor(p.valor) }));
          if (modo !== "vista" && !lista.length) return avisar("Gere as parcelas antes de lançar.", "erro");
          if (modo === "parcelado") {
            const soma = lista.reduce((s, p) => s + Math.round((p.valor || 0) * 100), 0) / 100;
            const alvo = lerValor(total.value);
            if (alvo > 0 && Math.abs(soma - alvo) >= 0.005 && !confirm(`As parcelas somam ${dinheiro(soma)}, e o total é ${dinheiro(alvo)}. Lançar assim mesmo?`)) return;
          }
          if (modo === "vista" && jaPago.checked && !conta.value) return avisar(`Escolha ${tipo === "pagar" ? "de qual conta saiu" : "em qual conta entrou"}.`, "erro");
          e.target.disabled = true;
          try {
            const r = await post(`${base}/lancamentos`, {
              tipo,
              ...comum(),
              recorrente: modo === "mensal",
              parcelas: lista,
              ja_pago: modo === "vista" && jaPago.checked,
              pago_em: pagoEm.value,
            });
            avisar(r.criados > 1 ? `${r.criados} parcelas lançadas.` : "Conta lançada.", "ok");
            aoTerminar();
          } catch (err) {
            avisar(err.message, "erro");
            e.target.disabled = false;
          }
        },
      }),
    ]),
  );
}

/** Pagar (ou receber): data, conta, juros, desconto — e se foi só uma parte. */
export function formularioDeBaixa(corpo, { ctx, cad, tipo, conta: l, aoTerminar }) {
  const n = NOME_DO_TIPO[tipo];
  const pagoEm = el("input", { classe: "input", type: "date", value: hojeIso() });
  const contaSel = seletor(cad.contas, l.conta_id ?? cad.formas.find((f) => f.id === l.forma_id)?.conta_id ?? cad.contas[0]?.id, "— escolha —");
  const forma = seletor(cad.formas, l.forma_id);
  const juros = el("input", { classe: "input", inputmode: "decimal", placeholder: "0,00" });
  const desconto = el("input", { classe: "input", inputmode: "decimal", placeholder: "0,00" });
  const parcial = el("input", { type: "checkbox" });
  const valorParcial = el("input", { classe: "input", inputmode: "decimal", placeholder: "Quanto foi pago" });
  const areaParcial = el("div", { hidden: true }, [campo("Valor pago agora", valorParcial, "O resto continua em aberto, como uma conta nova.")]);
  const totalEl = el("strong", {});
  const conta = () => {
    const principal = parcial.checked ? lerValor(valorParcial.value) || 0 : Number(l.valor);
    const t = Math.round((principal + (lerValor(juros.value) || 0) - (lerValor(desconto.value) || 0)) * 100) / 100;
    totalEl.textContent = `${n.feito === "Pago" ? "Total pago" : "Total recebido"}: ${dinheiro(t)}`;
  };
  for (const c of [juros, desconto, valorParcial]) c.addEventListener("input", conta);
  parcial.addEventListener("change", () => { areaParcial.hidden = !parcial.checked; conta(); });
  conta();

  limpar(corpo).append(
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h2", { texto: `${n.acao}: ${l.descricao}` }),
        el("p", { classe: "muted", texto: `${dinheiro(Number(l.valor))} · vence ${dataBr(l.vencimento)}${l.parcelas ? ` · parcela ${l.parcela}/${l.parcelas}` : ""}` }),
      ]),
      el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: aoTerminar }),
    ]),
    el("section", { classe: "cartao pilha" }, [
      el("div", { classe: "grade grade-2" }, [
        campo(tipo === "pagar" ? "Pago em" : "Recebido em", pagoEm),
        campo(n.saiu, contaSel),
        campo("Forma", forma),
        campo("Juros / multa", juros),
        campo("Desconto", desconto),
      ]),
      el("label", { classe: "linha-campos", style: "align-items:center;gap:8px" }, [parcial, el("span", { texto: tipo === "pagar" ? "Paguei só uma parte" : "Recebi só uma parte" })]),
      areaParcial,
      totalEl,
    ]),
    el("div", { classe: "reserva-acoes" }, [
      el("button", {
        classe: "btn btn-primario",
        type: "button",
        texto: `Confirmar — ${n.feito.toLowerCase()}`,
        onclick: async (e) => {
          if (!contaSel.value) return avisar(`Escolha ${n.saiu.toLowerCase()}.`, "erro");
          e.target.disabled = true;
          try {
            await post(`/v1/venues/${ctx.venue}/financeiro/lancamentos/${l.id}/baixa`, {
              pago_em: pagoEm.value,
              conta_id: contaSel.value,
              forma_id: forma.value || null,
              juros: juros.value,
              desconto: desconto.value,
              parcial: parcial.checked,
              valor_parcial: valorParcial.value,
            });
            avisar(`${n.feito}.`, "ok");
            aoTerminar();
          } catch (err) {
            avisar(err.message, "erro");
            e.target.disabled = false;
          }
        },
      }),
    ]),
  );
}
