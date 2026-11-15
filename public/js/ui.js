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
  // O `append` do navegador escreve "null" na tela quando recebe null, e
  // bloco opcional (`cond ? el(...) : null`) é o jeito de escrever tela aqui.
  // Todo container que passa por limpar() ganha um append que pula vazios.
  if (!node.__appendSeguro) {
    const original = node.append.bind(node);
    node.append = (...filhos) => original(...filhos.flat().filter((f) => f !== null && f !== undefined && f !== false));
    node.__appendSeguro = true;
  }
  return node;
}

/**
 * Troca o conteúdo de `node` pelos filhos, pulando null/false. O `append`
 * do navegador escreve "null" na tela quando recebe null — e bloco opcional
 * (`cond ? el(...) : null`) é o jeito de escrever tela aqui.
 */
export function preencher(node, ...filhos) {
  node.replaceChildren(...filhos.flat().filter((f) => f !== null && f !== undefined && f !== false));
  return node;
}

/**
 * A tabela de dados do sistema: colunas com cabeçalho, número à direita,
 * linha que abre o registro e, se pedirem, grupos que abrem e fecham.
 *
 * É uma `<table>` de verdade — coluna alinhada é o que deixa o olho comparar
 * trinta linhas sem ler nenhuma, e leitor de tela anuncia o cabeçalho de cada
 * célula. No celular ela se desmonta em fichas (ver `.planilha-empilha`): a
 * célula `principal` vira o título e as outras levam o nome da coluna na frente.
 *
 *   colunas: [{ rotulo, largura?, num?, principal?, acoes?, quebra? }]
 *            na ficha do celular: larga? (linha inteira), semRotulo?, someNoCelular?
 *   estreita: true quando a tabela mora numa coluna de meia tela
 *   larguraMinima: abaixo dela a tabela rola de lado dentro da caixa, em vez de espremer
 *   linhas:  [{ celulas: [texto | nó | null], aoClicar?, classe? }]
 *   grupos:  [{ titulo, quantidade?, resumo?, tom?, aberto?, aoAlternar?, linhas }]
 *            ou { secao: "Comer" } para uma faixa de separação
 *   rodape:  [texto | nó | null] — uma célula por coluna
 */
export function tabelaDeDados({ colunas, linhas = [], grupos = null, rodape = null, semCabecalho = false, estreita = false, larguraMinima = null }) {
  const celula = (tag, col, conteudo) => {
    const c = el(tag, {
      classe: [col.num ? "col-num" : "", col.acoes ? "col-acoes" : "", col.principal ? "cel-principal" : "", col.quebra ? "cel-quebra" : "", col.larga ? "cel-larga" : "", col.someNoCelular ? "cel-some" : ""].filter(Boolean).join(" ") || null,
      "data-rotulo": tag === "td" && !col.principal && !col.acoes && !col.semRotulo && col.rotulo ? col.rotulo : null,
    });
    if (conteudo instanceof Node) c.append(conteudo);
    else if (conteudo !== null && conteudo !== undefined && conteudo !== false) c.textContent = String(conteudo);
    // Célula vazia some da ficha do celular: "Fornecedor:" sem nada é ruído.
    else c.classList.add("cel-vazia");
    return c;
  };
  const linha = (l) => {
    const tr = el("tr", { classe: [l.classe, l.aoClicar ? "linha-abre" : ""].filter(Boolean).join(" ") || null }, colunas.map((col, i) => celula("td", col, l.celulas[i])));
    if (l.aoClicar) {
      tr.tabIndex = 0;
      tr.addEventListener("click", (e) => {
        // Botão, link e campo dentro da linha fazem o que são, sem abrir o registro.
        if (e.target.closest("button, a, input, select, label")) return;
        l.aoClicar();
      });
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target === tr) l.aoClicar();
      });
    }
    return tr;
  };

  const corpos = [];
  if (grupos) {
    for (const g of grupos) {
      if (g.secao) {
        corpos.push(el("tbody", { classe: "planilha-secao" }, [el("tr", {}, [el("th", { colspan: colunas.length, scope: "colgroup", texto: g.secao })])]));
        continue;
      }
      const botao = el("button", { classe: "planilha-grupo-botao", type: "button", "aria-expanded": String(Boolean(g.aberto)) }, [
        el("span", { classe: "planilha-grupo-seta", "aria-hidden": "true", texto: "›" }),
        el("span", { classe: "planilha-grupo-titulo", texto: g.titulo }),
        g.quantidade !== undefined && g.quantidade !== null ? el("span", { classe: "planilha-grupo-quantos", texto: String(g.quantidade) }) : null,
        ...(g.selos ?? []),
        g.resumo ? el("span", { classe: "planilha-grupo-resumo", texto: g.resumo }) : null,
      ]);
      const corpo = el("tbody", { classe: `planilha-grupo${g.tom ? ` planilha-grupo-${g.tom}` : ""}`, "data-fechado": g.aberto ? null : "1" }, [
        el("tr", { classe: "planilha-grupo-linha" }, [el("th", { colspan: colunas.length, scope: "colgroup" }, [botao])]),
        ...g.linhas.map(linha),
      ]);
      botao.addEventListener("click", () => {
        const abrir = corpo.hasAttribute("data-fechado");
        corpo.toggleAttribute("data-fechado", !abrir);
        botao.setAttribute("aria-expanded", String(abrir));
        g.aoAlternar?.(abrir);
      });
      corpos.push(corpo);
    }
  } else {
    corpos.push(el("tbody", {}, linhas.map(linha)));
  }

  return el("div", { classe: "rolagem-x" }, [
    // Com largura declarada a tabela é de leiaute fixo: as colunas não dançam
    // quando um grupo abre, e texto comprido corta com reticências.
    el("table", { classe: `planilha planilha-empilha${colunas.some((c) => c.largura) ? " planilha-fixa" : ""}${estreita ? " planilha-estreita" : ""}`, style: larguraMinima ? `--largura-minima:${larguraMinima}` : null }, [
      colunas.some((c) => c.largura) ? el("colgroup", {}, colunas.map((c) => el("col", { style: c.largura ? `width:${c.largura}` : null }))) : null,
      semCabecalho ? null : el("thead", {}, [el("tr", {}, colunas.map((c) => celula("th", c, c.rotulo)))]),
      ...corpos,
      rodape ? el("tfoot", {}, [el("tr", {}, colunas.map((c, i) => celula("td", { ...c, rotulo: null }, rodape[i])))]) : null,
    ]),
  ]);
}

