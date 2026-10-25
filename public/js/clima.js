/**
 * A pesquisa de clima, no celular de quem trabalha na casa.
 *
 * Anônima de verdade: o link é da pessoa (para votar uma vez), mas a
 * resposta é gravada sem nome, sem hora, e o resultado só aparece para a
 * casa com três respostas ou mais. A tela diz isso logo no topo — sem essa
 * confiança, a resposta vem toda "10".
 */
const raiz = document.getElementById("clima");
const token = location.pathname.split("/").filter(Boolean)[1] ?? "";

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

async function api(opcoes = {}) {
  const r = await fetch(`/v1/clima/${encodeURIComponent(token)}`, opcoes);
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok || corpo.success === false) throw new Error(corpo?.error?.message ?? "Não deu certo. Tente de novo.");
  return corpo.data;
}

function escala(de, ate, aoEscolher, classe = "") {
  const botoes = [];
  for (let n = de; n <= ate; n++) {
    botoes.push(el("button", {
      type: "button",
      texto: String(n),
      "aria-pressed": "false",
      onclick: () => {
        for (const b of botoes) b.setAttribute("aria-pressed", String(b === botoes[n - de]));
        aoEscolher(n);
      },
    }));
  }
  return el("div", { classe: `escala ${classe}`.trim() }, botoes);
}

async function iniciar() {
  let d;
  try {
    d = await api();
  } catch (e) {
    raiz.replaceChildren(el("h1", { texto: "Obrigado!" }), el("p", { classe: "aviso", texto: e.message }));
    return;
  }
  let enps = null;
  const notas = {};
  const comentario = el("textarea", { rows: 3, placeholder: "O que a casa podia fazer melhor para você? (opcional)" });
  const resultado = el("p", { "aria-live": "polite" });
  raiz.replaceChildren(
    el("div", {}, [el("p", { classe: "apoio", texto: d.casa }), el("h1", { texto: "Como está sendo trabalhar aqui?" })]),
    el("p", { classe: "ok", texto: "🔒 É anônimo: a casa vê só o resumo de todo mundo junto, e só quando pelo menos 3 pessoas responderem." }),
    el("section", { classe: "cartao" }, [
      el("p", { classe: "pergunta", texto: "De 0 a 10, você indicaria trabalhar aqui para um amigo?" }),
      escala(0, 10, (n) => { enps = n; }),
      el("div", { classe: "extremos" }, [el("span", { texto: "de jeito nenhum" }), el("span", { texto: "com certeza" })]),
    ]),
    el("section", { classe: "cartao" }, [
      el("p", { classe: "apoio", texto: "De 1 (discordo) a 5 (concordo totalmente):" }),
      ...d.perguntas.map((p) => el("div", {}, [el("p", { classe: "pergunta", texto: p.texto }), escala(1, 5, (n) => { notas[p.id] = n; }, "escala-5")])),
    ]),
    el("section", { classe: "cartao" }, [
      comentario,
      el("button", {
        classe: "botao",
        type: "button",
        texto: "Mandar",
        onclick: async (e) => {
          if (enps === null) {
            resultado.className = "aviso";
            resultado.textContent = "Responda a primeira pergunta (de 0 a 10).";
            return;
          }
          e.target.disabled = true;
          try {
            await api({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enps, notas, comentario: comentario.value }) });
            raiz.replaceChildren(el("h1", { texto: "Obrigado! 🙏" }), el("p", { texto: "Sua resposta foi guardada sem o seu nome. A casa vai olhar o resumo do mês." }), el("p", { classe: "marca", texto: "Brasa Food" }));
          } catch (err) {
            resultado.className = "aviso";
            resultado.textContent = err.message;
            e.target.disabled = false;
          }
        },
      }),
      resultado,
    ]),
    el("p", { classe: "marca", texto: "Brasa Food" }),
  );
}

iniciar();
