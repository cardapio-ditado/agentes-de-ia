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

/**
 * Rascunho no próprio aparelho.
 *
 * Checklist de limpeza não se responde de uma sentada: a pessoa recebe às
 * 17h, limpa o salão, tira foto, vai pra cozinha, atende alguém, volta. Nesse
 * meio-tempo o celular troca de app dez vezes — e navegador de celular
 * DESCARTA aba em segundo plano quando a memória aperta. Sem rascunho, ela
 * voltava para um checklist em branco depois de meia hora de trabalho, e a
 * segunda vez ninguém faz com o mesmo cuidado.
 *
 * As fotos já eram salvas no servidor na hora; o que se perdia era o resto.
 * Guardar aqui é de graça e resolve os três jeitos de perder: fechou a aba,
 * o sistema matou o navegador, acabou a bateria.
 */
const RASCUNHO = `brasa.checklist.${token ?? ""}`;

function guardarRascunho() {
  try {
    localStorage.setItem(
      RASCUNHO,
      JSON.stringify({
        executor: campoExecutor.value ?? "",
        respostas: [...respostas.entries()],
        em: Date.now(),
      }),
    );
  } catch {
    /* aparelho sem espaço ou em aba anônima: o checklist segue, só sem rede de segurança */
  }
}

function lerRascunho() {
  try {
    const bruto = localStorage.getItem(RASCUNHO);
    if (!bruto) return null;
    const dados = JSON.parse(bruto);
    // Rascunho de mais de dois dias é de outro serviço: o token é da
    // execução, mas deixar ressuscitar resposta velha seria pior que perder.
    if (!dados?.em || Date.now() - dados.em > 2 * 86_400_000) return null;
    return dados;
  } catch {
    return null;
  }
}

function apagarRascunho() {
  try {
    localStorage.removeItem(RASCUNHO);
  } catch {
    /* nada a fazer — e nada se perde por isso */
  }
}

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
    // Vindo do rascunho, a escolha anterior já nasce acesa.
    if (respostas.get(item.id)?.valor === valor) btn.setAttribute("data-on", "1");
    btn.addEventListener("click", () => {
      resposta(item.id).valor = valor;
      for (const b of div.children) b.removeAttribute("data-on");
      btn.setAttribute("data-on", "1");
      atualizarProgresso();
      guardarRascunho();
    });
    div.append(btn);
  }
  return div;
}

