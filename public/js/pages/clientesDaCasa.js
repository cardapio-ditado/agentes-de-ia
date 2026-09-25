import { del, get, patch, post, postArquivo, put } from "../api.js";
import { avisar, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Clientes: quem já esteve na casa, num lugar só.
 *
 * Até aqui o cliente existia espalhado — um telefone na resposta da pesquisa,
 * um nome na conversa do agente, um CPF na Zig. Cada pedaço servia à tela que
 * o gerou e a nenhuma outra, e "quem são meus clientes?" não tinha onde ser
 * respondida.
 *
 * Três abas:
 *   - Clientes: a lista inteira, com busca e filtro por origem, e o cadastro
 *     manual — o dono digita quem conheceu ontem e acabou;
 *   - Aniversariantes: a agenda dos próximos dias, com quem já foi avisado;
 *   - Parabéns: se manda, a que horas, com quanto de antecedência e o texto.
 *
 * A base não pertence a módulo nenhum: é da CASA. Quem só tem o CMV cadastra
 * clientes na mão e manda parabéns do mesmo jeito.
 */

const NOME_DA_ORIGEM = {
  manual: "cadastrado à mão",
  zig: "veio da Zig",
  agente: "falou no WhatsApp",
  pesquisa: "respondeu a pesquisa",
  planilha: "veio de planilha",
  cardapio: "abriu o cardápio na mesa",
};


/**
 * Os selos, do mais urgente para o mais calmo.
 *
 * "Sumido" na frente de propósito: é o único que pede ação hoje. Os outros
 * descrevem quem a pessoa é; este descreve o que está acontecendo com ela.
 */
const SELOS = [
  ["sumido", "Sumido", "etiqueta-perigo", "Vinha e parou de vir"],
  ["vip", "VIP", "etiqueta-marca", "Gasta muito por visita"],
  ["fiel", "Fiel", "etiqueta-ok", "Vem sempre"],
  ["novo", "Novo", "etiqueta-info", "Veio uma vez só"],
  ["comum", "Comum", "", "Aparece de vez em quando"],
];
const SELO_POR_ID = Object.fromEntries(SELOS.map(([id, nome, classe, dica]) => [id, { nome, classe, dica }]));

/** "há 3 dias", "há 2 meses" — como quem fala, não como quem conta dias. */
function faltaHaQuantoTempo(dias) {
  if (dias === null || dias === undefined) return "nunca veio";
  if (dias === 0) return "veio hoje";
  if (dias === 1) return "veio ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
  const anos = Math.floor(meses / 12);
  return anos === 1 ? "há 1 ano" : `há ${anos} anos`;
}

/** "25/12/1990" ou "25/12" — como uma pessoa escreve e lê uma data. */
function nascimentoLegivel(c) {
  if (!c.nascimento_dia || !c.nascimento_mes) return "";
  const base = `${String(c.nascimento_dia).padStart(2, "0")}/${String(c.nascimento_mes).padStart(2, "0")}`;
  return c.nascimento_ano ? `${base}/${c.nascimento_ano}` : base;
}

/** "25/12/2026, quinta" — a data como quem lê uma agenda. */
function diaLegivel(dia) {
  const [ano, mes, d] = String(dia ?? "").split("-");
  if (!ano || !mes || !d) return String(dia ?? "");
  // Meio-dia UTC: em qualquer fuso do Brasil o dia continua o mesmo, e sem
  // isso "2026-08-28" vira 27 de agosto na virada.
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(d), 12));
  const semana = data.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
  return `${d}/${mes}/${ano}, ${semana}`;
}

/** "(65) 99999-0000" a partir do que está guardado com o 55 na frente. */
function telefoneLegivel(bruto) {
  const d = String(bruto ?? "").replace(/\D/g, "");
  const nacional = d.startsWith("55") ? d.slice(2) : d;
  if (nacional.length === 11) return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`;
  if (nacional.length === 10) return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`;
  return bruto ?? "";
}

/**
 * A nota que a pessoa deu, na régua do NPS.
 *
 * 9 e 10 promotor, 7 e 8 neutro, de 0 a 6 detrator. A cor importa mais que o
 * número: o gerente varre a lista com o olho, e vermelho é quem merece um
 * telefonema antes de qualquer campanha de aniversário.
 */
function selosDaNota(nps) {
  if (!nps || !nps.respostas) return null;
  const variante = nps.media >= 9 ? "etiqueta-ok" : nps.media >= 7 ? "etiqueta-alerta" : "etiqueta-perigo";
  const texto = nps.respostas > 1 ? `nota ${nps.media} · ${nps.respostas} respostas` : `nota ${nps.media}`;
  return etiqueta(texto, variante);
}

/**
 * "ditado-popular" vira "Ditado Popular".
 *
 * Só para a prévia enquanto se escreve: ali o nome de verdade ainda não está
 * em mãos, e mostrar o slug cru no meio de uma frase de campanha atrapalha
 * mais do que ajuda. Na mensagem que sai, quem preenche {casa} é o servidor,
 * com o nome cadastrado.
 */
