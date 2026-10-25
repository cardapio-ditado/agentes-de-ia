/**
 * Trabalhe conosco: o candidato deixa nome, WhatsApp, a função e um pouco da
 * experiência. Cai direto na lista de contratação do RH da casa — sem
 * currículo em papel, sem mensagem perdida no direct.
 */
const raiz = document.getElementById("vaga");
const casa = location.pathname.split("/").filter(Boolean)[1] ?? "";

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
  const r = await fetch(`/v1/vaga/${encodeURIComponent(casa)}`, opcoes);
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok || corpo.success === false) throw new Error(corpo?.error?.message ?? "Não deu certo. Tente de novo.");
  return corpo.data;
}

async function iniciar() {
  let d;
  try {
    d = await api();
  } catch (e) {
    raiz.replaceChildren(el("h1", { texto: "Página indisponível" }), el("p", { classe: "aviso", texto: e.message }));
    return;
  }
  document.title = `Trabalhe conosco — ${d.casa}`;
  const nome = el("input", { type: "text", autocomplete: "name" });
  const telefone = el("input", { type: "tel", inputmode: "numeric", autocomplete: "tel" });
  const funcao = el("select", {}, ["Garçom / garçonete", "Bar", "Cozinha", "Caixa", "Recepção", "Limpeza", "Outra"].map((f) => el("option", { value: f, texto: f })));
  const tipo = el("select", {}, [el("option", { value: "vaga", texto: "Quero trabalhar fixo" }), el("option", { value: "extra", texto: "Quero fazer extras (fins de semana, eventos)" })]);
  const experiencia = el("textarea", { rows: 4, placeholder: "Onde já trabalhou, quanto tempo, o que sabe fazer." });
  const armadilha = el("input", { type: "text", name: "site", tabindex: "-1", autocomplete: "off", style: "position:absolute;left:-9999px" });
  const resultado = el("p", { "aria-live": "polite" });
  raiz.replaceChildren(
    el("div", {}, [el("p", { classe: "apoio", texto: d.casa }), el("h1", { texto: "Trabalhe conosco" })]),
    el("section", { classe: "cartao" }, [
      el("label", {}, ["Seu nome", nome]),
      el("label", {}, ["Seu WhatsApp", telefone]),
      el("label", {}, ["Para qual função?", funcao]),
      el("label", {}, ["Como?", tipo]),
      el("label", {}, ["Sua experiência", experiencia]),
      armadilha,
      el("button", {
        classe: "botao",
        type: "button",
        texto: "Mandar",
        onclick: async (e) => {
          if (nome.value.trim().length < 2 || telefone.value.replace(/\D/g, "").length < 10) {
            resultado.className = "aviso";
            resultado.textContent = "Preencha o nome e o WhatsApp com DDD.";
            return;
          }
          e.target.disabled = true;
          try {
            await api({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nome: nome.value, telefone: telefone.value, funcao: funcao.value, tipo: tipo.value, experiencia: experiencia.value, site: armadilha.value }) });
            raiz.replaceChildren(el("h1", { texto: "Recebemos! 🙌" }), el("p", { texto: `A ${d.casa} vai olhar e chamar no seu WhatsApp se tiver vaga.` }), el("p", { classe: "marca", texto: "Brasa Food" }));
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
