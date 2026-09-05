import { get, patch, post, put } from "../api.js";
import { avisar, dataHora, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Carteira de clientes — só para a equipe Brasa Food.
 *
 * O cadastro é uma tela e não um SQL porque o gargalo de vender não é fechar,
 * é entregar: organização, estabelecimento, agente, plano, conta do dono e
 * chave do conector precisam nascer juntos e coerentes. Na mão isso leva meia
 * hora e erra no campo mais silencioso — o fuso horário, que só se revela
 * semanas depois numa reserva marcada na hora errada.
 */

const STATUS = [
  ["ativo", "Em dia"],
  ["atrasado", "Atrasado"],
  ["suspenso", "Suspenso"],
  ["cortesia", "Cortesia"],
  ["cancelado", "Cancelado"],
];

const NOMES_DE_PLANO = {
  essencial: "Essencial",
  profissional: "Profissional",
  casa_cheia: "Casa Cheia",
  cortesia: "Cortesia",
};

const numeroBr = (v) => (v ?? 0).toLocaleString("pt-BR");
const dinheiro = (v) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const PLANOS = [
  ["essencial", "Essencial — 1.000 pontos · R$ 147"],
  ["profissional", "Profissional — 2.500 pontos · R$ 297"],
  ["casa_cheia", "Casa Cheia — 6.000 pontos · R$ 597"],
  ["cortesia", "Cortesia — 500 pontos · demonstração"],
];

// Os módulos que se vendem. "Administração" não entra: é a mesa da equipe
// Brasa Food, não um produto — liberá-la para um cliente daria a ele a
// carteira inteira, com a receita e os dados dos concorrentes dele.
const MODULOS_VENDAVEIS = [
  ["agentes-ia", "Agentes de IA"],
  ["cardapio-digital", "Cardápio Digital"],
  ["checklist", "Checklist"],
  ["avaliacoes", "Avaliações"],
  ["cmv", "CMV Inteligente"],
  ["pesquisa", "Voz do Cliente"],
];

// Os fusos que existem no Brasil. Lista curta de propósito: o seletor com as
// 400 zonas do mundo é onde se erra clicando no vizinho errado.
const FUSOS = [
  ["America/Cuiaba", "Cuiabá / Mato Grosso (GMT-4)"],
  ["America/Sao_Paulo", "Brasília / Sudeste / Sul (GMT-3)"],
  ["America/Manaus", "Manaus / Amazonas (GMT-4)"],
  ["America/Campo_Grande", "Campo Grande / MS (GMT-4)"],
  ["America/Belem", "Belém / Pará (GMT-3)"],
  ["America/Fortaleza", "Fortaleza / Nordeste (GMT-3)"],
  ["America/Recife", "Recife / Pernambuco (GMT-3)"],
  ["America/Bahia", "Salvador / Bahia (GMT-3)"],
  ["America/Porto_Velho", "Porto Velho / Rondônia (GMT-4)"],
  ["America/Boa_Vista", "Boa Vista / Roraima (GMT-4)"],
  ["America/Rio_Branco", "Rio Branco / Acre (GMT-5)"],
  ["America/Noronha", "Fernando de Noronha (GMT-2)"],
];

export async function clientes(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);
  await listar();

  async function listar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando carteira…" }));
    let lista;
    try {
      lista = await get("/v1/admin/clientes");
    } catch (e) {
      limpar(conteudo).append(
        vazio("Área restrita", e.message ?? "Esta área é da equipe Brasa Food."),
      );
      return;
    }
    limpar(conteudo);

    conteudo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: `${lista.length} cliente(s)` }),
          el("p", { classe: "muted", texto: "Cada cliente é uma organização isolada." }),
        ]),
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "+ Novo cliente",
          onclick: () => formulario(),
        }),
      ]),
    );

    if (lista.length === 0) {
      conteudo.append(vazio("Nenhum cliente ainda", "Cadastre o primeiro em menos de dois minutos."));
      return;
    }

    const grade = el("div", { classe: "lista" });
    for (const c of lista) grade.append(cartaoDeCliente(c));
    conteudo.append(grade);
  }

  /** Um cliente na carteira: quem é, quanto paga e quanto já gastou. */
  function cartaoDeCliente(c) {
    const temSaldo = c.pontos_mensais > 0 && c.pontos_usados !== null;
    const percentual = temSaldo ? Math.round((c.pontos_usados / c.pontos_mensais) * 100) : 0;

    const barra = el("div", { classe: "pontos-barra" }, [
      el("div", {
        classe: `pontos-preenchido ${percentual >= 85 ? "pontos-critico" : percentual >= 65 ? "pontos-atencao" : ""}`,
      }),
    ]);
    barra.firstChild.style.width = `${Math.min(100, percentual)}%`;

    const seletorStatus = el(
      "select",
      {
        classe: "select select-peq",
        onchange: async (ev) => {
          try {
            await patch(`/v1/admin/clientes/${c.org_id}`, { status_pagamento: ev.target.value });
            avisar("Situação atualizada.", "ok");
          } catch (e) {
            avisar(e.message, "erro");
          }
        },
      },
      STATUS.map(([v, r]) => el("option", { value: v, texto: r, selected: v === c.status_pagamento })),
    );

    return el("article", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: c.nome }),
          el("p", { classe: "muted", texto: c.email_contato ?? `@${c.slug}` }),
        ]),
        el("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap" }, [
          c.estado_do_plano === "bloqueado"
            ? etiqueta("agente pausado", "etiqueta-perigo")
            : c.estado_do_plano === "cortesia"
              ? etiqueta("em cortesia", "etiqueta-alerta")
              : null,
          c.primeiro_acesso_em
            ? etiqueta("já entrou", "etiqueta-ok")
            : etiqueta("nunca acessou", "etiqueta-alerta"),
        ].filter(Boolean)),
      ]),

      temSaldo
        ? el("div", { style: "margin:10px 0 4px" }, [
            barra,
            el("p", {
              classe: "muted",
              texto: `${numeroBr(c.pontos_usados)} de ${numeroBr(c.pontos_mensais)} pontos usados · restam ${numeroBr(c.pontos_restantes)}`,
            }),
          ])
        : el("p", { classe: "muted", texto: "Sem consumo registrado neste ciclo." }),

      linha("Plano", NOMES_DE_PLANO[c.plano] ?? c.plano ?? "—"),
      linha("Mensalidade", dinheiro(c.mensalidade)),
      linha("Estabelecimentos", String(c.estabelecimentos)),
      linha("Cliente desde", dataHora(c.criado_em)),
      el("div", { classe: "linha-dado" }, [
        el("span", { texto: "Situação" }),
        seletorStatus,
      ]),
      modulosDoCliente(c),
    ]);
  }

  /**
   * Quais favos acendem na colmeia deste cliente.
   *
   * Fica no cartão, junto do plano e da mensalidade, porque é a mesma
   * pergunta: o que ele comprou. Separado, viraria uma tela que ninguém abre
   * e um cliente novo passaria semanas sem o módulo que já paga.
   */
  function modulosDoCliente(c) {
    if (!c.venue_id) {
      return el("p", { classe: "muted", texto: "Sem estabelecimento — nada a liberar ainda." });
    }

    const atual = new Map((c.modulos ?? []).map((m) => [m.modulo, m]));
    const caixa = el("div", { style: "margin-top:12px;border-top:1px solid var(--borda);padding-top:10px" }, [
      el("p", { classe: "muted", texto: "Módulos liberados" }),
    ]);

    const chips = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin:6px 0" });
    for (const [id, nome] of MODULOS_VENDAVEIS) {
      const ligado = atual.get(id)?.ativo === true;
      const chip = el("button", {
        type: "button",
        classe: `btn btn-peq ${ligado ? "btn-primario" : ""}`,
        texto: nome,
        onclick: async () => {
          chip.disabled = true;
          try {
            await put(`/v1/admin/venues/${c.venue_id}/modulos`, { modulo: id, ativo: !ligado });
            avisar(`${nome} ${ligado ? "desligado" : "liberado"}.`, "ok");
            await listar();
          } catch (e) {
            avisar(e.message, "erro");
            chip.disabled = false;
          }
        },
      });
      chips.append(chip);
    }
    caixa.append(chips);

    // O cardápio mora dentro do Brasa agora (/cardapio/<casa>): não há mais
    // endereço externo para cadastrar. O link antigo em venue_modulos.url,
    // quando existe, aparece só para a equipe saber que ele ainda está no ar.
    const linkAntigo = atual.get("cardapio-digital")?.url;
    if (atual.get("cardapio-digital")?.ativo && linkAntigo) {
      caixa.append(
        el("p", { classe: "muted", style: "margin-top:6px", texto: `Cardápio antigo (deploy separado): ${linkAntigo}` }),
      );
    }

    return caixa;
  }

  function formulario() {
    limpar(conteudo);

    const campos = {
      nome: el("input", { placeholder: "Ditado Popular", required: true }),
      cidade: el("input", { placeholder: "Cuiabá / MT" }),
      timezone: el(
        "select",
        {},
        FUSOS.map(([v, r]) => el("option", { value: v, texto: r })),
      ),
      plano: el(
        "select",
        {},
        PLANOS.map(([v, r]) => el("option", { value: v, texto: r, selected: v === "profissional" })),
      ),
      email: el("input", { type: "email", placeholder: "dono@restaurante.com.br", required: true }),
      telefone: el("input", { placeholder: "(65) 9 9999-9999" }),
      observacoes: el("textarea", { rows: 3, placeholder: "Combinado comercial, prazo, o que for útil lembrar." }),
    };

    const btn = el("button", { classe: "btn btn-primario", type: "submit", texto: "Cadastrar cliente" });

    const form = el("form", { classe: "cartao", onsubmit: enviar }, [
      el("div", { classe: "grade" }, [
        campo("Nome do restaurante", campos.nome),
        campo("Cidade", campos.cidade),
        campo("Fuso horário", campos.timezone),
        campo("Plano", campos.plano),
        campo("E-mail do responsável", campos.email),
        campo("WhatsApp", campos.telefone),
        el("div", { classe: "campo campo-largo" }, [
          el("label", { texto: "Observações (só a equipe vê)" }),
          campos.observacoes,
        ]),
        el("div", { classe: "campo campo-largo" }, [
          el("p", {
            classe: "muted",
            texto:
              "O fuso é o campo mais importante: ele governa o horário das reservas, o disparo dos checklists e a virada do ciclo de pontos. Confirme a cidade antes de salvar.",
          }),
        ]),
      ]),
      el("div", { classe: "acoes-form" }, [
        btn,
        el("button", { classe: "btn", type: "button", texto: "Cancelar", onclick: listar }),
      ]),
    ]);

    conteudo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Novo cliente" }),
          el("p", {
            classe: "muted",
            texto: "Cria a organização, o estabelecimento, o agente, o acesso do dono e a chave do conector.",
          }),
        ]),
      ]),
      form,
    );
    campos.nome.focus();

    async function enviar(evento) {
      evento.preventDefault();
      btn.disabled = true;
      btn.textContent = "Cadastrando…";
      try {
        const criado = await post("/v1/admin/clientes", {
          nome: campos.nome.value.trim(),
          cidade: campos.cidade.value.trim() || undefined,
          timezone: campos.timezone.value,
          plano: campos.plano.value,
          email: campos.email.value.trim(),
          telefone: campos.telefone.value.trim() || undefined,
          observacoes: campos.observacoes.value.trim() || undefined,
        });
        entrega(criado);
      } catch (e) {
        avisar(e.message, "erro");
        btn.disabled = false;
        btn.textContent = "Cadastrar cliente";
      }
    }
  }

  /**
   * Tela de entrega: senha e chave aparecem UMA vez.
   *
   * Não é limitação — é o desenho. A senha não fica guardada em lugar nenhum
   * e a chave só existe no banco como hash. Quem fechar esta tela sem copiar
   * precisa gerar de novo, e isso é preferível a ter os dois recuperáveis.
   */
  function entrega(c) {
    limpar(conteudo);
    conteudo.append(
      el("section", { classe: "cartao pontos-borda-atencao" }, [
        el("h2", { texto: `${c.organizacao.nome} está no ar 🔥` }),
        el("p", {
          classe: "muted",
          texto:
            "Copie os dados abaixo AGORA e mande para o cliente. A senha e a chave não aparecem de novo em lugar nenhum.",
        }),
        el("div", { style: "margin-top:14px" }, [
          copiavel("E-mail de acesso", c.dono.email),
          copiavel("Senha inicial", c.senhaInicial),
          copiavel("Chave do conector (WhatsApp)", c.chave),
          linha("Endereço do painel", `${location.origin}/app`),
          linha("Estabelecimento", `${c.estabelecimento.nome} (${c.estabelecimento.slug})`),
          linha("Fuso horário", c.estabelecimento.timezone),
          linha("Agente criado", c.agente.slug),
        ]),
        el("p", {
          classe: "muted",
          style: "margin-top:14px",
          texto:
            "Peça para o dono trocar a senha no primeiro acesso, em Esqueci minha senha. A chave do conector é só para o computador que roda o WhatsApp — ela não deve circular no grupo da equipe.",
        }),
        el("div", { classe: "acoes-form" }, [
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "Copiar tudo",
            onclick: (ev) => {
              const texto = [
                `Acesso ao Brasa Food — ${c.organizacao.nome}`,
                `Painel: ${location.origin}/app`,
                `E-mail: ${c.dono.email}`,
                `Senha inicial: ${c.senhaInicial}`,
                ``,
                `Chave do conector (só para o PC do WhatsApp):`,
                c.chave,
              ].join("\n");
              navigator.clipboard.writeText(texto);
              ev.target.textContent = "Copiado ✓";
            },
          }),
          el("button", { classe: "btn", type: "button", texto: "Voltar à carteira", onclick: listar }),
        ]),
      ]),
    );
  }

  function copiavel(rotulo, valor) {
    const campo = el("code", { classe: "credencial", texto: valor });
    return el("div", { classe: "linha-dado linha-credencial" }, [
      el("span", { texto: rotulo }),
      el("span", { classe: "credencial-caixa" }, [
        campo,
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Copiar",
          onclick: (ev) => {
            navigator.clipboard.writeText(valor);
            ev.target.textContent = "✓";
            setTimeout(() => (ev.target.textContent = "Copiar"), 1500);
          },
        }),
      ]),
    ]);
  }

  function campo(nome, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: nome }), controle]);
  }

  function linha(rotulo, valor) {
    return el("div", { classe: "linha-dado" }, [
      el("span", { texto: rotulo }),
      el("strong", { texto: valor }),
    ]);
  }
}
