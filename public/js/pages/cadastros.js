import { del, get, patch, post } from "../api.js";
import { avisar, dinheiro, el, etiqueta, limpar, vazio } from "../ui.js";
import { fornecedores } from "./fornecedores.js";

/**
 * Cadastros: itens, categorias e fornecedores — numa tela só, em abas.
 *
 * É a tela de "montar a casa": quem está cadastrando duzentos itens não pode
 * gastar um cartão gordo por item. Por isso a lista é DENSA — uma linha por
 * item, como no Gorjeta — e o formulário só abre quando se toca na linha.
 *
 * O campo que separa este módulo de uma planilha é o "entra no CMV": água
 * sanitária passa pelo estoque, mas não é custo de mercadoria vendida. Sem
 * essa marca, o CMV engorda com detergente e o dono desconfia do número —
 * e número desacreditado não muda comportamento.
 */

const UNIDADES = ["un", "kg", "g", "L", "ml", "cx", "pct", "dz", "grf", "lata"];

export async function cadastros(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);

  let abaAtiva = "itens";
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let itens, categorias, listaFornecedores;
    try {
      [itens, categorias, listaFornecedores] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/insumos`),
        get(`/v1/venues/${ctx.venue}/categorias`),
        get(`/v1/venues/${ctx.venue}/fornecedores`),
      ]);
    } catch (e) {
      limpar(conteudo).append(vazio("Cadastros indisponíveis", e.message));
      return;
    }
    limpar(conteudo);

    const corpo = el("div", {});
    const abas = el("div", { classe: "abas" }, [
      botaoAba("itens", `Itens (${itens.length})`),
      botaoAba("categorias", `Categorias (${categorias.length})`),
      botaoAba("fornecedores", `Fornecedores (${listaFornecedores.length})`),
    ]);

    conteudo.append(el("section", { classe: "pilha" }, [abas, corpo]));
    desenharAba();

    function botaoAba(id, rotulo) {
      return el("button", {
        classe: `aba ${abaAtiva === id ? "aba-ativa" : ""}`.trim(),
        type: "button",
        texto: rotulo,
        onclick: () => {
          abaAtiva = id;
          desenhar();
        },
      });
    }

    function desenharAba() {
      limpar(corpo);
      if (abaAtiva === "itens") abaItens();
      else if (abaAtiva === "categorias") abaCategorias();
      else fornecedores(corpo, ctx);
    }

    /* ================= Itens ================= */

    function abaItens() {
      const busca = el("input", { classe: "campo", placeholder: "🔍  Buscar por nome ou código…", style: "flex:2" });
      const filtroCategoria = el(
        "select",
        { classe: "select", style: "flex:1" },
        [
          el("option", { value: "", texto: "Todas as categorias" }),
          ...categorias.map((c) => el("option", { value: c.nome, texto: c.nome })),
          el("option", { value: "__sem", texto: "Sem categoria" }),
        ],
      );
      const lista = el("div", { classe: "tabela" });

      const norm = (t) => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

      const desenharLinhas = () => {
        const alvo = norm(busca.value.trim());
        const cat = filtroCategoria.value;
        let filtrados = itens;
        if (alvo) filtrados = filtrados.filter((i) => i.nomeNormalizado.includes(alvo) || norm(i.codigo).includes(alvo));
        if (cat === "__sem") filtrados = filtrados.filter((i) => !i.categoria);
        else if (cat) filtrados = filtrados.filter((i) => i.categoria === cat);

        limpar(lista);
        if (filtrados.length === 0) {
          lista.append(vazio("Nenhum item", "Cadastre o que a casa compra: carne, cerveja, óleo, detergente…"));
          return;
        }
        for (const i of filtrados) lista.append(linhaItem(i));
      };
      busca.addEventListener("input", desenharLinhas);
      filtroCategoria.addEventListener("change", desenharLinhas);

      corpo.append(
        el("div", { classe: "pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("div", {}, [
              el("h2", { texto: "Itens" }),
              el("p", { classe: "muted", texto: "Tudo que a casa compra. O saldo muda por recebimento, produção e contagem — nunca aqui." }),
            ]),
            el("button", { classe: "btn btn-primario", type: "button", texto: "+ Novo item", onclick: () => formularioItem(null) }),
          ]),
          el("div", { classe: "linha-campos" }, [busca, filtroCategoria]),
          lista,
        ]),
      );
      desenharLinhas();

      function linhaItem(i) {
        const abaixoDoMinimo = i.estoqueMinimo !== null && i.saldo < i.estoqueMinimo;
        return el("button", {
          classe: "linha-tabela",
          type: "button",
          onclick: () => formularioItem(i),
        }, [
          el("span", { classe: "linha-principal" }, [
            el("strong", { texto: i.nome }),
            el("small", {
              classe: "muted",
              texto: [i.categoria, i.codigo ? `cód ${i.codigo}` : null].filter(Boolean).join(" · "),
            }),
          ]),
          el("span", { classe: "linha-detalhes" }, [
            abaixoDoMinimo ? etiqueta("comprar", "etiqueta-perigo") : null,
            i.entraNoCmv === false ? etiqueta("fora do CMV", "etiqueta-alerta") : null,
            el("span", { classe: "muted", texto: `${i.saldo} ${i.unidade}` }),
            el("strong", { texto: dinheiro(i.custoMedio) }),
          ].filter(Boolean)),
        ]);
      }
    }

    function formularioItem(existente) {
      limpar(corpo);
      const campos = {
        nome: el("input", { classe: "campo", value: existente?.nome ?? "", placeholder: "Tilápia congelada" }),
        unidade: el(
          "select",
          { classe: "select" },
          UNIDADES.map((u) => el("option", { value: u, texto: u, selected: (existente?.unidade ?? "un") === u })),
        ),
        categoria: el(
          "select",
          { classe: "select" },
          [
            el("option", { value: "", texto: "Sem categoria" }),
            ...categorias.map((c) => el("option", { value: c.nome, texto: c.nome, selected: existente?.categoria === c.nome })),
          ],
        ),
        codigo: el("input", { classe: "campo", value: existente?.codigo ?? "", placeholder: "Código do fornecedor/PDV" }),
        minimo: el("input", { classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.001", value: existente?.estoqueMinimo ?? "" }),
        tolerancia: el("input", { classe: "campo-numero", type: "number", inputmode: "decimal", step: "0.5", min: "0", value: existente?.toleranciaPct ?? 0 }),
        fornecedor: el(
          "select",
          { classe: "select" },
          [
            el("option", { value: "", texto: "Sem fornecedor de costume" }),
            ...listaFornecedores.map((f) => el("option", { value: f.id, texto: f.nome, selected: existente?.fornecedorId === f.id })),
          ],
        ),
        entraNoCmv: el("input", { type: "checkbox", checked: existente ? existente.entraNoCmv !== false : true }),
      };

      // Se a unidade atual não está na lista fixa (cadastro antigo), preserva.
      if (existente?.unidade && !UNIDADES.includes(existente.unidade)) {
        campos.unidade.prepend(el("option", { value: existente.unidade, texto: existente.unidade, selected: true }));
      }

      const linha = (rotulo, campo, ajuda) =>
        el("label", { classe: "campo-rotulado" }, [
          el("span", { texto: rotulo }),
          campo,
          ajuda ? el("small", { classe: "muted", texto: ajuda }) : null,
        ].filter(Boolean));

      corpo.append(
        el("section", { classe: "cartao pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("h2", { texto: existente ? `Editar ${existente.nome}` : "Novo item" }),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
          ]),
          linha("Nome", campos.nome),
          el("div", { classe: "linha-campos" }, [
            linha("Unidade", campos.unidade),
            linha("Categoria", campos.categoria),
          ]),
          linha("Código", campos.codigo, "O da nota do fornecedor. Com ele, a foto casa sozinha."),
          el("div", { classe: "linha-campos" }, [
            linha("Estoque mínimo", campos.minimo, "Abaixo disso, entra na sugestão de compra."),
            linha("Tolerância de entrega (%)", campos.tolerancia, "Carne pesada: 2–3%. Lata: 0."),
          ]),
          linha("Fornecedor de costume", campos.fornecedor, "Agrupa a sugestão de compra em pedidos prontos."),
          el("label", { classe: "campo-caixa" }, [
            campos.entraNoCmv,
            el("span", {}, [
              el("strong", { texto: " Entra no CMV" }),
              el("small", {
                classe: "muted",
                texto: " — desmarque para limpeza, descartáveis e escritório: passam pelo estoque, mas não são custo de mercadoria.",
              }),
            ]),
          ]),
          el("div", { classe: "linha-campos" }, [
            el("button", {
              classe: "btn btn-primario",
              type: "button",
              texto: "Salvar",
              onclick: async () => {
                if (campos.nome.value.trim().length < 2) return avisar("Dê um nome ao item.", "erro");
                try {
                  const corpoReq = {
                    nome: campos.nome.value,
                    unidade: campos.unidade.value,
                    categoria: campos.categoria.value || null,
                    codigo: campos.codigo.value || null,
                    estoque_minimo: campos.minimo.value === "" ? null : Number(campos.minimo.value),
                    tolerancia_pct: Number(campos.tolerancia.value || 0),
                    fornecedor_id: campos.fornecedor.value || null,
                    entra_no_cmv: campos.entraNoCmv.checked,
                  };
                  if (existente) {
                    await patch(`/v1/venues/${ctx.venue}/insumos/${existente.id}`, corpoReq);
                  } else {
                    const r = await post(`/v1/venues/${ctx.venue}/insumos`, corpoReq);
                    if (!r.criado) {
                      avisar("Esse item já estava cadastrado — atualizando o existente.", "info");
                      await patch(`/v1/venues/${ctx.venue}/insumos/${r.insumo.id}`, corpoReq);
                    } else {
                      // O POST cria com o básico; o resto vai por PATCH.
                      await patch(`/v1/venues/${ctx.venue}/insumos/${r.insumo.id}`, corpoReq);
                    }
                  }
                  avisar("Item salvo.", "ok");
                  desenhar();
                } catch (e) {
                  avisar(e.message, "erro");
                }
              },
            }),
            existente
              ? el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: "Desativar item",
                  onclick: async () => {
                    if (!confirm(`Desativar ${existente.nome}? Ele some das telas e o histórico fica.`)) return;
                    try {
                      await patch(`/v1/venues/${ctx.venue}/insumos/${existente.id}`, { ativo: false });
                      desenhar();
                    } catch (e) {
                      avisar(e.message, "erro");
                    }
                  },
                })
              : null,
            existente
              ? el("button", {
                  classe: "btn btn-peq",
                  type: "button",
                  texto: "🗑 Excluir item",
                  onclick: async () => {
                    if (!confirm(`Excluir ${existente.nome} DE VEZ? Só funciona para item sem movimento no estoque — com histórico, use Desativar.`)) return;
                    try {
                      await del(`/v1/venues/${ctx.venue}/insumos/${existente.id}`);
                      avisar("Item excluído.", "ok");
                      desenhar();
                    } catch (e) {
                      avisar(e.message, "erro");
                    }
                  },
                })
              : null,
          ].filter(Boolean)),
        ]),
      );
    }

    /* ================= Categorias ================= */

    function abaCategorias() {
      const porCategoria = new Map();
      for (const i of itens) {
        if (!i.categoria) continue;
        porCategoria.set(i.categoria, (porCategoria.get(i.categoria) ?? 0) + 1);
      }

      const nome = el("input", { classe: "campo", placeholder: "Bebidas, Carnes, Hortifrúti, Limpeza…" });

      corpo.append(
        el("div", { classe: "pilha" }, [
          el("div", {}, [
            el("h2", { texto: "Categorias" }),
            el("p", { classe: "muted", texto: "Etiquetas para agrupar os itens — cada casa agrupa do seu jeito." }),
          ]),
          el("div", { classe: "linha-campos" }, [
            nome,
            el("button", {
              classe: "btn btn-primario",
              type: "button",
              texto: "+ Criar",
              onclick: async () => {
                if (nome.value.trim().length < 2) return avisar("Dê um nome à categoria.", "erro");
                try {
                  const r = await post(`/v1/venues/${ctx.venue}/categorias`, { nome: nome.value });
                  if (!r.criada) avisar("Essa categoria já existia.", "info");
                  desenhar();
                } catch (e) {
                  avisar(e.message, "erro");
                }
              },
            }),
          ]),
          el("div", { classe: "tabela" },
            categorias.length === 0
              ? [vazio("Nenhuma categoria", "Crie as suas — Bebidas, Carnes, Limpeza — e marque os itens no cadastro.")]
              : categorias.map((c) =>
                  el("div", { classe: "linha-tabela" }, [
                    el("span", { classe: "linha-principal" }, [
                      el("strong", { texto: c.nome }),
                      el("small", { classe: "muted", texto: `${porCategoria.get(c.nome) ?? 0} item(ns)` }),
                    ]),
                    el("button", {
                      classe: "btn btn-peq",
                      type: "button",
                      texto: "Excluir",
                      onclick: async () => {
                        const usados = porCategoria.get(c.nome) ?? 0;
                        const aviso = usados > 0
                          ? `Excluir ${c.nome}? Os ${usados} item(ns) dela ficam SEM categoria — nenhum item é apagado.`
                          : `Excluir ${c.nome}?`;
                        if (!confirm(aviso)) return;
                        try {
                          await del(`/v1/venues/${ctx.venue}/categorias/${c.id}`);
                          desenhar();
                        } catch (e) {
                          avisar(e.message, "erro");
                        }
                      },
                    }),
                  ]),
                ),
          ),
        ]),
      );
    }
  }
}
