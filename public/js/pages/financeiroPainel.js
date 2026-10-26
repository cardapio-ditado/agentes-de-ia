import { get } from "../api.js";
import { dinheiro, el, etiqueta, indicador, preencher, vazio } from "../ui.js";
import { botaoDePdf, dataBr, imprimirRelatorio } from "../relatorio.js";
import { graficoDeResultado, graficoDeSaldo, reaisCurtos } from "./financeiroGraficos.js";

/**
 * Financeiro — o painel (sobrou quanto este mês?) e o fluxo de caixa (vai
 * faltar dinheiro?).
 */

const hojeIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba" }).format(new Date());
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeDoMes = (iso) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
const pctBr = (v) => (v === null || v === undefined ? "—" : `${String(v).replace(".", ",")}%`);
const larguraUtil = (no) => Math.max(300, Math.min(1100, (no.clientWidth || 720) - 34));

/** Prime cost (CMV + pessoal sobre a venda): até 60% é saudável; passou de 65%, aperta. */
function seloDoPrimeCost(v) {
  if (v === null) return null;
  if (v <= 60) return etiqueta("saudável", "etiqueta-ok");
  if (v <= 65) return etiqueta("no limite", "etiqueta-alerta");
  return etiqueta("alto", "etiqueta-perigo");
}

function avisoDeNegativo(neg) {
  if (!neg) return null;
  return el("section", { classe: "cartao cartao-atencao pilha" }, [
    el("strong", { texto: `Em ${dataBr(neg.dia)} o caixa fica negativo: ${dinheiro(neg.saldo)}.` }),
    el("p", { classe: "muted", style: "margin:0", texto: "Pelo que vence e pelo que está para entrar. Dá tempo de antecipar um recebimento, segurar uma compra ou negociar a data com o fornecedor." }),
  ]);
}

