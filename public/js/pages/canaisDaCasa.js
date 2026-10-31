import { ErroApi, del, get, post, put } from "../api.js";
import { avisar, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * WhatsApp e Instagram da casa, organizados pela TAREFA — e não pela
 * tecnologia.
 *
 * O dono do bar não pensa em "Baileys", "Cloud API" ou "conector
 * administrativo"; pensa em "por onde o cliente fala comigo", "por onde sai
 * o checklist da equipe" e "por onde sai o parabéns". A tela era montada
 * pela outra pergunta, em duas páginas de dois módulos, e quem implantava
 * esquecia em um mês qual número fazia o quê. Agora são quatro cartões,
 * um por tarefa, e um quadro no topo que responde tudo de uma vez:
 *
 *   · Atendimento ao cliente — o número em que o cliente escreve e o
 *     atendente virtual responde (WhatsApp Web, papel "agente"; ou o
 *     oficial, se um agente for escolhido nele).
 *   · Avisos para a equipe — o número que só ENVIA: checklist, reserva
 *     nova para o gerente, resumos. Ninguém responde de propósito: o
 *     cozinheiro que manda "ok" não pode ser atendido como cliente novo.
 *   · Aniversário e campanhas — o número oficial da Meta: sem QR, sem
 *     computador ligado e sem risco de banimento. O teste dele é o que liga
 *     a conexão de fato (inscreve a conta no app — o passo que ninguém sabe
 *     que existe até faltar).
 *   · Instagram — DMs e comentários.
 *
 * Cada linha do quadro tem "Mandar teste": a única prova de que um número
 * ligado também ENTREGA é a mensagem chegando no celular de quem implanta.
 *
 * Mora nos Ajustes da casa, e não em módulo nenhum: quem compra só o
 * Checklist também precisa conectar o número de avisos.
 */

const ROTULOS = {
  desconectado: ["Desconectado", ""],
  aguardando_qr: ["Aguardando leitura do QR", "etiqueta-alerta"],
  conectando: ["Conectando…", "etiqueta-alerta"],
  conectado: ["Conectado", "etiqueta-ok"],
  sem_conector: ["Servidor desligado", "etiqueta-perigo"],
};

const SITUACOES = {
  nao_configurada: ["Não configurado", ""],
  incompleta: ["Incompleto", "etiqueta-alerta"],
  falta_testar: ["Falta testar", "etiqueta-alerta"],
  ativa: ["Ativo", "etiqueta-ok"],
};

/** O celular de quem implanta, lembrado neste navegador para os testes. */
const MEU_CELULAR = "brasa.celular-de-teste";

/** 5565981382139 → +55 65 98138-2139. O que não reconhece, devolve igual. */
function telefoneBonito(bruto) {
  const d = String(bruto ?? "").replace(/\D/g, "");
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : bruto;
}

function lerCelular() {
  try {
    return localStorage.getItem(MEU_CELULAR) ?? "";
  } catch {
    return "";
  }
}

function guardarCelular(valor) {
  try {
    localStorage.setItem(MEU_CELULAR, valor);
  } catch {
    /* sem armazenamento, a pessoa digita de novo na próxima vez */
  }
}

export async function canaisDaCasa(raiz, ctx) {
  const areaResumo = el("div", {});
  const areaAtendente = el("div", {});
  const areaConector = el("div", {});
  const areaOficial = el("div", {});
  const areaInstagram = el("div", {});
  raiz.append(el("div", { classe: "pilha" }, [areaResumo, areaAtendente, areaConector, areaOficial, areaInstagram]));

  areaAtendente.append(el("p", { classe: "muted", texto: "Consultando o número do atendimento…" }));
  areaConector.append(el("p", { classe: "muted", texto: "Consultando o número de avisos…" }));
  areaOficial.append(el("p", { classe: "muted", texto: "Consultando o número oficial…" }));
  areaInstagram.append(el("p", { classe: "muted", texto: "Consultando o Instagram…" }));

  // O que cada cartão descobriu, para o quadro do topo contar numa linha.
  const retrato = { atendente: null, avisos: null, oficial: null, instagram: null };

  const agentes = await get("/v1/agents?all=1").catch(() => []);
  const nomeDoAgente = (slug) => agentes.find((a) => a.slug === slug)?.name ?? null;

  // O seletor do atendente vive fora do redesenho: o timer redesenha o
  // cartão a cada 4 segundos, e a escolha não pode voltar sozinha.
  const seletorAtendente = el(
    "select",
    { classe: "select", id: "seletor-agente-wa" },
    agentes.map((a) => el("option", { value: a.slug, texto: a.name })),
  );

  let timer = null;
  // Depois de um clique em Conectar/Desconectar, a tela fica no modo rápido
  // por 3 minutos: é quando o QR chega e a pessoa está olhando.
  let rapidoAte = 0;
  ctx.aoSair(() => clearInterval(timer));

  // A volta do login do Instagram chega com o resultado no endereço.
  contarAVoltaDoLogin();

  const campoCelular = el("input", {
    inputmode: "tel",
    placeholder: "65 99999-9999",
    value: lerCelular(),
    style: "max-width:200px",
  });
  campoCelular.addEventListener("change", () => guardarCelular(campoCelular.value.trim()));
  const linhasDoResumo = el("div", { classe: "tabela" });
  areaResumo.append(
    el("section", { classe: "cartao pilha" }, [
      el("div", {}, [
        el("h2", { texto: "Quem faz o quê" }),
        el("p", { classe: "muted", texto: "Cada tarefa e o número que cuida dela. Verde é que está funcionando; teste mandando uma mensagem para o seu celular." }),
      ]),
      linhasDoResumo,
      el("div", { classe: "linha-campos", style: "align-items:center" }, [
        el("label", { classe: "muted", texto: "Seu celular, para os testes:" }),
        campoCelular,
      ]),
    ]),
  );
  desenharResumo();

  await Promise.all([desenharOficial(), desenharInstagram(), atualizarConectores()]);
  // Rápido (4 s) só enquanto alguém espera o QR ou a conexão; conectado ou
  // desligado, a cada 30 s. Aba escondida não pergunta nada.
  let ultimaVolta = Date.now();
  timer = setInterval(() => {
    if (document.hidden) return;
    const esperando = [retrato.atendente?.status, retrato.avisos?.status].some((s) => s === "aguardando_qr" || s === "conectando");
    if (!esperando && Date.now() > rapidoAte && Date.now() - ultimaVolta < 30_000) return;
    ultimaVolta = Date.now();
    atualizarConectores();
  }, 4000);

  // ============================================================
  // O quadro "Quem faz o quê"
  // ============================================================

  function desenharResumo() {
    const { atendente, avisos, oficial, instagram } = retrato;
    const oficialAtende = oficial?.ativa && oficial.agent_slug;
    const linhas = [];

    // Atendimento: o WhatsApp Web do atendente e/ou o oficial com agente.
    const quemAtende = [];
    if (atendente?.status === "conectado") quemAtende.push(`${telefoneBonito(atendente.telefone) ?? "WhatsApp Web"}${nomeDoAgente(atendente.agentSlug) ? ` · ${nomeDoAgente(atendente.agentSlug)}` : ""}`);
    if (oficialAtende) quemAtende.push(`${oficial.telefone} (oficial) · ${nomeDoAgente(oficial.agent_slug) ?? "agente"}`);
    linhas.push({
      tarefa: "Atendimento ao cliente",
      detalhe: atendente === null && oficial === null ? "Consultando…" : quemAtende.join(" e ") || "Ninguém responde o cliente no WhatsApp",
      ok: quemAtende.length > 0,
      teste: atendente?.status === "conectado" ? "atendente" : oficialAtende ? "oficial" : null,
    });

    linhas.push({
      tarefa: "Avisos para a equipe",
      detalhe: avisos === null
        ? "Consultando…"
        : avisos.status === "conectado"
          ? `${telefoneBonito(avisos.telefone) ?? "WhatsApp Web"} · checklist, reserva nova, resumos`
          : "Desligado: checklist e avisos da equipe não estão saindo",
      ok: avisos?.status === "conectado",
      teste: avisos?.status === "conectado" ? "avisos" : null,
    });

    linhas.push({
      tarefa: "Aniversário e campanhas",
      detalhe: oficial === null
        ? "Consultando…"
        : oficial.ativa
          ? `${oficial.telefone} (oficial) · parabéns, pesquisa, mensagens em massa`
          : avisos?.status === "conectado"
            ? "Sem o oficial: o parabéns sai pelo número de avisos, com texto simples"
            : "Sem número para enviar",
      ok: Boolean(oficial?.ativa),
      teste: oficial?.ativa ? "oficial" : null,
    });

    linhas.push({
      tarefa: "Instagram",
      detalhe: instagram === null
        ? "Consultando…"
        : !instagram.conectado
          ? "Não conectado"
          : instagram.vencido
            ? "Autorização vencida — conecte de novo"
            : `@${instagram.usuario ?? "conta do bar"} · ${nomeDoAgente(instagram.agent_slug) ?? "ninguém responde"}`,
      ok: Boolean(instagram?.conectado && !instagram.vencido && instagram.agent_slug),
      teste: null,
    });

    limpar(linhasDoResumo).append(
      ...linhas.map((l) =>
        el("div", { classe: "linha-tabela linha-tarefa" }, [
          el("span", { classe: `ponto-estado ${l.ok ? "ponto-ok" : "ponto-alerta"}`, "aria-hidden": "true" }),
          el("div", { classe: "linha-tarefa-texto" }, [
            el("strong", { texto: l.tarefa }),
            el("span", { classe: "muted", texto: l.detalhe }),
          ]),
          l.teste ? botaoDeTeste(l.teste) : el("span", {}),
        ]),
      ),
    );
  }

  function botaoDeTeste(numero) {
    return el("button", {
      classe: "btn btn-peq",
      type: "button",
      texto: "Mandar teste",
      onclick: async (e) => {
        const telefone = campoCelular.value.trim();
        if (!telefone) {
          avisar("Escreva o seu celular embaixo do quadro.", "info");
          campoCelular.focus();
          return;
        }
        guardarCelular(telefone);
        e.target.disabled = true;
        try {
          const r = await post(`/v1/venues/${encodeURIComponent(ctx.venue)}/canais/teste`, { numero, telefone });
          avisar(r.na_fila ? "Teste na fila: deve chegar no seu celular em até um minuto." : "Teste enviado. Confira o celular.", "ok");
        } catch (err) {
          avisar(err.message, "erro");
        } finally {
          e.target.disabled = false;
        }
      },
    });
  }

  // ============================================================
  // O Instagram (login da Meta)
  // ============================================================

  /**
   * O dono volta do Instagram para cá, com `?instagram=ok` ou `?instagram=
   * erro&motivo=…` no endereço. Conta o que houve e limpa o endereço, para
   * um F5 não repetir o aviso.
   */
  function contarAVoltaDoLogin() {
    const q = new URLSearchParams(location.search);
    const resultado = q.get("instagram");
    if (!resultado) return;
    const motivo = q.get("motivo") ?? "";
    if (resultado === "ok") avisar(`Instagram conectado${motivo ? ` como ${motivo}` : ""}. Agora escolha quem responde os DMs.`, "ok");
    else avisar(motivo || "Não deu para conectar o Instagram.", "erro");
    q.delete("instagram");
    q.delete("motivo");
    const resto = q.toString();
    history.replaceState(null, "", `${location.pathname}${resto ? `?${resto}` : ""}${location.hash}`);
  }

  async function desenharInstagram() {
    let conexao;
    let agentes = [];
    try {
      [conexao, agentes] = await Promise.all([
        get(`/v1/venues/${encodeURIComponent(ctx.venue)}/instagram`),
        get("/v1/agents?all=1").catch(() => []),
      ]);
    } catch (e) {
      if (e instanceof ErroApi && e.status === 404) {
        limpar(areaInstagram);
        retrato.instagram = { conectado: false };
        desenharResumo();
        return; // API antiga sem a rota: o cartão não aparece.
      }
      limpar(areaInstagram).append(el("section", { classe: "cartao" }, [el("h2", { texto: "Instagram" }), el("p", { classe: "muted", texto: e.message })]));
      return;
    }

    retrato.instagram = conexao;
    desenharResumo();
    const conectado = Boolean(conexao.conectado);
    const agenteAtual = agentes.find((a) => a.slug === conexao.agent_slug);
    const [rotulo, variante] = !conectado
      ? ["Não conectado", ""]
      : conexao.vencido
        ? ["Autorização vencida", "etiqueta-perigo"]
        : conexao.agent_slug
          ? ["Ativo", "etiqueta-ok"]
          : ["Conectado, sem agente", "etiqueta-alerta"];

    const seletorAgente = el("select", { classe: "select" }, [
      el("option", { value: "", texto: "Ninguém — os DMs ficam sem resposta automática" }),
      ...agentes.map((a) => el("option", { value: a.slug, texto: a.name, selected: a.slug === conexao.agent_slug })),
    ]);
    const MODOS = [
      ["desligado", "Não responder"],
      ["privado", "Chamar no direct"],
      ["publico_e_privado", "Responder no post e chamar no direct"],
    ];
    const seletorComentarios = el("select", { classe: "select" }, MODOS.map(([id, nome]) =>
      el("option", { value: id, texto: nome, selected: id === (conexao.comentarios ?? "privado") })));
    const campoAviso = el("input", { value: conexao.comentarios_aviso ?? "", placeholder: "Te chamei no direct 😉", maxlength: "200" });
    const areaDoAviso = el("div", { classe: "grade", style: "margin-top:12px", hidden: seletorComentarios.value !== "publico_e_privado" }, [
      campo("A frase que fica no post (igual para todo mundo)", campoAviso),
    ]);
    seletorComentarios.addEventListener("change", () => { areaDoAviso.hidden = seletorComentarios.value !== "publico_e_privado"; });
    const caixaAgradecer = el("input", { type: "checkbox", checked: conexao.comentarios_agradecer !== false });
    const linhaAgradecer = el("label", { classe: "linha-campos", style: "align-items:center;gap:8px;margin-top:10px;cursor:pointer" }, [
      caixaAgradecer,
      el("span", { texto: "Agradecer elogios e emojis no post, com uma frase curta (até 60 por dia)" }),
    ]);

    const conectar = async (e) => {
      e.target.disabled = true;
      try {
        const r = await post(`/v1/venues/${encodeURIComponent(ctx.venue)}/instagram/login`, {});
        // Sai do painel: o Instagram pede a conta do bar e devolve para cá.
        location.href = r.url;
      } catch (err) {
        avisar(err.message, "erro");
        e.target.disabled = false;
      }
    };

    const descricao = conectado
      ? `Conectado como @${conexao.usuario ?? conexao.ig_user_id}${conexao.nome ? ` (${conexao.nome})` : ""} · ${agenteAtual ? `DMs atendidos por ${agenteAtual.name}` : "ninguém responde ainda"}`
      : "Os DMs do Instagram do bar atendidos pelo agente, direto na nuvem: sem QR, sem computador ligado, sem risco de banimento. Clique em conectar e entre com a conta do bar.";

    limpar(areaInstagram).append(
      el("section", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Instagram" }),
            el("p", { classe: "muted", texto: descricao }),
          ]),
          etiqueta(rotulo, variante),
        ]),

        conectado && conexao.vencido
          ? el("p", { classe: "aviso aviso-perigo", texto: "A autorização do Instagram venceu e os DMs não estão sendo respondidos. Clique em “Conectar de novo”." })
          : conectado && !conexao.agent_slug
            ? el("p", { classe: "aviso aviso-alerta", texto: "Quem mandar DM fala com o vazio. Escolha um agente abaixo e salve." })
            : null,

        conectado
          ? el("div", { classe: "grade", style: "margin-top:12px" }, [
              campo("Quem responde os DMs", seletorAgente),
              campo("Comentários nos posts", seletorComentarios),
            ])
          : null,
        conectado ? areaDoAviso : null,
        conectado ? linhaAgradecer : null,
        conectado
          ? el("p", {
              classe: "muted",
              style: "margin-top:6px",
              texto: "Quem comenta com pergunta, interesse ou reclamação recebe o agente no direct — a Meta permite isso por 7 dias depois do comentário. Elogio e emoji ganham um obrigado curto no post (a Meta não deixa curtir comentário). Marcação de amigo e spam ficam quietos. O agente nunca conversa em público.",
            })
          : null,

        !conectado && !conexao.login_disponivel
          ? el("p", { classe: "muted", style: "margin-top:10px", texto: "O login do Instagram ainda não está ligado neste sistema. Fale com a equipe Brasa Food." })
          : null,

        el("div", { classe: "linha-campos", style: "margin-top:12px" }, [
          conectado
            ? el("button", {
                classe: "btn btn-primario",
                type: "button",
                texto: "Salvar",
                onclick: async (e) => {
                  e.target.disabled = true;
                  try {
                    await put(`/v1/venues/${encodeURIComponent(ctx.venue)}/instagram`, {
                      agent_slug: seletorAgente.value,
                      comentarios: seletorComentarios.value,
                      comentarios_aviso: campoAviso.value,
                      comentarios_agradecer: caixaAgradecer.checked,
                    });
                    avisar(seletorAgente.value ? "Pronto: os DMs e os comentários passam a ser atendidos." : "Salvo. Ninguém responde os DMs por enquanto.", "ok");
                    await desenharInstagram();
                  } catch (err) {
                    avisar(err.message, "erro");
                    e.target.disabled = false;
                  }
                },
              })
            : null,
          conexao.login_disponivel
            ? el("button", {
                classe: conectado ? "btn" : "btn btn-primario",
                type: "button",
                texto: conectado ? "Conectar de novo" : "Conectar Instagram",
                title: conectado ? "Refaz a autorização com a conta do bar, sem perder o agente escolhido." : "Abre o Instagram para você entrar com a conta do bar e autorizar.",
                onclick: conectar,
              })
            : null,
          conectado
            ? el("button", {
                classe: "btn btn-perigo",
                type: "button",
                texto: "Desconectar",
                style: "margin-left:auto",
                onclick: async (e) => {
                  if (!confirm("Desconectar o Instagram desta casa? A conta continua sua; só paramos de atender os DMs.")) return;
                  e.target.disabled = true;
                  try {
                    await del(`/v1/venues/${encodeURIComponent(ctx.venue)}/instagram`);
                    avisar("Instagram desconectado.", "ok");
                    await desenharInstagram();
                  } catch (err) {
                    avisar(err.message, "erro");
                    e.target.disabled = false;
                  }
                },
              })
            : null,
        ].filter(Boolean)),

        el("p", {
          classe: "muted",
          style: "margin-top:10px",
          texto: conectado
            ? `A autorização vale 60 dias e é renovada sozinha toda semana${conexao.expira_em ? ` (vence ${new Date(conexao.expira_em).toLocaleDateString("pt-BR")})` : ""}.`
            : "Antes de conectar: no app do Instagram do bar, em Configurações → Mensagens → Ferramentas conectadas, ligue “Permitir acesso às mensagens”. A conta precisa ser profissional (comercial ou criador de conteúdo).",
        }),
      ].filter(Boolean)),
    );
  }

  // ============================================================
  // O oficial (Meta)
  // ============================================================

  async function desenharOficial() {
    let conexao;
    let agentes = [];
    try {
      [conexao, agentes] = await Promise.all([
        get(`/v1/venues/${encodeURIComponent(ctx.venue)}/whatsapp-oficial`),
        get("/v1/agents?all=1").catch(() => []),
      ]);
    } catch (e) {
      retrato.oficial = { ativa: false };
      desenharResumo();
      limpar(areaOficial).append(
        el("section", { classe: "cartao" }, [
          el("h2", { texto: "Aniversário e campanhas" }),
          el("p", { classe: "muted", texto: e instanceof ErroApi && e.status === 404 ? "Atualize o servidor para a versão mais recente para conectar o número oficial." : e.message }),
        ]),
      );
      return;
    }

    retrato.oficial = { ativa: conexao.situacao === "ativa", telefone: conexao.telefone, agent_slug: conexao.agent_slug };
    desenharResumo();
    const [rotulo, variante] = SITUACOES[conexao.situacao] ?? [conexao.situacao, ""];
    const agenteAtual = agentes.find((a) => a.slug === conexao.agent_slug);
    const temAlgo = conexao.tem_token || conexao.phone_number_id || conexao.waba_id;

    const campoTelefone = el("input", { value: conexao.phone_number_id ?? "", placeholder: "Ex.: 1370957436093649", inputmode: "numeric" });
    const campoConta = el("input", { value: conexao.waba_id ?? "", placeholder: "Ex.: 1582085583665675", inputmode: "numeric" });
    const campoToken = el("input", {
      type: "password",
      autocomplete: "off",
      placeholder: conexao.tem_token ? `Token salvo (${conexao.token_final}) — cole outro só para trocar` : "Cole o token de acesso da Meta",
    });
    const seletorAgente = el("select", { classe: "select" }, [
      el("option", { value: "", texto: "Ninguém — este número só envia (aniversários, promoções, avisos)" }),
      ...agentes.map((a) => el("option", { value: a.slug, texto: a.name, selected: a.slug === conexao.agent_slug })),
    ]);

    const corpoParaSalvar = () => {
      const corpo = {
        phone_number_id: campoTelefone.value.trim(),
        waba_id: campoConta.value.trim(),
        agent_slug: seletorAgente.value,
      };
      // Token só viaja quando a pessoa digitou um: campo vazio = não mexe.
      if (campoToken.value.trim()) corpo.token = campoToken.value.trim();
      return corpo;
    };

    const ativa = conexao.situacao === "ativa";
    const descricao = ativa
      ? `Número oficial da Meta ${conexao.telefone}${conexao.nome_verificado ? ` (${conexao.nome_verificado})` : ""} · ${agenteAtual ? `também atende o cliente, com ${agenteAtual.name}` : "só envia"}`
      : conexao.situacao === "falta_testar"
        ? "Dados preenchidos. Clique em “Testar e ativar” para a Meta confirmar o número e começar a entregar as mensagens."
        : "Parabéns de aniversário, convite da pesquisa e mensagens em massa saem pelo número oficial da Meta: sem QR, sem computador ligado e sem risco de banimento.";

    limpar(areaOficial).append(
      el("section", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Aniversário e campanhas" }),
            el("p", { classe: "muted", texto: descricao }),
          ]),
          etiqueta(rotulo, variante),
        ]),

        conexao.situacao === "ativa" && !conexao.agent_slug
          ? el("p", {
              classe: "aviso aviso-alerta",
              texto: "Quem responder a este número fala com o vazio. Se quiser que o atendente virtual responda por ele também, escolha abaixo e salve.",
            })
          : null,

        el("div", { classe: "grade", style: "margin-top:12px" }, [
          campo("Se o cliente responder, quem atende", seletorAgente),
        ]),

        // Os dados da Meta se preenchem uma vez, na implantação. Com o número
        // ativo, ficam recolhidos: aberto, é um formulário de token na cara
        // de quem só queria ver se está funcionando.
        el("details", { classe: "detalhes-tecnicos", open: !ativa }, [
          el("summary", { texto: ativa ? "Dados da Meta (preenchidos na implantação)" : "Dados da Meta" }),
          el("div", { classe: "grade", style: "margin-top:12px" }, [
            campo("ID do telefone", campoTelefone),
            campo("ID da conta do WhatsApp Business", campoConta),
          ]),
          el("div", { classe: "grade", style: "margin-top:12px" }, [
            campo("Token de acesso", campoToken),
          ]),
          el("p", {
            classe: "muted",
            style: "margin-top:10px",
            texto:
              "Onde achar: business.facebook.com → Configurações → Contas do WhatsApp → sua conta. A “Identificação” ali é o ID da CONTA; " +
              "na aba Phone numbers, a “Identificação do número de telefone” é o ID do TELEFONE. Os dois têm o mesmo tamanho — não troque um pelo outro. " +
              "O token fica só no nosso banco e você apaga quando quiser.",
          }),
        ]),

        el("div", { classe: "linha-campos", style: "margin-top:12px" }, [
          el("button", {
            classe: "btn",
            type: "button",
            texto: "Salvar",
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                await put(`/v1/venues/${encodeURIComponent(ctx.venue)}/whatsapp-oficial`, corpoParaSalvar());
                avisar("Conexão salva. Agora teste para ativar.", "ok");
                await desenharOficial();
              } catch (err) {
                avisar(err.message, "erro");
                e.target.disabled = false;
              }
            },
          }),
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "Testar e ativar",
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                // Salva o que está na tela ANTES de testar: testar o que a
                // pessoa vê, e não o que estava salvo, é o que evita "mas eu
                // corrigi o ID e continua dando erro".
                await put(`/v1/venues/${encodeURIComponent(ctx.venue)}/whatsapp-oficial`, corpoParaSalvar());
                const r = await post(`/v1/venues/${encodeURIComponent(ctx.venue)}/whatsapp-oficial/testar`, {});
                avisar(
                  `A Meta confirmou: ${r.telefone}${r.nome_verificado ? ` (${r.nome_verificado})` : ""}. Conta inscrita no app — as mensagens já chegam.`,
                  "ok",
                );
                await desenharOficial();
              } catch (err) {
                avisar(err.message, "erro");
                e.target.disabled = false;
                await desenharOficial();
              }
            },
          }),
          temAlgo
            ? el("button", {
                classe: "btn btn-perigo",
                type: "button",
                texto: "Remover conexão",
                style: "margin-left:auto",
                onclick: async (e) => {
                  if (!confirm("Remover a conexão oficial desta casa? O número continua seu na Meta; só paramos de usá-lo.")) return;
                  e.target.disabled = true;
                  try {
                    await del(`/v1/venues/${encodeURIComponent(ctx.venue)}/whatsapp-oficial`);
                    avisar("Conexão removida.", "ok");
                    await desenharOficial();
                  } catch (err) {
                    avisar(err.message, "erro");
                    e.target.disabled = false;
                  }
                },
              })
            : null,
        ]),

        el("details", { classe: "detalhes-tecnicos" }, [
          el("summary", { texto: "Detalhes técnicos (equipe Brasa Food)" }),
          el("p", {
            classe: "muted",
            texto: "O app da Meta é um só para o sistema; o webhook dele já aponta para cá. O que muda por casa é o token, os IDs e o agente — tudo nesta tela.",
          }),
          el("pre", { classe: "bloco-codigo", texto: `${location.origin}/v1/whatsapp/webhook` }),
          el("p", {
            classe: "muted",
            texto: "Token: developers.facebook.com → Ferramentas → Explorador da Graph API → token de usuário com whatsapp_business_management e whatsapp_business_messaging → Depurador de token → Estender (60 dias). O permanente sai do usuário do sistema da BM, quando ela deixar.",
          }),
        ]),
      ].filter(Boolean)),
    );
  }

  // ============================================================
  // O do conector (Baileys)
  // ============================================================

  async function atualizarConectores() {
    try {
      // Os dois de uma vez: o quadro do topo precisa dos dois, e conferir se
      // são o mesmo chip evita o bug do funcionário atendido pela IA.
      const [doAgente, estado] = await Promise.all([
        get(`/v1/whatsapp/status?venue=${encodeURIComponent(ctx.venue)}&papel=agente`).catch((e) => {
          if (e instanceof ErroApi && e.status === 501) throw e;
          return null;
        }),
        get(`/v1/whatsapp/status?venue=${encodeURIComponent(ctx.venue)}&papel=administrativo`),
      ]);
      retrato.atendente = doAgente ?? { status: "sem_conector" };
      retrato.avisos = estado;
      desenharResumo();
      desenharAtendente(doAgente);
      desenharConector(estado, doAgente);
    } catch (e) {
      clearInterval(timer);
      retrato.atendente = { status: "sem_conector" };
      retrato.avisos = { status: "sem_conector" };
      desenharResumo();
      const [titulo, texto] = e instanceof ErroApi && e.status === 501
        ? ["WhatsApp Web indisponível nesta versão", "Atualize o servidor para a versão mais recente."]
        : ["WhatsApp indisponível", e.message];
      limpar(areaAtendente).append(vazio(titulo, texto));
      limpar(areaConector);
    }
  }

  // ============================================================
  // Atendimento ao cliente (WhatsApp Web, papel "agente")
  // ============================================================

  function desenharAtendente(estado) {
    if (agentes.length === 0) {
      limpar(areaAtendente).append(
        el("section", { classe: "cartao" }, [
          el("h2", { texto: "Atendimento ao cliente" }),
          el("p", { classe: "muted", texto: "Crie o atendente primeiro, em Atendente virtual → Atendente. Depois volte aqui para ligar o número dele." }),
        ]),
      );
      return;
    }
    estado = estado ?? { status: "sem_conector" };
    const [rotulo, variante] = ROTULOS[estado.status] ?? [estado.status, ""];
    const ligado = estado.status === "conectado" || estado.status === "conectando";
    const semConector = estado.status === "sem_conector";

    // Já tem vínculo? O seletor mostra quem atende de verdade, e trava:
    // trocar de agente exige desconectar primeiro.
    if (estado.agentSlug && agentes.some((a) => a.slug === estado.agentSlug)) {
      seletorAtendente.value = estado.agentSlug;
    }
    seletorAtendente.disabled = ligado;
    const agenteAtual = agentes.find((a) => a.slug === estado.agentSlug);

    limpar(areaAtendente).append(
      el("section", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Atendimento ao cliente" }),
            el("p", {
              classe: "muted",
              texto: estado.telefone
                ? `O cliente escreve para ${telefoneBonito(estado.telefone)}${agenteAtual ? ` e ${agenteAtual.name} responde` : ""}.`
                : "O número em que o cliente escreve e o atendente virtual responde, pelo WhatsApp Web.",
            }),
          ]),
          etiqueta(rotulo, variante),
        ]),

        semConector
          ? el("div", { classe: "area-qr" }, [
              el("p", { classe: "muted", texto: "O servidor deste número não está respondendo. Quem liga é a equipe Brasa Food — assim que ele voltar, esta tela volta sozinha." }),
            ])
          : estado.qr
            ? el("div", { classe: "area-qr" }, [
                el("img", { src: estado.qr, alt: "QR de pareamento do WhatsApp do atendimento" }),
                el("p", { classe: "muted", texto: "No celular do número do atendimento: WhatsApp → Aparelhos conectados → Conectar aparelho." }),
              ])
            : estado.status === "conectado"
              ? null
              : el("div", { classe: "area-qr" }, [
                  el("p", { classe: "muted", texto: "Escolha o atendente e clique em conectar para gerar o QR." }),
                ]),

        el("div", { classe: "campo", style: "max-width:320px;margin-top:10px" }, [
          el("label", { for: "seletor-agente-wa", texto: "Quem responde por este número" }),
          seletorAtendente,
          ligado ? el("p", { classe: "muted", texto: "Desconecte para trocar." }) : null,
        ]),

        el("div", { classe: "reserva-acoes" }, [
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "Conectar",
            disabled: ligado || semConector,
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                rapidoAte = Date.now() + 180_000;
                const res = await post("/v1/whatsapp/conectar", { venue: ctx.venue, agent: seletorAtendente.value, papel: "agente" });
                avisar(res.na_fila ? "Comando enviado. O QR aparece aqui em ~10 segundos." : "Conectando. O QR aparece em instantes.", "ok");
              } catch (err) {
                avisar(err.message, "erro");
                e.target.disabled = false;
              }
            },
          }),
          el("button", {
            classe: "btn btn-perigo",
            type: "button",
            texto: "Desconectar",
            disabled: semConector,
            onclick: async (e) => {
              if (!confirm("Desconectar o número do atendimento? Os clientes ficam sem resposta automática até conectar de novo.")) return;
              e.target.disabled = true;
              try {
                rapidoAte = Date.now() + 180_000;
                const res = await post("/v1/whatsapp/desconectar", { venue: ctx.venue, papel: "agente" });
                avisar(res.na_fila ? "Comando de desconexão enviado." : "Desconectado.", "ok");
              } catch (err) {
                avisar(err.message, "erro");
              } finally {
                e.target.disabled = false;
              }
            },
          }),
        ]),

        el("details", { classe: "detalhes-tecnicos" }, [
          el("summary", { texto: "Detalhes técnicos (equipe Brasa Food)" }),
          el("p", {
            classe: "muted",
            texto: "Conexão pelo WhatsApp Web (Baileys), fora dos termos de uso da Meta: o número pode ser banido. Use um chip só para isso, nunca o número principal da casa.",
          }),
          el("p", { classe: "muted", texto: `Versão no servidor: ${estado.versao ?? "desconhecida"}${estado.fonte === "ponte" ? " · via ponte" : ""}` }),
        ]),
      ]),
    );
  }

  // ============================================================
  // Avisos para a equipe (WhatsApp Web, papel "administrativo")
  // ============================================================

  function desenharConector(estado, doAgente) {
    const [rotulo, variante] = ROTULOS[estado.status] ?? [estado.status, ""];
    const ligado = estado.status === "conectado" || estado.status === "conectando";
    const semConector = estado.status === "sem_conector";
    const mesmoNumero =
      estado.telefone && doAgente?.telefone && estado.telefone === doAgente.telefone;

    limpar(areaConector).append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cartao" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: "Avisos para a equipe" }),
              el("p", {
                classe: "muted",
                texto: estado.telefone
                  ? `Sai de ${telefoneBonito(estado.telefone)}: link do checklist, reserva nova para o gerente, resumos e alertas.`
                  : "O número que manda o link do checklist, a reserva nova para o gerente, resumos e alertas.",
              }),
            ]),
            etiqueta(rotulo, variante),
          ]),

          el("p", {
            classe: "aviso aviso-alerta",
            texto:
              "Este número só ENVIA. Quem responder aqui não é atendido por ninguém — de propósito: o funcionário que manda “ok” no checklist não pode cair no atendente virtual.",
          }),

          mesmoNumero
            ? el("p", {
                classe: "aviso aviso-perigo",
                texto:
                  "Este é o MESMO número do atendimento ao cliente. Com o mesmo chip nos dois, o atendente virtual responde a equipe também — o funcionário que mandar “ok” no checklist será atendido como cliente. Use um chip separado.",
              })
            : null,

          semConector
            ? el("div", { classe: "area-qr" }, [
                el("p", {
                  classe: "muted",
                  texto:
                    "O servidor deste número não está respondendo. Quem liga é a equipe Brasa Food — assim que ele voltar, esta tela volta sozinha.",
                }),
              ])
            : estado.qr
              ? el("div", { classe: "area-qr" }, [
                  el("img", { src: estado.qr, alt: "QR de pareamento do WhatsApp da casa" }),
                  el("p", { classe: "muted", texto: "No celular do número de avisos: WhatsApp → Aparelhos conectados → Conectar aparelho." }),
                ])
              : estado.status === "conectado"
                ? null
                : el("div", { classe: "area-qr" }, [
                    el("p", { classe: "muted", texto: "Clique em conectar para gerar o QR de pareamento." }),
                  ]),

          el("div", { classe: "reserva-acoes" }, [
            el("button", {
              classe: "btn btn-primario",
              type: "button",
              texto: "Conectar",
              disabled: ligado || semConector,
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  rapidoAte = Date.now() + 180_000;
                  const res = await post("/v1/whatsapp/conectar", {
                    venue: ctx.venue,
                    papel: "administrativo",
                  });
                  avisar(
                    res.na_fila
                      ? "Comando enviado. O QR aparece aqui em ~10 segundos."
                      : "Conector iniciado. O QR aparece em instantes.",
                    "ok",
                  );
                } catch (err) {
                  avisar(err.message, "erro");
                  e.target.disabled = false;
                }
              },
            }),
            el("button", {
              classe: "btn btn-perigo",
              type: "button",
              texto: "Desconectar",
              disabled: semConector,
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  rapidoAte = Date.now() + 180_000;
                  const res = await post("/v1/whatsapp/desconectar", {
                    venue: ctx.venue,
                    papel: "administrativo",
                  });
                  avisar(res.na_fila ? "Comando de desconexão enviado." : "Conector parado.", "ok");
                } catch (err) {
                  avisar(err.message, "erro");
                } finally {
                  e.target.disabled = false;
                }
              },
            }),
          ]),
        ]),

        // Instrução de instalação só aparece quando não HÁ conector
        // respondendo — e mesmo assim em linguagem de dono de bar. Com o
        // conector no ar, mandar alguém rodar comando é ruído: ele não tem o
        // que fazer, e a tela dá a entender que falta um passo.
        semConector
          ? el("div", { classe: "cartao" }, [
              el("h3", { texto: "O servidor do WhatsApp não está respondendo" }),
              el("p", {
                classe: "muted",
                texto:
                  "Nada para fazer por aqui: quem liga esse servidor é a equipe Brasa Food. Se os envios pararem (checklist não chega, confirmação não sai), fale com a gente que religamos.",
              }),
              // O comando fica recolhido: serve a quem instala, e quem instala
              // sabe procurar. Aberto, vira instrução para quem não tem o que
              // fazer com ela.
              el("details", { classe: "detalhes-tecnicos" }, [
                el("summary", { texto: "Detalhes técnicos (equipe Brasa Food)" }),
                el("p", { classe: "muted", texto: "Na VPS, como root:" }),
                el("pre", {
                  classe: "bloco-codigo",
                  texto: "systemctl restart brasa-food-admin\njournalctl -u brasa-food-admin -n 30 --no-pager",
                }),
                el("p", {
                  classe: "muted",
                  texto:
                    "Instalação nova: bash scripts/instalar-vps-administrativo.sh — cada papel tem pasta de sessão e porta próprias, e um cair não derruba o outro.",
                }),
              ]),
            ])
          : null,
      ].filter(Boolean)),
    );
  }
}

function campo(rotulo, controle) {
  return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
}
