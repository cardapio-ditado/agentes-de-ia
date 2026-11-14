/**
 * O cardápio de delivery: /delivery/<casa>.
 *
 * A página não calcula preço nenhum para valer. Ela soma na tela para o botão
 * mostrar "Adicionar · R$ 27,00", mas o que vale é sempre o que o servidor
 * devolve: a sacola, a cotação e o pedido vêm prontos de lá.
 *
 * Três jeitos de chegar:
 *   /delivery/<casa>            — direto (Instagram, QR, anúncio): sacola nova
 *   /delivery/<casa>?s=<id>     — pelo link que o atendente mandou no WhatsApp:
 *                                 é a sacola DA CONVERSA, já com o que ele anotou
 *   /delivery/<casa>?pedido=<t> — o acompanhamento de um pedido
 */

const $ = (id) => document.getElementById(id);
const reais = (centavos) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Cria um elemento. Texto entra sempre por textContent: nome de item não vira marcação. */
function el(tag, props = {}, ...filhos) {
  const node = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === "texto") node.textContent = valor;
    else if (chave === "classe") node.className = valor;
    else if (chave.startsWith("on")) node.addEventListener(chave.slice(2), valor);
    else if (chave in node) node[chave] = valor;
    else node.setAttribute(chave, valor === true ? "" : String(valor));
  }
  // `=== 0` de propósito: `lista.length && el(...)` devolve 0 quando vazio, e
  // o navegador escreveria "0" na tela.
  node.append(...filhos.flat().filter((f) => f !== null && f !== undefined && f !== false && f !== 0));
  return node;
}

const guarda = {
  ler(chave) {
    try { return localStorage.getItem(chave); } catch { return null; }
  },
  gravar(chave, valor) {
    try {
      if (valor === null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, valor);
    } catch { /* navegação privada: a página funciona sem lembrar */ }
  },
};

