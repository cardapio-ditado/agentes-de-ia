import { del, post, put } from "../api.js";
import { avisar, dinheiro, el, etiqueta, limpar } from "../ui.js";
import { botaoDePdf, dataBr, imprimirRelatorio } from "../relatorio.js";

/**
 * RH — a pessoa por inteiro, dentro da ficha (Rodada A).
 *
 * O topo da ficha responde "como esta pessoa está?" sem abrir nada: o
 * contrato de experiência (com o prazo e os botões de decidir), a escala do
 * mês, o que o cliente acha dela e a linha do tempo de ocorrências. O resto
 * da ficha (dados, documentos) continua embaixo, para quando precisar.
 */

const NOME_DA_DECISAO = { prorrogado: "prorrogado", efetivado: "efetivado", encerrado: "encerrado" };

/** O cartão do topo: números, experiência, link para a pessoa e PDF. */
export function resumoDaPessoa({ ctx, id, pessoa, ficha, visao, documentos, aoMudar }) {
  if (!visao) return null;
  const v = visao;
  const nome = pessoa.apelido || pessoa.nome;

  const numeros = el("div", { classe: "grade", style: "margin-top:4px" }, [
    numero("Últimos 30 dias", `${v.escala_30d.trabalhou} dias`, [
      v.escala_30d.faltas ? `${v.escala_30d.faltas} falta(s)` : "sem falta",
      v.escala_30d.atrasos ? `${v.escala_30d.atrasos} atraso(s)` : null,
      v.escala_30d.atestados ? `${v.escala_30d.atestados} atestado(s)` : null,
    ].filter(Boolean).join(" · ")),
    numero(
      "O que o cliente acha",
      v.cliente.media === null ? "—" : `${String(v.cliente.media).replace(".", ",")} ★`,
      v.cliente.avaliacoes ? `${v.cliente.avaliacoes} avaliação(ões) na pesquisa` : "ainda sem avaliação de cliente",
    ),
    numero("Reconhecimento", String(v.contagem.elogios), `elogio(s) · ${v.contagem.feedbacks} feedback(s)`),
    numero(
      "Registro formal",
      String(v.contagem.advertencias + v.contagem.suspensoes),
      v.contagem.advertencias + v.contagem.suspensoes ? `${v.contagem.advertencias} advertência(s) · ${v.contagem.suspensoes} suspensão(ões)` : "nenhuma advertência",
      v.contagem.advertencias + v.contagem.suspensoes > 0,
    ),
  ]);

  return el("section", { classe: "cartao pilha" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("h3", { texto: "Resumo" }),
      el("div", { classe: "reserva-acoes" }, [
        botaoDeConvite(ctx, id, ficha, nome),
        botaoDePdf(() => fichaEmPdf({ pessoa, ficha, visao, documentos }), "Ficha em PDF"),
      ]),
    ]),
    cartaoDaExperiencia(ctx, id, v.experiencia, nome, aoMudar),
    numeros,
  ].filter(Boolean));
}

function numero(rotulo, valor, nota, alerta = false) {
  return el("div", { classe: `indicador${alerta ? " indicador-destaque" : ""}` }, [
    el("div", { classe: "indicador-rotulo" }, [el("span", { texto: rotulo })]),
    el("div", { classe: "indicador-valor", texto: valor }),
    nota ? el("div", { classe: "indicador-nota", texto: nota }) : null,
  ]);
}

/**
 * O contrato de experiência. Só aparece enquanto há o que decidir: depois
 * de efetivado vira uma linha de histórico na ficha, e não um cartão.
 */
