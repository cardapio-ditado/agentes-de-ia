import { del, get, post } from "../api.js";
import { avisar, campoDeBusca, dataHora, desde, el, esqueleto, etiqueta, limpar, vazio } from "../ui.js";

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

/** O canal como a casa fala dele, e não como o banco guarda. */
const CANAIS = { whatsapp: "WhatsApp", instagram: "Instagram", api: "Teste", painel: "Painel", cardapio: "Cardápio", delivery: "Delivery" };
const nomeDoCanal = (canal) => CANAIS[canal] ?? canal;

/**
 * As três filas. A pergunta de quem abre esta tela é "alguém está esperando
 * por mim?" — e ela não tinha resposta: eram quatro seletores, nenhum deles
 * sobre quem ficou sem retorno.
 */
const FILAS = [
  { id: "", rotulo: "Todas" },
  { id: "esperando", rotulo: "Esperando resposta", vazio: ["Ninguém esperando resposta", "Toda conversa recente terminou com uma resposta da casa."] },
  { id: "equipe", rotulo: "Com a equipe", vazio: ["Nenhuma conversa com a equipe", "O atendente virtual está respondendo todas."] },
];

/** O atendente parou sozinho nesta conversa (rajada ou mensagem repetida)? */
const motivoDoFreio = (atendimento) => {
  const por = atendimento?.assumido_por ?? "";
  return por.startsWith("freio automático") ? por.split(":").slice(1).join(":").trim() || "movimento fora do comum" : null;
};

