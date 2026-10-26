import { get } from "../api.js";
import { dinheiro, el, etiqueta, indicador, preencher, vazio } from "../ui.js";
import { botaoDePdf, dataBr, imprimirRelatorio } from "../relatorio.js";
import { NOME_DO_TIPO, formularioDeBaixa, formularioDeConta, nomeDaCategoria } from "./financeiroConta.js";

/**
 * Financeiro — contas a pagar e contas a receber.
 *
 * As duas telas são a mesma lista: o que vence, o que atrasou, o que já foi
 * pago. O primeiro número é sempre o atrasado — é o que custa juros — e o
 * botão da linha é o que se faz com ela (Pagar / Receber), sem abrir nada.
 */

const hojeIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba" }).format(new Date());
const inicioDoMes = (iso) => `${iso.slice(0, 7)}-01`;
const fimDoMes = (iso) => {
  const [a, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
const mesSeguinte = (iso) => {
  const [a, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
};

const ESTADO = {
  atrasado: ["atrasada", "etiqueta-perigo"],
  vence_hoje: ["vence hoje", "etiqueta-alerta"],
  aberto: ["em aberto", ""],
  pago: ["paga", "etiqueta-ok"],
  cancelado: ["cancelada", ""],
};

export const contasAPagar = (raiz, ctx) => listaDeContas(raiz, ctx, "pagar");
export const contasAReceber = (raiz, ctx) => listaDeContas(raiz, ctx, "receber");

async function listaDeContas(raiz, ctx, tipo) {
  const n = NOME_DO_TIPO[tipo];
  const corpo = el("div", { classe: "pilha" });
  raiz.append(corpo);
  const hoje = hojeIso();
  const chaveFiltro = `brasa.fin.${tipo}.filtro`;
  let filtro = { periodo: "mes", situacao: "abertas", busca: "", categoria: "", fornecedor: "", conta: "" };
  try {
    Object.assign(filtro, JSON.parse(sessionStorage.getItem(chaveFiltro) ?? "{}"));
  } catch {
    /* sem memória, segue o padrão */
  }
  let cad;

  await recarregar();

  function intervalo() {
    if (filtro.periodo === "proximo") return [mesSeguinte(hoje), fimDoMes(mesSeguinte(hoje))];
    if (filtro.periodo === "anterior") {
      const d = new Date(`${inicioDoMes(hoje)}T12:00:00Z`);
      d.setUTCDate(0);
      const fim = d.toISOString().slice(0, 10);
      return [inicioDoMes(fim), fim];
    }
    if (filtro.periodo === "90") {
      const d = new Date(`${hoje}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 90);
      return [hoje, d.toISOString().slice(0, 10)];
    }
    if (filtro.periodo === "livre" && filtro.de && filtro.ate) return [filtro.de, filtro.ate];
    return [inicioDoMes(hoje), fimDoMes(hoje)];
  }

  async function recarregar() {
    try {
      sessionStorage.setItem(chaveFiltro, JSON.stringify(filtro));
    } catch {
      /* navegação privada */
    }
    preencher(corpo, el("p", { classe: "muted", texto: "Carregando…" }));
    const [de, ate] = intervalo();
    const q = new URLSearchParams({ tipo, de, ate });
    if (filtro.situacao === "atrasadas") q.set("situacao", "atrasado");
    else if (filtro.situacao === "abertas") q.set("situacao", "aberto");
    else if (filtro.situacao === "pagas") {
      q.set("situacao", "pago");
      q.set("por", "pagamento");
    }
    for (const [k, v] of [["busca", filtro.busca], ["categoria", filtro.categoria], ["fornecedor", filtro.fornecedor], ["conta", filtro.conta]]) if (v) q.set(k, v);
    let dados;
    try {
      [cad, dados] = await Promise.all([
        cad ? Promise.resolve(cad) : get(`/v1/venues/${ctx.venue}/financeiro/cadastros`),
        get(`/v1/venues/${ctx.venue}/financeiro/lancamentos?${q}`),
      ]);
    } catch (e) {
      preencher(corpo, vazio(`Contas a ${tipo} indisponíveis`, e.message));
      return;
    }
    desenhar(dados, de, ate);
  }

  function voltar() {
    cad = null; // o saldo das contas mudou
    recarregar();
  }

  function desenhar(dados, de, ate) {
    const r = dados.resumo;
    const nomeForn = (id) => cad.fornecedores.find((f) => f.id === id)?.nome;
    const lista = dados.lancamentos;

    const chip = (id, rotulo, chave = "periodo") =>
      el("button", {
        classe: `chip${filtro[chave] === id ? " chip-ativo" : ""}`,
        type: "button",
        texto: rotulo,
        onclick: () => {
          if (id === "livre" && !(filtro.de && filtro.ate)) {
            filtro.de = de;
            filtro.ate = ate;
          }
          filtro[chave] = id;
          recarregar();
        },
      });
    const busca = el("input", { classe: "input", type: "search", value: filtro.busca, placeholder: "Buscar descrição, cliente, nº do documento…" });
    busca.addEventListener("change", () => { filtro.busca = busca.value; recarregar(); });
    const filtroSelect = (chave, opcoes, rotulo) => {
      const s = el("select", { classe: "select" }, [el("option", { value: "", texto: rotulo }), ...opcoes.map(([v, t]) => el("option", { value: v, texto: t, selected: filtro[chave] === v }))]);
      s.addEventListener("change", () => { filtro[chave] = s.value; recarregar(); });
      return s;
    };
    const tipoCat = tipo === "pagar" ? "despesa" : "receita";
    const algumFiltro = Boolean(filtro.busca || filtro.categoria || filtro.fornecedor || filtro.conta);
    const maisFiltros = el("details", { classe: "mais-filtros", open: algumFiltro }, [
      el("summary", { texto: algumFiltro ? "Filtros (ativos)" : "Buscar e filtrar" }),
      el("div", { classe: "grade grade-2" }, [
        busca,
        filtroSelect("categoria", cad.categorias.filter((c) => c.tipo === tipoCat && !c.pai_id && c.ativo).map((c) => [c.id, c.nome]), "Todas as categorias"),
        tipo === "pagar" ? filtroSelect("fornecedor", cad.fornecedores.filter((f) => f.ativo !== false).map((f) => [f.id, f.nome]), "Todos os fornecedores") : null,
        filtroSelect("conta", cad.contas.filter((c) => c.ativo).map((c) => [c.id, c.nome]), "Todas as contas"),
      ]),
    ]);
    const deLivre = el("input", { classe: "input", type: "date", value: de });
    const ateLivre = el("input", { classe: "input", type: "date", value: ate });
    const aplicarLivre = () => { filtro.periodo = "livre"; filtro.de = deLivre.value; filtro.ate = ateLivre.value; recarregar(); };
    deLivre.addEventListener("change", aplicarLivre);
    ateLivre.addEventListener("change", aplicarLivre);

    preencher(corpo, 
      el("div", { classe: "cabecalho-secao" }, [
        el("p", { classe: "muted", style: "margin:0", texto: tipo === "pagar" ? "Boleto, nota, aluguel, salário: tudo que sai, com o dia de pagar." : "Vendas a receber, evento com sinal, o que te devem: tudo que entra." }),
        el("div", { classe: "reserva-acoes", style: "margin:0" }, [
          botaoDePdf(() => relatorio(lista, de, ate), "PDF da lista"),
          el("button", { classe: "btn btn-primario", type: "button", texto: `+ Nova ${n.conta}`, onclick: () => formularioDeConta(corpo, { ctx, cad, tipo, aoTerminar: voltar }) }),
        ]),
      ]),
      el("div", { classe: "grade" }, [
        indicador({ rotulo: "Atrasado", valor: dinheiro(r.atrasado), nota: r.atrasadas ? `${r.atrasadas} conta(s) — ${tipo === "pagar" ? "é o que gera juros" : "cobrar"}` : "nada atrasado", destaque: r.atrasado > 0 }),
        indicador({ rotulo: "Vence hoje", valor: dinheiro(r.hoje) }),
        indicador({ rotulo: "Próximos 7 dias", valor: dinheiro(r.proximos_7_dias) }),
        indicador({ rotulo: filtro.situacao === "pagas" ? (tipo === "pagar" ? "Pago no período" : "Recebido no período") : "Em aberto no período", valor: dinheiro(filtro.situacao === "pagas" ? r.pago : r.em_aberto) }),
      ]),
      el("section", { classe: "cartao pilha filtros-financeiro" }, [
        el("div", { classe: "chips" }, [chip("abertas", "Em aberto", "situacao"), chip("atrasadas", "Atrasadas", "situacao"), chip("pagas", tipo === "pagar" ? "Pagas" : "Recebidas", "situacao"), chip("todas", "Todas", "situacao")]),
        filtro.situacao === "atrasadas"
          ? el("p", { classe: "muted", style: "margin:0", texto: "Todas as atrasadas, de qualquer mês." })
          : el("div", { classe: "chips" }, [chip("anterior", "Mês passado"), chip("mes", "Este mês"), chip("proximo", "Próximo mês"), chip("90", "90 dias"), chip("livre", "Escolher datas")]),
        filtro.periodo === "livre" && filtro.situacao !== "atrasadas" ? el("div", { classe: "linha-campos datas-livres" }, [deLivre, el("span", { classe: "muted", texto: "até" }), ateLivre]) : null,
        maisFiltros,
      ]),
      lista.length
        ? el("div", { classe: "tabela" }, lista.map((l) => linha(l, nomeForn)))
        : vazio(
            filtro.situacao === "atrasadas" ? "Nada atrasado 👏" : "Nenhuma conta neste filtro",
            tipo === "pagar" ? "Lance o primeiro boleto: + Nova conta a pagar." : "Lance o que a casa tem para receber: evento, venda a prazo, repasse do cartão.",
          ),
      lista.length ? el("p", { classe: "muted", texto: `${lista.length} conta(s) · ${dinheiro(lista.reduce((s, l) => s + Math.round(Number(l.situacao === "pago" ? l.valor_pago : l.valor) * 100), 0) / 100)}` }) : null,
    );
  }

  function linha(l, nomeForn) {
    const [rot, cls] = ESTADO[l.estado] ?? ESTADO.aberto;
    const quem = nomeForn(l.fornecedor_id) ?? l.pessoa;
    const meta = [
      quem,
      nomeDaCategoria(cad, l.categoria_id),
      l.parcelas ? `parcela ${l.parcela}/${l.parcelas}` : l.recorrente ? "todo mês" : null,
      l.documento ? `doc. ${l.documento}` : null,
      l.situacao === "pago" ? `${NOME_DO_TIPO[tipo].feito.toLowerCase()} em ${dataBr(l.pago_em)}` : null,
    ].filter(Boolean);
    return el("div", { classe: "linha-tabela linha-clicavel", onclick: () => formularioDeConta(corpo, { ctx, cad, tipo, existente: l, aoTerminar: voltar }) }, [
      el("div", { classe: "conta-data" }, [el("strong", { texto: dataBr(l.vencimento).slice(0, 5) }), el("small", { classe: "muted", texto: l.vencimento.slice(0, 4) })]),
      el("div", { classe: "linha-principal", style: "flex:1;min-width:0" }, [
        el("strong", { style: "white-space:normal", texto: l.descricao }),
        el("span", { classe: "muted", style: "white-space:normal", texto: meta.join(" · ") }),
      ]),
      el("div", { classe: "conta-valor" }, [
        el("strong", { texto: dinheiro(Number(l.situacao === "pago" ? l.valor_pago : l.valor)) }),
        etiqueta(rot, cls),
      ]),
      l.situacao === "aberto"
        ? el("button", {
            classe: "btn btn-peq",
            type: "button",
            texto: NOME_DO_TIPO[tipo].acao,
            onclick: (e) => {
              e.stopPropagation();
              formularioDeBaixa(corpo, { ctx, cad, tipo, conta: l, aoTerminar: voltar });
            },
          })
        : el("span", { classe: "conta-acao-vazia" }),
    ]);
  }

  function relatorio(lista, de, ate) {
    const nomeForn = (id) => cad.fornecedores.find((f) => f.id === id)?.nome;
    const soma = (f) => lista.filter(f).reduce((s, l) => s + Math.round(Number(l.situacao === "pago" ? l.valor_pago : l.valor) * 100), 0) / 100;
    imprimirRelatorio({
      tipo: "Financeiro",
      titulo: tipo === "pagar" ? "Contas a pagar" : "Contas a receber",
      periodo: filtro.situacao === "atrasadas" ? "todas as atrasadas" : `${dataBr(de)} a ${dataBr(ate)}`,
      selos: [
        { valor: dinheiro(soma((l) => l.estado === "atrasado")), rotulo: "atrasado", ruim: lista.some((l) => l.estado === "atrasado") },
        { valor: dinheiro(soma((l) => l.situacao === "aberto")), rotulo: "em aberto" },
        { valor: dinheiro(soma((l) => l.situacao === "pago")), rotulo: tipo === "pagar" ? "pago" : "recebido" },
      ],
      secoes: [
        {
          colunas: [{ rotulo: "Vencimento" }, { rotulo: "Descrição" }, { rotulo: tipo === "pagar" ? "Fornecedor" : "Cliente" }, { rotulo: "Categoria" }, { rotulo: "Situação" }, { rotulo: "Valor", num: true }],
          linhas: lista.map((l) => ({
            destaque: l.estado === "atrasado",
            celulas: [dataBr(l.vencimento), `${l.descricao}${l.parcelas ? ` (${l.parcela}/${l.parcelas})` : ""}`, nomeForn(l.fornecedor_id) ?? l.pessoa ?? "", nomeDaCategoria(cad, l.categoria_id), (ESTADO[l.estado] ?? ESTADO.aberto)[0], dinheiro(Number(l.situacao === "pago" ? l.valor_pago : l.valor))],
          })),
          total: ["Total", "", "", "", "", dinheiro(soma(() => true))],
          vazio: "Nenhuma conta neste filtro.",
        },
      ],
      arquivo: `contas-a-${tipo}`,
      paisagem: true,
    });
  }
}
