import { get } from "../api.js";
import { el, limpar, vazio } from "../ui.js";

/**
 * A CASA AGORA — o bar visto de cima, em isométrico.
 *
 * Quatro áreas, como quem atravessa a casa: a RECEPÇÃO por onde o cliente
 * chega, o SALÃO com as mesas, a DOCA no fundo (recebimento e cozinha) e o
 * ADMINISTRATIVO (RH, financeiro, atendimento ao cliente e rotinas).
 *
 * Dentro de cada área ficam as BAIAS — uma mesa de trabalho por assunto — e
 * os BONECOS de quem está na casa: as pessoas com o ponto aberto e os agentes
 * de software. Cada boneco carrega uma plaquinha acima da cabeça com o que
 * está fazendo, ou "ocioso" e há quanto tempo.
 *
 * No salão, cada mesa da casa é desenhada no chão e ACENDE no instante em que
 * alguém lê o QR code dela; PISCA em vermelho quando aquela mesa chama o
 * garçom.
 *
 * COMO O ISOMÉTRICO É FEITO
 *
 * Duas camadas sobre o mesmo sistema de coordenadas em ladrilhos:
 *
 *   · o CHÃO é uma camada com `rotateX(60deg) rotateZ(45deg)`. Áreas, baias e
 *     mesas são retângulos comuns dentro dela, e o navegador faz a projeção.
 *   · as PLACAS (números, nomes, plaquinhas, bonecos) ficam numa camada reta,
 *     posicionadas pela mesma projeção feita à mão. Assim o texto sai sempre
 *     na horizontal e legível — texto dentro da camada girada fica torto.
 *
 * A conta da projeção tem de casar com a do CSS, e casa: `rotateX(60deg)`
 * achata a vertical pela metade (cos 60° = 0,5) e `rotateZ(45deg)` gira,
 * o que dá exatamente o losango de 2 para 1 do isométrico clássico.
 */

const QUANTO_ESPERA_MS = 15_000;
/** Depois disto, a baia deixa de ser "viva" e vira "quieta". */
const MINUTOS_ATE_ESFRIAR = 45;
/** De quanto em quanto tempo um boneco escolhe um novo lugar. */
const PASSO_TRABALHANDO = [2600, 4200];
const PASSO_OCIOSO = [7000, 12_000];

/** O lado do ladrilho na camada do chão, antes de ela ser girada. */
const LADRILHO = 20;
/** O que a rotação faz com o ladrilho: 2 de largura para 1 de altura. */
const PASSO_X = LADRILHO * Math.SQRT1_2;
const PASSO_Y = PASSO_X / 2;

/**
 * A planta da casa, em ladrilhos.
 *
 * O salão ocupa o quarteirão maior, porque é onde o bar acontece. A recepção
 * e a doca ficam do lado dele — a porta de um lado, o fundo do outro — e o
 * administrativo é a faixa que atravessa a frente da casa inteira.
 *
 * As quatro se encostam de propósito: a casa tem de parecer uma casa só,
 * vista de cima, e não quatro quadros soltos.
 */
const MAPA = { largura: 36, altura: 30 };
const AREAS_NA_PLANTA = {
  salao: { x: 0, y: 0, w: 20, h: 20, nome: "Salão" },
  recepcao: { x: 21, y: 0, w: 15, h: 9, nome: "Recepção" },
  doca: { x: 21, y: 10, w: 15, h: 10, nome: "Doca" },
  administrativo: { x: 0, y: 21, w: 36, h: 9, nome: "Administrativo" },
};

/** Quantos ladrilhos do fundo do salão ficam sem mesa, para a equipe andar. */
const CORREDOR = 4;
/** No máximo esta gente por fila no corredor; o resto forma outra fila atrás. */
const POR_FILA = 5;

/**
 * Onde cada baia fica dentro da área dela, em ladrilhos.
 *
 * Duas baias da mesma área ficam LADO A LADO no eixo x, nunca empilhadas no
 * eixo y. O motivo é da projeção: empilhar no y afasta duas placas em uns
 * poucos pixels de tela, e a placa de uma cai em cima do boneco da outra —
 * caiu, enquanto a doca tinha recebimento e cozinha uma embaixo da outra.
 * Lado a lado, cada ladrilho de distância vale o dobro em pixels.
 *
 * Cada baia tem folga à frente: é ali que ficam os bonecos de quem trabalha
 * nela, e é por isso que a área é maior que a mesa de trabalho.
 */
