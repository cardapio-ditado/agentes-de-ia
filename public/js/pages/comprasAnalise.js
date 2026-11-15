import { dinheiro, el } from "../ui.js";

/**
 * A análise das compras: quanto entrou no estoque nos últimos 30 dias, dia a
 * dia, e para onde foi a mercadoria do mês.
 *
 * Só entra na conta o que foi RECEBIDO, pelo valor da nota e pela data do
 * recebimento — a mesma regra do indicador "Comprado no mês". Pedido que
 * ainda não chegou é promessa, não compra, e somar os dois contaria a mesma
 * mercadoria duas vezes.
 *
 * A lista que a tela recebe tem um teto de registros. Quando o teto corta o
 * período, a análise NÃO aparece: gráfico incompleto com cara de completo é
 * pior do que gráfico nenhum.
 */

const NS = "http://www.w3.org/2000/svg";
const TETO_DA_LISTA = 60;

function svg(tag, attrs = {}, filhos = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  for (const f of filhos) n.append(f);
  return n;
}

function somarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const diaMes = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** 24860 → "25 mil"; 850 → "850". Para o eixo, onde centavo é ruído. */
function reaisDoEixo(v) {
  if (v >= 1000) return `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: v >= 10000 ? 0 : 1 })} mil`;
  return String(Math.round(v));
}

/** Arredonda o topo do eixo para um número de ler: 3.870 → 4.000. */
function tetoBonito(v) {
  if (v <= 0) return 100;
  const base = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * base) return m * base;
  return 10 * base;
}

/**
 * O que a lista permite afirmar. Devolve null quando o teto da lista pode
 * ter cortado compras de dentro do período.
 */
export function resumoDasCompras(lista, hoje) {
  const inicio = somarDias(hoje, -29);
  if (lista.length >= TETO_DA_LISTA) {
    const maisAntiga = lista.reduce((m, c) => ((c.created_at ?? "") < m ? (c.created_at ?? "") : m), "9999").slice(0, 10);
    if (!(maisAntiga < inicio)) return null;
  }
  const recebidas = lista.filter((c) => c.status === "recebida" && c.recebida_em);
  const porDia = new Map();
  for (let i = 0; i < 30; i++) porDia.set(somarDias(inicio, i), 0);
  for (const c of recebidas) {
    const dia = c.recebida_em.slice(0, 10);
    if (porDia.has(dia)) porDia.set(dia, porDia.get(dia) + Math.round(Number(c.valor_total) * 100));
  }
  const mes = hoje.slice(0, 7);
  const porSetor = new Map();
  for (const c of recebidas) {
    if (!c.recebida_em.startsWith(mes)) continue;
    const setor = c.estoque_locais?.nome ?? "Sem local";
    porSetor.set(setor, (porSetor.get(setor) ?? 0) + Math.round(Number(c.valor_total) * 100));
  }
  const dias = [...porDia].map(([dia, centavos]) => ({ dia, valor: centavos / 100 }));
  const setores = [...porSetor].map(([nome, centavos]) => ({ nome, valor: centavos / 100 })).filter((s) => s.valor > 0).sort((a, b) => b.valor - a.valor);
  return {
    dias,
    total30: dias.reduce((t, d) => t + d.valor, 0),
    setores,
    totalDoMes: setores.reduce((t, s) => t + s.valor, 0),
  };
}

