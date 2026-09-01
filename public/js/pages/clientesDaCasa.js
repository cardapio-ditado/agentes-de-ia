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
};


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

    function desenharLinhas(achados) {
      limpar(lista);
      if (!achados.length) {
        lista.append(
          vazio(
            "Nenhum cliente aqui",
            busca.value.trim() || filtroOrigem.value
              ? "Tente outra busca, ou tire o filtro de origem."
              : "A base enche sozinha: quem passa na Zig, quem escreve no WhatsApp e quem responde a pesquisa entram aqui. Você também pode cadastrar à mão.",
          ),
        );
        return;
      }
      for (const c of achados) lista.append(linha(c));
    }

    function linha(c) {
      const nasc = nascimentoLegivel(c);
      return el("button", { classe: "linha-tabela", type: "button", onclick: () => ficha(c) }, [
        el("span", { classe: "linha-principal" }, [
          el("strong", { texto: c.nome || telefoneLegivel(c.telefone) }),
          el("small", {
            classe: "muted",
            texto: [
              c.nome ? telefoneLegivel(c.telefone) : null,
              nasc ? `nasceu ${nasc}` : null,
              (c.origens ?? []).map((o) => NOME_DA_ORIGEM[o] ?? o).join(" · "),
            ].filter(Boolean).join(" · "),
          }),
        ]),
        el("span", { classe: "linha-detalhes" }, [
          c.descadastrado_em ? etiqueta("não quer mensagem", "etiqueta-perigo") : null,
          selosDaNota(c.nps),
          c.visitas ? el("span", { classe: "muted", texto: `${c.visitas} visita${c.visitas > 1 ? "s" : ""}` }) : null,
          c.gasto_total_centavos ? el("strong", { texto: dinheiro(c.gasto_total_centavos / 100) }) : null,
        ].filter(Boolean)),
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
        el("div", { classe: "linha-campos" }, [busca, filtroOrigem]),
        lista,
      ]),
    );
    await recarregar();
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
      lista.append(
        vazio(
          "Ninguém faz aniversário nos próximos 45 dias",
          "Ou a base ainda não tem datas de nascimento. A Zig traz a data de quem preencheu no cadastro dela; você também pode digitar na ficha do cliente.",
        ),
      );
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