/** SVG por caminho: os ícones da interface vêm todos daqui. */
export function icone(d, tamanho = 19) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", tamanho);
  svg.setAttribute("height", tamanho);
  svg.setAttribute("aria-hidden", "true");
  // Atributos, e não estilo embutido: assim o CSS acerta a espessura do traço
  // ao peso do texto ao lado (1,75 junto de texto normal, 2 junto de negrito).
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
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
  checklist: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  camera: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z",
  atualizar: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15",
  estrela: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z",
  plugue: "M9 2v6M15 2v6M6 8h12v4a6 6 0 01-12 0V8zM12 18v4",
  caixa: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  busca: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  fechar: "M18 6L6 18M6 6l12 12",
  mais: "M12 5v14M5 12h14",
  olho: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 100-6 3 3 0 000 6z",
  baixar: "M12 3v12M7 10l5 5 5-5M5 21h14",
  entrada: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.5-6.9A2 2 0 0016.8 4H7.2a2 2 0 00-1.7 1.1z",
  lixeira: "M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6",
  sugestao: "M9.9 4.6L12 10l5.4 2.1L12 14.2 9.9 19.6 7.8 14.2 2.4 12.1 7.8 10zM18 3v4M16 5h4M19 16v3M17.5 17.5h3",
  recibo: "M6 2h12a1 1 0 011 1v19l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 011-1zM9 8h6M9 12h6",
  caminhao: "M1 4h13v12H1zM14 9h4l4 4v3h-8zM5.5 19.5a2 2 0 100-4 2 2 0 000 4zM18 19.5a2 2 0 100-4 2 2 0 000 4z",
  pessoas: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8",
  transferir: "M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  editar: "M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z",
  local: "M3 9l9-6 9 6v11a1 1 0 01-1 1H4a1 1 0 01-1-1zM9 21v-8h6v8",
  cifrao: "M12 2v20M17 6.5C17 4.6 14.8 4 12 4S7 5 7 7.5 9 11 12 11.5s5 1.5 5 4-2.2 4-5 4-5-.8-5-2.8",
  enviar: "M12 16V4M7 9l5-5 5 5M5 20h14",
  voltar: "M15 18l-6-6 6-6",
};

/** Quantos erros ficam na tela ao mesmo tempo: mais que isso cobre o trabalho. */
const ERROS_NA_TELA = 3;

