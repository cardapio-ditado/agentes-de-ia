import { get } from "../api.js";
import { avisarSeAcabou, cartaoDeSaldo, extrato } from "../pontos.js";
import { el, ICONES, icone, indicador, numero, vazio } from "../ui.js";

/** Painel: os números que respondem "como foi a semana?" numa olhada. */
export async function painel(raiz, ctx) {
  raiz.append(el("p", { classe: "muted", texto: "Carregando números…" }));

  // O saldo não pode derrubar o painel: se a conta de pontos falhar, o resto
  // dos números continua valendo.
  const [m, pontos] = await Promise.all([
    get(`/v1/venues/${ctx.venue}/metrics`),
    extrato(ctx.venue).catch(() => null),
  ]);
  raiz.replaceChildren();

  const pilha = el("div", { classe: "pilha" });

  if (pontos) {
    pilha.append(cartaoDeSaldo(pontos));
    avisarSeAcabou(pontos);
  }

  pilha.append(
    el("div", { classe: "grade" }, [
      indicador({
        rotulo: "Reservas aguardando",
        valor: numero(m.reservas.pendentes),
        nota: m.reservas.pendentes > 0 ? "precisam de aprovação" : "nada na fila",
        iconePath: ICONES.reservas,
        destaque: m.reservas.pendentes > 0,
      }),
      indicador({
        rotulo: "Conversas abertas",
        valor: numero(m.conversas.abertas),
        nota: `${numero(m.conversas.total)} no total`,
        iconePath: ICONES.conversas,
      }),
      indicador({
        rotulo: "Com atendente",
        valor: numero(m.conversas.com_humano),
        nota: "assumidas por uma pessoa",
        iconePath: ICONES.pessoa,
      }),
      indicador({
        rotulo: "Mensagens (7 dias)",
        valor: numero(m.mensagens.total_7d),
        nota: `${numero(m.mensagens.do_agente_7d)} respondidas pelo agente`,
        iconePath: ICONES.raio,
      }),
    ]),
  );

  // Gráfico de 7 dias
  const maior = Math.max(1, ...m.serie_7d.map((d) => d.mensagens));
  const barras = el(
    "div",
    { classe: "barras" },
    m.serie_7d.map((d) => {
      const dia = new Date(`${d.dia}T12:00:00`);
      return el("div", { classe: "barra", title: `${d.dia}: ${d.mensagens}` }, [
        el("div", { classe: "barra-valor", texto: d.mensagens ? String(d.mensagens) : "" }),
        el("div", {
          classe: "barra-tronco",
          style: `height:${Math.round((d.mensagens / maior) * 100)}%`,
        }),
        el("div", {
          classe: "barra-dia",
          texto: dia.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
        }),
      ]);
    }),
  );

  pilha.append(
    el("section", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Movimento dos últimos 7 dias" }),
          el("p", { classe: "muted", texto: "Mensagens trocadas por dia" }),
        ]),
      ]),
      m.mensagens.total_7d === 0
        ? vazio("Nenhuma mensagem ainda", "Conecte um canal ou teste o agente para ver movimento.")
        : barras,
    ]),
  );

  pilha.append(
    el("div", { classe: "grade-2" }, [
      el("section", { classe: "cartao" }, [
        el("h2", { texto: "Decisões da semana" }),
        el("div", { style: "margin-top:10px" }, [
          linha("Aprovadas", numero(m.reservas.aprovadas_7d)),
          linha("Recusadas", numero(m.reservas.recusadas_7d)),
          linha("Na fila agora", numero(m.reservas.pendentes)),
        ]),
      ]),
      el("section", { classe: "cartao" }, [
        el("h2", { texto: "Consumo do agente (7 dias)" }),
        el("div", { style: "margin-top:10px" }, [
          linha("Tokens de entrada", numero(m.tokens_7d.entrada)),
          linha("Tokens de saída", numero(m.tokens_7d.saida)),
          linha("Lidos do cache", numero(m.tokens_7d.cache_lido)),
        ]),
        el("p", {
          classe: "muted",
          texto:
            "Cache alto é bom: é o prompt do estabelecimento sendo reaproveitado em vez de recobrado.",
        }),
      ]),
    ]),
  );

  // Só aparece quando há algo errado — cartão de alerta vazio vira ruído.
  if (m.notificacoes_falhas > 0) {
    pilha.append(
      el("section", { classe: "cartao alerta" }, [
        el("div", { classe: "indicador-rotulo" }, [
          icone(ICONES.alerta, 16),
          el("strong", { texto: "Mensagens não entregues" }),
        ]),
        el("p", {
          classe: "muted",
          texto: `${m.notificacoes_falhas} notificação(ões) falharam. O cliente pode ter sido aprovado sem saber. Rode "npm run reenviar-notificacoes" para tentar de novo.`,
        }),
      ]),
    );
  }

  pilha.append(
    el("section", { classe: "cartao" }, [
      el("h2", { texto: "Programação" }),
      el("p", {
        classe: "muted",
        texto:
          m.eventos_proximos > 0
            ? `${m.eventos_proximos} evento(s) futuro(s) que o agente pode citar para os clientes.`
            : "Nenhum evento futuro cadastrado. Sem isso o agente não tem o que contar sobre a casa.",
      }),
    ]),
  );

  raiz.append(pilha);
}

function linha(rotulo, valor) {
  return el("div", { classe: "linha-dado" }, [
    el("span", { texto: rotulo }),
    el("strong", { texto: valor }),
  ]);
}
