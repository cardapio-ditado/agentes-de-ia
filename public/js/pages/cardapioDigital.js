import { del, get, patch, post, postArquivo, put } from "../api.js";
import { avisar, dataHora, desde, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";

/**
 * O cardápio digital, como a casa o mexe.
 *
 * Seis abas, na ordem do dia a dia: o que o cliente vê primeiro (Itens),
 * como está organizado (Categorias), o que a casa quer empurrar (Banners e
 * Promoções), o que o cliente escreveu (Comentários, com a fila de liberação)
 * e o cartaz da mesa (QR code).
 *
 * A página pública lê as MESMAS tabelas na hora: salvar aqui é publicar. Não
 * existe "enviar para o cardápio".
 */

const ABAS = [
  ["aovivo", "Ao vivo"],
  ["itens", "Itens"],
  ["categorias", "Categorias"],
  ["banners", "Banners"],
  ["promocoes", "Promoções"],
  ["comentarios", "Comentários"],
  ["mesas", "Mesas e garçons"],
  ["qrcode", "QR code"],
];

const NOME_DO_EVENTO = {
  visualizacao: "abriu",
  curtida: "curtiu",
  busca: "buscou",
  pedido: "pediu ao garçom",
  chamou_garcom: "chamou o garçom",
  chat: "perguntou no chat sobre",
};

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Maior lado da foto depois de reduzida. Prato no celular não passa disso. */
const LADO_MAXIMO = 1400;

export async function cardapioDigital(raiz, ctx) {
  let abaAtiva = sessionStorage.getItem("brasa.cardapio.aba") || "itens";
  let dados = null;
  const corpo = el("div", {});
  const contadorComentarios = el("span", { classe: "nav-contador", hidden: true, texto: "0" });

  const barra = el(
    "div",
    { classe: "abas" },
    ABAS.map(([id, rotulo]) =>
      el(
        "button",
        {
          classe: `aba ${id === abaAtiva ? "aba-ativa" : ""}`.trim(),
          type: "button",
          "data-aba": id,
          onclick: () => trocarAba(id),
        },
        [document.createTextNode(rotulo), id === "comentarios" ? contadorComentarios : null],
      ),
    ),
  );

  const cabecalho = el("div", { classe: "cartao", style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap" });

  raiz.append(el("div", { classe: "pilha" }, [cabecalho, barra, corpo]));
  await recarregar();

  function trocarAba(id) {
    abaAtiva = id;
    sessionStorage.setItem("brasa.cardapio.aba", id);
    for (const b of barra.querySelectorAll(".aba")) b.classList.toggle("aba-ativa", b.dataset.aba === id);
    desenharAba();
  }

  async function recarregar() {
    try {
      dados = await get(`/v1/venues/${ctx.venue}/cardapio`);
    } catch (e) {
      limpar(corpo).append(
        el("div", { classe: "cartao" }, [
          el("h2", { texto: "Não deu para carregar o cardápio" }),
          el("p", { classe: "muted", texto: e.message }),
        ]),
      );
      return;
    }
    contadorComentarios.textContent = String(dados.comentarios_pendentes);
    contadorComentarios.hidden = !dados.comentarios_pendentes;
    ctx.atualizarContador("cardapio", dados.comentarios_pendentes);
    desenharCabecalho();
    desenharAba();
  }

  function desenharCabecalho() {
    limpar(cabecalho).append(
      el("div", { style: "flex:1;min-width:220px" }, [
        el("strong", { texto: "Endereço do cardápio" }),
        el("p", { classe: "muted", style: "margin:2px 0 0;word-break:break-all", texto: dados.endereco }),
      ]),
      el("a", { classe: "btn btn-peq", href: dados.endereco, target: "_blank", rel: "noopener", texto: "Abrir como cliente" }),
      el("button", {
        classe: "btn btn-peq",
        type: "button",
        texto: "Copiar link",
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(dados.endereco);
            avisar("Link copiado.", "ok");
          } catch {
            avisar("Copie o link que está na tela.", "erro");
          }
        },
      }),
      dados.chamados.length
        ? etiqueta(`${dados.chamados.length} chamado${dados.chamados.length > 1 ? "s" : ""} de mesa nas últimas 12h`, "etiqueta-alerta")
        : null,
    );
  }

  let pararAoVivo = null;
  function desenharAba() {
    limpar(corpo);
    if (pararAoVivo) { pararAoVivo(); pararAoVivo = null; }
    if (abaAtiva === "aovivo") abaAoVivo();
    else if (abaAtiva === "itens") abaItens();
    else if (abaAtiva === "categorias") abaCategorias();
    else if (abaAtiva === "banners") abaBanners();
    else if (abaAtiva === "promocoes") abaPromocoes();
    else if (abaAtiva === "comentarios") abaComentarios();
    else if (abaAtiva === "mesas") abaMesas();
    else abaQrcode();
  }

  /* ================= Ao vivo: o salão agora ================= */

  function abaAoVivo() {
    const resumo = el("div", { classe: "grade grade-2" });
    const mesasCaixa = el("div", { classe: "tabela" });
    const feed = el("div", { classe: "tabela" });
    const maisVistos = el("div", { classe: "tabela" });
    const atualizadoEm = el("span", { classe: "muted", texto: "" });

    corpo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Salão agora" }),
          el("p", { classe: "muted", texto: "Quem está em cada mesa, o que está olhando e quem chamou. Atualiza sozinho a cada 10 segundos." }),
        ]),
        atualizadoEm,
      ]),
      resumo,
      el("h3", { style: "margin:8px 0 6px", texto: "Mesas com gente" }),
      mesasCaixa,
      el("div", { classe: "grade grade-2", style: "margin-top:12px" }, [
        el("div", {}, [el("h3", { style: "margin:0 0 6px", texto: "Últimos acontecimentos" }), feed]),
        el("div", {}, [el("h3", { style: "margin:0 0 6px", texto: "Mais abertos hoje" }), maisVistos]),
      ]),
    );

    async function atualizar() {
      let vivo;
      try {
        vivo = await get(`/v1/venues/${ctx.venue}/cardapio/ao-vivo`);
      } catch (e) {
        limpar(mesasCaixa).append(el("p", { classe: "muted", style: "padding:12px", texto: e.message }));
        return;
      }
      atualizadoEm.textContent = `atualizado ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

      limpar(resumo).append(
        el("div", { classe: `cartao${vivo.chamados_abertos ? " linha-atencao" : ""}` }, [
          el("strong", { style: "font-size:1.6rem", texto: String(vivo.chamados_abertos) }),
          el("p", { classe: "muted", style: "margin:0", texto: "chamados de garçom na última meia hora" }),
        ]),
        el("div", { classe: "cartao" }, [
          el("strong", { style: "font-size:1.6rem", texto: String(vivo.mesas.length) }),
          el("p", { classe: "muted", style: "margin:0", texto: "mesas com o cardápio aberto nas últimas 3 horas" }),
        ]),
      );

      limpar(mesasCaixa);
      if (!vivo.mesas.length) mesasCaixa.append(vazio("Nenhuma mesa aberta", "Assim que alguém escanear o QR, aparece aqui."));
      for (const m of vivo.mesas) {
        mesasCaixa.append(
          el("div", { classe: "linha-tabela" }, [
            el("div", { classe: "linha-principal" }, [
              el("strong", { texto: `${m.mesa ? `Mesa ${m.mesa}` : "Sem mesa"}${m.cliente ? ` · ${m.cliente}` : ""}${m.garcom ? ` · garçom ${m.garcom}` : ""}` }),
              el("span", { classe: "muted", texto: m.olhando ? `olhando: ${m.olhando}` : "ainda não abriu nenhum item" }),
            ]),
            el("div", { classe: "linha-detalhes" }, [
              el("span", { classe: "muted", texto: `${m.eventos} ações · há ${desde(m.ultimo_evento || m.desde)}` }),
            ]),
          ]),
        );
      }

      limpar(feed);
      if (!vivo.ultimos.length) feed.append(vazio("Nada ainda hoje"));
      for (const e of vivo.ultimos.slice(0, 30)) {
        const quem = `${e.mesa ? `Mesa ${e.mesa}` : "Sem mesa"}${e.cliente ? ` (${e.cliente})` : ""}`;
        const oque = `${NOME_DO_EVENTO[e.tipo] ?? e.tipo}${e.item ? ` ${e.item}` : ""}${e.tipo === "visualizacao" && e.segundos ? ` por ${e.segundos}s` : ""}`;
        feed.append(
          el("div", { classe: `linha-tabela${e.tipo === "pedido" || e.tipo === "chamou_garcom" ? " linha-atencao" : ""}` }, [
            el("div", { classe: "linha-principal" }, [el("strong", { texto: quem }), el("span", { classe: "muted", texto: oque })]),
            el("span", { classe: "muted", texto: `há ${desde(e.em)}` }),
          ]),
        );
      }

      limpar(maisVistos);
      if (!vivo.mais_vistos_hoje.length) maisVistos.append(vazio("Nenhum item aberto hoje"));
      for (const v of vivo.mais_vistos_hoje) {
        maisVistos.append(
          el("div", { classe: "linha-tabela" }, [
            el("div", { classe: "linha-principal" }, [el("strong", { texto: v.item })]),
            el("span", { classe: "muted", texto: `${v.vezes}× · ${Math.round(v.segundos / 60)} min no total` }),
          ]),
        );
      }
    }

    atualizar();
    const timer = setInterval(atualizar, 10_000);
    pararAoVivo = () => clearInterval(timer);
    ctx.aoSair(() => clearInterval(timer));
  }

  /* ================= Mesas e garçons ================= */

  function abaMesas() {
    const lista = el("div", { classe: "tabela" });
    const de = el("input", { placeholder: "de", inputmode: "numeric", style: "width:80px" });
    const ate = el("input", { placeholder: "até", inputmode: "numeric", style: "width:80px" });
    const criar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Criar mesas",
      onclick: async () => {
        criar.disabled = true;
        try {
          const r = await post(`/v1/venues/${ctx.venue}/cardapio/mesas`, { de: de.value.trim(), ate: ate.value.trim() || de.value.trim() });
          avisar(r.criadas ? `${r.criadas} mesa${r.criadas > 1 ? "s" : ""} criada${r.criadas > 1 ? "s" : ""}.` : "Essas mesas já existiam.", "ok");
          de.value = ""; ate.value = "";
          await carregar();
        } catch (e) {
          avisar(e.message, "erro");
        } finally {
          criar.disabled = false;
        }
      },
    });
    const dia = el("input", { type: "date" });
    const sugestoes = el("datalist", { id: "garcons-sugeridos" });

    corpo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Mesas e quem atende cada uma" }),
          el("p", { classe: "muted", texto: "Cadastre as mesas uma vez. A cada dia, escreva o garçom de cada mesa: o chamado do cliente sai com o nome dele, e o cliente vê quem o atende." }),
        ]),
      ]),
      el("div", { classe: "cartao" }, [
        el("div", { classe: "linha-campos", style: "align-items:center;flex-wrap:wrap" }, [
          el("span", { texto: "Criar mesas de" }), de, el("span", { texto: "até" }), ate, criar,
          el("span", { style: "flex:1" }),
          el("label", { classe: "campo-rotulado" }, [el("span", { texto: "Turno do dia" }), dia]),
        ]),
      ]),
      sugestoes,
      lista,
    );

    async function carregar() {
      limpar(lista).append(el("p", { classe: "muted", style: "padding:12px", texto: "Carregando…" }));
      let r;
      try {
        r = await get(`/v1/venues/${ctx.venue}/cardapio/mesas${dia.value ? `?dia=${dia.value}` : ""}`);
      } catch (e) {
        limpar(lista).append(el("p", { classe: "muted", style: "padding:12px", texto: e.message }));
        return;
      }
      if (!dia.value) dia.value = r.dia;
      limpar(sugestoes).append(...r.garcons.map((g) => el("option", { value: g })));
      const garcomDe = new Map(r.turno.map((t) => [t.mesa, t.garcom]));
      limpar(lista);
      if (!r.mesas.length) {
        lista.append(vazio("Nenhuma mesa", "Crie as mesas acima (ex.: de 1 até 40)."));
        return;
      }
      for (const m of r.mesas) lista.append(linhaDaMesa(m, garcomDe.get(m.numero) ?? "", r.dia));
    }

    function linhaDaMesa(m, garcom, diaDoTurno) {
      const nome = el("input", { value: m.nome, placeholder: "apelido (opcional)", style: "flex:1" });
      nome.addEventListener("change", async () => {
        try { await patch(`/v1/venues/${ctx.venue}/cardapio/mesas/${m.id}`, { nome: nome.value.trim() }); } catch (e) { avisar(e.message, "erro"); }
      });
      const campoGarcom = el("input", { value: garcom, placeholder: "garçom hoje", list: "garcons-sugeridos", style: "flex:1" });
      campoGarcom.addEventListener("change", async () => {
        try {
          await put(`/v1/venues/${ctx.venue}/cardapio/turno`, { mesa: m.numero, garcom: campoGarcom.value.trim(), dia: dia.value || diaDoTurno });
          avisar(campoGarcom.value.trim() ? `Mesa ${m.numero}: ${campoGarcom.value.trim()}.` : `Mesa ${m.numero} sem garçom.`, "ok");
        } catch (e) {
          avisar(e.message, "erro");
        }
      });
      const ativa = el("input", { type: "checkbox", checked: m.ativa });
      ativa.addEventListener("change", async () => {
        try { await patch(`/v1/venues/${ctx.venue}/cardapio/mesas/${m.id}`, { ativa: ativa.checked }); } catch (e) { avisar(e.message, "erro"); }
      });
      return el("div", { classe: "linha-tabela" }, [
        el("strong", { style: "width:72px", texto: `Mesa ${m.numero}` }),
        nome,
        campoGarcom,
        el("label", { classe: "campo-caixa", style: "align-items:center;white-space:nowrap" }, [ativa, el("span", { texto: "em uso" })]),
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "QR",
          title: "Gerar o QR code desta mesa",
          onclick: () => { sessionStorage.setItem("brasa.cardapio.mesa-qr", String(m.numero)); trocarAba("qrcode"); },
        }),
        el("button", {
          classe: "btn-icone",
          type: "button",
          texto: "🗑️",
          title: "Apagar mesa",
          onclick: async () => {
            if (!confirm(`Apagar a mesa ${m.numero}?`)) return;
            try { await del(`/v1/venues/${ctx.venue}/cardapio/mesas/${m.id}`); await carregar(); } catch (e) { avisar(e.message, "erro"); }
          },
        }),
      ]);
    }

    dia.addEventListener("change", carregar);
    carregar();
  }

  const nomeDaCategoria = (id) => dados.categorias.find((c) => c.id === id)?.nome ?? "Sem categoria";

  /* ================= Itens ================= */

  function abaItens() {
    const busca = el("input", { classe: "campo", placeholder: "🔍  Buscar item…", style: "flex:2" });
    const filtro = el("select", { classe: "select", style: "flex:1" }, [
      el("option", { value: "", texto: "Todas as categorias" }),
      ...dados.categorias.map((c) => el("option", { value: c.id, texto: c.nome })),
      el("option", { value: "sem", texto: "Sem categoria" }),
    ]);
    const lista = el("div", { classe: "tabela" });

    corpo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: `${dados.itens.length} ${dados.itens.length === 1 ? "item" : "itens"}` }),
          el("p", { classe: "muted", texto: "Toque num item para editar. Destaque aparece em cartão grande com foto; os outros, em lista com foto pequena." }),
        ]),
        el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "+ Novo item", onclick: () => editarItem(null) }),
      ]),
      el("div", { classe: "linha-campos" }, [busca, filtro]),
      lista,
    );

    const desenharLista = () => {
      const alvo = normalizar(busca.value);
      const cat = filtro.value;
      limpar(lista);
      const visiveis = dados.itens.filter((i) => {
        if (cat === "sem" && i.categoria_id) return false;
        if (cat && cat !== "sem" && i.categoria_id !== cat) return false;
        return !alvo || normalizar(`${i.nome} ${i.descricao}`).includes(alvo);
      });
      if (visiveis.length === 0) {
        lista.append(vazio("Nenhum item", dados.itens.length ? "Nada com esse nome nesta categoria." : "Comece pelo botão “Novo item”."));
        return;
      }
      for (const i of visiveis) lista.append(linhaDoItem(i));
    };
    busca.addEventListener("input", desenharLista);
    filtro.addEventListener("change", desenharLista);
    desenharLista();
  }

  function linhaDoItem(i) {
    const thumb = el("div", { classe: "cardapio-thumb" }, [
      i.capa ? el("img", { src: i.capa, alt: "" }) : el("span", { texto: (i.nome[0] || "•").toUpperCase() }),
    ]);
    return el(
      "div",
      { classe: `linha-tabela linha-clicavel${i.ativo ? "" : " linha-apagada"}`, onclick: () => editarItem(i) },
      [
        thumb,
        el("div", { classe: "linha-principal" }, [
          el("strong", { texto: i.nome }),
          el("span", { classe: "muted", texto: [nomeDaCategoria(i.categoria_id), i.descricao].filter(Boolean).join(" · ") }),
        ]),
        el("div", { classe: "linha-detalhes" }, [
          i.destaque ? etiqueta("destaque", "etiqueta-info") : null,
          !i.ativo ? etiqueta("fora do cardápio", "etiqueta-alerta") : null,
          el("span", { classe: "muted", texto: `♥ ${i.curtidas}` }),
          el("strong", { texto: dinheiro(i.preco) }),
        ]),
      ],
    );
  }

  function editarItem(item) {
    const novo = !item;
    const campos = {
      nome: el("input", { placeholder: "Picanha na brasa", value: item?.nome ?? "" }),
      categoria: el("select", {}, [
        el("option", { value: "", texto: "Sem categoria" }),
        ...dados.categorias.map((c) => el("option", { value: c.id, texto: `${c.nome} (${c.grupo})`, selected: c.id === item?.categoria_id })),
      ]),
      preco: el("input", { placeholder: "42,90", inputmode: "decimal", value: item ? String(item.preco).replace(".", ",") : "" }),
      descricao: el("textarea", { rows: 2, placeholder: "400 g fatiada na tábua, com farofa, vinagrete e mandioca." }),
      serve: el("input", { placeholder: "2", inputmode: "numeric", value: item?.serve ?? "" }),
      etiquetas: el("input", { placeholder: "vegano, sem glúten, novo", value: (item?.etiquetas ?? []).join(", ") }),
      alergenicos: el("input", { placeholder: "glúten, lactose, ovo", value: (item?.alergenicos ?? []).join(", ") }),
      descricaoAgente: el("textarea", { rows: 2, placeholder: "O que o agente de WhatsApp deve saber além da descrição pública (opcional)." }),
      destaque: el("input", { type: "checkbox", checked: item?.destaque || false }),
      ativo: el("input", { type: "checkbox", checked: item ? item.ativo : true }),
    };
    campos.descricao.value = item?.descricao ?? "";
    campos.descricao.style.width = "100%";
    campos.descricaoAgente.value = item?.descricao_agente ?? "";
    campos.descricaoAgente.style.width = "100%";

    const salvar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: novo ? "Criar item" : "Salvar",
      onclick: async () => {
        salvar.disabled = true;
        const dadosDoItem = {
          nome: campos.nome.value.trim(),
          categoria_id: campos.categoria.value || null,
          preco: campos.preco.value.trim(),
          descricao: campos.descricao.value.trim(),
          serve: campos.serve.value.trim() ? Number(campos.serve.value) : null,
          etiquetas: campos.etiquetas.value,
          alergenicos: campos.alergenicos.value,
          destaque: campos.destaque.checked,
          ativo: campos.ativo.checked,
          descricao_agente: campos.descricaoAgente.value.trim(),
        };
        try {
          if (novo) {
            const r = await post(`/v1/venues/${ctx.venue}/cardapio/itens`, dadosDoItem);
            avisar("Item criado. Agora suba a foto.", "ok");
            await recarregar();
            editarItem(dados.itens.find((i) => i.id === r.id) ?? null);
          } else {
            await patch(`/v1/venues/${ctx.venue}/cardapio/itens/${item.id}`, dadosDoItem);
            avisar("Item salvo — já está no cardápio.", "ok");
            await recarregar();
          }
        } catch (e) {
          avisar(e.message, "erro");
          salvar.disabled = false;
        }
      },
    });

    const apagar = item
      ? el("button", {
          classe: "btn btn-perigo btn-peq",
          type: "button",
          texto: "Apagar",
          onclick: async () => {
            if (!confirm(`Apagar "${item.nome}"? As fotos e os comentários dele saem junto.`)) return;
            try {
              await del(`/v1/venues/${ctx.venue}/cardapio/itens/${item.id}`);
              avisar("Item apagado.", "ok");
              await recarregar();
            } catch (e) {
              avisar(e.message, "erro");
            }
          },
        })
      : null;

    limpar(corpo).append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [el("h2", { texto: novo ? "Novo item" : item.nome })]),
        el("button", { classe: "btn btn-peq", type: "button", texto: "← Voltar", onclick: desenharAba }),
      ]),
      el("div", { classe: "cartao" }, [
        el("div", { classe: "grade grade-2" }, [
          campo("Nome", campos.nome),
          campo("Categoria", campos.categoria),
          campo("Preço (R$)", campos.preco),
          campo("Serve quantas pessoas (opcional)", campos.serve),
        ]),
        campo("Descrição que o cliente lê", campos.descricao),
        el("div", { classe: "grade grade-2" }, [
          campo("Etiquetas (separe por vírgula)", campos.etiquetas),
          campo("Contém (alergênicos, separe por vírgula)", campos.alergenicos),
        ]),
        campo("Só para o agente de IA (opcional)", campos.descricaoAgente),
        el("div", { classe: "linha-campos", style: "margin-top:8px;gap:20px" }, [
          el("label", { classe: "campo-caixa" }, [campos.destaque, el("span", { texto: "Destaque da categoria (cartão grande com foto)" })]),
          el("label", { classe: "campo-caixa" }, [campos.ativo, el("span", { texto: "Aparece no cardápio" })]),
        ]),
        el("div", { classe: "reserva-acoes" }, [salvar, apagar]),
      ]),
      novo ? null : cartaoDeMidia(item),
      novo ? null : cartaoDeVariacoes(item),
    );
    campos.nome.focus();
  }

  /* ---- fotos e vídeos do item ---- */

  function cartaoDeMidia(item) {
    const grade = el("div", { classe: "cardapio-midias" });
    const arquivo = el("input", { type: "file", accept: "image/*,video/mp4,video/webm,video/quicktime", multiple: true, hidden: true });
    const botao = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "+ Foto ou vídeo",
      onclick: () => arquivo.click(),
    });

    arquivo.addEventListener("change", async () => {
      const escolhidos = [...(arquivo.files ?? [])];
      if (!escolhidos.length) return;
      botao.disabled = true;
      botao.textContent = "Enviando…";
      try {
        for (const escolhido of escolhidos) {
          const pronto = escolhido.type.startsWith("image/") ? await reduzirImagem(escolhido) : escolhido;
          const r = await postArquivo(
            `/v1/venues/${ctx.venue}/cardapio/itens/${item.id}/midia?media_type=${encodeURIComponent(pronto.type || "")}`,
            pronto,
          );
          item.midias.push(r);
          if (r.tipo === "image" && !item.capa) item.capa = r.url;
          if (r.tipo === "video" && !item.video) item.video = r.url;
        }
        avisar(escolhidos.length > 1 ? "Arquivos enviados." : "Arquivo enviado.", "ok");
        desenharMidias();
      } catch (e) {
        avisar(e.message, "erro");
      } finally {
        botao.disabled = false;
        botao.textContent = "+ Foto ou vídeo";
        arquivo.value = "";
      }
    });

    function desenharMidias() {
      limpar(grade);
      if (!item.midias.length) {
        grade.append(el("p", { classe: "muted", texto: "Sem foto ainda. O cardápio mostra a inicial do nome num fundo colorido até a primeira foto entrar." }));
        return;
      }
      for (const m of item.midias) {
        const ehCapa = m.tipo === "image" ? m.url === item.capa : m.url === item.video;
        const x = el("button", { classe: "chip-x chip-x-sobre", type: "button", texto: "✕", title: "Remover" });
        x.addEventListener("click", async () => {
          if (!confirm("Remover esta mídia do item?")) return;
          x.disabled = true;
          try {
            await del(`/v1/venues/${ctx.venue}/cardapio/itens/${item.id}/midia/${m.id}`);
            item.midias = item.midias.filter((o) => o.id !== m.id);
            if (item.capa === m.url) item.capa = item.midias.find((o) => o.tipo === "image")?.url ?? null;
            if (item.video === m.url) item.video = item.midias.find((o) => o.tipo === "video")?.url ?? null;
            desenharMidias();
          } catch (e) {
            avisar(e.message, "erro");
            x.disabled = false;
          }
        });
        const capa = el("button", {
          classe: `btn btn-peq${ehCapa ? " btn-primario" : ""}`,
          type: "button",
          texto: ehCapa ? (m.tipo === "video" ? "Vídeo da ficha" : "É a capa") : m.tipo === "video" ? "Usar na ficha" : "Usar como capa",
          disabled: ehCapa,
          onclick: async () => {
            try {
              await post(`/v1/venues/${ctx.venue}/cardapio/itens/${item.id}/midia/${m.id}/capa`);
              if (m.tipo === "image") item.capa = m.url;
              else item.video = m.url;
              desenharMidias();
            } catch (e) {
              avisar(e.message, "erro");
            }
          },
        });
        grade.append(
          el("div", { classe: "cardapio-midia" }, [
            el("div", { classe: "logo-caixa" }, [
              m.tipo === "video"
                ? el("video", { src: m.url, muted: true, playsinline: true, controls: true, preload: "metadata" })
                : el("img", { src: m.url, alt: "" }),
              x,
            ]),
            capa,
          ]),
        );
      }
    }
    desenharMidias();

    return el("div", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h3", { texto: "Fotos e vídeo" }),
          el("p", { classe: "muted", texto: "Até 8 por item. A primeira foto vira a capa; a foto é reduzida no seu aparelho antes de subir. Vídeo vai como está (até 50 MB)." }),
        ]),
        botao,
      ]),
      arquivo,
      grade,
    ]);
  }

  /* ---- variações do item ---- */

  function cartaoDeVariacoes(item) {
    const lista = el("div", { classe: "pilha", style: "gap:10px" });
    const grupos = item.variacoes.map((g) => ({ nome: g.nome, obrigatorio: g.obrigatorio, opcoes: g.opcoes.map((o) => ({ ...o })) }));

    function desenhar() {
      limpar(lista);
      if (!grupos.length) {
        lista.append(el("p", { classe: "muted", texto: "Sem variações. Use para “Ponto da carne”, “Tamanho” ou “Acompanhamento extra” — com ou sem valor a mais." }));
      }
      grupos.forEach((g, gi) => {
        const nome = el("input", { placeholder: "Ponto da carne", value: g.nome, style: "flex:2" });
        nome.addEventListener("input", () => { g.nome = nome.value; });
        const obrig = el("input", { type: "checkbox", checked: g.obrigatorio });
        obrig.addEventListener("change", () => { g.obrigatorio = obrig.checked; });
        const opcoes = el("div", { classe: "pilha", style: "gap:6px;margin-top:6px" });
        const desenharOpcoes = () => {
          limpar(opcoes);
          g.opcoes.forEach((o, oi) => {
            const n = el("input", { placeholder: "Ao ponto", value: o.nome, style: "flex:2" });
            n.addEventListener("input", () => { o.nome = n.value; });
            const v = el("input", { placeholder: "+ R$ (0 = sem custo)", inputmode: "decimal", value: o.adicional ? String(o.adicional).replace(".", ",") : "", style: "flex:1" });
            v.addEventListener("input", () => { o.adicional = v.value; });
            opcoes.append(
              el("div", { classe: "linha-campos" }, [
                n,
                v,
                el("button", { classe: "btn-icone", type: "button", texto: "🗑️", title: "Remover opção", onclick: () => { g.opcoes.splice(oi, 1); desenharOpcoes(); } }),
              ]),
            );
          });
          opcoes.append(el("button", { classe: "btn btn-peq", type: "button", texto: "+ opção", onclick: () => { g.opcoes.push({ nome: "", adicional: 0 }); desenharOpcoes(); } }));
        };
        desenharOpcoes();
        lista.append(
          el("div", { classe: "cartao", style: "background:var(--superficie-2)" }, [
            el("div", { classe: "linha-campos" }, [
              nome,
              el("label", { classe: "campo-caixa", style: "align-items:center" }, [obrig, el("span", { texto: "obrigatório (escolhe 1)" })]),
              el("button", { classe: "btn-icone", type: "button", texto: "🗑️", title: "Remover grupo", onclick: () => { grupos.splice(gi, 1); desenhar(); } }),
            ]),
            opcoes,
          ]),
        );
      });
    }
    desenhar();

    const salvar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Salvar variações",
      onclick: async () => {
        salvar.disabled = true;
        try {
          await put(`/v1/venues/${ctx.venue}/cardapio/itens/${item.id}/variacoes`, { grupos });
          avisar("Variações salvas.", "ok");
        } catch (e) {
          avisar(e.message, "erro");
        } finally {
          salvar.disabled = false;
        }
      },
    });

    return el("div", { classe: "cartao" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [el("h3", { texto: "Variações" }), el("p", { classe: "muted", texto: "O cliente escolhe na ficha e o total recalcula na hora." })]),
        el("button", { classe: "btn btn-peq", type: "button", texto: "+ grupo", onclick: () => { grupos.push({ nome: "", obrigatorio: true, opcoes: [{ nome: "", adicional: 0 }] }); desenhar(); } }),
      ]),
      lista,
      el("div", { classe: "reserva-acoes" }, [salvar]),
    ]);
  }

  /* ================= Categorias ================= */

  function abaCategorias() {
    const lista = el("div", { classe: "tabela" });
    const nome = el("input", { placeholder: "Nome da categoria (ex.: Petiscos)", style: "flex:2" });
    const grupo = el("select", { classe: "select", style: "flex:1" }, [
      el("option", { value: "comer", texto: "Comer" }),
      el("option", { value: "beber", texto: "Beber" }),
    ]);
    const criar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Criar",
      onclick: async () => {
        criar.disabled = true;
        try {
          await post(`/v1/venues/${ctx.venue}/cardapio/categorias`, { nome: nome.value.trim(), grupo: grupo.value });
          nome.value = "";
          avisar("Categoria criada.", "ok");
          await recarregar();
        } catch (e) {
          avisar(e.message, "erro");
        } finally {
          criar.disabled = false;
        }
      },
    });

    corpo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Categorias" }),
          el("p", { classe: "muted", texto: "A ordem aqui é a ordem no cardápio. Arraste pela alça ou use as setas — salva sozinho." }),
        ]),
      ]),
      el("div", { classe: "cartao" }, [el("div", { classe: "linha-campos" }, [nome, grupo, criar])]),
      lista,
    );

    if (!dados.categorias.length) {
      lista.append(vazio("Nenhuma categoria", "Crie a primeira acima: Petiscos, Na brasa, Chopp…"));
      return;
    }
    for (const c of dados.categorias) lista.append(linhaDaCategoria(c, lista));
    tornarOrdenavel(lista, "categorias");
  }

  function linhaDaCategoria(c, lista) {
    const nome = el("input", { value: c.nome, style: "flex:2" });
    const grupo = el("select", { classe: "select select-peq" }, [
      el("option", { value: "comer", texto: "Comer", selected: c.grupo === "comer" }),
      el("option", { value: "beber", texto: "Beber", selected: c.grupo === "beber" }),
    ]);
    const descricao = el("input", { value: c.descricao, placeholder: "Descrição curta (opcional)", style: "flex:3" });
    const ativa = el("input", { type: "checkbox", checked: c.ativa });
    const salvarMudanca = async (mudanca) => {
      try {
        await patch(`/v1/venues/${ctx.venue}/cardapio/categorias/${c.id}`, mudanca);
        Object.assign(c, { nome: nome.value, grupo: grupo.value, descricao: descricao.value, ativa: ativa.checked });
      } catch (e) {
        avisar(e.message, "erro");
      }
    };
    nome.addEventListener("change", () => salvarMudanca({ nome: nome.value.trim() }));
    grupo.addEventListener("change", () => salvarMudanca({ grupo: grupo.value }));
    descricao.addEventListener("change", () => salvarMudanca({ descricao: descricao.value.trim() }));
    ativa.addEventListener("change", () => salvarMudanca({ ativa: ativa.checked }));

    const quantos = dados.itens.filter((i) => i.categoria_id === c.id).length;
    const linha = el("div", { classe: "linha-tabela", "data-id": c.id }, [
      alcaDeOrdem(() => linha),
      el("div", { classe: "linha-principal", style: "gap:6px" }, [
        el("div", { classe: "linha-campos" }, [nome, grupo]),
        el("div", { classe: "linha-campos" }, [
          descricao,
          el("label", { classe: "campo-caixa", style: "align-items:center;white-space:nowrap" }, [ativa, el("span", { texto: "no cardápio" })]),
        ]),
      ]),
      el("div", { classe: "linha-detalhes" }, [
        el("span", { classe: "muted", texto: `${quantos} ${quantos === 1 ? "item" : "itens"}` }),
        el("button", {
          classe: "btn-icone",
          type: "button",
          texto: "🗑️",
          title: "Apagar categoria",
          onclick: async () => {
            if (!confirm(`Apagar "${c.nome}"? Os ${quantos} itens dela ficam, sem categoria.`)) return;
            try {
              await del(`/v1/venues/${ctx.venue}/cardapio/categorias/${c.id}`);
              await recarregar();
            } catch (e) {
              avisar(e.message, "erro");
            }
          },
        }),
      ]),
    ]);
    void lista;
    return linha;
  }

  /* ---- ordem: alça de arrastar + setas; grava ao soltar ---- */

  function alcaDeOrdem(linhaDe) {
    const alca = el("span", {
      classe: "alca-arrastar",
      texto: "⋮⋮",
      title: "Arraste para mudar a ordem",
      style: "cursor:grab;user-select:none;color:var(--texto-fraco,#888);padding:0 4px",
    });
    const setas = el("div", { style: "display:flex;flex-direction:column" }, [
      el("button", { classe: "btn-icone", type: "button", texto: "▲", title: "Subir", onclick: (e) => { e.stopPropagation(); mover(linhaDe(), -1); } }),
      el("button", { classe: "btn-icone", type: "button", texto: "▼", title: "Descer", onclick: (e) => { e.stopPropagation(); mover(linhaDe(), 1); } }),
    ]);
    alca.addEventListener("mousedown", () => linhaDe().setAttribute("draggable", "true"));
    alca.addEventListener("mouseup", () => linhaDe().removeAttribute("draggable"));
    return el("div", { style: "display:flex;align-items:center;gap:2px" }, [alca, setas]);
  }

  function mover(linha, passo) {
    const pai = linha.parentElement;
    const vizinha = passo < 0 ? linha.previousElementSibling : linha.nextElementSibling;
    if (!vizinha) return;
    pai.insertBefore(passo < 0 ? linha : vizinha, passo < 0 ? vizinha : linha);
    pai.dispatchEvent(new CustomEvent("reordenado"));
  }

  function tornarOrdenavel(lista, recurso) {
    let arrastando = null;
    lista.addEventListener("dragstart", (e) => {
      const linha = e.target.closest("[data-id]");
      if (!linha) return;
      arrastando = linha;
      linha.style.opacity = "0.5";
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
    });
    lista.addEventListener("dragover", (e) => {
      if (!arrastando) return;
      e.preventDefault();
      const alvo = e.target.closest("[data-id]");
      if (!alvo || alvo === arrastando) return;
      const caixa = alvo.getBoundingClientRect();
      lista.insertBefore(arrastando, e.clientY > caixa.top + caixa.height / 2 ? alvo.nextSibling : alvo);
    });
    lista.addEventListener("drop", (e) => e.preventDefault());
    lista.addEventListener("dragend", () => {
      if (!arrastando) return;
      arrastando.style.opacity = "";
      arrastando.removeAttribute("draggable");
      arrastando = null;
      lista.dispatchEvent(new CustomEvent("reordenado"));
    });
    lista.addEventListener("reordenado", async () => {
      const ids = [...lista.querySelectorAll("[data-id]")].map((l) => l.dataset.id);
      try {
        await put(`/v1/venues/${ctx.venue}/cardapio/${recurso}/ordem`, { ids });
      } catch (e) {
        avisar(e.message, "erro");
      }
    });
  }

  /* ================= Banners ================= */

  function abaBanners() {
    const lista = el("div", { classe: "pilha" });
    corpo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Banners" }),
          el("p", { classe: "muted", texto: "Aparecem no topo do cardápio, em carrossel. Foto ou vídeo (mudo, em laço). Com data de início e fim, somem sozinhos." }),
        ]),
        el("button", {
          classe: "btn btn-primario btn-peq",
          type: "button",
          texto: "+ Novo banner",
          onclick: async () => {
            try {
              await post(`/v1/venues/${ctx.venue}/cardapio/banners`, { titulo: "Novo banner", ativo: false });
              avisar("Banner criado, desligado. Suba a foto ou o vídeo e ligue.", "ok");
              await recarregar();
            } catch (e) {
              avisar(e.message, "erro");
            }
          },
        }),
      ]),
      lista,
    );
    if (!dados.banners.length) {
      lista.append(vazio("Nenhum banner", "Um banner de rodízio, do happy hour ou do show da semana."));
      return;
    }
    for (const b of dados.banners) lista.append(cartaoDoBanner(b));
    tornarOrdenavel(lista, "banners");
  }

  function cartaoDoBanner(b) {
    const titulo = el("input", { value: b.titulo, placeholder: "Rodízio de petisco" });
    const subtitulo = el("input", { value: b.subtitulo, placeholder: "Segunda a quinta, à vontade." });
    const chamada = el("input", { value: b.chamada, placeholder: "Ver o rodízio (opcional)" });
    const linkTipo = el("select", { classe: "select" }, [
      el("option", { value: "none", texto: "Sem link", selected: b.link_tipo === "none" }),
      el("option", { value: "category", texto: "Vai para uma categoria", selected: b.link_tipo === "category" }),
      el("option", { value: "item", texto: "Abre um item", selected: b.link_tipo === "item" }),
      el("option", { value: "external", texto: "Link externo (https)", selected: b.link_tipo === "external" }),
    ]);
    const linkValor = el("div");
    const inicio = el("input", { type: "datetime-local", value: paraLocal(b.inicio) });
    const fim = el("input", { type: "datetime-local", value: paraLocal(b.fim) });
    const ativo = el("input", { type: "checkbox", checked: b.ativo });

    let valorAtual = b.link_valor;
    const desenharLinkValor = () => {
      limpar(linkValor);
      const tipo = linkTipo.value;
      if (tipo === "none") return;
      let controle;
      if (tipo === "category") {
        controle = el("select", { classe: "select" }, [
          el("option", { value: "", texto: "Escolha a categoria" }),
          ...dados.categorias.map((c) => el("option", { value: c.id, texto: c.nome, selected: c.id === valorAtual })),
        ]);
      } else if (tipo === "item") {
        controle = el("select", { classe: "select" }, [
          el("option", { value: "", texto: "Escolha o item" }),
          ...dados.itens.map((i) => el("option", { value: i.id, texto: i.nome, selected: i.id === valorAtual })),
        ]);
      } else {
        controle = el("input", { placeholder: "https://…", value: /^https:/.test(valorAtual) ? valorAtual : "" });
      }
      controle.addEventListener("change", () => { valorAtual = controle.value; });
      linkValor.append(controle);
    };
    linkTipo.addEventListener("change", () => { valorAtual = ""; desenharLinkValor(); });
    desenharLinkValor();

    const arquivo = el("input", { type: "file", accept: "image/*,video/mp4,video/webm,video/quicktime", hidden: true });
    const subir = el("button", { classe: "btn btn-peq", type: "button", texto: b.imagem || b.video ? "Trocar foto/vídeo" : "+ Foto ou vídeo", onclick: () => arquivo.click() });
    arquivo.addEventListener("change", async () => {
      const escolhido = arquivo.files?.[0];
      if (!escolhido) return;
      subir.disabled = true;
      subir.textContent = "Enviando…";
      try {
        const pronto = escolhido.type.startsWith("image/") ? await reduzirImagem(escolhido) : escolhido;
        await postArquivo(`/v1/venues/${ctx.venue}/cardapio/banners/${b.id}/midia?media_type=${encodeURIComponent(pronto.type || "")}`, pronto);
        avisar("Mídia do banner atualizada.", "ok");
        await recarregar();
      } catch (e) {
        avisar(e.message, "erro");
        subir.disabled = false;
        subir.textContent = "Trocar foto/vídeo";
      }
    });

    const salvar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: "Salvar",
      onclick: async () => {
        salvar.disabled = true;
        try {
          await patch(`/v1/venues/${ctx.venue}/cardapio/banners/${b.id}`, {
            titulo: titulo.value.trim(),
            subtitulo: subtitulo.value.trim(),
            chamada: chamada.value.trim(),
            link_tipo: linkTipo.value,
            link_valor: valorAtual,
            inicio: inicio.value ? new Date(inicio.value).toISOString() : null,
            fim: fim.value ? new Date(fim.value).toISOString() : null,
            ativo: ativo.checked,
          });
          avisar("Banner salvo.", "ok");
          await recarregar();
        } catch (e) {
          avisar(e.message, "erro");
          salvar.disabled = false;
        }
      },
    });

    const previa = b.video
      ? el("video", { src: b.video, poster: b.imagem || null, muted: true, playsinline: true, controls: true, preload: "metadata", classe: "cardapio-banner-previa" })
      : b.imagem
        ? el("img", { src: b.imagem, alt: "", classe: "cardapio-banner-previa" })
        : el("div", { classe: "cardapio-banner-previa vazio-previa", texto: "sem foto ou vídeo" });

    const cartao = el("div", { classe: "cartao", "data-id": b.id }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("div", { style: "display:flex;align-items:center;gap:8px" }, [
          alcaDeOrdem(() => cartao),
          el("h3", { texto: b.titulo || "Banner" }),
          !b.ativo ? etiqueta("desligado", "etiqueta-alerta") : b.video ? etiqueta("vídeo", "etiqueta-info") : null,
        ]),
        el("button", {
          classe: "btn-icone",
          type: "button",
          texto: "🗑️",
          title: "Apagar banner",
          onclick: async () => {
            if (!confirm(`Apagar o banner "${b.titulo}"?`)) return;
            try {
              await del(`/v1/venues/${ctx.venue}/cardapio/banners/${b.id}`);
              await recarregar();
            } catch (e) {
              avisar(e.message, "erro");
            }
          },
        }),
      ]),
      el("div", { classe: "grade grade-2" }, [
        el("div", {}, [previa, el("div", { style: "margin-top:8px" }, [subir, arquivo])]),
        el("div", { classe: "pilha", style: "gap:8px" }, [
          campo("Título", titulo),
          campo("Subtítulo", subtitulo),
          campo("Texto do botão", chamada),
          campo("Ao tocar", linkTipo),
          linkValor,
          el("div", { classe: "grade grade-2" }, [campo("Começa em (opcional)", inicio), campo("Termina em (opcional)", fim)]),
          el("label", { classe: "campo-caixa" }, [ativo, el("span", { texto: "Ligado — aparece no cardápio" })]),
        ]),
      ]),
      el("div", { classe: "reserva-acoes" }, [salvar]),
    ]);
    return cartao;
  }

  /* ================= Promoções ================= */

  function abaPromocoes() {
    const lista = el("div", { classe: "pilha" });
    corpo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Promoções" }),
          el("p", { classe: "muted", texto: "Preço promocional por dia da semana. Nos dias marcados o item aparece com o preço riscado e o selo da promoção. O agente de WhatsApp também passa a saber." }),
        ]),
        el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "+ Nova promoção", onclick: () => editarPromocao(null) }),
      ]),
      lista,
    );
    if (!dados.promocoes.length) {
      lista.append(vazio("Nenhuma promoção", "Chopp em dobro de terça a sexta, rodízio de segunda a quinta…"));
      return;
    }
    for (const p of dados.promocoes) {
      lista.append(
        el("div", { classe: "linha-tabela linha-clicavel", style: "background:var(--superficie);border:1px solid var(--borda);border-radius:12px", onclick: () => editarPromocao(p) }, [
          el("div", { classe: "linha-principal" }, [
            el("strong", { texto: p.nome }),
            el("span", { classe: "muted", texto: `${p.dias.length ? p.dias.map((d) => DIAS[d]).join(", ") : "todos os dias"} · ${p.itens.length} ${p.itens.length === 1 ? "item" : "itens"}` }),
          ]),
          el("div", { classe: "linha-detalhes" }, [p.ativa ? etiqueta("ativa", "etiqueta-ok") : etiqueta("desligada", "etiqueta-alerta")]),
        ]),
      );
    }
  }

  function editarPromocao(p) {
    const novo = !p;
    const nome = el("input", { value: p?.nome ?? "", placeholder: "Chopp em dobro" });
    const descricao = el("input", { value: p?.descricao ?? "", placeholder: "Até as 20h (opcional)" });
    const diasMarcados = new Set(p?.dias ?? []);
    const chips = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" }, DIAS.map((rotulo, d) => {
      const chip = el("button", { type: "button", classe: `btn btn-peq${diasMarcados.has(d) ? " btn-primario" : ""}`, texto: rotulo });
      chip.addEventListener("click", () => {
        if (diasMarcados.has(d)) diasMarcados.delete(d); else diasMarcados.add(d);
        chip.classList.toggle("btn-primario", diasMarcados.has(d));
      });
      return chip;
    }));
    const inicio = el("input", { type: "date", value: (p?.inicio ?? "").slice(0, 10) });
    const fim = el("input", { type: "date", value: (p?.fim ?? "").slice(0, 10) });
    const ativa = el("input", { type: "checkbox", checked: p ? p.ativa : true });

    const itens = (p?.itens ?? []).map((i) => ({ item_id: i.item_id, preco: i.preco }));
    const listaItens = el("div", { classe: "pilha", style: "gap:6px" });
    const desenharItens = () => {
      limpar(listaItens);
      itens.forEach((linha, n) => {
        const item = dados.itens.find((i) => i.id === linha.item_id);
        const preco = el("input", { placeholder: "Preço na promoção", inputmode: "decimal", value: String(linha.preco).replace(".", ","), style: "flex:1" });
        preco.addEventListener("input", () => { linha.preco = preco.value; });
        listaItens.append(
          el("div", { classe: "linha-campos" }, [
            el("span", { style: "flex:2", texto: item ? `${item.nome} (de ${dinheiro(item.preco)})` : "item apagado" }),
            preco,
            el("button", { classe: "btn-icone", type: "button", texto: "🗑️", onclick: () => { itens.splice(n, 1); desenharItens(); } }),
          ]),
        );
      });
      const seletor = el("select", { classe: "select" }, [
        el("option", { value: "", texto: "+ adicionar item à promoção" }),
        ...dados.itens.filter((i) => !itens.some((l) => l.item_id === i.id)).map((i) => el("option", { value: i.id, texto: `${i.nome} — ${dinheiro(i.preco)}` })),
      ]);
      seletor.addEventListener("change", () => {
        if (!seletor.value) return;
        const item = dados.itens.find((i) => i.id === seletor.value);
        itens.push({ item_id: item.id, preco: item.preco });
        desenharItens();
      });
      listaItens.append(seletor);
    };
    desenharItens();

    const salvar = el("button", {
      classe: "btn btn-primario btn-peq",
      type: "button",
      texto: novo ? "Criar promoção" : "Salvar",
      onclick: async () => {
        salvar.disabled = true;
        const dadosPromo = {
          nome: nome.value.trim(),
          descricao: descricao.value.trim(),
          dias: [...diasMarcados],
          inicio: inicio.value ? `${inicio.value}T00:00:00` : undefined,
          fim: fim.value ? `${fim.value}T23:59:59` : undefined,
          ativa: ativa.checked,
          itens,
        };
        try {
          if (novo) await post(`/v1/venues/${ctx.venue}/cardapio/promocoes`, dadosPromo);
          else await patch(`/v1/venues/${ctx.venue}/cardapio/promocoes/${p.id}`, dadosPromo);
          avisar("Promoção salva.", "ok");
          await recarregar();
        } catch (e) {
          avisar(e.message, "erro");
          salvar.disabled = false;
        }
      },
    });
    const apagar = p
      ? el("button", {
          classe: "btn btn-perigo btn-peq",
          type: "button",
          texto: "Apagar",
          onclick: async () => {
            if (!confirm(`Apagar a promoção "${p.nome}"?`)) return;
            try {
              await del(`/v1/venues/${ctx.venue}/cardapio/promocoes/${p.id}`);
              await recarregar();
            } catch (e) {
              avisar(e.message, "erro");
            }
          },
        })
      : null;

    limpar(corpo).append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [el("h2", { texto: novo ? "Nova promoção" : p.nome })]),
        el("button", { classe: "btn btn-peq", type: "button", texto: "← Voltar", onclick: desenharAba }),
      ]),
      el("div", { classe: "cartao" }, [
        el("div", { classe: "grade grade-2" }, [campo("Nome (vira o selo no item)", nome), campo("Descrição", descricao)]),
        el("div", { classe: "campo" }, [el("label", { texto: "Dias da semana (nenhum marcado = todos)" }), chips]),
        el("div", { classe: "grade grade-2" }, [campo("Vale de (opcional)", inicio), campo("Até (opcional)", fim)]),
        el("label", { classe: "campo-caixa" }, [ativa, el("span", { texto: "Ativa" })]),
        el("h3", { style: "margin-top:14px", texto: "Itens e preço na promoção" }),
        listaItens,
        el("div", { classe: "reserva-acoes" }, [salvar, apagar]),
      ]),
    );
    nome.focus();
  }

  /* ================= Comentários ================= */

  function abaComentarios() {
    let situacao = "pending";
    const filtros = el("div", { classe: "linha-campos" });
    const lista = el("div", { classe: "lista" });
    const ROTULOS = { pending: "Aguardando você", approved: "Liberados", rejected: "Recusados" };

    const desenharFiltros = () => {
      limpar(filtros).append(
        ...Object.entries(ROTULOS).map(([id, rotulo]) =>
          el("button", {
            type: "button",
            classe: `btn btn-peq${id === situacao ? " btn-primario" : ""}`,
            texto: id === "pending" && dados.comentarios_pendentes ? `${rotulo} (${dados.comentarios_pendentes})` : rotulo,
            onclick: () => { situacao = id; desenharFiltros(); carregar(); },
          }),
        ),
      );
    };

    async function carregar() {
      limpar(lista).append(el("p", { classe: "muted", texto: "Carregando…" }));
      let comentarios;
      try {
        comentarios = await get(`/v1/venues/${ctx.venue}/cardapio/comentarios?situacao=${situacao}`);
      } catch (e) {
        limpar(lista).append(el("p", { classe: "muted", texto: e.message }));
        return;
      }
      limpar(lista);
      if (!comentarios.length) {
        lista.append(vazio(situacao === "pending" ? "Nada esperando" : "Nenhum comentário aqui", situacao === "pending" ? "Quando um cliente comentar um prato, aparece aqui para você liberar." : ""));
        return;
      }
      for (const c of comentarios) lista.append(cartaoDoComentario(c));
    }

    function cartaoDoComentario(c) {
      const decidir = async (acao) => {
        try {
          await post(`/v1/venues/${ctx.venue}/cardapio/comentarios/${c.id}/${acao}`);
          avisar(acao === "liberar" ? "Comentário liberado — já aparece no cardápio." : "Comentário recusado.", "ok");
          dados.comentarios_pendentes = Math.max(0, dados.comentarios_pendentes - (c.status === "pending" ? 1 : 0));
          contadorComentarios.textContent = String(dados.comentarios_pendentes);
          contadorComentarios.hidden = !dados.comentarios_pendentes;
          ctx.atualizarContador("cardapio", dados.comentarios_pendentes);
          desenharFiltros();
          await carregar();
        } catch (e) {
          avisar(e.message, "erro");
        }
      };
      return el("article", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h3", { texto: c.autor }),
            el("p", { classe: "muted", texto: `${c.item_nome ?? "item apagado"} · ${dataHora(c.criado_em)}` }),
          ]),
          c.nota ? etiqueta(`${"★".repeat(c.nota)}${"☆".repeat(5 - c.nota)} ${c.nota}`, c.nota <= 2 ? "etiqueta-perigo" : c.nota === 3 ? "etiqueta-alerta" : "etiqueta-ok") : null,
        ]),
        el("p", { texto: `"${c.texto}"` }),
        c.moderado_em ? el("p", { classe: "muted", texto: `Decidido em ${dataHora(c.moderado_em)}${c.nota_moderacao ? ` por ${c.nota_moderacao}` : ""}` }) : null,
        el("div", { classe: "reserva-acoes" }, [
          c.status !== "approved" ? el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "Liberar", onclick: () => decidir("liberar") }) : null,
          c.status !== "rejected" ? el("button", { classe: "btn btn-peq", type: "button", texto: "Recusar", onclick: () => decidir("recusar") }) : null,
        ]),
      ]);
    }

    corpo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Comentários dos clientes" }),
          el("p", { classe: "muted", texto: "Ninguém vê um comentário até você liberar. Quem escreveu vê o próprio, marcado como “aguardando a casa”." }),
        ]),
      ]),
      filtros,
      lista,
    );
    desenharFiltros();
    carregar();
  }

  /* ================= QR code ================= */

  function abaQrcode() {
    const mesa = el("input", { placeholder: "Ex.: 7 (deixe vazio para um QR geral)", value: sessionStorage.getItem("brasa.cardapio.mesa-qr") ?? "" });
    sessionStorage.removeItem("brasa.cardapio.mesa-qr");
    const area = el("div");

    async function gerar() {
      limpar(area).append(el("p", { classe: "muted", texto: "Gerando…" }));
      const busca = mesa.value.trim() ? `?mesa=${encodeURIComponent(mesa.value.trim())}` : "";
      let qr;
      try {
        qr = await get(`/v1/venues/${ctx.venue}/cardapio/qrcode${busca}`);
      } catch (e) {
        limpar(area).append(el("p", { classe: "muted", texto: e.message }));
        return;
      }
      limpar(area).append(
        el("div", { classe: "cartaz-qr" }, [
          el("img", { src: qr.png, alt: "QR code do cardápio", classe: "qr-imagem" }),
          el("div", {}, [
            el("h3", { texto: qr.mesa ? `Mesa ${qr.mesa}` : "Cardápio da casa" }),
            el("p", { classe: "muted", texto: "Imprima e cole na mesa. Com o número da mesa, “Chamar o garçom” já diz de onde veio." }),
            el("p", { classe: "bloco-codigo", texto: qr.url }),
            el("div", { classe: "linha-campos" }, [
              el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "Imprimir", onclick: () => window.print() }),
              el("button", {
                classe: "btn btn-peq",
                type: "button",
                texto: "Copiar link",
                onclick: async () => {
                  try { await navigator.clipboard.writeText(qr.url); avisar("Link copiado.", "ok"); } catch { avisar("Copie o link que está na tela.", "erro"); }
                },
              }),
            ]),
          ]),
        ]),
      );
    }

    corpo.append(
      el("section", { classe: "cartao" }, [
        el("h3", { texto: "QR code para a mesa" }),
        el("p", { classe: "muted", texto: "Um QR por mesa: o chamado do garçom e o pedido chegam com o número da mesa. Sem mesa, o cardápio abre igual." }),
        el("div", { classe: "linha-campos", style: "margin-top:12px" }, [
          el("label", { classe: "campo-rotulado", style: "flex:1" }, [el("span", { texto: "Número da mesa (opcional)" }), mesa]),
          el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "Gerar QR code", onclick: gerar }),
        ]),
        area,
      ]),
      dados.chamados.length
        ? el("section", { classe: "cartao" }, [
            el("h3", { texto: "Chamados de mesa (últimas 12h)" }),
            el("div", { classe: "tabela", style: "margin-top:8px" }, dados.chamados.map((c) =>
              el("div", { classe: "linha-tabela" }, [
                el("div", { classe: "linha-principal" }, [
                  el("strong", { texto: c.mesa ? `Mesa ${c.mesa}` : "Mesa não informada" }),
                  c.pedido ? el("span", { classe: "muted", texto: `Quer pedir: ${c.pedido}` }) : null,
                ]),
                el("span", { classe: "muted", texto: dataHora(c.em) }),
              ]),
            )),
          ])
        : null,
    );
    gerar();
  }

  /* ================= miúdos ================= */

  function campo(rotulo, controle) {
    return el("div", { classe: "campo" }, [el("label", { texto: rotulo }), controle]);
  }
}

function normalizar(t) {
  return (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** ISO → valor de <input type="datetime-local">, no relógio do navegador. */
function paraLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const dois = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/**
 * Reduz a foto no navegador antes de subir.
 *
 * A foto do prato sai do celular com 4000 pixels e 6 MB; no cardápio ela
 * aparece com 64 pixels na lista e no máximo a largura da tela na ficha.
 * Subir o original faria o cliente esperar 6 MB no 4G do bar por uma foto que
 * cabe em 200 KB. JPEG, e não PNG: foto de comida não tem transparência, e o
 * JPEG é cinco vezes menor.
 */
async function reduzirImagem(arquivo) {
  if (typeof createImageBitmap !== "function") return arquivo;
  let imagem;
  try {
    imagem = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    try {
      imagem = await createImageBitmap(arquivo);
    } catch {
      return arquivo;
    }
  }
  const maior = Math.max(imagem.width, imagem.height);
  if (maior <= LADO_MAXIMO && arquivo.size <= 600 * 1024) {
    imagem.close?.();
    return arquivo;
  }
  const escala = Math.min(1, LADO_MAXIMO / maior);
  const tela = document.createElement("canvas");
  tela.width = Math.round(imagem.width * escala);
  tela.height = Math.round(imagem.height * escala);
  tela.getContext("2d").drawImage(imagem, 0, 0, tela.width, tela.height);
  imagem.close?.();
  const blob = await new Promise((resolve) => tela.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob || blob.size >= arquivo.size) return arquivo;
  return new File([blob], "foto.jpg", { type: "image/jpeg" });
}