function cartaoDaExperiencia(ctx, id, exp, nome, aoMudar) {
  if (!exp || exp.fase === "fim") return null;
  const decidir = (decisao, texto) =>
    el("button", {
      classe: `btn btn-peq${decisao === "efetivado" ? " btn-primario" : decisao === "encerrado" ? " btn-perigo" : ""}`,
      type: "button",
      texto,
      onclick: async (e) => {
        const pergunta = {
          prorrogado: `Prorrogar a experiência de ${nome} para o segundo período (até ${dataBr(exp.segundo_vence)})?`,
          efetivado: `Efetivar ${nome}? O contrato passa a ser por tempo indeterminado.`,
          encerrado: `Encerrar a experiência de ${nome}? Lembre de fazer o desligamento e avisar a contabilidade.`,
        }[decisao];
        if (!confirm(pergunta)) return;
        e.target.disabled = true;
        try {
          await put(`/v1/venues/${ctx.venue}/rh/${id}/experiencia`, { decisao });
          avisar(`Experiência: ${NOME_DA_DECISAO[decisao]}.`, "ok");
          await aoMudar();
        } catch (err) {
          avisar(err.message, "erro");
          e.target.disabled = false;
        }
      },
    });

  const dias = exp.dias_para_vencer;
  const frase = exp.venceu_sem_decisao
    ? `O ${exp.fase === "primeiro" ? "primeiro" : "segundo"} período venceu em ${dataBr(exp.vence_em)} e ninguém decidiu. Na prática ${nome} já está efetivado — registre a decisão.`
    : `${exp.fase === "primeiro" ? "Primeiro" : "Segundo"} período vence em ${dataBr(exp.vence_em)} (${dias === 0 ? "hoje" : `em ${dias} dia(s)`}).`;

  return el("div", { classe: `cartao ${exp.alerta ? "alerta" : ""}`.trim(), style: "padding:12px" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("strong", { texto: "Contrato de experiência" }),
        el("p", { classe: "muted", style: "margin:2px 0 0", texto: frase }),
      ]),
      exp.alerta ? etiqueta(exp.venceu_sem_decisao ? "venceu" : "decidir agora", exp.venceu_sem_decisao ? "etiqueta-perigo" : "etiqueta-alerta") : etiqueta("em andamento", ""),
    ]),
    el("div", { classe: "reserva-acoes" }, [
      exp.fase === "primeiro" && exp.segundo_vence ? decidir("prorrogado", "Prorrogar") : null,
      decidir("efetivado", "Efetivar"),
      decidir("encerrado", "Encerrar"),
    ].filter(Boolean)),
  ]);
}

/**
 * O link para a própria pessoa: preencher a ficha (tipo "ficha") ou
 * responder o DISC (tipo "disc"). Com telefone na ficha, pergunta se vai
 * direto no WhatsApp dela; sem, copia o link.
 */
function botaoDeConvite(ctx, id, ficha, nome, tipo = "ficha", texto = "📲 Pedir para a pessoa preencher") {
  return el("button", {
    classe: "btn btn-peq",
    type: "button",
    texto,
    title: tipo === "disc"
      ? `Manda para ${nome} o link do teste DISC (24 perguntas, 5 minutos)`
      : `Manda para ${nome} um link para preencher os próprios dados e a foto dos documentos`,
    onclick: async (e) => {
      const temTelefone = Boolean(ficha?.telefone);
      const enviar = temTelefone && confirm(`Mandar o link no WhatsApp de ${nome}? (Cancelar só copia o link para você mandar.)`);
      e.target.disabled = true;
      try {
        const r = await post(`/v1/venues/${ctx.venue}/rh/${id}/convite`, { enviar, tipo });
        if (r.enviado_para) {
          avisar(`Link enviado no WhatsApp de ${nome}. Vale 7 dias.`, "ok");
        } else {
          await navigator.clipboard?.writeText(r.link).catch(() => {});
          prompt(`Link copiado. Mande para ${nome} (vale 7 dias):`, r.link);
        }
      } catch (err) {
        avisar(err.message, "erro");
      } finally {
        e.target.disabled = false;
      }
    },
  });
}

/* ================= Ocorrências ================= */

const COR_DO_TIPO = {
  elogio: "etiqueta-ok",
  elogio_cliente: "etiqueta-ok",
  feedback: "etiqueta-alerta",
  conversa: "",
  atraso: "etiqueta-alerta",
  falta: "etiqueta-alerta",
  advertencia: "etiqueta-perigo",
  suspensao: "etiqueta-perigo",
};

/**
 * A linha do tempo da pessoa e o formulário de registrar. Elogio e feedback
 * em dez segundos; advertência e suspensão pedem o motivo por escrito e saem
 * em PDF para assinar.
 */
