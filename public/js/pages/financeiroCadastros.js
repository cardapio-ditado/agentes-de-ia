import { del, get, post, put } from "../api.js";
import { avisar, dinheiro, el, etiqueta, indicador, preencher, vazio } from "../ui.js";
import { dataBr } from "../relatorio.js";
import { nomeDaCategoria, seletorDeCategoria } from "./financeiroConta.js";

/**
 * Financeiro — cadastros: bancos e caixas, categorias, formas de pagamento
 * e fornecedores (com a ficha). Tudo já vem com o padrão de restaurante; a
 * casa só ajusta.
 */

const base = (ctx) => `/v1/venues/${ctx.venue}/financeiro`;
const NOME_DA_CONTA = { corrente: "Conta corrente", poupanca: "Poupança", caixa: "Caixa / dinheiro", digital: "Conta digital", investimento: "Investimento" };
const NOME_DA_FORMA = { dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito", boleto: "Boleto", transferencia: "Transferência", cheque: "Cheque", voucher: "Vale-refeição", outro: "Outro" };

const campo = (rotulo, controle, ajuda) =>
  el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle, ajuda ? el("small", { classe: "muted", texto: ajuda }) : null]);
const opcoes = (mapa, atual) => Object.entries(mapa).map(([v, t]) => el("option", { value: v, texto: t, selected: v === atual }));
const valorNoCampo = (n) => (n === null || n === undefined ? "" : Number(n).toFixed(2).replace(".", ","));

async function carregar(corpo, ctx) {
  corpo.classList.add("pilha");
  preencher(corpo, el("p", { classe: "muted", texto: "Carregando…" }));
  try {
    return await get(`${base(ctx)}/cadastros`);
  } catch (e) {
    preencher(corpo, vazio("Cadastros indisponíveis", e.message));
    return null;
  }
}

async function salvar(ctx, qual, id, dados) {
  return id ? put(`${base(ctx)}/${qual}/${id}`, dados) : post(`${base(ctx)}/${qual}`, dados);
}

function botaoSalvar(texto, acao) {
  return el("button", {
    classe: "btn btn-primario",
    type: "button",
    texto,
    onclick: async (e) => {
      e.target.disabled = true;
      try {
        await acao();
      } catch (err) {
        avisar(err.message, "erro");
        e.target.disabled = false;
      }
    },
  });
}

// ============================================================
// Bancos e caixas
// ============================================================
export async function financeiroContas(corpo, ctx) {
  const cad = await carregar(corpo, ctx);
  if (!cad) return;
  const recarregar = () => financeiroContas(corpo, ctx);
  const ativas = cad.contas.filter((c) => c.ativo);
  const total = ativas.reduce((s, c) => s + Math.round(Number(c.saldo) * 100), 0) / 100;
  let transferencias = [];
  try {
    transferencias = await get(`${base(ctx)}/transferencias`);
  } catch {
    /* lista opcional */
  }
  const nomeConta = (id) => cad.contas.find((c) => c.id === id)?.nome ?? "—";

  preencher(corpo, 
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h2", { texto: "Bancos e caixas" }),
        el("p", { classe: "muted", texto: "Cada lugar onde o dinheiro da casa fica. O saldo é conta: o saldo inicial + o que entrou − o que saiu." }),
      ]),
      el("div", { classe: "reserva-acoes", style: "margin:0" }, [
        ativas.length > 1 ? el("button", { classe: "btn btn-peq", type: "button", texto: "Transferir entre contas", onclick: () => formTransferencia(corpo, ctx, cad, recarregar) }) : null,
        el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "+ Banco ou caixa", onclick: () => formConta(corpo, ctx, null, recarregar) }),
      ]),
    ]),
    el("div", { classe: "grade" }, [
      indicador({ rotulo: "Saldo somado", valor: dinheiro(total), nota: `${ativas.length} conta(s)`, destaque: total < 0 }),
      ...ativas.map((c) => indicador({ rotulo: c.nome, valor: dinheiro(Number(c.saldo)), nota: [NOME_DA_CONTA[c.tipo], c.banco].filter(Boolean).join(" · "), destaque: Number(c.saldo) < 0 })),
    ]),
    el("div", { classe: "tabela" }, cad.contas.map((c) =>
      el("div", { classe: "linha-tabela linha-clicavel", onclick: () => formConta(corpo, ctx, c, recarregar) }, [
        el("div", { classe: "linha-principal", style: "flex:1;min-width:0" }, [
          el("strong", { texto: c.nome }),
          el("span", { classe: "muted", texto: [NOME_DA_CONTA[c.tipo], c.banco, c.agencia ? `ag. ${c.agencia}` : null, c.numero ? `c/c ${c.numero}` : null, `saldo inicial ${dinheiro(Number(c.saldo_inicial))} em ${dataBr(c.saldo_inicial_em)}`].filter(Boolean).join(" · ") }),
        ]),
        c.ativo ? el("strong", { texto: dinheiro(Number(c.saldo)) }) : etiqueta("arquivada"),
      ]))),
    transferencias.length
      ? el("section", { classe: "pilha" }, [
          el("h3", { texto: "Transferências" }),
          el("div", { classe: "tabela" }, transferencias.slice(0, 30).map((t) =>
            el("div", { classe: "linha-tabela" }, [
              el("div", { classe: "linha-principal", style: "flex:1;min-width:0" }, [
                el("strong", { texto: `${nomeConta(t.de_conta_id)} → ${nomeConta(t.para_conta_id)}` }),
                el("span", { classe: "muted", texto: [dataBr(t.dia), t.descricao].filter(Boolean).join(" · ") }),
              ]),
              el("strong", { texto: dinheiro(Number(t.valor)) }),
              el("button", {
                classe: "btn-icone",
                type: "button",
                title: "Apagar",
                texto: "🗑",
                onclick: async () => {
                  if (!confirm("Apagar esta transferência?")) return;
                  try {
                    await del(`${base(ctx)}/transferencias/${t.id}`);
                    recarregar();
                  } catch (e) {
                    avisar(e.message, "erro");
                  }
                },
              }),
            ]))),
        ])
      : null,
  );
}

