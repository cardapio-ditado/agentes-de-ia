import { get, patch, post } from "../api.js";
import { avisar, buscador, el, limpar, vazio } from "../ui.js";
import { abrirKardex } from "./kardex.js";

/**
 * Fornecedores.
 *
 * O campo que trabalha aqui é o CICLO: "entrega a cada 7 dias" é o que
 * transforma consumo médio em quantidade a pedir na sugestão de compra. O
 * resto (CNPJ, telefone) é agenda — útil, mas não é por ele que a tela
 * existe.
 *
 * Cada insumo pode apontar seu fornecedor de costume; é isso que agrupa a
 * sugestão em pedidos prontos, um por fornecedor.
 */

export async function fornecedores(raiz, ctx) {
  const conteudo = el("div", {});
  raiz.append(conteudo);
  await desenhar();

  async function desenhar() {
    limpar(conteudo).append(el("p", { classe: "muted", texto: "Carregando…" }));
    let lista, insumos;
    try {
      [lista, insumos] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/fornecedores`),
        get(`/v1/venues/${ctx.venue}/insumos`),
      ]);
    } catch (e) {
      limpar(conteudo).append(vazio("Fornecedores indisponíveis", e.message));
      return;
    }
    limpar(conteudo);

    conteudo.append(
      el("section", { classe: "pilha" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Fornecedores" }),
            el("p", { classe: "muted", texto: "O ciclo de entrega alimenta a sugestão de compra." }),
          ]),
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "+ Novo fornecedor",
            onclick: () => formulario(null),
          }),
        ]),
        el("div", { classe: "lista" },
          lista.length === 0
            ? [vazio("Nenhum fornecedor", "Cadastre de quem a casa compra — leva um minuto.")]
            : lista.map((f) =>
                el("article", { classe: "cartao" }, [
                  el("div", { classe: "cabecalho-secao" }, [
                    el("div", {}, [
                      el("strong", { texto: f.nome }),
                      el("p", {
                        classe: "muted",
                        texto: `entrega a cada ${f.cicloCompraDias} dia(s)${f.telefone ? ` · ${f.telefone}` : ""}`,
                      }),
                    ]),
                    el("div", { classe: "linha-campos" }, [
                      // Atalho: pula para a página Kardex já neste fornecedor.
                      el("button", { classe: "btn btn-peq", type: "button", texto: "Kardex", onclick: () => abrirKardex({ aba: "fornecedor", id: f.id, nome: f.nome }) }),
                      el("button", { classe: "btn btn-peq", type: "button", texto: "Editar", onclick: () => formulario(f) }),
                    ]),
                  ]),
                ]),
              ),
        ),
      ]),
    );

    function formulario(existente) {
      limpar(conteudo);
      const campos = {
        nome: el("input", { classe: "campo", value: existente?.nome ?? "", placeholder: "Atacadão, Açougue Central…" }),
        ciclo: el("input", { classe: "campo-numero", type: "number", inputmode: "numeric", min: "1", max: "60", value: existente?.cicloCompraDias ?? 7 }),
        telefone: el("input", { classe: "campo", value: existente?.telefone ?? "", placeholder: "(65) 9 9999-9999" }),
        email: el("input", { classe: "campo", type: "email", value: existente?.email ?? "" }),
        cnpj: el("input", { classe: "campo", value: existente?.cnpj ?? "" }),
        obs: el("input", { classe: "campo", value: existente?.observacoes ?? "", placeholder: "Pedido mínimo, prazo, contato…" }),
      };
      const linha = (rotulo, campo, ajuda) =>
        el("label", { classe: "campo-rotulado" }, [
          el("span", { texto: rotulo }),
          campo,
          ajuda ? el("small", { classe: "muted", texto: ajuda }) : null,
        ].filter(Boolean));

      // Amarrar os insumos ao fornecedor aqui, na mesma tela: é agora que a
      // pessoa está pensando "o que eu compro dele?".
      const doFornecedor = existente
        ? insumos.filter((i) => i.fornecedorId === existente.id)
        : [];
      const listaVinculos = el("div", { classe: "lista" });
      const desenharVinculos = () => {
        limpar(listaVinculos);
        for (const i of doFornecedor) {
          listaVinculos.append(
            el("div", { classe: "cabecalho-secao" }, [
              el("span", { texto: i.nome }),
              el("button", {
                classe: "btn btn-peq", type: "button", texto: "×",
                onclick: async () => {
                  try {
                    await patch(`/v1/venues/${ctx.venue}/insumos/${i.id}`, { fornecedor_id: null });
                    doFornecedor.splice(doFornecedor.indexOf(i), 1);
                    desenharVinculos();
                  } catch (e) { avisar(e.message, "erro"); }
                },
              }),
            ]),
          );
        }
      };

      conteudo.append(
        el("section", { classe: "cartao pilha" }, [
          el("h2", { texto: existente ? `Editar ${existente.nome}` : "Novo fornecedor" }),
          linha("Nome", campos.nome),
          linha("Entrega a cada quantos dias", campos.ciclo, "É este número que diz para quantos dias a sugestão de compra pede."),
          linha("WhatsApp / telefone", campos.telefone),
          linha("E-mail", campos.email),
          linha("CNPJ", campos.cnpj),
          linha("Observações", campos.obs),

          existente
            ? el("div", {}, [
                el("h3", { texto: "O que se compra dele" }),
                listaVinculos,
                buscador(
                  insumos.filter((i) => i.fornecedorId !== existente.id)
                    .map((i) => ({ rotulo: i.nome, valor: i })),
                  {
                    placeholder: "🔍  Adicionar insumo deste fornecedor…",
                    aoEscolher: async (o) => {
                      try {
                        await patch(`/v1/venues/${ctx.venue}/insumos/${o.valor.id}`, { fornecedor_id: existente.id });
                        o.valor.fornecedorId = existente.id;
                        doFornecedor.push(o.valor);
                        desenharVinculos();
                      } catch (e) { avisar(e.message, "erro"); }
                    },
                  },
                ),
              ])
            : null,

          el("div", { classe: "linha-campos" }, [
            el("button", {
              classe: "btn btn-primario",
              type: "button",
              texto: "Salvar",
              onclick: async () => {
                if (campos.nome.value.trim().length < 2) return avisar("Dê um nome ao fornecedor.", "erro");
                try {
                  await post(`/v1/venues/${ctx.venue}/fornecedores`, {
                    id: existente?.id ?? null,
                    nome: campos.nome.value,
                    ciclo_compra_dias: Number(campos.ciclo.value) || 7,
                    telefone: campos.telefone.value || null,
                    email: campos.email.value || null,
                    cnpj: campos.cnpj.value || null,
                    observacoes: campos.obs.value || null,
                  });
                  desenhar();
                } catch (e) { avisar(e.message, "erro"); }
              },
            }),
            el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: desenhar }),
          ]),
        ].filter(Boolean)),
      );
      desenharVinculos();
    }
  }
}