const BAIAS_NA_PLANTA = {
  recepcao: { x: 25.5, y: 3, w: 6, h: 1.6 },
  recebimento: { x: 22, y: 13, w: 6, h: 1.6 },
  cozinha: { x: 29, y: 13, w: 6, h: 1.6 },
  rh: { x: 1.5, y: 22.5, w: 6.5, h: 1.6 },
  financeiro: { x: 10.5, y: 22.5, w: 6.5, h: 1.6 },
  atendimento: { x: 19.5, y: 22.5, w: 6.5, h: 1.6 },
  rotinas: { x: 28.5, y: 22.5, w: 6.5, h: 1.6 },
};
/**
 * Onde a equipe de uma baia se junta, em ladrilhos a partir do meio da mesa.
 *
 * Andar os MESMOS ladrilhos nos dois eixos é descer reto na tela: 3,4 de
 * cada lado dá uns cinquenta pixels para baixo, que é o tanto que o boneco
 * precisa para a cabeça dele passar longe da placa da própria baia.
 */
const ENCONTRO = 3.4;
/** O afastamento entre dois colegas da mesma baia, na anti-diagonal. */
const ABERTURA = 1.5;

const menosAnimacao = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const sorteio = (de, ate) => de + Math.random() * (ate - de);

/** A folga acima da quina de cima, onde cabe o nome da primeira área. */
const TOPO = 34;

/** De ladrilho para pixel na tela — a mesma conta que o CSS do chão faz. */
function projetar(tx, ty) {
  return {
    x: (tx - ty) * PASSO_X + MAPA.altura * PASSO_X,
    y: (tx + ty) * PASSO_Y + TOPO,
  };
}

const LARGURA_DA_PLANTA = (MAPA.largura + MAPA.altura) * PASSO_X;
const ALTURA_DA_PLANTA = (MAPA.largura + MAPA.altura) * PASSO_Y + TOPO;