export function secaoDeOcorrencias({ ctx, id, pessoa, ficha, visao, aoMudar }) {
  if (!visao) return null;
  const tipos = (visao.tipos_de_ocorrencia ?? []).filter((t) => t.id !== "elogio_cliente");
  const nomeDo = Object.fromEntries((visao.tipos_de_ocorrencia ?? []).map((t) => [t.id, t.nome]));

  const tipo = el("select", { classe: "select" }, tipos.map((t) => el("option", { value: t.id, texto: t.nome })));
  const dia = el("input", { classe: "input", type: "date", value: new Date().toLocaleDateString("en-CA") });
  const descricao = el("input", { classe: "input", type: "text", placeholder: "O que aconteceu, em uma frase" });
  const minutos = el("input", { classe: "input", type: "number", min: "1", placeholder: "minutos" });
  const dias = el("input", { classe: "input", type: "number", min: "1", placeholder: "dias" });
  const campoMinutos = el("div", { classe: "campo", hidden: true }, [el("label", { texto: "Minutos de atraso" }), minutos]);
  const campoDias = el("div", { classe: "campo", hidden: true }, [el("label", { texto: "Dias de suspensão" }), dias]);
  const ajuda = el("p", { classe: "muted", style: "margin:0" });
  const atualizar = () => {
    campoMinutos.hidden = tipo.value !== "atraso";
    campoDias.hidden = tipo.value !== "suspensao";
    ajuda.textContent = {
      elogio: "O elogio fica na ficha e conta na avaliação. Diga também em voz alta.",
      feedback: "O ajuste combinado: o que melhorar, de forma objetiva. É o registro da conversa, não uma punição.",
      conversa: "Conversa importante que vale lembrar depois (pedido, combinado, problema pessoal).",
      atraso: "Entra no resumo do mês para a contabilidade.",
      falta: "Entra no resumo do mês. Falta com atestado: marque como atestado na escala.",
      advertencia: "Registro formal. Escreva o fato, sem adjetivo; depois gere o PDF e peça a assinatura.",
      suspensao: "Registro formal, com os dias. Gere o PDF e peça a assinatura.",
    }[tipo.value] ?? "";
  };
  tipo.addEventListener("change", atualizar);
  atualizar();

  const lista = el("div", { classe: "tabela" });
  if (!visao.ocorrencias.length) {
    lista.append(el("p", { classe: "muted", style: "padding:12px", texto: "Nada registrado ainda. Comece por um elogio." }));
  }
  for (const o of visao.ocorrencias) {
    const formal = o.tipo === "advertencia" || o.tipo === "suspensao";
    lista.append(
      el("div", { classe: "linha-tabela" }, [
        el("div", { classe: "linha-principal", style: "flex:1;min-width:0" }, [
          el("span", {}, [
            etiqueta(nomeDo[o.tipo] ?? o.tipo, COR_DO_TIPO[o.tipo] ?? ""),
            el("span", { classe: "muted", texto: ` ${dataBr(o.dia)}${o.minutos ? ` · ${o.minutos} min` : ""}${o.dias ? ` · ${o.dias} dia(s)` : ""}` }),
          ]),
          o.descricao ? el("span", { texto: o.descricao, style: "white-space:normal" }) : null,
          el("small", { classe: "muted", texto: o.origem === "gerente" ? (o.criado_por ? `por ${o.criado_por}` : "") : o.criado_por ?? "automático" }),
        ]),
        el("div", { classe: "reserva-acoes", style: "margin:0" }, [
          formal ? botaoDePdf(() => advertenciaEmPdf(pessoa, ficha, o, nomeDo[o.tipo]), "PDF para assinar") : null,
          el("button", {
            classe: "btn-icone",
            type: "button",
            title: "Apagar este registro",
            texto: "🗑",
            onclick: async () => {
              if (!confirm("Apagar este registro? Ele some da linha do tempo.")) return;
              try {
                await del(`/v1/venues/${ctx.venue}/rh/${id}/ocorrencias/${o.id}`);
                await aoMudar();
              } catch (err) {
                avisar(err.message, "erro");
              }
            },
          }),
        ].filter(Boolean)),
      ]),
    );
  }

  return el("section", { classe: "cartao pilha" }, [
    el("div", {}, [
      el("h3", { texto: "Linha do tempo" }),
      el("p", { classe: "muted", texto: "Elogios, feedbacks, atrasos, faltas e registros formais. O elogio que o cliente deixa na pesquisa entra sozinho." }),
    ]),
    el("div", { classe: "grade" }, [
      el("div", { classe: "campo" }, [el("label", { texto: "O quê" }), tipo]),
      el("div", { classe: "campo" }, [el("label", { texto: "Dia" }), dia]),
      campoMinutos,
      campoDias,
    ]),
    el("div", { classe: "campo" }, [el("label", { texto: "Descrição" }), descricao]),
    ajuda,
    el("div", { classe: "reserva-acoes" }, [
      el("button", {
        classe: "btn btn-primario",
        type: "button",
        texto: "Registrar",
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            await post(`/v1/venues/${ctx.venue}/rh/${id}/ocorrencias`, {
              tipo: tipo.value,
              dia: dia.value,
              descricao: descricao.value,
              minutos: minutos.value,
              dias: dias.value,
            });
            avisar("Registrado.", "ok");
            await aoMudar();
          } catch (err) {
            avisar(err.message, "erro");
            e.target.disabled = false;
          }
        },
      }),
    ]),
    lista,
  ]);
}