function nomeAproximadoDaCasa(slug) {
  return String(slug ?? "")
    .split("-")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * O que aconteceu com a mensagem daquela pessoa.
 *
 * "Enfileirado" não é "entregue": entre uma coisa e outra estão o conector, o
 * WhatsApp e o número da pessoa. Sem este selo, um disparo em que metade
 * falhou parece um disparo inteiro — e foi assim que se perdeu meia lista sem
 * ninguém ter onde olhar.
 */
function seloDoEnvio(envio) {
  if (!envio) return null;
  if (envio.status === "sent") {
    const hora = envio.enviado_em
      ? new Date(envio.enviado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "";
    return etiqueta(hora ? `entregue ${hora}` : "entregue", "etiqueta-ok");
  }
  if (envio.status === "failed") {
    return etiqueta(envio.erro ? `falhou: ${envio.erro.slice(0, 60)}` : "falhou", "etiqueta-perigo");
  }
  // pending: saiu da tela e está com o conector. Numa casa cujo número
  // administrativo caiu, é aqui que a fila fica parada — e é isto que o
  // gerente precisa ver antes de achar que mandou.
  return etiqueta("na fila, ainda não entregue", "etiqueta-alerta");
}

/** "faz aniversário hoje", "…amanhã", "…em 12 dias". */
function quandoFaz(dias) {
  if (dias === 0) return "faz aniversário hoje";
  if (dias === 1) return "faz aniversário amanhã";
  return `faz aniversário em ${dias} dias`;
}

export async function clientesDaCasa(raiz, ctx) {
  let abaAtiva = "lista";
  const corpo = el("div", {});

  const ABAS = [
    ["lista", "Clientes"],
    ["aniversarios", "Aniversariantes"],
    ["parabens", "Parabéns"],
    ["disparos", "Disparos"],
  ];
  const barra = el(
    "div",
    { classe: "abas" },
    ABAS.map(([id, rotulo]) =>
      el("button", {
        classe: `aba ${id === abaAtiva ? "aba-ativa" : ""}`.trim(),
        type: "button",
        texto: rotulo,
        "data-aba": id,
        onclick: () => trocarAba(id),
      }),
    ),
  );

  function trocarAba(id) {
    abaAtiva = id;
    for (const b of barra.querySelectorAll(".aba")) {
      b.classList.toggle("aba-ativa", b.dataset.aba === id);
    }
    desenharAba();
  }

  raiz.append(el("div", { classe: "pilha" }, [barra, corpo]));
  desenharAba();

  function desenharAba() {
    limpar(corpo);
    if (abaAtiva === "lista") abaLista();
    else if (abaAtiva === "aniversarios") abaAniversarios();
    else if (abaAtiva === "disparos") abaDisparos();
    else abaParabens();
  }

  /* ================= A lista ================= */

  async function abaLista() {
    limpar(corpo);
    corpo.append(el("p", { classe: "muted", texto: "Carregando os clientes…" }));

    const busca = el("input", {
      classe: "campo",
      placeholder: "🔍  Buscar por nome ou telefone…",
      style: "flex:2",
    });
    const filtroOrigem = el(
      "select",
      { classe: "select", style: "flex:1" },
      [
        el("option", { value: "", texto: "De qualquer origem" }),
        ...Object.entries(NOME_DA_ORIGEM).map(([v, t]) => el("option", { value: v, texto: t })),
      ],
    );
    const lista = el("div", { classe: "tabela" });
    const tiras = el("div", { classe: "crm-tiras" });
    // Qual selo está filtrando agora. `null` = a base inteira.
    let seloAtivo = null;

    /* ---- Importar planilha ----
     *
     * O seletor de arquivo fica escondido e um botão comum o aciona: um
     * `<input type=file>` cru na barra de ferramentas mostra "Nenhum arquivo
     * selecionado" para sempre e não se parece com nada do resto da tela.
     *
     * Escolher o arquivo já faz a PRÉVIA sozinha — ninguém escolhe uma
     * planilha para depois não querer ver o que tem nela. O que exige clique
     * é gravar, que é o passo que mexe na base.
     */
    const painelDaPlanilha = el("div", {});
    const escolherPlanilha = el("input", {
      type: "file",
      accept: ".xlsx,.csv",
      style: "display:none",
    });

    const mostrarPlanilha = async (confirmar, botao) => {
      const arquivo = escolherPlanilha.files?.[0];
      if (!arquivo) return;
      if (botao) botao.disabled = true;
      limpar(painelDaPlanilha);
      painelDaPlanilha.append(
        el("p", { classe: "muted", texto: confirmar ? "Importando…" : "Lendo a planilha…" }),
      );
      try {
        const r = await postArquivo(
          `/v1/venues/${ctx.venue}/clientes/planilha${confirmar ? "?confirmar=1" : ""}`,
          arquivo,
        );
        if (r.previa) desenharPrevia(r, arquivo.name);
        else {
          limpar(painelDaPlanilha);
          // O input guarda o arquivo escolhido; sem limpar, escolher a MESMA
          // planilha de novo não dispara `change` e a tela parece travada.
          escolherPlanilha.value = "";
          avisar(
            `${r.importados} pessoa(s) na base.` +
              (r.com_aniversario ? ` ${r.com_aniversario} com aniversário.` : ""),
            r.importados ? "ok" : "info",
          );
          await recarregar();
        }
      } catch (e) {
        limpar(painelDaPlanilha);
        painelDaPlanilha.append(vazio("Não deu para ler a planilha", e.message));
      } finally {
        if (botao) botao.disabled = false;
      }
    };

    function desenharPrevia(r, nomeDoArquivo) {
      limpar(painelDaPlanilha);
      const linhasRuins = r.recusadas ?? [];
      painelDaPlanilha.append(
        el("section", { classe: "cartao" }, [
          el("h3", { texto: `Planilha lida: ${nomeDoArquivo}` }),
          el("p", {
            texto:
              `${r.validos} pessoa(s) com telefone válido` +
              (r.com_aniversario ? ` · ${r.com_aniversario} com aniversário` : "") +
              (r.total_recusadas ? ` · ${r.total_recusadas} linha(s) recusada(s)` : ""),
          }),
          // Este é o aviso que evita o prejuízo silencioso: a pessoa entra na
          // base sem data, e a casa só descobre no ano seguinte, quando o
          // parabéns não sai.
          r.data_ilegivel
            ? el("p", {
                classe: "aviso aviso-alerta",
                style: "margin-top:8px",
                texto:
                  `${r.data_ilegivel} linha(s) têm data que não consegui entender. ` +
                  `Use 25/12/1990 ou 1990-12-25 — essas pessoas entram na base, mas sem aniversário.`,
              })
            : null,
          r.validos && !r.com_aniversario
            ? el("p", {
                classe: "muted",
                texto:
                  "Nenhum aniversário veio nesta planilha. Se ela tem essa coluna, " +
                  'renomeie o cabeçalho para "aniversário" ou "nascimento" e mande de novo.',
              })
            : null,
          linhasRuins.length
            ? el("ul", { classe: "muted", style: "margin:6px 0 0;padding-left:20px" },
                linhasRuins.slice(0, 8).map((x) =>
                  el("li", { texto: `linha ${x.linha}: ${x.motivo}` }),
                ))
            : null,
          r.validos
            ? el("p", {
                classe: "muted",
                style: "margin-top:10px",
                texto:
                  "Quem já está na base não vira linha nova: a planilha só preenche o que " +
                  "estiver em branco na ficha. Nada que você já tem é apagado.",
              })
            : null,
          el("div", { classe: "linha-campos", style: "margin-top:12px" }, [
            r.validos
              ? el("button", {
                  classe: "btn btn-primario",
                  type: "button",
                  texto: `Importar ${r.validos} pessoa(s)`,
                  onclick: (e) => mostrarPlanilha(true, e.target),
                })
              : null,
            el("button", {
              classe: "btn",
              type: "button",
              texto: "Cancelar",
              onclick: () => {
                limpar(painelDaPlanilha);
                escolherPlanilha.value = "";
              },
            }),
          ].filter(Boolean)),
        ].filter(Boolean)),
      );
    }

    escolherPlanilha.addEventListener("change", () => mostrarPlanilha(false, null));

    // A busca vai ao servidor, e não filtra em memória: a base pode ter
    // dezenas de milhares de pessoas, e baixar tudo para filtrar no navegador
    // é o tipo de coisa que funciona no teste do dono e trava no cliente
    // grande. Espera a digitação parar antes de perguntar.
    let temporizador = null;
    const recarregar = async () => {
      const params = new URLSearchParams();
      if (busca.value.trim()) params.set("busca", busca.value.trim());
      if (filtroOrigem.value) params.set("origem", filtroOrigem.value);
      if (seloAtivo) params.set("selo", seloAtivo);
      try {
        const achados = await get(`/v1/venues/${ctx.venue}/clientes?${params}`);
        desenharLinhas(achados);
      } catch (e) {
        limpar(lista);
        lista.append(vazio("Não deu para carregar", e.message));
      }
    };
    busca.addEventListener("input", () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(recarregar, 300);
    });
    filtroOrigem.addEventListener("change", recarregar);

    /**
     * O retrato da base, em tiras que também são o filtro.
     *
     * Dois trabalhos num componente só porque são a mesma pergunta: ninguém
     * pergunta "quantos sumidos eu tenho?" sem querer, no segundo seguinte,
     * ver quem são. Clicar de novo na tira acesa volta para a base inteira.
     *
     * O resumo vem de uma rota à parte e atravessa a base toda — a lista é
     * uma página dela. Juntar os dois faria cada letra digitada na busca
     * recontar a base inteira.
     */
    async function desenharTiras() {
      let resumo;
      try {
        resumo = await get(`/v1/venues/${ctx.venue}/clientes/resumo`);
      } catch {
        // Sem resumo a lista continua de pé: é enfeite útil, não alicerce.
        limpar(tiras);
        return;
      }

      limpar(tiras);
      tiras.append(
        tira(null, "Todos", resumo.total, resumo.gasto_total_centavos
          ? `${dinheiro(resumo.gasto_total_centavos / 100)} no total`
          : "ninguém consumiu ainda"),
        ...SELOS.filter(([id]) => id !== "comum").map(([id, nome, , dica]) =>
          tira(id, nome, resumo.por_selo?.[id] ?? 0, dica)),
      );
    }

    function tira(id, nome, quantos, dica) {
      const ligada = seloAtivo === id;
      return el("button", {
        classe: `crm-tira ${ligada ? "crm-tira-ligada" : ""}`.trim(),
        type: "button",
        title: dica,
        onclick: () => {
          // Clicar na tira acesa apaga o filtro: é o gesto que todo mundo
          // tenta quando quer voltar a ver tudo.
          seloAtivo = ligada ? null : id;
          void desenharTiras();
          void recarregar();
        },
      }, [
        el("span", { classe: "crm-tira-numero", texto: String(quantos) }),
        el("span", { classe: "crm-tira-rotulo", texto: nome }),
      ]);
    }

    function desenharLinhas(achados) {
      limpar(lista);
      if (!achados.length) {
        lista.append(
          vazio(
            "Nenhum cliente aqui",
            busca.value.trim() || filtroOrigem.value || seloAtivo
              ? "Tente outra busca, ou tire os filtros."
              : "A base enche sozinha: quem passa na Zig, quem escreve no WhatsApp e quem responde a pesquisa entram aqui. Você também pode cadastrar à mão.",
          ),
        );
        return;
      }
      for (const c of achados) lista.append(linha(c));
    }

    /**
     * Uma pessoa na lista.
     *
     * Quatro números à direita, sempre nos mesmos lugares: consumo, visitas,
     * ticket e quando veio pela última vez. Alinhados em coluna de propósito
     * — é assim que o olho compara vinte linhas sem ler nenhuma.
     *
     * O ticket é o que está aqui e não estava antes, e é o que separa o
     * freguês da quinta-feira da mesa que fecha o aniversário. Os dois podem
     * ter o mesmo total acumulado e não são a mesma pessoa.
     */
    function linha(c) {
      const nasc = nascimentoLegivel(c);
      const selo = SELO_POR_ID[c.selo];
      const sumiu = c.selo === "sumido";

      return el("button", { classe: "linha-tabela", type: "button", onclick: () => ficha(c) }, [
        el("span", { classe: "linha-principal" }, [
          el("span", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, [
            el("strong", { texto: c.nome || telefoneLegivel(c.telefone) }),
            selo && c.selo !== "comum" ? etiqueta(selo.nome, selo.classe) : null,
            c.descadastrado_em ? etiqueta("não quer mensagem", "etiqueta-perigo") : null,
            selosDaNota(c.nps),
          ].filter(Boolean)),
          el("small", {
            classe: "muted",
            texto: [
              c.nome ? telefoneLegivel(c.telefone) : null,
              nasc ? `🎂 ${nasc}` : null,
              (c.origens ?? []).map((o) => NOME_DA_ORIGEM[o] ?? o).join(" · "),
            ].filter(Boolean).join(" · "),
          }),
        ]),
        el("span", { classe: "crm-numeros" }, [
          numero(c.gasto_centavos ? dinheiro(c.gasto_centavos / 100) : "—", "consumo"),
          numero(String(c.visitas ?? 0), c.visitas === 1 ? "visita" : "visitas"),
          numero(c.ticket_centavos !== null ? dinheiro(c.ticket_centavos / 100) : "—", "por visita"),
          numero(faltaHaQuantoTempo(c.dias_sem_vir), "última vez", sumiu),
        ]),
      ]);
    }

    function numero(valor, rotulo, perigo = false) {
      return el("span", { classe: `crm-numero ${perigo ? "crm-numero-perigo" : ""}`.trim() }, [
        el("strong", { texto: valor }),
        el("span", { texto: rotulo }),
      ]);
    }

    limpar(corpo);
    corpo.append(
      el("div", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Clientes" }),
            el("p", {
              classe: "muted",
              texto: "Quem já esteve na casa. A base enche sozinha pela Zig, pelo WhatsApp do agente e pela pesquisa — e você cadastra à mão quem faltar.",
            }),
          ]),
          el("div", { classe: "linha-campos" }, [
            puxarDaZig(recarregar),
            escolherPlanilha,
            el("button", {
              classe: "btn",
              type: "button",
              texto: "Importar planilha",
              title: "Traga uma lista de clientes de .xlsx ou .csv",
              onclick: () => escolherPlanilha.click(),
            }),
            el("button", {
              classe: "btn btn-primario",
              type: "button",
              texto: "+ Novo cliente",
              onclick: () => ficha(null),
            }),
          ]),
        ]),
        painelDaPlanilha,
        tiras,
        el("div", { classe: "linha-campos" }, [busca, filtroOrigem]),
        lista,
      ]),
    );
    // Em paralelo: a lista e o resumo são duas perguntas independentes, e
    // esperar uma para começar a outra dobraria o tempo de tela em branco.
    await Promise.all([recarregar(), desenharTiras()]);
  }

  /**
   * O botão de puxar a Zig na mão.
   *
   * A varredura já faz isto sozinha, de hora em hora — este botão não existe
   * porque falta automação, existe porque "está funcionando?" precisa de
   * resposta em cinco segundos, e não amanhã. No primeiro dia, ninguém quer
   * esperar o relógio para saber se o token está certo.
   *
   * O dia padrão é ONTEM, e não hoje, pelo mesmo motivo do convite: o
   * movimento de hoje ainda está acontecendo, e a conta da mesa que ainda não
   * fechou não está na Zig.
   */
  function puxarDaZig(aoTerminar) {
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const dia = el("input", { classe: "campo", type: "date", value: ontem, style: "max-width:170px" });

    const botao = el("button", {
      classe: "btn",
      type: "button",
      texto: "Puxar da Zig",
      onclick: async () => {
        botao.disabled = true;
        const rotulo = botao.textContent;
        botao.textContent = "Buscando…";
        try {
          // `forcar` porque foi um humano que pediu: se ele apertou de novo,
          // é porque quer conferir, e não porque esqueceu que já apertou.
          const r = await post(`/v1/venues/${ctx.venue}/clientes/zig`, {
            dia: dia.value,
            forcar: true,
          });
          avisar(
            r.visitantes
              ? `${r.visitantes} pessoa(s) de ${dia.value.split("-").reverse().join("/")} na base.`
              : `A Zig não trouxe ninguém em ${dia.value.split("-").reverse().join("/")}.`,
            r.visitantes ? "ok" : "info",
          );
          await aoTerminar();
        } catch (e) {
          avisar(e.message, "erro");
        } finally {
          botao.disabled = false;
          botao.textContent = rotulo;
        }
      },
    });

    return el("div", { classe: "linha-campos", style: "flex:0 0 auto" }, [dia, botao]);
  }

  /* ================= A ficha de um cliente ================= */

  function ficha(existente) {
    limpar(corpo);
    const campos = {
      telefone: el("input", {
        classe: "campo",
        value: existente ? telefoneLegivel(existente.telefone) : "",
        placeholder: "(65) 99999-0000",
        disabled: Boolean(existente),
      }),
      nome: el("input", { classe: "campo", value: existente?.nome ?? "", placeholder: "Maria Silva" }),
      nascimento: el("input", {
        classe: "campo",
        value: existente ? nascimentoLegivel(existente) : "",
        placeholder: "25/12/1990 — ou só 25/12",
      }),
      email: el("input", { classe: "campo", type: "email", value: existente?.email ?? "" }),
      documento: el("input", { classe: "campo", value: existente?.documento ?? "" }),
      // `texto` e não `value`: num textarea o conteúdo é o filho, e um
      // `value=""` de atributo mostraria o campo vazio — o gerente abriria a
      // ficha, veria em branco e salvaria por cima do que já estava escrito.
      observacoes: el("textarea", { classe: "campo", rows: 3, texto: existente?.observacoes ?? "" }),
      descadastrado: el("input", { type: "checkbox", checked: Boolean(existente?.descadastrado_em) }),
    };

    const linha = (rotulo, campo, ajuda) =>
      el("label", { classe: "campo-rotulado" }, [
        el("span", { texto: rotulo }),
        campo,
        ajuda ? el("small", { classe: "muted", texto: ajuda }) : null,
      ].filter(Boolean));

    corpo.append(
      el("section", { classe: "cartao pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("h2", { texto: existente ? (existente.nome || telefoneLegivel(existente.telefone)) : "Novo cliente" }),
          el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: () => trocarAba("lista") }),
        ]),
        linha(
          "Telefone",
          campos.telefone,
          existente
            ? "O telefone é a identidade do cliente e não muda. Se estiver errado, apague e cadastre de novo."
            : "Com DDD. É por ele que a pessoa é reconhecida quando volta.",
        ),
        linha("Nome", campos.nome),
        linha("Nascimento", campos.nascimento, "Só o dia e o mês já bastam para o parabéns."),
        el("div", { classe: "linha-campos" }, [
          linha("E-mail", campos.email),
          linha("CPF ou documento", campos.documento),
        ]),
        linha("Observações", campos.observacoes, "O que a equipe precisa lembrar: mesa preferida, alergia, é do time do…"),
        el("label", { classe: "campo-caixa" }, [
          campos.descadastrado,
          el("span", {}, [
            el("strong", { texto: " Não quer receber mensagens" }),
            el("small", {
              classe: "muted",
              texto: " — marque quando a pessoa pedir para sair. Ela some de todo envio, e insistir com quem pediu para sair é o que derruba o WhatsApp da casa.",
            }),
          ]),
        ]),
        existente
          ? el("p", {
              classe: "muted",
              texto: `Origem: ${(existente.origens ?? []).map((o) => NOME_DA_ORIGEM[o] ?? o).join(", ") || "—"}` +
                (existente.ultima_visita ? ` · última visita em ${existente.ultima_visita.split("-").reverse().join("/")}` : ""),
            })
          : null,
        el("div", { classe: "linha-campos" }, [
          el("button", { classe: "btn btn-primario", type: "button", texto: "Salvar", onclick: salvar }),
          existente
            ? el("button", {
                classe: "btn btn-peq",
                type: "button",
                texto: "Apagar cliente",
                onclick: apagar,
              })
            : null,
        ].filter(Boolean)),
      ].filter(Boolean)),
    );

    // O passado dela, embaixo da ficha. Só para quem já existe: cliente sendo
    // cadastrado agora não tem passado a mostrar.
    if (existente) {
      corpo.append(historicoDeVisitas(existente));
      corpo.append(vozDoCliente(existente));
    }

    async function salvar() {
      try {
        if (existente) {
          await patch(`/v1/venues/${ctx.venue}/clientes/${existente.id}`, {
            nome: campos.nome.value,
            nascimento: campos.nascimento.value,
            email: campos.email.value,
            documento: campos.documento.value,
            observacoes: campos.observacoes.value,
            descadastrado: campos.descadastrado.checked,
          });
        } else {
          if (campos.telefone.value.replace(/\D/g, "").length < 10) {
            return avisar("Falta o telefone com DDD.", "erro");
          }
          await post(`/v1/venues/${ctx.venue}/clientes`, {
            telefone: campos.telefone.value,
            nome: campos.nome.value,
            nascimento: campos.nascimento.value,
            email: campos.email.value,
            documento: campos.documento.value,
            observacoes: campos.observacoes.value,
          });
        }
        avisar("Cliente salvo.", "ok");
        trocarAba("lista");
      } catch (e) {
        avisar(e.message, "erro");
      }
    }

    async function apagar() {
      if (!confirm("Apagar este cliente? O cadastro some de vez — o histórico de vendas e respostas fica.")) return;
      try {
        await del(`/v1/venues/${ctx.venue}/clientes/${existente.id}`);
        avisar("Cliente apagado.", "ok");
        trocarAba("lista");
      } catch (e) {
        avisar(e.message, "erro");
      }
    }
  }

  /* ================= O histórico de visitas ================= */

  /**
   * Quando a pessoa veio e quanto gastou, visita a visita.
   *
   * É o que separa "um telefone na lista" de "um cliente". Dois números
   * soltos — 7 visitas, R$ 483 — não dizem se ela vinha toda semana e sumiu
   * há dois meses, que é exatamente a informação que decide se vale ligar
   * para ela antes do aniversário.
   *
   * O intervalo entre a primeira e a última visita, no rodapé, responde a
   * pergunta que o gerente faz de verdade: "de quanto em quanto tempo esse
   * cliente volta?".
   */
  function historicoDeVisitas(cliente) {
    const caixa = el("section", { classe: "cartao pilha" }, [
      el("h3", { texto: "Histórico de visitas" }),
      el("p", { classe: "muted", texto: "Carregando…" }),
    ]);

    get(`/v1/venues/${ctx.venue}/clientes/${cliente.id}/visitas`)
      .then((visitas) => {
        limpar(caixa).append(el("h3", { texto: "Histórico de visitas" }));
        if (!visitas.length) {
          caixa.append(
            el("p", {
              classe: "muted",
              texto: cliente.visitas
                ? `${cliente.visitas} visita(s) registradas antes de o histórico existir — a partir de agora cada dia entra aqui.`
                : "Nenhuma visita registrada ainda. A Zig alimenta esta lista todo dia.",
            }),
          );
          return;
        }

        const total = visitas.reduce((s, v) => s + Number(v.gasto_centavos ?? 0), 0);
        const comGasto = visitas.filter((v) => Number(v.gasto_centavos) > 0);
        const ticket = comGasto.length ? total / comGasto.length : 0;

        caixa.append(
          el("p", { classe: "muted" }, [
            el("strong", { texto: `${visitas.length} visita${visitas.length > 1 ? "s" : ""}` }),
            el("span", { texto: ` · ${dinheiro(total / 100)} no total` }),
            comGasto.length
              ? el("span", { texto: ` · ${dinheiro(ticket / 100)} por visita` })
              : null,
          ].filter(Boolean)),
        );

        const lista = el("div", { classe: "tabela" });
    const tiras = el("div", { classe: "crm-tiras" });
    // Qual selo está filtrando agora. `null` = a base inteira.
    let seloAtivo = null;
        for (const v of visitas) {
          lista.append(
            el("div", { classe: "linha-tabela" }, [
              el("span", { classe: "linha-principal" }, [
                el("strong", { texto: diaLegivel(v.dia) }),
                el("small", { classe: "muted", texto: NOME_DA_ORIGEM[v.origem] ?? v.origem }),
              ]),
              el("span", { classe: "linha-detalhes" }, [
                Number(v.gasto_centavos) > 0
                  ? el("strong", { texto: dinheiro(Number(v.gasto_centavos) / 100) })
                  : el("span", { classe: "muted", texto: "sem consumo no nome dela" }),
              ]),
            ]),
          );
        }
        caixa.append(lista);
      })
      .catch(() => {
        limpar(caixa).append(
          el("h3", { texto: "Histórico de visitas" }),
          el("p", { classe: "muted", texto: "Não deu para carregar o histórico agora." }),
        );
      });

    return caixa;
  }

  /* ================= O que este cliente achou da casa ================= */

  /**
   * A voz da pessoa dentro da ficha dela.
   *
   * Aqui está a junção entre a base de clientes e a pesquisa, e ela é de
   * propósito num só lugar: a ficha. Uma aba paralela obrigaria o gerente a
   * cruzar duas telas para saber que a aniversariante de sexta é a mesma que
   * escreveu "demorou 40 minutos" — e mandar parabéns para ela sem saber
   * disso é pior que não mandar.
   *
   * Casa sem o módulo vê o bloco apagado. Não é propaganda no vazio: é o
   * momento exato em que a falta se sente, olhando a ficha de um cliente de
   * verdade sem saber o que ele achou da casa.
   */
  function vozDoCliente(cliente) {
    const caixa = el("section", { classe: "cartao pilha" }, [
      el("h3", { texto: "O que essa pessoa achou da casa" }),
    ]);

    if (!ctx.temModulo("pesquisa")) {
      caixa.dataset.apagado = "1";
      caixa.append(
        el("p", {
          classe: "muted",
          texto: "Com a Voz do Cliente, aqui aparecem as notas e os comentários que esta pessoa deixou — e você sabe quem elogiou e quem precisa de um telefonema antes de mandar qualquer mensagem.",
        }),
      );
      return caixa;
    }

    caixa.append(el("p", { classe: "muted", texto: "Carregando as respostas…" }));
    get(`/v1/venues/${ctx.venue}/clientes/${cliente.id}/avaliacoes`)
      .then((respostas) => {
        limpar(caixa).append(el("h3", { texto: "O que essa pessoa achou da casa" }));
        if (!respostas.length) {
          caixa.append(
            el("p", {
              classe: "muted",
              texto: "Ainda não respondeu à pesquisa. Convide na aba Convites, em Ajustes da pesquisa.",
            }),
          );
          return;
        }
        for (const r of respostas) caixa.append(umaResposta(r));
      })
      .catch(() => {
        limpar(caixa).append(el("h3", { texto: "O que essa pessoa achou da casa" }));
        caixa.append(el("p", { classe: "muted", texto: "Não deu para carregar as respostas agora." }));
      });

    return caixa;
  }

  function umaResposta(r) {
    const variante = r.nota >= 9 ? "etiqueta-ok" : r.nota >= 7 ? "etiqueta-alerta" : "etiqueta-perigo";
    const dia = String(r.created_at ?? "").slice(0, 10).split("-").reverse().join("/");
    return el("div", { classe: "linha-tabela" }, [
      el("span", { classe: "linha-principal" }, [
        // O que ela ESCREVEU vem primeiro e em destaque: a nota é o resumo, a
        // frase é o motivo — e é o motivo que faz alguém agir.
        r.comentario
          ? el("strong", { texto: `“${r.comentario}”` })
          : el("strong", { classe: "muted", texto: "Deu a nota, sem escrever nada." }),
        el("small", {
          classe: "muted",
          texto: [
            dia,
            ...(r.elogios ?? []).map((e) => `👍 ${e}`),
            ...(r.criticas ?? []).map((c) => `👎 ${c}`),
          ].join(" · "),
        }),
      ]),
      el("span", { classe: "linha-detalhes" }, [etiqueta(`nota ${r.nota}`, variante)]),
    ]);
  }

  /* ================= Aniversariantes ================= */

  /** Por que a agenda está vazia — com o número que explica. */
  async function porQueVazio() {
    let p;
    try {
      p = await get(`/v1/venues/${ctx.venue}/aniversariantes/panorama`);
    } catch {
      return vazio("Ninguém faz aniversário nos próximos 45 dias", "");
    }

    const casa = ctx.venue;

    if (!p.na_base) {
      return vazio(
        `A base de ${casa} está vazia`,
        "Nenhum cliente cadastrado nesta casa ainda. Se você esperava ver gente aqui, confira lá em cima se o painel está na casa certa.",
      );
    }
    if (!p.com_data) {
      return vazio(
        `Nenhuma das ${p.na_base} pessoas de ${casa} tem data de nascimento`,
        "A Zig traz a data de quem preencheu no cadastro dela — se esta casa não usa a Zig, ou se ninguém preencheu, a base vem sem aniversário. Você pode importar uma planilha com as datas ou digitar na ficha de cada um.",
      );
    }

    // O caso que mais confundia: a base TEM datas, só nenhuma agora.
    const quando = p.proximo
      ? `O próximo é ${p.proximo.nome ? `de ${p.proximo.nome}, ` : ""}daqui a ${p.proximo.dias_ate} dias (${diaLegivel(p.proximo.proximo)}).`
      : "";
    return vazio(
      "Ninguém faz aniversário nos próximos 45 dias",
      `${p.com_data} das ${p.na_base} pessoas da base têm data cadastrada — não é falta de dado. ${quando}`.trim(),
    );
  }

  async function abaAniversarios() {
    limpar(corpo);
    corpo.append(el("p", { classe: "muted", texto: "Carregando a agenda…" }));

    let pessoas;
    let config;
    try {
      [pessoas, config] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/aniversariantes?dias=45`),
        get(`/v1/venues/${ctx.venue}/clientes/config`),
      ]);
    } catch (e) {
      limpar(corpo);
      corpo.append(vazio("Não deu para carregar", e.message));
      return;
    }

    limpar(corpo);
    const lista = el("div", { classe: "pilha" });
    const marcas = [];
    let botaoEnviar = null;
    let contador = null;
    if (!pessoas.length) {
      // A TELA TEM DE DIZER O QUE ELA SABE.
      //
      // "Ninguém nos próximos 45 dias" cobria dois problemas opostos com a
      // mesma frase: a casa com 1.865 datas cujo próximo aniversário é em
      // novembro, e a casa sem data nenhuma cadastrada. Quem lia não tinha
      // como distinguir — e o mais provável era achar que a tela quebrou.
      lista.append(await porQueVazio());
    } else {
      // Uma caixa por pessoa, com a MENSAGEM à vista.
      //
      // Marcar sem ler o que vai sair é assinar em branco: o dono precisa ver
      // a frase inteira, com o nome e a data que o cliente vai ler, antes de
      // apertar. É por isso que a prévia vem do servidor, montada pelo mesmo
      // código que monta a mensagem de verdade — prévia feita na tela mente
      // no dia em que as duas se desencontram.
      for (const p of pessoas) {
        // "Já avisado" só trava quem foi ENTREGUE. Quem falhou ou está parado
        // na fila continua marcável: a mensagem dele nunca chegou.
        const entregue = p.envio?.status === "sent";
        const bloqueado = Boolean(p.descadastrado_em) || entregue || !p.telefone;
        const marca = el("input", {
          type: "checkbox",
          disabled: bloqueado,
          // Quem faz nos próximos dias já vem marcado: é o caso comum, e
          // desmarcar quem não interessa dá menos trabalho que marcar um a um.
          checked: !bloqueado && p.dias_ate <= 15,
        });
        marca.dataset.cliente = p.id;
        marcas.push({ marca, pessoa: p });

        lista.append(
          el("label", { classe: "cartao pilha", style: "cursor:pointer" }, [
            el("div", { classe: "cabecalho-secao", style: "margin-bottom:6px" }, [
              el("span", { classe: "linha-principal", style: "flex-direction:row;align-items:center;gap:10px" }, [
                marca,
                el("span", {}, [
                  el("strong", { texto: p.nome || telefoneLegivel(p.telefone) }),
                  el("br"),
                  el("small", {
                    classe: "muted",
                    texto: [
                      telefoneLegivel(p.telefone),
                      quandoFaz(p.dias_ate),
                      p.nascimento_ano
                        ? `faz ${Number(p.proximo.slice(0, 4)) - p.nascimento_ano} anos`
                        : null,
                    ].filter(Boolean).join(" · "),
                  }),
                ]),
              ]),
              el("span", { classe: "linha-detalhes" }, [
                p.descadastrado_em ? etiqueta("não quer mensagem", "etiqueta-perigo") : null,
                seloDoEnvio(p.envio),
                !p.telefone ? etiqueta("sem telefone", "etiqueta-alerta") : null,
                el("strong", {
                  texto: `${String(p.nascimento_dia).padStart(2, "0")}/${String(p.nascimento_mes).padStart(2, "0")}`,
                }),
              ].filter(Boolean)),
            ]),
            el("p", { classe: "previa-mensagem", texto: p.mensagem }),
            rodapeDoCartao(p, bloqueado),
          ]),
        );
      }
    }

    corpo.append(
      el("div", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Aniversariantes" }),
            el("p", {
              classe: "muted",
              texto: config.aniversario_ativo
                ? `Marque quem deve receber e confira a mensagem antes de enviar. O parabéns também sai sozinho às ${config.aniversario_hora}h, ${config.aniversario_antecedencia} dia(s) antes.`
                : "Marque quem deve receber e confira a mensagem antes de enviar. O envio automático está desligado — ligue na aba Parabéns se quiser que saia sozinho.",
            }),
          ]),
          marcas.length
            ? el("div", { classe: "linha-campos", style: "flex:0 0 auto" }, [
                el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: "Marcar todos",
                  onclick: () => marcarTodos(true),
                }),
                el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: "Desmarcar",
                  onclick: () => marcarTodos(false),
                }),
              ])
            : null,
        ].filter(Boolean)),
        lista,
        marcas.length ? rodapeDeEnvio() : null,
      ].filter(Boolean)),
    );

    /**
     * O rodapé do cartão: o motivo, ou o botão de mandar só para esta pessoa.
     *
     * O botão fica AQUI, e não só no fim da lista, porque na prática o gerente
     * abre a agenda, lê a mensagem de uma pessoa e quer mandar aquela. Rolar
     * até o rodapé para disparar quem está no topo da tela é o tipo de atrito
     * que faz a ferramenta ser usada pela metade.
     *
     * E quando não dá para mandar, o cartão DIZ POR QUÊ. Botão que some sem
     * explicação vira "o sistema não funciona".
     */
    function rodapeDoCartao(pessoa, bloqueado) {
      const area = el("div", { classe: "linha-campos", style: "align-items:center;margin-top:4px" });

      if (pessoa.descadastrado_em) {
        area.append(el("small", { classe: "muted", texto: "Pediu para não receber mensagens — não entra em nenhum envio." }));
        return area;
      }
      if (!pessoa.telefone) {
        area.append(el("small", { classe: "muted", texto: "Sem telefone na base. Cadastre na ficha para poder enviar." }));
        return area;
      }
      // Já entregue é ponto final: mandar de novo seria dois parabéns no
      // mesmo ano, que é justamente o que a trava existe para impedir.
      if (pessoa.envio?.status === "sent") {
        area.append(el("small", { classe: "muted", texto: "Já entregue. Cada pessoa recebe uma vez por ano." }));
        return area;
      }

      // Falhou ou está parada na fila: o botão vira SEGUNDA CHANCE. A trava de
      // um por ano impede entrega dobrada, não entrega nenhuma — e uma
      // mensagem que nunca chegou não é uma mensagem enviada.
      const jaTentou = Boolean(pessoa.envio);
      if (jaTentou) {
        area.append(
          el("small", {
            classe: "muted",
            style: "flex:1",
            texto:
              pessoa.envio.status === "failed"
                ? "O envio falhou. Com o WhatsApp da casa conectado, dá para tentar de novo."
                : "Na fila do conector. Se ficar parado, tente de novo com o WhatsApp da casa conectado.",
          }),
        );
      }

      const botao = el("button", {
        classe: "btn btn-peq",
        type: "button",
        texto: jaTentou ? "Tentar de novo" : "Mandar só para esta pessoa",
        onclick: async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const quem = pessoa.nome || telefoneLegivel(pessoa.telefone);
          if (!confirm(jaTentou
            ? `Tentar entregar de novo para ${quem}?\n\nA mensagem anterior não chegou.`
            : `Mandar o parabéns agora para ${quem}?`)) return;
          botao.disabled = true;
          botao.textContent = "Enviando…";
          try {
            const r = await post(`/v1/venues/${ctx.venue}/aniversariantes/enviar`, {
              clientes: [pessoa.id],
            });
            // Troca o rodapé no lugar, sem redesenhar a lista: redesenhar
            // jogaria a rolagem para o topo, que é justamente o incômodo que
            // este botão existe para resolver.
            limpar(area).append(
              el("small", {
                classe: "muted",
                texto: r.enfileirados
                  ? "Na fila do conector — vai sair em instantes."
                  : explicarResultado(r),
              }),
            );
            if (marca) marca.disabled = true;
            atualizarRodape();
          } catch (e) {
            avisar(e.message, "erro");
            botao.disabled = false;
            botao.textContent = jaTentou ? "Tentar de novo" : "Mandar só para esta pessoa";
          }
        },
      });
      // `bloqueado` cobre o que a lista já sabe; o botão confere de novo por
      // segurança, mas a essa altura ele nem chega a ser desenhado.
      botao.disabled = bloqueado;
      const marca = marcas.find((m) => m.pessoa.id === pessoa.id)?.marca ?? null;
      area.append(botao);
      return area;
    }

    /**
     * Por que não saiu ninguém, em português.
     *
     * O servidor devolve os quatro motivos separados; mostrar só "0 enviados"
     * transforma uma explicação completa em mistério. Foi o que aconteceu num
     * disparo em que parte da lista não saiu: a resposta estava ali e a tela
     * jogava fora.
     */
    function explicarResultado(r) {
      const partes = [];
      if (r.repetidos) partes.push(`${r.repetidos} já tinham recebido este ano`);
      if (r.alem_do_teto) partes.push(`${r.alem_do_teto} ficaram para amanhã (teto do dia)`);
      if (r.sem_telefone) partes.push(`${r.sem_telefone} sem telefone`);
      return partes.length ? partes.join(" · ") : "Ninguém elegível nesta seleção.";
    }

    function marcarTodos(valor) {
      for (const { marca } of marcas) if (!marca.disabled) marca.checked = valor;
      atualizarRodape();
    }

    /**
     * O rodapé que diz em cima de quantos vai agir.
     *
     * O número vai no PRÓPRIO botão, e não numa linha acima: é o último lugar
     * onde o olho passa antes do clique, e disparo em massa merece que a
     * conta esteja ali.
     */
    function rodapeDeEnvio() {
      contador = el("p", { classe: "muted" });
      botaoEnviar = el("button", {
        classe: "btn btn-primario",
        type: "button",
        onclick: mandarAosMarcados,
      });
      for (const { marca } of marcas) marca.addEventListener("change", atualizarRodape);
      const rodape = el("section", { classe: "cartao linha-campos", style: "align-items:center" }, [
        contador,
        el("span", { style: "margin-left:auto" }, [botaoEnviar]),
      ]);
      atualizarRodape();
      return rodape;
    }

    function escolhidos() {
      return marcas.filter(({ marca }) => marca.checked && !marca.disabled);
    }

    function atualizarRodape() {
      if (!botaoEnviar) return;
      const n = escolhidos().length;
      botaoEnviar.textContent = n === 1 ? "Mandar para 1 pessoa" : `Mandar para ${n} pessoas`;
      botaoEnviar.disabled = n === 0;
      const fora = marcas.filter(({ marca }) => marca.disabled).length;
      contador.textContent = fora
        ? `${n} marcado(s) · ${fora} fora da lista (já avisados, sem telefone ou que pediram para não receber)`
        : `${n} marcado(s)`;
    }

    async function mandarAosMarcados() {
      const alvos = escolhidos();
      if (!alvos.length) return;
      const nomes = alvos.slice(0, 3).map(({ pessoa }) => pessoa.nome || pessoa.telefone).join(", ");
      const resto = alvos.length > 3 ? ` e mais ${alvos.length - 3}` : "";
      if (!confirm(`Mandar o parabéns agora para ${nomes}${resto}?\n\nCada pessoa recebe uma vez por ano.`)) return;

      botaoEnviar.disabled = true;
      try {
        const r = await post(`/v1/venues/${ctx.venue}/aniversariantes/enviar`, {
          clientes: alvos.map(({ pessoa }) => pessoa.id),
        });
        // O resultado INTEIRO, e não só o número que saiu: quem ficou de
        // fora e por quê é a metade da informação que faltava.
        const fora = explicarResultado(r);
        const detalhe = r.enfileirados && fora !== "Ninguém elegível nesta seleção." ? ` · ${fora}` : "";
        avisar(
          r.enfileirados
            ? `${r.enfileirados} parabéns na fila de envio${detalhe}.`
            : fora,
          r.enfileirados ? "ok" : "info",
        );
        abaAniversarios();
      } catch (e) {
        avisar(e.message, "erro");
        botaoEnviar.disabled = false;
      }
    }
  }

  /* ================= Disparos ================= */

  /**
   * A casa fala com a base — pelo número oficial, por modelo aprovado.
   *
   * A lista de disparos em cima, o formulário de um novo embaixo. Um
   * disparo é escolhido, não escrito: o modelo vem da Meta, as lacunas
   * dele são preenchidas com quem recebe, e o público sai dos selos do CRM.
   */
  async function abaDisparos() {
    limpar(corpo);
    corpo.append(el("p", { classe: "muted", texto: "Carregando os disparos…" }));

    let disparos = [];
    let modelos = null;
    let erroDosModelos = null;
    try {
      [disparos, modelos] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/disparos`),
        get(`/v1/venues/${ctx.venue}/whatsapp-oficial/modelos`).catch((e) => {
          erroDosModelos = e.message;
          return null;
        }),
      ]);
    } catch (e) {
      limpar(corpo);
      corpo.append(vazio("Não deu para carregar", e.message));
      return;
    }
    if (!Array.isArray(modelos)) modelos = null;

    limpar(corpo);
    corpo.append(el("div", { classe: "pilha" }, [listaDeDisparos(disparos), formularioDeDisparo(modelos, erroDosModelos)].filter(Boolean)));

    function listaDeDisparos(lista) {
      if (lista.length === 0) {
        return el("section", { classe: "cartao" }, [
          el("h2", { texto: "Disparos" }),
          el("p", { classe: "muted", texto: "Nenhum disparo ainda. O primeiro costuma ser o mais fácil: uma mensagem para quem sumiu." }),
        ]);
      }
      return el("section", { classe: "cartao pilha" }, [
        el("h2", { texto: "Disparos" }),
        el("div", { classe: "tabela" }, lista.map((d) => linhaDoDisparo(d))),
      ]);
    }

    function linhaDoDisparo(d) {
      const [rotulo, classe] = ROTULO_DO_DISPARO[d.status] ?? [d.status, ""];
      const b = d.balanco;
      return el("button", {
        classe: "linha-tabela",
        type: "button",
        "data-disparo": d.id,
        onclick: () => abrirDisparo(d.id),
      }, [
        el("div", { style: "min-width:0;flex:1" }, [
          el("strong", { texto: d.nome }),
          el("div", { classe: "muted", texto: `${descreverPublico(d.publico)} · modelo ${d.modelo}${d.agendado_para ? ` · ${quandoLegivel(d.agendado_para)}` : ""}` }),
        ]),
        el("div", { classe: "crm-numeros" }, [
          numero(b.pessoas, "pessoas"),
          numero(b.entregues, "entregues"),
          numero(b.lidos, "leram"),
          numero(b.responderam, "responderam", b.responderam > 0 ? "crm-numero-ok" : ""),
          b.falharam > 0 ? numero(b.falharam, "falharam", "crm-numero-perigo") : null,
        ].filter(Boolean)),
        etiqueta(rotulo, classe),
      ]);
    }

    function numero(valor, rotulo, classe = "") {
      return el("div", { classe: `crm-numero ${classe}`.trim() }, [el("strong", { texto: String(valor) }), el("span", { texto: rotulo })]);
    }

    async function abrirDisparo(id) {
      let d;
      try {
        d = await get(`/v1/venues/${ctx.venue}/disparos/${id}`);
      } catch (e) {
        avisar(e.message, "erro");
        return;
      }
      const [rotulo, classe] = ROTULO_DO_DISPARO[d.status] ?? [d.status, ""];
      const podeCancelar = d.status === "agendado" || d.status === "enviando";
      const podeApagar = d.status === "rascunho" || d.status === "concluido" || d.status === "cancelado";

      limpar(corpo);
      corpo.append(
        el("section", { classe: "cartao pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: d.nome }),
              el("p", { classe: "muted", texto: `${descreverPublico(d.publico)} · modelo ${d.modelo}${d.agendado_para ? ` · ${quandoLegivel(d.agendado_para)}` : ""}` }),
            ]),
            etiqueta(rotulo, classe),
          ]),
          el("p", { classe: "previa-mensagem", texto: renderizarPrevia(d.corpo, d.variaveis, nomeAproximadoDaCasa(ctx.venue)) }),
          el("div", { classe: "crm-numeros" }, [
            numero(d.balanco.pessoas, "pessoas"),
            numero(d.balanco.enviados, "enviados"),
            numero(d.balanco.entregues, "entregues"),
            numero(d.balanco.lidos, "leram"),
            numero(d.balanco.responderam, "responderam", d.balanco.responderam > 0 ? "crm-numero-ok" : ""),
            numero(d.balanco.falharam, "falharam", d.balanco.falharam > 0 ? "crm-numero-perigo" : ""),
          ]),
          el("div", { classe: "linha-campos" }, [
            el("button", { classe: "btn", type: "button", texto: "← Voltar", onclick: () => abaDisparos() }),
            d.status === "rascunho"
              ? el("button", {
                  classe: "btn btn-primario",
                  type: "button",
                  texto: "Agendar",
                  onclick: () => agendar(d.id),
                })
              : null,
            podeCancelar
              ? el("button", {
                  classe: "btn btn-perigo",
                  type: "button",
                  texto: "Cancelar o que falta",
                  onclick: async () => {
                    if (!confirm("Cancelar? Quem já recebeu, recebeu; quem ainda não, não recebe.")) return;
                    try {
                      await post(`/v1/venues/${ctx.venue}/disparos/${d.id}/cancelar`, {});
                      avisar("Disparo cancelado.", "ok");
                      abrirDisparo(d.id);
                    } catch (e) {
                      avisar(e.message, "erro");
                    }
                  },
                })
              : null,
            podeApagar
              ? el("button", {
                  classe: "btn btn-perigo",
                  type: "button",
                  texto: "Apagar",
                  style: "margin-left:auto",
                  onclick: async () => {
                    if (!confirm("Apagar este disparo e o histórico dele?")) return;
                    try {
                      await del(`/v1/venues/${ctx.venue}/disparos/${d.id}`);
                      avisar("Apagado.", "ok");
                      abaDisparos();
                    } catch (e) {
                      avisar(e.message, "erro");
                    }
                  },
                })
              : null,
          ].filter(Boolean)),
          d.envios.length
            ? el("div", { classe: "tabela" }, d.envios.slice(0, 300).map((e) => {
                const [r, c] = ROTULO_DO_ENVIO[e.status] ?? [e.status, ""];
                return el("div", { classe: "linha-tabela" }, [
                  el("div", { style: "min-width:0;flex:1" }, [
                    el("strong", { texto: e.nome || telefoneLegivel(e.telefone) }),
                    el("div", { classe: "muted", texto: e.resposta ? `respondeu: “${e.resposta}”` : e.erro ? e.erro : telefoneLegivel(e.telefone) }),
                  ]),
                  etiqueta(r, c),
                ]);
              }))
            : el("p", { classe: "muted", texto: "O público é fotografado na hora de agendar — por enquanto, ninguém." }),
        ]),
      );
    }

    async function agendar(id, quandoISO = null) {
      try {
        const r = await post(`/v1/venues/${ctx.venue}/disparos/${id}/agendar`, quandoISO ? { quando: quandoISO } : {});
        avisar(`Agendado para ${r.pessoas} pessoa(s). Sai a ${20} por minuto${quandoISO ? `, a partir de ${quandoLegivel(r.disparo.agendado_para)}` : ", começando agora"}.`, "ok");
        abrirDisparo(id);
      } catch (e) {
        avisar(e.message, "erro");
      }
    }

    function formularioDeDisparo(modelos, erro) {
      if (!modelos) {
        return el("section", { classe: "cartao" }, [
          el("h2", { texto: "Novo disparo" }),
          el("p", {
            classe: "muted",
            texto: "Disparo sai pelo número oficial da Meta. Conecte-o em Ajustes → WhatsApp da casa e volte aqui." + (erro ? ` (${erro})` : ""),
          }),
        ]);
      }
      const aprovados = modelos.filter((m) => m.suportado);

      const nome = el("input", { placeholder: "Ex.: Quinta do chope — chamar os sumidos" });
      const seletorModelo = seletorDeModelo(modelos, aprovados[0]?.name ?? "");
      const areaLacunas = el("div", { classe: "pilha-fina" });
      let lacunas = editorDeLacunas(areaLacunas, modeloEscolhido(modelos, seletorModelo.value), []);
      const balao = el("p", { classe: "previa-mensagem" });
      const atualizarPrevia = () => {
        const m = modeloEscolhido(modelos, seletorModelo.value);
        balao.textContent = m ? renderizarPrevia(m.corpo, lacunas(), nomeAproximadoDaCasa(ctx.venue)) : "Escolha um modelo.";
      };
      seletorModelo.addEventListener("change", () => {
        lacunas = editorDeLacunas(areaLacunas, modeloEscolhido(modelos, seletorModelo.value), [], atualizarPrevia);
        atualizarPrevia();
      });
      areaLacunas.addEventListener("input", atualizarPrevia);
      atualizarPrevia();

      const publico = el("select", { classe: "select" }, [
        el("option", { value: "sumido", texto: "Sumidos — vinham e pararam de vir" }),
        el("option", { value: "vip", texto: "VIPs — a mesa que sustenta a noite" }),
        el("option", { value: "fiel", texto: "Fiéis — os de casa" }),
        el("option", { value: "novo", texto: "Novos — vieram uma vez" }),
        el("option", { value: "comum", texto: "Comuns — aparecem de vez em quando" }),
        ...MESES.map((m, i) => el("option", { value: `mes:${i + 1}`, texto: `Aniversariantes de ${m}` })),
        el("option", { value: "todos", texto: "A base inteira" }),
      ]);
      const previaDoPublico = el("small", { classe: "muted", texto: "Contando…" });
      const contar = async () => {
        try {
          const r = await post(`/v1/venues/${ctx.venue}/disparos/previa`, { publico: publicoDoSeletor(publico.value) });
          previaDoPublico.textContent = r.pessoas === 0
            ? "Ninguém nesse grupo hoje."
            : `${r.pessoas} pessoa(s)${r.amostra.length ? `: ${r.amostra.join(", ")}${r.pessoas > r.amostra.length ? "…" : ""}` : ""}`;
        } catch (e) {
          previaDoPublico.textContent = e.message;
        }
      };
      publico.addEventListener("change", contar);
      void contar();

      const quando = el("input", { type: "datetime-local" });

      const criar = async (agendarJa) => {
        const m = modeloEscolhido(modelos, seletorModelo.value);
        if (!m) return avisar("Escolha um modelo.", "erro");
        try {
          const d = await post(`/v1/venues/${ctx.venue}/disparos`, {
            nome: nome.value.trim(),
            modelo: m.name,
            idioma: m.idioma,
            corpo: m.corpo,
            variaveis: lacunas(),
            publico: publicoDoSeletor(publico.value),
          });
          if (agendarJa) {
            await agendar(d.id, quando.value ? new Date(quando.value).toISOString() : null);
          } else {
            avisar("Rascunho salvo.", "ok");
            abaDisparos();
          }
        } catch (e) {
          avisar(e.message, "erro");
        }
      };

      return el("section", { classe: "cartao pilha" }, [
        el("h2", { texto: "Novo disparo" }),
        el("p", {
          classe: "muted",
          texto: "Pelo número oficial, a Meta só aceita modelos que ela aprovou — o texto é escolhido, não escrito. Crie modelos em business.facebook.com → WhatsApp Manager → Modelos de mensagem; eles aparecem aqui quando aprovados.",
        }),
        aprovados.length === 0
          ? el("p", { classe: "aviso aviso-alerta", texto: "Nenhum modelo aprovado ainda. Crie um no WhatsApp Manager (categoria Marketing, com {{1}} para o nome) e espere a aprovação — costuma levar minutos." })
          : null,
        el("div", { classe: "grade" }, [
          campoDaTela("Nome do disparo (só para você)", nome),
          campoDaTela("Modelo aprovado", seletorModelo),
        ]),
        areaLacunas,
        el("div", { classe: "pilha-fina" }, [
          el("small", { classe: "muted", texto: "Como uma pessoa vai ler:" }),
          balao,
        ]),
        el("div", { classe: "grade" }, [
          campoDaTela("Quem recebe", el("div", { classe: "pilha-fina" }, [publico, previaDoPublico])),
          campoDaTela("Quando (em branco = agora)", quando),
        ]),
        el("div", { classe: "linha-campos" }, [
          el("button", { classe: "btn", type: "button", texto: "Salvar rascunho", onclick: () => criar(false) }),
          el("button", { classe: "btn btn-primario", type: "button", texto: "Agendar e enviar", disabled: aprovados.length === 0, onclick: () => criar(true) }),
        ]),
      ].filter(Boolean));
    }
  }

  /* ================= Ajustes do parabéns ================= */

  async function abaParabens() {
    limpar(corpo);
    corpo.append(el("p", { classe: "muted", texto: "Carregando…" }));

    let config;
    try {
      config = await get(`/v1/venues/${ctx.venue}/clientes/config`);
    } catch (e) {
      limpar(corpo);
      corpo.append(vazio("Não deu para carregar", e.message));
      return;
    }
    // Os modelos aprovados da conta oficial. Sem conexão oficial a lista
    // simplesmente não vem, e o parabéns segue pelo conector.
    const modelos = await get(`/v1/venues/${ctx.venue}/whatsapp-oficial/modelos`)
      .then((lista) => (Array.isArray(lista) ? lista : null))
      .catch(() => null);

    const campos = {
      ativo: el("input", { type: "checkbox", checked: config.aniversario_ativo }),
      hora: el("input", {
        classe: "campo-numero", type: "number", min: "0", max: "23",
        value: config.aniversario_hora,
      }),
      antecedencia: el("input", {
        classe: "campo-numero", type: "number", min: "0", max: "60",
        value: config.aniversario_antecedencia,
      }),
      teto: el("input", {
        classe: "campo-numero", type: "number", min: "1", max: "500",
        value: config.aniversario_teto_por_dia,
      }),
      // Dez linhas: uma campanha de verdade tem blocos, emoji e regra. Numa
      // caixa de quatro linhas ela vira uma fresta por onde não se enxerga o
      // que se está escrevendo — e texto que ninguém consegue ler inteiro é
      // texto que sai com erro.
      texto: el("textarea", { classe: "campo", rows: 10, texto: config.aniversario_texto ?? "" }),
    };

    const linha = (rotulo, campo, ajuda) =>
      el("label", { classe: "campo-rotulado" }, [
        el("span", { texto: rotulo }),
        campo,
        ajuda ? el("small", { classe: "muted", texto: ajuda }) : null,
      ].filter(Boolean));

    /**
     * A prévia enquanto se escreve.
     *
     * APROXIMADA, E ISSO ESTÁ DITO NA TELA. Aqui o texto ainda nem foi salvo,
     * então não há como pedir ao servidor a mensagem de verdade — a troca dos
     * marcadores acontece no navegador, e duas implementações da mesma regra
     * podem se desencontrar um dia. A prévia que vale é a da aba
     * Aniversariantes, montada pelo mesmo código que monta o envio.
     *
     * Ainda assim ela existe: escrever campanha às cegas, com {nome} e {data}
     * crus no meio da frase, é como se erra o texto que vai para trezentas
     * pessoas.
     */
    const balao = el("p", { classe: "previa-mensagem" });
    const previa = el("div", { classe: "pilha" }, [
      el("small", { classe: "muted", texto: "Prévia aproximada — a real aparece na aba Aniversariantes, por pessoa." }),
      balao,
    ]);
    const atualizarPrevia = () => {
      const cru = campos.texto.value.trim();
      balao.textContent = cru
        ? cru
            .replaceAll("{nome}", "Maria")
            .replaceAll("{casa}", nomeAproximadoDaCasa(ctx.venue))
            .replaceAll("{data}", "25 de dezembro")
            .replaceAll("{quando}", "daqui a 10 dias")
        : "Em branco: o sistema usa o texto padrão dele, que se ajusta à antecedência.";
    };
    campos.texto.addEventListener("input", atualizarPrevia);
    atualizarPrevia();

    // Pelo número oficial, o parabéns só sai por modelo aprovado. O seletor
    // e as lacunas dele moram aqui, ao lado do texto do conector.
    const seletorModelo = seletorDeModelo(modelos, config.aniversario_modelo);
    const areaLacunas = el("div", { classe: "pilha-fina" });
    let lacunasDoParabens = editorDeLacunas(areaLacunas, modeloEscolhido(modelos, seletorModelo.value), config.aniversario_modelo_variaveis ?? []);
    seletorModelo.addEventListener("change", () => {
      lacunasDoParabens = editorDeLacunas(areaLacunas, modeloEscolhido(modelos, seletorModelo.value), []);
    });

    limpar(corpo);
    corpo.append(
      el("section", { classe: "cartao pilha" }, [
        el("div", {}, [
          el("h2", { texto: "Parabéns de aniversário" }),
          el("p", {
            classe: "muted",
            texto: "A mensagem mais barata que a casa manda e a que mais volta: quem lembra do aniversário do cliente é lembrado na hora de escolher onde comemorar.",
          }),
        ]),
        el("label", { classe: "campo-caixa" }, [
          campos.ativo,
          el("span", {}, [
            el("strong", { texto: " Mandar o parabéns automaticamente" }),
            el("small", {
              classe: "muted",
              texto: " — cada pessoa recebe uma vez por ano, e quem pediu para sair nunca recebe.",
            }),
          ]),
        ]),
        el("div", { classe: "linha-campos" }, [
          linha("Hora do envio", campos.hora, "Meio da manhã costuma ser o melhor: às 7h acorda gente, às 22h a festa já acabou."),
          linha("Dias de antecedência", campos.antecedencia, "No dia é tarde: a pessoa já escolheu onde comemorar. 10 a 30 dias antes ela ainda está decidindo — e é aí que a mensagem muda alguma coisa."),
        ]),
        linha("Teto por dia", campos.teto, "WhatsApp comum disparando muita mensagem de uma vez é WhatsApp banido. O teto protege o número da casa."),
        linha(
          "Texto da mensagem",
          campos.texto,
          "Marcadores: {nome} vira o primeiro nome, {casa} o nome da casa, {data} a data do aniversário (\"25 de dezembro\"). Em branco, vale o texto padrão do sistema.",
        ),
        previa,
        el("div", { classe: "pilha-fina", style: "margin-top:6px" }, [
          el("h3", { texto: "Pelo número oficial (Meta)" }),
          el("p", {
            classe: "muted",
            texto: modelos
              ? "Pelo número oficial a Meta só aceita modelo aprovado — o texto acima vale para o conector. Escolha o modelo do parabéns e diga o que vai em cada lacuna."
              : "Conecte o WhatsApp oficial em Ajustes → WhatsApp da casa para mandar o parabéns por ele. Enquanto isso, sai pelo conector com o texto acima.",
          }),
          modelos ? linha("Modelo aprovado", seletorModelo, null) : null,
          modelos ? areaLacunas : null,
        ].filter(Boolean)),
        el("div", { classe: "linha-campos" }, [
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "Salvar",
            onclick: async () => {
              try {
                await put(`/v1/venues/${ctx.venue}/clientes/config`, {
                  aniversario_ativo: campos.ativo.checked,
                  aniversario_hora: Number(campos.hora.value),
                  aniversario_antecedencia: Number(campos.antecedencia.value),
                  aniversario_teto_por_dia: Number(campos.teto.value),
                  aniversario_texto: campos.texto.value,
                  aniversario_modelo: modelos ? seletorModelo.value : undefined,
                  aniversario_modelo_variaveis: modelos ? lacunasDoParabens() : undefined,
                });
                avisar("Salvo.", "ok");
              } catch (e) {
                avisar(e.message, "erro");
              }
            },
          }),
        ]),
      ]),
    );
  }
}

