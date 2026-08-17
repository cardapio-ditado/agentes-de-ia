/**
 * Medidor de pontos — o componente que responde "quanto ainda tenho?".
 *
 * Vive em dois lugares: no Painel, como cartão de saldo, e no editor de
 * agentes, como aviso antes de trocar de motor. É o mesmo dado nos dois, então
 * é o mesmo módulo — o cliente não pode ver saldos diferentes em telas
 * diferentes.
 */

import { get } from "./api.js";
import { el, numero } from "./ui.js";

/** Cache curto: Painel e editor de agentes pedem o extrato quase junto. */
const cache = new Map();

export async function extrato(venue, { recarregar = false } = {}) {
  if (!recarregar && cache.has(venue)) {
    const { quando, dados } = cache.get(venue);
    if (Date.now() - quando < 30_000) return dados;
  }
  const dados = await get(`/v1/venues/${venue}/pontos`);
  cache.set(venue, { quando: Date.now(), dados });
  return dados;
}

export function invalidar(venue) {
  cache.delete(venue);
}

const NOMES_DE_PLANO = {
  essencial: "Essencial",
  profissional: "Profissional",
  casa_cheia: "Casa Cheia",
  cortesia: "Cortesia",
};

/**
 * Verde / âmbar / vermelho.
 *
 * Não basta olhar o saldo: 74% sobrando parece confortável, mas se o ritmo
 * projeta estouro antes de renovar, é problema. Cor e frase precisam contar a
 * MESMA história — cartão verde com texto de alerta é pior que nenhum aviso.
 */
function faixa(e) {
  if (e.restantes === 0) return "esgotado";
  const sobra = e.total > 0 ? e.restantes / e.total : 0;
  const projetaEstouro = temRitmo(e) && e.projecao_ciclo > e.total;
  const diasAte = temRitmo(e) ? Math.floor(e.restantes / e.ritmo_diario) : null;

  if (sobra <= 0.15 || (projetaEstouro && diasAte !== null && diasAte <= 3)) return "critico";
  if (sobra <= 0.35 || projetaEstouro) return "atencao";
  return "ok";
}

/** Projeção só vale depois de alguns dias de uso — antes disso é chute. */
function temRitmo(e) {
  return e.ciclo.dias_corridos >= 3 && e.ritmo_diario > 0;
}

/**
 * Frase honesta sobre o fim do ciclo.
 *
 * Projeção só vale depois de alguns dias: dizer "vai acabar dia 9" com meio dia
 * de uso é chute com cara de dado. Antes disso o medidor só mostra o saldo.
 */
function leitura(e) {
  if (e.restantes === 0) {
    return "Pontos esgotados neste ciclo. Renovam em " + diaCurto(e.ciclo.fim) + ".";
  }
  if (!temRitmo(e)) {
    return `Renova em ${diaCurto(e.ciclo.fim)} · ${e.ciclo.dias_restantes} dias.`;
  }
  if (e.projecao_ciclo > e.total) {
    const diasAte = Math.floor(e.restantes / e.ritmo_diario);
    return `No ritmo atual, acabam em ~${diasAte} ${diasAte === 1 ? "dia" : "dias"} — antes de renovar.`;
  }
  const sobra = e.total - e.projecao_ciclo;
  return `No ritmo atual sobram ~${numero(sobra)} pontos no fim do ciclo.`;
}

function diaCurto(iso) {
  const [, mes, dia] = String(iso).split("-");
  return `${dia}/${mes}`;
}

/** Cartão de saldo do Painel. */
export function cartaoDeSaldo(e) {
  const estado = faixa(e);

  const barra = el("div", { classe: "pontos-barra" }, [
    el("div", { classe: `pontos-preenchido pontos-${estado}` }),
  ]);
  // Zero consumido é barra zerada: um filete mínimo daria a impressão de que
  // algo já foi gasto no primeiro dia do plano.
  barra.firstChild.style.width = e.usados === 0 ? "0%" : `${Math.max(2, e.percentual)}%`;

  const trilhas = el("div", { classe: "pontos-motores" });
  for (const m of e.por_motor) {
    trilhas.append(
      el("div", { classe: "pontos-motor" }, [
        el("span", { classe: "pontos-motor-nome", texto: m.motor }),
        el("span", {
          classe: "pontos-motor-detalhe",
          texto: `${numero(m.mensagens)} respostas · ${numero(m.pontos)} pts`,
        }),
      ]),
    );
  }
  if (e.por_motor.length === 0) {
    trilhas.append(el("p", { classe: "muted", texto: "Nenhuma resposta neste ciclo ainda." }));
  }

  return el("section", { classe: `cartao pontos-cartao pontos-borda-${estado}` }, [
    el("div", { classe: "pontos-topo" }, [
      el("div", {}, [
        el("h3", { texto: "Pontos do plano" }),
        el("p", {
          classe: "muted",
          texto: `Plano ${NOMES_DE_PLANO[e.plano] ?? e.plano} · ${numero(e.total)} pontos por ciclo`,
        }),
      ]),
      el("div", { classe: "pontos-numero" }, [
        el("strong", { texto: numero(e.restantes) }),
        el("small", { texto: "restantes" }),
      ]),
    ]),
    barra,
    el("p", { classe: `pontos-leitura pontos-texto-${estado}`, texto: leitura(e) }),
    trilhas,
  ]);
}