const busca = new URLSearchParams(location.search);
// A casa vem do caminho (/delivery/<casa>); o `?casa=` existe para a página
// abrir também como arquivo solto (delivery.html), que é como `npm run telas` a serve.
const CASA = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] ?? "") || busca.get("casa") || "";
const BASE = `/v1/delivery-publico/${encodeURIComponent(CASA)}`;
const CHAVE_SACOLA = `brasa.delivery.${CASA}.sacola`;
const CHAVE_PEDIDO = `brasa.delivery.${CASA}.pedido`;

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(BASE + caminho, {
    method: opcoes.method ?? (opcoes.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json" },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok || corpo.success === false) {
    throw Object.assign(new Error(corpo.error?.message || "Algo deu errado. Tente de novo."), { status: resposta.status });
  }
  return corpo.data;
}

let loja = null;
let sacola = null;

// ============ sacola ============

async function carregarSacola() {
  const id = busca.get("s") || guarda.ler(CHAVE_SACOLA);
  if (!id) return;
  try {
    sacola = await api(`/sacola/${id}`);
    guarda.gravar(CHAVE_SACOLA, sacola.id);
  } catch (e) {
    if (e.status === 404) guarda.gravar(CHAVE_SACOLA, null);
  }
}

/** A sacola só nasce no primeiro toque que precisa dela: quem só olha não cria nada. */
async function garantirSacola() {
  if (sacola) return sacola;
  sacola = await api("/sacola", { method: "POST" });
  guarda.gravar(CHAVE_SACOLA, sacola.id);
  return sacola;
}

function desenharBarra() {
  const quantos = sacola?.linhas.reduce((s, l) => s + l.quantidade, 0) ?? 0;
  $("barra-sacola").hidden = quantos === 0;
  $("sacola-quantos").textContent = quantos;
  $("sacola-total").textContent = reais(sacola?.subtotal ?? 0);
  document.body.classList.toggle("com-sacola", quantos > 0);
}

// ============ a casa e o cardápio ============

function vestirDaCasa(casa) {
  document.title = `${casa.nome} — Delivery`;
  $("nome-da-casa").textContent = casa.nome;
  if (casa.logo_url) {
    $("logo").src = casa.logo_url;
    $("logo").hidden = false;
  }
  if (casa.cor_marca) {
    document.documentElement.style.setProperty("--marca", casa.cor_marca);
    document.documentElement.style.setProperty("--sobre-marca", casa.cor_texto || "#ffffff");
  }
  $("selo-aberto").textContent = casa.aberto ? "Aberto agora" : "Fechado";
  $("selo-aberto").className = `selo ${casa.aberto ? "ok" : "alerta"}`;
  $("faixa-fechado").hidden = casa.aberto && casa.cobranca_pronta;
  $("faixa-fechado").textContent = !casa.cobranca_pronta
    ? "O pagamento online desta casa ainda está sendo configurado. Você pode ver o cardápio, mas ainda não dá para fechar pedido."
    : "Estamos fechados agora. Você pode ver o cardápio e montar a sacola; os pedidos abrem no nosso horário.";
  $("resumo-da-casa").textContent = [
    casa.horario_hoje && `Hoje: ${casa.horario_hoje}`,
    casa.previsao && `Previsão ${casa.previsao}`,
    casa.bairros.length ? "Taxa por bairro" : `Entrega ${reais(casa.taxa_unica_centavos)}`,
    casa.cashback_percentual ? `${casa.cashback_percentual}% de cashback` : null,
  ].filter(Boolean).join(" · ");
}

function desenharCardapio() {
  const comItens = loja.categorias.filter((c) => loja.itens.some((i) => i.categoria_id === c.id));
  const soltos = loja.itens.filter((i) => !comItens.some((c) => c.id === i.categoria_id));
  const grupos = [...comItens.map((c) => ({ nome: c.nome, itens: loja.itens.filter((i) => i.categoria_id === c.id) }))];
  if (soltos.length) grupos.push({ nome: "Outros", itens: soltos });

  $("categorias").replaceChildren(...grupos.map((g, n) => el("a", { href: `#cat-${n}`, texto: g.nome })));
  if (!grupos.length) {
    $("cardapio").replaceChildren(el("p", { classe: "apoio", texto: "O cardápio desta casa ainda está sendo montado." }));
    return;
  }
  $("cardapio").replaceChildren(...grupos.map((g, n) =>
    el("section", { id: `cat-${n}` },
      el("h2", { texto: g.nome }),
      el("div", { classe: "grade" }, g.itens.map((item) => {
        const temObrigatoriaPaga = item.variacoes.some((v) => v.obrigatorio && v.opcoes.some((o) => o.adicional > 0));
        const preco = el("span", { classe: "preco" },
          item.promocao && el("s", { texto: reais(Math.round(item.preco * 100)) }),
          (temObrigatoriaPaga ? "a partir de " : "") + reais(Math.round((item.promocao?.preco ?? item.preco) * 100)));
        return el("button", { classe: "produto", type: "button", onclick: () => abrirProduto(item) },
          el("div", { classe: "dados" },
            el("strong", { texto: item.nome }),
            el("span", { classe: "apoio pequeno", texto: item.descricao }),
            preco),
          item.capa && el("img", { src: item.capa, alt: "", loading: "lazy" }));
      })))));
}

function abrirProduto(item) {
  let quantidade = 1;
  const grupos = item.variacoes.map((grupo) => {
    const controles = grupo.opcoes.map((opcao) => {
      const controle = el("input", { type: grupo.obrigatorio ? "radio" : "checkbox", name: `g-${grupo.id}`, value: opcao.id, onchange: () => atualizar() });
      controle.dataset.centavos = Math.round(opcao.adicional * 100);
      return { controle, linha: el("label", { classe: "opcao" }, controle,
        el("span", { classe: "cresce", texto: opcao.nome }),
        opcao.adicional > 0 && el("span", { classe: "apoio", texto: `+ ${reais(Math.round(opcao.adicional * 100))}` })) };
    });
    return { grupo, controles, caixa: el("fieldset", {},
      el("legend", {}, grupo.nome, " ", el("span", { classe: `selo ${grupo.obrigatorio ? "alerta" : ""}`, texto: grupo.obrigatorio ? "Escolha 1 · obrigatório" : "Opcional" })),
      controles.map((c) => c.linha)) };
  });
  const observacao = el("textarea", { rows: 2, maxLength: 300, placeholder: "Alguma observação? Ex.: sem cebola" });
  const mostrador = el("span", { classe: "quantos", texto: "1" });
  const adicionar = el("button", { type: "button", classe: "cresce" });
  const erro = el("p", { classe: "erro" });
  const marcados = () => grupos.flatMap((g) => g.controles.filter((c) => c.controle.checked).map((c) => c.controle));

  function atualizar() {
    const unidade = Math.round((item.promocao?.preco ?? item.preco) * 100) + marcados().reduce((s, c) => s + Number(c.dataset.centavos), 0);
    adicionar.textContent = `Adicionar · ${reais(unidade * quantidade)}`;
    adicionar.disabled = grupos.some((g) => g.grupo.obrigatorio && !g.controles.some((c) => c.controle.checked));
    mostrador.textContent = quantidade;
  }
  const passo = (delta) => el("button", { type: "button", classe: "leve redondo", texto: delta > 0 ? "+" : "−", ariaLabel: delta > 0 ? "Aumentar" : "Diminuir",
    onclick: () => { quantidade = Math.max(1, Math.min(50, quantidade + delta)); atualizar(); } });

  adicionar.addEventListener("click", async () => {
    adicionar.disabled = true;
    try {
      await garantirSacola();
      sacola = await api(`/sacola/${sacola.id}/itens`, { body: { item: item.id, quantidade, opcoes: marcados().map((c) => c.value), observacao: observacao.value } });
      desenharBarra();
      $("folha-produto").close();
    } catch (e) {
      erro.textContent = e.message;
      adicionar.disabled = false;
    }
  });

  $("form-produto").replaceChildren(
    item.capa && el("img", { classe: "foto-grande", src: item.capa, alt: "" }),
    el("div", { classe: "folha-topo" }, el("strong", { texto: item.nome }), el("button", { classe: "leve", texto: "Fechar" })),
    el("div", { classe: "folha-miolo" },
      el("p", { classe: "apoio", texto: item.descricao }),
      grupos.map((g) => g.caixa),
      el("label", {}, "Observações", observacao),
      erro),
    el("div", { classe: "folha-pe linha" }, passo(-1), mostrador, passo(1), adicionar));
  atualizar();
  $("folha-produto").showModal();
}

// ============ sacola e fechamento ============

const fechamento = { tipo: "entrega", bairro: null, cupom: "", usar_cashback: false, pagamento: "pix", nome: "", telefone: "", endereco: "", observacoes: "" };

function abrirSacola() {
  fechamento.nome ||= sacola.cliente.nome;
  fechamento.endereco ||= sacola.cliente.endereco;
  fechamento.bairro ??= loja.casa.bairros.find((b) => b.nome === sacola.cliente.bairro)?.id ?? null;
  desenharSacola();
  $("folha-sacola").showModal();
}

function desenharSacola() {
  const corpo = $("corpo-sacola");
  const fechar = el("button", { classe: "leve", type: "button", texto: "Fechar", onclick: () => $("folha-sacola").close() });
  if (!sacola.linhas.length) {
    corpo.replaceChildren(el("div", { classe: "folha-topo" }, el("strong", { texto: "Sua sacola" }), fechar), el("p", { classe: "folha-miolo apoio", texto: "Sua sacola está vazia." }));
    return desenharBarra();
  }

  const mudar = async (linha, quantidade) => {
    try {
      sacola = await api(`/sacola/${sacola.id}/itens/${linha.id}`, { method: "PATCH", body: { quantidade } });
      desenharSacola();
    } catch (e) { erro.textContent = e.message; }
  };
  const linhas = sacola.linhas.map((l) => el("div", { classe: "item-sacola" },
    el("div", { classe: "cresce" },
      el("strong", { texto: l.nome }),
      el("div", { classe: "apoio pequeno", texto: [l.opcoes.map((o) => o.nome).join(", "), l.observacao].filter(Boolean).join(" · ") }),
      l.indisponivel
        ? el("div", { classe: "pequeno erro", texto: "Saiu do cardápio — tire para continuar" })
        : el("div", { classe: "pequeno", texto: reais(l.preco_centavos * l.quantidade) })),
    el("button", { classe: "leve redondo", type: "button", texto: "−", ariaLabel: "Diminuir", onclick: () => mudar(l, l.quantidade - 1) }),
    el("span", { classe: "quantos", texto: l.quantidade }),
    el("button", { classe: "leve redondo", type: "button", texto: "+", ariaLabel: "Aumentar", onclick: () => mudar(l, l.quantidade + 1) })));

  const campo = (rotulo, chave, props = {}) => {
    const controle = el("input", { value: fechamento[chave] ?? "", ...props });
    controle.addEventListener("input", () => { fechamento[chave] = controle.value; });
    return el("label", {}, rotulo, controle);
  };
  const escolha = (chave, opcoes) => el("div", { classe: "escolha" }, opcoes.map(([valor, rotulo]) =>
    el("button", { type: "button", classe: fechamento[chave] === valor ? "marcado" : "", texto: rotulo, onclick: () => { fechamento[chave] = valor; desenharSacola(); } })));

  const totais = el("div", { classe: "totais" });
  const erro = el("p", { classe: "erro" });
  const podeFechar = loja.casa.aberto && loja.casa.cobranca_pronta;
  const pedir = el("button", { type: "button", classe: "cresce", texto: "Fazer pedido", disabled: !podeFechar });

  const pedidoDaTela = () => ({ tipo: fechamento.tipo, bairro: fechamento.bairro, cupom: fechamento.cupom || null, usar_cashback: fechamento.usar_cashback });
  async function cotar() {
    try {
      const c = await api(`/sacola/${sacola.id}/cotacao`, { body: pedidoDaTela() });
      const linha = (rotulo, valor, classe = "") => el("div", { classe: `linha ${classe}` }, el("span", { classe: "cresce", texto: rotulo }), el("span", { texto: valor }));
      totais.replaceChildren(
        linha("Subtotal", reais(c.subtotal)),
        fechamento.tipo === "entrega" && linha("Entrega", c.bairro || !loja.casa.bairros.length ? reais(c.taxa) : "escolha o bairro"),
        c.desconto > 0 && linha(`Cupom ${c.cupom}`, `− ${reais(c.desconto)}`, "ok"),
        c.cashback_usado > 0 && linha("Cashback", `− ${reais(c.cashback_usado)}`, "ok"),
        linha("Total", reais(c.total), "total"));
      // Só o problema do cupom aparece aqui: bairro e endereço a pessoa ainda está preenchendo.
      erro.textContent = fechamento.cupom ? c.pendencias.filter((p) => /cupom/i.test(p)).join(" ") : "";
      pedir.textContent = podeFechar ? `Fazer pedido · ${reais(c.total)}` : "Pedidos fechados agora";
    } catch (e) { erro.textContent = e.message; }
  }

  const campoCupom = el("input", { value: fechamento.cupom, placeholder: "Código", maxLength: 20, style: "text-transform:uppercase" });
  const aplicar = el("button", { type: "button", classe: "leve", texto: "Aplicar", onclick: () => { fechamento.cupom = campoCupom.value.trim(); cotar(); } });

  pedir.addEventListener("click", async () => {
    pedir.disabled = true;
    erro.textContent = "";
    try {
      const pedido = await api(`/sacola/${sacola.id}/pedido`, { body: {
        ...pedidoDaTela(), nome: fechamento.nome, telefone: fechamento.telefone || null,
        endereco: fechamento.endereco || null, pagamento: fechamento.pagamento, observacoes: fechamento.observacoes || null,
      } });
      sacola = { ...sacola, linhas: [], subtotal: 0 };
      Object.assign(fechamento, { cupom: "", usar_cashback: false, observacoes: "" });
      desenharBarra();
      $("folha-sacola").close();
      guarda.gravar(CHAVE_PEDIDO, pedido.token);
      mostrarPedido(pedido);
    } catch (e) {
      erro.textContent = e.message;
      pedir.disabled = false;
    }
  });

  const bairros = loja.casa.bairros;
  const seletorDeBairro = bairros.length > 0 && el("select", { onchange: (e) => { fechamento.bairro = e.target.value || null; cotar(); } },
    el("option", { value: "", texto: "Selecione o bairro" }),
    bairros.map((b) => el("option", { value: b.id, texto: `${b.nome} — ${reais(b.taxa_centavos)}`, selected: b.id === fechamento.bairro })));

  corpo.replaceChildren(
    el("div", { classe: "folha-topo" }, el("strong", { texto: "Sua sacola" }), fechar),
    el("div", { classe: "folha-miolo" },
      linhas,
      el("h3", { texto: "Como você quer receber?" }),
      escolha("tipo", [["entrega", "Entrega"], ["retirada", "Retirar na casa"]]),
      fechamento.tipo === "entrega"
        ? [seletorDeBairro && el("label", {}, "Bairro", seletorDeBairro), campo("Endereço (rua, número, complemento)", "endereco", { autocomplete: "street-address", maxLength: 300 })]
        : el("p", { classe: "apoio pequeno", texto: loja.casa.endereco_retirada ? `Retirada em: ${loja.casa.endereco_retirada}` : "Retire seu pedido na casa." }),
      el("h3", { texto: "Seus dados" }),
      campo("Nome", "nome", { autocomplete: "name", maxLength: 80 }),
      // Quem veio pelo WhatsApp já é conhecido: o telefone é o da conversa.
      !sacola.verificada && campo("WhatsApp com DDD", "telefone", { type: "tel", autocomplete: "tel", placeholder: "(65) 99999-9999", maxLength: 20 }),
      el("h3", { texto: "Pagamento" }),
      escolha("pagamento", [["pix", "Pix"], ["cartao", "Cartão"]]),
      el("p", { classe: "apoio pequeno", texto: "O pagamento é feito agora, online. O preparo começa assim que ele é confirmado." }),
      el("label", {}, "Cupom de desconto", el("div", { classe: "linha" }, campoCupom, aplicar)),
      sacola.cashback_centavos > 0 && el("label", { classe: "opcao" },
        el("input", { type: "checkbox", checked: fechamento.usar_cashback, onchange: (e) => { fechamento.usar_cashback = e.target.checked; cotar(); } }),
        el("span", { texto: `Usar meu cashback (${reais(sacola.cashback_centavos)})` })),
      campo("Observações do pedido (opcional)", "observacoes", { maxLength: 300 }),
      totais, erro),
    el("div", { classe: "folha-pe linha" }, pedir));
  desenharBarra();
  cotar();
}

// ============ acompanhamento ============

const PASSOS = {
  entrega: ["recebido", "em_preparo", "saiu_para_entrega", "entregue"],
  retirada: ["recebido", "em_preparo", "pronto_para_retirada", "entregue"],
};
const NOME_DO_PASSO = { recebido: "Pedido recebido", em_preparo: "Em preparo", saiu_para_entrega: "Saiu para entrega", pronto_para_retirada: "Pronto para retirada", entregue: "Entregue" };
let relogioDoPedido = null;
let desenhoAtual = "";

function mostrarPedido(pedido) {
  desenharPedido(pedido);
  $("folha-pedido").showModal();
  clearInterval(relogioDoPedido);
  // A tela se atualiza sozinha: é aqui que o cliente vê o Pix cair.
  relogioDoPedido = setInterval(async () => {
    if (!$("folha-pedido").open) return clearInterval(relogioDoPedido);
    try { desenharPedido(await api(`/pedidos/${pedido.token}`)); } catch { /* sem rede por um instante: tenta de novo */ }
  }, 5000);
}

function desenharPedido(p) {
  const assinatura = `${p.token}:${p.status}:${p.cashback_ganho_centavos}`;
  if (assinatura === desenhoAtual && $("corpo-pedido").childElementCount) return;
  desenhoAtual = assinatura;

  const blocos = [];
  if (p.status === "aguardando_pagamento") {
    blocos.push(el("p", { classe: "faixa alerta", texto: "Aguardando pagamento. O preparo começa assim que ele for confirmado — esta tela atualiza sozinha." }));
    if (p.pix_codigo) {
      const copiar = el("button", { type: "button", texto: "Copiar código Pix", onclick: async () => { await navigator.clipboard.writeText(p.pix_codigo); copiar.textContent = "Copiado ✓"; } });
      blocos.push(
        p.pix_qr && el("img", { classe: "qr", alt: "QR code do Pix", src: `data:image/png;base64,${p.pix_qr}` }),
        el("p", { classe: "pix", texto: p.pix_codigo }),
        copiar);
    } else if (p.link_pagamento) {
      blocos.push(el("a", { href: p.link_pagamento, target: "_blank", rel: "noopener" }, el("button", { type: "button", texto: "Pagar com cartão" })));
    }
  } else if (p.status === "cancelado") {
    blocos.push(el("p", { classe: "faixa alerta", texto: "Este pedido foi cancelado." }));
  } else {
    const passos = PASSOS[p.tipo];
    const onde = passos.indexOf(p.status);
    blocos.push(el("ol", { classe: "passos" }, passos.map((s, n) => el("li", { classe: n < onde ? "feito" : n === onde ? "agora" : "", texto: NOME_DO_PASSO[s] }))));
    if (p.cashback_ganho_centavos > 0) {
      blocos.push(el("p", { classe: "faixa ok", texto: `Você ganhou ${reais(p.cashback_ganho_centavos)} de cashback! Use no próximo pedido pelo nosso WhatsApp.` }));
    }
  }

  const linha = (rotulo, valor) => el("div", { classe: "linha" }, el("span", { classe: "cresce", texto: rotulo }), el("span", { texto: valor }));
  $("corpo-pedido").replaceChildren(
    el("div", { classe: "folha-topo" }, el("strong", { texto: `Pedido #${p.numero}` }), el("button", { classe: "leve", type: "button", texto: "Fechar", onclick: () => $("folha-pedido").close() })),
    el("div", { classe: "folha-miolo" },
      blocos,
      el("h3", { texto: "Resumo" }),
      p.itens.map((i) => linha(`${i.quantidade}x ${i.nome}${i.opcoes ? ` (${i.opcoes})` : ""}`, reais(i.preco_centavos * i.quantidade))),
      el("div", { classe: "totais" },
        p.taxa_centavos > 0 && linha("Entrega", reais(p.taxa_centavos)),
        p.desconto_centavos > 0 && linha("Desconto", `− ${reais(p.desconto_centavos)}`),
        p.cashback_usado_centavos > 0 && linha("Cashback", `− ${reais(p.cashback_usado_centavos)}`),
        el("div", { classe: "linha total" }, el("span", { classe: "cresce", texto: "Total" }), el("span", { texto: reais(p.total_centavos) }))),
      el("p", { classe: "apoio pequeno", texto: `${p.pagamento === "pix" ? "Pix" : "Cartão"} · ${p.tipo === "entrega" ? `Entrega em ${[p.endereco, p.bairro].filter(Boolean).join(" — ")}` : "Retirada na casa"}` })));

  const emAndamento = !["entregue", "cancelado"].includes(p.status);
  $("faixa-pedido").hidden = !emAndamento;
  $("faixa-pedido").textContent = `Acompanhar pedido #${p.numero} →`;
  $("faixa-pedido").onclick = () => mostrarPedido(p);
  if (!emAndamento) guarda.gravar(CHAVE_PEDIDO, null);
}

// ============ chat com o atendente ============

function falar(texto, quem = "") {
  const bolha = el("div", { classe: `fala ${quem}`.trim(), texto });
  $("conversa").append(bolha);
  $("conversa").scrollTop = $("conversa").scrollHeight;
  return bolha;
}

$("form-chat").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const mensagem = $("campo-chat").value.trim();
  if (!mensagem) return;
  $("campo-chat").value = "";
  falar(mensagem, "minha");
  const digitando = el("div", { classe: "digitando", texto: "digitando…" });
  $("conversa").append(digitando);
  try {
    await garantirSacola();
    const r = await api("/chat", { body: { sacola: sacola.id, mensagem } });
    digitando.remove();
    if (r.sacola) { sacola = r.sacola; desenharBarra(); }
    falar(r.humano ? "Uma pessoa da equipe vai continuar este atendimento. Aguarde um instante." : r.texto || "Não consegui responder agora. Tente de novo.", r.humano ? "sistema" : "");
    // Se o atendente fechou o pedido pela conversa, a cobrança aparece aqui.
    await conferirPedidoNovo();
  } catch (e) {
    digitando.remove();
    falar(e.message, "sistema");
  }
});

