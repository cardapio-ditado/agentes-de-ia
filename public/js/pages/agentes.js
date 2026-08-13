import { api, get, post } from "../api.js";
import { avisar, el, etiqueta, limpar, vazio } from "../ui.js";

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

    const form = el("form", { classe: "cartao", onsubmit: salvar }, [
      el("div", { classe: "grade" }, [
        campo("Nome", campos.name),
        campo("Identificador", campos.slug),
        campo("Modelo", campos.model),
        campo("Esforço de raciocínio", campos.effort),
        el("div", { classe: "campo campo-largo" }, [
          el("label", { texto: "Descrição (para a equipe, o cliente não vê)" }),
          campos.description,
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

  function campo(nome, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: nome }), controle]);
  }

  function rotulo(pares, valor) {
    return (pares.find(([v]) => v === valor)?.[1] ?? valor).split(" — ")[0];
  }
}
