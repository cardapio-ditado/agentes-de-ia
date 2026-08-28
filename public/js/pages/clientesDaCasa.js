import { del, get, patch, post, put } from "../api.js";
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
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "+ Novo cliente",
            onclick: () => ficha(null),
          }),
        ]),
        el("div", { classe: "linha-campos" }, [busca, filtroOrigem]),
        lista,
      ]),
    );
    await recarregar();
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

    // A voz dela, embaixo da ficha. Só para quem já existe: cliente sendo
    // cadastrado agora não tem passado a mostrar.
    if (existente) corpo.append(vozDoCliente(existente));

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
    const lista = el("div", { classe: "tabela" });
    if (!pessoas.length) {
      lista.append(
        vazio(
          "Ninguém faz aniversário nos próximos 45 dias",
          "Ou a base ainda não tem datas de nascimento. A Zig traz a data de quem preencheu no cadastro dela; você também pode digitar na ficha do cliente.",
        ),
      );
    } else {
      // Agrupado por "hoje / amanhã / em N dias": o gerente lê a agenda de
      // cima para baixo e para quando o dia deixa de interessar.
      for (const p of pessoas) {
        lista.append(
          el("div", { classe: "linha-tabela" }, [
            el("span", { classe: "linha-principal" }, [
              el("strong", { texto: p.nome || telefoneLegivel(p.telefone) }),
              el("small", {
                classe: "muted",
                texto: [
                  telefoneLegivel(p.telefone),
                  quandoFaz(p.dias_ate),
                  // A idade só quando a base sabe o ano: metade dos cadastros
                  // tem só dia e mês, e chutar a idade é pior que não dizer.
                  p.nascimento_ano
                    ? `faz ${Number(p.proximo.slice(0, 4)) - p.nascimento_ano} anos`
                    : null,
                ].filter(Boolean).join(" · "),
              }),
            ]),
            el("span", { classe: "linha-detalhes" }, [
              p.descadastrado_em ? etiqueta("não quer mensagem", "etiqueta-perigo") : null,
              p.ja_avisado ? etiqueta("parabéns enviado", "etiqueta-ok") : null,
              el("strong", { texto: `${String(p.nascimento_dia).padStart(2, "0")}/${String(p.nascimento_mes).padStart(2, "0")}` }),
            ].filter(Boolean)),
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
                ? `O parabéns sai sozinho às ${config.aniversario_hora}h` +
                  (config.aniversario_antecedencia
                    ? `, ${config.aniversario_antecedencia} dia(s) antes do aniversário.`
                    : ", no dia.")
                : "O parabéns automático está desligado. Ligue na aba Parabéns — ou use esta lista para ligar você mesmo.",
            }),
          ]),
          config.aniversario_ativo
            ? el("button", {
                classe: "btn btn-peq",
                type: "button",
                texto: "Mandar agora",
                onclick: mandarAgora,
              })
            : null,
        ].filter(Boolean)),
        lista,
      ]),
    );

    async function mandarAgora() {
      if (!confirm("Mandar o parabéns agora para quem faz aniversário hoje? Quem já recebeu este ano não recebe de novo.")) return;
      try {
        const r = await post(`/v1/venues/${ctx.venue}/aniversariantes/enviar`, {});
        avisar(
          r.enfileirados
            ? `${r.enfileirados} parabéns na fila de envio.`
            : "Ninguém para avisar agora — ou já tinham recebido este ano.",
          r.enfileirados ? "ok" : "info",
        );
        abaAniversarios();
      } catch (e) {
        avisar(e.message, "erro");
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
        classe: "campo-numero", type: "number", min: "0", max: "30",
        value: config.aniversario_antecedencia,
      }),
      teto: el("input", {
        classe: "campo-numero", type: "number", min: "1", max: "500",
        value: config.aniversario_teto_por_dia,
      }),
      texto: el("textarea", { classe: "campo", rows: 4, texto: config.aniversario_texto ?? "" }),
    };

    const linha = (rotulo, campo, ajuda) =>
      el("label", { classe: "campo-rotulado" }, [
        el("span", { texto: rotulo }),
        campo,
        ajuda ? el("small", { classe: "muted", texto: ajuda }) : null,
      ].filter(Boolean));

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
          linha("Dias de antecedência", campos.antecedencia, "0 = no dia. 2 ou 3 dá tempo de a pessoa marcar a mesa aqui."),
        ]),
        linha("Teto por dia", campos.teto, "WhatsApp comum disparando muita mensagem de uma vez é WhatsApp banido. O teto protege o número da casa."),
        linha(
          "Texto da mensagem",
          campos.texto,
          "Use {nome} para o primeiro nome e {casa} para o nome da casa. Deixe em branco para usar o texto padrão.",
        ),
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
