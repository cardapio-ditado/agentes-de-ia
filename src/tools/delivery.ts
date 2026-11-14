import {
  ROTULO_DO_PAGAMENTO,
  ROTULO_DO_STATUS,
  abertoAgora,
  adicionarASacola,
  avisarCliente,
  cancelarPendenteDoCliente,
  configDoDelivery,
  cotarPedido,
  dinheiro,
  enderecoDoCardapio,
  fecharPedido,
  listarBairros,
  mudarQuantidade,
  opcoesEmTexto,
  pedidosDoCliente,
  sacolaDaConversa,
  saldoDeCashback,
  verSacola,
  type LinhaDaSacola,
  type Sacola,
} from "../delivery.js";
import { getVenue, type Venue } from "../venues.js";
import type { AgentTool, ToolContext } from "./types.js";

/**
 * As ferramentas de delivery do atendente.
 *
 * Só entram no agente da casa que contratou o módulo (ver `runAgent`): um
 * atendente com "finalizar pedido" numa casa que não entrega promete o que
 * ninguém vai cumprir.
 *
 * O desenho é o mesmo do cardápio com link: a sacola é uma só, e todo número
 * vem do servidor. O modelo diz O QUE o cliente quer; quanto custa, se o
 * bairro é atendido e se o cupom vale é resposta de ferramenta.
 */