export async function conversas(raiz, ctx) {
  const filtros = { fila: "", busca: "", canal: "", status: "", agente: "" };
  /** Quantas há em cada fila, para os botões. */
  const contagem = { esperando: null, equipe: null };
  /** A marca da última lista recebida: o servidor diz "nada mudou" por ela. */
  let marca = null;
  /** Com mais de um atendente virtual, a linha diz qual respondeu. */
  let variosAtendentes = false;
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
    { classe: "select", "aria-label": "Canal", onchange: (e) => ((filtros.canal = e.target.value), aoFiltrar()) },
    [
      el("option", { value: "", texto: "Todos os canais" }),
      el("option", { value: "whatsapp", texto: "WhatsApp" }),
      el("option", { value: "instagram", texto: "Instagram" }),
      el("option", { value: "api", texto: "Teste" }),
    ],
  );

  const selStatus = el(
    "select",
    { classe: "select", "aria-label": "Situação da conversa", onchange: (e) => ((filtros.status = e.target.value), aoFiltrar()) },
    [
      el("option", { value: "", texto: "Abertas e encerradas" }),
      el("option", { value: "open", texto: "Só as abertas" }),
      el("option", { value: "closed", texto: "Só as encerradas" }),
    ],
  );

  // Um seletor por agente: com dois números (o do conector e o oficial),
  // cada um tem o seu agente, e "o que a recepcionista respondeu hoje" é
  // uma pergunta diferente de "o que a Fernanda respondeu".
  const selAgente = el(
    "select",
    { classe: "select", "aria-label": "Atendente virtual", hidden: true, onchange: (e) => ((filtros.agente = e.target.value), aoFiltrar()) },
    [el("option", { value: "", texto: "Todos os atendentes virtuais" })],
  );
  get("/v1/agents?all=1")
    .then((agentes) => {
      for (const a of agentes) selAgente.append(el("option", { value: a.slug, texto: a.name }));
      // Com um atendente só, o seletor e a etiqueta em cada linha são ruído.
      variosAtendentes = agentes.length > 1;
      selAgente.hidden = !variosAtendentes;
    })
    .catch(() => undefined);

  const busca = campoDeBusca({
    rotulo: "Buscar conversa por nome ou telefone",
    placeholder: "Buscar por nome ou telefone…",
    espera: 350,
    aoMudar: (valor) => {
      filtros.busca = valor.trim();
      carregarLista();
    },
  });

  const botoesDeFila = FILAS.map((f) =>
    el("button", { classe: "fila-botao", type: "button", "data-fila": f.id, "aria-pressed": String(f.id === filtros.fila), onclick: () => escolherFila(f.id) }, [
      el("span", { texto: f.rotulo }),
      f.id ? el("span", { classe: "fila-numero", hidden: true }) : null,
    ]),
  );

  // Canal, atendente e situação são filtros de vez em quando: ficam atrás de
  // um botão, que avisa quando algum está ligado.
  const maisFiltros = el("div", { classe: "inbox-mais-filtros", id: "inbox-mais-filtros", hidden: true }, [selCanal, selAgente, selStatus]);
  const btnFiltros = el("button", {
    classe: "btn btn-peq",
    type: "button",
    "aria-expanded": "false",
    "aria-controls": "inbox-mais-filtros",
    texto: "Filtros",
    onclick: () => {
      maisFiltros.hidden = !maisFiltros.hidden;
      btnFiltros.setAttribute("aria-expanded", String(!maisFiltros.hidden));
    },
  });

  function aoFiltrar() {
    const ligados = [filtros.canal, filtros.agente, filtros.status].filter(Boolean).length;
    btnFiltros.textContent = ligados ? `Filtros (${ligados})` : "Filtros";
    carregarLista();
  }

  function escolherFila(id) {
    filtros.fila = id;
    for (const b of botoesDeFila) b.setAttribute("aria-pressed", String(b.dataset.fila === id));
    carregarLista();
  }

  function desenharContagem() {
    for (const b of botoesDeFila) {
      const numero = b.querySelector(".fila-numero");
      if (!numero) continue;
      const n = contagem[b.dataset.fila];
      numero.textContent = n ?? "";
      numero.hidden = !n;
    }
  }

  raiz.append(
    el("div", { classe: "inbox" }, [
      el("div", { classe: "inbox-lista" }, [
        el("div", { classe: "inbox-topo" }, [
          busca,
          el("div", { classe: "inbox-filas", role: "group", "aria-label": "Qual conversa mostrar" }, [...botoesDeFila, btnFiltros]),
          maisFiltros,
        ]),
        itens,
      ]),
      painelThread,
    ]),
  );

  vazioThread("Escolha uma conversa", "A lista à esquerda mostra quem falou com o atendente virtual.");
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
        texto: m.papel === "user" ? "Cliente" : humana ? "Pessoa da equipe" : "Atendente virtual",
      }),
      el("span", { texto: m.texto ?? "" }),
    ]);
  }

  /**
   * A lista de sempre, filtrada aqui mesmo. É o plano B da caixa: as cem
   * conversas mais recentes, sem a busca no banco.
   */
  async function listaSimples() {
    const pedido = new URLSearchParams();
    for (const campo of ["canal", "status", "agente"]) {
      if (filtros[campo]) pedido.set(campo, filtros[campo]);
    }
    const todas = await get(`/v1/venues/${ctx.venue}/conversations?${pedido}`);
    const termo = filtros.busca.toLowerCase();
    const achadas = termo ? todas.filter((c) => `${c.titulo ?? ""} ${c.contato ?? ""}`.toLowerCase().includes(termo)) : todas;
    const esperando = (c) => c.ultima_mensagem?.papel === "user";
    for (const c of achadas) c.esperando_desde = esperando(c) ? c.ultima_mensagem.em : null;
    return {
      conversas: achadas.filter((c) => (filtros.fila === "esperando" ? esperando(c) : filtros.fila === "equipe" ? c.atendimento.por === "humano" : true)),
      contagem: { esperando: achadas.filter(esperando).length, equipe: achadas.filter((c) => c.atendimento.por === "humano").length },
      marca: null,
    };
  }

  async function carregarLista({ silencioso = false } = {}) {
    if (!silencioso) {
      limpar(itens).append(esqueleto({ linhas: 5 }));
    }

    const pedido = new URLSearchParams({ caixa: "1" });
    for (const campo of ["fila", "busca", "canal", "status", "agente"]) {
      if (filtros[campo]) pedido.set(campo, filtros[campo]);
    }
    // Só a atualização automática manda a marca: quem mexeu num filtro quer
    // a lista nova, mesmo que nenhuma conversa tenha mudado.
    const filtrosDoPedido = JSON.stringify(filtros);
    if (silencioso && marca) pedido.set("marca", marca);

    const caixa = await get(`/v1/venues/${ctx.venue}/conversations?${pedido}`).catch((e) => {
      // Sessão vencida sobe para quem trata; qualquer outra falha cai na
      // lista simples, para a caixa de entrada nunca ficar em branco.
      if (e?.status === 401) throw e;
      return listaSimples();
    });
    // Nada mudou desde a última vez: o servidor nem montou a lista.
    if (caixa.sem_mudanca) return;
    // Trocaram o filtro enquanto esta resposta vinha: ela já não serve.
    if (filtrosDoPedido !== JSON.stringify(filtros)) return;

    const lista = caixa.conversas;
    marca = caixa.marca;
    contagem.equipe = caixa.contagem.equipe;
    // Na fila "Com a equipe" o servidor não conta quem espera: fica o que já havia.
    if (caixa.contagem.esperando !== null) contagem.esperando = caixa.contagem.esperando;
    desenharContagem();

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
      const daFila = FILAS.find((f) => f.id === filtros.fila)?.vazio;
      const filtrando = filtros.busca || filtros.canal || filtros.agente || filtros.status;
      itens.append(
        filtrando
          ? vazio("Nenhuma conversa encontrada", filtros.busca ? `Nada com “${filtros.busca}”. Tente o telefone, ou só o primeiro nome.` : "Nenhuma conversa com estes filtros.")
          : daFila
            ? vazio(daFila[0], daFila[1])
            : vazio("Nenhuma conversa", "Quando alguém falar com o atendente virtual pelo WhatsApp, pelo Instagram ou pela aba Testar, aparece aqui."),
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
              el("span", { classe: "conversa-hora", texto: desde(c.atualizada_em) }),
            ]),
            el("div", { classe: "conversa-previa", texto: previa }),
            el("div", { classe: "conversa-linha conversa-etiquetas" }, [
              // Primeiro o que pede ação; o canal e o atendente vêm depois.
              c.esperando_desde && c.status === "open" ? etiqueta(`Esperando há ${desde(c.esperando_desde).replace("agora", "instantes")}`, "etiqueta-alerta") : null,
              c.atendimento.por !== "humano"
                ? null
                : motivoDoFreio(c.atendimento)
                  ? el("span", { classe: "etiqueta etiqueta-perigo", title: `O atendente virtual parou sozinho: ${motivoDoFreio(c.atendimento)}.`, texto: "Parou sozinho" })
                  : etiqueta("Com a equipe", "etiqueta-info"),
              etiqueta(nomeDoCanal(c.canal)),
              c.agente && variosAtendentes ? etiqueta(c.agente.nome) : null,
              c.status !== "open" ? etiqueta("Encerrada") : null,
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
      texto: assumida ? "Devolver ao atendente virtual" : "Assumir atendimento",
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
            texto: [c.titulo && c.contato ? c.contato : null, nomeDoCanal(c.canal), `${c.mensagens.length} mensagens`]
              .filter(Boolean)
              .join(" · "),
          }),
        ]),
        // Com a equipe, quem explica é o aviso logo abaixo do cabeçalho.
        encerrada ? etiqueta("encerrada") : assumida ? null : etiqueta("atendente virtual respondendo", "etiqueta-ok"),
        btnAssumir,
        btnEncerrar,
        btnApagar,
      ]),
      // Conversa com a equipe: o atendente virtual está calado nela até
      // alguém devolver. Diz desde quando e por quê — é o que faz uma
      // conversa esquecida voltar a ser atendida.
      assumida && !encerrada
        ? el("p", { classe: "thread-aviso", role: "status" }, [
            el("strong", { texto: motivoDoFreio(c.atendimento) ? "O atendente virtual parou sozinho nesta conversa. " : "O atendente virtual não responde nesta conversa. " }),
            document.createTextNode(
              motivoDoFreio(c.atendimento)
                ? `Motivo: ${motivoDoFreio(c.atendimento)}${c.atendimento.assumido_em ? `, em ${dataHora(c.atendimento.assumido_em)}` : ""}. Se for um cliente de verdade, responda aqui ou devolva ao atendente virtual.`
                : `Está com a equipe${c.atendimento.assumido_em ? ` desde ${dataHora(c.atendimento.assumido_em)}` : ""}. Quando terminar, devolva ao atendente virtual — senão o cliente fica sem resposta da próxima vez que escrever.`,
            ),
          ])
        : null,
      corpo,
      el("div", { classe: "thread-rodape" }, [
        el("div", { classe: "linha-envio" }, [campo, btnEnviar]),
        !assumida
          ? el("p", {
              classe: "muted",
              texto:
                "Enquanto o atendente virtual responde, uma mensagem sua sairia junto com a dele e o cliente veria duas vozes.",
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
        vazioThread("Escolha uma conversa", "A lista à esquerda mostra quem falou com o atendente virtual.");
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
          encerrada ? "Conversa reaberta." : "Conversa encerrada e devolvida ao atendente virtual.",
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
        avisar(assumida ? "O atendente virtual voltou a responder." : "Atendimento assumido.", "ok");
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
