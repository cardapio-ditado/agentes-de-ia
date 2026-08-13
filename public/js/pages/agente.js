import { executarComStream, get } from "../api.js";
import { avisar, el, limpar } from "../ui.js";

/** Conversa de teste com o agente, com a resposta chegando token a token. */
export async function agente(raiz, ctx) {
  const chat = el("div", { classe: "chat" });
  const campo = el("input", {
    placeholder: "Oi, queria reservar uma mesa pra sexta…",
    autocomplete: "off",
    required: true,
  });
  const seletor = el("select", { classe: "select" });

  const agentes = await get("/v1/agents");
  for (const a of agentes) seletor.append(el("option", { value: a.slug, texto: a.name }));
  if (agentes.length > 0) ctx.definirAgente(agentes[0].slug);
  seletor.addEventListener("change", () => ctx.definirAgente(seletor.value));

  // O backend agrupa as mensagens numa conversa pelo par (canal, external_id).
  // Um id fixo por visita mantém o contexto entre os turnos do teste sem se
  // misturar com o histórico real do WhatsApp.
  const externalId = `painel-${crypto.randomUUID()}`;

  const form = el("form", { classe: "linha-envio", onsubmit: enviar }, [
    campo,
    el("button", { classe: "btn btn-primario", type: "submit", texto: "Enviar" }),
  ]);

  raiz.append(
    el("div", { classe: "pilha" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Testar agente" }),
          el("p", {
            classe: "muted",
            texto: "Fala com o agente como se fosse um cliente. As reservas criadas aqui vão para a fila de aprovação de verdade.",
          }),
        ]),
        seletor,
      ]),
      chat,
      form,
    ]),
  );

  if (agentes.length === 0) {
    limpar(chat).append(el("p", { classe: "muted", texto: "Nenhum agente habilitado nesta organização." }));
    campo.disabled = true;
  }

  async function enviar(e) {
    e.preventDefault();
    const texto = campo.value.trim();
    if (!texto) return;
    campo.value = "";
    campo.disabled = true;

    chat.append(balao("Você", texto, "balao-user"));
    const resposta = balao("Agente", "", "balao-assistant");
    const corpo = resposta.querySelector("[data-corpo]");
    chat.append(resposta);
    chat.scrollTop = chat.scrollHeight;

    try {
      await executarComStream(
        {
          agent: seletor.value,
          input: texto,
          venue: ctx.venue,
          channel: "api",
          external_id: externalId,
        },
        (evento) => {
          if (evento.type === "text_delta") {
            corpo.textContent += evento.text ?? "";
            chat.scrollTop = chat.scrollHeight;
          }
          if (evento.type === "tool_use") {
            resposta.append(
              el("span", { classe: "balao-meta", texto: `⚙ ${evento.name ?? "ferramenta"}` }),
            );
          }
          if (evento.type === "error") avisar(evento.message ?? "Erro no agente.", "erro");
        },
      );
      if (!corpo.textContent) corpo.textContent = "(o agente não respondeu nada)";
    } catch (err) {
      corpo.textContent = "";
      resposta.remove();
      avisar(err.message, "erro");
    } finally {
      campo.disabled = false;
      campo.focus();
    }
  }

  function balao(quem, texto, classe) {
    return el("div", { classe: `balao ${classe}` }, [
      el("span", { classe: "balao-meta", texto: quem }),
      el("span", { "data-corpo": "", texto }),
    ]);
  }
}