// ============================================================
// Painel
// ============================================================
export async function painelFinanceiro(raiz, ctx) {
  const corpo = el("div", { classe: "pilha" });
  raiz.append(corpo);
  let mes = sessionStorage.getItem("brasa.fin.painel.mes") || hojeIso().slice(0, 7);
  await carregar();

  async function carregar() {
    try {
      sessionStorage.setItem("brasa.fin.painel.mes", mes);
    } catch {
      /* navegação privada */
    }
    preencher(corpo, el("p", { classe: "muted", texto: "Calculando…" }));
    let p;
    try {
      p = await get(`/v1/venues/${ctx.venue}/financeiro/painel?mes=${mes}`);
    } catch (e) {
      preencher(corpo, vazio("Painel indisponível", e.message));
      return;
    }
    desenhar(p);
  }

  function desenhar(p) {
    const r = p.resultado;
    const seletorMes = el("input", { classe: "input", type: "month", value: mes, style: "max-width:190px" });
    seletorMes.addEventListener("change", () => { if (seletorMes.value) { mes = seletorMes.value; carregar(); } });
    const semDados = !r.receita && !r.linhas.some((l) => l.valor) && !p.saldo_hoje;
    const sobreVendas = r.base_dos_percentuais === "vendas";

    const linhaDre = (rotulo, valor, pct, { forte = false, menos = false } = {}) =>
      el("div", { classe: `dre-linha${forte ? " dre-forte" : ""}` }, [
        el("span", { texto: `${menos ? "(−) " : forte ? "= " : ""}${rotulo}` }),
        el("span", { classe: `dre-valor${forte && valor < 0 ? " texto-perigo" : ""}`, texto: dinheiro(valor) }),
        el("span", { classe: "dre-pct muted", texto: pctBr(pct) }),
      ]);
    const L = Object.fromEntries(r.linhas.map((l) => [l.grupo, l]));
    const dre = el("div", { classe: "dre" }, [
      linhaDre("Receitas", r.receita, r.receita ? 100 : null),
      L.deducao.valor ? linhaDre(L.deducao.nome, L.deducao.valor, L.deducao.pct, { menos: true }) : null,
      linhaDre("Receita líquida", r.receita_liquida, r.receita ? Math.round((r.receita_liquida / r.receita) * 1000) / 10 : null, { forte: true }),
      linhaDre(L.cmv.nome, L.cmv.valor, L.cmv.pct, { menos: true }),
      linhaDre("Margem bruta", r.margem_bruta, null, { forte: true }),
      ...["pessoal", "ocupacao", "operacao", "administrativo", "marketing"].map((g) => linhaDre(L[g].nome, L[g].valor, L[g].pct, { menos: true })),
      linhaDre("Resultado operacional", r.resultado_operacional, r.pct.resultado_operacional, { forte: true }),
      ...["financeiro", "outros", "investimento", "retirada"].filter((g) => L[g].valor).map((g) => linhaDre(L[g].nome, L[g].valor, L[g].pct, { menos: true })),
      linhaDre("Resultado do mês", r.resultado_final, r.pct.resultado_final, { forte: true }),
    ]);

    const despesas = r.categorias.filter((c) => c.grupo !== "receita" && c.valor > 0).slice(0, 6);
    const maior = Math.max(1, ...despesas.map((d) => d.valor));

    preencher(corpo, 
      el("div", { classe: "cabecalho-secao" }, [
        el("div", { classe: "linha-campos", style: "gap:8px;align-items:center" }, [el("span", { classe: "muted", texto: "Mês:" }), seletorMes]),
        botaoDePdf(() => relatorio(p), "PDF do mês"),
      ]),
      semDados
        ? vazio("O painel acende quando a casa lança as contas", "Cadastre os bancos com o saldo de hoje e lance as contas do mês em Contas a pagar e a receber.")
        : null,
      avisoDeNegativo(p.primeiro_negativo),
      el("div", { classe: "grade" }, [
        indicador({ rotulo: "Saldo hoje", valor: dinheiro(p.saldo_hoje), nota: "somando bancos e caixas", destaque: p.saldo_hoje < 0 }),
        indicador({ rotulo: "Saldo em 30 dias", valor: dinheiro(p.saldo_em_30_dias), nota: p.menor_saldo_30_dias ? `pior dia: ${dataBr(p.menor_saldo_30_dias.dia).slice(0, 5)} (${reaisCurtos(p.menor_saldo_30_dias.saldo)})` : "previsto", destaque: p.saldo_em_30_dias < 0 }),
        indicador({ rotulo: "A pagar em 7 dias", valor: dinheiro(p.a_vencer.pagar.hoje + p.a_vencer.pagar.proximos_7), nota: p.a_vencer.pagar.atrasado ? `+ ${dinheiro(p.a_vencer.pagar.atrasado)} atrasado` : "nada atrasado", destaque: p.a_vencer.pagar.atrasado > 0 }),
        indicador({ rotulo: "A receber em 7 dias", valor: dinheiro(p.a_vencer.receber.hoje + p.a_vencer.receber.proximos_7), nota: p.a_vencer.receber.atrasado ? `+ ${dinheiro(p.a_vencer.receber.atrasado)} atrasado para cobrar` : "" }),
      ]),
      el("div", { classe: "grade grade-2 fin-colunas" }, [
        el("section", { classe: "cartao pilha" }, [
          el("div", {}, [
            el("h3", { texto: `Resultado de ${nomeDoMes(p.mes)}` }),
            el("p", { classe: "muted", style: "margin:0", texto: "Pelo mês de cada conta (competência), paga ou não." }),
          ]),
          dre,
          sobreVendas ? el("p", { classe: "muted", style: "margin:0", texto: `Os percentuais estão sobre as vendas registradas no estoque (${dinheiro(p.vendas_do_mes)}), porque as vendas ainda não foram lançadas no Financeiro.` }) : null,
          r.sem_categoria.quantidade ? el("p", { classe: "texto-alerta", style: "margin:0", texto: `${r.sem_categoria.quantidade} conta(s) sem categoria (${dinheiro(r.sem_categoria.valor)}): estão em "Outros".` }) : null,
        ]),
        el("div", { classe: "pilha" }, [
          el("section", { classe: "cartao pilha" }, [
            el("div", { classe: "cabecalho-secao" }, [el("h3", { texto: "Prime cost" }), seloDoPrimeCost(r.pct.prime_cost)]),
            el("div", { classe: "numero-grande", texto: pctBr(r.pct.prime_cost) }),
            el("p", { classe: "muted", style: "margin:0", texto: `CMV ${pctBr(r.pct.cmv)} + pessoal ${pctBr(r.pct.pessoal)} sobre a venda. Em restaurante, até 60% é saudável.` }),
          ]),
          el("section", { classe: "cartao pilha" }, [
            el("h3", { texto: "Ponto de equilíbrio" }),
            r.ponto_de_equilibrio !== null
              ? el("div", { classe: "pilha", style: "gap:4px" }, [
                  el("div", { classe: "numero-grande", texto: dinheiro(p.ponto_de_equilibrio_por_dia) }),
                  el("p", { classe: "muted", style: "margin:0", texto: `por dia (${dinheiro(r.ponto_de_equilibrio)} no mês) para pagar ${dinheiro(r.custos_fixos)} de custo fixo. De cada R$ 100 vendidos sobram R$ ${String(r.margem_de_contribuicao).replace(".", ",")} depois de imposto, taxa e mercadoria.` }),
                ])
              : el("p", { classe: "muted", style: "margin:0", texto: "Aparece quando o mês tiver venda e custo lançados." }),
          ]),
          el("section", { classe: "cartao pilha" }, [
            el("h3", { texto: "Caixa do mês" }),
            el("div", { classe: "dre" }, [
              linhaDre("Entrou", p.caixa_do_mes.entradas, null),
              linhaDre("Saiu", p.caixa_do_mes.saidas, null, { menos: true }),
              linhaDre("Sobrou no caixa", p.caixa_do_mes.saldo, null, { forte: true }),
            ]),
            el("p", { classe: "muted", style: "margin:0", texto: "Pelo dia do pagamento: é o que mexeu no banco." }),
          ]),
        ]),
      ]),
      el("section", { classe: "cartao pilha", id: "fin-grafico-meses" }, [
        el("h3", { texto: "Resultado dos últimos 6 meses" }),
      ]),
      despesas.length
        ? el("section", { classe: "cartao pilha" }, [
            el("h3", { texto: `Para onde foi o dinheiro em ${nomeDoMes(p.mes)}` }),
            el("div", { classe: "pilha", style: "gap:10px" }, despesas.map((d) =>
              el("div", { classe: "barra-categoria" }, [
                el("div", { classe: "barra-categoria-topo" }, [el("span", { texto: d.nome }), el("strong", { texto: `${dinheiro(d.valor)}${d.pct !== null ? ` · ${pctBr(d.pct)}` : ""}` })]),
                el("div", { classe: "barra-categoria-trilho" }, [el("div", { classe: "barra-categoria-cheia", style: `width:${Math.max(2, (d.valor / maior) * 100)}%` })]),
              ]))),
          ])
        : null,
    );
    const caixaGrafico = corpo.querySelector("#fin-grafico-meses");
    caixaGrafico.append(
      graficoDeResultado(
        p.meses.map((m) => ({
          rotulo: nomeDoMes(m.mes),
          valor: m.resultado,
          detalhe: [[nomeDoMes(m.mes), true], [`Receita: ${dinheiro(m.receita || 0)}`], m.vendas ? [`Vendas registradas: ${dinheiro(m.vendas)}`] : null, [`Despesas: ${dinheiro(m.despesas)}`], [`Resultado: ${dinheiro(m.resultado)}`, true], m.prime_cost !== null ? [`Prime cost: ${pctBr(m.prime_cost)}`] : null].filter(Boolean),
        })),
        { largura: larguraUtil(caixaGrafico), titulo: "Resultado por mês" },
      ),
    );
  }

  function relatorio(p) {
    const r = p.resultado;
    const L = Object.fromEntries(r.linhas.map((l) => [l.grupo, l]));
    const linha = (rot, v, pct, forte) => ({ destaque: forte && v < 0, celulas: [rot, dinheiro(v), pctBr(pct)] });
    imprimirRelatorio({
      tipo: "Financeiro",
      titulo: `Resultado de ${nomeDoMes(p.mes)}`,
      periodo: `${dataBr(p.mes)} a ${dataBr(new Date(Date.UTC(Number(p.mes.slice(0, 4)), Number(p.mes.slice(5, 7)), 0)).toISOString().slice(0, 10))}`,
      selos: [
        { valor: dinheiro(r.resultado_final), rotulo: "resultado do mês", ruim: r.resultado_final < 0 },
        { valor: pctBr(r.pct.prime_cost), rotulo: "prime cost", ruim: r.pct.prime_cost !== null && r.pct.prime_cost > 65 },
        { valor: dinheiro(p.saldo_hoje), rotulo: "saldo hoje", ruim: p.saldo_hoje < 0 },
        { valor: p.ponto_de_equilibrio_por_dia !== null ? dinheiro(p.ponto_de_equilibrio_por_dia) : "—", rotulo: "venda mínima por dia" },
      ],
      secoes: [
        {
          titulo: "Resultado (competência)",
          colunas: [{ rotulo: "" }, { rotulo: "Valor", num: true }, { rotulo: "% da venda", num: true }],
          linhas: [
            linha("Receitas", r.receita, r.receita ? 100 : null),
            linha(`(−) ${L.deducao.nome}`, L.deducao.valor, L.deducao.pct),
            linha("= Receita líquida", r.receita_liquida, null, true),
            linha(`(−) ${L.cmv.nome}`, L.cmv.valor, L.cmv.pct),
            linha("= Margem bruta", r.margem_bruta, null, true),
            ...["pessoal", "ocupacao", "operacao", "administrativo", "marketing"].map((g) => linha(`(−) ${L[g].nome}`, L[g].valor, L[g].pct)),
            linha("= Resultado operacional", r.resultado_operacional, r.pct.resultado_operacional, true),
            ...["financeiro", "outros", "investimento", "retirada"].map((g) => linha(`(−) ${L[g].nome}`, L[g].valor, L[g].pct)),
            linha("= Resultado do mês", r.resultado_final, r.pct.resultado_final, true),
          ],
          nota: r.base_dos_percentuais === "vendas" ? `Percentuais sobre as vendas registradas (${dinheiro(p.vendas_do_mes)}).` : null,
        },
        {
          titulo: "Últimos 6 meses",
          colunas: [{ rotulo: "Mês" }, { rotulo: "Receita", num: true }, { rotulo: "Despesas", num: true }, { rotulo: "Resultado", num: true }, { rotulo: "Prime cost", num: true }],
          linhas: p.meses.map((m) => ({ destaque: m.resultado < 0, celulas: [nomeDoMes(m.mes), dinheiro(m.receita || m.vendas), dinheiro(m.despesas), dinheiro(m.resultado), pctBr(m.prime_cost)] })),
        },
        {
          titulo: "Caixa",
          pares: [
            ["Saldo hoje", dinheiro(p.saldo_hoje)],
            ["Saldo previsto em 30 dias", dinheiro(p.saldo_em_30_dias)],
            ["A pagar atrasado", dinheiro(p.a_vencer.pagar.atrasado)],
            ["A pagar nos próximos 30 dias", dinheiro(p.a_vencer.pagar.hoje + p.a_vencer.pagar.proximos_30)],
            ["A receber nos próximos 30 dias", dinheiro(p.a_vencer.receber.hoje + p.a_vencer.receber.proximos_30)],
          ],
        },
      ],
      arquivo: `resultado-${p.mes.slice(0, 7)}`,
    });
  }
}

