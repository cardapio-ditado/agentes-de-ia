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

    limpar(area).append(
      el("section", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "WhatsApp" }),
            el("p", {
              classe: "muted",
              texto: estado.telefone ? `Conectado como ${estado.telefone}` : "Nenhum número pareado",
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
                    : "Clique em conectar para gerar o QR de pareamento.",
              }),
            ]),

        el("div", { classe: "reserva-acoes" }, [
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "Conectar",
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                await post("/v1/whatsapp/conectar", { venue: ctx.venue, agent: ctx.agente });
                avisar("Conector iniciado. O QR aparece em instantes.", "ok");
              } catch (err) {
                avisar(err.message, "erro");
              } finally {
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