export async function aCasa(raiz, ctx) {
  let dados = null;
  const vistos = new Set();
  let pausado = false;
  let relogio = null;
  const passeios = new Set();

  const chao = el("div", { classe: "iso-chao" });
  const placas = el("div", { classe: "iso-placas" });
  const tabuleiro = el("div", { classe: "iso-tabuleiro" }, [chao, placas]);
  const planta = el("div", { classe: "rolagem-x" }, [
    el("div", { classe: "iso-moldura" }, [tabuleiro]),
  ]);
  const lista = el("div", {});
  const cabecalho = el("div", { classe: "cartao" });
  const gaveta = el("div", {});
  // Quem está aberto na gaveta: `{ tipo: "setor" | "quem", id }`. Fica
  // guardado, e não copiado: a cada volta do relógio a gaveta se redesenha
  // com o dado novo, em vez de congelar no instante do clique.
  let aberto = null;

  tabuleiro.style.width = `${LARGURA_DA_PLANTA}px`;
  tabuleiro.style.height = `${ALTURA_DA_PLANTA + 10}px`;
  // O chão nasce com o canto do mapa no zero, e o mapa girado avança para a
  // esquerda do zero. Este recuo é o MESMO que `projetar` soma no eixo x —
  // sem ele as placas ficam certas e o piso fica deslocado, que foi o
  // primeiro defeito desta tela.
  chao.style.setProperty("--recuo", `${MAPA.altura * PASSO_X}px`);
  chao.style.setProperty("--topo", `${TOPO}px`);

  limpar(raiz).append(el("div", { classe: "pilha" }, [cabecalho, planta, gaveta, lista]));

  ctx.aoSair(() => {
    clearInterval(relogio);
    pararPasseios();
    document.removeEventListener("visibilitychange", aoTrocarDeAba);
    document.removeEventListener("keydown", aoTeclar);
  });
  document.addEventListener("visibilitychange", aoTrocarDeAba);
  document.addEventListener("keydown", aoTeclar);

  function aoTeclar(e) {
    if (e.key === "Escape" && aberto) fechar();
  }

  await buscar({ primeira: true });
  relogio = setInterval(() => {
    if (!pausado && !document.hidden) void buscar({ primeira: false });
  }, QUANTO_ESPERA_MS);

  function aoTrocarDeAba() {
    if (!document.hidden && !pausado) void buscar({ primeira: false });
  }

  function pararPasseios() {
    for (const t of passeios) clearTimeout(t);
    passeios.clear();
  }

  /* ================= Dados ================= */

  async function buscar({ primeira }) {
    const desde = !primeira && dados ? `?desde=${encodeURIComponent(dados.agora)}` : "";
    let novo;
    try {
      novo = await get(`/v1/venues/${ctx.venue}/a-casa${desde}`);
    } catch (e) {
      if (primeira) limpar(raiz).append(vazio("Não deu para abrir a casa", e.message));
      return;
    }

    const novidades = primeira ? [] : novo.fatos.filter((f) => !vistos.has(f.id));
    for (const f of novo.fatos) vistos.add(f.id);

    dados = primeira
      ? novo
      : {
        ...novo,
        fatos: [...novidades, ...dados.fatos].slice(0, 60),
        setores: juntarSetores(dados.setores, novo.setores),
      };

    desenhar();
    for (const f of novidades) avisarNaBaia(f.setor);
  }

  /**
   * A baia nova manda no que ela sabe, mas não apaga o que já havia.
   *
   * A busca incremental só olha os últimos quinze segundos: se ela mandasse
   * sozinha, toda baia viraria "sem movimento" a cada volta do relógio.
   */
  function juntarSetores(antigos, novos) {
    return novos.map((n) => {
      const antigo = antigos.find((a) => a.id === n.id);
      if (!antigo || n.quantos > 0) return { ...n, quantos: n.quantos + (antigo?.quantos ?? 0) };
      return { ...n, quantos: antigo.quantos, ultimo: antigo.ultimo, minutos_parado: antigo.minutos_parado };
    });
  }

  /* ================= Desenho ================= */

  function desenhar() {
    desenharCabecalho();
    desenharPlanta();
    desenharGaveta();
    desenharLista();
  }

  /* ================= A gaveta ================= */

  function abrir(tipo, id) {
    // Clicar de novo no mesmo fecha: é o gesto que todo mundo tenta.
    aberto = aberto && aberto.tipo === tipo && aberto.id === id ? null : { tipo, id };
    desenharPlanta();
    desenharGaveta();
    if (aberto) gaveta.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function fechar() {
    aberto = null;
    desenharPlanta();
    desenharGaveta();
  }

  /**
   * O que está rolando em quem foi clicado.
   *
   * A planta cabe num relance e por isso cada baia só mostra uma linha. O
   * resto — todos os fatos do setor, quem está nele, a fila do agente com o
   * motivo de cada falha — mora aqui, a um clique. "1 aviso falhou" acima da
   * cabeça do Carteiro não servia para nada enquanto não desse para
   * perguntar QUAL.
   */
  function desenharGaveta() {
    limpar(gaveta);
    if (!aberto) return;

    const corpo = aberto.tipo === "setor"
      ? gavetaDoSetor(aberto.id)
      : aberto.tipo === "mesa"
        ? gavetaDaMesa(aberto.id)
        : gavetaDeQuem(aberto.id);
    if (!corpo) {
      aberto = null;
      return;
    }

    gaveta.append(
      el("section", { classe: "cartao casa-gaveta" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h3", { texto: corpo.titulo }),
            el("p", { classe: "muted", texto: corpo.legenda }),
          ]),
          el("button", { classe: "btn btn-peq", type: "button", texto: "Fechar", onclick: fechar }),
        ]),
        ...corpo.blocos,
      ]),
    );
  }

  function gavetaDoSetor(id) {
    const setor = dados.setores.find((s) => s.id === id);
    if (!setor) return null;

    const meus = dados.fatos.filter((f) => f.setor === id);
    const gente = (dados.trabalhadores ?? []).filter((t) => t.setor === id);

    return {
      titulo: setor.nome,
      legenda: setor.legenda,
      blocos: [
        !setor.contratado
          ? aviso(setor.em_breve
            ? "Este módulo ainda está sendo construído. Quando ficar pronto, ele acende aqui sozinho."
            : "A casa não contratou este módulo. O setor aparece apagado para você saber que ele existe.")
          : null,
        gente.length
          ? bloco("Quem está aqui", gente.map((t) => linha({
            titulo: t.nome,
            detalhe: [t.papel, oQueEstaFazendo(t)].filter(Boolean).join(" · "),
            aoClicar: () => abrir("quem", t.id),
          })))
          : null,
        setor.contratado
          ? bloco(
            meus.length ? `O que aconteceu aqui (${meus.length})` : "O que aconteceu aqui",
            meus.length
              ? meus.map((f) => linha({
                titulo: f.titulo,
                detalhe: [quandoFoi(f.quando, dados.agora), f.quem, f.detalhe].filter(Boolean).join(" · "),
                ruim: f.atencao,
              }))
              : [el("p", { classe: "muted", texto: "Nada nas últimas 24 horas." })],
          )
          : null,
      ].filter(Boolean),
    };
  }

  /**
   * Uma mesa aberta: quem está nela, o que olhou e há quanto tempo.
   *
   * A mesa acesa é o que o dono do bar mais olha nesta tela, e o número
   * sozinho não diz nada. Clicar nela é o gesto óbvio — e ela cobre quase
   * todo o chão do salão, então é por ela que o salão se abre.
   */
  function gavetaDaMesa(numero) {
    const mesa = (dados.mesas ?? []).find((m) => m.numero === numero);
    if (!mesa) return null;

    const comoEsta = mesa.estado === "chamando"
      ? "chamando o garçom"
      : mesa.estado === "ocupada" ? "com cliente" : "livre";
    const daMesa = dados.fatos.filter((f) =>
      f.setor === "salao" && (f.quem === `Mesa ${numero}` || f.titulo.startsWith(`Mesa ${numero}:`)));

    return {
      titulo: `Mesa ${numero}`,
      legenda: [
        comoEsta,
        mesa.cliente,
        mesa.minutos !== null ? `aberta ${comoFazTempo(mesa.minutos)}` : null,
        mesa.garcom ? `garçom ${mesa.garcom}` : "sem garçom no turno",
      ].filter(Boolean).join(" · "),
      blocos: [
        mesa.estado === "chamando"
          ? aviso("Esta mesa chamou o garçom e ainda não foi atendida.")
          : mesa.estado === "livre"
            ? aviso("Ninguém leu o QR code desta mesa nas últimas horas.")
            : null,
        mesa.olhando
          ? bloco("O que estavam olhando no cardápio", [linha({ titulo: mesa.olhando, detalhe: null })])
          : null,
        bloco(
          "O que esta mesa fez",
          daMesa.length
            ? daMesa.map((f) => linha({
              titulo: f.titulo,
              detalhe: [quandoFoi(f.quando, dados.agora), f.detalhe].filter(Boolean).join(" · "),
              ruim: f.atencao,
            }))
            : [el("p", { classe: "muted", texto: "Nada nas últimas 24 horas." })],
        ),
        bloco("O salão inteiro", [linha({
          titulo: "Abrir o salão",
          detalhe: "todos os fatos e quem está atendendo",
          aoClicar: () => abrir("setor", "salao"),
        })]),
      ].filter(Boolean),
    };
  }

  function gavetaDeQuem(id) {
    const quem = (dados.trabalhadores ?? []).find((t) => t.id === id);
    if (!quem) return null;

    const setor = dados.setores.find((s) => s.id === quem.setor);
    const seus = dados.fatos.filter((f) => f.quem && primeiroNome(f.quem) === primeiroNome(quem.nome));
    const fila = quem.detalhes ?? [];

    return {
      titulo: quem.nome,
      legenda: [quem.papel, setor ? `no ${setor.nome}` : null, oQueEstaFazendo(quem)]
        .filter(Boolean).join(" · "),
      blocos: [
        fila.length
          ? bloco("Na fila dele agora", fila.map((d) => linha({
            titulo: d.titulo,
            detalhe: [d.quando ? quandoFoi(d.quando, dados.agora) : null, d.detalhe].filter(Boolean).join(" · "),
            ruim: d.ruim,
          })))
          : null,
        bloco(
          "O que passou pelas mãos dele",
          seus.length
            ? seus.map((f) => linha({
              titulo: f.titulo,
              detalhe: [quandoFoi(f.quando, dados.agora), setorDoFato(f), f.detalhe].filter(Boolean).join(" · "),
              ruim: f.atencao,
            }))
            : [el("p", { classe: "muted", texto: "Nada nas últimas 24 horas." })],
        ),
      ].filter(Boolean),
    };
  }

  function setorDoFato(f) {
    return dados.setores.find((s) => s.id === f.setor)?.nome ?? null;
  }

  function bloco(titulo, filhos) {
    return el("div", { style: "margin-top:14px" }, [
      el("h4", { classe: "casa-gaveta-titulo", texto: titulo }),
      el("div", { classe: "tabela", style: "margin-top:6px" }, filhos),
    ]);
  }

  function linha({ titulo, detalhe, ruim, aoClicar }) {
    return el("div", {
      classe: `linha-tabela ${ruim ? "linha-perigo" : ""} ${aoClicar ? "linha-clicavel" : ""}`.trim(),
      ...(aoClicar ? { onclick: aoClicar, role: "button", tabindex: "0" } : {}),
    }, [
      el("div", { classe: "linha-principal" }, [
        el("strong", { texto: titulo }),
        detalhe ? el("span", { classe: "muted", texto: detalhe }) : null,
      ]),
    ]);
  }

  function aviso(texto) {
    return el("p", { classe: "casa-gaveta-aviso", texto });
  }

  function oQueEstaFazendo(t) {
    if (t.em_pausa) return "em pausa";
    if (t.fazendo) return t.fazendo;
    return `ocioso ${comoFazTempo(t.minutos_parado)}`.trim();
  }

  function desenharCabecalho() {
    const atencao = dados.fatos.filter((f) => f.atencao).length;
    const gente = dados.trabalhadores ?? [];
    const ociosos = gente.filter((t) => !t.fazendo && !t.em_pausa).length;
    const ocupadas = (dados.mesas ?? []).filter((m) => m.estado !== "livre").length;
    const chamando = (dados.mesas ?? []).filter((m) => m.estado === "chamando").length;

    limpar(cabecalho).append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "A casa agora" }),
          el("p", {
            classe: "muted",
            texto: [
              gente.length ? `${gente.length} na casa` : "ninguém na casa",
              ociosos ? `${ociosos} ocioso(s)` : null,
              ocupadas ? `${ocupadas} mesa(s) com cliente` : null,
              atencao ? `${atencao} pedindo atenção` : null,
            ].filter(Boolean).join(" · "),
          }),
        ]),
        el("div", { classe: "reserva-acoes" }, [
          chamando ? el("span", { classe: "iso-chamando", texto: `${chamando} chamando o garçom` }) : null,
          el("span", { classe: `casa-pulso ${pausado ? "casa-pulso-parado" : ""}`.trim() }),
          el("span", { classe: "muted", texto: pausado ? "parado" : "ao vivo" }),
          el("button", {
            classe: "btn btn-peq",
            type: "button",
            texto: pausado ? "Retomar" : "Pausar",
            onclick: () => {
              pausado = !pausado;
              if (!pausado) void buscar({ primeira: false });
              desenharCabecalho();
            },
          }),
        ]),
      ]),
    );
  }

  function desenharPlanta() {
    pararPasseios();
    limpar(chao);
    limpar(placas);

    const baiaDe = (id) => dados.setores.find((s) => s.id === id);

    for (const [id, area] of Object.entries(AREAS_NA_PLANTA)) {
      chao.append(pisoDaArea(id, area));
      placas.append(placaDaArea(area));
    }

    desenharMesas();

    for (const [id, lugar] of Object.entries(BAIAS_NA_PLANTA)) {
      const setor = baiaDe(id);
      if (!setor) continue;
      chao.append(tampoDaBaia(setor, lugar));
      placas.append(placaDaBaia(setor, lugar));
    }

    desenharBonecos();

    if (!menosAnimacao()) {
      for (const node of placas.querySelectorAll(".boneco")) passear(node);
    }
  }

  /* ---- O chão ---- */

  /** Um retângulo na camada girada vira o piso da área, em losango. */
  function pisoDaArea(id, area) {
    const setoresDaArea = dados.setores.filter((s) => s.area === id);
    const viva = setoresDaArea.some((s) => s.contratado && s.minutos_parado !== null && s.minutos_parado <= MINUTOS_ATE_ESFRIAR);
    const nenhumContratado = setoresDaArea.length > 0 && setoresDaArea.every((s) => !s.contratado);

    // Área com um setor só — o salão, a recepção — não tem mesa de trabalho
    // para clicar, então o chão dela é que abre a gaveta. Sem isto o salão,
    // que é o setor mais importante da casa, era o único que não abria.
    const sozinho = setoresDaArea.length === 1 ? setoresDaArea[0] : null;

    return el("div", {
      classe: [
        "iso-piso",
        viva ? "iso-piso-vivo" : "",
        nenhumContratado ? "iso-piso-apagado" : "",
        sozinho ? "iso-piso-clicavel" : "",
      ].filter(Boolean).join(" "),
      style: `left:${area.x * LADRILHO}px;top:${area.y * LADRILHO}px;`
        + `width:${area.w * LADRILHO}px;height:${area.h * LADRILHO}px`,
      ...(sozinho ? { onclick: () => abrir("setor", sozinho.id), title: `${sozinho.nome} — clique para ver` } : {}),
    });
  }

  /** O tampo da mesa de trabalho, no chão. */
  function tampoDaBaia(setor, lugar) {
    const estado = !setor.contratado
      ? (setor.em_breve ? "iso-baia-embreve" : "iso-baia-apagada")
      : setor.ultimo?.atencao
        ? "iso-baia-atencao"
        : setor.minutos_parado !== null && setor.minutos_parado <= MINUTOS_ATE_ESFRIAR
          ? "iso-baia-viva"
          : "";

    return el("div", {
      classe: `iso-baia ${estado}`.trim(),
      style: `left:${lugar.x * LADRILHO}px;top:${lugar.y * LADRILHO}px;`
        + `width:${lugar.w * LADRILHO}px;height:${lugar.h * LADRILHO}px`,
    });
  }

  /* ---- As mesas do salão ---- */

  function desenharMesas() {
    const mesas = dados.mesas ?? [];
    const salao = dados.setores.find((s) => s.id === "salao");
    const area = AREAS_NA_PLANTA.salao;

    if (mesas.length === 0) {
      placas.append(recado(
        area,
        salao?.contratado ? "Cadastre as mesas no Cardápio" : "Cardápio digital não contratado",
      ));
      return;
    }

    // A grade das mesas se ajusta ao número delas: três mesas e setenta
    // mesas desenham o mesmo salão, só com espaçamento diferente. O corredor
    // do fundo fica de fora — é por onde a equipe anda.
    const util = area.h - 2 - CORREDOR;
    const colunas = Math.max(3, Math.round(Math.sqrt(mesas.length * (area.w / util))));
    const linhas = Math.ceil(mesas.length / colunas);
    const passoX = (area.w - 2) / colunas;
    const passoY = util / linhas;
    const lado = Math.min(passoX, passoY) * 0.62;

    mesas.forEach((m, i) => {
      const tx = area.x + 1 + (i % colunas) * passoX + passoX / 2;
      const ty = area.y + 1 + Math.floor(i / colunas) * passoY + passoY / 2;

      const escolhida = aberto?.tipo === "mesa" && aberto.id === m.numero;
      chao.append(el("div", {
        classe: `iso-mesa iso-mesa-${m.estado} ${escolhida ? "iso-escolhido" : ""}`.trim(),
        style: `left:${(tx - lado / 2) * LADRILHO}px;top:${(ty - lado / 2) * LADRILHO}px;`
          + `width:${lado * LADRILHO}px;height:${lado * LADRILHO}px`,
        onclick: () => abrir("mesa", m.numero),
      }));

      const onde = projetar(tx, ty);
      const detalhe = [
        m.cliente,
        m.olhando ? `olhando ${m.olhando}` : null,
        m.garcom ? `garçom ${m.garcom}` : null,
        m.minutos !== null ? `há ${m.minutos} min` : null,
      ].filter(Boolean).join(" · ");

      placas.append(el("div", {
        classe: `iso-mesa-placa iso-mesa-placa-${m.estado}`,
        style: `left:${onde.x}px;top:${onde.y}px;z-index:${Math.round((tx + ty) * 10)}`,
        title: `Mesa ${m.numero}${detalhe ? ` — ${detalhe}` : " — livre"}`,
        texto: String(m.numero),
        onclick: () => abrir("mesa", m.numero),
      }));
    });
  }

  /* ---- As placas retas ---- */

  /** O nome da área vai no canto de cima do losango dela. */
  function placaDaArea(area) {
    const onde = projetar(area.x + 0.5, area.y + 0.5);
    // Bem acima da quina: encostado nela, o nome da área some atrás da
    // placa da primeira baia — sumiu, com "DOCA" atrás de "Recebimento".
    return el("div", {
      classe: "iso-area-nome",
      style: `left:${onde.x}px;top:${onde.y - 32}px`,
      texto: area.nome,
    });
  }

  function placaDaBaia(setor, lugar) {
    const onde = projetar(lugar.x + lugar.w / 2, lugar.y + lugar.h / 2);
    const recado = !setor.contratado
      ? (setor.em_breve ? "em breve" : "não contratado")
      : setor.ultimo
        ? setor.ultimo.titulo
        : "sem movimento";

    const escolhido = aberto?.tipo === "setor" && aberto.id === setor.id;
    return el("div", {
      classe: [
        "iso-baia-placa",
        setor.contratado ? "" : "iso-baia-placa-apagada",
        escolhido ? "iso-escolhido" : "",
      ].filter(Boolean).join(" "),
      style: `left:${onde.x}px;top:${onde.y}px;z-index:${Math.round((lugar.x + lugar.y) * 10) + 1}`,
      "data-setor": setor.id,
      title: `${setor.legenda} — clique para ver o que está rolando`,
      role: "button",
      tabindex: "0",
      onclick: () => abrir("setor", setor.id),
    }, [
      el("strong", { texto: setor.nome }),
      el("span", { classe: "iso-baia-recado", texto: recado }),
      setor.contratado && setor.quantos > 0
        ? el("span", { classe: "iso-baia-conta", texto: String(setor.quantos) })
        : null,
    ]);
  }

  function recado(area, texto) {
    const onde = projetar(area.x + area.w / 2, area.y + area.h / 2);
    return el("div", { classe: "iso-recado", style: `left:${onde.x}px;top:${onde.y}px`, texto });
  }

  /* ---- Os bonecos ---- */

  function desenharBonecos() {
    const porBaia = new Map();
    for (const t of dados.trabalhadores ?? []) {
      const lista = porBaia.get(t.setor) ?? [];
      lista.push(t);
      porBaia.set(t.setor, lista);
    }

    for (const [setor, gente] of porBaia) {
      const area = areaDoSetor(setor);
      const lugares = lugaresDaEquipe(setor, area, gente.length);
      gente.forEach((t, i) => placas.append(boneco(t, lugares[i], area)));
    }
  }

  /** A área onde este setor fica — o administrativo, se ele for desconhecido. */
  function areaDoSetor(setor) {
    const id = dados.setores.find((s) => s.id === setor)?.area;
    return AREAS_NA_PLANTA[id] ?? AREAS_NA_PLANTA.administrativo;
  }

  /**
   * Onde fica cada um dos `n` colegas de um setor.
   *
   * Quem tem baia se junta À FRENTE da mesa de trabalho — nunca em cima
   * dela, onde o boneco cobriria o nome e o recado, que é o texto que a
   * planta existe para mostrar. Quem é do salão anda no corredor do fundo,
   * que a grade de mesas já deixa livre.
   *
   * Colegas se afastam pela ANTI-DIAGONAL (um sobe em `tx` o mesmo que desce
   * em `ty`), porque é assim que se anda na horizontal num mapa isométrico —
   * e é na horizontal que duas plaquinhas param de se cobrir. Como a
   * anti-diagonal estoura retângulo curto, todo lugar passa pelo aparador
   * `dentroDaArea`: já tive boneco parado fora do piso.
   */
  function lugaresDaEquipe(setor, area, n) {
    const baia = BAIAS_NA_PLANTA[setor];
    const lugares = [];

    if (!baia) {
      const fundo = area.y + area.h - CORREDOR / 2;
      for (let i = 0; i < n; i++) {
        const fila = Math.floor(i / POR_FILA);
        const quantos = Math.min(POR_FILA, n - fila * POR_FILA);
        const dentro = i % POR_FILA;
        const passo = quantos === 1 ? 0.5 : dentro / (quantos - 1);
        lugares.push(dentroDaArea(area, {
          tx: area.x + 2 + (area.w - 4) * passo,
          ty: fundo - fila * 1.8,
        }));
      }
      return lugares;
    }

    const cx = baia.x + baia.w / 2 + ENCONTRO;
    const cy = baia.y + baia.h / 2 + ENCONTRO;
    for (let i = 0; i < n; i++) {
      const fila = Math.floor(i / 3);
      const quantos = Math.min(3, n - fila * 3);
      const dentro = i % 3;
      const desvio = (quantos === 1 ? 0 : (dentro / (quantos - 1) - 0.5) * 2) * ABERTURA;
      lugares.push(dentroDaArea(area, {
        tx: cx + desvio + fila * 1.3,
        ty: cy - desvio + fila * 1.3,
      }));
    }
    return lugares;
  }

  /** O ponto trazido para dentro do piso, com uma folga de um ladrilho. */
  function dentroDaArea(area, ponto) {
    return {
      tx: Math.min(Math.max(ponto.tx, area.x + 1), area.x + area.w - 1),
      ty: Math.min(Math.max(ponto.ty, area.y + 1), area.y + area.h - 1),
    };
  }

  function boneco(t, lugar, area) {
    const ocioso = !t.fazendo && !t.em_pausa;
    const temProblema = (t.detalhes ?? []).some((d) => d.ruim);
    const classe = [
      "boneco",
      t.tipo === "agente" ? "boneco-agente" : "boneco-pessoa",
      t.em_pausa ? "boneco-pausa" : ocioso ? "boneco-ocioso" : "boneco-ativo",
      temProblema ? "boneco-com-problema" : "",
      aberto?.tipo === "quem" && aberto.id === t.id ? "iso-escolhido" : "",
    ].filter(Boolean).join(" ");

    const dizer = t.em_pausa
      ? "em pausa"
      : t.fazendo
        ? t.fazendo
        : `ocioso ${comoFazTempo(t.minutos_parado)}`.trim();

    const onde = projetar(lugar.tx, lugar.ty);
    const node = el("div", {
      classe,
      style: `left:${onde.x}px;top:${onde.y}px;z-index:${Math.round((lugar.tx + lugar.ty) * 10) + 2}`,
      title: `${[t.nome, t.papel, dizer].filter(Boolean).join(" · ")} — clique para ver`,
      role: "button",
      tabindex: "0",
      onclick: () => abrir("quem", t.id),
    }, [
      el("span", { classe: "boneco-etiqueta", texto: dizer }),
      el("span", { classe: "boneco-corpo" }, [
        el("span", { classe: "boneco-cabeca", texto: iniciais(t.nome) }),
        el("span", { classe: "boneco-tronco" }),
      ]),
      el("span", { classe: "boneco-nome", texto: primeiroNome(t.nome) }),
    ]);

    // O lugar de origem e o piso da área ficam guardados: o passeio é um
    // vaivém em torno de casa, e não uma corrida pela casa inteira que
    // embaralharia todo mundo — ou botaria gente andando fora do chão.
    node.dataset.casa = [lugar.tx, lugar.ty, area.x, area.y, area.w, area.h].join(",");
    return node;
  }

  /** Um passo a cada tantos segundos: quem trabalha anda mais que quem não. */
  function passear(node) {
    const parado = node.classList.contains("boneco-ocioso") || node.classList.contains("boneco-pausa");
    const [de, ate] = parado ? PASSO_OCIOSO : PASSO_TRABALHANDO;
    const [casaX, casaY, x, y, w, h] = String(node.dataset.casa ?? "0,0,0,0,0,0").split(",").map(Number);
    const raio = parado ? 0.8 : 1.8;

    const t = setTimeout(() => {
      passeios.delete(t);
      // Um passo de lado é `tx` para cima e `ty` para baixo na mesma medida:
      // é assim que se anda na horizontal num mapa isométrico.
      const lado = sorteio(-raio, raio);
      const frente = sorteio(-raio / 3, raio / 3);
      const onde = projetar(
        Math.min(Math.max(casaX + lado + frente, x + 1), x + w - 1),
        Math.min(Math.max(casaY - lado + frente, y + 1), y + h - 1),
      );
      node.style.left = `${onde.x}px`;
      node.style.top = `${onde.y}px`;
      passear(node);
    }, sorteio(de, ate));
    passeios.add(t);
  }

  /** Chegou fato novo numa baia: ela pisca, para o olho perceber de longe. */
  function avisarNaBaia(setor) {
    const node = placas.querySelector(`[data-setor="${setor}"]`);
    if (!node) return;
    node.classList.add("iso-baia-piscou");
    setTimeout(() => node.classList.remove("iso-baia-piscou"), 1200);
  }

  /* ---- A lista ---- */

  function desenharLista() {
    limpar(lista);
    if (dados.fatos.length === 0) {
      lista.append(vazio("A casa está quieta", "Quando entrar reserva, chegar mercadoria ou alguém bater ponto, aparece aqui."));
      return;
    }
    lista.append(
      el("section", { classe: "cartao" }, [
        el("h3", { texto: "O que aconteceu" }),
        el("div", { classe: "tabela", style: "margin-top:10px" },
          dados.fatos.slice(0, 25).map((f) => {
            const setor = dados.setores.find((s) => s.id === f.setor);
            return el("div", { classe: `linha-tabela ${f.atencao ? "linha-atencao" : ""}`.trim() }, [
              el("div", { classe: "linha-principal" }, [
                el("strong", { texto: f.titulo }),
                el("span", {
                  classe: "muted",
                  texto: [quandoFoi(f.quando, dados.agora), setor?.nome, f.quem, f.detalhe]
                    .filter(Boolean).join(" · "),
                }),
              ]),
            ]);
          })),
      ]),
    );
  }
}

/* ================= Miudezas ================= */

function comoFazTempo(minutos) {
  if (minutos === null || minutos === undefined) return "";
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "ontem" : `há ${dias} dias`;
}

function primeiroNome(nome) {
  return String(nome ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Duas letras cabem na cabeça do boneco; três já viram borrão. */
function iniciais(nome) {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "•";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

/**
 * A hora, e o dia junto quando não é de hoje.
 *
 * Sem o dia, um fato das 19h40 de ontem aparece embaixo de um das 13h40 de
 * hoje e a lista parece fora de ordem — já pareceu.
 */
function quandoFoi(iso, agora) {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const mesmoDia = d.toDateString() === new Date(agora).toDateString();
  return mesmoDia ? hora : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hora}`;
}
