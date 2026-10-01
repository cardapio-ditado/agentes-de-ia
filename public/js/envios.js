import { el, etiqueta } from "./ui.js";

/**
 * O QUADRO DE ENVIOS — o vocabulário e as peças, para qualquer tela que
 * mande mensagem pelo número oficial: parabéns, convite da pesquisa,
 * disparos.
 *
 * Os degraus do envio, na ordem da escada: fila → aceito → entregue → lido →
 * respondeu, mais os dois desvios (não chegou, falhou) e quem nem entra.
 *
 * A situação de cada mensagem vem PRONTA do servidor (`envio.situacao`), na
 * mesma régua que trava o reenvio lá. Aqui só mora o vocabulário: nome, cor
 * e a explicação que aparece ao passar o mouse. O quadro conta por isto, a
 * lista filtra por isto, e as telas nunca discordam entre si.
 */
export const SITUACOES = [
  ["sem_envio", "Sem envio", "", "", "Ainda não recebeu a mensagem"],
  ["na_fila", "Na fila", "etiqueta-alerta", "alerta", "Vai sair em instantes pelo número oficial"],
  ["aceito", "Aguardando entrega", "etiqueta-info", "info", "A Meta aceitou; costuma chegar em minutos"],
  ["entregue", "Entregues", "etiqueta-ok", "ok", "Chegou no celular da pessoa"],
  ["lido", "Lidas", "etiqueta-ok", "ok", "A pessoa abriu a mensagem"],
  ["respondeu", "Responderam", "etiqueta-marca", "marca", "A pessoa respondeu"],
  ["nao_chegou", "Não chegou", "etiqueta-alerta", "alerta", "A Meta aceitou há mais de 2 h e não entregou"],
  ["falhou", "Falhou", "etiqueta-perigo", "perigo", "A Meta recusou; o motivo está na linha"],
  ["fora", "Fora", "", "", "Sem telefone, ou pediu para não receber"],
];
export const SITUACAO = Object.fromEntries(SITUACOES.map(([id, nome, classe, tom, dica]) => [id, { nome, classe, tom, dica }]));

/** "29/09 17:41" — a hora de um carimbo, curta o bastante para caber na linha. */
export function horaCurta(iso) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}

/**
 * O que aconteceu com a mensagem daquela pessoa, num selo.
 *
 * "Enfileirado" não é "entregue": entre uma coisa e outra estão a Meta, o
 * WhatsApp e o número da pessoa. Sem este selo, um disparo em que metade
 * ficou segurada parece um disparo inteiro — e foi assim que 44 "enviados"
 * viraram 3 entregues sem ninguém ter onde olhar.
 */
export function seloDoEnvio(envio) {
  if (!envio) return null;
  const s = SITUACAO[envio.situacao] ?? SITUACAO.na_fila;
  const texto = {
    na_fila: "na fila",
    aceito: `aceita ${horaCurta(envio.enviado_em)} · aguardando`,
    entregue: `entregue ${horaCurta(envio.entregue_em)}`,
    lido: `lida ${horaCurta(envio.lido_em)}`,
    respondeu: `respondeu ${horaCurta(envio.respondido_em)}`,
    nao_chegou: `aceita ${horaCurta(envio.enviado_em)} · não chegou`,
    falhou: envio.erro ? `falhou: ${envio.erro.slice(0, 60)}` : "falhou",
  }[envio.situacao] ?? "na fila";
  const selo = etiqueta(texto.trim(), s.classe);
  selo.title = envio.situacao === "falhou" && envio.erro ? envio.erro : s.dica;
  return selo;
}

/** Quantos em cada degrau. `situacaoDe` diz o degrau de cada item. */
export function contarSituacoes(itens, situacaoDe) {
  const contagem = {};
  for (const item of itens) {
    const s = situacaoDe(item);
    contagem[s] = (contagem[s] ?? 0) + 1;
  }
  return contagem;
}

/**
 * Os números do quadro, um por degrau, e cada um é um filtro.
 *
 * Só aparecem os degraus com alguém: uma fileira de zeros diz menos que uma
 * fileira curta. O primeiro é o total e desliga o filtro. `aoEscolher`
 * recebe a chave escolhida ("" = todos).
 */
export function tilesDeSituacao({ contagem, total, rotuloDoTotal = "No período", dicaDoTotal = "Todo mundo. Clique para ver todos.", ativa = "", aoEscolher }) {
  const area = el("div", { classe: "quadro-envios" });
  const tile = (chave, nome, n, dica, tom) => {
    const estaAtiva = ativa === chave;
    return el("button", {
      classe: `quadro-tile ${estaAtiva ? "quadro-tile-ativa" : ""}`.trim(),
      type: "button",
      title: dica,
      "data-tom": tom || null,
      onclick: () => aoEscolher?.(estaAtiva ? "" : chave),
    }, [
      el("span", { classe: "quadro-numero", texto: String(n) }),
      el("span", { classe: "quadro-rotulo", texto: nome }),
    ]);
  };
  area.append(tile("", rotuloDoTotal, total, dicaDoTotal, ""));
  for (const [id, nome, , tom, dica] of SITUACOES) {
    const n = contagem[id] ?? 0;
    if (n || id === ativa) area.append(tile(id, nome, n, dica, tom));
  }
  return area;
}
