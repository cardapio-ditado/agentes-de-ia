import { ErroApi, get, post } from "../api.js";
import { avisar, el, etiqueta, limpar, vazio } from "../ui.js";

const ROTULOS = {
  desconectado: ["Desconectado", ""],
  aguardando_qr: ["Aguardando leitura do QR", "etiqueta-alerta"],
  conectando: ["Conectando…", "etiqueta-alerta"],
  conectado: ["Conectado", "etiqueta-ok"],
  sem_conector: ["Conector desligado", "etiqueta-alerta"],
};

/**
 * Canais.
 *
 * O QR nasce no processo que roda o conector (PC do bar ou VPS). Quando esta
 * tela está no site (Vercel), tudo passa pela ponte no banco: o estado que o
 * conector publica aparece aqui, e os botões enfileiram comandos que ele
 * executa em segundos. Ou seja: dá para conectar de qualquer lugar, desde
 * que o computador do agente esteja ligado.
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

  const areaInstagram = el("div", {});

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
      areaInstagram,
    ]),
  );

  void desenharInstagram();

  async function desenharInstagram() {
    let estado;
    try {
      estado = await get("/v1/instagram/status");
    } catch {
      return; // API antiga sem a rota: o cartão simplesmente não aparece.
    }

    limpar(areaInstagram).append(
      el("section", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Instagram" }),
            el("p", {
              classe: "muted",
              texto: estado.configurado
                ? `DMs atendidos por "${estado.agente}" · canal oficial da Meta, direto na nuvem — nenhum computador precisa ficar ligado.`
                : "Canal oficial da Meta: o cliente manda DM e o agente responde. Roda direto na nuvem, sem QR e sem computador ligado.",
            }),
          ]),
          etiqueta(
            estado.configurado ? "Ativo" : "Não configurado",
            estado.configurado ? "etiqueta-ok" : "",
          ),
        ]),
        estado.configurado
          ? null
          : el("div", {}, [
              el("p", { classe: "muted", texto: "Para ativar, falta configurar no servidor:" }),
              el(
                "ul",
                { classe: "muted", style: "padding-left:18px;line-height:1.8" },
                estado.faltando.map((v) => el("li", { texto: v })),
              ),
              el("p", {
                classe: "muted",
                texto:
                  "Essas chaves vêm do app em developers.facebook.com (produto Instagram > mensagens). Configure-as nas variáveis de ambiente da Vercel e o cartão vira \"Ativo\" sozinho.",
              }),
            ]),
      ]),
    );
  }

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
      const estado = await get(`/v1/whatsapp/status?venue=${encodeURIComponent(ctx.venue)}`);
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
    const pelaPonte = estado.fonte === "ponte";
    const semConector = estado.status === "sem_conector";

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
              texto: `Versão do sistema no conector: ${estado.versao ?? "desconhecida"}${pelaPonte ? " · via ponte" : ""}`,
            }),
          ]),
          etiqueta(rotulo, variante),
        ]),

        semConector
          ? el("div", { classe: "area-qr" }, [
              el("p", {
                classe: "muted",
                texto:
                  "Nenhum conector dando sinal. Ligue o computador do agente (iniciar-brasa.bat) ou a VPS — assim que ele acordar, esta tela volta sozinha.",
              }),
            ])
          : estado.qr
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
            disabled: ligado || semConector,
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                const res = await post("/v1/whatsapp/conectar", {
                  venue: ctx.venue,
                  agent: seletorAgente.value,
                });
                avisar(
                  res.na_fila
                    ? `Comando enviado. O conector inicia com ${seletorAgente.selectedOptions[0].text} e o QR aparece aqui em ~10 segundos.`
                    : `Conector iniciado com ${seletorAgente.selectedOptions[0].text}. O QR aparece em instantes.`,
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
                const res = await post("/v1/whatsapp/desconectar", { venue: ctx.venue });
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
            "Esta versão da API não tem a ponte do WhatsApp. Atualize o servidor para a versão mais recente.",
        }),
      ]),
    );
  }

  function desenharErro(mensagem) {
    limpar(area).append(vazio("Não deu para consultar o canal", mensagem));
  }
}