/* ================= PDFs ================= */

/** A advertência (ou suspensão) no papel, com o espaço para as assinaturas. */
function advertenciaEmPdf(pessoa, ficha, o, nomeDoTipo) {
  const quem = ficha?.nome_completo || pessoa.nome;
  imprimirRelatorio({
    tipo: "RH",
    titulo: nomeDoTipo ?? "Advertência",
    periodo: dataBr(o.dia),
    secoes: [
      {
        pares: [
          ["Funcionário", quem],
          ["Função", ficha?.cargo || pessoa.funcao || "—"],
          ["CPF", ficha?.cpf ? ficha.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : "—"],
          ["Data do fato", dataBr(o.dia)],
          o.dias ? ["Dias de suspensão", String(o.dias)] : null,
        ].filter(Boolean),
      },
      {
        titulo: "O que aconteceu",
        paragrafos: [
          o.descricao ?? "",
          o.tipo === "suspensao"
            ? `Fica o(a) funcionário(a) suspenso(a) por ${o.dias} dia(s), sem remuneração, devendo retornar ao trabalho ao fim do período. A repetição da conduta poderá levar a medidas mais graves, inclusive a dispensa por justa causa.`
            : "Por esta advertência, fica o(a) funcionário(a) ciente de que a repetição da conduta poderá levar a medidas disciplinares mais graves, inclusive suspensão e dispensa por justa causa.",
        ],
      },
      {
        nota: "Se o funcionário se recusar a assinar, duas testemunhas assinam confirmando que ele recebeu a cópia.",
      },
    ],
    assinaturas: ["Funcionário (ciente)", "Pela empresa", "Testemunha", "Testemunha"],
    arquivo: `${o.tipo}-${pessoa.nome}-${o.dia}`,
  });
}

