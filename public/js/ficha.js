/**
 * O link da ficha: o funcionário preenche os próprios dados e manda a foto
 * dos documentos, no celular dele.
 *
 * É o que resolve a ficha vazia: o gerente não tinha tempo de digitar onze
 * cadastros, e a pessoa preenche o dela em cinco minutos no intervalo. A IA
 * confere o documento com o que foi digitado, e o que divergir aparece para
 * o gerente — a pessoa só fica sabendo que chegou.
 */

const raiz = document.getElementById("ficha");
const token = location.pathname.split("/").filter(Boolean)[1] ?? "";

const DOCUMENTOS = [
  ["rg", "RG (frente e verso)", "Foto do documento aberto, sem reflexo"],
  ["cpf", "CPF", "Pode ser o cartão ou a CNH"],
  ["comprovante_endereco", "Comprovante de endereço", "Conta de luz, água ou internet"],
  ["ctps", "Carteira de trabalho", "A página da foto, ou print da carteira digital"],
  ["foto", "Uma foto sua", "Para o crachá e o cadastro da equipe"],
];

const CAMPOS = [
  ["nome_completo", "Nome completo (como no documento)", "text"],
  ["cpf", "CPF", "tel"],
  ["rg", "RG", "text"],
  ["nascimento", "Data de nascimento", "date"],
  ["telefone", "Seu WhatsApp", "tel"],
  ["endereco", "Endereço", "text"],
  ["chave_pix", "Chave Pix (para receber)", "text"],
  ["emergencia_nome", "Em caso de emergência, avisar quem?", "text"],
  ["emergencia_telefone", "Telefone dessa pessoa", "tel"],
];

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

async function api(caminho, opcoes = {}) {
  const r = await fetch(`/v1/ficha/${encodeURIComponent(token)}${caminho}`, opcoes);
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok || corpo.success === false) throw new Error(corpo?.error?.message ?? "Não deu certo. Tente de novo.");
  return corpo.data;
}

async function iniciar() {
  let dados;
  try {
    dados = await api("");
  } catch (e) {
    raiz.replaceChildren(el("h1", { texto: "Link indisponível" }), el("p", { classe: "aviso", texto: e.message }));
    return;
  }
  document.title = `Cadastro — ${dados.casa}`;
  const primeiro = String(dados.nome ?? "").split(" ")[0];
  const enviados = new Set(dados.documentos);

  const campos = new Map();
  const blocoDados = el("section", { classe: "cartao" }, [
    el("h2", { texto: "1. Seus dados" }),
    ...CAMPOS.map(([id, rotulo, tipo]) => {
      const input = el("input", {
        type: tipo,
        value: dados.ficha?.[id] ?? "",
        autocomplete: id === "telefone" ? "tel" : id === "nome_completo" ? "name" : "off",
        inputmode: tipo === "tel" ? "numeric" : null,
      });
      campos.set(id, input);
      return el("label", {}, [rotulo, input]);
    }),
  ]);

  const blocoDocumentos = el("section", { classe: "cartao" }, [
    el("h2", { texto: "2. Fotos dos documentos" }),
    el("p", { classe: "apoio", texto: "Tire a foto pelo celular mesmo, com boa luz. Vai direto para a casa, guardado com segurança." }),
    ...DOCUMENTOS.map(([tipo, rotulo, ajuda]) => linhaDeDocumento(tipo, rotulo, ajuda, enviados.has(tipo))),
  ]);

  const concordo = el("input", { type: "checkbox", id: "concordo" });
  const enviar = el("button", { classe: "botao", type: "button", texto: "Mandar meu cadastro" });
  const resultado = el("p", { "aria-live": "polite" });
  enviar.addEventListener("click", async () => {
    if (!concordo.checked) {
      resultado.className = "aviso";
      resultado.textContent = "Marque que você concorda com o uso dos seus dados para mandar.";
      return;
    }
    enviar.disabled = true;
    try {
      const ficha = Object.fromEntries([...campos].map(([id, input]) => [id, input.value.trim()]));
      await api("", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ficha, consentimento: true }) });
      resultado.className = "ok";
      resultado.textContent = "Pronto! Seu cadastro chegou na casa. Se faltar algum documento, você pode mandar por este mesmo link.";
    } catch (e) {
      resultado.className = "aviso";
      resultado.textContent = e.message;
    } finally {
      enviar.disabled = false;
    }
  });

  raiz.replaceChildren(
    el("div", {}, [
      el("p", { classe: "apoio", texto: dados.casa }),
      el("h1", { texto: `Olá${primeiro ? `, ${primeiro}` : ""}! Vamos completar seu cadastro na equipe.` }),
      el("p", { classe: "apoio", texto: "Leva uns 5 minutos. O que você mandar aqui fica só com a casa." }),
    ]),
    blocoDados,
    blocoDocumentos,
    el("section", { classe: "cartao" }, [
      el("h2", { texto: "3. Para mandar" }),
      el("label", { classe: "consentimento", for: "concordo" }, [
        concordo,
        el("span", {
          texto:
            `Concordo que a ${dados.casa} guarde e use estes dados e documentos para o meu registro de trabalho, ` +
            "pagamento e obrigações legais (LGPD). Posso pedir para ver, corrigir ou apagar quando quiser.",
        }),
      ]),
      enviar,
      resultado,
    ]),
    el("p", { classe: "marca", texto: "Brasa Food" }),
  );
}

function linhaDeDocumento(tipo, rotulo, ajuda, jaEnviado) {
  const estado = el("small", { texto: jaEnviado ? "✓ já enviado" : ajuda });
  if (jaEnviado) estado.className = "ok";
  const arquivo = el("input", { type: "file", accept: "image/*,application/pdf", capture: "environment", hidden: true });
  const botao = el("button", { classe: "botao botao-leve", type: "button", texto: jaEnviado ? "Trocar" : "Tirar foto", onclick: () => arquivo.click() });
  arquivo.addEventListener("change", async () => {
    const f = arquivo.files?.[0];
    if (!f) return;
    botao.disabled = true;
    estado.className = "";
    estado.textContent = "Enviando…";
    try {
      const corpo = f.type.startsWith("image/") ? await reduzir(f) : f;
      await api(`/documento?tipo=${tipo}`, { method: "POST", headers: { "content-type": corpo.type || f.type }, body: corpo });
      estado.className = "ok";
      estado.textContent = "✓ recebido";
      botao.textContent = "Trocar";
    } catch (e) {
      estado.className = "aviso";
      estado.textContent = e.message;
    } finally {
      botao.disabled = false;
      arquivo.value = "";
    }
  });
  return el("div", { classe: "doc" }, [el("div", {}, [el("span", { texto: rotulo }), estado]), botao, arquivo]);
}

/**
 * Foto de celular tem 4–8 MB; a 1600px ela continua legível para a IA e
 * sobe em segundos no 4G do interior.
 */
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
