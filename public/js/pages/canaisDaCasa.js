import { ErroApi, del, get, post, put } from "../api.js";
import { avisar, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * Os WhatsApps da casa.
 *
 * Dois números, dois cartões:
 *
 *   · O OFICIAL (Meta). Sem QR, sem computador ligado, sem risco de
 *     banimento. A casa cola o token e os dois IDs que a Meta dá, escolhe
 *     quem responde (ou ninguém — aí o número só envia), e testa. O teste
 *     é o que liga a conexão de fato: ele confere com a Meta se o ID do
 *     telefone é mesmo do telefone e inscreve a conta no app — o passo que
 *     ninguém sabe que existe até faltar. A primeira casa ficou muda por
 *     dias com a conexão "configurada" e esse passo por fazer.
 *
 *   · O DO CONECTOR (Baileys, WhatsApp Web). O número que ENVIA checklist,
 *     confirmação de reserva e avisos, e onde ninguém responde de
 *     propósito: o cozinheiro que manda "ok" no checklist não pode ser
 *     atendido pela recepcionista virtual como cliente novo.
 *
 * Esta tela vive nos Ajustes da casa, e não em módulo nenhum: quem compra
 * só o Checklist precisa de um lugar para conectar o WhatsApp.
 */

const ROTULOS = {
  desconectado: ["Desconectado", ""],
  aguardando_qr: ["Aguardando leitura do QR", "etiqueta-alerta"],
  conectando: ["Conectando…", "etiqueta-alerta"],
  conectado: ["Conectado", "etiqueta-ok"],
  sem_conector: ["Conector desligado", "etiqueta-perigo"],
};

const SITUACOES = {
  nao_configurada: ["Não configurado", ""],
  incompleta: ["Incompleto", "etiqueta-alerta"],
  falta_testar: ["Falta testar", "etiqueta-alerta"],
  ativa: ["Ativo", "etiqueta-ok"],
};

export async function canaisDaCasa(raiz, ctx) {
  const areaOficial = el("div", {});
  const areaConector = el("div", {});
  raiz.append(el("div", { classe: "pilha" }, [areaOficial, areaConector]));

  areaOficial.append(el("p", { classe: "muted", texto: "Consultando a conexão oficial…" }));
  areaConector.append(el("p", { classe: "muted", texto: "Consultando o conector…" }));

  let timer = null;
  ctx.aoSair(() => clearInterval(timer));

  await Promise.all([desenharOficial(), atualizarConector()]);
  timer = setInterval(atualizarConector, 4000);

  // ============================================================
  // O oficial (Meta)
  // ============================================================

  async function desenharOficial() {
    let conexao;
    let agentes = [];
    try {
      [conexao, agentes] = await Promise.all([
        get(`/v1/venues/${encodeURIComponent(ctx.venue)}/whatsapp-oficial`),
        get("/v1/agents?all=1").catch(() => []),
      ]);
    } catch (e) {
      limpar(areaOficial).append(
        el("section", { classe: "cartao" }, [
          el("h2", { texto: "WhatsApp oficial (Meta)" }),
          el("p", { classe: "muted", texto: e instanceof ErroApi && e.status === 404 ? "Atualize o servidor para a versão mais recente para conectar o número oficial." : e.message }),
        ]),
      );
      return;
    }

    const [rotulo, variante] = SITUACOES[conexao.situacao] ?? [conexao.situacao, ""];
    const agenteAtual = agentes.find((a) => a.slug === conexao.agent_slug);
    const temAlgo = conexao.tem_token || conexao.phone_number_id || conexao.waba_id;

    const campoTelefone = el("input", { value: conexao.phone_number_id ?? "", placeholder: "Ex.: 1370957436093649", inputmode: "numeric" });
    const campoConta = el("input", { value: conexao.waba_id ?? "", placeholder: "Ex.: 1582085583665675", inputmode: "numeric" });
    const campoToken = el("input", {
      type: "password",
      autocomplete: "off",
      placeholder: conexao.tem_token ? `Token salvo (${conexao.token_final}) — cole outro só para trocar` : "Cole o token de acesso da Meta",
    });
    const seletorAgente = el("select", { classe: "select" }, [
      el("option", { value: "", texto: "Ninguém — este número só envia (aniversários, promoções, avisos)" }),
      ...agentes.map((a) => el("option", { value: a.slug, texto: a.name, selected: a.slug === conexao.agent_slug })),
    ]);

    const corpoParaSalvar = () => {
      const corpo = {
        phone_number_id: campoTelefone.value.trim(),
        waba_id: campoConta.value.trim(),
        agent_slug: seletorAgente.value,
      };
      // Token só viaja quando a pessoa digitou um: campo vazio = não mexe.
      if (campoToken.value.trim()) corpo.token = campoToken.value.trim();
      return corpo;
    };

    const descricao = conexao.situacao === "ativa"
      ? `Conectado como ${conexao.telefone}${conexao.nome_verificado ? ` (${conexao.nome_verificado})` : ""} · ${agenteAtual ? `atendido por ${agenteAtual.name}` : "só envia, ninguém responde"}`
      : conexao.situacao === "falta_testar"
        ? "Dados preenchidos. Clique em “Testar e ativar” para a Meta confirmar o número e começar a entregar as mensagens."
        : "O número oficial da Meta: sem QR, sem computador ligado e sem risco de banimento. Serve para disparos e, se você escolher um agente, para atendimento.";

    limpar(areaOficial).append(
      el("section", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "WhatsApp oficial (Meta)" }),
            el("p", { classe: "muted", texto: descricao }),
          ]),
          etiqueta(rotulo, variante),
        ]),

        conexao.situacao === "ativa" && !conexao.agent_slug
          ? el("p", {
              classe: "aviso aviso-alerta",
              texto: "Quem responder a este número fala com o vazio. Para atendimento automático, escolha um agente abaixo e salve.",
            })
          : null,

        el("div", { classe: "grade", style: "margin-top:12px" }, [
          campo("ID do telefone", campoTelefone),
          campo("ID da conta do WhatsApp Business", campoConta),
        ]),
        el("div", { classe: "grade", style: "margin-top:12px" }, [
          campo("Token de acesso", campoToken),
          campo("Quem responde por este número", seletorAgente),
        ]),

        el("p", {
          classe: "muted",
          style: "margin-top:10px",
          texto:
            "Onde achar: business.facebook.com → Configurações → Contas do WhatsApp → sua conta. A “Identificação” ali é o ID da CONTA; " +
            "na aba Phone numbers, a “Identificação do número de telefone” é o ID do TELEFONE. Os dois têm o mesmo tamanho — não troque um pelo outro. " +
            "O token fica só no nosso banco e você apaga quando quiser.",
        }),

        el("div", { classe: "linha-campos", style: "margin-top:12px" }, [
          el("button", {
            classe: "btn",
            type: "button",
            texto: "Salvar",
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                await put(`/v1/venues/${encodeURIComponent(ctx.venue)}/whatsapp-oficial`, corpoParaSalvar());
                avisar("Conexão salva. Agora teste para ativar.", "ok");
                await desenharOficial();
              } catch (err) {
                avisar(err.message, "erro");
                e.target.disabled = false;
              }
            },
          }),
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "Testar e ativar",
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                // Salva o que está na tela ANTES de testar: testar o que a
                // pessoa vê, e não o que estava salvo, é o que evita "mas eu
                // corrigi o ID e continua dando erro".
                await put(`/v1/venues/${encodeURIComponent(ctx.venue)}/whatsapp-oficial`, corpoParaSalvar());
                const r = await post(`/v1/venues/${encodeURIComponent(ctx.venue)}/whatsapp-oficial/testar`, {});
                avisar(
                  `A Meta confirmou: ${r.telefone}${r.nome_verificado ? ` (${r.nome_verificado})` : ""}. Conta inscrita no app — as mensagens já chegam.`,
                  "ok",
                );
                await desenharOficial();
              } catch (err) {
                avisar(err.message, "erro");
                e.target.disabled = false;
                await desenharOficial();
              }
            },
          }),
          temAlgo
            ? el("button", {
                classe: "btn btn-perigo",
                type: "button",
                texto: "Remover conexão",
                style: "margin-left:auto",
                onclick: async (e) => {
                  if (!confirm("Remover a conexão oficial desta casa? O número continua seu na Meta; só paramos de usá-lo.")) return;
                  e.target.disabled = true;
                  try {
                    await del(`/v1/venues/${encodeURIComponent(ctx.venue)}/whatsapp-oficial`);
                    avisar("Conexão removida.", "ok");
                    await desenharOficial();
                  } catch (err) {
                    avisar(err.message, "erro");
                    e.target.disabled = false;
                  }
                },
              })
            : null,
        ]),

        el("details", { classe: "detalhes-tecnicos" }, [
          el("summary", { texto: "Detalhes técnicos (equipe Brasa Food)" }),
          el("p", {
            classe: "muted",
            texto: "O app da Meta é um só para o sistema; o webhook dele já aponta para cá. O que muda por casa é o token, os IDs e o agente — tudo nesta tela.",
          }),
          el("pre", { classe: "bloco-codigo", texto: `${location.origin}/v1/whatsapp/webhook` }),
          el("p", {
            classe: "muted",
            texto: "Token: developers.facebook.com → Ferramentas → Explorador da Graph API → token de usuário com whatsapp_business_management e whatsapp_business_messaging → Depurador de token → Estender (60 dias). O permanente sai do usuário do sistema da BM, quando ela deixar.",
          }),
        ]),
      ].filter(Boolean)),
    );
  }

  // ============================================================
  // O do conector (Baileys)
  // ============================================================

  async function atualizarConector() {
    try {
      // O do agente vem junto só para conferir se é o mesmo número: usar o
      // mesmo chip nos dois ressuscita o bug do funcionário atendido pela IA,
      // e é melhor avisar do que deixar descobrir sozinho.
      const [estado, doAgente] = await Promise.all([
        get(`/v1/whatsapp/status?venue=${encodeURIComponent(ctx.venue)}&papel=administrativo`),
        get(`/v1/whatsapp/status?venue=${encodeURIComponent(ctx.venue)}&papel=agente`).catch(() => null),
      ]);
      desenharConector(estado, doAgente);
    } catch (e) {
      clearInterval(timer);
      if (e instanceof ErroApi && e.status === 501) {
        limpar(areaConector).append(
          vazio(
            "Conector indisponível nesta versão",
            "Atualize o servidor para a versão mais recente para conectar o WhatsApp da casa.",
          ),
        );
      } else {
        limpar(areaConector).append(vazio("WhatsApp indisponível", e.message));
      }
    }
  }

  function desenharConector(estado, doAgente) {
    const [rotulo, variante] = ROTULOS[estado.status] ?? [estado.status, ""];
    const ligado = estado.status === "conectado" || estado.status === "conectando";
    const semConector = estado.status === "sem_conector";
    const mesmoNumero =
      estado.telefone && doAgente?.telefone && estado.telefone === doAgente.telefone;

    limpar(areaConector).append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cartao" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: "WhatsApp do conector (WhatsApp Web)" }),
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

function campo(rotulo, controle) {
  return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
}
