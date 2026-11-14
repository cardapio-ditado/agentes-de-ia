import { get, patch, post, put } from "../api.js";
import { avisar, dataHora, el, etiqueta, indicador, limpar, preencher, vazio } from "../ui.js";

/**
 * Delivery: a fila de pedidos, os cupons, os números e como a casa entrega.
 *
 * A aba que abre é a dos PEDIDOS, e ela se atualiza sozinha: é a tela que
 * fica aberta no balcão a noite inteira. Pedido novo toca um som e pode sair
 * direto na impressora — quem está na chapa não fica olhando para o monitor.
 *
 * Aqui só aparece pedido PAGO como "recebido". O que ainda espera pagamento
 * fica apagado na lista e ninguém consegue mandá-lo para a cozinha.
 */

const reais = (centavos) => ((centavos ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const paraCentavos = (texto) => {
  const n = parseFloat(String(texto).replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const noCampo = (centavos) => ((centavos ?? 0) / 100).toFixed(2).replace(".", ",");
const campo = (rotulo, controle, ajuda) =>
  el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle, ajuda ? el("small", { classe: "muted", texto: ajuda }) : null]);

// Uma fileira que quebra antes de estourar a tela. Estilo próprio porque
// `.linha-campos` empilha o rótulo em cima do controle — bom para campo de
// texto, errado para caixa de marcar ao lado do nome.
const FILEIRA = "display:flex;gap:.6rem;align-items:center;flex-wrap:wrap";
const fileira = (filhos, extra = "") => el("div", { style: `${FILEIRA};${extra}` }, filhos);
const caixaComNome = (caixa, nome, extra = "") =>
  el("label", { style: `display:inline-flex;gap:.4rem;align-items:center;margin:0;${extra}` }, [caixa, el("span", { texto: nome })]);
const ESTICA = "flex:1;min-width:140px;width:auto";

const SITUACAO = {
  aguardando_pagamento: ["Aguardando pagamento", ""],
  recebido: ["Novo — pago", "etiqueta-marca"],
  em_preparo: ["Em preparo", "etiqueta-info"],
  saiu_para_entrega: ["Saiu para entrega", "etiqueta-info"],
  pronto_para_retirada: ["Pronto para retirada", "etiqueta-info"],
  entregue: ["Entregue", "etiqueta-ok"],
  cancelado: ["Cancelado", "etiqueta-perigo"],
};
const ACAO = {
  em_preparo: "Começar o preparo",
  saiu_para_entrega: "Saiu para entrega",
  pronto_para_retirada: "Pronto para retirada",
  entregue: "Entregue",
  cancelado: "Cancelar",
};
const PAGAMENTO = { pix: "Pix", cartao: "Cartão" };
const CANAL = {
  "cardapio:site": "Cardápio (site)",
  "cardapio:whatsapp": "Cardápio (link do WhatsApp)",
  "conversa:whatsapp": "Conversa no WhatsApp",
  "conversa:site": "Chat do cardápio",
};

const preferencia = (chave) => localStorage.getItem(`brasa.delivery.${chave}`) === "1";

function tocar() {
  try {
    const audio = new AudioContext();
    [0, 0.25].forEach((quando) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.2;
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + quando);
      o.stop(audio.currentTime + quando + 0.15);
    });
  } catch {
    // Navegador sem som liberado: o pedido aparece na tela do mesmo jeito.
  }
}

/** A comanda da cozinha, em texto, numa janela própria — 80 mm de bobina. */
function imprimir(p, casa) {
  const TRACO = "--------------------------------";
  const linhas = [
    casa, `PEDIDO #${p.numero}`, dataHora(p.criado_em), TRACO,
    `${p.nome}  ${p.telefone}`,
    p.tipo === "entrega" ? `ENTREGA: ${p.endereco ?? ""}${p.bairro ? ` - ${p.bairro}` : ""}` : "RETIRADA NA CASA",
    TRACO,
    ...p.itens.flatMap((i) => [
      `${i.quantidade}x ${i.nome}  ${reais(i.preco_centavos * i.quantidade)}`,
      i.opcoes ? `   + ${i.opcoes}` : null,
      i.observacao ? `   OBS: ${i.observacao}` : null,
    ]),
    TRACO,
    `Subtotal: ${reais(p.subtotal_centavos)}`,
    p.taxa_centavos ? `Entrega: ${reais(p.taxa_centavos)}` : null,
    p.desconto_centavos ? `Cupom ${p.cupom}: -${reais(p.desconto_centavos)}` : null,
    p.cashback_usado_centavos ? `Cashback: -${reais(p.cashback_usado_centavos)}` : null,
    `TOTAL: ${reais(p.total_centavos)}`,
    `${PAGAMENTO[p.pagamento]} - ${p.pago_em ? "PAGO" : "AGUARDANDO PAGAMENTO"}`,
    p.observacoes ? `OBS: ${p.observacoes}` : null,
  ].filter(Boolean);
  const janela = window.open("", "_blank", "width=380,height=600");
  if (!janela) return avisar("O navegador bloqueou a janela de impressão. Libere pop-ups para este site.", "erro");
  const pre = janela.document.createElement("pre");
  pre.style.cssText = "font:12px/1.35 ui-monospace,monospace;width:72mm;white-space:pre-wrap;margin:0";
  pre.textContent = linhas.join("\n");
  janela.document.title = `Pedido #${p.numero}`;
  janela.document.body.append(pre);
  janela.print();
}

