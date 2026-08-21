import { del, get, post } from "../api.js";
import { avisar, dataHora, desde, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Caixa de entrada: lista à esquerda, conversa à direita.
 *
 * "Assumir atendimento" silencia o agente naquela conversa — enquanto uma
 * pessoa estiver respondendo, o modelo não entra por cima.
 *
 * A tela se atualiza sozinha. Sem isso, quem está atendendo pelo painel fica
 * olhando para uma conversa parada enquanto o cliente já respondeu, e só
 * descobre saindo e voltando — que é o mesmo que não ter caixa de entrada.
 *
 * A atualização é CIRÚRGICA, e não um redesenho: redesenhar tudo a cada oito
 * segundos apagaria o que a pessoa está digitando, perderia a rolagem do
 * histórico e piscaria a lista inteira na cara de quem está lendo. Então só
 * muda o que mudou — mensagem nova entra no fim, lista só é redesenhada
 * quando alguma conversa realmente mexeu.
 */

/** De quanto em quanto tempo perguntar se chegou coisa nova. */
const INTERVALO_MS = 8000;

export async function conversas(raiz, ctx) {
  const filtros = { canal: "", status: "", humanas: false };
  let selecionada = null;

  /**
   * O retrato da lista que está na tela.
   *
   * Só redesenhar quando isto muda é o que separa "atualiza sozinha" de
   * "pisca sozinha".
   */
  let assinaturaLista = null;

  /** A conversa aberta à direita, para receber mensagem nova sem ser refeita. */
  let aberta = null;

  /** Uma sincronização por vez: rede lenta não pode empilhar requisição. */
  let sincronizando = false;

  const itens = el("div", { classe: "inbox-itens" });
  const painelThread = el("div", { classe: "thread" });

  const selCanal = el(
    "select",
    { classe: "select", onchange: (e) => ((filtros.canal = e.target.value), carregarLista()) },
    [
      el("option", { value: "", texto: "Todos os canais" }),
      el("option", { value: "whatsapp", texto: "WhatsApp" }),
      el("option", { value: "api", texto: "API / teste" }),
    ],
  );

  const selStatus = el(
    "select",
    { classe: "select", onchange: (e) => ((filtros.status = e.target.value), carregarLista()) },
    [
      el("option", { value: "", texto: "Todos os status" }),
      el("option", { value: "open", texto: "Abertas" }),
      el("option", { value: "closed", texto: "Fechadas" }),
    ],
  );

  const selQuem = el(
    "select",
    {
      classe: "select",
      onchange: (e) => ((filtros.humanas = e.target.value === "1"), carregarLista()),
    },
    [
      el("option", { value: "", texto: "Todas" }),
      el("option", { value: "1", texto: "Assumidas" }),
    ],
  );

  raiz.append(
    el("div", { classe: "inbox" }, [
      el("div", { classe: "inbox-lista" }, [
        el("div", { classe: "inbox-filtros" }, [selCanal, selStatus, selQuem]),
        itens,
      ]),
      painelThread,
    ]),
  );

  vazioThread("Escolha uma conversa", "A lista à esquerda mostra quem falou com o agente.");
  await carregarLista();

  // Aba escondida não pergunta nada: no celular, ficar batendo na API com o
  // painel em segundo plano gasta bateria e dados de quem nem está olhando.
  // Ao voltar, sincroniza na hora — é justamente o momento em que a pessoa
  // quer ver o que chegou enquanto esteve fora.
  const timer = setInterval(() => {
    if (!document.hidden) sincronizar();
  }, INTERVALO_MS);
  const aoVoltar = () => {
    if (!document.hidden) sincronizar();
  };
  document.addEventListener("visibilitychange", aoVoltar);
  ctx.aoSair(() => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", aoVoltar);
  });

  /**
   * Uma passada: a lista e, se houver, a conversa aberta.
   *
   * Falha em silêncio de propósito. Um erro de rede a cada oito segundos
   * viraria uma fila de avisos vermelhos por cima do trabalho de quem está
   * atendendo — e a próxima volta, oito segundos depois, provavelmente já
   * funciona.
   */
  async function sincronizar() {
    if (sincronizando) return;
    sincronizando = true;
    try {
      await carregarLista({ silencioso: true });
      await sincronizarAberta();
    } catch {
      /* rede oscilou: a próxima volta resolve */
    } finally {
      sincronizando = false;
    }
  }

  /**
   * Traz para a conversa aberta o que chegou depois que ela foi aberta.
   *
   * Mensagem nova é ACRESCENTADA no fim. Refazer o painel seria mais simples
   * de escrever e apagaria a resposta meio digitada — que é exatamente o que
   * a pessoa mais odiaria perder.
   */
  async function sincronizarAberta() {
    if (!aberta) return;
    const id = aberta.id;
    const c = await get(`/v1/conversations/${id}`);
    // Trocou de conversa enquanto a resposta vinha: o que chegou é de outra
    // tela e não pode ser colado nesta.
    if (!aberta || aberta.id !== id) return;

    // Assumir, devolver, encerrar ou reabrir muda os botões e o rodapé, e
    // isso o acréscimo de mensagem não resolve — só refazendo. Mas nunca por
    // cima de texto digitado: quem está escrevendo prefere um cabeçalho
    // desatualizado a uma resposta perdida.
    const estado = `${c.status}|${c.atendimento.por}`;
    if (estado !== aberta.estado && !aberta.campo.value.trim()) {
      await abrir(id);
      return;
    }

    const novas = c.mensagens.filter(
      (m) => (m.papel === "user" || m.papel === "assistant") && !aberta.ids.has(m.id),
    );
    if (novas.length === 0) return;

    // Se a pessoa subiu para reler algo, não puxar a tela para baixo à força.
    const noFim = aberta.corpo.scrollHeight - aberta.corpo.scrollTop - aberta.corpo.clientHeight < 40;
    for (const m of novas) {
      aberta.ids.add(m.id);
      aberta.corpo.append(balao(m));
    }
    if (noFim) aberta.corpo.scrollTop = aberta.corpo.scrollHeight;
  }

  /** Um balão do histórico. Mesmo desenho na abertura e na mensagem que chega. */
  function balao(m) {
    const humana = m.origem === "humano";
    const classe = m.papel === "user" ? "balao-user" : humana ? "balao-humano" : "balao-assistant";
    return el("div", { classe: `balao ${classe}`, title: dataHora(m.em) }, [
      el("span", {
        classe: "balao-meta",
        texto: m.papel === "user" ? "Cliente" : humana ? "Você" : "Agente",
      }),
      el("span", { texto: m.texto ?? "" }),
    ]);
  }

  async function carregarLista({ silencioso = false } = {}) {
    if (!silencioso) {
      limpar(itens).append(el("p", { classe: "muted", style: "padding:14px", texto: "Carregando…" }));
    }

    const busca = new URLSearchParams();
    if (filtros.canal) busca.set("canal", filtros.canal);
    if (filtros.status) busca.set("status", filtros.status);
    if (filtros.humanas) busca.set("humanas", "1");

    const lista = await get(`/v1/venues/${ctx.venue}/conversations?${busca}`);

    // O que faz a lista mudar de cara: ordem, última mensagem, quem está
    // atendendo, aberta ou fechada. Igual ao que já está na tela = não mexer,
    // senão a lista pisca e a rolagem volta ao topo a cada oito segundos.
    const assinatura = JSON.stringify(
      lista.map((c) => [c.id, c.atualizada_em, c.status, c.atendimento.por, c.ultima_mensagem?.texto ?? null]),
    );
    if (silencioso && assinatura === assinaturaLista) return;
    assinaturaLista = assinatura;

    // Lista longa: quem rolou até o fim para achar uma conversa antiga não
    // pode ser jogado de volta ao topo por uma mensagem que chegou.
    const rolagem = itens.scrollTop;
    limpar(itens);

    if (lista.length === 0) {
      itens.append(
        vazio(
          "Nenhuma conversa",
          "Quando alguém falar com o agente pelo WhatsApp ou pela aba Testar agente, aparece aqui.",
        ),
      );
      return;
    }

    for (const c of lista) {
      const nome = c.titulo || c.contato || "Sem identificação";
      // Nome E telefone quando os dois existem — identifica sem abrir.
      const rotulo = c.titulo && c.contato ? `${c.titulo} · ${c.contato}` : nome;
      const previa = c.ultima_mensagem?.texto ?? "—";

      itens.append(
        el(
          "button",
          {
            classe: "conversa-item",
            type: "button",
            "aria-selected": String(c.id === selecionada),
            // Marca a conversa na linha para o realce poder ser aplicado ao
            // clicar, sem depender de a lista ser recarregada primeiro.
            "data-conversa": c.id,
            onclick: () => abrir(c.id),
          },
          [
            el("div", { classe: "conversa-linha" }, [
              el("span", { classe: "conversa-nome", texto: rotulo }),
              c.atendimento.por === "humano" ? etiqueta("você", "etiqueta-alerta") : null,
              el("span", { classe: "conversa-hora", texto: desde(c.atualizada_em) }),
            ]),
            el("div", { classe: "conversa-previa", texto: previa }),
            el("div", { classe: "conversa-linha" }, [
              etiqueta(c.canal === "whatsapp" ? "WhatsApp" : c.canal),
              c.status !== "open" ? etiqueta("fechada") : null,
            ]),
          ],
        ),
      );
    }

    itens.scrollTop = rolagem;
  }

  async function abrir(id) {
    selecionada = id;
    for (const b of itens.querySelectorAll(".conversa-item")) {
      b.setAttribute("aria-selected", String(b.dataset.conversa === id));
    }
    // "Abrindo…" só quando não há nada ali: reabrir a mesma conversa (depois
    // de assumir, por exemplo) piscaria o histórico inteiro à toa.
    if (aberta?.id !== id) {
      limpar(painelThread).append(el("p", { classe: "muted", style: "padding:16px", texto: "Abrindo…" }));
    }

    const c = await get(`/v1/conversations/${id}`);
    // Clicaram em outra conversa enquanto esta vinha da rede. Sem esta linha,
    // a resposta atrasada pintaria a conversa antiga por cima da que a pessoa
    // acabou de abrir — e ela responderia ao cliente errado.
    if (selecionada !== id) return;

    const assumida = c.atendimento.por === "humano";

    const visiveis = c.mensagens.filter((m) => m.papel === "user" || m.papel === "assistant");
    const corpo = el("div", { classe: "thread-corpo" }, visiveis.map(balao));

    const campo = el("textarea", {
      placeholder: assumida
        ? "Escreva sua resposta…"
        : "Assuma o atendimento para responder manualmente.",
      disabled: !assumida,
    });

    const btnEnviar = el("button", {
      classe: "btn btn-primario",
      type: "button",
      texto: "Enviar",
      disabled: !assumida,
      onclick: enviar,
    });

    const btnAssumir = el("button", {
      classe: assumida ? "btn btn-peq" : "btn btn-primario btn-peq",
      type: "button",
      texto: assumida ? "Devolver ao agente" : "Assumir atendimento",
      onclick: alternar,
    });

    const encerrada = c.status === "closed";
    const btnEncerrar = el("button", {
      classe: encerrada ? "btn btn-peq" : "btn btn-perigo btn-peq",
      type: "button",
      texto: encerrada ? "Reabrir" : "Encerrar",
      title: encerrada
        ? "Volta a aparecer entre as abertas."
        : "Marca como resolvida. Se o cliente escrever de novo, reabre sozinha.",
      onclick: encerrar,
    });

    const btnApagar = el("button", {
      classe: "btn btn-perigo btn-peq",
      type: "button",
      texto: "Apagar",
      title: "Apaga a conversa e o histórico para sempre. Reservas já feitas não são afetadas.",
      onclick: apagar,
    });

    limpar(painelThread).append(
      el("div", { classe: "thread-topo" }, [
        el("div", { style: "min-width:0;flex:1" }, [
          el("h2", { texto: c.titulo || c.contato || "Conversa" }),
          el("p", {
            classe: "muted",
            // Nome no título, telefone aqui — os dois visíveis quando existem.
            texto: [c.titulo && c.contato ? c.contato : null, c.canal, `${c.mensagens.length} mensagens`]
              .filter(Boolean)
              .join(" · "),
          }),
        ]),
        encerrada
          ? etiqueta("encerrada")
          : assumida
            ? etiqueta("você está respondendo", "etiqueta-alerta")
            : etiqueta("agente ativo", "etiqueta-ok"),
        btnAssumir,
        btnEncerrar,
        btnApagar,
      ]),
      corpo,
      el("div", { classe: "thread-rodape" }, [
        el("div", { classe: "linha-envio" }, [campo, btnEnviar]),
        !assumida
          ? el("p", {
              classe: "muted",
              texto:
                "Enquanto o agente responde, uma mensagem sua sairia junto com a dele e o cliente veria duas vozes.",
            })
          : null,
      ]),
    );

    corpo.scrollTop = corpo.scrollHeight;

    // O que a sincronização precisa saber para acrescentar sem refazer: onde
    // colar, o que já está colado, e o que faria os botões mudarem.
    aberta = {
      id,
      corpo,
      campo,
      ids: new Set(visiveis.map((m) => m.id)),
      estado: `${c.status}|${c.atendimento.por}`,
    };

    async function apagar() {
      const nome = c.titulo || c.contato || "esta conversa";
      // confirm nativo basta: apagar histórico é raro e irreversível — o
      // atrito extra aqui é proteção, não burocracia.
      if (!window.confirm(`Apagar ${nome} para sempre? O histórico não volta. Reservas já registradas continuam existindo.`)) {
        return;
      }
      btnApagar.disabled = true;
      try {
        await del(`/v1/conversations/${id}`);
        avisar("Conversa apagada. Se o cliente escrever de novo, começa do zero.", "ok");
        selecionada = null;
        aberta = null;
        vazioThread("Escolha uma conversa", "A lista à esquerda mostra quem falou com o agente.");
        await carregarLista();
      } catch (e) {
        avisar(e.message, "erro");
        btnApagar.disabled = false;
      }
    }

    async function encerrar() {
      btnEncerrar.disabled = true;
      try {
        await post(`/v1/conversations/${id}/close`, { reabrir: encerrada });
        avisar(
          encerrada ? "Conversa reaberta." : "Conversa encerrada e devolvida ao agente.",
          "ok",
        );
        await carregarLista();
        await abrir(id);
      } catch (e) {
        avisar(e.message, "erro");
        btnEncerrar.disabled = false;
      }
    }

    async function alternar() {
      btnAssumir.disabled = true;
      try {
        await post(`/v1/conversations/${id}/takeover`, { devolver: assumida });
        avisar(assumida ? "Agente reassumiu a conversa." : "Atendimento assumido.", "ok");
        await carregarLista();
        await abrir(id);
      } catch (e) {
        avisar(e.message, "erro");
        btnAssumir.disabled = false;
      }
    }

    async function enviar() {
      const texto = campo.value.trim();
      if (!texto) return;
      btnEnviar.disabled = true;
      try {
        await post(`/v1/conversations/${id}/messages`, { texto });
        campo.value = "";
        await abrir(id);
        await carregarLista();
      } catch (e) {
        avisar(e.message, "erro");
      } finally {
        btnEnviar.disabled = false;
      }
    }
  }

  function vazioThread(titulo, detalhe) {
    limpar(painelThread).append(el("div", { style: "margin:auto" }, [vazio(titulo, detalhe)]));
  }
}
