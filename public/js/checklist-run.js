/**
 * Execução do checklist pelo link público.
 *
 * Quem abre é a equipe, no celular, no meio do serviço — então: sem login,
 * botões grandes, foto direto da câmera e progresso sempre à vista. As fotos
 * sobem na hora (não na conclusão): se a conexão cair no meio, o que já foi
 * enviado está salvo.
 */

const token = new URLSearchParams(location.search).get("t");
const conteudo = document.getElementById("conteudo");
const titulo = document.getElementById("titulo");
const subtitulo = document.getElementById("subtitulo");
const barra = document.getElementById("barra");
const rodape = document.getElementById("rodape");
const btnEnviar = document.getElementById("btn-enviar");
const campoExecutor = document.getElementById("executor");

/** item.id -> {valor, foto, observacao} */
const respostas = new Map();
let itens = [];

// A câmera de um celular atual entrega de 3 a 8 MB por foto. Para conferir se a
// câmara fria está limpa isso é desperdício puro: 1600px já mostra qualquer
// coisa que um gerente precise enxergar, e o arquivo cai umas 20 vezes — o que
// significa upload rápido no 4G da cozinha e conta de armazenamento sob
// controle. Se qualquer parte disso falhar, mandamos o original: reduzir é
// otimização, não requisito.
const FOTO_LADO_MAXIMO = 1600;
const FOTO_QUALIDADE = 0.72;

async function comprimirFoto(arquivo) {
  if (!arquivo.type.startsWith("image/") || typeof createImageBitmap !== "function") {
    return arquivo;
  }
  let bitmap;
  try {
    // "from-image" respeita o EXIF: sem isso a foto de pé chega deitada.
    bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    try {
      bitmap = await createImageBitmap(arquivo);
    } catch {
      return arquivo;
    }
  }

  try {
    const escala = Math.min(1, FOTO_LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const largura = Math.round(bitmap.width * escala);
    const altura = Math.round(bitmap.height * escala);

    const tela = document.createElement("canvas");
    tela.width = largura;
    tela.height = altura;
    const ctx = tela.getContext("2d");
    // JPEG não tem transparência: sem este fundo, um print com alpha vira preto.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(bitmap, 0, 0, largura, altura);

    const menor = await new Promise((resolve) =>
      tela.toBlob(resolve, "image/jpeg", FOTO_QUALIDADE),
    );
    // Foto já pequena ou print de tela podem sair maiores como JPEG.
    if (!menor || menor.size >= arquivo.size) return arquivo;
    return menor;
  } catch {
    return arquivo;
  } finally {
    bitmap.close?.();
  }
}

function erroFatal(mensagem) {
  titulo.textContent = "Ops.";
  subtitulo.textContent = "";
  conteudo.innerHTML = `<div class="final"><h2>Não deu para abrir</h2><p>${mensagem}</p></div>`;
}

function avisar(mensagem) {
  document.querySelector(".aviso-erro")?.remove();
  const aviso = document.createElement("div");
  aviso.className = "aviso-erro";
  aviso.textContent = mensagem;
  document.body.append(aviso);
  setTimeout(() => aviso.remove(), 5000);
}

function atualizarProgresso() {
  const total = itens.length;
  if (total === 0) return;
  let feitas = 0;
  for (const item of itens) {
    const r = respostas.get(item.id);
    const tem = item.tipo === "foto" ? Boolean(r?.foto) : Boolean(r?.valor && r.valor.trim());
    if (tem) {
      feitas += 1;
      document.querySelector(`[data-item="${item.id}"]`)?.setAttribute("data-respondida", "1");
    }
  }
  barra.style.width = `${Math.round((feitas / total) * 100)}%`;
}

function resposta(itemId) {
  if (!respostas.has(itemId)) respostas.set(itemId, { valor: null, foto: null, observacao: null });
  return respostas.get(itemId);
}

function cartaoSimNao(item) {
  const div = document.createElement("div");
  div.className = "opcoes";
  for (const [valor, rotulo, classe] of [["sim", "Sim ✓", "sim"], ["nao", "Não ✗", "nao"]]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `opcao ${classe}`;
    btn.textContent = rotulo;
    btn.addEventListener("click", () => {
      resposta(item.id).valor = valor;
      for (const b of div.children) b.removeAttribute("data-on");
      btn.setAttribute("data-on", "1");
      atualizarProgresso();
    });
    div.append(btn);
  }
  return div;
}

function cartaoTexto(item) {
  const area = document.createElement("textarea");
  area.placeholder = "Escreva aqui…";
  area.addEventListener("input", () => {
    resposta(item.id).valor = area.value;
    atualizarProgresso();
  });
  return area;
}

function cartaoFoto(item) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.capture = "environment";
  input.hidden = true;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-foto";
  btn.innerHTML = "📷 Tirar foto";
  btn.addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const arquivo = input.files?.[0];
    if (!arquivo) return;
    btn.textContent = "Preparando foto…";
    btn.disabled = true;
    try {
      const envio = await comprimirFoto(arquivo);
      btn.textContent = "Enviando foto…";
      const res = await fetch(
        `/v1/checklist-publico/${encodeURIComponent(token)}/foto?item=${encodeURIComponent(item.id)}`,
        {
          method: "POST",
          headers: { "content-type": envio.type || "image/jpeg" },
          body: envio,
        },
      );
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error?.message ?? "Falha ao enviar a foto.");
      }
      resposta(item.id).foto = json.data.foto;
      btn.innerHTML = "";
      const img = document.createElement("img");
      const previa = URL.createObjectURL(envio);
      img.src = previa;
      img.alt = "Foto enviada";
      img.addEventListener("load", () => URL.revokeObjectURL(previa), { once: true });
      btn.append(img, document.createTextNode(" ✓ Trocar foto"));
      atualizarProgresso();
    } catch (e) {
      avisar(e.message);
      btn.textContent = "📷 Tirar foto";
    } finally {
      btn.disabled = false;
    }
  });

  const caixa = document.createElement("div");
  caixa.append(btn, input);
  return caixa;
}

