import { api, del, get, post, postArquivo } from "../api.js";
import { avisoDeMotor, extrato } from "../pontos.js";
import { avisar, dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

const MODELOS = [
  ["claude-opus-5", "Opus 5 — o mais capaz"],
  ["claude-sonnet-5", "Sonnet 5 — equilíbrio"],
  ["claude-haiku-4-5-20251001", "Haiku 4.5 — rápido e barato"],
];

const ESFORCOS = [
  ["low", "Baixo — respostas diretas"],
  ["medium", "Médio"],
  ["high", "Alto — pensa antes de responder"],
  ["xhigh", "Muito alto"],
  ["max", "Máximo"],
];

const MODELO_PROMPT = `Você é a recepcionista virtual do {NOME DO ESTABELECIMENTO} em {CIDADE}.

Personalidade: calorosa, direta e bem-humorada — como quem recebe na porta.

O que você faz:
- Responde sobre programação, horários e informações da casa.
- Coleta dados de reserva: nome, telefone, quantidade de pessoas, data e hora.

Regras:
- NUNCA confirme uma reserva. Diga sempre que ela será analisada pela equipe
  e que a confirmação chega pelo WhatsApp.
- Não invente informação. Se não souber, diga que vai verificar com a equipe.
- Não fale de outros assuntos além do estabelecimento.`;

/**
 * Montagem de agentes: lista + editor.
 *
 * A personalidade é o system_prompt — o texto que define quem o agente é.
 * Editar aqui vale imediatamente para as próximas mensagens.
 */
export async function agentes(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);
  await listar();

  async function listar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    const lista = await get("/v1/agents?all=1");
    limpar(conteudo);

    conteudo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Seus agentes" }),
          el("p", {
            classe: "muted",
            texto: "Cada agente tem personalidade, modelo e esforço próprios.",
          }),
        ]),
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "+ Novo agente",
          onclick: () => editor(null),
        }),
      ]),
    );

    if (lista.length === 0) {
      conteudo.append(
        vazio("Nenhum agente ainda", 'Clique em "Novo agente" para montar o primeiro.'),
      );
      return;
    }

    const grade = el("div", { classe: "lista" });
    for (const a of lista) {
      grade.append(
        el("article", { classe: "cartao" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", { style: "min-width:0" }, [
              el("h3", { texto: a.name }),
              el("p", { classe: "muted", texto: a.description || `@${a.slug}` }),
            ]),
            el("div", { style: "display:flex;gap:6px;align-items:center" }, [
              etiqueta(a.enabled ? "ativo" : "pausado", a.enabled ? "etiqueta-ok" : "etiqueta-alerta"),
              el("button", {
                classe: "btn btn-peq",
                type: "button",
                texto: "Editar",
                onclick: () => editor(a.slug),
              }),
            ]),
          ]),
          el("div", { classe: "linha-dado" }, [
            el("span", { texto: "Modelo" }),
            el("strong", { texto: rotulo(MODELOS, a.model) }),
          ]),
          el("div", { classe: "linha-dado" }, [
            el("span", { texto: "Esforço" }),
            el("strong", { texto: rotulo(ESFORCOS, a.effort) }),
          ]),
        ]),
      );
    }
    conteudo.append(grade);
  }

  /** Editor: o mesmo formulário cria (slug editável) e edita (slug travado). */
  async function editor(slug) {
    const criando = slug === null;
    const atual = criando
      ? {
          name: "",
          slug: "",
          description: "",
          system_prompt: MODELO_PROMPT,
          model: "claude-opus-5",
          effort: "high",
          enabled: true,
        }
      : await get(`/v1/agents/${slug}`);

    const campos = {
      name: el("input", { required: true, value: atual.name, placeholder: "Recepcionista do Ditado" }),
      slug: el("input", {
        value: atual.slug,
        placeholder: "recepcionista",
        disabled: !criando,
        title: criando ? "" : "O identificador não muda: conversas e canais apontam para ele.",
      }),
      description: el("input", {
        value: atual.description ?? "",
        placeholder: "Atende WhatsApp: reservas e programação",
      }),
      system_prompt: el("textarea", {
        rows: 16,
        style: "font-family:ui-monospace,monospace;font-size:13px;line-height:1.6",
        texto: atual.system_prompt ?? "",
      }),
      model: el(
        "select",
        {},
        MODELOS.map(([v, r]) => el("option", { value: v, texto: r, selected: v === atual.model })),
      ),
      effort: el(
        "select",
        {},
        ESFORCOS.map(([v, r]) => el("option", { value: v, texto: r, selected: v === atual.effort })),
      ),
      enabled: el("input", { type: "checkbox", checked: atual.enabled, style: "width:auto" }),
    };

    // Sugere o identificador a partir do nome, só enquanto se cria.
    if (criando) {
      campos.name.addEventListener("input", () => {
        campos.slug.value = campos.name.value
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 64);
      });
    }

    const btnSalvar = el("button", {
      classe: "btn btn-primario",
      type: "submit",
      texto: criando ? "Criar agente" : "Salvar alterações",
    });

    // Trocar de motor muda a velocidade com que os pontos somem. O cliente vê
    // o efeito da escolha dele antes de salvar, com o consumo real da casa.
    const campoModelo = campo("Modelo", campos.model);
    let saldo = null;
    function mostrarDuracao() {
      if (!saldo) return;
      campoModelo.querySelector(".pontos-aviso")?.remove();
      campoModelo.append(avisoDeMotor(saldo, campos.model.value));
    }
    campos.model.addEventListener("change", mostrarDuracao);
    extrato(ctx.venue)
      .then((e) => {
        saldo = e;
        mostrarDuracao();
      })
      .catch(() => {});

    const form = el("form", { classe: "cartao", onsubmit: salvar }, [
      el("div", { classe: "grade" }, [
        campo("Nome", campos.name),
        campo("Identificador", campos.slug),
        campoModelo,
        campo("Esforço de raciocínio", campos.effort),
        el("div", { classe: "campo campo-largo" }, [
          el("label", { texto: "Descrição (para a equipe, o cliente não vê)" }),
          campos.description,
        ]),
        el("div", { classe: "campo campo-largo" }, [
          el("p", {
            classe: "muted",
            texto:
              "Todo agente já vem com as ferramentas da casa: consultar data/hora, informações do estabelecimento, programação, registrar e consultar reservas.",
          }),
        ]),
        el("div", { classe: "campo campo-largo" }, [
          el("label", { texto: "Personalidade e regras (system prompt)" }),
          campos.system_prompt,
          el("p", {
            classe: "muted",
            texto:
              "Este texto define quem o agente é. A regra de nunca confirmar reserva também é imposta pelo código — mas mantê-la aqui deixa o agente coerente ao conversar.",
          }),
        ]),
      ]),
      el("div", { classe: "reserva-acoes" }, [
        btnSalvar,
        el("button", { classe: "btn", type: "button", texto: "Voltar", onclick: listar }),
        el("label", { style: "display:flex;align-items:center;gap:7px;margin-left:auto;font-size:14px" }, [
          campos.enabled,
          el("span", { texto: "Agente ativo" }),
        ]),
      ]),
    ]);

    limpar(conteudo).append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: criando ? "Novo agente" : `Editando ${atual.name}` }),
          el("p", {
            classe: "muted",
            texto: criando
              ? "Defina a personalidade e as regras. Depois teste na aba Testar agente."
              : "As mudanças valem para as próximas mensagens, inclusive no WhatsApp.",
          }),
        ]),
      ]),
      form,
    );

    // Treinamento só existe depois que o agente existe.
    if (!criando) conteudo.append(secaoTreinamento(slug));

    async function salvar(e) {
      e.preventDefault();
      btnSalvar.disabled = true;

      const dados = {
        name: campos.name.value.trim(),
        description: campos.description.value.trim() || null,
        system_prompt: campos.system_prompt.value,
        model: campos.model.value,
        effort: campos.effort.value,
        enabled: campos.enabled.checked,
      };

      try {
        if (criando) {
          await post("/v1/agents", { ...dados, slug: campos.slug.value.trim() });
          avisar("Agente criado. Teste na aba Testar agente.", "ok");
        } else {
          await api(`/v1/agents/${slug}`, { method: "PATCH", body: JSON.stringify(dados) });
          avisar("Alterações salvas.", "ok");
        }
        await listar();
      } catch (err) {
        avisar(err.message, "erro");
        btnSalvar.disabled = false;
      }
    }
  }

  /**
   * Treinamento: digitar texto ou subir arquivo (PDF, imagem, .txt/.md/.csv).
   *
   * O arquivo vira texto na hora do upload — o Claude lê PDF e imagem — e o
   * agente passa a usar tudo isso nas respostas seguintes.
   */
  function secaoTreinamento(slug) {
    const lista = el("div", { classe: "lista", style: "margin-top:12px" });

    const titulo = el("input", { placeholder: "Ex.: Cardápio de drinks" });
    const textoLivre = el("textarea", {
      rows: 4,
      placeholder:
        "Digite o conhecimento aqui. Ex.: Happy hour de terça a sexta, 17h às 20h, chope em dobro…",
    });

    const inputArquivo = el("input", {
      type: "file",
      accept: ".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,image/jpeg,image/png,image/webp,image/gif",
    });

    const btnTexto = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Adicionar texto",
      onclick: enviarTexto,
    });
    const btnArquivo = el("button", {
      classe: "btn btn-peq",
      type: "button",
      texto: "Enviar arquivo",
      onclick: enviarArquivo,
    });

    const secao = el("section", { classe: "cartao", style: "margin-top:16px" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: "Treinamento" }),
          el("p", {
            classe: "muted",
            texto:
              "Tudo aqui vira conhecimento do agente: cardápio, regras da casa, promoções. PDF e imagem são lidos e transcritos na hora.",
          }),
        ]),
      ]),
      el("div", { classe: "grade-2" }, [
        el("div", { classe: "campo" }, [
          el("label", { texto: "Digitar conhecimento" }),
          titulo,
          textoLivre,
          el("div", {}, [btnTexto]),
        ]),
        el("div", { classe: "campo" }, [
          el("label", { texto: "Subir arquivo (PDF, Word, Excel, imagem, .txt, .md, .csv)" }),
          inputArquivo,
          el("p", {
            classe: "muted",
            texto: "Máx. 20 MB. PDF e imagem passam pelo agente para ler; Word e Excel são lidos direto — mais rápido.",
          }),
          el("div", {}, [btnArquivo]),
        ]),
      ]),
      lista,
    ]);

    void carregar();
    return secao;

    async function carregar() {
      limpar(lista);
      const itens = await get(`/v1/agents/${slug}/training`);
      if (itens.length === 0) {
        lista.append(vazio("Nenhum treinamento ainda", "O agente só sabe o que o prompt e a Programação dizem."));
        return;
      }
      for (const i of itens) {
        lista.append(
          el("article", { classe: "cartao" }, [
            el("div", { classe: "cabecalho-secao" }, [
              el("div", { style: "min-width:0" }, [
                el("h3", { texto: i.titulo }),
                el("p", {
                  classe: "muted",
                  texto: `${i.arquivo ?? "texto digitado"} · ${Math.round(i.tamanho / 100) / 10} mil caracteres · ${dataHora(i.criado_em)}`,
                }),
              ]),
              el("div", { style: "display:flex;gap:6px;align-items:center" }, [
                etiqueta(
                  i.kind === "imagem" ? "imagem" : i.kind === "documento" ? "documento" : "texto",
                  "etiqueta-info",
                ),
                el("button", {
                  classe: "btn btn-perigo btn-peq",
                  type: "button",
                  texto: "Remover",
                  onclick: async (e) => {
                    e.target.disabled = true;
                    try {
                      await del(`/v1/agents/${slug}/training/${i.id}`);
                      avisar("Treinamento removido.", "ok");
                      await carregar();
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

    async function enviarTexto() {
      if (!titulo.value.trim() || !textoLivre.value.trim()) {
        avisar("Preencha o título e o conteúdo.", "erro");
        return;
      }
      btnTexto.disabled = true;
      try {
        await post(`/v1/agents/${slug}/training`, {
          titulo: titulo.value.trim(),
          conteudo: textoLivre.value.trim(),
        });
        avisar("Conhecimento adicionado.", "ok");
        titulo.value = "";
        textoLivre.value = "";
        await carregar();
      } catch (e) {
        avisar(e.message, "erro");
      } finally {
        btnTexto.disabled = false;
      }
    }

    /** Extensão → media type, para quando o navegador não informa o tipo. */
    const TIPO_POR_EXTENSAO = {
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xls": "application/vnd.ms-excel",
      ".md": "text/markdown",
      ".csv": "text/csv",
    };

    async function enviarArquivo() {
      const arquivo = inputArquivo.files?.[0];
      if (!arquivo) {
        avisar("Escolha um arquivo primeiro.", "erro");
        return;
      }
      if (arquivo.size > 20 * 1024 * 1024) {
        avisar("Arquivo acima de 20 MB. Divida ou comprima antes de subir.", "erro");
        return;
      }

      btnArquivo.disabled = true;
      btnArquivo.textContent = "Enviando…";
      try {
        const extensao = arquivo.name.slice(arquivo.name.lastIndexOf(".")).toLowerCase();
        const tipo = arquivo.type || TIPO_POR_EXTENSAO[extensao] || "text/plain";

        // O arquivo vai cru no corpo — sem base64, sem JSON — direto pro fetch.
        const busca = new URLSearchParams({
          titulo: titulo.value.trim(),
          nome_arquivo: arquivo.name,
          media_type: tipo,
        });
        await postArquivo(`/v1/agents/${slug}/training/upload?${busca}`, arquivo);
        avisar("Arquivo processado e adicionado ao conhecimento.", "ok");
        inputArquivo.value = "";
        titulo.value = "";
        await carregar();
      } catch (e) {
        avisar(e.message, "erro");
      } finally {
        btnArquivo.disabled = false;
        btnArquivo.textContent = "Enviar arquivo";
      }
    }
  }

  function campo(nome, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: nome }), controle]);
  }

  function rotulo(pares, valor) {
    return (pares.find(([v]) => v === valor)?.[1] ?? valor).split(" — ")[0];
  }
}