export async function delivery(raiz, ctx) {
  const base = `/v1/venues/${ctx.venue}/delivery`;
  const abas = el("div", { classe: "abas" });
  const corpo = el("div", {});
  raiz.append(abas, corpo);

  const ABAS = [["pedidos", "Pedidos", pedidos], ["cupons", "Cupons", cupons], ["numeros", "Números", numeros], ["ajustes", "Como a casa entrega", ajustes]];
  let atual = ABAS.some(([id]) => id === ctx.aba) ? ctx.aba : "pedidos";
  let relogio = null;
  ctx.aoSair(() => clearInterval(relogio));

  function abrir(id) {
    atual = id;
    clearInterval(relogio);
    preencher(abas, ABAS.map(([aba, rotulo]) =>
      el("button", { classe: `aba${aba === atual ? " aba-ativa" : ""}`, type: "button", texto: rotulo, onclick: () => abrir(aba) })));
    limpar(corpo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    ABAS.find(([aba]) => aba === id)[2]().catch((e) => preencher(corpo, vazio("Não consegui carregar", e.message)));
  }
  abrir(atual);

  // ---------- pedidos ----------
  async function pedidos() {
    let conhecidos = null;
    let assinatura = "";
    const lista = el("div", {});
    const marcar = (chave, rotulo) => {
      const caixa = el("input", { type: "checkbox", checked: preferencia(chave) });
      caixa.addEventListener("change", () => localStorage.setItem(`brasa.delivery.${chave}`, caixa.checked ? "1" : "0"));
      return caixaComNome(caixa, rotulo);
    };
    preencher(corpo,
      fileira([marcar("som", "Som em pedido novo"), marcar("imprimir", "Imprimir pedido novo sozinho")], "gap:1.2rem;margin-bottom:.8rem"),
      lista);

    async function buscar() {
      const dados = await get(`${base}/pedidos`);
      const nova = JSON.stringify(dados.map((p) => [p.id, p.status]));
      if (nova === assinatura) return;
      assinatura = nova;

      const novos = dados.filter((p) => p.status === "recebido" && conhecidos && !conhecidos.has(p.id));
      conhecidos = new Set(dados.filter((p) => p.status !== "aguardando_pagamento").map((p) => p.id));
      if (novos.length) {
        if (preferencia("som")) tocar();
        if (preferencia("imprimir")) imprimir(novos[0], ctx.venue);
      }

      if (!dados.length) return void preencher(lista, vazio("Nenhum pedido ainda", "Divulgue o link do cardápio (na aba “Como a casa entrega”) e os pedidos aparecem aqui."));
      preencher(lista, dados.map((p) => {
        const [rotulo, variante] = SITUACAO[p.status] ?? [p.status, ""];
        const pagoAposCancelar = p.status === "cancelado" && Boolean(p.pago_em);
        const encerrado = !pagoAposCancelar && (p.status === "entregue" || p.status === "cancelado" || p.status === "aguardando_pagamento");
        const mover = async (status) => {
          // Só o cancelamento pergunta: é o único passo que não tem volta e
          // mexe com dinheiro. Avançar o pedido é o gesto de toda hora de quem
          // está no balcão com a mão ocupada — uma pergunta a cada toque vira
          // o motivo de ninguém atualizar a fila.
          if (status === "cancelado") {
            const estorno = p.pago_em ? " O estorno do pagamento é feito por você, no Mercado Pago." : "";
            if (!confirm(`Cancelar o pedido #${p.numero}? O cliente é avisado.${estorno}`)) return;
          }
          try {
            await patch(`${base}/pedidos/${p.id}`, { status });
            avisar(status === "cancelado" ? `Pedido #${p.numero} cancelado.` : `Pedido #${p.numero}: ${ACAO[status].toLowerCase()}. O cliente foi avisado.`, "ok");
          } catch (e) {
            avisar(e.message, "erro");
          }
          assinatura = "";
          buscar().catch(() => {});
        };
        return el("section", { classe: "cartao pilha", style: encerrado ? "opacity:.6" : "" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h3", { texto: `#${p.numero} · ${p.nome} · ${reais(p.total_centavos)}` }),
              el("small", { classe: "muted", texto: [dataHora(p.criado_em), CANAL[`${p.origem}:${p.canal}`] ?? p.origem, `${PAGAMENTO[p.pagamento]}${p.pago_em ? " pago" : ""}`, p.telefone].join(" · ") }),
            ]),
            etiqueta(rotulo, variante),
          ]),
          // O cliente pagou depois que o pedido caiu: o dinheiro está na conta
          // da casa e ninguém vai entregar nada. Não pode passar batido.
          p.status === "cancelado" && p.pago_em
            ? el("p", { style: "margin:0;font-weight:600;color:var(--perigo, #b91c1c)", texto: "⚠ Este pedido foi pago depois de cancelado. Devolva o valor no Mercado Pago ou combine com o cliente." })
            : null,
          el("ul", { style: "margin:0;padding-left:1.2rem" }, p.itens.map((i) =>
            el("li", { texto: `${i.quantidade}x ${i.nome}${i.opcoes ? ` (${i.opcoes})` : ""}${i.observacao ? ` — ${i.observacao}` : ""}` }))),
          el("p", { classe: "muted", style: "margin:0", texto: [
            p.tipo === "entrega" ? `Entrega: ${p.endereco ?? ""}${p.bairro ? ` — ${p.bairro}` : ""}` : "Retirada na casa",
            p.cupom ? `Cupom ${p.cupom} (−${reais(p.desconto_centavos)})` : null,
            p.cashback_usado_centavos ? `Cashback −${reais(p.cashback_usado_centavos)}` : null,
            p.observacoes ? `Obs.: ${p.observacoes}` : null,
          ].filter(Boolean).join(" · ") }),
          el("div", { classe: "reserva-acoes", style: "margin:0" }, [
            ...p.proximos.map((s) => el("button", { classe: `btn btn-peq ${s === "cancelado" ? "btn-perigo" : s === p.proximos[0] ? "btn-primario" : ""}`.trim(), type: "button", texto: ACAO[s] ?? s, onclick: () => mover(s) })),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Imprimir", onclick: () => imprimir(p, ctx.venue) }),
          ]),
        ]);
      }));
    }
    await buscar();
    relogio = setInterval(() => buscar().catch(() => {}), 5000);
  }

  // ---------- cupons ----------
  async function cupons() {
    const { cupons: lista } = await get(base);
    const formulario = (c) => {
      const codigo = el("input", { classe: "input", value: c?.codigo ?? "", disabled: Boolean(c), style: "text-transform:uppercase", placeholder: "VOLTA10" });
      const tipo = el("select", { classe: "select" }, [el("option", { value: "percentual", texto: "% de desconto" }), el("option", { value: "fixo", texto: "R$ de desconto" })]);
      if (c) tipo.value = c.tipo;
      const valor = el("input", { classe: "input", inputmode: "decimal", value: c ? (c.tipo === "percentual" ? c.valor : noCampo(c.valor)) : "" });
      const minimo = el("input", { classe: "input", inputmode: "decimal", value: noCampo(c?.minimo_centavos ?? 0) });
      const limite = el("input", { classe: "input", inputmode: "numeric", value: c?.limite_usos ?? 0 });
      const expira = el("input", { classe: "input", type: "date", value: c?.expira_em ?? "" });
      const ativo = el("input", { type: "checkbox", checked: c ? c.ativo : true });
      const salvar = el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: c ? "Salvar" : "Criar cupom" });
      salvar.addEventListener("click", async () => {
        const numero = tipo.value === "percentual" ? Math.round(parseFloat(String(valor.value).replace(",", "."))) : paraCentavos(valor.value);
        // Dito aqui, ao lado do campo, e não devolvido pelo servidor como "valor inválido".
        if (!Number.isFinite(numero) || numero <= 0) {
          valor.focus();
          return avisar(tipo.value === "percentual" ? "Informe o desconto em %, de 1 a 100." : "Informe o desconto em reais. Ex.: 10,00", "erro");
        }
        try {
          await put(`${base}/cupons`, {
            codigo: codigo.value, tipo: tipo.value, valor: numero, minimo_centavos: paraCentavos(minimo.value) || 0,
            limite_usos: Number(limite.value) || 0, expira_em: expira.value || null, ativo: ativo.checked,
          });
          avisar("Cupom salvo.", "ok");
          abrir("cupons");
        } catch (e) {
          avisar(e.message, "erro");
        }
      });
      return el("section", { classe: "cartao pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("h3", { texto: c ? c.codigo : "Novo cupom" }),
          c ? el("small", { classe: "muted", texto: `${c.usos} uso(s)${c.limite_usos ? ` de ${c.limite_usos}` : ""}` }) : null,
        ]),
        el("div", { classe: "grade grade-2" }, [
          c ? null : campo("Código", codigo, "De 3 a 20 letras ou números, sem espaço."),
          campo("Tipo", tipo), campo("Valor", valor),
          campo("Pedido mínimo (R$)", minimo), campo("Limite de usos", limite, "0 = sem limite."),
          campo("Vale até", expira, "Em branco = não vence."),
        ]),
        el("div", { classe: "reserva-acoes", style: "margin:0" }, [caixaComNome(ativo, "Ativo"), salvar]),
      ]);
    };
    preencher(corpo, formulario(null), lista.map(formulario));
  }

  // ---------- números ----------
  let dias = 7;
  async function numeros() {
    const r = await get(`${base}/relatorio?dias=${dias}`);
    const tabela = (titulo, linhas, rotulo, colunas) => {
      const maior = Math.max(1, ...linhas.map((l) => l.centavos));
      return el("section", { classe: "cartao pilha" }, [
        el("h3", { texto: titulo }),
        linhas.length
          ? el("div", { classe: "tabela" }, linhas.map((l) => el("div", { classe: "linha-tabela" }, [
              el("div", { classe: "linha-principal", style: "flex:1;min-width:0" }, [
                el("strong", { texto: rotulo(l.rotulo) }),
                el("div", { style: `height:.45rem;border-radius:99px;background:var(--brasa, #ff6b35);min-width:2px;width:${(l.centavos / maior) * 100}%` }),
              ]),
              el("span", { classe: "muted", texto: colunas(l) }),
              el("strong", { texto: reais(l.centavos) }),
            ])))
          : el("p", { classe: "muted", texto: "Sem pedidos no período." }),
      ]);
    };
    preencher(corpo,
      el("div", { classe: "abas" }, [[1, "Hoje"], [7, "7 dias"], [30, "30 dias"], [90, "90 dias"]].map(([d, rotulo]) =>
        el("button", { classe: `aba${d === dias ? " aba-ativa" : ""}`, type: "button", texto: rotulo, onclick: () => { dias = d; abrir("numeros"); } }))),
      el("div", { classe: "grade" }, [
        indicador({ rotulo: "Faturamento", valor: reais(r.faturamento_centavos), destaque: true }),
        indicador({ rotulo: "Pedidos", valor: r.pedidos, nota: r.cancelados ? `${r.cancelados} cancelado(s)` : null }),
        indicador({ rotulo: "Ticket médio", valor: reais(r.ticket_medio_centavos) }),
        indicador({ rotulo: "Descontos de cupom", valor: reais(r.descontos_centavos) }),
        indicador({ rotulo: "Cashback usado", valor: reais(r.cashback_usado_centavos) }),
      ]),
      tabela("Vendas por dia", r.por_dia, (d) => d.split("-").reverse().join("/"), (l) => `${l.pedidos} pedido(s)`),
      tabela("De onde vieram", r.por_canal, (c) => CANAL[c] ?? c, (l) => `${l.pedidos} pedido(s)`),
      tabela("Forma de pagamento", r.por_pagamento, (f) => PAGAMENTO[f] ?? f, (l) => `${l.pedidos} pedido(s)`),
      tabela("Mais vendidos", r.mais_vendidos, (n) => n, (l) => `${l.quantidade} un.`));
  }

  // ---------- como a casa entrega ----------
  async function ajustes() {
    const dados = await get(base);
    const c = dados.config;
    // Só o perfil Equipe não configura. O servidor confere de novo — isto é
    // para não mostrar um botão que vai responder "sem permissão".
    const somenteLeitura = ctx.podeConfigurar === false;

    const aceitando = el("select", { classe: "select" }, [el("option", { value: "1", texto: "Recebendo pedidos (dentro do horário)" }), el("option", { value: "0", texto: "Pausado" })]);
    aceitando.value = c.aceitando ? "1" : "0";
    const previsao = el("input", { classe: "input", value: c.previsao ?? "" });
    const taxa = el("input", { classe: "input", inputmode: "decimal", value: noCampo(c.taxa_unica_centavos), style: "width:130px" });
    const retirada = el("input", { classe: "input", value: c.endereco_retirada ?? "" });
    const cashback = el("input", { classe: "input", inputmode: "numeric", value: c.cashback_percentual });
    const lembrar = el("select", { classe: "select" }, [el("option", { value: "1", texto: "Ligado" }), el("option", { value: "0", texto: "Desligado" })]);
    lembrar.value = c.lembrar_sacola ? "1" : "0";
    const instrucoes = el("textarea", { classe: "input", rows: 4, placeholder: "Ex.: pedido mínimo de R$ 30; não entregamos bebida alcoólica sem documento." });
    instrucoes.value = c.instrucoes ?? "";

    const semana = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((nome, dia) => {
      const marcado = el("input", { type: "checkbox", checked: Boolean(c.horario?.[dia]) });
      const abre = el("input", { classe: "input", type: "time", value: c.horario?.[dia]?.[0] ?? "18:00", style: "width:auto" });
      const fecha = el("input", { classe: "input", type: "time", value: c.horario?.[dia]?.[1] ?? "23:00", style: "width:auto" });
      return { dia, marcado, abre, fecha, linha: fileira([caixaComNome(marcado, nome, "min-width:120px"), abre, el("span", { texto: "às" }), fecha], "margin-bottom:.35rem") };
    });

    const salvar = async (campos, mensagem = "Salvo.") => {
      try {
        await put(`${base}/config`, campos);
        avisar(mensagem, "ok");
        abrir("ajustes");
      } catch (e) {
        avisar(e.message, "erro");
      }
    };
    const botao = (texto, aoClicar, classe = "btn btn-primario") =>
      somenteLeitura ? null : el("button", { classe, type: "button", texto, onclick: aoClicar });

    // Mercado Pago: o token nunca volta para a tela — só o fim dele.
    const mp = c.mercado_pago;
    const token = el("input", { classe: "input", type: "password", autocomplete: "off", placeholder: mp.conectado ? `Conectado (termina em ${mp.final_do_token}) — cole outro para trocar` : "APP_USR-…" });
    const segredo = el("input", { classe: "input", type: "password", autocomplete: "off", placeholder: mp.webhook_assinado ? "Assinatura configurada — cole outra para trocar" : "Assinatura secreta do webhook" });
    const email = el("input", { classe: "input", type: "email", value: c.mp_email_pagador ?? "", placeholder: "financeiro@suacasa.com.br" });

    const linhaDoBairro = (b) => {
      const nome = el("input", { classe: "input", value: b?.nome ?? "", placeholder: "Nome do bairro", style: ESTICA });
      const taxaDoBairro = el("input", { classe: "input", inputmode: "decimal", value: b ? noCampo(b.taxa_centavos) : "", placeholder: "Taxa (R$)", style: "width:130px" });
      const ativo = el("input", { type: "checkbox", checked: b ? b.ativo : true });
      return fileira([
        nome, taxaDoBairro, caixaComNome(ativo, "Atende"),
        botao(b ? "Salvar" : "Adicionar", async () => {
          try {
            const corpoDoBairro = { nome: nome.value, taxa_centavos: paraCentavos(taxaDoBairro.value) || 0, ativo: ativo.checked };
            if (b) await put(`${base}/bairros/${b.id}`, corpoDoBairro);
            else await post(`${base}/bairros`, corpoDoBairro);
            abrir("ajustes");
          } catch (e) {
            avisar(e.message, "erro");
          }
        }, "btn btn-peq"),
      ], "margin-bottom:.4rem");
    };

    preencher(corpo,
      el("section", { classe: "cartao pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [el("h3", { texto: "O link do seu delivery" }), el("small", { classe: "muted", texto: "Ponha na bio do Instagram, no WhatsApp e nos anúncios. O atendente virtual também manda este link." })]),
          etiqueta(dados.aberto ? "Aberto agora" : "Fechado agora", dados.aberto ? "etiqueta-ok" : "etiqueta-alerta"),
        ]),
        fileira([
          el("input", { classe: "input", value: dados.link, readonly: true, style: ESTICA }),
          el("button", { classe: "btn btn-peq", type: "button", texto: "Copiar", onclick: async () => { await navigator.clipboard.writeText(dados.link); avisar("Link copiado.", "ok"); } }),
          el("a", { classe: "btn btn-peq", href: dados.link, target: "_blank", rel: "noopener", texto: "Abrir" }),
        ]),
      ]),
      el("section", { classe: "cartao pilha" }, [
        el("h3", { texto: "Funcionamento" }),
        el("div", { classe: "grade grade-2" }, [
          campo("Situação", aceitando, "Pausar fecha o delivery na hora, sem mexer no horário."),
          campo("Previsão de preparo e entrega", previsao, "O cliente e o atendente virtual leem este texto."),
          campo("Endereço de retirada", retirada),
          campo("Cashback (%)", cashback, "Do valor dos itens, creditado quando o pedido é entregue. 0 desliga."),
          campo("Lembrete de sacola esquecida", lembrar, "Uma mensagem, 30 minutos depois, só para quem veio do WhatsApp."),
        ]),
        campo("O que o atendente virtual precisa saber do delivery", instrucoes),
        el("h3", { texto: "Horário do delivery" }),
        el("p", { classe: "muted", texto: "Marque os dias em que a casa entrega. Sem nenhum dia marcado, o delivery fica aberto enquanto a situação estiver em “Recebendo pedidos”." }),
        ...semana.map((d) => d.linha),
        botao("Salvar funcionamento", () => salvar({
          aceitando: aceitando.value === "1", previsao: previsao.value, endereco_retirada: retirada.value,
          cashback_percentual: Math.min(50, Math.max(0, parseInt(cashback.value, 10) || 0)), lembrar_sacola: lembrar.value === "1",
          instrucoes: instrucoes.value,
          horario: Object.fromEntries(semana.filter((d) => d.marcado.checked).map((d) => [d.dia, [d.abre.value, d.fecha.value]])),
        })),
      ]),
      el("section", { classe: "cartao pilha" }, [
        el("h3", { texto: "Bairros e taxa de entrega" }),
        el("p", { classe: "muted", texto: "Com bairros cadastrados, só eles são atendidos e cada um tem a sua taxa. Sem nenhum, vale a taxa única." }),
        fileira([
          el("span", { texto: "Taxa única (R$)" }),
          taxa,
          botao("Salvar taxa", () => salvar({ taxa_unica_centavos: paraCentavos(taxa.value) || 0 }), "btn btn-peq"),
        ], "margin-bottom:.8rem"),
        ...dados.bairros.map(linhaDoBairro),
        somenteLeitura ? null : linhaDoBairro(null),
      ]),
      el("section", { classe: "cartao pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [el("h3", { texto: "Mercado Pago" }), el("small", { classe: "muted", texto: "A conta é da casa: o dinheiro do Pix e do cartão cai direto nela." })]),
          etiqueta(mp.conectado ? "Conectado" : "Não conectado", mp.conectado ? "etiqueta-ok" : "etiqueta-alerta"),
        ]),
        mp.conectado ? null : el("p", { classe: "muted", texto: "Sem o Mercado Pago o cliente vê o cardápio mas não consegue fechar pedido." }),
        el("div", { classe: "grade grade-2" }, [
          campo("Access Token de produção", token, "Em Suas integrações → Credenciais de produção."),
          campo("Assinatura secreta do webhook", segredo, "Aparece ao cadastrar o endereço abaixo no Mercado Pago."),
          campo("E-mail de pagador do Pix", email, "O Pix exige um e-mail; use um da casa."),
          campo("Endereço para cadastrar em Webhooks (evento Pagamentos)", el("input", { classe: "input", value: dados.webhook, readonly: true })),
        ]),
        el("div", { classe: "reserva-acoes", style: "margin:0" }, [
          botao("Salvar Mercado Pago", () => salvar({ mp_access_token: token.value, mp_webhook_secret: segredo.value, mp_email_pagador: email.value }, "Mercado Pago salvo.")),
          mp.conectado ? botao("Desconectar", () => { if (confirm("Desconectar o Mercado Pago? O delivery para de fechar pedidos.")) salvar({ desconectar_mercado_pago: true }, "Desconectado."); }, "btn btn-perigo") : null,
        ]),
      ]));
  }
}
