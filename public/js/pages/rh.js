import { del, get, patch, post, postArquivo } from "../api.js";
import { avisar, dataHora, dinheiro, el, etiqueta, indicador, limpar, vazio } from "../ui.js";
import { criarEscala } from "./rhEscala.js";
import { criarFerias } from "./rhFerias.js";
import { criarFechamento } from "./rhFechamento.js";
import { botaoDePdf, imprimirRelatorio } from "../relatorio.js";
import { camposDaExperiencia, cartaoDoMapaDisc, resumoDaPessoa, secaoDeAvaliacoes, secaoDeOcorrencias, secaoDoDisc } from "./rhPessoa.js";

/**
 * RH — Fase 1: a ficha de cada pessoa da casa.
 *
 * Duas telas só: a LISTA (quem está na casa, quem tem pendência) e a FICHA
 * (tudo de uma pessoa, com a pasta de documentos). Sem abas: o gestor de bar
 * abre isto para resolver uma coisa — admitir alguém, achar um atestado,
 * desligar — e não para navegar.
 *
 * O que esta tela NÃO faz: folha de pagamento. O salário é anotado porque o
 * gestor precisa saber quanto combinou; imposto e líquido continuam com a
 * contabilidade.
 */

const NOME_DO_VINCULO = {
  clt: "CLT",
  mei: "MEI",
  diarista: "Diarista",
  freelancer: "Freelancer",
  estagio: "Estágio",
  socio: "Sócio",
};

const FORMAS = [
  ["", "Não definido"],
  ["pix", "Pix"],
  ["dinheiro", "Dinheiro"],
  ["transferencia", "Transferência"],
];

/**
 * Por qual valor cada coluna ordena.
 *
 * O nome é o padrão, porque é como se procura alguém. Mas "quem entrou por
 * último" e "quem ganha mais" são perguntas de toda semana, e por isso cada
 * coluna ordena.
 *
 * Mora FORA da função da tela de propósito: uma `const` declarada lá dentro,
 * depois do primeiro desenho, não existe ainda na hora em que a tela desenha
 * pela primeira vez — e a tela abre em branco, com "Cannot access before
 * initialization" no console. Já aconteceu no cardápio.
 */
const VALOR_DA_COLUNA = {
  nome: (p) => p.nome.toLowerCase(),
  // Sem função vai para o fim da lista, não para o começo.
  funcao: (p) => (p.ficha?.cargo || p.funcao || "zzz").toLowerCase(),
  vinculo: (p) => p.ficha?.vinculo ?? "zzz",
  admissao: (p) => p.ficha?.admissao ?? "",
  salario: (p) => Number(p.ficha?.salario) || 0,
};

