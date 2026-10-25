/**
 * O espaço do funcionário: o link fixo que ele guarda no WhatsApp.
 *
 * Só o que é dele: a escala das próximas duas semanas, a gorjeta da semana
 * (com a meta que falta), as férias, os treinamentos, o próprio DISC e as
 * avaliações que já foram conversadas. E o atestado por foto, que vai para a
 * casa e marca a escala sozinho.
 */

const raiz = document.getElementById("eu");
const token = location.pathname.split("/").filter(Boolean)[1] ?? "";
const CORES = { D: "#c1121f", I: "#f4a100", S: "#1a7a4a", C: "#2563a8" };
const reais = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso) => String(iso ?? "").slice(0, 10).split("-").reverse().join("/");
const diaDaSemana = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
const SITUACAO = { folga: "Folga", ferias: "Férias", atestado: "Atestado", falta: "Falta" };

function el(tag, props = {}, filhos = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "texto") n.textContent = v;
    else if (k === "classe") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const f of [].concat(filhos)) if (f) n.append(f);
  return n;
}

async function api(caminho = "", opcoes = {}) {
  const r = await fetch(`/v1/eu/${encodeURIComponent(token)}${caminho}`, opcoes);
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok || corpo.success === false) throw new Error(corpo?.error?.message ?? "Não deu certo. Tente de novo.");
  return corpo.data;
}

async function iniciar() {
  let d;
  try {
    d = await api();
  } catch (e) {
    raiz.replaceChildren(el("h1", { texto: "Link indisponível" }), el("p", { classe: "aviso", texto: e.message }));
    return;
  }
  document.title = `Meu espaço — ${d.casa}`;
  const primeiro = String(d.nome ?? "").split(" ")[0];
  raiz.replaceChildren(...[
    el("div", {}, [el("p", { classe: "apoio", texto: d.casa }), el("h1", { texto: `Olá, ${primeiro}!` })]),
    cartaoDaEscala(d),
    d.gorjeta ? cartaoDaGorjeta(d.gorjeta) : null,
    cartaoDoAtestado(),
    d.treinos.length ? cartaoDosTreinos(d) : null,
    d.ferias ? cartaoDasFerias(d.ferias) : null,
    d.disc ? cartaoDoDisc(d.disc) : null,
    d.avaliacoes.length ? cartaoDasAvaliacoes(d.avaliacoes) : null,
    el("p", { classe: "marca", texto: "Brasa Food" }),
  ].filter(Boolean));
}

function cartaoDaEscala(d) {
  return el("section", { classe: "cartao" }, [
    el("h2", { texto: "Minha escala" }),
    d.escala.length
      ? el("div", {}, d.escala.map((e) =>
          el("div", { classe: "dia" }, [
            el("span", { classe: "quando", texto: diaDaSemana(e.data) }),
            e.situacao === "trabalha"
              ? el("span", { texto: [e.turno, e.funcao].filter(Boolean).join(" · ") || "Trabalha" })
              : el("span", { classe: "folga", texto: SITUACAO[e.situacao] ?? e.situacao }),
          ])))
      : el("p", { classe: "apoio", texto: "A escala das próximas semanas ainda não saiu." }),
  ]);
}

function cartaoDaGorjeta(g) {
  const linha = (rotulo, valor, sinal = "") => (valor ? el("div", { classe: "par" }, [el("span", { texto: rotulo }), el("strong", { texto: `${sinal}${reais(valor)}` })]) : null);
  return el("section", { classe: "cartao" }, [
    el("h2", { texto: "Minha gorjeta desta semana" }),
    el("p", { classe: "apoio", texto: g.semana }),
    g.vendas ? el("div", { classe: "par" }, [el("span", { texto: "Minhas vendas" }), el("strong", { texto: reais(g.vendas) })]) : null,
    linha("Comissão", g.comissao),
    linha("Rateio", g.rateio),
    linha("Bônus da meta", g.bonus_meta),
    linha("Adicionais", g.adicionais, "+ "),
    linha("Descontos", g.descontos, "− "),
    el("div", { classe: "par total" }, [el("span", { texto: "A receber até agora" }), el("strong", { texto: reais(g.a_receber) })]),
    g.meta_proxima ? el("p", { classe: "ok", texto: `Faltam ${reais(g.meta_proxima.falta)} em vendas para ganhar +${g.meta_proxima.bonus}% nesta semana!` }) : null,
    el("p", { classe: "apoio", texto: "A semana fecha no domingo. O valor final é o que a casa confere no acerto." }),
  ]);
}

