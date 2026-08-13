/** Peças de interface reaproveitadas pelas telas. */

/**
 * Cria um elemento.
 *
 * `texto` entra sempre por textContent — nunca innerHTML — para que nome de
 * cliente e mensagem de WhatsApp não consigam injetar marcação na tela.
 */
export function el(tag, props = {}, filhos = []) {
  const node = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === "texto") node.textContent = valor;
    else if (chave === "classe") node.className = valor;
    else if (chave === "html") node.innerHTML = valor;
    else if (chave.startsWith("on")) node.addEventListener(chave.slice(2), valor);
    else node.setAttribute(chave, valor === true ? "" : String(valor));
  }
  for (const filho of [].concat(filhos)) {
    if (filho === null || filho === undefined || filho === false) continue;
    node.append(filho);
  }
  return node;
}

export function limpar(node) {
  node.replaceChildren();
  return node;
}

/** SVG por caminho: os ícones da interface vêm todos daqui. */
export function icone(d, tamanho = 19) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", tamanho);
  svg.setAttribute("height", tamanho);
  svg.setAttribute("aria-hidden", "true");
  svg.style.fill = "none";
  svg.style.stroke = "currentColor";
  svg.style.strokeWidth = "1.8";
  svg.style.strokeLinecap = "round";
  svg.style.strokeLinejoin = "round";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

export const ICONES = {
  painel: "M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zM13 9h8V3h-8v6z",
  conversas: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  reservas: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  programacao: "M9 18V5l12-2v13M9 13l12-2M6 18a3 3 0 11-6 0 3 3 0 016 0z",
  canais: "M4.9 19.1a10 10 0 010-14.2M19.1 4.9a10 10 0 010 14.2M7.8 16.2a6 6 0 010-8.4M16.2 7.8a6 6 0 010 8.4M13 12a1 1 0 11-2 0 1 1 0 012 0z",
  agente: "M12 8V4H8M4 8h16v12H4zM2 14h2M20 14h2M9 13v2M15 13v2",
  organizacao: "M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01",
  relogio: "M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2",
  pessoa: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  alerta: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z",
  raio: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  atualizar: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15",
};

/** Aviso temporário no canto — some sozinho. */
export function avisar(texto, tipo = "info") {
  const caixa = document.getElementById("avisos");
  const aviso = el("div", { classe: `aviso aviso-${tipo}`, texto });
  caixa.append(aviso);
  setTimeout(() => aviso.remove(), 5200);
}

export function etiqueta(texto, variante = "") {
  return el("span", { classe: `etiqueta ${variante}`.trim(), texto });
}

export function vazio(titulo, detalhe) {
  return el("div", { classe: "vazio" }, [
    el("strong", { texto: titulo }),
    detalhe ? el("span", { texto: detalhe }) : null,
  ]);
}

export function indicador({ rotulo, valor, nota, iconePath, destaque }) {
  return el("div", { classe: `indicador ${destaque ? "indicador-destaque" : ""}`.trim() }, [
    el("div", { classe: "indicador-rotulo" }, [
      iconePath ? icone(iconePath, 16) : null,
      el("span", { texto: rotulo }),
    ]),
    el("div", { classe: "indicador-valor", texto: String(valor) }),
    nota ? el("div", { classe: "indicador-nota", texto: nota }) : null,
  ]);
}

// ============ Formatação ============

const DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function dataHora(iso) {
  if (!iso) return "—";
  return DATA_HORA.format(new Date(iso));
}

/** "agora", "12 min", "3 h", "5 d" — a caixa de entrada precisa ser curta. */
export function desde(iso) {
  if (!iso) return "";
  const seg = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return "agora";
  if (seg < 3600) return `${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `${Math.floor(seg / 3600)} h`;
  return `${Math.floor(seg / 86400)} d`;
}

export function dinheiro(valor) {
  if (valor === null || valor === undefined) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function numero(valor) {
  return (valor ?? 0).toLocaleString("pt-BR");
}
