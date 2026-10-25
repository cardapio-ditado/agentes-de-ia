/**
 * O teste DISC, no celular do funcionário.
 *
 * Um bloco de quatro palavras por vez: primeiro a que MAIS combina, depois a
 * que MENOS combina. As palavras aparecem embaralhadas (a ordem guardada no
 * servidor é sempre D, I, S, C; mostrar nessa ordem ensinaria a "acertar").
 * No fim a pessoa vê o próprio resultado — o perfil é dela.
 */

const raiz = document.getElementById("disc");
const token = location.pathname.split("/").filter(Boolean)[1] ?? "";
const CORES = { D: "#c1121f", I: "#f4a100", S: "#1a7a4a", C: "#2563a8" };

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
  const r = await fetch(`/v1/disc/${encodeURIComponent(token)}`, opcoes);
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok || corpo.success === false) throw new Error(corpo?.error?.message ?? "Não deu certo. Tente de novo.");
  return corpo.data;
}

function embaralhar(n) {
  const ordem = [...Array(n).keys()];
  for (let i = ordem.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
  }
  return ordem;
}

async function iniciar() {
  let dados;
  try {
    dados = await api();
  } catch (e) {
    raiz.replaceChildren(el("h1", { texto: "Link indisponível" }), el("p", { classe: "aviso", texto: e.message }));
    return;
  }
  document.title = `Seu jeito de trabalhar — ${dados.casa}`;
  const primeiro = String(dados.nome ?? "").split(" ")[0];
  raiz.replaceChildren(
    el("div", {}, [
      el("p", { classe: "apoio", texto: dados.casa }),
      el("h1", { texto: `Olá${primeiro ? `, ${primeiro}` : ""}! Como é o seu jeito de trabalhar?` }),
    ]),
    el("section", { classe: "cartao" }, [
      el("p", { texto: `São ${dados.blocos.length} blocos de quatro palavras. Em cada um, toque na palavra que MAIS combina com você no trabalho e depois na que MENOS combina.` }),
      el("p", { classe: "apoio", texto: "Não tem resposta certa nem errada, e não é prova. Responda pensando em como você é de verdade, não em como gostaria de ser. Leva uns 5 minutos." }),
      el("button", { classe: "botao", type: "button", texto: "Começar", onclick: () => bloco(dados, 0, []) }),
    ]),
    el("p", { classe: "marca", texto: "Brasa Food" }),
  );
}

function bloco(dados, n, respostas) {
  const palavras = dados.blocos[n];
  const ordem = embaralhar(palavras.length);
  let mais = null;
  const pergunta = el("p", { classe: "pergunta", texto: "Qual MAIS combina com você?" });
  const botoes = ordem.map((indice) =>
    el("button", {
      classe: "palavra",
      type: "button",
      texto: palavras[indice],
      onclick: (e) => {
        if (mais === null) {
          mais = indice;
          e.currentTarget.setAttribute("data-mais", "");
          e.currentTarget.disabled = true;
          pergunta.textContent = "E qual MENOS combina?";
          return;
        }
        e.currentTarget.setAttribute("data-menos", "");
        for (const b of botoes) b.disabled = true;
        const novas = [...respostas, { mais, menos: indice }];
        setTimeout(() => (n + 1 < dados.blocos.length ? bloco(dados, n + 1, novas) : enviar(novas)), 250);
      },
    }),
  );
  // replaceChildren escreve "null" na tela se receber null: filtra antes.
  raiz.replaceChildren(...[
    el("div", { classe: "barra-progresso", role: "progressbar", "aria-valuenow": String(n), "aria-valuemax": String(dados.blocos.length) }, [
      el("span", { style: `width:${Math.round((n / dados.blocos.length) * 100)}%` }),
    ]),
    el("p", { classe: "apoio", texto: `${n + 1} de ${dados.blocos.length}` }),
    el("section", { classe: "cartao" }, [pergunta, el("div", { classe: "palavras" }, botoes)]),
    n > 0
      ? el("button", { classe: "botao botao-leve", type: "button", texto: "← Voltar um", onclick: () => bloco(dados, n - 1, respostas.slice(0, -1)) })
      : null,
  ].filter(Boolean));
}

async function enviar(respostas) {
  raiz.replaceChildren(el("p", { classe: "apoio", texto: "Calculando o seu perfil…" }));
  let r;
  try {
    r = await api({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ respostas }) });
  } catch (e) {
    raiz.replaceChildren(el("p", { classe: "aviso", texto: e.message }), el("button", { classe: "botao", type: "button", texto: "Tentar de novo", onclick: () => enviar(respostas) }));
    return;
  }
  const fatores = [["D", r.d], ["I", r.i], ["S", r.s], ["C", r.c]];
  raiz.replaceChildren(
    el("div", {}, [
      el("p", { classe: "apoio", texto: "Seu resultado" }),
      el("h1", { texto: `Seu perfil: ${r.perfil}` }),
    ]),
    el("section", { classe: "cartao" }, fatores.map(([f, v]) =>
      el("div", { classe: "fator" }, [
        el("span", { texto: f }),
        el("div", { classe: "fator-trilho" }, [el("span", { style: `width:${v}%;background:${CORES[f]}` })]),
        el("span", { classe: "num", texto: String(v) }),
      ]))),
    ...r.descricao.map((d) =>
      el("section", { classe: "cartao" }, [
        el("h2", { texto: d.nome }),
        el("p", { texto: d.resumo }),
        el("p", {}, [el("strong", { texto: "Onde você brilha: " }), d.fortes]),
        el("p", {}, [el("strong", { texto: "Fique de olho: " }), d.cuidado]),
      ])),
    el("p", { classe: "apoio", texto: "Ninguém é um perfil só: todo mundo tem um pouco dos quatro. O resultado já foi para a casa, para a liderança saber o melhor jeito de trabalhar com você." }),
    el("p", { classe: "marca", texto: "Brasa Food" }),
  );
}

iniciar();
