import { del, get, post, put } from "../api.js";
import { ICONES, acaoIcone, avisar, campoDeFormulario, comIcone, dinheiro, el, esqueleto, estadoDeErro, etiqueta, icone, indicador, limpar, navegadorDePeriodo, tabelaDeDados, vazio } from "../ui.js";
import { botaoDePdf, imprimirRelatorio } from "../relatorio.js";

/**
 * RH — a gorjeta, semana a semana.
 *
 * A tela antiga pedia "o bolo do turno" mesmo na casa que paga comissão
 * sobre a venda de cada garçom. Eram duas contas diferentes com o mesmo
 * nome, e ninguém entendia qual estava vendo.
 *
 * Agora a casa escolhe o método uma vez, em Regras, e a tela inteira passa a
 * falar a língua dela:
 *
 *   INDIVIDUAL — lança-se a venda de cada um; a comissão sai do percentual.
 *   GLOBAL     — lança-se o bolo do turno; ele se reparte pelo critério da
 *                casa (igual, por pontuação ou por horas).
 *
 * A unidade é a SEMANA porque é assim que bar acerta gorjeta. Os
 * lançamentos continuam por dia; a semana só soma.
 */

const NOME_DO_CRITERIO = {
  igual: "igual para todos",
  peso: "por pontuação da função",
  horas: "pelas horas da escala",
};

/**
 * O estado do formulário vive FORA do desenho.
 *
 * Já foi bug: a cada prévia a tela era redesenhada e o gestor perdia o que
 * tinha digitado no meio do lançamento.
 */
const formularios = {
  venda: null,
  adicional: null,
  desconto: null,
};