/* ================= Disparos: o que é comum às abas ================= */

const ROTULO_DO_DISPARO = {
  rascunho: ["Rascunho", ""],
  agendado: ["Agendado", "etiqueta-alerta"],
  enviando: ["Enviando", "etiqueta-alerta"],
  concluido: ["Concluído", "etiqueta-ok"],
  cancelado: ["Cancelado", "etiqueta-perigo"],
};

const ROTULO_DO_ENVIO = {
  pendente: ["na fila", ""],
  enviado: ["enviado", ""],
  entregue: ["entregue", "etiqueta-info"],
  lido: ["leu", "etiqueta-info"],
  respondeu: ["respondeu", "etiqueta-ok"],
  falhou: ["falhou", "etiqueta-perigo"],
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const TIPOS_DE_LACUNA = [
  ["primeiro_nome", "Primeiro nome do cliente"],
  ["nome", "Nome completo do cliente"],
  ["casa", "Nome da casa"],
  ["fixo", "Um texto fixo…"],
];

function descreverPublico(p) {
  if (p?.aniversario_mes) return `aniversariantes de ${MESES[p.aniversario_mes - 1]}`;
  if (p?.selo) return `clientes ${SELO_POR_ID[p.selo]?.nome?.toLowerCase() ?? p.selo}${p.selo === "vip" ? "s" : "s"}`.replace("vips", "VIP");
  if (p?.todos) return "a base inteira";
  return "ninguém escolhido";
}

function publicoDoSeletor(valor) {
  if (valor === "todos") return { todos: true };
  if (valor.startsWith("mes:")) return { aniversario_mes: Number(valor.slice(4)) };
  return { selo: valor };
}

function quandoLegivel(iso) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function campoDaTela(rotulo, controle) {
  return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
}

/** O seletor de modelos: os que dá para mandar daqui primeiro, o resto desabilitado com o motivo. */
function seletorDeModelo(modelos, escolhido) {
  return el("select", { classe: "select" }, [
    el("option", { value: "", texto: "— Nenhum —" }),
    ...(modelos ?? []).map((m) =>
      el("option", {
        value: m.name,
        texto: m.suportado ? `${m.name} (${m.categoria.toLowerCase()})` : `${m.name} — ${m.motivo}`,
        disabled: !m.suportado,
        selected: m.name === escolhido,
      }),
    ),
  ]);
}

function modeloEscolhido(modelos, name) {
  return (modelos ?? []).find((m) => m.name === name) ?? null;
}

/**
 * Um seletor por lacuna do modelo. Devolve a função que lê o que está
 * escolhido, no formato que o servidor grava.
 */
function editorDeLacunas(area, modelo, valoresSalvos, aoMudar) {
  limpar(area);
  if (!modelo || modelo.lacunas === 0) {
    if (modelo) area.append(el("small", { classe: "muted", texto: "Este modelo não tem lacunas." }));
    return () => [];
  }
  const linhas = [];
  for (let i = 0; i < modelo.lacunas; i += 1) {
    const salvo = valoresSalvos[i] ?? { tipo: i === 0 ? "primeiro_nome" : "fixo", texto: "" };
    const tipo = el("select", { classe: "select" }, TIPOS_DE_LACUNA.map(([id, rotulo]) => el("option", { value: id, texto: rotulo, selected: id === salvo.tipo })));
    const texto = el("input", { placeholder: "O texto que vai nessa lacuna", value: salvo.texto ?? "", style: salvo.tipo === "fixo" ? "" : "display:none" });
    tipo.addEventListener("change", () => {
      texto.style.display = tipo.value === "fixo" ? "" : "none";
      aoMudar?.();
    });
    linhas.push({ tipo, texto });
    area.append(
      el("div", { classe: "linha-campos" }, [
        el("span", { classe: "muted", style: "min-width:64px", texto: `{{${i + 1}}} =` }),
        tipo,
        texto,
      ]),
    );
  }
  return () => linhas.map(({ tipo, texto }) => (tipo.value === "fixo" ? { tipo: "fixo", texto: texto.value } : { tipo: tipo.value }));
}

/** A prévia como uma pessoa leria — aproximada, com "Maria" e a casa de exemplo. */
function renderizarPrevia(corpo, variaveis, casa = "sua casa") {
  const valores = (variaveis ?? []).map((v) =>
    v.tipo === "primeiro_nome" ? "Maria" : v.tipo === "nome" ? "Maria Souza" : v.tipo === "casa" ? casa : (v.texto || "…"),
  );
  return (corpo ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (tudo, n) => valores[Number(n) - 1] ?? tudo);
}