/** A ficha inteira no papel: para a pasta do funcionário e para o contador. */
function fichaEmPdf({ pessoa, ficha, visao, documentos }) {
  const f = ficha ?? {};
  const v = visao;
  imprimirRelatorio({
    tipo: "RH",
    titulo: `Ficha — ${f.nome_completo || pessoa.nome}`,
    periodo: f.admissao ? `na casa desde ${dataBr(f.admissao)}` : "",
    selos: [
      { valor: `${v.escala_30d.trabalhou}`, rotulo: "dias nos últimos 30" },
      { valor: String(v.escala_30d.faltas), rotulo: "faltas (30 dias)", ruim: v.escala_30d.faltas > 0 },
      { valor: v.cliente.media === null ? "—" : `${String(v.cliente.media).replace(".", ",")}★`, rotulo: "nota do cliente" },
      { valor: String(v.contagem.elogios), rotulo: "elogios" },
    ],
    secoes: [
      {
        titulo: "Dados",
        pares: [
          ["Nome completo", f.nome_completo || pessoa.nome],
          ["Apelido", pessoa.apelido || "—"],
          ["CPF", f.cpf ? f.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : "—"],
          ["RG", f.rg || "—"],
          ["Nascimento", f.nascimento ? dataBr(f.nascimento) : "—"],
          ["Telefone", f.telefone || "—"],
          ["Endereço", f.endereco || "—"],
          ["Emergência", [f.emergencia_nome, f.emergencia_telefone].filter(Boolean).join(" · ") || "—"],
        ],
      },
      {
        titulo: "Trabalho",
        pares: [
          ["Cargo", f.cargo || pessoa.funcao || "—"],
          ["Vínculo", (f.vinculo || "").toUpperCase() || "—"],
          ["Admissão", f.admissao ? dataBr(f.admissao) : "—"],
          ["Salário combinado", f.salario ? dinheiro(Number(f.salario)) : "—"],
          ["Recebe por", [f.forma_pagamento, f.chave_pix].filter(Boolean).join(" · ") || "—"],
          v.experiencia && v.experiencia.fase !== "fim" ? ["Experiência", `vence ${dataBr(v.experiencia.vence_em)}`] : null,
          f.consentimento_em ? ["Consentimento LGPD", dataBr(f.consentimento_em)] : null,
        ].filter(Boolean),
      },
      {
        titulo: "Documentos",
        colunas: [{ rotulo: "Documento" }, { rotulo: "Enviado" }, { rotulo: "Validade" }],
        linhas: (documentos ?? []).map((d) => [d.titulo ? `${d.tipo} — ${d.titulo}` : d.tipo, dataBr(d.enviado_em), d.validade ? dataBr(d.validade) : "—"]),
        vazio: "Nenhum documento guardado.",
      },
      {
        titulo: "Linha do tempo",
        colunas: [{ rotulo: "Dia" }, { rotulo: "O quê" }, { rotulo: "Descrição" }],
        linhas: v.ocorrencias.map((o) => ({
          destaque: o.tipo === "advertencia" || o.tipo === "suspensao",
          celulas: [dataBr(o.dia), (v.tipos_de_ocorrencia ?? []).find((t) => t.id === o.tipo)?.nome ?? o.tipo, o.descricao ?? ""],
        })),
        vazio: "Nada registrado.",
      },
      v.cliente.recentes?.length
        ? {
            titulo: "O que os clientes disseram",
            colunas: [{ rotulo: "Dia" }, { rotulo: "Nota", num: true }, { rotulo: "Comentário" }],
            linhas: v.cliente.recentes.map((r) => [dataBr(r.dia), `${r.nota}★`, r.comentario]),
          }
        : null,
    ],
    arquivo: `ficha-${pessoa.nome}`,
  });
}

/** Os dois períodos de experiência, para a seção "Trabalho" da ficha. */
export function camposDaExperiencia(ficha) {
  const p1 = el("input", { classe: "input", type: "number", min: "0", max: "90", value: ficha?.experiencia_primeiro ?? 45 });
  const p2 = el("input", { classe: "input", type: "number", min: "0", max: "90", value: ficha?.experiencia_segundo ?? 45 });
  const caixa = el("div", { classe: "grade grade-2" }, [
    el("div", { classe: "campo" }, [el("label", { texto: "Experiência — 1º período (dias)" }), p1]),
    el("div", { classe: "campo" }, [el("label", { texto: "Experiência — 2º período (dias)" }), p2]),
  ]);
  return { caixa, valores: () => ({ experiencia_primeiro: p1.value, experiencia_segundo: p2.value }) };
}

export { limpar };

/* ================= DISC ================= */

const COR_DO_FATOR = { D: "#c1121f", I: "#f4a100", S: "#1a7a4a", C: "#2563a8" };

function barrasDisc(d) {
  return el("div", { classe: "disc-barras" }, [["D", d.d], ["I", d.i], ["S", d.s], ["C", d.c]].map(([f, v]) =>
    el("div", { classe: "disc-fator" }, [
      el("strong", { texto: f }),
      el("div", { classe: "disc-trilho" }, [el("span", { style: `width:${v}%;background:${COR_DO_FATOR[f]}` })]),
      el("span", { classe: "muted", texto: String(v) }),
    ])));
}

/**
 * O perfil comportamental na ficha: o gráfico, o que o perfil quer dizer e,
 * para a liderança, como liderar e como dar feedback. A pessoa vê o próprio
 * resultado no fim do teste.
 */