function formConta(corpo, ctx, c, voltar) {
  const nome = el("input", { classe: "input", value: c?.nome ?? "", placeholder: "Itaú, Sicredi, Caixa da casa…" });
  const tipo = el("select", { classe: "select" }, opcoes(NOME_DA_CONTA, c?.tipo ?? "corrente"));
  const banco = el("input", { classe: "input", value: c?.banco ?? "" });
  const agencia = el("input", { classe: "input", value: c?.agencia ?? "" });
  const numero = el("input", { classe: "input", value: c?.numero ?? "" });
  const saldo = el("input", { classe: "input", inputmode: "decimal", value: valorNoCampo(c?.saldo_inicial ?? 0) });
  const saldoEm = el("input", { classe: "input", type: "date", value: c?.saldo_inicial_em ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba" }).format(new Date()) });
  preencher(corpo, 
    el("div", { classe: "cabecalho-secao" }, [el("h2", { texto: c ? c.nome : "Novo banco ou caixa" }), el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: voltar })]),
    el("section", { classe: "cartao pilha" }, [
      el("div", { classe: "grade grade-2" }, [
        campo("Nome", nome),
        campo("Tipo", tipo),
        campo("Banco", banco),
        campo("Agência", agencia),
        campo("Conta", numero),
        campo("Saldo inicial", saldo, "O saldo do extrato no dia abaixo."),
        campo("Saldo do dia", saldoEm, "A partir deste dia o sistema soma entradas e saídas."),
      ]),
    ]),
    el("div", { classe: "reserva-acoes" }, [
      botaoSalvar("Salvar", async () => {
        await salvar(ctx, "contas", c?.id, { nome: nome.value, tipo: tipo.value, banco: banco.value, agencia: agencia.value, numero: numero.value, saldo_inicial: saldo.value, saldo_inicial_em: saldoEm.value });
        avisar("Salvo.", "ok");
        voltar();
      }),
      c?.ativo
        ? el("button", { classe: "btn btn-perigo", type: "button", texto: "Arquivar", onclick: async () => { if (!confirm(`Arquivar ${c.nome}? O histórico fica.`)) return; await del(`${base(ctx)}/contas/${c.id}`).catch((e) => avisar(e.message, "erro")); voltar(); } })
        : c
          ? el("button", { classe: "btn", type: "button", texto: "Reativar", onclick: async () => { await put(`${base(ctx)}/contas/${c.id}`, { ...c, ativo: true }).catch((e) => avisar(e.message, "erro")); voltar(); } })
          : null,
    ]),
  );
}