export function criarFechamento(corpo, ctx) {
  let dados = null;
  let semana = null; // { ano, numero } — null = a semana de hoje
  let painel = null; // "regras" | "venda" | "adicional" | "desconto" | null
  let verLancamentos = false;

  return { desenhar, recarregar };

  async function recarregar() {
    const busca = semana ? `?ano=${semana.ano}&semana=${semana.numero}` : "";
    if (!dados) limpar(corpo).append(esqueleto({ cartoes: 4, linhas: 5 }));
    try {
      dados = await get(`/v1/venues/${ctx.venue}/rh/acerto${busca}`);
      semana = { ano: dados.ano, numero: dados.semana };
    } catch (e) {
      ctx.definirAcoes?.();
      limpar(corpo).append(estadoDeErro("Não deu para carregar a gorjeta", e.message, recarregar));
      return;
    }
    desenhar();
  }

  function desenhar() {
    if (!dados) {
      void recarregar();
      return;
    }
    // Uma pilha só: o espaço entre os blocos vem dela, e não de margem solta.
    const pilha = el("div", { classe: "pilha" });
    limpar(corpo).append(pilha);
    pilha.append(cabecalho());

    if (!dados.regra.configurada) {
      pilha.append(escolhaInicial());
      if (painel === "regras") pilha.append(painelDeRegras());
      return;
    }

    // Retenção acima do teto da lei aparece no acerto de TODA semana, e não
    // só em Regras: quem paga a semana nem sempre é quem configurou.
    const retencao = avisoDeRetencao(dados.avisos_da_retencao, dados.regra.percentual_repasse);
    if (retencao) pilha.append(retencao);

    if (painel === "regras") pilha.append(painelDeRegras());
    if (painel === "venda") pilha.append(formularioDeVenda());
    if (painel === "adicional") pilha.append(formularioDeExtra("adicional"));
    if (painel === "desconto") pilha.append(formularioDeExtra("desconto"));

    pilha.append(barraDaSemana(), tabelaDoAcerto(), lancamentosDaSemana());
  }

  /* ================= Topo ================= */

  function cabecalho() {
    const r = dados.regra;
    const frase = !r.configurada
      ? "A casa ainda não escolheu como paga a gorjeta."
      : r.metodo === "individual"
        ? `Comissão de ${numeroCurto(r.percentual_servico)}% sobre a venda de cada um`
          + (r.percentual_repasse < 100 ? `, com ${numeroCurto(r.percentual_repasse)}% repassados à equipe` : "")
          + (r.percentual_da_casa_para_apoio > 0 ? ` · ${numeroCurto(r.percentual_da_casa_para_apoio)}% separados para o apoio` : "")
        : `Bolo de ${numeroCurto(r.percentual_servico)}% sobre a venda da casa, repartido ${NOME_DO_CRITERIO[r.criterio_rateio]}`
          + (r.percentual_repasse < 100 ? ` · ${numeroCurto(r.percentual_repasse)}% repassados à equipe` : "");
    const fraseDasMetas = r.configurada && r.metas?.length
      ? `Metas da semana: ${r.metas.map((m) => `a partir de ${dinheiro(m.a_partir_de)} +${numeroCurto(m.bonus)}%`).join(" · ")}`
      : null;

    // O painel aberto vira "Fechar" no próprio botão que o abriu.
    const botao = (id, rotulo, { primario = false, iconePath = null } = {}) =>
      el(
        "button",
        {
          classe: `btn ${primario ? "btn-primario" : ""}`.trim(),
          type: "button",
          "aria-expanded": String(painel === id),
          onclick: () => {
            painel = painel === id ? null : id;
            desenhar();
          },
        },
        painel === id ? [document.createTextNode("Fechar")] : iconePath ? comIcone(iconePath, rotulo) : [document.createTextNode(rotulo)],
      );

    // As ações da gorjeta moram no cabeçalho da página, como nas outras telas.
    ctx.definirAcoes?.(
      botao("regras", "Regras"),
      dados.regra.configurada ? botao("desconto", "Desconto") : null,
      dados.regra.configurada ? botao("adicional", "Adicional") : null,
      // A meta precisa da venda de cada um, nos dois métodos.
      dados.regra.configurada && (dados.regra.metodo === "individual" || dados.regra.metas?.length)
        ? botao("venda", "Lançar venda", { primario: true, iconePath: ICONES.mais })
        : null,
    );

    // A regra da casa numa linha: é o que explica todos os números abaixo.
    return el("div", { classe: "regra-em-linha" }, [
      el("span", { classe: "regra-em-linha-icone", "aria-hidden": "true" }, [icone(ICONES.cifrao, 16)]),
      el("div", {}, [
        el("strong", { texto: frase }),
        fraseDasMetas ? el("span", { classe: "muted", texto: fraseDasMetas }) : null,
      ]),
    ]);
  }

  /** Enquanto a casa não escolhe, a tela não finge que sabe. */
  function escolhaInicial() {
    return el("section", { classe: "cartao cartao-atencao" }, [
      el("h3", { texto: "Escolha primeiro como a casa paga a gorjeta" }),
      el("p", {
        classe: "muted",
        texto:
          "São duas contas diferentes, e a tela muda conforme a sua. Na comissão individual, cada um recebe um "
          + "percentual sobre o que ele mesmo vendeu. No bolo da casa, o serviço da noite inteira é repartido entre a "
          + "equipe — igual, por pontuação da função ou pelas horas.",
      }),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Escolher agora",
          onclick: () => {
            painel = "regras";
            desenhar();
          },
        }),
      ]),
    ]);
  }

  /* ================= Regras ================= */

  function painelDeRegras() {
    const r = dados.regra;

    const metodo = el("select", { classe: "input", onchange: () => atualizarVisibilidade() },
      dados.metodos.map((m) => el("option", { value: m.id, texto: m.nome, selected: r.metodo === m.id })));
    const explicacaoDoMetodo = el("small", { classe: "muted" });
    const servico = el("input", { classe: "input", type: "number", min: "0", max: "100", step: "0.01", value: String(r.percentual_servico) });
    const repasse = el("input", { classe: "input", type: "number", min: "0", max: "100", step: "0.01", value: String(r.percentual_repasse) });
    const criterio = el("select", { classe: "input", "aria-label": "Como o bolo é repartido" },
      dados.criterios.map((c) => el("option", { value: c.id, texto: c.nome, selected: r.criterio_rateio === c.id })));
    const apoio = el("input", { classe: "input", type: "number", min: "0", max: "100", step: "0.01", value: String(r.percentual_da_casa_para_apoio) });

    const campoCriterio = el("div", { classe: "campo" }, [
      el("label", { texto: "Como reparte o bolo" }),
      criterio,
      el("small", { classe: "muted", texto: "A pontuação por função se ajusta na lista de pesos, mais abaixo." }),
    ]);
    const campoApoio = el("div", { classe: "campo" }, [
      el("label", { texto: "Separado para quem não vende (%)" }),
      apoio,
      el("small", { classe: "muted", texto: "Cozinha e copa não têm venda própria. Zero deixa a gorjeta só com quem vende." }),
    ]);

    function atualizarVisibilidade() {
      const individual = metodo.value === "individual";
      const escolhido = dados.metodos.find((m) => m.id === metodo.value);
      explicacaoDoMetodo.textContent = escolhido ? escolhido.explicacao : "";
      campoApoio.hidden = !individual;
      // No individual o critério só decide a fatia do apoio; sem apoio, some.
      campoCriterio.hidden = individual && Number(apoio.value || 0) <= 0;
    }
    apoio.addEventListener("input", atualizarVisibilidade);
    atualizarVisibilidade();

    // O aviso acompanha o número enquanto ele é digitado: é antes de salvar
    // que o gestor precisa saber que passou do teto.
    const avisoDoRepasse = el("div", { "aria-live": "polite" });
    const atualizarAviso = () => {
      const aviso = avisoDeRetencao(dados.avisos_da_retencao, repasse.value === "" ? 100 : repasse.value);
      limpar(avisoDoRepasse);
      if (aviso) avisoDoRepasse.append(aviso);
    };
    repasse.addEventListener("input", atualizarAviso);
    atualizarAviso();

    const metas = editorDeMetas(r);

    return el("section", { classe: "cartao formulario" }, [
      el("h3", { texto: "Como esta casa paga a gorjeta" }),
      el("p", {
        classe: "muted",
        texto: "Vale para os lançamentos daqui para frente. O que já foi pago continua como foi pago.",
      }),
      el("div", { classe: "grade" }, [
        campoDeFormulario("Método", metodo, explicacaoDoMetodo),
        el("div", { classe: "campo" }, [
          el("label", { texto: "Serviço sobre a venda (%)" }),
          servico,
          el("small", { classe: "muted", texto: "Os 10% de praxe, ou o que a casa cobra." }),
        ]),
        el("div", { classe: "campo" }, [
          el("label", { texto: "Repassado à equipe (%)" }),
          repasse,
          el("small", { classe: "muted", texto: "100 = a casa não retém nada. O que retém é só para encargos, e aparece na tela." }),
        ]),
        campoCriterio,
        campoApoio,
      ]),
      avisoDoRepasse,
      metas.elemento,
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Salvar regra",
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await put(`/v1/venues/${ctx.venue}/rh/regra-da-gorjeta`, {
                metodo: metodo.value,
                percentual_servico: Number(servico.value),
                percentual_repasse: Number(repasse.value),
                criterio_rateio: criterio.value,
                percentual_da_casa_para_apoio: Number(apoio.value) || 0,
                metas: metas.valor(),
                meta_sobre: metas.sobre(),
              });
              avisar("Regra salva. A tela já está falando essa língua.", "ok");
              painel = null;
              await recarregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      ]),
      tabelaDePesos(),
    ]);
  }

  /**
   * As metas da semana: "vendeu a partir de R$ X na semana, ganha +Y%".
   *
   * A semana é a mesma do acerto (segunda a domingo) — meta de garçom em bar
   * é semanal, porque um sábado cheio não pode decidir sozinho. As linhas
   * vivem num array local: adicionar ou tirar faixa não pode apagar o que a
   * pessoa já digitou nos outros campos da regra.
   */
  function editorDeMetas(r) {
    const faixas = (r.metas ?? []).map((m) => ({ a_partir_de: String(m.a_partir_de), bonus: String(m.bonus) }));
    const sobre = el("select", { classe: "input" }, [
      el("option", { value: "tudo", texto: "Sobre toda a venda da semana", selected: r.meta_sobre !== "excedente" }),
      el("option", { value: "excedente", texto: "Só sobre o que passou da meta", selected: r.meta_sobre === "excedente" }),
    ]);
    const lista = el("div", { classe: "pilha-fina" });
    const exemplo = el("p", { classe: "muted" });

    function desenharLinhas() {
      limpar(lista);
      faixas.forEach((f, i) => {
        const valor = el("input", { classe: "input", type: "number", min: "0", step: "100", value: f.a_partir_de, placeholder: "10000", oninput: (e) => { f.a_partir_de = e.target.value; atualizarExemplo(); } });
        const bonus = el("input", { classe: "input", type: "number", min: "0", max: "100", step: "0.1", value: f.bonus, placeholder: "1", oninput: (e) => { f.bonus = e.target.value; atualizarExemplo(); } });
        lista.append(
          el("div", { classe: "linha-campos meta-faixa" }, [
            el("span", { classe: "muted", texto: "Vendeu a partir de R$" }),
            valor,
            el("span", { classe: "muted", texto: "na semana → ganha +" }),
            bonus,
            el("span", { classe: "muted", texto: "%" }),
            el("button", {
              classe: "btn btn-peq btn-perigo",
              type: "button",
              texto: "Tirar",
              onclick: () => {
                faixas.splice(i, 1);
                desenharLinhas();
              },
            }),
          ]),
        );
      });
      if (!faixas.length) lista.append(el("p", { classe: "muted", texto: "Nenhuma meta. Sem meta, a comissão é só o percentual de sempre." }));
      atualizarExemplo();
    }

    // O exemplo em reais é o que faz a regra ser entendida na primeira leitura.
    function atualizarExemplo() {
      const validas = faixas
        .map((f) => ({ a: Number(f.a_partir_de), b: Number(f.bonus) }))
        .filter((f) => f.a > 0 && f.b > 0)
        .sort((x, y) => x.a - y.a);
      if (!validas.length) {
        exemplo.textContent = "";
        return;
      }
      const f = validas[0];
      const venda = Math.round(f.a * 1.2);
      const base = sobre.value === "excedente" ? venda - f.a : venda;
      exemplo.textContent = `Exemplo: quem vendeu ${dinheiro(venda)} de segunda a domingo ganha ${dinheiro((base * f.b) / 100)} a mais nessa semana.`;
    }
    sobre.addEventListener("change", atualizarExemplo);
    desenharLinhas();

    const elemento = el("div", { classe: "pilha", style: "margin-top:18px" }, [
      el("h4", { texto: "Metas da semana", style: "margin:0" }),
      el("p", {
        classe: "muted",
        texto:
          "Conta a venda de cada pessoa de segunda a domingo. Vale a maior faixa atingida (as faixas não se somam). "
          + "O bônus sai do caixa da casa, não do serviço: a gorjeta dos outros não diminui.",
      }),
      lista,
      el("div", { classe: "linha-campos", style: "align-items:center" }, [
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "+ Adicionar faixa",
          onclick: () => {
            const ultima = faixas[faixas.length - 1];
            faixas.push({
              a_partir_de: ultima ? String(Number(ultima.a_partir_de || 0) + 5000) : "10000",
              bonus: ultima ? String(Number(ultima.bonus || 0) + 1) : "1",
            });
            desenharLinhas();
          },
        }),
        sobre,
      ]),
      exemplo,
    ]);

    return {
      elemento,
      sobre: () => sobre.value,
      valor: () =>
        faixas
          .filter((f) => f.a_partir_de !== "" || f.bonus !== "")
          .map((f) => ({ a_partir_de: Number(f.a_partir_de), bonus: Number(f.bonus) })),
    };
  }

  /** A pontuação por função: só aparece onde ela manda na conta. */
  function tabelaDePesos() {
    const funcao = el("input", { classe: "input", type: "text", placeholder: "Garçom" });
    const peso = el("input", { classe: "input", type: "number", min: "0", step: "0.5", value: "1" });

    return el("div", { style: "margin-top:22px" }, [
      el("h4", { texto: "Pontuação por função", style: "margin:0 0 2px" }),
      el("p", {
        classe: "muted",
        texto: "Quem não estiver na lista pesa 1. Só entra na conta quando o rateio é por pontuação.",
      }),
      dados.pesos.length
        ? el("div", { classe: "tabela", style: "margin:10px 0" },
          dados.pesos.map((p) =>
            el("div", { classe: "linha-tabela" }, [
              el("div", { classe: "linha-principal", style: "flex:1" }, [
                el("strong", { texto: p.funcao }),
                el("span", { classe: "muted", texto: `pesa ${numeroCurto(p.peso)}` }),
              ]),
              el("button", {
                classe: "btn btn-peq btn-perigo",
                type: "button",
                texto: "Apagar",
                onclick: async (e) => {
                  e.target.disabled = true;
                  try {
                    await del(`/v1/venues/${ctx.venue}/rh/pesos/${p.id}`);
                    await recarregar();
                  } catch (err) {
                    avisar(err.message, "erro");
                    e.target.disabled = false;
                  }
                },
              }),
            ]),
          ))
        : null,
      el("div", { classe: "grade" }, [
        campoDeFormulario("Função", funcao),
        campoDeFormulario("Peso", peso),
      ]),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-peq",
          type: "button",
          texto: "Guardar peso",
          onclick: async (e) => {
            if (!funcao.value.trim()) return avisar("Diga a função.", "erro");
            e.target.disabled = true;
            try {
              await post(`/v1/venues/${ctx.venue}/rh/pesos`, { funcao: funcao.value, peso: Number(peso.value) });
              await recarregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      ]),
    ]);
  }

  /* ================= A semana ================= */

  function barraDaSemana() {
    const andar = (passo) => {
      const base = new Date(`${dados.inicio}T12:00:00Z`);
      base.setUTCDate(base.getUTCDate() + passo * 7);
      semana = semanaDe(base.toISOString().slice(0, 10));
      void recarregar();
    };

    const t = dados.totais;
    const comandas = somaComandas();
    return el("section", { classe: "pilha" }, [
      el("div", { classe: "barra-periodo" }, [
        navegadorDePeriodo({
          titulo: `Semana ${dados.semana}/${dados.ano}`,
          detalhe: `${diaBr(dados.inicio)} a ${diaBr(dados.fim)}`,
          aoVoltar: () => andar(-1),
          aoAvancar: () => andar(1),
          rotuloAtual: "Esta semana",
          aoIrParaAtual: () => {
            semana = null;
            void recarregar();
          },
        }),
        botaoDePdf(acertoEmPdf, "Acerto em PDF"),
      ]),
      el("div", { classe: "grade" }, [
        indicador({
          rotulo: "Vendas da semana",
          valor: dinheiro(t.vendas),
          nota: dados.regra.metodo === "global" ? "informativo: não é o que paga" : `${comandas} ${comandas === 1 ? "comanda" : "comandas"}`,
          iconePath: ICONES.recibo,
          cor: "areia",
        }),
        indicador({
          rotulo: `Serviço arrecadado (${numeroCurto(dados.regra.percentual_servico)}%)`,
          valor: dinheiro(t.arrecadado),
          nota: "o que os clientes pagaram de serviço",
          iconePath: ICONES.entrada_dinheiro,
          cor: "musgo",
        }),
        indicador({
          // "Fica com a casa" dizia o que a lei não deixa: a retenção é para
          // os encargos da própria gorjeta, não receita da casa.
          rotulo: "Retido para encargos",
          valor: dinheiro(t.retido),
          nota: t.retido > 0 ? `${numeroCurto(100 - dados.regra.percentual_repasse)}% do arrecadado, pela regra da casa` : "repassa tudo",
          iconePath: ICONES.banco,
          cor: "pinho",
        }),
        indicador({
          rotulo: "A receber pela equipe",
          valor: dinheiro(t.a_receber),
          nota: notaDoTotal(t),
          iconePath: ICONES.pessoas,
          cor: "marca",
        }),
      ]),
    ]);
  }

  function notaDoTotal(t) {
    const partes = [];
    if (t.comissoes > 0) partes.push(`${dinheiro(t.comissoes)} de comissão`);
    if (t.rateio > 0) partes.push(`${dinheiro(t.rateio)} de rateio`);
    if (t.bonus_meta > 0) partes.push(`${dinheiro(t.bonus_meta)} de meta`);
    if (t.adicionais > 0) partes.push(`+ ${dinheiro(t.adicionais)}`);
    if (t.descontos > 0) partes.push(`− ${dinheiro(t.descontos)}`);
    return partes.join(" · ") || "nada lançado ainda";
  }

  // Declaração, e não const: o `return` do topo da fábrica sai antes desta
  // linha, e um const aqui nunca chegaria a ser inicializado.
  function somaComandas() {
    return dados.linhas.reduce((s, l) => s + l.comandas, 0);
  }

  /**
   * O acerto da semana no papel, com uma linha de assinatura por pessoa: é
   * o recibo que a casa guarda de que cada um conferiu e recebeu.
   */
  function acertoEmPdf() {
    const cols = colunas();
    const t = dados.totais;
    imprimirRelatorio({
      tipo: "RH",
      titulo: "Acerto da gorjeta",
      periodo: `Semana ${dados.semana}/${dados.ano} · ${diaBr(dados.inicio)} a ${diaBr(dados.fim)}`,
      selos: [
        { valor: dinheiro(t.vendas), rotulo: "vendas da semana" },
        { valor: dinheiro(t.arrecadado), rotulo: `serviço (${numeroCurto(dados.regra.percentual_servico)}%)` },
        { valor: dinheiro(t.retido), rotulo: "retido para encargos, conforme a regra da casa" },
        { valor: dinheiro(t.a_receber), rotulo: "a receber pela equipe" },
      ],
      secoes: [
        {
          nota: [
            dados.regra.metodo === "individual" ? "Comissão sobre a venda de cada um." : "Bolo da casa repartido entre a equipe.",
            dados.regra.metas?.length
              ? `Metas da semana: ${dados.regra.metas.map((m) => `a partir de ${dinheiro(m.a_partir_de)} +${numeroCurto(m.bonus)}%`).join(" · ")}.`
              : null,
          ].filter(Boolean).join(" "),
          colunas: [...cols.map((c) => ({ rotulo: c.rotulo, num: c.num })), { rotulo: "Assinatura" }],
          linhas: dados.linhas.map((l) => [
            ...cols.map((c) => (c.valor ? dinheiroDaColuna(c, c.valor(l)) : c.texto(l))),
            "_______________________",
          ]),
          total: [
            ...cols.map((c, i) => (i === 0 ? "Total" : c.valor ? dinheiroDaColuna(c, dados.linhas.reduce((s, l) => s + c.valor(l), 0)) : "")),
            "",
          ],
          vazio: "Ninguém no acerto desta semana.",
        },
      ],
      assinaturas: ["Gerente"],
      arquivo: `acerto-gorjeta-semana-${dados.semana}-${dados.ano}`,
      paisagem: true,
    });
  }

  /* ================= A tabela ================= */

  /**
   * Uma coluna por parcela do acerto, como no sistema que a casa já usa.
   *
   * As colunas que não têm nada não aparecem: mostrar "Comissão · R$ 0,00"
   * para a casa inteira numa casa que paga por bolo é exatamente o tipo de
   * coluna que faz o gestor perguntar "mas então o que é isso aqui?".
   */
  function colunas() {
    const individual = dados.regra.metodo === "individual";
    const temRateio = dados.linhas.some((l) => l.rateio > 0);
    const temAdicional = dados.linhas.some((l) => l.adicionais > 0);
    const temDesconto = dados.linhas.some((l) => l.descontos > 0);
    const temMeta = (dados.regra.metas ?? []).length > 0;

    return [
      { chave: "nome", rotulo: "Pessoa", texto: (l) => l.nome, forte: true },
      { chave: "funcao", rotulo: "Função", texto: (l) => l.funcao || "—" },
      { chave: "vendas", rotulo: "Vendas", num: true, valor: (l) => l.vendas, nota: (l) => (l.comandas ? `${l.comandas} ${l.comandas === 1 ? "comanda" : "comandas"}` : null) },
      individual
        ? { chave: "comissao", rotulo: `Comissão`, num: true, valor: (l) => l.comissao }
        : null,
      temRateio || !individual
        ? { chave: "rateio", rotulo: individual ? "Rateio à parte" : "Rateio do bolo", num: true, valor: (l) => l.rateio }
        : null,
      temMeta
        ? {
            chave: "bonus_meta",
            rotulo: "Bônus da meta",
            num: true,
            valor: (l) => l.bonus_meta ?? 0,
            // Atingiu: qual faixa. Não atingiu: quanto falta — é o que o gerente
            // fala para o garçom na quinta-feira.
            nota: (l) =>
              l.meta_atingida
                ? `bateu +${numeroCurto(l.meta_atingida)}%${l.meta_proxima ? ` · faltam ${dinheiro(l.meta_proxima.falta)} p/ +${numeroCurto(l.meta_proxima.bonus)}%` : ""}`
                : l.meta_proxima && l.vendas > 0
                  ? `faltam ${dinheiro(l.meta_proxima.falta)} p/ +${numeroCurto(l.meta_proxima.bonus)}%`
                  : null,
          }
        : null,
      temAdicional ? { chave: "adicionais", rotulo: "Adicionais", num: true, valor: (l) => l.adicionais } : null,
      temDesconto ? { chave: "descontos", rotulo: "Descontos", num: true, valor: (l) => l.descontos, negativo: true } : null,
      { chave: "a_receber", rotulo: "A receber", num: true, valor: (l) => l.a_receber, forte: true },
    ].filter(Boolean);
  }

  function tabelaDoAcerto() {
    const cols = colunas();
    const linhas = dados.linhas;

    if (linhas.length === 0) {
      return vazio(
        "Ninguém no acerto desta semana",
        dados.regra.metodo === "individual"
          ? 'Lance a venda de cada um em "Lançar venda" e a comissão aparece aqui.'
          : "Feche o serviço de um turno e o rateio aparece aqui.",
      );
    }

    const total = (col) => (col.valor ? linhas.reduce((s, l) => s + col.valor(l), 0) : null);

    return tabelaDeDados({
      colunas: cols.map((c, i) => ({ rotulo: c.rotulo, num: c.num, principal: i === 0 })),
      larguraMinima: `${Math.max(640, cols.length * 118)}px`,
      linhas: linhas.map((l) => ({ celulas: cols.map((c) => celula(c, l)) })),
      rodape: cols.map((c, i) => (i === 0 ? "Total" : c.valor ? dinheiroDaColuna(c, total(c)) : null)),
    });
  }

  function celula(col, linha) {
    if (!col.valor) {
      const conteudo = col.texto(linha);
      return col.forte ? conteudo : el("span", { classe: "muted", texto: conteudo });
    }
    const valor = col.valor(linha);
    const texto = dinheiroDaColuna(col, valor);
    const nota = col.nota?.(linha);
    return el("span", {}, [
      col.forte ? el("strong", { texto }) : el("span", { texto, classe: valor > 0 ? "" : "muted" }),
      nota ? el("small", { texto: nota }) : null,
    ]);
  }

  function dinheiroDaColuna(col, valor) {
    return col.negativo && valor > 0 ? `− ${dinheiro(valor)}` : dinheiro(valor);
  }

  /* ================= Lançar ================= */

  function seletorDePessoa(valorInicial) {
    return el("select", { classe: "input" },
      dados.equipe.map((p) =>
        el("option", {
          value: p.atendente_id,
          texto: p.funcao ? `${p.nome} · ${p.funcao}` : p.nome,
          selected: valorInicial === p.atendente_id,
        }),
      ));
  }

  function formularioDeVenda() {
    const f = (formularios.venda ??= { dia: dados.fim, turnoId: "", atendenteId: "", valor: "", comandas: "", observacao: "" });

    const dia = el("input", { classe: "input", type: "date", value: f.dia, min: dados.inicio, max: dados.fim, onchange: (e) => { f.dia = e.target.value; } });
    const quem = seletorDePessoa(f.atendenteId);
    quem.addEventListener("change", () => { f.atendenteId = quem.value; });
    const turno = el("select", { classe: "input", onchange: (e) => { f.turnoId = e.target.value; } }, [
      el("option", { value: "", texto: "A noite inteira" }),
      ...dados.turnos.map((t) => el("option", { value: t.id, texto: t.nome, selected: f.turnoId === t.id })),
    ]);
    const valor = el("input", { classe: "input", type: "number", min: "0", step: "0.01", value: f.valor, placeholder: "0,00", oninput: (e) => { f.valor = e.target.value; atualizarPrevia(); } });
    const comandas = el("input", { classe: "input", type: "number", min: "0", value: f.comandas, oninput: (e) => { f.comandas = e.target.value; } });
    const previa = el("p", { classe: "muted" });

    function atualizarPrevia() {
      const v = Number(valor.value) || 0;
      const r = dados.regra;
      const bruto = (v * r.percentual_servico) / 100;
      const liquido = (bruto * r.percentual_repasse) / 100;
      const daPessoa = (liquido * (100 - r.percentual_da_casa_para_apoio)) / 100;
      previa.textContent = r.metodo === "global"
        ? "A venda de cada um aqui serve para a meta da semana; a gorjeta continua saindo do bolo."
        : v > 0
          ? `Vende ${dinheiro(v)} → serviço de ${dinheiro(bruto)} → ${dinheiro(daPessoa)} para esta pessoa.`
          : "Digite a venda para ver quanto vira gorjeta.";
    }
    atualizarPrevia();

    return el("section", { classe: "cartao formulario" }, [
      el("h3", { texto: "Lançar venda", style: "margin:0 0 2px" }),
      previa,
      el("div", { classe: "grade" }, [
        campoDeFormulario("Quem", quem),
        campoDeFormulario("Dia", dia),
        campoDeFormulario("Turno", turno),
        campoDeFormulario("Quanto vendeu (R$)", valor),
        campoDeFormulario("Comandas", comandas),
      ]),
      el("p", {
        classe: "muted",
        texto: "Uma venda por pessoa em cada turno. Lançar de novo no mesmo turno corrige o valor, não soma outro.",
      }),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Lançar",
          onclick: async (e) => {
            const alvo = quem.value;
            if (!alvo) return avisar("Escolha de quem é a venda.", "erro");
            if (!(Number(valor.value) >= 0) || valor.value === "") return avisar("Informe quanto a pessoa vendeu.", "erro");
            e.target.disabled = true;
            try {
              await post(`/v1/venues/${ctx.venue}/rh/vendas`, {
                dia: dia.value,
                turno_id: turno.value || null,
                atendente_id: alvo,
                valor: Number(valor.value),
                comandas: Number(comandas.value) || 0,
              });
              avisar("Venda lançada.", "ok");
              // Zera só o valor: o gestor costuma lançar a mesma noite em
              // sequência, pessoa por pessoa.
              f.valor = "";
              f.comandas = "";
              await recarregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      ]),
    ]);
  }

  function formularioDeExtra(tipo) {
    const f = (formularios[tipo] ??= { dia: dados.fim, atendenteId: "", descricao: "", valor: "" });
    const adicional = tipo === "adicional";

    const quem = seletorDePessoa(f.atendenteId);
    quem.addEventListener("change", () => { f.atendenteId = quem.value; });
    const dia = el("input", { classe: "input", type: "date", value: f.dia, min: dados.inicio, max: dados.fim, onchange: (e) => { f.dia = e.target.value; } });
    const descricao = el("input", {
      classe: "input",
      type: "text",
      value: f.descricao,
      placeholder: adicional ? "Gorjeta do evento de sábado" : "Consumo no bar em 12/11, combinado com a pessoa",
      oninput: (e) => { f.descricao = e.target.value; },
    });
    const valor = el("input", { classe: "input", type: "number", min: "0", step: "0.01", value: f.valor, oninput: (e) => { f.valor = e.target.value; } });

    return el("section", { classe: "cartao formulario" }, [
      el("h3", { texto: adicional ? "Adicional" : "Desconto", style: "margin:0 0 2px" }),
      el("p", {
        classe: "muted",
        texto: adicional
          ? "O que não sai de percentual nenhum: a gorjeta deixada na mão, o acerto de um evento fechado."
          : "O que sai do acerto da pessoa: consumo no bar, quebra combinada. O valor entra positivo; a tela é que subtrai.",
      }),
      // Desconto mexe no dinheiro de alguém: uma linha diz o que a casa
      // precisa ter em mãos, e o motivo deixa de ser opcional.
      adicional ? null : el("p", { classe: "aviso aviso-alerta", style: "margin:8px 0", texto: dados.aviso_do_desconto ?? AVISO_DO_DESCONTO }),
      el("div", { classe: "grade" }, [
        campoDeFormulario("Quem", quem),
        campoDeFormulario("Dia", dia),
        campoDeFormulario(adicional ? "Descrição" : "Motivo (obrigatório)", descricao),
        campoDeFormulario("Valor (R$)", valor),
      ]),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Lançar",
          onclick: async (e) => {
            if (!quem.value) return avisar("Escolha a pessoa.", "erro");
            if (!(Number(valor.value) > 0)) return avisar("Informe um valor maior que zero.", "erro");
            if (!adicional && descricao.value.trim().length < 3) {
              descricao.focus();
              return avisar("Escreva o motivo do desconto: é o que explica o valor para a pessoa depois.", "erro");
            }
            e.target.disabled = true;
            try {
              await post(`/v1/venues/${ctx.venue}/rh/extras`, {
                dia: dia.value,
                atendente_id: quem.value,
                tipo,
                descricao: descricao.value,
                valor: Number(valor.value),
              });
              avisar(adicional ? "Adicional lançado." : "Desconto lançado.", "ok");
              f.valor = "";
              f.descricao = "";
              await recarregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
      ]),
    ]);
  }

  /* ================= O que foi lançado ================= */

  function lancamentosDaSemana() {
    const nomeDe = new Map(dados.equipe.map((p) => [p.atendente_id, p.nome]));
    const itens = [
      ...dados.vendas.map((v) => ({
        id: v.id,
        rota: "vendas",
        dia: v.dia,
        titulo: `${nomeDe.get(v.atendente_id) ?? "—"} vendeu ${dinheiro(v.valor)}`,
        detalhe: [v.comandas ? `${v.comandas} ${v.comandas === 1 ? "comanda" : "comandas"}` : null, nomeDoTurno(v.turno_id)].filter(Boolean).join(" · "),
        cor: "",
      })),
      ...dados.extras.map((x) => ({
        id: x.id,
        rota: "extras",
        dia: x.dia,
        titulo: `${nomeDe.get(x.atendente_id) ?? "—"}: ${x.tipo === "adicional" ? "+" : "−"} ${dinheiro(x.valor)}`,
        detalhe: x.descricao || (x.tipo === "adicional" ? "adicional" : "desconto"),
        cor: x.tipo === "adicional" ? "etiqueta-ok" : "etiqueta-alerta",
      })),
    ].sort((a, b) => b.dia.localeCompare(a.dia));

    const fechamentos = dados.fechamentos.map((g) => ({
      id: g.id,
      rota: "gorjetas",
      dia: g.dia,
      titulo: `Bolo do turno: ${dinheiro(g.valor_repassado)} repartidos`,
      detalhe: `${nomeDoTurno(g.turno_id) || "a noite inteira"} · ${g.cotas.length} ${g.cotas.length === 1 ? "pessoa" : "pessoas"}`,
      cor: "etiqueta-info",
    }));

    const tudo = [...itens, ...fechamentos].sort((a, b) => b.dia.localeCompare(a.dia));
    if (tudo.length === 0) return el("div", {});

    // Fechado por padrão: o que se confere toda semana é o acerto, acima; os
    // lançamentos são para achar o que foi digitado errado.
    return tabelaDeDados({
      colunas: [
        { rotulo: "Lançamento", principal: true },
        { rotulo: "Dia", largura: "120px" },
        { rotulo: "Detalhe", largura: "32%", quebra: true },
        { rotulo: "Tipo", largura: "120px" },
        { rotulo: "", largura: "56px", acoes: true },
      ],
      larguraMinima: "720px",
      // Um grupo só, que abre e fecha: o título das colunas acima dele, com o
      // grupo fechado, seria um cabeçalho de nada.
      semCabecalho: true,
      grupos: [{
        titulo: "Lançamentos da semana",
        quantidade: tudo.length,
        aberto: verLancamentos,
        aoAlternar: (aberto) => { verLancamentos = aberto; },
        linhas: tudo.map((i) => ({
          celulas: [
            i.titulo,
            diaBr(i.dia),
            i.detalhe || null,
            etiqueta(i.rota === "gorjetas" ? "bolo" : i.rota === "vendas" ? "venda" : i.titulo.includes("+") ? "adicional" : "desconto", i.cor),
            acaoIcone({
              iconePath: ICONES.lixeira,
              rotulo: "Apagar este lançamento",
              variante: "perigo",
              aoClicar: async (e) => {
                if (!confirm(`Apagar "${i.titulo}"?`)) return;
                const botao = e.currentTarget;
                botao.disabled = true;
                try {
                  await del(`/v1/venues/${ctx.venue}/rh/${i.rota}/${i.id}`);
                  avisar("Lançamento apagado.", "ok");
                  await recarregar();
                } catch (err) {
                  avisar(err.message, "erro");
                  botao.disabled = false;
                }
              },
            }),
          ],
        })),
      }],
    });
  }

  function nomeDoTurno(id) {
    if (!id) return "";
    const turno = dados.turnos.find((t) => t.id === id);
    return turno ? turno.nome : "";
  }
}

