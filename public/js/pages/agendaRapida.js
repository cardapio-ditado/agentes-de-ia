import { post, postArquivo } from "../api.js";
import { avisar, el, limpar, vazio } from "../ui.js";

/**
 * Cadastro rápido da programação: a IA lê, a pessoa confere.
 *
 * O formulário completo tem sete campos e precisa ser preenchido uma vez por
 * show. Doze shows no mês são doze vezes — e é aí que o cadastro para de ser
 * feito. Agenda desatualizada é pior que agenda vazia: o agente passa a
 * prometer ao cliente um show que não vai ter.
 *
 * A agenda, porém, já existe em algum lugar: a planilha do dono, o cartaz do
 * mês, a mensagem do produtor no WhatsApp. Aqui isso entra como está — cola-se
 * o texto ou manda-se a foto — e a IA devolve a lista pronta para conferir.
 *
 * O que a IA leu NUNCA vai direto para o banco. A lista vem editável e com as
 * caixas marcadas, e só grava quando alguém clica. Ler errado é barato de
 * corrigir na tela; gravar errado vira cliente na porta num dia sem show.
 */

const TIPOS = [
  ["musica", "Música"],
  ["jogo", "Jogo"],
  ["promocao", "Promoção"],
  ["evento", "Evento"],
  ["outro", "Outro"],
];

const EXEMPLO = `Sexta 22/08 — Acústico Berê, 20h às 23h, couvert 15
Sábado 23/08 — Grupo Karanova, 21h
Domingo 24/08 — Samba do Zé, 16h às 20h`;

/**
 * Devolve o cartão pronto para a página de Programação.
 *
 * `aoGravar` é chamado depois de gravar, para a agenda recarregar.
 */
