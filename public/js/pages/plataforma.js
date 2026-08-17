import { get } from "../api.js";
import { el, ICONES, indicador, numero, vazio } from "../ui.js";

/**
 * Visão geral da plataforma — a tela que responde "como vai o negócio?".
 *
 * Separada do painel do cliente de propósito: são perguntas diferentes. O dono
 * do restaurante quer saber quantas reservas entraram hoje; a equipe Brasa
 * Food quer saber quanto entra por mês, quanto custa entregar e quem está
 * prestes a estourar o plano.
 */

function dinheiro(valor) {
  return (valor ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

const NOMES_DE_PLANO = {
  essencial: "Essencial",
  profissional: "Profissional",
  casa_cheia: "Casa Cheia",
  cortesia: "Cortesia",
  "sem plano": "Sem plano",
};

export async function plataforma(raiz) {
  raiz.append(el("p", { classe: "muted", texto: "Somando a carteira…" }));

  let r;
  try {
    r = await get("/v1/admin/resumo");
  } catch (e) {
    raiz.replaceChildren();
    return void raiz.append(vazio("Área restrita", e.message ?? "Esta área é da equipe Brasa Food."));
  }
  raiz.replaceChildren();

  const pilha = el("div", { classe: "pilha" });

  pilha.append(
    el("div", { classe: "grade" }, [
      indicador({
        rotulo: "Receita mensal",
        valor: dinheiro(r.receita_mensal),
        nota: `${numero(r.clientes_ativos)} cliente(s) em dia`,
        iconePath: ICONES.painel,
        destaque: true,
      }),
      indicador({
        rotulo: "Margem bruta",
        valor: dinheiro(r.margem_bruta),
        // A margem é o número que decide se o preço está certo. Abaixo de 70%
        // um SaaS não se paga depois de somar suporte e infraestrutura.
        nota:
          r.receita_mensal > 0
            ? `${Math.round((r.margem_bruta / r.receita_mensal) * 100)}% da receita`
            : "sem receita ainda",
        iconePath: ICONES.raio,
      }),
      indicador({
        rotulo: "Custo de IA",
        valor: dinheiro(r.custo_ia_estimado),
        nota: `${numero(r.pontos_usados)} pontos consumidos`,
        iconePath: ICONES.agente,
      }),
      indicador({
        rotulo: "Clientes",
        valor: numero(r.clientes),
        nota:
          r.clientes_em_atraso > 0
            ? `${r.clientes_em_atraso} em atraso`
            : "nenhum em atraso",
        iconePath: ICONES.pessoa,
        destaque: r.clientes_em_atraso > 0,
      }),
    ]),
  );

  if (r.clientes === 0) {
    pilha.append(
      vazio(
        "Nenhum cliente ainda",
        "Cadastre o primeiro em Clientes — leva menos de dois minutos.",
      ),
    );
    raiz.append(pilha);
    return;
  }

  // ---- Consumo de pontos ----
  // O que importa aqui é a folga: pontos contratados muito acima do usado
  // significa plano com margem sobrando; perto do limite significa cliente
  // que vai reclamar ou comprar extra.
  const usoPercentual =
    r.pontos_contratados > 0 ? Math.round((r.pontos_usados / r.pontos_contratados) * 100) : 0;

  const barra = el("div", { classe: "pontos-barra" }, [
    el("div", { classe: "pontos-preenchido" }),
  ]);
  barra.firstChild.style.width = `${Math.min(100, usoPercentual)}%`;

  pilha.append(
    el("section", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Consumo da carteira" }),
          el("p", {
            classe: "muted",
            texto: "Quanto do que você vendeu está sendo realmente usado.",
          }),
        ]),
        el("strong", { texto: `${usoPercentual}%` }),
      ]),
      barra,
      el("div", { style: "margin-top:12px" }, [
        linha("Pontos contratados", numero(r.pontos_contratados)),
        linha("Pontos consumidos", numero(r.pontos_usados)),
        linha("Folga", numero(r.pontos_contratados - r.pontos_usados)),
      ]),
      el("p", {
        classe: "muted",
        texto:
          usoPercentual < 40
            ? "Consumo baixo: há espaço para oferecer motores melhores sem estourar os planos."
            : "Consumo alto: acompanhe quem está perto do limite antes que o agente pause.",
      }),
    ]),
  );

  // ---- Receita por plano ----
  pilha.append(
    el("section", { classe: "cartao" }, [
      el("h2", { texto: "Receita por plano" }),
      el(
        "div",
        { style: "margin-top:10px" },
        r.planos.map((p) =>
          linha(
            `${NOMES_DE_PLANO[p.plano] ?? p.plano} · ${p.clientes} cliente(s)`,
            dinheiro(p.receita),
          ),
        ),
      ),
    ]),
  );

  // ---- Quem nunca entrou ----
  // Cliente que paga e nunca acessou é cancelamento em formação. É o alerta
  // mais barato de agir e o mais caro de ignorar.
  if (r.nunca_acessaram > 0) {
    pilha.append(
      el("section", { classe: "cartao alerta" }, [
        el("h2", { texto: `${r.nunca_acessaram} cliente(s) nunca acessaram o painel` }),
        el("p", {
          classe: "muted",
          texto:
            "Quem não entra não vê valor e cancela no segundo mês. Vale uma ligação antes de virar problema — a lista está em Clientes.",
        }),
      ]),
    );
  }

  raiz.append(pilha);
}

function linha(rotulo, valor) {
  return el("div", { classe: "linha-dado" }, [
    el("span", { texto: rotulo }),
    el("strong", { texto: valor }),
  ]);
}
