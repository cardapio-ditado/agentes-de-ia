import { ErroApi, get, post } from "../api.js";
import { avisar, el, etiqueta, limpar, vazio } from "../ui.js";

const ROTULOS = {
  desconectado: ["Desconectado", ""],
  aguardando_qr: ["Aguardando leitura do QR", "etiqueta-alerta"],
  conectando: ["Conectando…", "etiqueta-alerta"],
  conectado: ["Conectado", "etiqueta-ok"],
};

/**
 * Canais.
 *
 * O conector do WhatsApp precisa de processo longo e disco — não roda na
 * Vercel. Em vez de esconder isso atrás de um erro genérico, a tela explica o
 * que está acontecendo e o que fazer.
 */
export async function canais(raiz, ctx) {
  let timer = null;
  const area = el("div", {});

  // A lista completa (inclusive pausados) é o que existe para escolher —
  // o vínculo é sempre explícito, nunca "o primeiro da lista" por baixo dos panos.
  const agentes = await get("/v1/agents?all=1");
  const seletorAgente = el(
    "select",
    { classe: "select", id: "seletor-agente-wa" },
    agentes.map((a) => el("option", { value: a.slug, texto: a.name })),
  );

  raiz.append(
    el("div", { classe: "pilha" }, [
      el("section", { classe: "cartao alerta" }, [
        el("strong", { texto: "Conexão não oficial." }),
        el("p", {
          classe: "muted",
          texto:
            "O Baileys usa o protocolo do WhatsApp Web, fora dos termos de uso da Meta. O número pode ser banido — use um chip separado do número principal da casa.",
        }),
      ]),
      area,
    ]),
  );

  if (agentes.length === 0) {
    limpar(area).append(
      vazio(
        "Nenhum agente cadastrado",
        'Crie um em "Agentes" antes de conectar o WhatsApp — a conexão precisa de alguém para responder.',
      ),
    );
    return;
  }

  // A tela some quando o usuário troca de página: sem isto o timer continuaria
  // batendo na API para sempre.
  ctx.aoSair(() => clearInterval(timer));

  await atualizar();
  timer = setInterval(atualizar, 4000);

  async function atualizar() {
    try {
      const estado = await get("/v1/whatsapp/status");
      desenharConectado(estado);
    } catch (e) {
      clearInterval(timer);
      if (e instanceof ErroApi && e.status === 501) desenharIndisponivel();
      else desenharErro(e.message);
    }
  }

  function desenharConectado(estado) {
    const [rotulo, variante] = ROTULOS[estado.status] ?? [estado.status, ""];
    const ligado = estado.status === "conectado" || estado.status === "conectando";

    // Já tem vínculo (ligado ou reconectando sozinho)? O seletor mostra quem
    // está atendendo de verdade, não um palpite — e trava, porque trocar de
    // agente exige desconectar primeiro.
    if (estado.agentSlug && agentes.some((a) => a.slug === estado.agentSlug)) {
      seletorAgente.value = estado.agentSlug;
    }
    seletorAgente.disabled = ligado;

    const agenteAtual = agentes.find((a) => a.slug === estado.agentSlug);

    limpar(area).append(
      el("section", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "WhatsApp" }),
            el("p", {
              classe: "muted",
              texto: estado.telefone
                ? `Conectado como ${estado.telefone}${agenteAtual ? ` · atendido por ${agenteAtual.name}` : ""}`
                : "Nenhum número pareado",
            }),
            el("p", {
              classe: "muted",
              // A pergunta certa quando o site e o PC divergem: que código
              // roda AQUI? Compare com a versão mais nova no GitHub.
              texto: `Versão do sistema neste computador: ${estado.versao ?? "desconhecida"}`,
            }),
          ]),
          etiqueta(rotulo, variante),
        ]),

        estado.qr
          ? el("div", { classe: "area-qr" }, [
              el("img", { src: estado.qr, alt: "QR de pareamento do WhatsApp" }),
            ])
          : el("div", { classe: "area-qr" }, [
              el("p", {
                classe: "muted",
                texto:
                  estado.status === "conectado"
                    ? "Número pareado. O agente já responde por aqui."
                    : "Escolha o agente e clique em conectar para gerar o QR de pareamento.",
              }),
            ]),

        el("div", { classe: "campo", style: "max-width:320px;margin-top:10px" }, [
          el("label", { for: "seletor-agente-wa", texto: "Agente que atende por este número" }),
          seletorAgente,
          ligado
            ? el("p", {
                classe: "muted",
                texto: "Desconecte para trocar de agente.",
              })
            : null,
        ]),

        el("div", { classe: "reserva-acoes" }, [
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "Conectar",
            disabled: ligado,
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                await post("/v1/whatsapp/conectar", {
                  venue: ctx.venue,
                  agent: seletorAgente.value,
                });
                avisar(`Conector iniciado com ${seletorAgente.selectedOptions[0].text}. O QR aparece em instantes.`, "ok");
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
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                await post("/v1/whatsapp/desconectar", {});
                avisar("Conector parado.", "ok");
              } catch (err) {
                avisar(err.message, "erro");
              } finally {
                e.target.disabled = false;
              }
            },
          }),
        ]),
      ]),
    );
  }

  function desenharIndisponivel() {
    limpar(area).append(
      el("section", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("h2", { texto: "WhatsApp" }),
          etiqueta("indisponível aqui", "etiqueta-alerta"),
        ]),
        el("p", {
          classe: "muted",
          texto:
            "Este painel está hospedado na Vercel, onde a função morre segundos depois de responder. O conector precisa de um processo que fique de pé, com WebSocket aberto e disco para guardar a sessão pareada. Não é configuração: é incompatível por natureza.",
        }),
        el("h3", { texto: "Como colocar no ar", style: "margin-top:14px" }),
        el("ol", { classe: "muted", style: "padding-left:18px;line-height:1.8" }, [
          el("li", { texto: "Suba o mesmo repositório num host sempre ligado (Railway, Render, Fly.io ou uma VPS)." }),
          el("li", { texto: "Configure lá as mesmas variáveis: ANTHROPIC_API_KEY, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." }),
          el("li", { texto: "Monte um volume persistente na pasta .whatsapp/ — é onde fica a sessão do número." }),
          el("li", { texto: "Rode `npm run whatsapp` e leia o QR pelo painel daquele host." }),
        ]),
        el("p", {
          classe: "muted",
          texto:
            "O resto do painel — reservas, programação, conversas — continua funcionando normalmente aqui.",
        }),
      ]),
    );
  }

  function desenharErro(mensagem) {
    limpar(area).append(vazio("Não deu para consultar o canal", mensagem));
  }
}