export function blocoAgendaRapida(ctx, aoGravar) {
  const texto = el("textarea", {
    rows: 4,
    placeholder: EXEMPLO,
    style: "width:100%;font-family:inherit;font-size:0.95rem",
  });

  const arquivo = el("input", {
    type: "file",
    accept: "image/*,application/pdf,.csv,.xlsx,.xls",
  });

  const resultado = el("div", { classe: "pilha", style: "margin-top:14px" });

  const botaoLer = el("button", {
    classe: "btn btn-primario",
    type: "button",
    texto: "Ler e conferir",
    onclick: ler,
  });

  // Recolhido por padrão: quem já cadastra à mão não precisa tropeçar nisto,
  // e quem tem doze shows para lançar abre uma vez e usa sempre.
  const corpo = el("div", { hidden: true, style: "margin-top:12px" }, [
    el("p", {
      classe: "muted",
      texto:
        "Cole o texto da agenda (WhatsApp, e-mail, o que for) ou mande a foto do cartaz, a planilha ou o PDF. A IA monta a lista e você confere antes de gravar.",
    }),
    el("div", { classe: "campo campo-largo", style: "margin-top:10px" }, [
      el("label", { texto: "Texto da agenda" }),
      texto,
    ]),
    el("div", { classe: "campo campo-largo" }, [
      el("label", { texto: "Ou um arquivo (foto, PDF, Excel, CSV)" }),
      arquivo,
    ]),
    el("div", { classe: "linha-campos", style: "margin-top:10px" }, [botaoLer]),
    resultado,
  ]);

  const alternar = el("button", {
    classe: "btn btn-peq",
    type: "button",
    texto: "Abrir",
    onclick: () => {
      corpo.hidden = !corpo.hidden;
      alternar.textContent = corpo.hidden ? "Abrir" : "Fechar";
    },
  });

  return el("section", { classe: "cartao" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "Cadastro rápido com IA" }),
        el("p", { classe: "muted", texto: "Cole o texto ou mande a foto — a IA transforma em programação." }),
      ]),
      alternar,
    ]),
    corpo,
  ]);

  async function ler() {
    const escrito = texto.value.trim();
    const anexo = arquivo.files?.[0] ?? null;
    if (!escrito && !anexo) {
      avisar("Cole o texto da agenda ou escolha um arquivo.", "erro");
      return;
    }

    botaoLer.disabled = true;
    botaoLer.textContent = "Lendo…";
    limpar(resultado).append(
      el("p", { classe: "muted", texto: "Lendo o material… foto e PDF demoram alguns segundos." }),
    );

    try {
      const base = `/v1/venues/${ctx.venue}/programacao/ler`;
      const lido = anexo
        ? await postArquivo(
            `${base}?media_type=${encodeURIComponent(anexo.type || "application/octet-stream")}`,
            anexo,
          )
        : await post(base, { texto: escrito });
      mostrarConferencia(lido);
    } catch (e) {
      limpar(resultado).append(
        vazio("Não consegui ler", e.message),
        el("p", {
          classe: "muted",
          texto: "Tente colar o texto em vez do arquivo, ou cadastre à mão no formulário abaixo.",
        }),
      );
    } finally {
      botaoLer.disabled = false;
      botaoLer.textContent = "Ler e conferir";
    }
  }

  /**
   * A tela de conferência.
   *
   * Tudo editável: a IA erra o ano do cartaz que não traz ano, troca 20h por
   * 2h numa foto tremida, e chama de "evento" o que a casa chama de "música".
   * Corrigir aqui custa um clique; corrigir depois custa achar o evento na
   * agenda e cadastrar de novo.
   */
  function mostrarConferencia(lido) {
    limpar(resultado);

    if (lido.avisos?.length) {
      resultado.append(
        el("div", { classe: "aviso aviso-alerta" }, [
          el("strong", { texto: "O que eu não consegui ler:" }),
          el("ul", { style: "margin:6px 0 0;padding-left:18px" }, lido.avisos.map((a) => el("li", { texto: a }))),
        ]),
      );
    }

    if (!lido.eventos?.length) {
      resultado.append(
        el("p", { classe: "muted", texto: "Nenhum evento foi reconhecido. Use o formulário abaixo para cadastrar à mão." }),
      );
      return;
    }

    // Uma linha por evento, com os campos dentro da própria célula: a lista
    // inteira cabe na tela e a conferência vira leitura de cima a baixo,
    // contra o material original.
    const linhas = lido.eventos.map((ev) => {
      const marca = el("input", { type: "checkbox", checked: true });
      const campos = {
        titulo: el("input", { value: ev.titulo, style: "width:100%;min-width:180px" }),
        tipo: el(
          "select",
          { classe: "campo-celula" },
          TIPOS.map(([v, r]) => el("option", { value: v, texto: r, selected: v === ev.tipo })),
        ),
        data: el("input", { type: "date", value: ev.data, classe: "campo-celula", style: "width:140px" }),
        inicio: el("input", { type: "time", value: ev.inicio, classe: "campo-celula", style: "width:100px" }),
        fim: el("input", { type: "time", value: ev.fim ?? "", classe: "campo-celula", style: "width:100px" }),
        couvert: el("input", {
          type: "number", min: "0", step: "0.01", value: ev.couvert ?? "",
          classe: "campo-celula", style: "width:90px", placeholder: "—",
        }),
      };
      const tr = el("tr", {}, [
        el("td", {}, [marca]),
        el("td", {}, [campos.titulo]),
        el("td", {}, [campos.tipo]),
        el("td", {}, [campos.data]),
        el("td", {}, [campos.inicio]),
        el("td", {}, [campos.fim]),
        el("td", { classe: "col-num" }, [campos.couvert]),
      ]);
      return { tr, marca, campos, descricao: ev.descricao ?? null };
    });

    const contador = el("span", { classe: "muted" });
    function recontar() {
      const n = linhas.filter((l) => l.marca.checked).length;
      contador.textContent = n === 1 ? "1 evento selecionado" : `${n} eventos selecionados`;
      botaoGravar.disabled = n === 0;
    }
    for (const l of linhas) l.marca.addEventListener("change", recontar);

    const botaoGravar = el("button", {
      classe: "btn btn-primario",
      type: "button",
      texto: "Cadastrar na agenda",
      onclick: () => gravar(linhas, botaoGravar),
    });

    resultado.append(
      el("div", { classe: "rolagem-x" }, [
        el("table", { classe: "planilha" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { texto: "" }),
              el("th", { texto: "Atração" }),
              el("th", { texto: "Tipo" }),
              el("th", { texto: "Data" }),
              el("th", { texto: "Início" }),
              el("th", { texto: "Fim" }),
              el("th", { classe: "col-num", texto: "Couvert" }),
            ]),
          ]),
          el("tbody", {}, linhas.map((l) => l.tr)),
        ]),
      ]),
      el("div", { classe: "linha-campos", style: "align-items:center;margin-top:10px" }, [
        botaoGravar,
        contador,
      ]),
    );
    recontar();
  }

  async function gravar(linhas, botao) {
    const escolhidos = linhas.filter((l) => l.marca.checked);
    const eventos = escolhidos.map((l) => ({
      titulo: l.campos.titulo.value.trim(),
      tipo: l.campos.tipo.value,
      data: l.campos.data.value,
      inicio: l.campos.inicio.value,
      fim: l.campos.fim.value || null,
      descricao: l.descricao,
      couvert: l.campos.couvert.value ? Number(l.campos.couvert.value) : null,
    }));

    const semNome = eventos.filter((e) => !e.titulo || !e.data || !e.inicio);
    if (semNome.length > 0) {
      avisar("Tem linha sem nome, data ou horário. Preencha ou desmarque.", "erro");
      return;
    }

    botao.disabled = true;
    botao.textContent = "Cadastrando…";
    try {
      const r = await post(`/v1/venues/${ctx.venue}/programacao/importar`, { eventos });
      const partes = [`${r.criados} ${r.criados === 1 ? "evento cadastrado" : "eventos cadastrados"}`];
      // Repetido não é erro: é o cartaz mandado duas vezes, e dizer isso evita
      // a suspeita de que o cadastro não funcionou.
      if (r.repetidos > 0) partes.push(`${r.repetidos} já estava${r.repetidos === 1 ? "" : "m"} na agenda`);
      avisar(`${partes.join(" · ")}.`, "ok");
      for (const a of r.avisos ?? []) avisar(a, "erro");
      limpar(resultado);
      texto.value = "";
      arquivo.value = "";
      await aoGravar();
    } catch (e) {
      avisar(e.message, "erro");
    } finally {
      botao.disabled = false;
      botao.textContent = "Cadastrar na agenda";
    }
  }
}
