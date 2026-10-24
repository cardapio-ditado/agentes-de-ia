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

/** O link para a própria pessoa preencher a ficha e mandar os documentos. */
function botaoDeConvite(ctx, id, ficha, nome) {
  return el("button", {
    classe: "btn btn-peq",
    type: "button",
    texto: "📲 Pedir para a pessoa preencher",
    title: `Manda para ${nome} um link para preencher os próprios dados e a foto dos documentos`,
    onclick: async (e) => {
      const temTelefone = Boolean(ficha?.telefone);
      const enviar = temTelefone && confirm(`Mandar o link no WhatsApp de ${nome}? (Cancelar só copia o link para você mandar.)`);
      e.target.disabled = true;
      try {
        const r = await post(`/v1/venues/${ctx.venue}/rh/${id}/convite`, { enviar });
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