export async function rh(raiz, ctx) {
  let dados = null;
  let verDesligados = false;
  let abertaId = null;
  let busca = "";
  let ordem = { campo: "nome", desc: false };

  // A aba "ponto" saiu do produto: quem a deixou guardada cai na equipe.
  let abaAtiva = sessionStorage.getItem("brasa.rh.aba") || "equipe";
  if (abaAtiva === "ponto") abaAtiva = "equipe";

  const cabecalho = el("div", { classe: "grade" });
  // `min-width:0` não é enfeite: a planilha lá dentro tem largura mínima de
  // 720px, e sem isto ela estica a coluna da pilha inteira — os indicadores
  // do topo saem da tela do celular junto, e a página rola de lado.
  const corpo = el("div", { style: "min-width:0" });

  // A escala cuida do próprio estado (semana aberta, célula em edição) e
  // desenha dentro do mesmo corpo. Trocar de aba não perde o que ela sabe.
  const escala = criarEscala(corpo, ctx);
  const ferias = criarFerias(corpo, ctx);
  const fechamento = criarFechamento(corpo, ctx);

  const barra = el(
    "div",
    { classe: "abas" },
    [
      ["equipe", "Equipe"],
      ["escala", "Escala"],
      ["ferias", "Férias"],
      ["fechamento", "Gorjeta"],
    ].map(([id, rotulo]) =>
      el("button", {
        classe: `aba ${id === abaAtiva ? "aba-ativa" : ""}`.trim(),
        type: "button",
        "data-aba": id,
        texto: rotulo,
        onclick: () => trocarAba(id),
      }),
    ),
  );

  raiz.append(el("div", { classe: "pilha" }, [barra, cabecalho, corpo]));
  await trocarAba(abaAtiva);

  async function trocarAba(id) {
    abaAtiva = id;
    sessionStorage.setItem("brasa.rh.aba", id);
    for (const b of barra.querySelectorAll(".aba")) b.classList.toggle("aba-ativa", b.dataset.aba === id);
    // Os indicadores falam da equipe, não da semana: na escala eles só
    // empurrariam a grade para baixo.
    cabecalho.hidden = id !== "equipe";
    if (id === "equipe") await recarregar();
    else if (id === "escala") await escala.recarregar();
    else if (id === "ferias") await ferias.recarregar();
    else await fechamento.recarregar();
  }

  async function recarregar() {
    try {
      dados = await get(`/v1/venues/${ctx.venue}/rh${verDesligados ? "?desligados=1" : ""}`);
    } catch (e) {
      limpar(corpo).append(
        el("div", { classe: "cartao" }, [
          el("h2", { texto: "Não deu para carregar o RH" }),
          el("p", { classe: "muted", texto: e.message }),
        ]),
      );
      return;
    }
    desenharCabecalho();
    if (abertaId) await abrirFicha(abertaId);
    else desenharLista();
  }

  function desenharCabecalho() {
    const r = dados.resumo;
    const naCasa = dados.pessoas.filter((p) => !p.ficha?.desligamento);
    const folha = naCasa.reduce((soma, p) => soma + (Number(p.ficha?.salario) || 0), 0);
    const semSalario = naCasa.filter((p) => !p.ficha?.salario).length;

    // Quatro cartões, não cinco: no celular cada cartão a mais empurra a
    // lista — que é o que o gestor veio ver — para fora da tela. Os
    // desligados viram nota do primeiro em vez de ganhar cartão próprio.
    limpar(cabecalho).append(
      indicador({
        rotulo: "Na casa",
        valor: r.ativos,
        nota: r.desligados ? `${r.desligados} desligado(s) no histórico` : null,
      }),
      indicador({
        rotulo: "Salários combinados",
        valor: dinheiro(folha),
        // Sem encargos de propósito: quem calcula FGTS, INSS e férias é a
        // contabilidade. Dizer "folha" aqui faria o dono planejar por um
        // número que não é o que ele paga.
        nota: semSalario ? `${semSalario} sem salário anotado` : "sem encargos",
      }),
      indicador({ rotulo: "Com pendência", valor: r.com_pendencia, destaque: r.com_pendencia > 0 }),
      indicador({ rotulo: "Documento vencendo", valor: r.documentos_em_alerta, destaque: r.documentos_em_alerta > 0 }),
    );
  }

  /* ================= A lista ================= */

  function pessoasNaTela() {
    const termo = busca.trim().toLowerCase();
    const filtradas = termo
      ? dados.pessoas.filter((p) =>
          [p.nome, p.apelido, p.funcao, p.ficha?.cargo, p.ficha?.telefone]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(termo),
        )
      : dados.pessoas;

    const valor = VALOR_DA_COLUNA[ordem.campo] ?? VALOR_DA_COLUNA.nome;
    return [...filtradas].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const r = va < vb ? -1 : va > vb ? 1 : 0;
      return ordem.desc ? -r : r;
    });
  }

  function desenharLista() {
    abertaId = null;
    limpar(corpo);

    // O mês do contador: por padrão o anterior, que é o que se fecha.
    const mesPassado = new Date();
    mesPassado.setDate(1);
    mesPassado.setMonth(mesPassado.getMonth() - 1);
    const seletorDoMes = el("input", {
      classe: "input",
      type: "month",
      value: mesPassado.toISOString().slice(0, 7),
      title: "Mês do resumo para a contabilidade",
      style: "max-width:160px",
    });

    const campoBusca = el("input", {
      classe: "input",
      type: "search",
      placeholder: "Buscar por nome, função ou telefone…",
      value: busca,
      style: "max-width:320px",
      oninput: (e) => {
        busca = e.target.value;
        desenharLista();
        // Redesenhar troca o campo por um novo: sem devolver o cursor, quem
        // digita a segunda letra digita no vazio.
        const novo = corpo.querySelector('input[type="search"]');
        if (novo) {
          novo.focus();
          novo.setSelectionRange(novo.value.length, novo.value.length);
        }
      },
    });

    corpo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: "Equipe" }),
          el("p", {
            classe: "muted",
            texto: "Quem trabalha na casa, desde quando, quanto ganha e o que falta de documento. Clique numa linha para abrir a ficha.",
          }),
        ]),
        el("div", { classe: "reserva-acoes" }, [
          campoBusca,
          el("button", {
            classe: "btn btn-peq",
            type: "button",
            texto: verDesligados ? "Esconder desligados" : "Ver desligados",
            onclick: async () => {
              verDesligados = !verDesligados;
              await recarregar();
            },
          }),
          el("button", {
            classe: "btn btn-peq",
            type: "button",
            texto: "Mapa DISC",
            title: "O perfil comportamental de cada um, e o que falta na equipe",
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                const mapa = await get(`/v1/venues/${ctx.venue}/rh/disc-equipe`);
                const cartao = cartaoDoMapaDisc(mapa);
                corpo.querySelector(".disc-mapa")?.closest("section")?.remove();
                corpo.children[0]?.after(cartao);
                cartao.scrollIntoView({ behavior: "smooth", block: "start" });
              } catch (err) {
                avisar(err.message, "erro");
              } finally {
                e.target.disabled = false;
              }
            },
          }),
          seletorDoMes,
          botaoDePdf(() => resumoDoMesEmPdf(seletorDoMes.value), "Resumo do mês"),
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "Admitir alguém",
            onclick: () => formularioDeAdmissao(),
          }),
        ]),
      ]),
    );

    if (dados.pessoas.length === 0) {
      corpo.append(
        vazio(
          "Ninguém cadastrado ainda",
          'Clique em "Admitir alguém" para abrir a primeira ficha. Quem você cadastrar aqui já aparece como garçom no cardápio.',
        ),
      );
      return;
    }

    const pessoas = pessoasNaTela();
    if (pessoas.length === 0) {
      corpo.append(vazio("Ninguém com esse nome", "Tente outro pedaço do nome, da função ou do telefone."));
      return;
    }

    const naTela = pessoas.filter((p) => !p.ficha?.desligamento);
    const desligadosNaTela = pessoas.length - naTela.length;
    const somaVisivel = naTela.reduce((soma, p) => soma + (Number(p.ficha?.salario) || 0), 0);

    corpo.append(
      el("div", {}, [
        el("div", { classe: "rolagem-x" }, [
          el("table", { classe: "planilha" }, [
            el("thead", {}, [
              el("tr", {}, [
                colunaOrdenavel("Nome", "nome"),
                colunaOrdenavel("Função", "funcao"),
                colunaOrdenavel("Vínculo", "vinculo"),
                colunaOrdenavel("Admissão", "admissao"),
                colunaOrdenavel("Salário", "salario", "col-num"),
                el("th", { texto: "Telefone" }),
                el("th", { texto: "Situação" }),
              ]),
            ]),
            el(
              "tbody",
              {},
              pessoas.map((pessoa) => linhaDaPessoa(pessoa)),
            ),
            el("tfoot", {}, [
              el("tr", {}, [
                el("td", {
                  colspan: 4,
                  // O total soma só quem está na casa: somar salário de quem
                  // saiu daria um número que não existe.
                  texto: `${naTela.length} na casa${desligadosNaTela ? ` · ${desligadosNaTela} desligado(s)` : ""}`,
                }),
                el("td", { classe: "col-num", texto: dinheiro(somaVisivel) }),
                el("td", { colspan: 2, classe: "muted", texto: "soma de quem está na casa, sem encargos" }),
              ]),
            ]),
          ]),
        ]),
      ]),
    );
  }

  function colunaOrdenavel(rotulo, campo, classe = "") {
    const ativa = ordem.campo === campo;
    return el("th", {
      classe: `${classe} coluna-ordenavel`.trim(),
      style: "cursor:pointer;user-select:none",
      texto: ativa ? `${rotulo} ${ordem.desc ? "▼" : "▲"}` : rotulo,
      title: "Clique para ordenar por esta coluna",
      onclick: () => {
        // Clicar de novo na mesma coluna inverte; coluna nova começa de cima.
        ordem = ativa ? { campo, desc: !ordem.desc } : { campo, desc: false };
        desenharLista();
      },
    });
  }

  function linhaDaPessoa(pessoa) {
    const f = pessoa.ficha;
    const desligado = Boolean(f?.desligamento);

    return el(
      "tr",
      {
        style: "cursor:pointer",
        classe: !desligado && pessoa.pendencias.length ? "linha-atencao" : "",
        onclick: () => abrirFicha(pessoa.id),
      },
      [
        el("td", {}, [
          el("strong", { texto: pessoa.nome }),
          pessoa.apelido ? el("small", { classe: "muted", texto: pessoa.apelido }) : null,
        ]),
        el("td", { texto: f?.cargo || pessoa.funcao || "—" }),
        el("td", { texto: f?.vinculo ? NOME_DO_VINCULO[f.vinculo] ?? f.vinculo : "—" }),
        el("td", {}, [
          document.createTextNode(f?.admissao ? diaBr(f.admissao) : "—"),
          f?.admissao && !desligado ? el("small", { classe: "muted", texto: tempoDeCasa(f.admissao) }) : null,
          desligado ? el("small", { classe: "muted", texto: `saiu ${diaBr(f.desligamento)}` }) : null,
        ]),
        el("td", { classe: "col-num", texto: f?.salario ? dinheiro(f.salario) : "—" }),
        el("td", { texto: telefoneBr(f?.telefone) }),
        el("td", {}, [
          desligado
            ? etiqueta("desligado", "")
            : pessoa.pendencias.length
              ? // A lista inteira alargaria a coluna (a planilha não quebra
                // linha): a primeira pendência conta a história, o resto vira
                // número, e a ficha mostra tudo.
                etiqueta(
                  `falta ${pessoa.pendencias[0].toLowerCase()}${
                    pessoa.pendencias.length > 1 ? ` +${pessoa.pendencias.length - 1}` : ""
                  }`,
                  "etiqueta-alerta",
                )
              : etiqueta("completo", "etiqueta-ok"),
          pessoa.documentos_alerta ? etiqueta(`${pessoa.documentos_alerta} vencendo`, "etiqueta-alerta") : null,
        ]),
      ],
    );
  }

  /**
   * O mês para o contador: dias e horas pela escala, faltas e atrasos
   * registrados, férias e gorjeta. Em paisagem, com uma linha de assinatura.
   */
  async function resumoDoMesEmPdf(mes) {
    let r;
    try {
      r = await get(`/v1/venues/${ctx.venue}/rh/resumo?mes=${mes}`);
    } catch (e) {
      avisar(e.message, "erro");
      return;
    }
    const horas = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;
    const nomeDoMes = new Date(`${mes}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    imprimirRelatorio({
      tipo: "RH",
      titulo: "Resumo do mês para a contabilidade",
      periodo: r.de ? `${nomeDoMes} (${diaBr(r.de)} a ${diaBr(r.ate)})` : nomeDoMes,
      selos: [
        { valor: String(r.linhas.length), rotulo: "pessoas" },
        { valor: String(r.linhas.reduce((t, l) => t + l.faltas, 0)), rotulo: "faltas", ruim: r.linhas.some((l) => l.faltas > 0) },
        { valor: dinheiro(r.linhas.reduce((t, l) => t + l.gorjeta, 0)), rotulo: "gorjeta no mês" },
      ],
      secoes: [{
        nota: "Dias e horas pela escala da casa (horas previstas do turno); faltas marcadas na escala e atrasos registrados pelo gerente; gorjeta do acerto. O cálculo da folha continua com a contabilidade.",
        colunas: [
          { rotulo: "Pessoa" }, { rotulo: "Cargo" }, { rotulo: "Dias", num: true }, { rotulo: "Horas", num: true },
          { rotulo: "Noturnas", num: true }, { rotulo: "Faltas", num: true }, { rotulo: "Atrasos", num: true },
          { rotulo: "Férias", num: true }, { rotulo: "Gorjeta", num: true },
        ],
        linhas: r.linhas.map((l) => ({
          destaque: l.faltas > 0,
          celulas: [
            l.nome, [l.cargo, NOME_DO_VINCULO[l.vinculo] ?? l.vinculo].filter(Boolean).join(" · "), String(l.dias_trabalhados), horas(l.minutos_trabalhados),
            horas(l.minutos_noturnos), String(l.faltas), l.atrasos ? `${l.atrasos} (${l.minutos_de_atraso} min)` : "0",
            l.dias_de_ferias ? `${l.dias_de_ferias} d` : "—", dinheiro(l.gorjeta),
          ],
        })),
        vazio: "Ninguém com movimento no mês.",
      }],
      assinaturas: ["Responsável pela casa"],
      arquivo: `rh-resumo-${mes}`,
      paisagem: true,
    });
  }

  /* ================= Admissão ================= */

  function formularioDeAdmissao() {
    limpar(corpo);

    const nome = campo("Nome completo", el("input", { classe: "input", type: "text", placeholder: "Como está no documento" }));
    const apelido = campo("Como a equipe chama", el("input", { classe: "input", type: "text", placeholder: "Zé do Bar" }));
    const funcao = campo("Função", el("input", { classe: "input", type: "text", placeholder: "Garçom, bar, cozinha, caixa…" }));
    const vinculo = campo("Vínculo", seletorDeVinculo("clt"));
    const admissao = campo("Data de admissão", el("input", { classe: "input", type: "date", value: hoje() }));
    const telefone = campo("Telefone", el("input", { classe: "input", type: "tel", placeholder: "(65) 99999-0000" }));
    const cpf = campo("CPF", el("input", { classe: "input", type: "text", placeholder: "000.000.000-00" }));

    corpo.append(
      el("div", { classe: "cartao" }, [
        el("div", { classe: "cabecalho-secao" }, [
          el("div", {}, [
            el("h2", { texto: "Admitir alguém" }),
            el("p", {
              classe: "muted",
              texto: "O básico agora; o resto (documentos, pagamento, endereço) você completa na ficha depois.",
            }),
          ]),
          el("button", { classe: "btn btn-peq", type: "button", texto: "Cancelar", onclick: () => desenharLista() }),
        ]),
        el("div", { classe: "grade grade-2" }, [nome.caixa, apelido.caixa, funcao.caixa, vinculo.caixa]),
        el("div", { classe: "grade" }, [admissao.caixa, telefone.caixa, cpf.caixa]),
        el("div", { classe: "reserva-acoes" }, [
          el("button", {
            classe: "btn btn-primario",
            type: "button",
            texto: "Admitir",
            onclick: async (e) => {
              if (!nome.campo.value.trim()) {
                avisar("O nome é obrigatório.", "erro");
                return;
              }
              e.target.disabled = true;
              try {
                const r = await post(`/v1/venues/${ctx.venue}/rh`, {
                  nome: nome.campo.value.trim(),
                  apelido: apelido.campo.value.trim() || null,
                  funcao: funcao.campo.value.trim() || null,
                  ficha: {
                    vinculo: vinculo.campo.value,
                    admissao: admissao.campo.value || null,
                    telefone: telefone.campo.value || null,
                    cpf: cpf.campo.value || null,
                    nome_completo: nome.campo.value.trim(),
                    cargo: funcao.campo.value.trim() || null,
                  },
                });
                avisar("Admitido. Agora complete os documentos.", "ok");
                abertaId = r.atendente_id;
                await recarregar();
              } catch (err) {
                avisar(err.message, "erro");
                e.target.disabled = false;
              }
            },
          }),
        ]),
      ]),
    );
    nome.campo.focus();
  }

  /* ================= A ficha ================= */

  async function abrirFicha(id) {
    abertaId = id;
    limpar(corpo).append(el("p", { classe: "muted", texto: "Abrindo a ficha…" }));

    let visao;
    let visao360 = null;
    try {
      // A visão completa é bônus: se ela falhar (migração por rodar), a
      // ficha abre do jeito de antes.
      [visao, visao360] = await Promise.all([
        get(`/v1/venues/${ctx.venue}/rh/${id}`),
        get(`/v1/venues/${ctx.venue}/rh/${id}/360`).catch(() => null),
      ]);
    } catch (e) {
      limpar(corpo).append(vazio("Não deu para abrir a ficha", e.message));
      return;
    }

    const { pessoa, documentos } = visao;
    const f = pessoa.ficha ?? {};
    const desligado = Boolean(f.desligamento);
    limpar(corpo);

    // ---- Cadastro (o que os outros módulos também enxergam) ----
    const nome = campo("Nome no cadastro", el("input", { classe: "input", type: "text", value: pessoa.nome }));
    const apelido = campo("Apelido", el("input", { classe: "input", type: "text", value: pessoa.apelido ?? "" }));
    const funcao = campo("Função", el("input", { classe: "input", type: "text", value: pessoa.funcao ?? "" }));

    // ---- Ficha ----
    const nomeCompleto = campo("Nome completo (documento)", el("input", { classe: "input", type: "text", value: f.nome_completo ?? "" }));
    const cpf = campo("CPF", el("input", { classe: "input", type: "text", value: formatarCpf(f.cpf) }));
    const rg = campo("RG", el("input", { classe: "input", type: "text", value: f.rg ?? "" }));
    const nascimento = campo("Nascimento", el("input", { classe: "input", type: "date", value: f.nascimento ?? "" }));
    const telefone = campo("Telefone", el("input", { classe: "input", type: "tel", value: f.telefone ?? "" }));
    const endereco = campo("Endereço", el("input", { classe: "input", type: "text", value: f.endereco ?? "" }));

    const vinculo = campo("Vínculo", seletorDeVinculo(f.vinculo ?? "clt"));
    const cargo = campo("Cargo", el("input", { classe: "input", type: "text", value: f.cargo ?? "" }));
    const admissao = campo("Admissão", el("input", { classe: "input", type: "date", value: f.admissao ?? "" }));
    const salario = campo("Salário combinado", el("input", { classe: "input", type: "number", step: "0.01", min: "0", value: f.salario ?? "" }));
    const experiencia = camposDaExperiencia(f);

    const forma = campo(
      "Como recebe",
      el(
        "select",
        { classe: "select" },
        FORMAS.map(([id, rotulo]) => el("option", { value: id, texto: rotulo, selected: (f.forma_pagamento ?? "") === id })),
      ),
    );
    const pix = campo("Chave Pix", el("input", { classe: "input", type: "text", value: f.chave_pix ?? "" }));
    const banco = campo("Banco / conta", el("input", { classe: "input", type: "text", value: f.banco ?? "" }));

    const emergenciaNome = campo("Emergência — quem avisar", el("input", { classe: "input", type: "text", value: f.emergencia_nome ?? "" }));
    const emergenciaTel = campo("Emergência — telefone", el("input", { classe: "input", type: "tel", value: f.emergencia_telefone ?? "" }));
    const observacoes = campo("Observações", el("textarea", { classe: "input", rows: 3, texto: f.observacoes ?? "" }));

    corpo.append(
      el("div", { classe: "cabecalho-secao" }, [
        el("div", {}, [
          el("h2", { texto: pessoa.apelido ? `${pessoa.nome} (${pessoa.apelido})` : pessoa.nome }),
          el("p", {
            classe: "muted",
            texto: desligado
              ? `Desligado em ${diaBr(f.desligamento)}${f.motivo_desligamento ? ` · ${f.motivo_desligamento}` : ""}`
              : f.admissao
                ? `Na casa desde ${diaBr(f.admissao)}`
                : "Sem data de admissão",
          }),
        ]),
        el("button", { classe: "btn btn-peq", type: "button", texto: "Voltar", onclick: () => desenharLista() }),
      ]),
    );

    // ---- O resumo da pessoa: experiência, números, link e PDF ----
    const aoMudar = () => abrirFicha(id);
    const resumo = resumoDaPessoa({ ctx, id, pessoa, ficha: f, visao: visao360, documentos, aoMudar });
    if (resumo) corpo.append(resumo);

    // ---- O que falta (admissão guiada) ----
    if (!desligado && pessoa.pendencias.length) {
      corpo.append(
        el("section", { classe: "cartao alerta" }, [
          el("strong", { texto: "Falta para completar a admissão" }),
          el(
            "ul",
            { classe: "muted", style: "padding-left:18px;line-height:1.8;margin:6px 0 0" },
            pessoa.pendencias.map((t) => el("li", { texto: t })),
          ),
        ]),
      );
    }

    corpo.append(
      el("section", { classe: "cartao" }, [
        el("h3", { texto: "Cadastro da casa" }),
        el("p", {
          classe: "muted",
          texto: "É por este nome que a pessoa aparece no cardápio (garçom da mesa) e na pesquisa de satisfação.",
        }),
        el("div", { classe: "grade" }, [nome.caixa, apelido.caixa, funcao.caixa]),
      ]),
      el("section", { classe: "cartao" }, [
        el("h3", { texto: "Dados pessoais" }),
        el("div", { classe: "grade grade-2" }, [nomeCompleto.caixa, cpf.caixa, rg.caixa, nascimento.caixa, telefone.caixa, endereco.caixa]),
      ]),
      el("section", { classe: "cartao" }, [
        el("h3", { texto: "Trabalho" }),
        el("div", { classe: "grade grade-2" }, [vinculo.caixa, cargo.caixa, admissao.caixa, salario.caixa]),
        vinculo.campo.value === "clt" ? experiencia.caixa : null,
        el("p", {
          classe: "muted",
          texto: "O salário fica anotado para a casa saber o que combinou. Imposto, líquido e folha continuam com a contabilidade.",
        }),
      ]),
      el("section", { classe: "cartao" }, [
        el("h3", { texto: "Pagamento" }),
        el("div", { classe: "grade" }, [forma.caixa, pix.caixa, banco.caixa]),
      ]),
      el("section", { classe: "cartao" }, [
        el("h3", { texto: "Emergência e observações" }),
        el("div", { classe: "grade grade-2" }, [emergenciaNome.caixa, emergenciaTel.caixa]),
        observacoes.caixa,
      ]),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Salvar ficha",
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await patch(`/v1/venues/${ctx.venue}/rh/${id}`, {
                cadastro: {
                  nome: nome.campo.value.trim(),
                  apelido: apelido.campo.value.trim() || null,
                  funcao: funcao.campo.value.trim() || null,
                },
                ficha: {
                  nome_completo: nomeCompleto.campo.value,
                  cpf: cpf.campo.value,
                  rg: rg.campo.value,
                  nascimento: nascimento.campo.value || null,
                  telefone: telefone.campo.value,
                  endereco: endereco.campo.value,
                  vinculo: vinculo.campo.value,
                  cargo: cargo.campo.value,
                  admissao: admissao.campo.value || null,
                  salario: salario.campo.value,
                  forma_pagamento: forma.campo.value,
                  chave_pix: pix.campo.value,
                  banco: banco.campo.value,
                  emergencia_nome: emergenciaNome.campo.value,
                  emergencia_telefone: emergenciaTel.campo.value,
                  observacoes: observacoes.campo.value,
                  ...experiencia.valores(),
                },
              });
              avisar("Ficha salva.", "ok");
              await recarregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
        desligado
          ? el("button", {
              classe: "btn",
              type: "button",
              texto: "Readmitir",
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  await post(`/v1/venues/${ctx.venue}/rh/${id}/readmitir`, { admissao: hoje() });
                  avisar("Readmitido. Já volta a aparecer nas listas da casa.", "ok");
                  await recarregar();
                } catch (err) {
                  avisar(err.message, "erro");
                  e.target.disabled = false;
                }
              },
            })
          : el("button", {
              classe: "btn btn-perigo",
              type: "button",
              texto: "Desligar",
              onclick: () => desligarPessoa(id, pessoa.nome),
            }),
      ]),
      secaoDeAvaliacoes({ ctx, id, pessoa, ficha: f, visao: visao360, aoMudar }) ?? el("span", {}),
      secaoDoDisc({ ctx, id, pessoa, ficha: f, visao: visao360 }) ?? el("span", {}),
      secaoDeOcorrencias({ ctx, id, pessoa, ficha: f, visao: visao360, aoMudar }) ?? el("span", {}),
      secaoDeDocumentos(id, documentos),
    );
  }

  function desligarPessoa(id, nomeDaPessoa) {
    const data = el("input", { classe: "input", type: "date", value: hoje() });
    const motivo = el("input", { classe: "input", type: "text", placeholder: "Pediu demissão, fim de contrato, justa causa…" });

    const cartao = el("section", { classe: "cartao alerta" }, [
      el("h3", { texto: `Desligar ${nomeDaPessoa}` }),
      el("p", {
        classe: "muted",
        texto: "A ficha e os documentos ficam guardados — obrigação trabalhista se guarda por anos. A pessoa só sai das listas do dia a dia.",
      }),
      el("div", { classe: "grade grade-2" }, [
        el("div", { classe: "campo" }, [el("label", { texto: "Data do desligamento" }), data]),
        el("div", { classe: "campo" }, [el("label", { texto: "Motivo" }), motivo]),
      ]),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-perigo",
          type: "button",
          texto: "Confirmar desligamento",
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await post(`/v1/venues/${ctx.venue}/rh/${id}/desligar`, {
                data: data.value || null,
                motivo: motivo.value || null,
              });
              avisar("Desligamento registrado.", "ok");
              await recarregar();
            } catch (err) {
              avisar(err.message, "erro");
              e.target.disabled = false;
            }
          },
        }),
        el("button", { classe: "btn btn-peq", type: "button", texto: "Cancelar", onclick: () => cartao.remove() }),
      ]),
    ]);

    corpo.append(cartao);
    cartao.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ================= Documentos ================= */

  function secaoDeDocumentos(id, documentos) {
    const lista = el("div", { classe: "tabela" });

    const tipo = el(
      "select",
      { classe: "select" },
      dados.tipos_de_documento.map((t) => el("option", { value: t.id, texto: t.nome })),
    );
    const titulo = el("input", { classe: "input", type: "text", placeholder: "Ex.: Atestado 3 dias" });
    const validade = el("input", { classe: "input", type: "date" });
    const arquivo = el("input", { classe: "input", type: "file", accept: ".pdf,image/png,image/jpeg,image/webp" });

    if (documentos.length === 0) {
      lista.append(vazio("Nenhum documento guardado", "Suba o RG, a carteira, o exame admissional — o que a casa precisa ter em mãos."));
    }

    for (const doc of documentos) {
      const nomeDoTipo = dados.tipos_de_documento.find((t) => t.id === doc.tipo)?.nome ?? doc.tipo;
      const dias = doc.dias_para_vencer;

      lista.append(
        el("div", { classe: "linha" }, [
          el("div", { style: "flex:1;min-width:200px" }, [
            el("strong", { texto: doc.titulo ? `${nomeDoTipo} — ${doc.titulo}` : nomeDoTipo }),
            el("p", {
              classe: "muted",
              style: "margin:2px 0 0",
              texto: `enviado ${dataHora(doc.enviado_em)}${doc.enviado_por ? ` por ${doc.enviado_por}` : ""}`,
            }),
          ]),
          dias === null
            ? null
            : dias < 0
              ? etiqueta(`venceu há ${Math.abs(dias)} dia(s)`, "etiqueta-alerta")
              : dias <= 30
                ? etiqueta(`vence em ${dias} dia(s)`, "etiqueta-alerta")
                : etiqueta(`vale até ${diaBr(doc.validade)}`, "etiqueta-ok"),
          el("div", { classe: "reserva-acoes" }, [
            el("button", {
              classe: "btn btn-peq",
              type: "button",
              texto: "Abrir",
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  const { url } = await get(`/v1/venues/${ctx.venue}/rh/documentos/${doc.id}/link`);
                  window.open(url, "_blank", "noopener");
                } catch (err) {
                  avisar(err.message, "erro");
                } finally {
                  e.target.disabled = false;
                }
              },
            }),
            el("button", {
              classe: "btn btn-peq btn-perigo",
              type: "button",
              texto: "Apagar",
              onclick: async (e) => {
                if (!confirm("Apagar este documento? Não dá para desfazer.")) return;
                e.target.disabled = true;
                try {
                  await del(`/v1/venues/${ctx.venue}/rh/documentos/${doc.id}`);
                  avisar("Documento apagado.", "ok");
                  await abrirFicha(id);
                } catch (err) {
                  avisar(err.message, "erro");
                  e.target.disabled = false;
                }
              },
            }),
          ]),
        ]),
      );
    }

    return el("section", { classe: "cartao" }, [
      el("h3", { texto: "Documentos" }),
      el("p", {
        classe: "muted",
        texto: "Guardados em cofre: só o dono e o gerente abrem, e o link para ver expira em minutos.",
      }),
      lista,
      el("div", { classe: "grade", style: "margin-top:12px" }, [
        el("div", { classe: "campo" }, [el("label", { texto: "Tipo" }), tipo]),
        el("div", { classe: "campo" }, [el("label", { texto: "Descrição (opcional)" }), titulo]),
        el("div", { classe: "campo" }, [el("label", { texto: "Vence em (opcional)" }), validade]),
        el("div", { classe: "campo" }, [el("label", { texto: "Arquivo (PDF ou foto)" }), arquivo]),
      ]),
      el("div", { classe: "reserva-acoes" }, [
        el("button", {
          classe: "btn btn-primario",
          type: "button",
          texto: "Guardar documento",
          onclick: async (e) => {
            const file = arquivo.files?.[0];
            if (!file) {
              avisar("Escolha o arquivo primeiro.", "erro");
              return;
            }
            e.target.disabled = true;
            try {
              const busca = new URLSearchParams({ tipo: tipo.value });
              if (titulo.value.trim()) busca.set("titulo", titulo.value.trim());
              if (validade.value) busca.set("validade", validade.value);
              await postArquivo(`/v1/venues/${ctx.venue}/rh/${id}/documentos?${busca}`, file);
              avisar("Documento guardado.", "ok");
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

  /* ================= Miudezas ================= */

  function campo(rotulo, campoEl) {
    return { campo: campoEl, caixa: el("div", { classe: "campo" }, [el("label", { texto: rotulo }), campoEl]) };
  }

  function seletorDeVinculo(atual) {
    return el(
      "select",
      { classe: "select" },
      dados.vinculos.map((v) => el("option", { value: v.id, texto: v.nome, selected: v.id === atual })),
    );
  }
}

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

/** "2026-01-10" vira "10/01/2026" — como a casa lê. */
function diaBr(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

/** "há 3 anos", "há 8 meses", "há 12 dias" — o tempo de casa em uma olhada. */
function tempoDeCasa(admissao) {
  const dias = Math.floor((Date.now() - new Date(`${admissao}T12:00:00Z`).getTime()) / 86_400_000);
  if (dias < 0) return "começa em breve";
  if (dias < 31) return `há ${dias} dia${dias === 1 ? "" : "s"}`;
  const meses = Math.floor(dias / 30.44);
  if (meses < 12) return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  return `há ${anos} ano${anos === 1 ? "" : "s"}${resto ? ` e ${resto} m` : ""}`;
}

/** "65999990000" vira "(65) 99999-0000". */
function telefoneBr(digitos) {
  const d = String(digitos ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || "—";
}

function formatarCpf(digitos) {
  const d = String(digitos ?? "").replace(/\D/g, "");
  if (d.length !== 11) return d;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
