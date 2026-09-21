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
 * A noite, quando o checklist é de rodadas: a lista com o estado de cada
 * uma, qual está na vez e a janela. Nulo no checklist comum.
 *
 * O mesmo link serve a noite inteira — quem abre às 20:15 e quem abre às
 * 01:30 vê a mesma página, e o que muda é a rodada que está na vez.
 */
let noite = null;
let rodadaAtual = null;

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
// A chave carrega a rodada: o rascunho da das 20:15 não pode ressuscitar
// dentro da das 21:00 — seriam respostas de outra hora com a cara de agora.
const chaveDoRascunho = () => `brasa.checklist.${token ?? ""}${rodadaAtual ? `.r${rodadaAtual}` : ""}`;

function guardarRascunho() {
  try {
    localStorage.setItem(
      chaveDoRascunho(),
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
    const bruto = localStorage.getItem(chaveDoRascunho());
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
    localStorage.removeItem(chaveDoRascunho());
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
        `/v1/checklist-publico/${encodeURIComponent(token)}/foto?item=${encodeURIComponent(item.id)}` +
          (rodadaAtual ? `&rodada=${rodadaAtual}` : ""),
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
  btnEnviar.textContent = noite ? "Enviando a rodada…" : "Enviando… a IA está conferindo";
  try {
    const res = await fetch(`/v1/checklist-publico/${encodeURIComponent(token)}/${noite ? "rodada" : "concluir"}`, {
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
    if (noite) telaRodadaFeita(json.data);
    else telaFinal(json.data);
  } catch (e) {
    avisar(e.message);
    btnEnviar.disabled = false;
    btnEnviar.textContent = noite ? "Concluir rodada" : "Concluir checklist";
  }
}

/* ================= Rodadas ================= */

/** A faixa das rodadas no topo: ✓ feita, ⚠ atrasada, ● na vez, ○ futura. */
function faixaDasRodadas(rodadas, naVez) {
  const faixa = document.createElement("div");
  faixa.className = "faixa";
  for (const r of rodadas) {
    const chip = document.createElement("span");
    chip.className = `rodada-chip ${r.estado}${r.numero === naVez ? " na-vez" : ""}`;
    chip.textContent = r.prevista;
    chip.title = r.estado === "feita"
      ? `Rodada ${r.numero}: feita${r.executor_nome ? ` por ${r.executor_nome}` : ""}`
      : r.estado === "atrasada"
        ? `Rodada ${r.numero}: passou da hora e ninguém fez`
        : `Rodada ${r.numero}`;
    faixa.append(chip);
  }
  return faixa;
}

function subtituloDaNoite(dados) {
  const [ano, mes, dia] = String(dados.data).split("-");
  const feitas = noite.rodadas.filter((r) => r.estado === "feita").length;
  const daVez = noite.rodadas.find((r) => r.numero === rodadaAtual);
  return [
    `${dados.venue} · ${dia}/${mes}/${ano}`,
    daVez ? `rodada ${daVez.numero} de ${noite.rodadas.length} · prevista ${daVez.prevista}` : `${feitas} de ${noite.rodadas.length} feitas`,
  ].join(" · ");
}

/** Desenha (ou redesenha) o formulário da rodada que está na vez. */
function desenharRodada(dados) {
  respostas.clear();
  conteudo.innerHTML = "";
  conteudo.append(faixaDasRodadas(noite.rodadas, rodadaAtual));
  subtitulo.textContent = subtituloDaNoite(dados);
  barra.style.width = "0%";

  const rascunho = lerRascunho();
  if (rascunho) for (const [id, r] of rascunho.respostas ?? []) respostas.set(id, r);

  for (const [i, item] of itens.entries()) conteudo.append(cartaoDoItem(item, i));
  rodape.hidden = false;
  btnEnviar.disabled = false;
  btnEnviar.textContent = "Concluir rodada";
  if (rascunho && respostas.size > 0) atualizarProgresso();
  scrollTo({ top: 0 });
}

/**
 * Rodada feita: diz qual foi, quando é a próxima, e oferece começá-la.
 *
 * Quem faz o banheiro a cada 45 minutos não quer procurar o link de novo:
 * a página fica aberta no celular, e o botão da próxima é o que ela vê ao
 * voltar. Se foi a última, a noite fechou e o resumo aparece aqui mesmo.
 */
function telaRodadaFeita(r) {
  noite.rodadas = r.rodadas ?? noite.rodadas;
  rodape.hidden = true;
  barra.style.width = "100%";

  const feitaAs = r.rodada?.concluida_em
    ? new Date(r.rodada.concluida_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "";

  if (r.fechou) {
    const alertas = Array.isArray(r.alertas) ? r.alertas : [];
    conteudo.innerHTML = `
      <div class="final">
        <div style="font-size:52px">🔥</div>
        <h2>Noite encerrada!</h2>
        <p>Rodada ${r.rodada?.numero ?? ""} feita${feitaAs ? ` às ${feitaAs}` : ""}. Era a última — o resumo já foi para o gerente.</p>
        ${r.resumo ? `<p style="margin-top:10px">${seguro(r.resumo)}</p>` : ""}
        ${alertas.length > 0 ? `<div class="alertas"><strong>A IA marcou para o gerente:</strong><ul style="margin:8px 0 0;padding-left:18px">${alertas.map((a) => `<li>${seguro(a)}</li>`).join("")}</ul></div>` : ""}
      </div>`;
    conteudo.prepend(faixaDasRodadas(noite.rodadas, null));
    subtitulo.textContent = `${noite.rodadas.length} de ${noite.rodadas.length} rodadas feitas`;
    scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  conteudo.innerHTML = `
    <div class="final" style="padding-top:36px">
      <div style="font-size:52px">✅</div>
      <h2>Rodada ${r.rodada?.numero ?? ""} feita${feitaAs ? ` às ${feitaAs}` : ""}</h2>
      <p>${r.proxima ? `A próxima é a das <strong>${r.proxima.prevista}</strong>. Pode deixar esta página aberta.` : "Não há mais rodadas hoje."}</p>
      ${r.proxima ? `<button class="enviar" id="btn-proxima" type="button" style="margin-top:22px;width:100%;max-width:360px">Começar a rodada das ${r.proxima.prevista}</button>` : ""}
    </div>`;
  conteudo.prepend(faixaDasRodadas(noite.rodadas, r.proxima?.numero ?? null));
  subtitulo.textContent = `${noite.rodadas.filter((x) => x.estado === "feita").length} de ${noite.rodadas.length} rodadas feitas`;

  document.getElementById("btn-proxima")?.addEventListener("click", () => {
    rodadaAtual = r.proxima.numero;
    desenharRodada(dadosDaPagina);
  });
  scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * A noite fechada, aberta por quem NÃO preencheu: o gerente, pelo link do
 * resumo. Cada rodada com a hora, quem fez e as respostas — a pulada fica
 * marcada, porque é ela que ele abriu o link para ver.
 */
function telaNoite(dados) {
  rodape.hidden = true;
  barra.style.width = "100%";
  const alertas = Array.isArray(dados.alertas) ? dados.alertas : [];
  const rodadas = Array.isArray(dados.rodadas_respondidas) ? dados.rodadas_respondidas : [];
  const feitas = rodadas.filter((r) => r.concluida_em).length;
  const puladas = rodadas.filter((r) => !r.concluida_em);

  const cabecalho = `
    <div class="final" style="padding:28px 20px 10px">
      <div style="font-size:44px">${alertas.length > 0 || puladas.length > 0 ? "⚠️" : "✅"}</div>
      <h2>${feitas} de ${rodadas.length} rodadas feitas</h2>
      <p>${puladas.length > 0 ? `Pulada(s): ${puladas.map((r) => r.prevista).join(", ")}` : "Nenhuma rodada pulada"}</p>
      ${dados.resumo ? `<p style="margin-top:10px">${seguro(dados.resumo)}</p>` : ""}
      ${alertas.length > 0 ? `<div class="alertas"><strong>A IA marcou:</strong><ul style="margin:8px 0 0;padding-left:18px">${alertas.map((a) => `<li>${seguro(a)}</li>`).join("")}</ul></div>` : ""}
    </div>`;

  const blocos = rodadas.map((r) => {
    const feitaAs = r.concluida_em
      ? new Date(r.concluida_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : null;
    const titulo = `<p class="pergunta" style="margin-bottom:6px">Rodada ${r.numero} · ${r.prevista}${feitaAs ? ` · feita ${feitaAs}${r.executor_nome ? ` por ${seguro(r.executor_nome)}` : ""}` : ""}</p>`;
    if (!r.concluida_em) {
      return `<section class="cartao" style="border-color:rgba(226,86,95,.55)">${titulo}<p style="margin:0;color:#ff9aa1;font-weight:600">Ninguém fez</p></section>`;
    }
    return `<section class="cartao">${titulo}<details><summary style="color:var(--creme-2);cursor:pointer;font-size:12.5px">ver respostas</summary>${htmlDasRespostas(r.respostas)}</details></section>`;
  });

  conteudo.innerHTML = cabecalho + blocos.join("");
  scrollTo({ top: 0 });
}

/** A resposta vira texto de gente: "sim"/"nao" no banco é bom para contar, ruim para ler. */
function comoTexto(r) {
  if (r.tipo === "foto") return r.foto ? "Foto enviada" : "Sem foto";
  if (r.valor === "sim") return "Sim ✓";
  if (r.valor === "nao") return "Não ✗";
  return r.valor?.trim() ? seguro(r.valor) : "— não respondeu";
}

function htmlDasRespostas(respostas) {
  return (Array.isArray(respostas) ? respostas : [])
    .map((r, i) => {
      const ruim = r.valor === "nao" || (r.tipo === "foto" && !r.foto);
      return `
        <div style="padding:10px 0;border-top:1px solid var(--borda)">
          <p class="pergunta" style="margin-bottom:4px">${i + 1}. ${seguro(r.pergunta)}</p>
          <p style="margin:0;font-weight:600;color:${ruim ? "#ff9aa1" : "var(--creme)"}">${comoTexto(r)}</p>
          ${r.foto ? `<a href="${r.foto}" target="_blank" rel="noopener"><img src="${r.foto}" alt="Foto de ${seguro(r.pergunta)}" loading="lazy" style="width:100%;border-radius:12px;margin-top:8px;display:block"></a>` : ""}
          ${r.observacao ? `<p style="margin:8px 0 0;color:var(--creme-2);font-size:14px">💬 ${seguro(r.observacao)}</p>` : ""}
        </div>`;
    })
    .join("");
}

/** Os dados da página, guardados para redesenhar a rodada seguinte. */
let dadosDaPagina = null;

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

  dadosDaPagina = dados;
  titulo.textContent = dados.checklist;
  const [ano, mes, dia] = String(dados.data).split("-");
  subtitulo.textContent = `${dados.venue} · ${dia}/${mes}/${ano}`;

  noite = Array.isArray(dados.rodadas) && dados.rodadas.length > 0
    ? { rodadas: dados.rodadas, janela: dados.janela ?? null }
    : null;

  if (dados.status === "concluida") return noite ? telaNoite(dados) : telaResultado(dados);

  itens = dados.itens ?? [];
  if (itens.length === 0) return erroFatal("Este checklist está sem perguntas.");

  if (noite) {
    rodadaAtual = dados.na_vez ?? null;
    if (!rodadaAtual) {
      conteudo.innerHTML = `<div class="final"><div style="font-size:52px">✅</div><h2>Todas as rodadas de hoje já foram feitas</h2><p>Bom serviço!</p></div>`;
      conteudo.prepend(faixaDasRodadas(noite.rodadas, null));
      return;
    }
    campoExecutor.addEventListener("input", guardarRascunho);
    btnEnviar.addEventListener("click", concluir);
    // O nome de quem executa vale a noite toda: quem fez a das 20:15 é quem
    // vai fazer a das 21:00, e digitar o nome doze vezes é pedir apelido.
    const rascunho = lerRascunho();
    if (rascunho?.executor) campoExecutor.value = rascunho.executor;
    desenharRodada(dados);
    return;
  }

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