function formTransferencia(corpo, ctx, cad, voltar) {
  const ativas = cad.contas.filter((c) => c.ativo);
  const sel = (atual) => el("select", { classe: "select" }, ativas.map((c) => el("option", { value: c.id, texto: `${c.nome} (${dinheiro(Number(c.saldo))})`, selected: c.id === atual })));
  const de = sel(ativas.find((c) => c.tipo === "caixa")?.id ?? ativas[0]?.id);
  const para = sel(ativas.find((c) => c.tipo !== "caixa")?.id ?? ativas[1]?.id);
  const valor = el("input", { classe: "input", inputmode: "decimal", placeholder: "0,00" });
  const dia = el("input", { classe: "input", type: "date", value: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba" }).format(new Date()) });
  const descricao = el("input", { classe: "input", placeholder: "Ex.: depósito do caixa de sábado" });
  preencher(corpo, 
    el("div", { classe: "cabecalho-secao" }, [el("h2", { texto: "Transferir entre contas" }), el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: voltar })]),
    el("section", { classe: "cartao pilha" }, [
      el("div", { classe: "grade grade-2" }, [campo("De", de), campo("Para", para), campo("Valor", valor), campo("Dia", dia)]),
      campo("Descrição", descricao),
      el("small", { classe: "muted", texto: "Transferência não é despesa nem receita: só muda o dinheiro de lugar." }),
    ]),
    el("div", { classe: "reserva-acoes" }, [
      botaoSalvar("Transferir", async () => {
        await post(`${base(ctx)}/transferencias`, { de_conta_id: de.value, para_conta_id: para.value, valor: valor.value, dia: dia.value, descricao: descricao.value });
        avisar("Transferido.", "ok");
        voltar();
      }),
    ]),
  );
}

// ============================================================
// Categorias
// ============================================================
export async function financeiroCategorias(corpo, ctx, tipoInicial = "despesa") {
  const cad = await carregar(corpo, ctx);
  if (!cad) return;
  let tipo = tipoInicial;
  const recarregar = () => financeiroCategorias(corpo, ctx, tipo);
  const nomeGrupo = Object.fromEntries(cad.grupos.map((g) => [g.id, g.nome]));

  const desenhar = () => {
    const pais = cad.categorias.filter((c) => !c.pai_id && c.tipo === tipo);
    preencher(corpo, 
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Categorias" }),
          el("p", { classe: "muted", texto: "Categoria e subcategoria. A linha do resultado (o grupo) vale para a categoria e tudo dentro dela." }),
        ]),
        el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "+ Categoria", onclick: () => formCategoria(corpo, ctx, cad, { tipo }, recarregar) }),
      ]),
      el("div", { classe: "abas" }, [["despesa", "Despesas"], ["receita", "Receitas"]].map(([id, rotulo]) =>
        el("button", { classe: `aba${tipo === id ? " aba-ativa" : ""}`, type: "button", texto: rotulo, onclick: () => { tipo = id; desenhar(); } }))),
      ...pais.map((p) => {
        const filhas = cad.categorias.filter((c) => c.pai_id === p.id);
        return el("section", { classe: `cartao pilha${p.ativo ? "" : " arquivada"}` }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [el("h3", { texto: p.nome }), el("small", { classe: "muted", texto: nomeGrupo[p.grupo] ?? p.grupo })]),
            el("div", { classe: "reserva-acoes", style: "margin:0" }, [
              el("button", { classe: "btn btn-peq", type: "button", texto: "+ Sub", onclick: () => formCategoria(corpo, ctx, cad, { tipo, pai_id: p.id }, recarregar) }),
              el("button", { classe: "btn btn-peq", type: "button", texto: "Editar", onclick: () => formCategoria(corpo, ctx, cad, p, recarregar) }),
            ]),
          ]),
          filhas.length
            ? el("div", { classe: "chips" }, filhas.map((f) =>
                el("button", { classe: `chip${f.ativo ? "" : " chip-apagado"}`, type: "button", texto: f.nome, title: "Editar", onclick: () => formCategoria(corpo, ctx, cad, f, recarregar) })))
            : null,
        ]);
      }),
    );
  };
  desenhar();
}