// ============================================================
// Fluxo de caixa
// ============================================================
export async function fluxoDeCaixa(raiz, ctx) {
  const corpo = el("div", { classe: "pilha" });
  raiz.append(corpo);
  const hoje = hojeIso();
  const somar = (iso, d) => {
    const x = new Date(`${iso}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + d);
    return x.toISOString().slice(0, 10);
  };
  let f = { periodo: "60", agrupar: "dia", conta: "", de: "", ate: "" };
  try {
    Object.assign(f, JSON.parse(sessionStorage.getItem("brasa.fin.fluxo") ?? "{}"));
  } catch {
    /* padrão */
  }
  await carregar();

  function intervalo() {
    if (f.periodo === "livre" && f.de && f.ate) return [f.de, f.ate];
    if (f.periodo === "mes") {
      const [a, m] = hoje.split("-").map(Number);
      return [`${hoje.slice(0, 7)}-01`, new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)];
    }
    return [somar(hoje, -3), somar(hoje, Number(f.periodo) || 60)];
  }

  async function carregar() {
    try {
      sessionStorage.setItem("brasa.fin.fluxo", JSON.stringify(f));
    } catch {
      /* navegação privada */
    }
    preencher(corpo, el("p", { classe: "muted", texto: "Calculando…" }));
    const [de, ate] = intervalo();
    const agrupar = f.agrupar === "dia" && (Date.parse(ate) - Date.parse(de)) / 86_400_000 > 100 ? "semana" : f.agrupar;
    const q = new URLSearchParams({ de, ate, agrupar });
    if (f.conta) q.set("conta", f.conta);
    let x;
    try {
      x = await get(`/v1/venues/${ctx.venue}/financeiro/fluxo?${q}`);
    } catch (e) {
      preencher(corpo, vazio("Fluxo de caixa indisponível", e.message));
      return;
    }
    desenhar(x);
  }

  function desenhar(x) {
    const chip = (chave, id, rotulo) =>
      el("button", {
        classe: `chip${f[chave] === id ? " chip-ativo" : ""}`,
        type: "button",
        texto: rotulo,
        onclick: () => {
          if (chave === "periodo" && id === "livre" && !(f.de && f.ate)) {
            f.de = x.de;
            f.ate = x.ate;
          }
          f[chave] = id;
          carregar();
        },
      });
    const conta = el("select", { classe: "select", style: "max-width:260px" }, [el("option", { value: "", texto: "Todas as contas" }), ...x.contas.map((c) => el("option", { value: c.id, texto: c.nome, selected: c.id === f.conta }))]);
    conta.addEventListener("change", () => { f.conta = conta.value; carregar(); });
    const deI = el("input", { classe: "input", type: "date", value: x.de });
    const ateI = el("input", { classe: "input", type: "date", value: x.ate });
    const livre = () => { f.periodo = "livre"; f.de = deI.value; f.ate = ateI.value; carregar(); };
    deI.addEventListener("change", livre);
    ateI.addEventListener("change", livre);

    const tot = x.periodos.reduce((a, p) => ({ e: a.e + p.entradas + p.entradas_previstas, s: a.s + p.saidas + p.saidas_previstas }), { e: 0, s: 0 });
    const rotuloDoPeriodo = (p) => (x.agrupar === "mes" ? nomeDoMes(p.inicio) : x.agrupar === "semana" ? `${dataBr(p.inicio).slice(0, 5)}–${dataBr(p.fim).slice(0, 5)}` : dataBr(p.inicio).slice(0, 5));
    const indiceHoje = x.periodos.findIndex((p) => p.inicio <= x.hoje && p.fim >= x.hoje);

    preencher(corpo, 
      el("section", { classe: "cartao pilha filtros-financeiro" }, [
        el("div", { classe: "chips" }, [chip("periodo", "30", "30 dias"), chip("periodo", "60", "60 dias"), chip("periodo", "90", "90 dias"), chip("periodo", "180", "6 meses"), chip("periodo", "mes", "Este mês"), chip("periodo", "livre", "Escolher datas")]),
        f.periodo === "livre" ? el("div", { classe: "linha-campos datas-livres" }, [deI, el("span", { classe: "muted", texto: "até" }), ateI]) : null,
        el("div", { classe: "linha-campos", style: "gap:10px;align-items:center;flex-wrap:wrap" }, [
          el("div", { classe: "chips" }, [chip("agrupar", "dia", "Por dia"), chip("agrupar", "semana", "Por semana"), chip("agrupar", "mes", "Por mês")]),
          conta,
          botaoDePdf(() => relatorio(x, rotuloDoPeriodo), "PDF"),
        ]),
      ]),
      avisoDeNegativo(x.primeiro_negativo),
      el("div", { classe: "grade" }, [
        indicador({ rotulo: `Saldo em ${dataBr(x.de).slice(0, 5)}`, valor: dinheiro(x.saldo_inicial), destaque: x.saldo_inicial < 0 }),
        indicador({ rotulo: "Entradas", valor: dinheiro(Math.round(tot.e * 100) / 100), nota: x.atrasado_receber ? `inclui ${dinheiro(x.atrasado_receber)} atrasado para receber` : "realizadas + previstas" }),
        indicador({ rotulo: "Saídas", valor: dinheiro(Math.round(tot.s * 100) / 100), nota: x.atrasado_pagar ? `inclui ${dinheiro(x.atrasado_pagar)} atrasado, contado para hoje` : "realizadas + previstas" }),
        indicador({ rotulo: `Saldo em ${dataBr(x.ate).slice(0, 5)}`, valor: dinheiro(x.saldo_final), nota: x.menor_saldo ? `pior dia: ${dataBr(x.menor_saldo.dia).slice(0, 5)} (${reaisCurtos(x.menor_saldo.saldo)})` : "", destaque: x.saldo_final < 0 }),
      ]),
      el("section", { classe: "cartao pilha", id: "fin-grafico-saldo" }, [
        el("div", {}, [el("h3", { texto: "Saldo dia a dia" }), el("p", { classe: "muted", style: "margin:0", texto: "Até hoje, o que aconteceu; daqui para frente, o que vence e o que está para entrar." })]),
      ]),
      el("section", { classe: "cartao pilha" }, [
        el("h3", { texto: "Entradas e saídas" }),
        el("div", { classe: "rolagem-x" }, [
          el("table", { classe: "planilha" }, [
            el("thead", {}, [el("tr", {}, ["Período", "Entrou", "Vai entrar", "Saiu", "Vai sair", "Saldo"].map((t, i) => el("th", { classe: i ? "col-num" : "", texto: t })))]),
            el("tbody", {}, x.periodos.filter((p) => p.entradas || p.saidas || p.entradas_previstas || p.saidas_previstas || x.agrupar !== "dia").map((p) =>
              el("tr", { classe: p.saldo < 0 ? "linha-perigo" : p.inicio <= x.hoje && p.fim >= x.hoje ? "linha-atencao" : "" }, [
                el("td", { texto: `${rotuloDoPeriodo(p)}${p.inicio <= x.hoje && p.fim >= x.hoje ? " · hoje" : ""}` }),
                el("td", { classe: "col-num", texto: p.entradas ? dinheiro(p.entradas) : "—" }),
                el("td", { classe: "col-num muted", texto: p.entradas_previstas ? dinheiro(p.entradas_previstas) : "—" }),
                el("td", { classe: "col-num", texto: p.saidas ? dinheiro(p.saidas) : "—" }),
                el("td", { classe: "col-num muted", texto: p.saidas_previstas ? dinheiro(p.saidas_previstas) : "—" }),
                el("td", { classe: `col-num${p.saldo < 0 ? " texto-perigo" : ""}`, texto: dinheiro(p.saldo) }),
              ]))),
          ]),
        ]),
      ]),
    );
    const caixa = corpo.querySelector("#fin-grafico-saldo");
    caixa.append(
      graficoDeSaldo(
        x.periodos.map((p) => ({
          rotulo: rotuloDoPeriodo(p),
          valor: p.saldo,
          detalhe: [
            [rotuloDoPeriodo(p), true],
            [`Saldo: ${dinheiro(p.saldo)}`, true],
            p.entradas || p.entradas_previstas ? [`Entradas: ${dinheiro(p.entradas + p.entradas_previstas)}${p.entradas_previstas ? " (prevista)" : ""}`] : null,
            p.saidas || p.saidas_previstas ? [`Saídas: ${dinheiro(p.saidas + p.saidas_previstas)}${p.saidas_previstas ? " (prevista)" : ""}`] : null,
          ].filter(Boolean),
        })),
        { largura: larguraUtil(caixa), marcaIndice: indiceHoje, titulo: "Saldo" },
      ),
    );
  }

  function relatorio(x, rotuloDoPeriodo) {
    imprimirRelatorio({
      tipo: "Financeiro",
      titulo: "Fluxo de caixa",
      periodo: `${dataBr(x.de)} a ${dataBr(x.ate)}`,
      selos: [
        { valor: dinheiro(x.saldo_inicial), rotulo: "saldo no início" },
        { valor: dinheiro(x.saldo_final), rotulo: "saldo no fim", ruim: x.saldo_final < 0 },
        { valor: x.menor_saldo ? dinheiro(x.menor_saldo.saldo) : "—", rotulo: x.menor_saldo ? `pior dia (${dataBr(x.menor_saldo.dia).slice(0, 5)})` : "pior dia", ruim: (x.menor_saldo?.saldo ?? 0) < 0 },
      ],
      secoes: [
        {
          colunas: [{ rotulo: "Período" }, { rotulo: "Entrou", num: true }, { rotulo: "Vai entrar", num: true }, { rotulo: "Saiu", num: true }, { rotulo: "Vai sair", num: true }, { rotulo: "Saldo", num: true }],
          linhas: x.periodos.filter((p) => p.entradas || p.saidas || p.entradas_previstas || p.saidas_previstas || x.agrupar !== "dia").map((p) => ({ destaque: p.saldo < 0, celulas: [rotuloDoPeriodo(p), dinheiro(p.entradas), dinheiro(p.entradas_previstas), dinheiro(p.saidas), dinheiro(p.saidas_previstas), dinheiro(p.saldo)] })),
          nota: x.atrasado_pagar ? `O que venceu e não foi pago (${dinheiro(x.atrasado_pagar)}) está contado para hoje.` : null,
        },
      ],
      arquivo: "fluxo-de-caixa",
      paisagem: true,
    });
  }
}