export function secaoDoDisc({ ctx, id, pessoa, ficha, visao }) {
  if (!visao) return null;
  const nome = pessoa.apelido || pessoa.nome;
  const d = visao.disc;
  return el("section", { classe: "cartao pilha" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: d ? `Perfil comportamental: ${d.perfil}` : "Perfil comportamental (DISC)" }),
        el("p", {
          classe: "muted",
          texto: d
            ? `Respondido em ${dataBr(d.concluido_em)}. ${nome} viu o próprio resultado.`
            : `${nome} ainda não fez o teste. São 24 perguntas rápidas pelo celular, e no fim a pessoa vê o resultado.`,
        }),
      ]),
      botaoDeConvite(ctx, id, ficha, nome, "disc", d ? "Refazer o teste" : "📲 Mandar o teste"),
    ]),
    d ? barrasDisc(d) : null,
    ...(d?.descricao ?? []).map((f) =>
      el("div", { classe: "pilha-fina" }, [
        el("strong", { texto: f.nome }),
        el("p", { classe: "muted", style: "margin:0", texto: f.resumo }),
        linhaDisc("Onde brilha", f.fortes),
        linhaDisc("Fique de olho", f.cuidado),
        linhaDisc("Como liderar", f.liderar),
        linhaDisc("Como dar feedback", f.feedback),
        linhaDisc("Tende a render em", f.rende),
      ])),
    el("p", {
      classe: "muted",
      texto: "O DISC mostra o jeito de agir, não a capacidade nem o caráter. Use para saber como falar com cada um e para montar a equipe — nunca como motivo para contratar ou demitir.",
    }),
  ].filter(Boolean));
}

function linhaDisc(rotulo, texto) {
  return el("p", { style: "margin:0" }, [el("strong", { texto: `${rotulo}: ` }), el("span", { texto })]);
}

/** O mapa DISC da equipe: quem é o quê, e o que falta na equipe. */
export function cartaoDoMapaDisc(mapa) {
  const porFator = { D: [], I: [], S: [], C: [] };
  for (const p of mapa.pessoas) porFator[p.perfil[0]]?.push(p);
  return el("section", { classe: "cartao pilha" }, [
    el("div", {}, [
      el("h3", { texto: "Mapa DISC da equipe" }),
      el("p", { classe: "muted", texto: "O fator principal de cada um. Equipe boa tem um pouco de cada jeito." }),
    ]),
    el("div", { classe: "disc-mapa" }, Object.entries(porFator).map(([f, pessoas]) =>
      el("div", { classe: "disc-quadrante", style: `border-top:4px solid ${COR_DO_FATOR[f]}` }, [
        el("strong", { texto: `${f} · ${pessoas.length}` }),
        ...pessoas.map((p) => el("span", { texto: `${p.nome} (${p.perfil})${p.funcao ? ` — ${p.funcao}` : ""}` })),
        pessoas.length ? null : el("span", { classe: "muted", texto: "ninguém" }),
      ]))),
    ...mapa.observacoes.map((o) => el("p", { classe: "aviso aviso-alerta", style: "margin:0", texto: o })),
    mapa.sem_teste.length
      ? el("p", { classe: "muted", texto: `Ainda sem teste: ${mapa.sem_teste.join(", ")}. Mande pela ficha de cada um.` })
      : null,
  ].filter(Boolean));
}

/* ================= Avaliação de desempenho ================= */

/**
 * As avaliações da pessoa e o formulário de uma nova. A nota do gestor
 * (1 a 5 por competência) fica ao lado dos números que o sistema mediu, e a
 * conversa fecha com até três combinados. Sai em PDF para a conversa.
 */