function formCategoria(corpo, ctx, cad, c, voltar) {
  const nome = el("input", { classe: "input", value: c?.nome ?? "" });
  const sub = Boolean(c.pai_id);
  const grupo = el("select", { classe: "select" }, cad.grupos.filter((g) => g.tipo === (c.tipo ?? "despesa")).map((g) => el("option", { value: g.id, texto: g.nome, selected: g.id === c.grupo })));
  const pai = sub ? cad.categorias.find((x) => x.id === c.pai_id) : null;
  preencher(corpo, 
    el("div", { classe: "cabecalho-secao" }, [
      el("h2", { texto: c.id ? c.nome : sub ? `Nova subcategoria em ${pai?.nome ?? ""}` : "Nova categoria" }),
      el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: voltar }),
    ]),
    el("section", { classe: "cartao pilha" }, [
      campo("Nome", nome),
      sub ? el("p", { classe: "muted", texto: `Dentro de ${pai?.nome}: entra na mesma linha do resultado.` }) : campo("Linha do resultado do mês", grupo, "É onde esta categoria soma no resultado: CMV, pessoal, ocupação…"),
    ]),
    el("div", { classe: "reserva-acoes" }, [
      botaoSalvar("Salvar", async () => {
        await salvar(ctx, "categorias", c.id, { nome: nome.value, tipo: c.tipo, grupo: sub ? pai?.grupo : grupo.value, pai_id: c.pai_id ?? null, ...(c.id ? { ativo: c.ativo } : {}) });
        avisar("Salvo.", "ok");
        voltar();
      }),
      c.id && c.ativo
        ? el("button", { classe: "btn btn-perigo", type: "button", texto: "Arquivar", onclick: async () => { if (!confirm(`Arquivar ${c.nome}? Some das listas; as contas já lançadas continuam com ela.`)) return; await del(`${base(ctx)}/categorias/${c.id}`).catch((e) => avisar(e.message, "erro")); voltar(); } })
        : c.id
          ? el("button", { classe: "btn", type: "button", texto: "Reativar", onclick: async () => { await put(`${base(ctx)}/categorias/${c.id}`, { ...c, ativo: true }).catch((e) => avisar(e.message, "erro")); voltar(); } })
          : null,
    ]),
  );
}

// ============================================================
// Formas de pagamento
// ============================================================
export async function financeiroFormas(corpo, ctx) {
  const cad = await carregar(corpo, ctx);
  if (!cad) return;
  const recarregar = () => financeiroFormas(corpo, ctx);
  const nomeConta = (id) => cad.contas.find((c) => c.id === id)?.nome;
  preencher(corpo, 
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h2", { texto: "Formas de pagamento" }),
        el("p", { classe: "muted", texto: "Como se paga e se recebe. No cartão, o prazo (D+1, D+30) e a taxa da maquininha entram na conta do que vai cair." }),
      ]),
      el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "+ Forma", onclick: () => formForma(corpo, ctx, cad, null, recarregar) }),
    ]),
    el("div", { classe: "tabela" }, cad.formas.map((f) =>
      el("div", { classe: "linha-tabela linha-clicavel", onclick: () => formForma(corpo, ctx, cad, f, recarregar) }, [
        el("div", { classe: "linha-principal", style: "flex:1;min-width:0" }, [
          el("strong", { texto: f.nome }),
          el("span", { classe: "muted", texto: [NOME_DA_FORMA[f.tipo], f.prazo_dias ? `cai em ${f.prazo_dias} dia(s)` : "na hora", Number(f.taxa) ? `taxa ${String(f.taxa).replace(".", ",")}%` : null, nomeConta(f.conta_id) ? `entra em ${nomeConta(f.conta_id)}` : null].filter(Boolean).join(" · ") }),
        ]),
        f.ativo ? null : etiqueta("arquivada"),
      ]))),
  );
}

