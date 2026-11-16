import { del, get, patch, post } from "../api.js";
import { ICONES, avisar, botaoVoltar, campoDeBusca, campoDeFormulario, comIcone, dinheiro, el, esqueleto, estadoDeErro, etiqueta, indicador, limpar, tabelaDeDados, vazio } from "../ui.js";
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
    limpar(conteudo).append(esqueleto({ cartoes: 4, linhas: 8 }));
    let itens, categorias, listaFornecedores;
    try {
      [itens, categorias, listaFornecedores] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/insumos`),
        get(`/v1/venues/${ctx.venue}/categorias`),
        get(`/v1/venues/${ctx.venue}/fornecedores`),
      ]);
    } catch (e) {
      limpar(conteudo).append(estadoDeErro("Não foi possível carregar os cadastros", e.message, desenhar));
      return;
    }
    limpar(conteudo);

    const corpo = el("div", {});
    const abas = el("div", { classe: "abas" }, [
      botaoAba("itens", "Itens", itens.length),
      botaoAba("categorias", "Categorias", categorias.length),
      botaoAba("fornecedores", "Fornecedores", listaFornecedores.length),
    ]);

    conteudo.append(el("section", { classe: "pilha" }, [abas, corpo]));
    desenharAba();

    function botaoAba(id, rotulo, quantos) {
      return el(
        "button",
        {
          classe: `aba ${abaAtiva === id ? "aba-ativa" : ""}`.trim(),
          type: "button",
          onclick: () => {
            abaAtiva = id;
            desenhar();
          },
        },
        [document.createTextNode(rotulo), el("span", { classe: "aba-contador", texto: String(quantos) })],
      );
    }

    function desenharAba() {
      limpar(corpo);
      // Cada aba põe as suas ações no cabeçalho; começa limpo.
      ctx.definirAcoes();
      if (abaAtiva === "itens") abaItens();
      else if (abaAtiva === "categorias") abaCategorias();
      else fornecedores(corpo, ctx);
    }

    /* ================= Itens ================= */

    function abaItens() {
      const norm = (t) => (t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const abaixoDoMinimo = (i) => i.estoqueMinimo !== null && i.saldo < i.estoqueMinimo;
      let textoDaBusca = "";
      const filtroCategoria = el(
        "select",
        { classe: "select", "aria-label": "Categoria" },
        [
          el("option", { value: "", texto: "Todas as categorias" }),
          ...categorias.map((c) => el("option", { value: c.nome, texto: c.nome })),
          el("option", { value: "__sem", texto: "Sem categoria" }),
          el("option", { value: "__comprar", texto: "Abaixo do mínimo" }),
        ],
      );
      const lista = el("div", {});
      const num = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

      const desenharLinhas = () => {
        const alvo = norm(textoDaBusca.trim());
        const cat = filtroCategoria.value;
        let filtrados = itens;
        if (alvo) filtrados = filtrados.filter((i) => i.nomeNormalizado.includes(alvo) || norm(i.codigo).includes(alvo));
        if (cat === "__sem") filtrados = filtrados.filter((i) => !i.categoria);
        else if (cat === "__comprar") filtrados = filtrados.filter(abaixoDoMinimo);
        else if (cat) filtrados = filtrados.filter((i) => i.categoria === cat);

        limpar(lista);
        if (filtrados.length === 0) {
          lista.append(
            itens.length === 0
              ? vazio("Nenhum item cadastrado", "Cadastre o que a casa compra: carne, cerveja, óleo, detergente.", botaoNovoItem())
              : vazio("Nenhum item com esse filtro", "Mude a busca ou a categoria para ver os outros itens."),
          );
          return;
        }
        lista.append(
          tabelaDeDados({
            colunas: [
              { rotulo: "Item", principal: true },
              { rotulo: "Categoria", largura: "20%" },
              { rotulo: "Saldo", num: true, largura: "130px" },
              { rotulo: "Mínimo", num: true, largura: "120px" },
              { rotulo: "Custo médio", num: true, largura: "140px" },
              { rotulo: "Situação", largura: "190px", semRotulo: true },
            ],
            linhas: filtrados.map((i) => ({
              aoClicar: () => formularioItem(i),
              celulas: [
                el("span", {}, [document.createTextNode(i.nome), i.codigo ? el("small", { texto: `cód. ${i.codigo}` }) : null]),
                i.categoria || null,
                abaixoDoMinimo(i) ? el("span", { classe: "erro", style: "font-weight:600", texto: `${num(i.saldo)} ${i.unidade}` }) : `${num(i.saldo)} ${i.unidade}`,
                i.estoqueMinimo !== null ? `${num(i.estoqueMinimo)} ${i.unidade}` : null,
                dinheiro(i.custoMedio),
                abaixoDoMinimo(i) || i.entraNoCmv === false
                  ? el("span", { style: "display:inline-flex;gap:4px;flex-wrap:wrap" }, [
                      abaixoDoMinimo(i) ? etiqueta("Comprar", "etiqueta-perigo") : null,
                      i.entraNoCmv === false ? etiqueta("Fora do CMV", "etiqueta-alerta") : null,
                    ])
                  : null,
              ],
            })),
          }),
        );
      };
      filtroCategoria.addEventListener("change", desenharLinhas);

      const botaoNovoItem = () =>
        el("button", { classe: "btn btn-primario", type: "button", onclick: () => formularioItem(null) }, comIcone(ICONES.mais, "Novo item"));
      ctx.definirAcoes(botaoNovoItem());

      const paraComprar = itens.filter(abaixoDoMinimo).length;
      const semCategoria = itens.filter((i) => !i.categoria).length;
      const foraDoCmv = itens.filter((i) => i.entraNoCmv === false).length;

      corpo.append(
        el("div", { classe: "pilha" }, [
          el("div", { classe: "grade" }, [
            indicador({ rotulo: "Itens cadastrados", valor: String(itens.length), nota: `em ${categorias.length} ${categorias.length === 1 ? "categoria" : "categorias"}`, iconePath: ICONES.caixa, cor: "areia" }),
            indicador({ rotulo: "Abaixo do mínimo", valor: String(paraComprar), nota: paraComprar > 0 ? "entram na sugestão de pedido" : "nada para comprar agora", iconePath: ICONES.alerta, cor: "marca", tom: paraComprar > 0 ? "alerta" : undefined }),
            indicador({ rotulo: "Sem categoria", valor: String(semCategoria), nota: semCategoria > 0 ? "ficam fora dos agrupamentos" : "todos agrupados", iconePath: ICONES.organizacao, cor: "musgo" }),
            indicador({ rotulo: "Fora do CMV", valor: String(foraDoCmv), nota: "limpeza, descartáveis, uso da casa", iconePath: ICONES.cifrao, cor: "pinho" }),
          ]),
          el("div", { classe: "barra-filtros" }, [
            campoDeBusca({
              rotulo: "Buscar item por nome ou código",
              placeholder: "Buscar por nome ou código…",
              atalho: true,
              aoMudar: (texto) => {
                textoDaBusca = texto;
                desenharLinhas();
              },
            }),
            filtroCategoria,
          ]),
          lista,
        ]),
      );
      desenharLinhas();
    }

    function formularioItem(existente) {
      limpar(corpo);
      ctx.definirAcoes();
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
        campoDeFormulario(rotulo, campo, { ajuda });

      corpo.append(
        el("section", { classe: "cartao formulario pilha" }, [
          el("div", { classe: "cabecalho-secao" }, [
            el("h2", { texto: existente ? `Editar ${existente.nome}` : "Novo item" }),
            botaoVoltar(desenhar),
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
              el("strong", { texto: "Entra no CMV" }),
              el("small", {
                classe: "muted",
                texto: "Desmarque para limpeza, descartáveis e escritório: passam pelo estoque, mas não são custo de mercadoria.",
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
                  texto: "Excluir item",
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
              texto: "Criar categoria",
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
