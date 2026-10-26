import { el } from "../ui.js";

/**
 * Os dois gráficos do Financeiro, em SVG à mão: a linha do saldo (fluxo de
 * caixa) e as barras do resultado (positivo acima do zero, negativo abaixo).
 *
 * Um eixo só, cores do tema (os tokens), rótulos em tinta de texto, e a
 * dica ao passar o dedo ou o mouse. O valor nunca depende só da cor: a
 * barra negativa está abaixo da linha do zero e leva o número com sinal.
 */

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  return n;
};

/** R$ 12,3 mil · R$ 1,2 mi · R$ 850 */
export function reaisCurtos(v) {
  const a = Math.abs(v);
  const sinal = v < 0 ? "−" : "";
  if (a >= 1_000_000) return `${sinal}R$ ${(a / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (a >= 10_000) return `${sinal}R$ ${Math.round(a / 1000)} mil`;
  if (a >= 1_000) return `${sinal}R$ ${(a / 1000).toFixed(1).replace(".", ",")} mil`;
  return `${sinal}R$ ${Math.round(a)}`;
}

/** Escala "redonda": 0, 5 mil, 10 mil… incluindo sempre o zero. */
function escala(min, max, passos = 4) {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const bruto = (hi - lo || 1) / passos;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) ?? bruto;
  const ini = Math.floor(lo / passo) * passo;
  const fim = Math.ceil(hi / passo) * passo;
  const ticks = [];
  for (let t = ini; t <= fim + passo / 2; t += passo) ticks.push(Math.round(t * 100) / 100);
  return { lo: ini, hi: fim, ticks };
}

function moldura(largura, altura) {
  const raiz = el("div", { classe: "grafico" });
  const s = svg("svg", { viewBox: `0 0 ${largura} ${altura}`, width: largura, height: altura, role: "img" });
  const dica = el("div", { classe: "grafico-dica", hidden: true });
  raiz.append(s, dica);
  return { raiz, s, dica };
}

function mostrarDica(raiz, dica, x, y, linhas) {
  dica.replaceChildren(...linhas.map(([t, forte]) => el(forte ? "strong" : "span", { texto: t })));
  dica.hidden = false;
  const larg = raiz.clientWidth || 600;
  const w = dica.offsetWidth || 160;
  dica.style.left = `${Math.min(Math.max(0, x - w / 2), larg - w)}px`;
  dica.style.top = `${Math.max(0, y - dica.offsetHeight - 12)}px`;
}

/**
 * Linha do saldo. `pontos` = [{ rotulo, valor, detalhe: [[texto, forte]] }].
 * `marcaIndice` = a posição de "hoje" (linha vertical tracejada).
 */
export function graficoDeSaldo(pontos, { largura = 720, altura = 240, marcaIndice = null, titulo = "Saldo" } = {}) {
  const m = { esq: 78, dir: 12, topo: 14, base: 28 };
  const { raiz, s, dica } = moldura(largura, altura);
  s.setAttribute("aria-label", `${titulo}: de ${reaisCurtos(pontos[0]?.valor ?? 0)} a ${reaisCurtos(pontos.at(-1)?.valor ?? 0)}`);
  if (!pontos.length) return raiz;
  const vals = pontos.map((p) => p.valor);
  const { lo, hi, ticks } = escala(Math.min(...vals), Math.max(...vals));
  const W = largura - m.esq - m.dir;
  const H = altura - m.topo - m.base;
  const x = (i) => m.esq + (pontos.length === 1 ? W / 2 : (i / (pontos.length - 1)) * W);
  const y = (v) => m.topo + H - ((v - lo) / (hi - lo || 1)) * H;

  for (const t of ticks) {
    s.append(svg("line", { x1: m.esq, x2: largura - m.dir, y1: y(t), y2: y(t), class: t === 0 ? "g-zero" : "g-grade" }));
    const rot = svg("text", { x: m.esq - 8, y: y(t) + 4, "text-anchor": "end", class: "g-rotulo" });
    rot.textContent = reaisCurtos(t);
    s.append(rot);
  }
  // Rótulos do eixo x: um a cada ~80px, sempre o primeiro e o último.
  const cabem = Math.max(2, Math.floor(W / 80));
  const cada = Math.max(1, Math.ceil(pontos.length / cabem));
  pontos.forEach((p, i) => {
    if (i % cada !== 0 && i !== pontos.length - 1) return;
    if (i !== pontos.length - 1 && pontos.length - 1 - i < cada / 2) return;
    const t = svg("text", { x: x(i), y: altura - 8, "text-anchor": i === 0 ? "start" : i === pontos.length - 1 ? "end" : "middle", class: "g-rotulo" });
    t.textContent = p.rotulo;
    s.append(t);
  });
  if (marcaIndice !== null && marcaIndice >= 0 && marcaIndice < pontos.length) {
    s.append(svg("line", { x1: x(marcaIndice), x2: x(marcaIndice), y1: m.topo, y2: m.topo + H, class: "g-hoje" }));
    const t = svg("text", { x: x(marcaIndice) + 4, y: m.topo + 10, class: "g-rotulo" });
    t.textContent = "hoje";
    s.append(t);
  }
  const caminho = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  s.append(svg("path", { d: `${caminho} L${x(pontos.length - 1).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} Z`, class: "g-area" }));
  s.append(svg("path", { d: caminho, class: "g-linha" }));
  // Marca o primeiro dia abaixo de zero e o pior dia: é onde o olho tem de ir.
  const primeiroNeg = pontos.findIndex((p) => p.valor < 0);
  const piorI = vals.indexOf(Math.min(...vals));
  for (const i of new Set([primeiroNeg, vals[piorI] < 0 ? piorI : -1])) {
    if (i >= 0) s.append(svg("circle", { cx: x(i), cy: y(pontos[i].valor), r: 4, class: "g-negativo" }));
  }

  const guia = svg("line", { y1: m.topo, y2: m.topo + H, class: "g-guia", visibility: "hidden" });
  const ponto = svg("circle", { r: 5, class: "g-ponto", visibility: "hidden" });
  const alvo = svg("rect", { x: m.esq, y: 0, width: W, height: altura, fill: "transparent" });
  s.append(guia, ponto, alvo);
  const mover = (ev) => {
    const caixa = s.getBoundingClientRect();
    const px = ((ev.clientX - caixa.left) / caixa.width) * largura;
    const i = Math.max(0, Math.min(pontos.length - 1, Math.round(((px - m.esq) / W) * (pontos.length - 1))));
    const p = pontos[i];
    guia.setAttribute("x1", x(i));
    guia.setAttribute("x2", x(i));
    guia.setAttribute("visibility", "visible");
    ponto.setAttribute("cx", x(i));
    ponto.setAttribute("cy", y(p.valor));
    ponto.setAttribute("visibility", "visible");
    const escalaTela = caixa.width / largura;
    mostrarDica(raiz, dica, x(i) * escalaTela, y(p.valor) * escalaTela, p.detalhe ?? [[p.rotulo, true], [reaisCurtos(p.valor)]]);
  };
  const sair = () => {
    guia.setAttribute("visibility", "hidden");
    ponto.setAttribute("visibility", "hidden");
    dica.hidden = true;
  };
  alvo.addEventListener("pointermove", mover);
  alvo.addEventListener("pointerdown", mover);
  alvo.addEventListener("pointerleave", sair);
  return raiz;
}

/** Barras do resultado: [{ rotulo, valor, detalhe }]. */
export function graficoDeResultado(barras, { largura = 720, altura = 220, titulo = "Resultado" } = {}) {
  const m = { esq: 78, dir: 12, topo: 22, base: 28 };
  const { raiz, s, dica } = moldura(largura, altura);
  s.setAttribute("aria-label", `${titulo}: ${barras.map((b) => `${b.rotulo} ${reaisCurtos(b.valor)}`).join(", ")}`);
  if (!barras.length) return raiz;
  const vals = barras.map((b) => b.valor);
  const { lo, hi, ticks } = escala(Math.min(...vals), Math.max(...vals));
  const W = largura - m.esq - m.dir;
  const H = altura - m.topo - m.base;
  const y = (v) => m.topo + H - ((v - lo) / (hi - lo || 1)) * H;
  for (const t of ticks) {
    s.append(svg("line", { x1: m.esq, x2: largura - m.dir, y1: y(t), y2: y(t), class: t === 0 ? "g-zero" : "g-grade" }));
    const rot = svg("text", { x: m.esq - 8, y: y(t) + 4, "text-anchor": "end", class: "g-rotulo" });
    rot.textContent = reaisCurtos(t);
    s.append(rot);
  }
  const faixa = W / barras.length;
  const larg = Math.min(56, faixa * 0.56);
  // Faixa estreita (celular): o número vai só na última barra e na pior; o
  // resto fica na dica. E o mês perde o ano.
  const estreito = faixa < 56;
  const pior = vals.indexOf(Math.min(...vals));
  barras.forEach((b, i) => {
    const cx = m.esq + faixa * i + faixa / 2;
    const y0 = y(0);
    const y1 = y(b.valor);
    const alto = Math.max(1, Math.abs(y1 - y0));
    const topo = Math.min(y0, y1);
    // Ponta arredondada só do lado do valor; o lado do zero fica reto.
    const rr = Math.min(4, alto, larg / 2);
    const xE = cx - larg / 2;
    const xD = cx + larg / 2;
    const d = b.valor >= 0
      ? `M${xE},${y0} V${topo + rr} Q${xE},${topo} ${xE + rr},${topo} H${xD - rr} Q${xD},${topo} ${xD},${topo + rr} V${y0} Z`
      : `M${xE},${y0} V${topo + alto - rr} Q${xE},${topo + alto} ${xE + rr},${topo + alto} H${xD - rr} Q${xD},${topo + alto} ${xD},${topo + alto - rr} V${y0} Z`;
    s.append(svg("path", { d, class: b.valor >= 0 ? "g-barra-pos" : "g-barra-neg" }));
    if (!estreito || i === barras.length - 1 || (i === pior && b.valor < 0)) {
      const rotulo = svg("text", { x: cx, y: b.valor >= 0 ? topo - 6 : topo + alto + 14, "text-anchor": i === barras.length - 1 && estreito ? "end" : "middle", class: "g-valor" });
      if (i === barras.length - 1 && estreito) rotulo.setAttribute("x", cx + larg / 2);
      rotulo.textContent = `${b.valor > 0 ? "+" : ""}${reaisCurtos(b.valor)}`;
      s.append(rotulo);
    }
    const t = svg("text", { x: cx, y: altura - 8, "text-anchor": "middle", class: "g-rotulo" });
    t.textContent = estreito ? b.rotulo.split("/")[0] : b.rotulo;
    s.append(t);
    const alvo = svg("rect", { x: cx - faixa / 2, y: 0, width: faixa, height: altura, fill: "transparent" });
    const mostrar = () => {
      const caixa = s.getBoundingClientRect();
      const k = caixa.width / largura;
      mostrarDica(raiz, dica, cx * k, topo * k, b.detalhe ?? [[b.rotulo, true], [reaisCurtos(b.valor)]]);
    };
    alvo.addEventListener("pointerenter", mostrar);
    alvo.addEventListener("pointerdown", mostrar);
    alvo.addEventListener("pointerleave", () => { dica.hidden = true; });
    s.append(alvo);
  });
  return raiz;
}