function formForma(corpo, ctx, cad, f, voltar) {
  const nome = el("input", { classe: "input", value: f?.nome ?? "" });
  const tipo = el("select", { classe: "select" }, opcoes(NOME_DA_FORMA, f?.tipo ?? "outro"));
  const prazo = el("input", { classe: "input", type: "number", min: 0, max: 120, value: f?.prazo_dias ?? 0 });
  const taxa = el("input", { classe: "input", inputmode: "decimal", value: f ? String(f.taxa).replace(".", ",") : "0" });
  const conta = el("select", { classe: "select" }, [el("option", { value: "", texto: "—" }), ...cad.contas.filter((c) => c.ativo).map((c) => el("option", { value: c.id, texto: c.nome, selected: c.id === f?.conta_id }))]);
  preencher(corpo, 
    el("div", { classe: "cabecalho-secao" }, [el("h2", { texto: f ? f.nome : "Nova forma de pagamento" }), el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: voltar })]),
    el("section", { classe: "cartao pilha" }, [
      el("div", { classe: "grade grade-2" }, [
        campo("Nome", nome),
        campo("Tipo", tipo),
        campo("Em quantos dias o dinheiro cai", prazo, "Débito costuma ser 1; crédito, 30."),
        campo("Taxa (%)", taxa, "O que a maquininha ou o app fica."),
        campo("Conta onde cai / de onde sai", conta),
      ]),
    ]),
    el("div", { classe: "reserva-acoes" }, [
      botaoSalvar("Salvar", async () => {
        await salvar(ctx, "formas", f?.id, { nome: nome.value, tipo: tipo.value, prazo_dias: prazo.value, taxa: taxa.value, conta_id: conta.value || null, ...(f ? { ativo: f.ativo } : {}) });
        avisar("Salvo.", "ok");
        voltar();
      }),
      f?.ativo ? el("button", { classe: "btn btn-perigo", type: "button", texto: "Arquivar", onclick: async () => { await del(`${base(ctx)}/formas/${f.id}`).catch((e) => avisar(e.message, "erro")); voltar(); } }) : null,
    ]),
  );
}

// ============================================================
// Fornecedores e a ficha
// ============================================================
export async function financeiroFornecedores(corpo, ctx) {
  const cad = await carregar(corpo, ctx);
  if (!cad) return;
  const recarregar = () => financeiroFornecedores(corpo, ctx);
  let termo = "";
  const lista = el("div", { classe: "tabela" });
  const busca = el("input", { classe: "input", type: "search", placeholder: "Buscar por nome, CNPJ ou telefone…" });
  const desenharLista = () => {
    const t = termo.toLowerCase();
    const achados = cad.fornecedores.filter((f) => !t || [f.nome, f.razao_social, f.cnpj, f.telefone].filter(Boolean).some((v) => String(v).toLowerCase().includes(t)));
    preencher(lista, 
      ...(achados.length
        ? achados.map((f) =>
            el("div", { classe: "linha-tabela linha-clicavel", onclick: () => fichaFornecedor(corpo, ctx, cad, f.id, recarregar) }, [
              el("div", { classe: "linha-principal", style: "flex:1;min-width:0" }, [
                el("strong", { texto: f.nome }),
                el("span", { classe: "muted", texto: [f.razao_social, f.cnpj ? cnpjBonito(f.cnpj) : null, f.categoria_id ? nomeDaCategoria(cad, f.categoria_id) : null, f.prazo_dias ? `paga em ${f.prazo_dias} dias` : null].filter(Boolean).join(" · ") || "sem dados ainda" }),
              ]),
              f.ativo === false ? etiqueta("arquivado") : null,
            ]))
        : [vazio("Nenhum fornecedor", "Cadastre quem manda boleto: bebidas, alimentos, gás, contador.")]),
    );
  };
  busca.addEventListener("input", () => { termo = busca.value; desenharLista(); });
  preencher(corpo, 
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h2", { texto: "Fornecedores" }),
        el("p", { classe: "muted", texto: "Os mesmos das compras do estoque. A ficha mostra quanto a casa compra de cada um — bom para negociar." }),
      ]),
      el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "+ Fornecedor", onclick: () => formFornecedor(corpo, ctx, cad, null, recarregar) }),
    ]),
    busca,
    lista,
  );
  desenharLista();
}

const cnpjBonito = (d) =>
  d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : d;

