import { api, del, get, post } from "../api.js";
import { avisar, el, limpar, vazio } from "../ui.js";

const DIAS = [
  ["seg", "Segunda"],
  ["ter", "Terça"],
  ["qua", "Quarta"],
  ["qui", "Quinta"],
  ["sex", "Sexta"],
  ["sab", "Sábado"],
  ["dom", "Domingo"],
];

/**
 * Dados da empresa: cadastro, horários e base de conhecimento.
 *
 * Tudo aqui alimenta o agente na hora — ele consulta estes campos antes de
 * responder qualquer pergunta factual sobre a casa.
 */
export async function empresa(raiz, ctx) {
  const dados = await get(`/v1/venues/${ctx.venue}`);

  const campos = {
    name: el("input", { value: dados.name ?? "", required: true }),
    description: el("input", {
      value: dados.description ?? "",
      placeholder: "Bar e restaurante com música ao vivo",
    }),
    address: el("input", {
      value: dados.address ?? "",
      placeholder: "Rua Exemplo, 123 — Centro, Cuiabá-MT",
    }),
    phone: el("input", { value: dados.phone ?? "", placeholder: "(65) 3333-0000" }),
    whatsapp: el("input", { value: dados.whatsapp ?? "", placeholder: "(65) 99999-0000" }),
    email: el("input", {
      value: dados.email ?? "",
      type: "email",
      placeholder: "contato@casa.com.br",
    }),
    capacity: el("input", {
      value: dados.capacity ?? "",
      type: "number",
      min: "1",
      placeholder: "120",
    }),
  };

  const horarios = {};
  for (const [chave] of DIAS) {
    horarios[chave] = el("input", {
      value: dados.opening_hours?.[chave] ?? "",
      placeholder: 'Ex.: 18h às 00h — vazio = "fechado"',
    });
  }

  const btnSalvar = el("button", {
    classe: "btn btn-primario",
    type: "submit",
    texto: "Salvar dados da empresa",
  });

  const form = el("form", { classe: "cartao", onsubmit: salvar }, [
    el("h3", { texto: "Cadastro" }),
    el("div", { classe: "grade", style: "margin-top:12px" }, [
      campo("Nome", campos.name),
      campo("Telefone", campos.phone),
      campo("WhatsApp", campos.whatsapp),
      campo("E-mail", campos.email),
      campo("Capacidade (lugares)", campos.capacity),
      el("div", { classe: "campo campo-largo" }, [
        el("label", { texto: "Endereço" }),
        campos.address,
      ]),
      el("div", { classe: "campo campo-largo" }, [
        el("label", { texto: "Descrição curta" }),
        campos.description,
      ]),
    ]),

    el("h3", { texto: "Dias e horários de funcionamento", style: "margin-top:18px" }),
    el("p", {
      classe: "muted",
      texto: 'Texto livre por dia: "18h às 00h", "18h até o último cliente". Vazio significa fechado.',
    }),
    el(
      "div",
      { classe: "grade", style: "margin-top:8px" },
      DIAS.map(([chave, nome]) => campo(nome, horarios[chave])),
    ),

    el("div", { style: "margin-top:14px" }, [btnSalvar]),
  ]);

  const listaInfos = el("div", { classe: "lista" });
  const infoTopico = el("input", { placeholder: "Tópico — ex.: Estacionamento" });
  const infoConteudo = el("textarea", {
    rows: 3,
    placeholder: "Ex.: Estacionamento próprio gratuito na lateral, com manobrista sexta e sábado.",
  });
  const btnInfo = el("button", {
    classe: "btn btn-primario btn-peq",
    type: "button",
    texto: "Salvar informação",
    onclick: salvarInfo,
  });

  raiz.append(
    el("div", { classe: "pilha" }, [
      form,
      el("section", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h3", { texto: "Informações da casa" }),
            el("p", {
              classe: "muted",
              texto:
                "Estacionamento, wi-fi, formas de pagamento, pets, acessibilidade… O agente responde com base nisto. Repetir um tópico atualiza o conteúdo.",
            }),
          ]),
        ]),
        el("div", { classe: "campo" }, [infoTopico, infoConteudo, el("div", {}, [btnInfo])]),
        listaInfos,
      ]),
    ]),
  );

  await carregarInfos();

  async function salvar(e) {
    e.preventDefault();
    btnSalvar.disabled = true;

    const opening_hours = {};
    for (const [chave] of DIAS) {
      if (horarios[chave].value.trim()) opening_hours[chave] = horarios[chave].value.trim();
    }

    try {
      await api(`/v1/venues/${ctx.venue}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: campos.name.value.trim(),
          description: campos.description.value.trim() || null,
          address: campos.address.value.trim() || null,
          phone: campos.phone.value.trim() || null,
          whatsapp: campos.whatsapp.value.trim() || null,
          email: campos.email.value.trim() || null,
          capacity: campos.capacity.value ? Number(campos.capacity.value) : null,
          opening_hours,
        }),
      });
      avisar("Dados salvos. O agente já responde com as informações novas.", "ok");
    } catch (err) {
      avisar(err.message, "erro");
    } finally {
      btnSalvar.disabled = false;
    }
  }

  async function carregarInfos() {
    limpar(listaInfos);
    const infos = await get(`/v1/venues/${ctx.venue}/info`);
    if (infos.length === 0) {
      listaInfos.append(vazio("Nenhuma informação cadastrada"));
      return;
    }
    for (const i of infos) {
      listaInfos.append(
        el("article", { classe: "cartao" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", { style: "min-width:0" }, [
              el("h3", { texto: i.topic }),
              el("p", { classe: "muted", texto: i.content }),
            ]),
            el("div", { style: "display:flex;gap:6px" }, [
              el("button", {
                classe: "btn btn-peq",
                type: "button",
                texto: "Editar",
                onclick: () => {
                  infoTopico.value = i.topic;
                  infoConteudo.value = i.content;
                  infoTopico.scrollIntoView({ behavior: "smooth", block: "center" });
                  infoConteudo.focus();
                },
              }),
              el("button", {
                classe: "btn btn-perigo btn-peq",
                type: "button",
                texto: "Remover",
                onclick: async (e) => {
                  e.target.disabled = true;
                  try {
                    await del(`/v1/venues/${ctx.venue}/info/${i.id}`);
                    avisar("Informação removida.", "ok");
                    await carregarInfos();
                  } catch (err) {
                    avisar(err.message, "erro");
                    e.target.disabled = false;
                  }
                },
              }),
            ]),
          ]),
        ]),
      );
    }
  }

  async function salvarInfo() {
    if (!infoTopico.value.trim() || !infoConteudo.value.trim()) {
      avisar("Preencha o tópico e o conteúdo.", "erro");
      return;
    }
    btnInfo.disabled = true;
    try {
      await post(`/v1/venues/${ctx.venue}/info`, {
        topic: infoTopico.value.trim(),
        content: infoConteudo.value.trim(),
      });
      avisar("Informação salva. O agente já usa.", "ok");
      infoTopico.value = "";
      infoConteudo.value = "";
      await carregarInfos();
    } catch (e) {
      avisar(e.message, "erro");
    } finally {
      btnInfo.disabled = false;
    }
  }

  function campo(nome, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: nome }), controle]);
  }
}