/**
 * Aviso no canto. "Salvou" e informação somem sozinhos; ERRO fica até a
 * pessoa fechar.
 *
 * Todo aviso sumia em cinco segundos. Para o "salvo" está certo; para o erro,
 * não: quem está no balcão olha para o cliente, volta para o celular e a
 * mensagem já foi embora — e ela acredita que a reserva foi aprovada. Erro é
 * a única coisa que a pessoa PRECISA ler, então é ela quem decide quando some.
 *
 * O mesmo erro repetido (uma tela que tenta de novo sozinha) troca o aviso
 * anterior em vez de empilhar outro igual.
 */
export function avisar(texto, tipo = "info") {
  const caixa = document.getElementById("avisos");
  if (tipo !== "erro") {
    const aviso = el("div", { classe: `aviso aviso-${tipo}`, texto });
    caixa.append(aviso);
    setTimeout(() => aviso.remove(), 5200);
    return;
  }

  const abertos = [...caixa.querySelectorAll(".aviso-erro")];
  for (const a of abertos) if (a.dataset.texto === String(texto)) a.remove();
  for (const a of abertos.filter((x) => x.isConnected).slice(0, -(ERROS_NA_TELA - 1))) a.remove();

  // role="alert": o leitor de tela fala na hora, sem esperar a vez.
  const aviso = el("div", { classe: "aviso aviso-erro", role: "alert", "data-texto": String(texto) }, [
    el("span", { classe: "aviso-texto", texto }),
    el("button", {
      classe: "aviso-fechar",
      type: "button",
      "aria-label": "Fechar aviso",
      title: "Fechar",
      texto: "×",
      onclick: () => aviso.remove(),
    }),
  ]);
  caixa.append(aviso);
}

export function etiqueta(texto, variante = "") {
  // Situação começa com maiúscula em todo o sistema, venha como vier do código.
  const rotulo = String(texto ?? "");
  return el("span", { classe: `etiqueta ${variante}`.trim(), texto: rotulo.charAt(0).toUpperCase() + rotulo.slice(1) });
}

/**
 * Lugar vazio: o que não tem aqui, o que fazer em seguida e, quando houver,
 * o botão que faz. `acao` é um botão pronto (ou nada).
 */
export function vazio(titulo, detalhe, acao = null) {
  return el("div", { classe: "vazio" }, [
    el("strong", { texto: titulo }),
    detalhe ? el("span", { texto: detalhe }) : null,
    acao,
  ]);
}

/** Erro ao carregar: diz o que houve e oferece tentar de novo. */
export function estadoDeErro(titulo, detalhe, aoTentar) {
  return el("div", { classe: "vazio estado-erro", role: "alert" }, [
    el("strong", { texto: titulo }),
    detalhe ? el("span", { texto: detalhe }) : null,
    aoTentar ? el("button", { classe: "btn btn-peq", type: "button", texto: "Tentar novamente", onclick: aoTentar }) : null,
  ]);
}

/**
 * Esqueleto de carregamento: ocupa o lugar do que vem, para a tela não pular
 * quando os dados chegam. `cartoes` e `linhas` dizem quantos de cada.
 */
export function esqueleto({ cartoes = 0, linhas = 5 } = {}) {
  return el("div", { classe: "pilha", "aria-busy": "true", "aria-label": "Carregando" }, [
    cartoes ? el("div", { classe: "grade" }, Array.from({ length: cartoes }, () => el("span", { classe: "esqueleto esqueleto-cartao indicador" }))) : null,
    el(
      "div",
      { classe: "esqueleto-tabela" },
      Array.from({ length: linhas }, () => el("div", {}, Array.from({ length: 4 }, () => el("span", { classe: "esqueleto esqueleto-linha" })))),
    ),
  ]);
}

/**
 * Indicador: ícone pequeno, rótulo, valor e uma linha de contexto.
 *
 * `tom` é semântico — "alerta" pede atenção, "perigo" é problema — e nunca
 * decoração. `destaque` continua valendo como "alerta", para as telas antigas.
 */