async function fichaFornecedor(corpo, ctx, cad, id, voltar) {
  preencher(corpo, el("p", { classe: "muted", texto: "Abrindo a ficha…" }));
  let ficha;
  try {
    ficha = await get(`${base(ctx)}/fornecedores/${id}`);
  } catch (e) {
    preencher(corpo, vazio("Ficha indisponível", e.message));
    return;
  }
  const f = ficha.fornecedor;
  const n = ficha.numeros;
  const dado = (rotulo, valor) => (valor ? el("div", { classe: "par" }, [el("small", { classe: "muted", texto: rotulo }), el("span", { texto: valor })]) : null);
  const ESTADO = { atrasado: ["atrasada", "etiqueta-perigo"], vence_hoje: ["vence hoje", "etiqueta-alerta"], aberto: ["em aberto", ""], pago: ["paga", "etiqueta-ok"], cancelado: ["cancelada", ""] };
  preencher(corpo, 
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [el("h2", { texto: f.nome }), el("p", { classe: "muted", texto: [f.razao_social, f.cnpj ? cnpjBonito(f.cnpj) : null].filter(Boolean).join(" · ") })]),
      el("div", { classe: "reserva-acoes", style: "margin:0" }, [
        el("button", { classe: "btn btn-peq", type: "button", texto: "Editar", onclick: () => formFornecedor(corpo, ctx, cad, f, () => fichaFornecedor(corpo, ctx, cad, id, voltar)) }),
        el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: voltar }),
      ]),
    ]),
    el("div", { classe: "grade" }, [
      indicador({ rotulo: "Pago em 12 meses", valor: dinheiro(n.pago_12m), nota: `média de ${dinheiro(n.media_mensal_12m)} por mês` }),
      indicador({ rotulo: "Em aberto", valor: dinheiro(n.em_aberto), nota: n.proximo_vencimento ? `próximo vence ${dataBr(n.proximo_vencimento)}` : "nada a vencer" }),
      indicador({ rotulo: "Atrasado", valor: dinheiro(n.atrasado), destaque: n.atrasado > 0 }),
    ]),
    el("section", { classe: "cartao pilha" }, [
      el("h3", { texto: "Dados" }),
      el("div", { classe: "grade grade-2 pares" }, [
        dado("Contato", [f.contato, f.telefone].filter(Boolean).join(" · ")),
        dado("E-mail", f.email),
        dado("Endereço", f.endereco),
        dado("Pix", f.chave_pix),
        dado("Banco", [f.banco, f.agencia ? `ag. ${f.agencia}` : null, f.conta ? `c/c ${f.conta}` : null].filter(Boolean).join(" · ")),
        dado("Prazo de pagamento", f.prazo_dias ? `${f.prazo_dias} dias` : null),
        dado("Categoria padrão", f.categoria_id ? nomeDaCategoria(cad, f.categoria_id) : null),
        dado("Observações", f.observacoes),
      ].filter(Boolean)),
      f.telefone ? el("a", { classe: "btn btn-peq", href: `https://wa.me/${f.telefone.length <= 11 ? `55${f.telefone}` : f.telefone}`, target: "_blank", rel: "noopener", texto: "Chamar no WhatsApp" }) : null,
    ]),
    n.categorias.length
      ? el("p", { classe: "muted", texto: `O que se compra dele: ${n.categorias.map((c) => `${nomeDaCategoria(cad, c.categoria_id)} (${dinheiro(c.valor)})`).join(" · ")}` })
      : null,
    el("section", { classe: "pilha" }, [
      el("h3", { texto: "Contas" }),
      ficha.lancamentos.length
        ? el("div", { classe: "tabela" }, ficha.lancamentos.map((l) =>
            el("div", { classe: "linha-tabela" }, [
              el("div", { classe: "linha-principal", style: "flex:1;min-width:0" }, [
                el("strong", { texto: `${l.descricao}${l.parcelas ? ` (${l.parcela}/${l.parcelas})` : ""}` }),
                el("span", { classe: "muted", texto: `vence ${dataBr(l.vencimento)}${l.pago_em ? ` · pago ${dataBr(l.pago_em)}` : ""}` }),
              ]),
              el("strong", { texto: dinheiro(Number(l.valor_pago ?? l.valor)) }),
              etiqueta(...(ESTADO[l.estado] ?? ESTADO.aberto)),
            ])))
        : el("p", { classe: "muted", texto: "Nenhuma conta lançada para este fornecedor ainda." }),
    ]),
    ficha.compras.length
      ? el("section", { classe: "pilha" }, [
          el("h3", { texto: "Compras no estoque" }),
          el("div", { classe: "tabela" }, ficha.compras.map((c) =>
            el("div", { classe: "linha-tabela" }, [
              el("span", { style: "flex:1", texto: `${dataBr(c.data_compra)}${c.documento ? ` · nota ${c.documento}` : ""}` }),
              el("strong", { texto: dinheiro(Number(c.valor_total)) }),
              etiqueta(c.status),
            ]))),
        ])
      : null,
  );
}