export function secaoDeAvaliacoes({ ctx, id, pessoa, ficha, visao, aoMudar }) {
  if (!visao) return null;
  const nome = pessoa.apelido || pessoa.nome;
  const comp = visao.competencias ?? [];
  const exp = visao.experiencia;
  const momentoSugerido = exp && exp.fase === "primeiro" ? "experiencia_45" : exp && exp.fase === "segundo" ? "experiencia_90" : "semestral";

  const area = el("div", {});
  const abrirFormulario = () => {
    const notas = {};
    const momento = el("select", { classe: "select" }, (visao.momentos_da_avaliacao ?? []).map((m) =>
      el("option", { value: m.id, texto: m.nome, selected: m.id === momentoSugerido })));
    const dia = el("input", { classe: "input", type: "date", value: new Date().toLocaleDateString("en-CA") });
    const linhas = comp.map((c) => {
      const botoes = [1, 2, 3, 4, 5].map((n) =>
        el("button", {
          classe: "nota-botao",
          type: "button",
          texto: String(n),
          "aria-label": `${c.nome}: ${n}`,
          onclick: () => {
            notas[c.id] = n;
            for (const b of botoes) b.classList.toggle("nota-escolhida", Number(b.textContent) === n);
          },
        }));
      return el("div", { classe: "avaliacao-linha" }, [
        el("div", {}, [el("strong", { texto: c.nome }), el("small", { classe: "muted", texto: c.ajuda })]),
        el("div", { classe: "nota-botoes" }, botoes),
      ]);
    });
    const fortes = el("textarea", { classe: "input", rows: 2, placeholder: "O que a pessoa faz muito bem" });
    const melhorar = el("textarea", { classe: "input", rows: 2, placeholder: "O que precisa melhorar, com exemplo" });
    const combinados = [1, 2, 3].map((n) => el("input", { classe: "input", placeholder: `Combinado ${n} (ex.: chegar 10 min antes no fim de semana)` }));
    const v = visao;
    limpar(area).append(
      el("div", { classe: "cartao pilha", style: "padding:14px" }, [
        el("div", { classe: "grade" }, [
          el("div", { classe: "campo" }, [el("label", { texto: "Momento" }), momento]),
          el("div", { classe: "campo" }, [el("label", { texto: "Dia" }), dia]),
        ]),
        el("p", { classe: "muted", style: "margin:0", texto:
          `Os números do período: nota do cliente ${v.cliente.media ?? "—"} · ${v.escala_30d.faltas} falta(s) e ${v.escala_30d.atrasos} atraso(s) em 30 dias · ` +
          `${v.contagem.elogios} elogio(s) · ${v.contagem.advertencias} advertência(s). Use para conversar sobre fatos.` }),
        ...linhas,
        el("div", { classe: "campo" }, [el("label", { texto: "Pontos fortes" }), fortes]),
        el("div", { classe: "campo" }, [el("label", { texto: "A melhorar" }), melhorar]),
        el("div", { classe: "campo" }, [el("label", { texto: "Até 3 combinados para o próximo período" }), ...combinados]),
        el("div", { classe: "reserva-acoes" }, [
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "Salvar avaliação",
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                await post(`/v1/venues/${ctx.venue}/rh/${id}/avaliacoes`, {
                  momento: momento.value,
                  dia: dia.value,
                  notas,
                  pontos_fortes: fortes.value,
                  melhorar: melhorar.value,
                  combinados: combinados.map((c) => c.value),
                });
                avisar("Avaliação salva. Gere o PDF para a conversa.", "ok");
                await aoMudar();
              } catch (err) {
                avisar(err.message, "erro");
                e.target.disabled = false;
              }
            },
          }),
          el("button", { classe: "btn btn-peq", type: "button", texto: "Cancelar", onclick: () => limpar(area) }),
        ]),
      ]),
    );
  };

  const nomeDoMomento = Object.fromEntries((visao.momentos_da_avaliacao ?? []).map((m) => [m.id, m.nome]));
  const lista = (visao.avaliacoes ?? []).map((a) =>
    el("div", { classe: "linha-tabela" }, [
      el("div", { classe: "linha-principal", style: "flex:1;min-width:0" }, [
        el("strong", { texto: `${nomeDoMomento[a.momento] ?? a.momento} · ${dataBr(a.dia)}` }),
        el("span", { classe: "muted", texto: `média ${String(Number(a.media).toFixed(1)).replace(".", ",")} de 5${a.avaliador ? ` · por ${a.avaliador}` : ""}` }),
        a.combinados?.length ? el("small", { classe: "muted", texto: `Combinados: ${a.combinados.join(" · ")}` }) : null,
      ]),
      el("div", { classe: "reserva-acoes", style: "margin:0" }, [
        a.conversada_em
          ? etiqueta(`conversada ${dataBr(a.conversada_em)}`, "etiqueta-ok")
          : el("button", {
              classe: "btn btn-peq",
              type: "button",
              texto: "Já conversei",
              title: "Marque depois da conversa com a pessoa",
              onclick: async () => {
                try {
                  await put(`/v1/venues/${ctx.venue}/rh/${id}/avaliacoes/${a.id}/conversada`, {});
                  await aoMudar();
                } catch (err) {
                  avisar(err.message, "erro");
                }
              },
            }),
        botaoDePdf(() => avaliacaoEmPdf(pessoa, ficha, a, comp, nomeDoMomento, visao.disc), "PDF"),
        el("button", {
          classe: "btn-icone",
          type: "button",
          title: "Apagar esta avaliação",
          texto: "🗑",
          onclick: async () => {
            if (!confirm("Apagar esta avaliação?")) return;
            try {
              await del(`/v1/venues/${ctx.venue}/rh/${id}/avaliacoes/${a.id}`);
              await aoMudar();
            } catch (err) {
              avisar(err.message, "erro");
            }
          },
        }),
      ]),
    ]));

  return el("section", { classe: "cartao pilha" }, [
    el("div", { classe: "cabecalho-secao" }, [
      el("div", {}, [
        el("h3", { texto: "Avaliação de desempenho" }),
        el("p", {
          classe: "muted",
          texto: exp && exp.fase !== "fim"
            ? `Avalie ${nome} antes de decidir a experiência — a conversa do dia ${exp.fase === "primeiro" ? "45" : "90"} é a mais importante.`
            : "Nota de 1 a 5 em cada competência, ao lado dos números do período. Depois, a conversa e os combinados.",
        }),
      ]),
      el("button", { classe: "btn btn-primario btn-peq", type: "button", texto: "+ Nova avaliação", onclick: abrirFormulario }),
    ]),
    area,
    lista.length ? el("div", { classe: "tabela" }, lista) : el("p", { classe: "muted", texto: "Nenhuma avaliação ainda." }),
  ]);
}