function cartaoDoItem(item, indice) {
  const cartao = document.createElement("section");
  cartao.className = "cartao";
  cartao.dataset.item = item.id;

  const pergunta = document.createElement("p");
  pergunta.className = "pergunta";
  pergunta.innerHTML = `${indice + 1}. ${item.pergunta} ${item.obrigatorio ? "" : "<small>(opcional)</small>"}`;
  cartao.append(pergunta);

  if (item.tipo === "sim_nao") cartao.append(cartaoSimNao(item));
  else if (item.tipo === "texto") cartao.append(cartaoTexto(item));
  else cartao.append(cartaoFoto(item));

  // Observação livre em qualquer pergunta: é onde a equipe conta o que a
  // pergunta não perguntou — e o que a IA mais aproveita.
  const obs = document.createElement("details");
  obs.className = "obs";
  const resumo = document.createElement("summary");
  resumo.textContent = "+ observação";
  const areaObs = document.createElement("textarea");
  areaObs.placeholder = "Algo a registrar sobre este item?";
  areaObs.addEventListener("input", () => (resposta(item.id).observacao = areaObs.value));
  obs.append(resumo, areaObs);
  cartao.append(obs);

  return cartao;
}

async function concluir() {
  const executor = campoExecutor.value.trim();
  if (!executor) {
    avisar("Escreva seu nome antes de concluir — é o registro de quem fez.");
    campoExecutor.focus();
    return;
  }
  for (const item of itens) {
    if (!item.obrigatorio) continue;
    const r = respostas.get(item.id);
    const tem = item.tipo === "foto" ? Boolean(r?.foto) : Boolean(r?.valor && r.valor.trim());
    if (!tem) {
      avisar(`Falta responder: "${item.pergunta}"`);
      document.querySelector(`[data-item="${item.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  }

  btnEnviar.disabled = true;
  btnEnviar.textContent = "Enviando… a IA está conferindo";
  try {
    const res = await fetch(`/v1/checklist-publico/${encodeURIComponent(token)}/concluir`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        executor,
        respostas: itens.map((item) => ({ item: item.id, ...respostas.get(item.id) })),
      }),
    });
    const json = await res.json();
    if (!res.ok || json?.success === false) {
      throw new Error(json?.error?.message ?? "Falha ao concluir.");
    }
    telaFinal(json.data);
  } catch (e) {
    avisar(e.message);
    btnEnviar.disabled = false;
    btnEnviar.textContent = "Concluir checklist";
  }
}

function telaFinal(resultado) {
  rodape.hidden = true;
  barra.style.width = "100%";
  const alertas = Array.isArray(resultado?.alertas) ? resultado.alertas : [];
  conteudo.innerHTML = `
    <div class="final">
      <div style="font-size:52px">🔥</div>
      <h2>Checklist concluído!</h2>
      <p>${resultado?.resumo ? resultado.resumo : "Registro enviado. Bom serviço!"}</p>
      ${
        alertas.length > 0
          ? `<div class="alertas"><strong>A IA marcou para o gerente:</strong><ul style="margin:8px 0 0;padding-left:18px">${alertas
              .map((a) => `<li>${a}</li>`)
              .join("")}</ul></div>`
          : ""
      }
    </div>`;
  scrollTo({ top: 0, behavior: "smooth" });
}

async function iniciar() {
  if (!token) return erroFatal("Este link está incompleto. Peça para reenviarem pelo WhatsApp.");
  let dados;
  try {
    const res = await fetch(`/v1/checklist-publico/${encodeURIComponent(token)}`);
    const json = await res.json();
    if (!res.ok || json?.success === false) {
      throw new Error(json?.error?.message ?? "Link inválido.");
    }
    dados = json.data;
  } catch (e) {
    return erroFatal(e.message);
  }

  titulo.textContent = dados.checklist;
  const [ano, mes, dia] = String(dados.data).split("-");
  subtitulo.textContent = `${dados.venue} · ${dia}/${mes}/${ano}`;

  if (dados.status === "concluida") {
    return telaFinal({ resumo: `Já foi concluído${dados.executor ? ` por ${dados.executor}` : ""}. Nada mais a fazer aqui.` });
  }

  itens = dados.itens ?? [];
  if (itens.length === 0) return erroFatal("Este checklist está sem perguntas.");

  for (const [i, item] of itens.entries()) conteudo.append(cartaoDoItem(item, i));
  rodape.hidden = false;
  btnEnviar.addEventListener("click", concluir);
}

void iniciar();