export function indicador({ rotulo, valor, nota, iconePath, destaque, tom, cor, serie }) {
  const variante = tom ?? (destaque ? "alerta" : "");
  // `cor` (areia, musgo, marca, pinho) é o tom do cartão, da identidade;
  // `tom` (alerta, perigo) é a situação. Um não substitui o outro.
  return el("div", { classe: `indicador${variante ? ` indicador-${variante}` : ""}${cor ? ` indicador-tom-${cor}` : ""}` }, [
    iconePath ? el("span", { classe: "indicador-icone", "aria-hidden": "true" }, [icone(iconePath, 18)]) : null,
    el("div", { classe: "indicador-rotulo", texto: rotulo }),
    el("div", { classe: "indicador-valor", texto: String(valor) }),
    nota ? el("div", { classe: "indicador-nota", texto: nota }) : null,
    faisca(serie),
  ]);
}

/**
 * Os últimos dias em miniatura, no canto do indicador. `serie` são os
 * valores reais, em ordem; sem valor nenhum acima de zero, não desenha nada.
 */
function faisca(serie) {
  if (!Array.isArray(serie) || !serie.some((v) => v > 0)) return null;
  const maior = Math.max(...serie);
  return el(
    "span",
    { classe: "faisca", "aria-hidden": "true" },
    serie.map((v) => el("i", { style: `height:${v > 0 ? Math.max(8, Math.round((v / maior) * 100)) : 7}%`, "data-vazio": v > 0 ? null : "" })),
  );
}

/**
 * Campo de busca: lupa, texto e o botão de limpar quando há o que limpar.
 * `aoMudar(texto)` é chamado a cada tecla; quem precisar de pausa passa `espera`.
 */
export function campoDeBusca({ rotulo, placeholder = "Buscar…", valor = "", aoMudar, espera = 0, atalho = false }) {
  const input = el("input", { type: "search", placeholder, value: valor, "aria-label": rotulo ?? placeholder, autocomplete: "off", spellcheck: "false" });
  const limparBusca = el("button", { classe: "campo-busca-limpar", type: "button", "aria-label": "Limpar a busca", hidden: !valor }, [icone(ICONES.fechar, 14)]);
  let temporizador = null;
  const avisarMudanca = () => {
    limparBusca.hidden = !input.value;
    clearTimeout(temporizador);
    if (espera) temporizador = setTimeout(() => aoMudar?.(input.value), espera);
    else aoMudar?.(input.value);
  };
  input.addEventListener("input", avisarMudanca);
  limparBusca.addEventListener("click", () => {
    input.value = "";
    avisarMudanca();
    input.focus();
  });
  const caixa = el("div", { classe: "campo-busca" }, [
    icone(ICONES.busca, 16),
    input,
    limparBusca,
    atalho ? el("kbd", { classe: "campo-busca-atalho", "aria-hidden": "true", texto: "/" }) : null,
  ]);
  caixa.campo = input;
  if (atalho) {
    // "/" leva o cursor para a busca — menos quando a pessoa já está digitando
    // em algum campo. O ouvinte sai sozinho quando a tela sai do ar.
    input.setAttribute("aria-keyshortcuts", "/");
    const aoTeclar = (e) => {
      if (!caixa.isConnected) return document.removeEventListener("keydown", aoTeclar);
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      input.focus();
    };
    document.addEventListener("keydown", aoTeclar);
  }
  return caixa;
}

/**
 * Botão só de ícone, para as ações de uma linha. O nome vai no `aria-label`
 * (para quem não vê) e na dica que aparece ao passar o mouse ou focar.
 */
export function acaoIcone({ iconePath, rotulo, aoClicar, variante = "" }) {
  return el("button", { classe: `acao-icone${variante ? ` acao-icone-${variante}` : ""}`, type: "button", "aria-label": rotulo, "data-dica": rotulo, onclick: aoClicar }, [icone(iconePath, 16)]);
}

/**
 * "Voltar" de uma etapa interna (detalhe, formulário, conferência). Fica à
 * esquerda do título da etapa: o CSS cuida da posição (`.btn-voltar`).
 */
export function botaoVoltar(aoClicar, texto = "Voltar") {
  return el("button", { classe: "btn btn-peq btn-voltar", type: "button", onclick: aoClicar }, comIcone(ICONES.voltar, texto));
}

/** Texto com ícone à esquerda, para o conteúdo de um botão. */
export function comIcone(iconePath, texto) {
  return [icone(iconePath, 16), document.createTextNode(texto)];
}

// ============ Formatação ============