function cartaoDoAtestado() {
  const arquivo = el("input", { type: "file", accept: "image/*,application/pdf", capture: "environment", hidden: true });
  const resultado = el("p", { "aria-live": "polite" });
  const botao = el("button", { classe: "botao", type: "button", texto: "Mandar foto do atestado", onclick: () => arquivo.click() });
  arquivo.addEventListener("change", async () => {
    const f = arquivo.files?.[0];
    if (!f) return;
    botao.disabled = true;
    resultado.className = "apoio";
    resultado.textContent = "Enviando…";
    try {
      const corpo = f.type.startsWith("image/") ? await reduzir(f) : f;
      const r = await api("/atestado", { method: "POST", headers: { "content-type": corpo.type || f.type }, body: corpo });
      resultado.className = "ok";
      resultado.textContent = r.dias
        ? `Recebido: ${r.dias} dia(s), de ${dataBr(r.inicio)} a ${dataBr(r.fim)}. A casa já foi avisada e a sua escala foi marcada.`
        : "Recebido! A casa foi avisada e vai conferir o período.";
    } catch (e) {
      resultado.className = "aviso";
      resultado.textContent = e.message;
    } finally {
      botao.disabled = false;
      arquivo.value = "";
    }
  });
  return el("section", { classe: "cartao" }, [
    el("h2", { texto: "Atestado médico" }),
    el("p", { classe: "apoio", texto: "Tire uma foto do atestado. Ele vai direto para a casa, que já fica sabendo dos dias." }),
    botao,
    arquivo,
    resultado,
  ]);
}

function cartaoDosTreinos(d) {
  const lista = el("div", {});
  const desenhar = () => {
    lista.replaceChildren(...d.treinos.map((t) =>
      el("div", { classe: "dia" }, [
        el("div", {}, [el("strong", { texto: t.titulo }), t.feito ? el("small", { classe: "ok", texto: ` ✓ ${t.feito.acertos} de ${t.feito.total}` }) : el("small", { classe: "apoio", texto: " para fazer" })]),
        el("button", { classe: "botao botao-leve", type: "button", texto: t.feito ? "Refazer" : "Fazer", onclick: () => abrirTreino(t, (feito) => { t.feito = feito; desenhar(); }) }),
      ])));
  };
  desenhar();
  return el("section", { classe: "cartao" }, [el("h2", { texto: "Meus treinamentos" }), lista]);
}