/** O atendente pode ter fechado um pedido: a sacola esvazia e o pedido da sacola aparece. */
async function conferirPedidoNovo() {
  if (!sacola || sacola.linhas.length) return;
  try {
    const atual = await api(`/sacola/${sacola.id}`);
    if (atual.pedido_pendente && atual.pedido_pendente !== guarda.ler(CHAVE_PEDIDO)) {
      guarda.gravar(CHAVE_PEDIDO, atual.pedido_pendente);
      $("folha-chat").close();
      mostrarPedido(await api(`/pedidos/${atual.pedido_pendente}`));
    }
  } catch { /* o chat segue funcionando */ }
}

$("botao-chat").addEventListener("click", () => {
  if (!$("conversa").childElementCount) falar("Olá! 👋 Posso tirar dúvidas ou anotar seu pedido por aqui.");
  $("folha-chat").showModal();
  $("campo-chat").focus();
});
$("fechar-chat").addEventListener("click", () => $("folha-chat").close());
$("barra-sacola").addEventListener("click", abrirSacola);
// Tocar fora da folha fecha, como em qualquer app.
for (const folha of document.querySelectorAll("dialog")) {
  folha.addEventListener("click", (e) => { if (e.target === folha) folha.close(); });
}

// ============ começo ============

(async () => {
  try {
    [loja] = await Promise.all([api(""), carregarSacola()]);
  } catch (e) {
    $("cardapio").replaceChildren(el("p", { classe: "faixa alerta", texto: e.status === 404 ? "Esta casa não tem delivery por aqui." : e.message }));
    return;
  }
  vestirDaCasa(loja.casa);
  desenharCardapio();
  desenharBarra();
  // Sacola que veio do WhatsApp conversa no WhatsApp.
  $("botao-chat").hidden = !loja.chat || Boolean(sacola?.verificada);

  const token = busca.get("pedido") || guarda.ler(CHAVE_PEDIDO);
  if (token) {
    try {
      const pedido = await api(`/pedidos/${token}`);
      if (busca.get("pedido")) mostrarPedido(pedido);
      else desenharPedido(pedido);
    } catch { guarda.gravar(CHAVE_PEDIDO, null); }
  }
})();