function formFornecedor(corpo, ctx, cad, f, voltar) {
  const i = (v, extra = {}) => el("input", { classe: "input", value: v ?? "", ...extra });
  const c = {
    nome: i(f?.nome, { placeholder: "Como a casa chama (ex.: Ambev)" }),
    razao_social: i(f?.razao_social),
    tipo_pessoa: el("select", { classe: "select" }, opcoes({ pj: "Empresa (CNPJ)", pf: "Pessoa (CPF)" }, f?.tipo_pessoa ?? "pj")),
    cnpj: i(f?.cnpj ? cnpjBonito(f.cnpj) : "", { inputmode: "numeric" }),
    contato: i(f?.contato, { placeholder: "Nome do vendedor" }),
    telefone: i(f?.telefone, { type: "tel" }),
    email: i(f?.email, { type: "email" }),
    endereco: i(f?.endereco),
    chave_pix: i(f?.chave_pix),
    banco: i(f?.banco),
    agencia: i(f?.agencia),
    conta: i(f?.conta),
    prazo_dias: i(f?.prazo_dias ?? "", { type: "number", min: 0, max: 180, placeholder: "Ex.: 28" }),
    categoria_id: seletorDeCategoria(cad, "pagar", f?.categoria_id),
    forma_id: el("select", { classe: "select" }, [el("option", { value: "", texto: "—" }), ...cad.formas.filter((x) => x.ativo).map((x) => el("option", { value: x.id, texto: x.nome, selected: x.id === f?.forma_id }))]),
    observacoes: el("textarea", { classe: "input", rows: 2, texto: f?.observacoes ?? "" }),
  };
  preencher(corpo, 
    el("div", { classe: "cabecalho-secao" }, [el("h2", { texto: f ? f.nome : "Novo fornecedor" }), el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: voltar })]),
    el("section", { classe: "cartao pilha" }, [
      el("div", { classe: "grade grade-2" }, [
        campo("Nome", c.nome),
        campo("Razão social", c.razao_social),
        campo("Tipo", c.tipo_pessoa),
        campo("CNPJ / CPF", c.cnpj),
        campo("Contato", c.contato),
        campo("WhatsApp / telefone", c.telefone),
        campo("E-mail", c.email),
        campo("Endereço", c.endereco),
      ]),
    ]),
    el("section", { classe: "cartao pilha" }, [
      el("h3", { texto: "Como pagar" }),
      el("div", { classe: "grade grade-2" }, [
        campo("Chave Pix", c.chave_pix),
        campo("Banco", c.banco),
        campo("Agência", c.agencia),
        campo("Conta", c.conta),
        campo("Prazo que ele dá (dias)", c.prazo_dias, "Ao lançar uma conta dele, o vencimento já vem com este prazo."),
        campo("Categoria padrão", c.categoria_id),
        campo("Forma de pagamento padrão", c.forma_id),
      ]),
      campo("Observações", c.observacoes),
    ]),
    el("div", { classe: "reserva-acoes" }, [
      botaoSalvar("Salvar", async () => {
        const dados = Object.fromEntries(Object.entries(c).map(([k, ctl]) => [k, ctl.value]));
        await salvar(ctx, "fornecedores", f?.id, { ...dados, categoria_id: dados.categoria_id || null, forma_id: dados.forma_id || null, ...(f ? { ativo: f.ativo !== false } : {}) });
        avisar("Fornecedor salvo.", "ok");
        voltar();
      }),
      f && f.ativo !== false
        ? el("button", { classe: "btn btn-perigo", type: "button", texto: "Arquivar", onclick: async () => { if (!confirm(`Arquivar ${f.nome}?`)) return; await del(`${base(ctx)}/fornecedores/${f.id}`).catch((e) => avisar(e.message, "erro")); voltar(); } })
        : null,
    ]),
  );
}
