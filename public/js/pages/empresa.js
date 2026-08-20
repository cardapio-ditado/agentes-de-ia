import { api, get } from "../api.js";
import { avisar, el } from "../ui.js";

/**
 * A casa: a identidade do estabelecimento.
 *
 * Só o que TODO módulo usa, tenha o cliente comprado o que tiver comprado —
 * por isso mora em Ajustes, e não dentro de um produto.
 *
 * O fuso horário parece detalhe e é o campo mais importante da tela: é ele
 * que faz o checklist disparar às 8h de Cuiabá e não de Londres
 * (`estaNaHora`, em checklists.ts), a promoção do cardápio valer no dia
 * certo e o consumo do CMV cair no dia da semana certo. Um cliente que só
 * comprou Checklist precisa deste campo — e é justamente por isso que ele
 * não pode morar dentro do módulo Agentes de IA.
 *
 * Endereço, horários, capacidade e a base de conhecimento NÃO estão aqui:
 * quem lê aquilo é só o agente (`tools/restaurante.ts`), então vive na tela
 * "O que o agente sabe", dentro do módulo dele.
 */

/**
 * Fusos do Brasil, do mais usado ao menos.
 *
 * Lista fixa em vez de campo livre: "America/Cuiaba" digitado errado vira
 * disparo em hora errada, e o erro não aparece na tela — aparece semanas
 * depois, no funcionário reclamando que o checklist chegou de madrugada.
 */
const FUSOS = [
  ["America/Sao_Paulo", "Brasília (SP, RJ, MG, PR, SC, RS, GO, DF, ES, BA…)"],
  ["America/Cuiaba", "Cuiabá (MT)"],
  ["America/Campo_Grande", "Campo Grande (MS)"],
  ["America/Manaus", "Manaus (AM, RO, RR)"],
  ["America/Belem", "Belém (PA, AP)"],
  ["America/Fortaleza", "Fortaleza (CE, PI, MA, RN, PB, PE, AL, SE)"],
  ["America/Porto_Velho", "Porto Velho (RO)"],
  ["America/Rio_Branco", "Rio Branco (AC)"],
  ["America/Noronha", "Fernando de Noronha"],
];

export async function empresa(raiz, ctx) {
  const dados = await get(`/v1/venues/${ctx.venue}`);

  const campos = {
    name: el("input", { value: dados.name ?? "", required: true }),
    phone: el("input", { value: dados.phone ?? "", placeholder: "(65) 3333-0000" }),
    whatsapp: el("input", { value: dados.whatsapp ?? "", placeholder: "(65) 99999-0000" }),
    email: el("input", {
      value: dados.email ?? "",
      type: "email",
      placeholder: "contato@casa.com.br",
    }),
    timezone: el(
      "select",
      { classe: "select" },
      FUSOS.map(([valor, rotulo]) =>
        el("option", { value: valor, texto: rotulo, selected: dados.timezone === valor }),
      ),
    ),
  };

  // Fuso fora da lista (cadastro antigo ou casa fora do Brasil): preserva em
  // vez de trocar em silêncio pelo primeiro da lista ao salvar.
  if (dados.timezone && !FUSOS.some(([v]) => v === dados.timezone)) {
    campos.timezone.prepend(
      el("option", { value: dados.timezone, texto: dados.timezone, selected: true }),
    );
  }

  const btnSalvar = el("button", {
    classe: "btn btn-primario",
    type: "submit",
    texto: "Salvar",
  });

  raiz.append(
    el("div", { classe: "pilha" }, [
      el("form", { classe: "cartao", onsubmit: salvar }, [
        el("h3", { texto: "A casa" }),
        el("p", {
          classe: "muted",
          texto: "A identidade do estabelecimento. Todos os módulos usam estes dados.",
        }),
        el("div", { classe: "grade", style: "margin-top:12px" }, [
          campo("Nome", campos.name),
          campo("Telefone", campos.phone),
          campo("WhatsApp", campos.whatsapp),
          campo("E-mail", campos.email),
          el("div", { classe: "campo campo-largo" }, [
            el("label", { texto: "Fuso horário" }),
            campos.timezone,
            el("small", {
              classe: "muted",
              texto:
                "É o relógio da casa: define a hora em que o checklist dispara, quando a promoção do cardápio vale e em que dia o consumo entra no CMV.",
            }),
          ]),
        ]),
        el("div", { style: "margin-top:14px" }, [btnSalvar]),
      ]),

      // O caminho para o resto, para quem vier procurar aqui o endereço e os
      // horários — que era onde eles moravam antes.
      el("p", {
        classe: "muted",
        texto:
          "Endereço, horários de funcionamento, capacidade e as informações que o agente responde ao cliente ficam em Agentes de IA → O que o agente sabe.",
      }),
    ]),
  );

  async function salvar(e) {
    e.preventDefault();
    btnSalvar.disabled = true;
    try {
      await api(`/v1/venues/${ctx.venue}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: campos.name.value.trim(),
          phone: campos.phone.value.trim() || null,
          whatsapp: campos.whatsapp.value.trim() || null,
          email: campos.email.value.trim() || null,
          timezone: campos.timezone.value,
        }),
      });
      avisar("Dados da casa salvos.", "ok");
    } catch (err) {
      avisar(err.message, "erro");
    } finally {
      btnSalvar.disabled = false;
    }
  }

  function campo(nome, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: nome }), controle]);
  }
}
