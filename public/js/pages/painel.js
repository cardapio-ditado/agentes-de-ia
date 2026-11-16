import { get } from "../api.js";
import { avisarSeAcabou, cartaoDeSaldo, extrato } from "../pontos.js";
import { el, esqueleto, estadoDeErro, faixaDeAviso, ICONES, indicador, numero, plural, vazio } from "../ui.js";

/** Painel: os números que respondem "como foi a semana?" numa olhada. */
export async function painel(raiz, ctx) {
  raiz.replaceChildren(esqueleto({ cartoes: 4, linhas: 4 }));

  // O saldo não pode derrubar o painel: se a conta de pontos falhar, o resto
  // dos números continua valendo.
  let m, pontos;
  try {
    [m, pontos] = await Promise.all([
      get(`/v1/venues/${ctx.venue}/metrics`),
      extrato(ctx.venue).catch(() => null),
    ]);
  } catch (e) {
    raiz.replaceChildren(estadoDeErro("Não deu para carregar o painel", e.message, () => painel(raiz, ctx)));
    return;
  }
  raiz.replaceChildren();

  const pilha = el("div", { classe: "pilha" });

  // O que deu errado vem antes dos números: cliente que não foi avisado da
  // reserva é a única coisa desta tela que não pode esperar.
  if (m.notificacoes_falhas > 0) {
    pilha.append(
      faixaDeAviso({
        tom: "perigo",
        titulo: m.notificacoes_falhas === 1 ? "1 aviso ao cliente não chegou" : `${numero(m.notificacoes_falhas)} avisos ao cliente não chegaram`,
        // Ainda não existe botão de reenviar (só um comando de quem cuida do
        // servidor). Até existir, o que o dono PODE fazer é falar com o
        // cliente e chamar o suporte — é isso que o texto diz.
        detalhe: "Alguém pode ter tido a reserva aprovada ou recusada sem ficar sabendo. Confira as últimas reservas, fale com o cliente pelo WhatsApp se precisar e avise o suporte da Brasa Food para reenviarmos.",
        acao: el("a", { classe: "btn btn-peq", href: "#reservas", texto: "Ver as reservas" }),
      }),
    );
  }

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
        cor: "marca",
        tom: m.reservas.pendentes > 0 ? "alerta" : undefined,
      }),
      indicador({
        rotulo: "Conversas abertas",
        valor: numero(m.conversas.abertas),
        nota: `${numero(m.conversas.total)} no total`,
        iconePath: ICONES.conversas,
        cor: "areia",
      }),
      indicador({
        rotulo: "Com pessoa da equipe",
        valor: numero(m.conversas.com_humano),
        nota: "conversas que a equipe assumiu",
        iconePath: ICONES.pessoa,
        cor: "musgo",
      }),
      indicador({
        rotulo: "Mensagens (7 dias)",
        valor: numero(m.mensagens.total_7d),
        nota: `${numero(m.mensagens.do_agente_7d)} respondidas pelo atendente virtual`,
        iconePath: ICONES.raio,
        cor: "pinho",
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
        ? vazio("Nenhuma mensagem ainda", "Conecte um canal ou teste o atendente virtual para ver movimento.")
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
      // Token e cache são a conta da PLATAFORMA. O dono paga em pontos, e o
      // saldo dele já está no cartão do topo: mostrar isto a ele é um número
      // que não sabe ler e não tem o que fazer com ele. Só a equipe Brasa
      // Food vê — e `souPlataforma` nasce falso, então na dúvida some.
      ctx.souPlataforma === true
        ? el("section", { classe: "cartao" }, [
            el("h2", { texto: "Consumo do atendente virtual (7 dias)" }),
            el("p", { classe: "muted", texto: "Só a equipe Brasa Food vê este quadro." }),
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
          ])
        : null,
    ]),
  );

  pilha.append(
    el("section", { classe: "cartao" }, [
      el("h2", { texto: "Programação" }),
      el("p", {
        classe: "muted",
        texto:
          m.eventos_proximos > 0
            ? `${plural(m.eventos_proximos, "evento futuro", "eventos futuros")} que o atendente virtual pode citar para os clientes.`
            : "Nenhum evento futuro cadastrado. Sem isso o atendente virtual não tem o que contar sobre a casa.",
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