/**
 * O relógio da casa.
 *
 * Toda data no painel se lê AQUI, não no fuso de quem está olhando: o dono
 * conferindo a agenda de outro estado precisa ver o horário em que o show
 * começa no bar dele, não no relógio do celular dele.
 *
 * O fuso vem do estabelecimento aberto (`definirFusoDaCasa`, chamado quando
 * o painel carrega a casa e quando troca de casa). Era um valor fixo de
 * Cuiabá, do tempo em que só havia uma casa — e uma casa de São Paulo veria
 * todas as reservas uma hora adiantadas, sem erro nenhum na tela.
 */
export let FUSO_DA_CASA = "America/Cuiaba";

function formatadoresDo(fuso) {
  return {
    dataHora: new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    diaIso: new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }),
    hora: new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    diaCurto: new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, weekday: "short", day: "2-digit", month: "2-digit" }),
  };
}
let formatos = formatadoresDo(FUSO_DA_CASA);

/**
 * Passa o painel para o relógio de outra casa.
 *
 * Fuso que o navegador não conhece é ignorado (fica o anterior): mostrar a
 * hora de Cuiabá é ruim, a tela em branco por um RangeError é pior.
 */
export function definirFusoDaCasa(fuso) {
  if (!fuso || fuso === FUSO_DA_CASA) return;
  try {
    formatos = formatadoresDo(fuso);
    FUSO_DA_CASA = fuso;
  } catch {
    console.warn(`[painel] fuso desconhecido: ${fuso}`);
  }
}

/** O dia de hoje no relógio da casa, como "2026-08-22" — para o valor padrão de um campo de data. */
export function hojeNaCasa() {
  return formatos.diaIso.format(new Date());
}

export function dataHora(iso) {
  if (!iso) return "—";
  return formatos.dataHora.format(new Date(iso));
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

/**
 * O dia civil no relógio da casa, como "2026-08-22".
 *
 * Serve para agrupar por dia. Usar getDate() em cima de um instante UTC
 * agruparia pelo fuso do NAVEGADOR: um show de sábado às 22h em Cuiabá é
 * domingo 02h em UTC, e cairia na casinha errada do calendário para quem
 * abrisse o painel de um servidor ou de outro país.
 */
export function diaNaCasa(iso) {
  return formatos.diaIso.format(new Date(iso));
}

export function horaNaCasa(iso) {
  return formatos.hora.format(new Date(iso));
}

/** "sáb., 22/08" — o suficiente para reconhecer o dia numa lista. */
export function diaCurtoNaCasa(iso) {
  return formatos.diaCurto.format(new Date(iso)).replace(".,", "");
}

export function dinheiro(valor) {
  if (valor === null || valor === undefined) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function numero(valor) {
  return (valor ?? 0).toLocaleString("pt-BR");
}

/**
 * Seletor com lupa: um campo de busca que escolhe da lista.
 *
 * Substitui o <select> nas listas grandes. Com trinta insumos o select
 * serve; com trezentos, achar "Tilápia" rolando é o que faz a pessoa
 * desistir e escolher o primeiro parecido — que no estoque vira entrada no
 * item errado. Digitar três letras resolve.
 *
 * Busca sem acento: "acai" acha "Açaí".
 */
export function buscador(opcoes, { placeholder = "Buscar…", aoEscolher }) {
  const norm = (t) =>
    (t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const campo = el("input", { classe: "campo", placeholder, autocomplete: "off" });
  const lista = el("div", { classe: "buscador-lista", hidden: true });
  const caixa = el("div", { classe: "buscador" }, [campo, lista]);

  const desenhar = () => {
    const alvo = norm(campo.value.trim());
    const achadas = alvo
      ? opcoes.filter((o) => norm(o.rotulo).includes(alvo)).slice(0, 12)
      : opcoes.slice(0, 12);
    limpar(lista);
    if (achadas.length === 0) {
      lista.append(el("p", { classe: "muted buscador-nada", texto: "Nada com esse nome." }));
    }
    for (const o of achadas) {
      lista.append(
        el("button", {
          type: "button",
          classe: "buscador-opcao",
          texto: o.rotulo,
          // mousedown e não click: o blur do campo esconde a lista antes de
          // o click chegar, e a escolha se perderia.
          onmousedown: (ev) => {
            ev.preventDefault();
            campo.value = "";
            lista.hidden = true;
            aoEscolher(o);
          },
        }),
      );
    }
  };

  campo.addEventListener("input", () => { lista.hidden = false; desenhar(); });
  campo.addEventListener("focus", () => { lista.hidden = false; desenhar(); });
  campo.addEventListener("blur", () => setTimeout(() => { lista.hidden = true; }, 150));
  return caixa;
}
