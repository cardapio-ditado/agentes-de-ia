import { ErroApi, get, post } from "../api.js";
import { avisar, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * O WhatsApp da casa: o número que ENVIA.
 *
 * Checklist, confirmação de reserva, aviso de estoque — tudo sai por aqui. E
 * ninguém responde do outro lado: o funcionário que manda "ok" depois de
 * receber o link fala com o vazio, de propósito.
 *
 * Essa era a raiz de dois problemas. O primeiro: com uma conexão só, o
 * cozinheiro que respondia o checklist era atendido pela recepcionista
 * virtual como se fosse cliente novo querendo reserva. O segundo: quem
 * comprasse Checklist sem o módulo Agente não tinha onde conectar o
 * WhatsApp, porque o QR morava dentro do módulo que ele não comprou.
 *
 * Por isso esta tela vive nos Ajustes da casa, e não em módulo nenhum.
 */

const ROTULOS = {
  desconectado: ["Desconectado", ""],
  aguardando_qr: ["Aguardando leitura do QR", "etiqueta-alerta"],
  conectando: ["Conectando…", "etiqueta-alerta"],
  conectado: ["Conectado", "etiqueta-ok"],
  sem_conector: ["Conector desligado", "etiqueta-perigo"],
};

export async function canaisDaCasa(raiz, ctx) {
  const area = el("div", {});
  raiz.append(area);
  area.append(el("p", { classe: "muted", texto: "Consultando o conector…" }));

  let timer = null;
  ctx.aoSair(() => clearInterval(timer));

  await atualizar();
  timer = setInterval(atualizar, 4000);

  async function atualizar() {
    try {
      // O do agente vem junto só para conferir se é o mesmo número: usar o
      // mesmo chip nos dois ressuscita o bug do funcionário atendido pela IA,
      // e é melhor avisar do que deixar descobrir sozinho.
      const [estado, doAgente] = await Promise.all([
        get(`/v1/whatsapp/status?venue=${encodeURIComponent(ctx.venue)}&papel=administrativo`),
        get(`/v1/whatsapp/status?venue=${encodeURIComponent(ctx.venue)}&papel=agente`).catch(() => null),
      ]);
      desenhar(estado, doAgente);
    } catch (e) {
      clearInterval(timer);
      if (e instanceof ErroApi && e.status === 501) {
        limpar(area).append(
          vazio(
            "Conector indisponível nesta versão",
            "Atualize o servidor para a versão mais recente para conectar o WhatsApp da casa.",
          ),
        );
      } else {
        limpar(area).append(vazio("WhatsApp indisponível", e.message));
      }
    }
  }

  function desenhar(estado, doAgente) {
    const [rotulo, variante] = ROTULOS[estado.status] ?? [estado.status, ""];
    const ligado = estado.status === "conectado" || estado.status === "conectando";
    const semConector = estado.status === "sem_conector";
    const mesmoNumero =
      estado.telefone && doAgente?.telefone && estado.telefone === doAgente.telefone;

    limpar(area).append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cartao" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: "WhatsApp da casa" }),
              el("p", {
                classe: "muted",
                texto: estado.telefone
                  ? `Conectado como ${estado.telefone}`
                  : "Nenhum número pareado",
              }),
              el("p", {
                classe: "muted",
                texto: `Versão do sistema no conector: ${estado.versao ?? "desconhecida"}`,
              }),
            ]),
            etiqueta(rotulo, variante),
          ]),

          el("p", {
            classe: "aviso aviso-alerta",
            texto:
              "Este número só ENVIA: link de checklist, confirmação de reserva e avisos. Quem responder aqui não é atendido por ninguém — para atendimento automático, use o módulo Agentes de IA, que tem número próprio.",
          }),

          mesmoNumero
            ? el("p", {
                classe: "aviso aviso-perigo",
                texto:
                  "Este é o MESMO número do agente. Usando o mesmo chip nos dois, o agente também vai responder as mensagens da equipe — o funcionário que mandar “ok” no checklist será atendido como cliente. Use um chip separado.",
              })
            : null,

          semConector
            ? el("div", { classe: "area-qr" }, [
                el("p", {
                  classe: "muted",
                  texto:
                    "Nenhum conector administrativo dando sinal. Ligue o computador do bar (ou a VPS) com o conector administrativo rodando — assim que ele acordar, esta tela volta sozinha.",
                }),
              ])
            : estado.qr
              ? el("div", { classe: "area-qr" }, [
                  el("img", { src: estado.qr, alt: "QR de pareamento do WhatsApp da casa" }),
                  el("p", { classe: "muted", texto: "Abra o WhatsApp do número administrativo → Aparelhos conectados → Conectar aparelho." }),
                ])
              : el("div", { classe: "area-qr" }, [
                  el("p", {
                    classe: "muted",
                    texto:
                      estado.status === "conectado"
                        ? "Número pareado. Os disparos da casa já saem por aqui."
                        : "Clique em conectar para gerar o QR de pareamento.",
                  }),
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