/**
 * Aviso de duração ao escolher o motor.
 *
 * É o momento em que o cliente decide gastar 5× mais rápido. Ele merece saber
 * disso ANTES de salvar, com o número dele — não depois, quando os pontos
 * acabarem no dia 18.
 */
export function avisoDeMotor(e, modelo) {
  const d = e.duracao_por_motor.find((x) => x.modelo === modelo);
  if (!d) return el("p", { classe: "pontos-aviso", texto: "" });

  const partes = [
    `Pesa ${d.peso} ${d.peso === 1 ? "ponto" : "pontos"} por resposta.`,
    `Com ${numero(e.restantes)} pontos: ~${numero(d.respostas)} respostas.`,
  ];
  if (d.dias !== null) {
    partes.push(
      d.cobreOCiclo
        ? `Dura os ${e.ciclo.dias_restantes} dias que faltam.`
        : `Duram ~${d.dias} ${d.dias === 1 ? "dia" : "dias"} — o ciclo fecha em ${e.ciclo.dias_restantes}.`,
    );
  }

  const grave = d.dias !== null && !d.cobreOCiclo;
  return el("p", {
    classe: `pontos-aviso ${grave ? "pontos-aviso-grave" : ""}`,
    texto: partes.join(" "),
  });
}

/**
 * Pop-up de fim de pontos.
 *
 * Aparece na cortesia e depois de travar. Some ao ser fechado, mas volta no
 * dia seguinte: um aviso que se cala para sempre no primeiro clique não avisa
 * nada — e este é o único momento em que o cliente descobre que o atendimento
 * automático está por um fio.
 */
const GUARDA_AVISO = "brasa.pontos.avisado";

export function avisarSeAcabou(e) {
  if (!e || (e.estado !== "cortesia" && e.estado !== "bloqueado")) return;

  const hoje = new Date().toISOString().slice(0, 10);
  const marca = `${e.estado}:${hoje}`;
  // Travado avisa sempre; na cortesia, uma vez por dia já incomoda o bastante.
  if (e.estado === "cortesia" && localStorage.getItem(GUARDA_AVISO) === marca) return;
  localStorage.setItem(GUARDA_AVISO, marca);

  document.querySelector(".pontos-modal-fundo")?.remove();

  const bloqueado = e.estado === "bloqueado";
  // Em horas, sempre: a cortesia dura no máximo 48h, e "30 horas" comunica
  // urgência de um jeito que "1 dia" arredondado não comunica.
  const horas = e.horas_de_cortesia ?? 0;
  const quanto = `${horas} ${horas === 1 ? "hora" : "horas"}`;

  const fundo = el("div", { classe: "pontos-modal-fundo" });
  const fechar = () => fundo.remove();

  const caixa = el("div", { classe: `pontos-modal ${bloqueado ? "pontos-modal-grave" : ""}` }, [
    el("div", { classe: "pontos-modal-icone", texto: bloqueado ? "🔒" : "🔥" }),
    el("h2", { texto: bloqueado ? "Agente pausado" : "Seus pontos acabaram" }),
    el("p", {
      texto: bloqueado
        ? "O período de cortesia terminou e o agente parou de responder sozinho. As mensagens que chegarem continuam aparecendo em Conversas para a equipe atender na mão."
        : `O agente continua atendendo por mais ${quanto}, no motor mais econômico (Haiku), para o WhatsApp não ficar mudo. Depois disso ele pausa até a renovação.`,
    }),
    el("div", { classe: "pontos-modal-dados" }, [
      el("div", {}, [
        el("strong", { texto: numero(e.usados) }),
        el("small", { texto: `de ${numero(e.total)} pontos` }),
      ]),
      el("div", {}, [
        el("strong", { texto: diaCurto(e.ciclo.fim) }),
        el("small", { texto: "renovação automática" }),
      ]),
    ]),
    el("p", { classe: "pontos-modal-nota", texto: "Fale com o Brasa Food para comprar pontos extras e religar agora." }),
    el("button", {
      classe: "btn btn-primario",
      type: "button",
      texto: "Entendi",
      onclick: fechar,
    }),
  ]);

  fundo.addEventListener("click", (ev) => {
    if (ev.target === fundo) fechar();
  });
  document.addEventListener("keydown", function aoEsc(ev) {
    if (ev.key === "Escape") {
      fechar();
      document.removeEventListener("keydown", aoEsc);
    }
  });

  fundo.append(caixa);
  document.body.append(fundo);
}