function abrirTreino(t, aoTerminar) {
  const escolhas = t.perguntas.map(() => null);
  const resultado = el("p", { "aria-live": "polite" });
  const painel = el("section", { classe: "cartao" }, [
    el("h2", { texto: t.titulo }),
    t.descricao ? el("p", { texto: t.descricao }) : null,
    t.video_url ? el("a", { classe: "botao botao-leve", href: t.video_url, target: "_blank", rel: "noopener", texto: "▶ Assistir o vídeo" }) : null,
    ...t.perguntas.map((p, i) =>
      el("div", {}, [
        el("p", { classe: "pergunta", texto: `${i + 1}. ${p.pergunta}` }),
        ...p.opcoes.map((o, j) =>
          el("label", { classe: "opcao" }, [
            el("input", { type: "radio", name: `p${i}`, onchange: () => { escolhas[i] = j; } }),
            el("span", { texto: o }),
          ])),
      ])),
    el("button", {
      classe: "botao",
      type: "button",
      texto: "Enviar respostas",
      onclick: async (e) => {
        if (escolhas.some((x) => x === null)) {
          resultado.className = "aviso";
          resultado.textContent = "Responda todas as perguntas.";
          return;
        }
        e.target.disabled = true;
        try {
          const r = await api(`/treino/${t.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ respostas: escolhas }) });
          resultado.className = r.acertos === r.total ? "ok" : "aviso";
          resultado.textContent = r.acertos === r.total
            ? `Acertou tudo: ${r.acertos} de ${r.total}! 🎉`
            : `Acertou ${r.acertos} de ${r.total}. Reveja a(s) pergunta(s) ${r.erradas.join(", ")} e tente de novo.`;
          aoTerminar({ acertos: r.acertos, total: r.total });
        } catch (err) {
          resultado.className = "aviso";
          resultado.textContent = err.message;
        } finally {
          e.target.disabled = false;
        }
      },
    }),
    resultado,
  ]);
  document.querySelector("#treino-aberto")?.remove();
  painel.id = "treino-aberto";
  raiz.querySelector(".marca").before(painel);
  painel.scrollIntoView({ behavior: "smooth" });
}

function cartaoDasFerias(f) {
  return el("section", { classe: "cartao" }, [
    el("h2", { texto: "Minhas férias" }),
    f.proximas.length
      ? el("div", {}, f.proximas.map((x) => el("div", { classe: "dia" }, [el("span", { texto: `${dataBr(x.inicio)} a ${dataBr(x.fim)}` }), el("span", { classe: "apoio", texto: x.situacao === "aprovado" ? "aprovadas" : "pedidas" })])))
      : el("p", { classe: "apoio", texto: "Nenhuma férias marcada." }),
    f.alerta
      ? el("p", { classe: f.alerta.vencido ? "aviso" : "apoio", texto: f.alerta.vencido ? "Você tem férias vencidas. Converse com a casa para marcar." : `Suas férias precisam ser tiradas até ${dataBr(f.alerta.limite)}.` })
      : null,
  ]);
}

function cartaoDoDisc(disc) {
  return el("section", { classe: "cartao" }, [
    el("h2", { texto: `Meu perfil: ${disc.perfil}` }),
    ...[["D", disc.d], ["I", disc.i], ["S", disc.s], ["C", disc.c]].map(([f, v]) =>
      el("div", { classe: "fator" }, [el("span", { texto: f }), el("div", { classe: "fator-trilho" }, [el("span", { style: `width:${v}%;background:${CORES[f]}` })]), el("span", { classe: "num", texto: String(v) })])),
    ...disc.descricao.map((d) => el("p", {}, [el("strong", { texto: `${d.nome}: ` }), d.resumo])),
  ]);
}

function cartaoDasAvaliacoes(lista) {
  return el("section", { classe: "cartao" }, [
    el("h2", { texto: "Minhas avaliações" }),
    ...lista.map((a) =>
      el("div", { classe: "pilha-fina" }, [
        el("div", { classe: "par" }, [el("span", { classe: "quando", texto: dataBr(a.dia) }), el("strong", { texto: `${String(Number(a.media).toFixed(1)).replace(".", ",")} de 5` })]),
        a.pontos_fortes ? el("p", {}, [el("strong", { texto: "Pontos fortes: " }), a.pontos_fortes]) : null,
        a.melhorar ? el("p", {}, [el("strong", { texto: "A melhorar: " }), a.melhorar]) : null,
        a.combinados?.length ? el("p", {}, [el("strong", { texto: "Combinados: " }), a.combinados.join(" · ")]) : null,
      ])),
  ]);
}

async function reduzir(arquivo) {
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((ok) => canvas.toBlob((b) => ok(b ?? arquivo), "image/jpeg", 0.85));
  } catch {
    return arquivo;
  }
}

iniciar();
