import { del, get, post, put } from "../api.js";
import { ICONES, acaoIcone, avisar, botaoVoltar, campoDeFormulario, comIcone, el, esqueleto, estadoDeErro, preencher, vazio } from "../ui.js";

/**
 * RH — Treinamentos: vídeo curto e até cinco perguntas, por função.
 *
 * O vídeo pode ser o do mentor (YouTube, Drive) ou o do próprio dono gravado
 * no celular. A equipe faz pelo espaço do funcionário, e esta tela mostra
 * quem fez e quanto acertou. Os modelos prontos já vêm com as perguntas: é
 * só pôr o vídeo e salvar.
 */
export function criarTreinamentos(corpo, ctx) {
  let lista = [];
  let modelos = [];
  return { recarregar };

  async function recarregar() {
    preencher(corpo, esqueleto({ linhas: 4 }));
    try {
      [lista, modelos] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/rh/treinamentos`),
        get(`/v1/venues/${ctx.venue}/rh/treinamentos/modelos`).catch(() => []),
      ]);
    } catch (e) {
      ctx.definirAcoes?.();
      preencher(corpo, estadoDeErro("Não deu para carregar os treinamentos", e.message, recarregar));
      return;
    }
    desenharLista();
  }

  function desenharLista() {
    const titulos = new Set(lista.map((t) => t.titulo.toLowerCase()));
    ctx.definirAcoes?.(
      el("button", { classe: "btn btn-primario", type: "button", onclick: () => editor(null) }, comIcone(ICONES.mais, "Novo treinamento")),
    );
    preencher(corpo, el("div", { classe: "pilha" }, [
      el("p", { classe: "muted", texto: "Vídeo curto e perguntas rápidas. A equipe faz pelo espaço do funcionário (o link fica na ficha de cada um)." }),
      lista.length
        ? el("div", { classe: "pilha" }, lista.map(cartao))
        : vazio("Nenhum treinamento ainda", "Comece por um modelo pronto abaixo: as perguntas já vêm feitas."),
      el("section", { classe: "pilha" }, [
        el("h3", { texto: "Modelos prontos" }),
        el("div", { classe: "modelos" }, modelos.map((m) =>
          el("article", { classe: "modelo" }, [
            el("strong", { texto: m.titulo }),
            el("span", { classe: "muted", texto: m.descricao }),
            el("span", { classe: "muted", texto: `${m.funcao ? `Para: ${m.funcao}` : "Para a equipe toda"} · ${m.perguntas.length} perguntas` }),
            el("button", {
              classe: "btn btn-peq",
              type: "button",
              texto: titulos.has(m.titulo.toLowerCase()) ? "Usar de novo" : "Usar este modelo",
              onclick: () => editor(structuredClone(m)),
            }),
          ]))),
      ]),
    ]));
  }

  function cartao(t) {
    return el("article", { classe: "cartao pilha" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: t.titulo }),
          el("p", { classe: "muted", texto: `${t.funcao ? `Para: ${t.funcao}` : "Para a equipe toda"} · ${t.perguntas.length} ${t.perguntas.length === 1 ? "pergunta" : "perguntas"}${t.video_url ? " · com vídeo" : " · sem vídeo ainda"}` }),
        ]),
        el("div", { classe: "reserva-acoes" }, [
          acaoIcone({ iconePath: ICONES.editar, rotulo: "Editar este treinamento", aoClicar: () => editor(t) }),
          acaoIcone({
            iconePath: ICONES.lixeira,
            rotulo: "Tirar este treinamento",
            variante: "perigo",
            aoClicar: async () => {
              if (!confirm(`Tirar "${t.titulo}"? Quem já fez continua registrado.`)) return;
              try {
                await del(`/v1/venues/${ctx.venue}/rh/treinamentos/${t.id}`);
                await recarregar();
              } catch (e) {
                avisar(e.message, "erro");
              }
            },
          }),
        ]),
      ]),
      t.feitos.length
        ? el("p", { classe: "muted", style: "margin:0", texto: `Fizeram: ${t.feitos.map((f) => `${f.nome} (${f.acertos}/${f.total})`).join(" · ")}` })
        : el("p", { classe: "muted", style: "margin:0", texto: "Ninguém fez ainda." }),
    ]);
  }

  function editor(existente) {
    const titulo = el("input", { classe: "input", value: existente?.titulo ?? "", placeholder: "Como atender uma mesa" });
    const funcao = el("input", { classe: "input", value: existente?.funcao ?? "", placeholder: "Garçom, Cozinha… (vazio = equipe toda)" });
    const descricao = el("textarea", { classe: "input", rows: 2, texto: existente?.descricao ?? "" });
    const video = el("input", { classe: "input", value: existente?.video_url ?? "", placeholder: "https://youtu.be/… (opcional)" });
    const perguntas = (existente?.perguntas ?? []).map((p) => ({ pergunta: p.pergunta, opcoes: [...p.opcoes], certa: p.certa }));
    const area = el("div", { classe: "pilha" });

    const desenharPerguntas = () => {
      preencher(area, 
        ...perguntas.map((p, i) => {
          const campoPergunta = el("input", { classe: "input", value: p.pergunta, placeholder: `Pergunta ${i + 1}`, oninput: (e) => { p.pergunta = e.target.value; } });
          return el("div", { classe: "cartao pilha", style: "padding:12px" }, [
            el("div", { classe: "cabecalho-secao" }, [
              el("strong", { texto: `Pergunta ${i + 1}` }),
              el("button", { classe: "btn btn-peq btn-perigo", type: "button", texto: "Tirar", onclick: () => { perguntas.splice(i, 1); desenharPerguntas(); } }),
            ]),
            campoPergunta,
            ...p.opcoes.map((o, j) =>
              el("label", { classe: "linha-campos", style: "align-items:center;gap:8px" }, [
                el("input", { type: "radio", name: `certa-${i}`, checked: p.certa === j, title: "Marque a resposta certa", onchange: () => { p.certa = j; } }),
                el("input", { classe: "input", value: o, placeholder: `Opção ${j + 1}`, oninput: (e) => { p.opcoes[j] = e.target.value; } }),
              ])),
            p.opcoes.length < 4
              ? el("button", { classe: "btn btn-peq", type: "button", texto: "+ opção", onclick: () => { p.opcoes.push(""); desenharPerguntas(); } })
              : null,
            el("small", { classe: "muted", texto: "Marque a bolinha da resposta certa." }),
          ]);
        }),
        perguntas.length < 5
          ? el("button", { classe: "btn btn-peq", type: "button", texto: "+ Pergunta", onclick: () => { perguntas.push({ pergunta: "", opcoes: ["", ""], certa: 0 }); desenharPerguntas(); } })
          : el("span", {}),
      );
    };
    desenharPerguntas();

    ctx.definirAcoes?.();
    preencher(corpo, 
      el("div", { classe: "cabecalho-secao" }, [
        el("h2", { texto: existente?.id ? `Editar: ${existente.titulo}` : "Novo treinamento" }),
        botaoVoltar(desenharLista, "Treinamentos"),
      ]),
      el("section", { classe: "cartao pilha" }, [
        el("div", { classe: "grade grade-2" }, [
          campoDeFormulario("Título", titulo),
          campoDeFormulario("Para quem (função)", funcao),
        ]),
        campoDeFormulario("Do que se trata", descricao),
        campoDeFormulario("Link do vídeo", video, el("small", { classe: "muted", texto: "YouTube (pode ser não listado), Google Drive ou Loom. Grave no celular mesmo: 2 a 5 minutos bastam." })),
      ]),
      el("section", { classe: "pilha" }, [el("h3", { texto: "Perguntas (até 5)" }), area]),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Salvar treinamento",
          onclick: async (e) => {
            e.target.disabled = true;
            const corpoDoTreino = {
              titulo: titulo.value,
              funcao: funcao.value,
              descricao: descricao.value,
              video_url: video.value,
              perguntas: perguntas.map((p) => ({ ...p, opcoes: p.opcoes.filter((o) => o.trim()) })),
            };
            try {
              if (existente?.id) await put(`/v1/venues/${ctx.venue}/rh/treinamentos/${existente.id}`, corpoDoTreino);
              else await post(`/v1/venues/${ctx.venue}/rh/treinamentos`, corpoDoTreino);
              avisar("Treinamento salvo. A equipe já vê no espaço do funcionário.", "ok");
              await recarregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      ]),
    );
  }
}