function graficoDeBarras(dias) {
  const L = 720, A = 230, esq = 52, dir = 8, topo = 10, base = 28;
  const teto = tetoBonito(Math.max(...dias.map((d) => d.valor)));
  const areaL = L - esq - dir, areaA = A - topo - base;
  const passo = areaL / dias.length;
  const y = (v) => topo + areaA - (v / teto) * areaA;
  const filhos = [];
  for (const fr of [0, 0.25, 0.5, 0.75, 1]) {
    const v = teto * fr;
    filhos.push(svg("line", { class: fr === 0 ? "gb-eixo" : "gb-guia", x1: esq, x2: L - dir, y1: y(v), y2: y(v) }));
    const t = svg("text", { x: esq - 8, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = reaisDoEixo(v);
    filhos.push(t);
  }
  dias.forEach((d, i) => {
    if (d.valor > 0) {
      const alt = Math.max(2, (d.valor / teto) * areaA);
      const barra = svg("rect", { class: "gb-barra", x: esq + i * passo + passo * 0.18, y: topo + areaA - alt, width: passo * 0.64, height: alt, rx: 2 });
      const dica = svg("title");
      dica.textContent = `${diaMes(d.dia)}: ${dinheiro(d.valor)}`;
      barra.append(dica);
      filhos.push(barra);
    }
    // Um rótulo a cada quatro dias, e sempre o último: mais que isso embola.
    if (i % 4 === 0 || i === dias.length - 1) {
      if (i === dias.length - 1 && (dias.length - 1) % 4 !== 0 && (dias.length - 1) % 4 < 2) return;
      const t = svg("text", { x: esq + i * passo + passo / 2, y: A - 8, "text-anchor": "middle" });
      t.textContent = diaMes(d.dia);
      filhos.push(t);
    }
  });
  const com = dias.filter((d) => d.valor > 0);
  return svg(
    "svg",
    {
      class: "grafico-barras",
      viewBox: `0 0 ${L} ${A}`,
      role: "img",
      "aria-label": com.length
        ? `Recebido por dia nos últimos 30 dias. ${com.length} dia(s) com recebimento; o maior foi ${dinheiro(Math.max(...com.map((d) => d.valor)))}.`
        : "Nenhum recebimento nos últimos 30 dias.",
    },
    filhos,
  );
}

function rosca(setores, total) {
  const R = 54, C = 2 * Math.PI * R;
  // Do quinto em diante vira "Outros": rosca com dez fatias não se lê.
  const fatias = setores.slice(0, 4);
  const resto = setores.slice(4).reduce((t, s) => t + s.valor, 0);
  if (resto > 0) fatias.push({ nome: "Outros", valor: resto });
  let andado = 0;
  const arcos = fatias.map((s, i) => {
    const parte = (s.valor / total) * C;
    const arco = svg("circle", {
      class: `cor-serie-${i + 1}`,
      cx: 75, cy: 75, r: R,
      fill: "none",
      "stroke-width": 20,
      "stroke-dasharray": `${Math.max(0, parte - 2)} ${C - Math.max(0, parte - 2)}`,
      "stroke-dashoffset": -andado,
      transform: "rotate(-90 75 75)",
    });
    andado += parte;
    return arco;
  });
  const valor = svg("text", { class: "rosca-total", x: 75, y: 74, "text-anchor": "middle" });
  valor.textContent = dinheiro(total).replace(/,\d\d$/, "");
  const legenda = svg("text", { class: "rosca-legenda-centro", x: 75, y: 91, "text-anchor": "middle" });
  legenda.textContent = "no mês";
  return el("div", { classe: "rosca" }, [
    svg("svg", { viewBox: "0 0 150 150", role: "img", "aria-label": `Recebido no mês por local: ${fatias.map((s) => `${s.nome} ${Math.round((s.valor / total) * 100)}%`).join(", ")}.` }, [
      svg("circle", { class: "rosca-trilho", cx: 75, cy: 75, r: R, fill: "none", "stroke-width": 20 }),
      ...arcos,
      valor,
      legenda,
    ]),
    el("ul", { classe: "rosca-lista" }, fatias.map((s, i) =>
      el("li", {}, [
        el("span", { classe: `cor-serie-${i + 1}`, "aria-hidden": "true" }),
        el("span", { texto: s.nome }),
        el("span", { texto: `${Math.round((s.valor / total) * 100)}%` }),
      ]),
    )),
  ]);
}

/** Os dois painéis, ou nada quando não há o que mostrar com segurança. */
export function analiseDasCompras(lista, hoje) {
  const r = resumoDasCompras(lista, hoje);
  if (!r || (r.total30 === 0 && r.totalDoMes === 0)) return null;
  return el("div", { classe: "painel-analise" }, [
    el("section", { classe: "cartao" }, [
      el("div", { classe: "painel-analise-topo" }, [
        el("h2", { texto: "Recebido — últimos 30 dias" }),
        el("strong", { texto: dinheiro(r.total30) }),
      ]),
      graficoDeBarras(r.dias),
    ]),
    el("section", { classe: "cartao" }, [
      el("div", { classe: "painel-analise-topo" }, [
        el("h2", {}, [document.createTextNode("Recebido por local "), el("small", { texto: "(mês)" })]),
      ]),
      r.totalDoMes > 0 ? rosca(r.setores, r.totalDoMes) : el("p", { classe: "muted", texto: "Nada recebido neste mês ainda." }),
    ]),
  ]);
}