async function contexto(ctx: ToolContext): Promise<{ venue: Venue; sacola: Sacola }> {
  if (!ctx.venueId) {
    throw new Error("Este agente não está ligado a um estabelecimento. Peça ao administrador para configurar.");
  }
  const venue = await getVenue(ctx.venueId);
  return { venue, sacola: await sacolaDaConversa(venue.id, ctx.conversationId) };
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function descreverSacola(linhas: LinhaDaSacola[], subtotal: number): string {
  if (linhas.length === 0) return "A sacola está vazia.";
  return [
    ...linhas.map((l, i) => {
      const extra = [opcoesEmTexto(l.opcoes), l.observacao].filter(Boolean).join("; ");
      const aviso = l.indisponivel ? " — SAIU DO CARDÁPIO, precisa ser removido" : "";
      return `${i + 1}. ${l.quantidade}x ${l.nome}${extra ? ` (${extra})` : ""} — ${dinheiro(l.preco_centavos * l.quantidade)}${aviso}`;
    }),
    `Subtotal: ${dinheiro(subtotal)}`,
  ].join("\n");
}

const CAMPOS_DA_ENTREGA = {
  tipo: { type: "string", enum: ["entrega", "retirada"] },
  bairro: {
    type: "string",
    description: "Bairro da entrega, como aparece em delivery_informacoes. Só para entrega.",
  },
  cupom: { type: "string", description: "Código de cupom que o cliente informou." },
  usar_cashback: { type: "boolean", description: "Abater o saldo de cashback do cliente." },
} as const;

const informacoes: AgentTool = {
  definition: {
    name: "delivery_informacoes",
    description:
      "Como funciona o delivery da casa AGORA: se está aberto, a previsão, os bairros atendidos com a taxa de cada um, " +
      "as formas de pagamento, o endereço de retirada e o saldo de cashback deste cliente. " +
      "Use antes de responder qualquer pergunta sobre entrega, taxa, prazo ou pagamento. Nunca responda isso de memória.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  async run(_input, ctx) {
    const { venue, sacola } = await contexto(ctx);
    const [cfg, bairros, saldo] = await Promise.all([
      configDoDelivery(venue.id),
      listarBairros(venue.id),
      saldoDeCashback(venue.id, sacola.telefone),
    ]);
    const ativos = bairros.filter((b) => b.ativo);
    return [
      abertoAgora(cfg, venue.timezone)
        ? "O delivery está ABERTO e recebendo pedidos."
        : "O delivery está FECHADO agora: não dá para fechar pedido. Explique com gentileza e convide a pedir no próximo horário.",
      `Previsão de preparo e entrega: ${cfg.previsao}.`,
      ativos.length > 0
        ? `Bairros atendidos e taxa: ${ativos.map((b) => `${b.nome} ${dinheiro(b.taxa_centavos)}`).join("; ")}. Fora desses bairros a casa não entrega.`
        : `Taxa de entrega: ${dinheiro(cfg.taxa_unica_centavos)}.`,
      `Retirada na casa: sem taxa${cfg.endereco_retirada ? `, em ${cfg.endereco_retirada}` : ""}.`,
      "Pagamento: Pix ou cartão, sempre no ato do pedido, pelo link que o sistema envia. Não existe pagamento na entrega nem em dinheiro.",
      cfg.cashback_percentual > 0
        ? `Cashback: ${cfg.cashback_percentual}% do valor dos itens volta como saldo a cada pedido entregue. Saldo deste cliente: ${dinheiro(saldo)}.`
        : "A casa não tem cashback no momento.",
      cfg.instrucoes ? `Orientações da casa: ${cfg.instrucoes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  },
};

const enviarCardapio: AgentTool = {
  definition: {
    name: "delivery_enviar_cardapio",
    description:
      "Envia ao cliente o link do cardápio de delivery, onde ele vê as fotos, monta a sacola e paga sozinho. " +
      "A sacola do link é a MESMA desta conversa. Ofereça no começo do atendimento, quando o cliente quiser ver as opções " +
      "ou preferir pedir por conta própria.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  async run(_input, ctx) {
    const { venue, sacola } = await contexto(ctx);
    const link = enderecoDoCardapio(venue, sacola.id);
    // No chat do próprio cardápio o cliente já está na página.
    if (ctx.channel === "delivery") return "O cliente já está no cardápio de delivery. Diga para ele tocar nos itens da página, ou anote o pedido por aqui.";
    if (ctx.channel === "whatsapp" && sacola.telefone) {
      await avisarCliente(venue, { telefone: sacola.telefone, numero: 0 }, "cardapio", `📖 Nosso cardápio de delivery: ${link}`);
      return "O sistema enviou o link numa mensagem separada. Não repita o endereço; diga que ele pode pedir por lá ou continuar aqui com você.";
    }
    return `Envie exatamente este link, sem alterar nada: ${link}`;
  },
};

const adicionar: AgentTool = {
  definition: {
    name: "delivery_adicionar_item",
    description:
      "Põe um item do cardápio na sacola de delivery do cliente e devolve a sacola atualizada. " +
      "Use o nome do item como aparece em consultar_cardapio. Se o item tiver opção obrigatória (sabor, tamanho, ponto), " +
      "pergunte ao cliente antes — a ferramenta recusa e lista as opções quando falta.",
    input_schema: {
      type: "object",
      properties: {
        item: { type: "string", description: "Nome do item no cardápio." },
        quantidade: { type: "integer", description: "Quantas unidades." },
        opcoes: {
          type: "array",
          items: { type: "string" },
          description: "Nomes das opções e adicionais escolhidos, como aparecem no cardápio.",
        },
        observacao: { type: "string", description: "Pedido especial do cliente: sem cebola, bem passado…" },
      },
      required: ["item", "quantidade"],
    },
  },
  async run(input, ctx) {
    const { venue, sacola } = await contexto(ctx);
    const nova = await adicionarASacola(venue, sacola, {
      item: String(input.item ?? ""),
      quantidade: Number(input.quantidade),
      opcoes: Array.isArray(input.opcoes) ? input.opcoes.map(String) : [],
      observacao: texto(input.observacao),
    });
    const { linhas, subtotal } = await verSacola(venue, nova);
    return descreverSacola(linhas, subtotal);
  },
};

const remover: AgentTool = {
  definition: {
    name: "delivery_remover_item",
    description:
      "Tira uma linha da sacola pelo número dela (o que aparece em delivery_ver_sacola). " +
      "Para trocar quantidade ou opção, remova e adicione de novo.",
    input_schema: {
      type: "object",
      properties: { linha: { type: "integer", description: "Número da linha na sacola, começando em 1." } },
      required: ["linha"],
    },
  },
  async run(input, ctx) {
    const { venue, sacola } = await contexto(ctx);
    const alvo = sacola.itens[Number(input.linha) - 1];
    if (!alvo) throw new Error(`A sacola não tem a linha ${String(input.linha)}. Chame delivery_ver_sacola para conferir.`);
    const nova = await mudarQuantidade(sacola, alvo.id, 0);
    const { linhas, subtotal } = await verSacola(venue, nova);
    return descreverSacola(linhas, subtotal);
  },
};

const ver: AgentTool = {
  definition: {
    name: "delivery_ver_sacola",
    description:
      "Mostra o que está na sacola de delivery do cliente agora — inclusive o que ele mesmo pôs pelo link do cardápio.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  async run(_input, ctx) {
    const { venue, sacola } = await contexto(ctx);
    const { linhas, subtotal } = await verSacola(venue, sacola);
    return descreverSacola(linhas, subtotal);
  },
};

const total: AgentTool = {
  definition: {
    name: "delivery_calcular_total",
    description:
      "Calcula o total do pedido com taxa de entrega, cupom e cashback, SEM fechar. " +
      "Use para montar o resumo que o cliente vai confirmar e para saber se um cupom vale.",
    input_schema: { type: "object", properties: CAMPOS_DA_ENTREGA, required: ["tipo"] },
  },
  async run(input, ctx) {
    const { venue, sacola } = await contexto(ctx);
    const pedido = {
      tipo: input.tipo === "retirada" ? ("retirada" as const) : ("entrega" as const),
      bairro: texto(input.bairro),
      cupom: texto(input.cupom),
      usar_cashback: input.usar_cashback === true,
    };
    const [{ linhas, subtotal }, c] = await Promise.all([verSacola(venue, sacola), cotarPedido(venue, sacola, pedido)]);
    return [
      descreverSacola(linhas, subtotal),
      pedido.tipo === "entrega" ? `Entrega${c.bairro ? ` (${c.bairro})` : ""}: ${dinheiro(c.taxa)}` : "Retirada: sem taxa",
      c.desconto ? `Cupom ${c.cupom}: -${dinheiro(c.desconto)}` : "",
      c.cashback_usado
        ? `Cashback usado: -${dinheiro(c.cashback_usado)}`
        : c.cashback_disponivel
          ? `Cashback disponível e não aplicado: ${dinheiro(c.cashback_disponivel)}`
          : "",
      `TOTAL: ${dinheiro(c.total)}`,
      ...c.pendencias.map((p) => `PENDÊNCIA (resolva antes de fechar): ${p}`),
    ]
      .filter(Boolean)
      .join("\n");
  },
};

const finalizar: AgentTool = {
  definition: {
    name: "delivery_finalizar_pedido",
    description:
      "Fecha a sacola num pedido e gera a cobrança. Só chame depois que o cliente disse SIM ao resumo de " +
      "delivery_calcular_total (itens, total, entrega ou retirada, forma de pagamento). " +
      "O sistema envia sozinho o código Pix ou o link do cartão e o link de acompanhamento — não escreva nenhum deles.",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome de quem vai receber." },
        telefone: {
          type: "string",
          description: "WhatsApp com DDD. Só é preciso quando a conversa NÃO é pelo WhatsApp.",
        },
        ...CAMPOS_DA_ENTREGA,
        endereco: { type: "string", description: "Rua, número e complemento. Obrigatório para entrega." },
        pagamento: { type: "string", enum: ["pix", "cartao"] },
        observacoes: { type: "string" },
      },
      required: ["nome", "tipo", "pagamento"],
    },
  },
  async run(input, ctx) {
    const { venue, sacola } = await contexto(ctx);
    const pedido = await fecharPedido(venue, sacola, {
      origem: "conversa",
      nome: String(input.nome ?? ""),
      telefone: texto(input.telefone),
      tipo: input.tipo === "retirada" ? "retirada" : "entrega",
      bairro: texto(input.bairro),
      endereco: texto(input.endereco),
      pagamento: String(input.pagamento ?? ""),
      cupom: texto(input.cupom),
      usar_cashback: input.usar_cashback === true,
      observacoes: texto(input.observacoes),
    });
    if (pedido.status === "recebido") {
      return `Pedido #${pedido.numero} fechado e já pago com o desconto do cliente (total ${dinheiro(pedido.total_centavos)}). O sistema enviou a confirmação e o link de acompanhamento.`;
    }
    // No chat do cardápio não há número para onde mandar: a cobrança aparece na própria página.
    const onde = ctx.channel === "delivery"
      ? "A cobrança apareceu na tela do cliente, no acompanhamento do pedido."
      : `O sistema enviou ${pedido.pagamento === "pix" ? "o código Pix copia e cola" : "o link do cartão"} e o link de acompanhamento em mensagens separadas.`;
    return `Pedido #${pedido.numero} criado, total ${dinheiro(pedido.total_centavos)}, aguardando pagamento. ${onde} O preparo só começa quando o pagamento for confirmado, e a confirmação chega sozinha. Não confirme pagamento por comprovante.`;
  },
};

const meusPedidos: AgentTool = {
  definition: {
    name: "delivery_meus_pedidos",
    description:
      "Os pedidos de delivery recentes deste cliente e em que pé cada um está. " +
      "Use quando ele perguntar do pedido, disser que já pagou ou quiser saber se saiu para entrega.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  async run(_input, ctx) {
    const { venue, sacola } = await contexto(ctx);
    const pedidos = await pedidosDoCliente(venue.id, sacola);
    if (pedidos.length === 0) return "Este cliente não tem pedido de delivery registrado.";
    return pedidos
      .map((p) => {
        const itens = p.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(", ");
        return `Pedido #${p.numero}: ${itens} — ${dinheiro(p.total_centavos)}, ${p.tipo}, ${ROTULO_DO_PAGAMENTO[p.pagamento]}. Status: ${ROTULO_DO_STATUS[p.status]}.`;
      })
      .join("\n");
  },
};

const cancelar: AgentTool = {
  definition: {
    name: "delivery_cancelar_pedido",
    description:
      "Cancela um pedido deste cliente que ainda NÃO foi pago. Pedido já pago só a equipe da casa cancela — " +
      "nesse caso diga que vai passar para a equipe.",
    input_schema: {
      type: "object",
      properties: { numero: { type: "integer", description: "O número do pedido." } },
      required: ["numero"],
    },
  },
  async run(input, ctx) {
    const { venue, sacola } = await contexto(ctx);
    const pedido = await cancelarPendenteDoCliente(venue, sacola, Number(input.numero));
    return `Pedido #${pedido.numero} cancelado. O sistema já avisou o cliente.`;
  },
};

export const ferramentasDeDelivery: AgentTool[] = [
  informacoes, enviarCardapio, adicionar, remover, ver, total, finalizar, meusPedidos, cancelar,
];

/**
 * O que o atendente precisa saber para vender — entra no prompt só da casa
 * que tem o módulo, junto das ferramentas acima.
 */
export const INSTRUCOES_DE_DELIVERY = `## Delivery

Esta casa recebe pedidos de delivery, e você fecha o pedido inteiro pela conversa.

- O cliente pede de dois jeitos: pelo cardápio com link (delivery_enviar_cardapio) ou conversando com você. A sacola é a mesma nos dois. Se ele chegou sem dizer o que quer, ofereça o link e diga que também pode anotar por aqui.
- Item e preço vêm de consultar_cardapio; taxa, bairro, prazo, cupom e cashback vêm das ferramentas de delivery. Nunca invente nenhum deles, nem promessa de prazo ou desconto.
- Vá pondo na sacola o que ele pede (delivery_adicionar_item). Item com opção obrigatória: pergunte antes. Pedido especial vai na observação.
- Uma vez por atendimento, quando couber, sugira algo que combine com o pedido (bebida, porção, sobremesa), sem insistir.
- Para fechar você precisa de: nome, entrega ou retirada, endereço e bairro (se entrega) e forma de pagamento — Pix ou cartão. O pagamento é sempre antecipado, pelo sistema: não aceite dinheiro, pagamento na entrega nem combinado por fora.
- Antes de fechar, chame delivery_calcular_total e mostre o resumo (itens, taxa, descontos, total, pagamento). Só chame delivery_finalizar_pedido depois de um "sim" claro a esse resumo.
- Depois de fechar, a cobrança, a confirmação e o acompanhamento saem sozinhos pelo sistema. Não escreva código Pix nem link de pagamento.
- Você não confirma pagamento: quem confirma é o sistema. Se o cliente disser que pagou e delivery_meus_pedidos ainda mostrar aguardando, peça um instante e, se continuar, diga que vai passar para a equipe.
- Reserva de mesa e delivery são coisas diferentes: não registre reserva para quem quer comida em casa.`;