/** A avaliação no papel, para a conversa: notas, números, texto e combinados. */
function avaliacaoEmPdf(pessoa, ficha, a, comp, nomeDoMomento, disc) {
  const n = a.numeros ?? {};
  imprimirRelatorio({
    tipo: "RH",
    titulo: `Avaliação de desempenho — ${ficha?.nome_completo || pessoa.nome}`,
    periodo: `${nomeDoMomento[a.momento] ?? a.momento} · ${dataBr(a.dia)}`,
    selos: [
      { valor: String(Number(a.media).toFixed(1)).replace(".", ","), rotulo: "média (de 5)" },
      { valor: n.nota_do_cliente === null || n.nota_do_cliente === undefined ? "—" : `${String(n.nota_do_cliente).replace(".", ",")}★`, rotulo: "nota do cliente" },
      { valor: String(n.faltas_30d ?? 0), rotulo: "faltas (30 dias)", ruim: (n.faltas_30d ?? 0) > 0 },
      { valor: String(n.elogios ?? 0), rotulo: "elogios" },
    ],
    secoes: [
      {
        titulo: "Competências",
        colunas: [{ rotulo: "Competência" }, { rotulo: "Nota", num: true }],
        linhas: comp.map((c) => ({ destaque: (a.notas?.[c.id] ?? 0) <= 2, celulas: [c.nome, `${a.notas?.[c.id] ?? "—"} de 5`] })),
      },
      {
        titulo: "Os números do período",
        pares: [
          ["Nota dos clientes na pesquisa", n.nota_do_cliente === null || n.nota_do_cliente === undefined ? "—" : `${n.nota_do_cliente} (${n.avaliacoes_de_cliente} avaliações)`],
          ["Faltas e atrasos (30 dias)", `${n.faltas_30d ?? 0} falta(s) · ${n.atrasos_30d ?? 0} atraso(s)`],
          ["Elogios registrados", String(n.elogios ?? 0)],
          ["Advertências / suspensões", `${n.advertencias ?? 0} / ${n.suspensoes ?? 0}`],
          n.vendas_90d ? ["Vendas (90 dias)", dinheiro(Number(n.vendas_90d))] : null,
          disc ? ["Perfil DISC", disc.perfil] : null,
        ].filter(Boolean),
      },
      a.pontos_fortes ? { titulo: "Pontos fortes", paragrafos: [a.pontos_fortes] } : null,
      a.melhorar ? { titulo: "A melhorar", paragrafos: [a.melhorar] } : null,
      a.combinados?.length
        ? { titulo: "Combinados para o próximo período", colunas: [{ rotulo: "#" }, { rotulo: "Combinado" }], linhas: a.combinados.map((c, i) => [String(i + 1), c]) }
        : null,
    ],
    assinaturas: ["Funcionário", "Avaliador"],
    arquivo: `avaliacao-${pessoa.nome}-${a.dia}`,
  });
}