function cartaoTexto(item) {
  const area = document.createElement("textarea");
  area.placeholder = "Escreva aqui…";
  area.value = respostas.get(item.id)?.valor ?? "";
  area.addEventListener("input", () => {
    resposta(item.id).valor = area.value;
    atualizarProgresso();
    guardarRascunho();
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
  // A foto já subiu para o servidor numa sessão anterior: dizer isso evita
  // que a pessoa tire tudo de novo achando que perdeu.
  btn.innerHTML = respostas.get(item.id)?.foto ? "✓ Foto enviada — trocar" : "📷 Tirar foto";
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
      guardarRascunho();
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
  areaObs.value = respostas.get(item.id)?.observacao ?? "";
  // Com observação escrita, o bloco nasce aberto — senão ela fica invisível
  // atrás do "+ observação" e a pessoa acha que se perdeu.
  if (areaObs.value) obs.open = true;
  areaObs.addEventListener("input", () => {
    resposta(item.id).observacao = areaObs.value;
    guardarRascunho();
  });
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
    apagarRascunho();
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

/** Escapa o que veio do banco: resposta escrita à mão não pode virar HTML. */
function seguro(texto) {
  const d = document.createElement("div");
  d.textContent = texto ?? "";
  return d.innerHTML;
}

/**
 * O checklist concluído, aberto por quem NÃO preencheu.
 *
 * É o que o gerente recebe no WhatsApp: além do veredito da IA, cada
 * pergunta com a resposta dada, a observação escrita e a foto tirada — sem
 * login, no mesmo link. A foto que ninguém abre é foto que não valeu o
 * trabalho de tirar.
 */
function telaResultado(dados) {
  rodape.hidden = true;
  barra.style.width = "100%";

  const alertas = Array.isArray(dados.alertas) ? dados.alertas : [];
  const respostas = Array.isArray(dados.respostas) ? dados.respostas : [];

  const quando = dados.concluido_em
    ? new Date(dados.concluido_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : null;

  const cabecalho = `
    <div class="final" style="padding:28px 20px 10px">
      <div style="font-size:44px">${alertas.length > 0 ? "⚠️" : "✅"}</div>
      <h2>${alertas.length > 0 ? "Concluído com pontos de atenção" : "Concluído sem pendências"}</h2>
      <p>${dados.executor ? `Por ${seguro(dados.executor)}` : "Executado"}${quando ? ` · ${quando}` : ""}</p>
      ${dados.resumo ? `<p style="margin-top:10px">${seguro(dados.resumo)}</p>` : ""}
      ${
        alertas.length > 0
          ? `<div class="alertas"><strong>A IA marcou:</strong><ul style="margin:8px 0 0;padding-left:18px">${alertas
              .map((a) => `<li>${seguro(a)}</li>`)
              .join("")}</ul></div>`
          : ""
      }
    </div>`;

  // A resposta vira texto de gente: "sim"/"nao" no banco é bom para contar,
  // ruim para ler no meio do turno.
  const comoTexto = (r) => {
    if (r.tipo === "foto") return r.foto ? "Foto enviada" : "Sem foto";
    if (r.valor === "sim") return "Sim ✓";
    if (r.valor === "nao") return "Não ✗";
    return r.valor?.trim() ? seguro(r.valor) : "— não respondeu";
  };

  const itensHtml = respostas
    .map((r, i) => {
      // "Não" é o que o gerente abriu o link para achar: fica em destaque.
      const ruim = r.valor === "nao" || (r.tipo === "foto" && !r.foto);
      return `
        <section class="cartao" ${ruim ? 'style="border-color:rgba(226,86,95,.55)"' : ""}>
          <p class="pergunta">${i + 1}. ${seguro(r.pergunta)}</p>
          <p style="margin:0;font-weight:600;color:${ruim ? "#ff9aa1" : "var(--creme)"}">${comoTexto(r)}</p>
          ${
            r.foto
              ? `<a href="${r.foto}" target="_blank" rel="noopener">
                   <img src="${r.foto}" alt="Foto de ${seguro(r.pergunta)}" loading="lazy"
                        style="width:100%;border-radius:12px;margin-top:10px;display:block">
                 </a>`
              : ""
          }
          ${
            r.observacao
              ? `<p style="margin:10px 0 0;color:var(--creme-2);font-size:14px">💬 ${seguro(r.observacao)}</p>`
              : ""
          }
        </section>`;
    })
    .join("");

  conteudo.innerHTML =
    cabecalho +
    (itensHtml ||
      `<div class="final"><p>As respostas deste checklist não ficaram registradas.</p></div>`);
  scrollTo({ top: 0 });
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

  if (dados.status === "concluida") return telaResultado(dados);

  itens = dados.itens ?? [];
  if (itens.length === 0) return erroFatal("Este checklist está sem perguntas.");

  // O rascunho ENTRA antes de desenhar: assim cada cartão já nasce com o que
  // a pessoa tinha respondido, em vez de piscar vazio e preencher depois.
  const rascunho = lerRascunho();
  if (rascunho) {
    for (const [id, r] of rascunho.respostas ?? []) respostas.set(id, r);
    if (rascunho.executor) campoExecutor.value = rascunho.executor;
  }

  for (const [i, item] of itens.entries()) conteudo.append(cartaoDoItem(item, i));
  rodape.hidden = false;
  campoExecutor.addEventListener("input", guardarRascunho);
  btnEnviar.addEventListener("click", concluir);

  if (rascunho && respostas.size > 0) {
    atualizarProgresso();
    avisar("Continuando de onde você parou — o que já respondeu está aqui.");
  }
}

void iniciar();