/* ================= Formatação ================= */

/** A semana ISO de um dia — a mesma conta do servidor, para a navegação. */
function semanaDe(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const diaDaSemana = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaDaSemana);
  const ano = d.getUTCFullYear();
  const primeiro = new Date(Date.UTC(ano, 0, 1, 12));
  return { ano, numero: Math.ceil(((d - primeiro) / 86400000 + 1) / 7) };
}

function diaBr(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Só para o caso de a tela estar mais nova que o servidor: o aviso não some. */
const AVISO_DO_DESCONTO =
  "Desconto no que a pessoa recebe pede o de acordo dela por escrito (ou previsão em convenção). Guarde o papel assinado; na dúvida, confirme com a contabilidade.";

/**
 * O aviso de retenção alta, pronto para a tela — ou nada.
 *
 * Os tetos e as frases vêm do servidor (`avisos_da_retencao`, do mais grave
 * para o mais leve): aqui só se escolhe qual cabe ao percentual, para o
 * aviso acompanhar o que o gestor digita. É alerta, não trava — o regime e
 * a convenção de cada casa são com a contabilidade.
 */
function avisoDeRetencao(avisos, percentualRepasse) {
  const retencao = Math.round((100 - Number(percentualRepasse)) * 100) / 100;
  if (!Number.isFinite(retencao)) return null;
  const aviso = (avisos ?? []).find((a) => retencao > a.acima_de);
  if (!aviso) return null;
  return el("p", { classe: `aviso ${aviso.nivel === "alto" ? "aviso-perigo" : "aviso-alerta"}`, role: aviso.nivel === "alto" ? "alert" : "note" }, [
    el("strong", { texto: `A casa está retendo ${numeroCurto(retencao)}% da gorjeta. ` }),
    document.createTextNode(aviso.texto),
  ]);
}

/** 10.00 vira "10"; 12.50 continua "12,5". Percentual redondo não precisa de casa. */
function numeroCurto(valor) {
  const n = Number(valor) || 0;
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}
