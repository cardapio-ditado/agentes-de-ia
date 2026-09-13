import assert from "node:assert/strict";
import test from "node:test";
import {
  AREAS,
  SETORES,
  arrumarFatos,
  comoFazTempo,
  filaDoCarteiro,
  minutosEntre,
  montarMesas,
  montarSetores,
  motivoDaFalha,
  nomeDoAviso,
  oQueCadaUmFaz,
  primeiroNome,
  setorDaFuncao,
  type Fato,
  type Trabalhador,
} from "./aCasa.js";

const fato = (id: string, setor: string, quando: string, extra: Partial<Fato> = {}): Fato => ({
  id,
  quando,
  setor,
  tipo: "teste",
  titulo: "Alguma coisa aconteceu",
  detalhe: null,
  quem: null,
  atencao: false,
  ...extra,
});

const TODOS = ["agentes-ia", "cmv", "rh", "cardapio-digital", "checklist", "clientes"];

test("a casa tem as quatro áreas, e toda baia mora em uma delas", () => {
  const ids = SETORES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "baia repetida apareceria duas vezes na planta");

  assert.deepEqual(AREAS.map((a) => a.id), ["recepcao", "salao", "doca", "administrativo"]);

  const areas = new Set(AREAS.map((a) => a.id));
  for (const s of SETORES) {
    assert.ok(areas.has(s.area), `${s.id} aponta para uma área que não existe`);
    assert.ok(s.nome.length > 0 && s.legenda.length > 0, `${s.id} sem nome ou sem legenda`);
  }

  // Nenhuma área fica vazia: área sem baia seria um chão desenhado à toa.
  for (const a of AREAS) {
    assert.ok(SETORES.some((s) => s.area === a.id), `a área ${a.id} não tem baia nenhuma`);
  }

  // O administrativo é o que o dono pediu: RH, financeiro e atendimento.
  const admin = SETORES.filter((s) => s.area === "administrativo").map((s) => s.id);
  for (const esperado of ["rh", "financeiro", "atendimento"]) {
    assert.ok(admin.includes(esperado), `falta ${esperado} no administrativo`);
  }
});

test("o financeiro aparece como EM BREVE, e não como não contratado", () => {
  // A diferença importa: "não contratado" é convite de venda; "em breve" é
  // promessa. Dizer a coisa errada queima uma das duas.
  const financeiro = SETORES.find((s) => s.id === "financeiro")!;
  assert.equal(financeiro.em_breve, true);
  assert.equal(financeiro.area, "administrativo");

  // E ninguém contrata um módulo que não existe: ele nunca acende sozinho.
  const setores = montarSetores({ fatos: [], contratados: TODOS, agora: "2026-09-13T10:00:00.000Z" });
  assert.equal(setores.find((s) => s.id === "financeiro")!.contratado, false);
});

test("cada função vai para a sala onde ela trabalha, com o cadastro torto que existe", () => {
  // O cadastro do bar tem "GARCOM", "garçom" e "Garçonete" na mesma lista.
  assert.equal(setorDaFuncao("GARCOM"), "salao");
  assert.equal(setorDaFuncao("garçom"), "salao");
  assert.equal(setorDaFuncao("Garçonete"), "salao");
  assert.equal(setorDaFuncao("Auxiliar de Cozinha"), "cozinha");
  assert.equal(setorDaFuncao("CHAPEIRO"), "cozinha");
  assert.equal(setorDaFuncao("Estoquista"), "recebimento");
  assert.equal(setorDaFuncao("subgerente"), "rh");
  assert.equal(setorDaFuncao("Caixa"), "financeiro");
  assert.equal(setorDaFuncao("Segurança"), "recepcao");
  assert.equal(setorDaFuncao("Barman"), "salao", "quem não se encaixa fica no salão");
  assert.equal(setorDaFuncao(null), "salao");

  // Toda sala apontada existe de verdade na planta.
  const ids = new Set(SETORES.map((s) => s.id));
  for (const f of ["GARCOM", "Cozinha", "Estoquista", "gerente", "Portaria", "Limpeza", "Caixa", null] as Array<string | null>) {
    assert.ok(ids.has(setorDaFuncao(f)), `${f} foi para uma sala que não existe`);
  }
});

test("fato repetido não entra duas vezes", () => {
  // A tela pergunta de novo a cada quinze segundos, e a borda da janela
  // devolve o mesmo fato. Sem o corte pelo id, o bonequinho andaria de novo.
  const r = arrumarFatos([
    fato("a", "recepcao", "2026-09-12T10:00:00.000Z"),
    fato("a", "recepcao", "2026-09-12T10:00:00.000Z"),
    fato("b", "recebimento", "2026-09-12T11:00:00.000Z"),
  ]);
  assert.deepEqual(r.map((f) => f.id), ["b", "a"], "o mais novo primeiro, e sem repetir");
});

test("o limite corta os mais velhos, nunca os mais novos", () => {
  const muitos = Array.from({ length: 30 }, (_, i) =>
    fato(`f${i}`, "recepcao", `2026-09-12T${String(i % 24).padStart(2, "0")}:00:00.000Z`));
  const r = arrumarFatos(muitos, 5);
  assert.equal(r.length, 5);
  assert.equal(r[0]!.quando > r[4]!.quando, true);
});

test("baia sem contrato fica apagada e não conta nada", () => {
  const fatos = [fato("a", "recebimento", "2026-09-12T10:00:00.000Z")];
  const setores = montarSetores({ fatos, contratados: ["agentes-ia"], agora: "2026-09-12T10:30:00.000Z" });

  const doca = setores.find((s) => s.id === "recebimento")!;
  assert.equal(doca.contratado, false);
  assert.equal(doca.quantos, 0);
  assert.equal(doca.ultimo, null);
  assert.equal(doca.minutos_parado, null, "cobrar 'parado há 30 min' de quem não comprou é mentira");

  assert.equal(setores.find((s) => s.id === "recepcao")!.contratado, true);
});

test("o setor guarda o fato mais recente e há quanto tempo foi", () => {
  const setores = montarSetores({
    fatos: arrumarFatos([
      fato("velho", "recebimento", "2026-09-12T08:00:00.000Z", { titulo: "Contagem aberta" }),
      fato("novo", "recebimento", "2026-09-12T10:00:00.000Z", { titulo: "Mercadoria recebida" }),
    ]),
    contratados: TODOS,
    agora: "2026-09-12T10:45:00.000Z",
  });

  const doca = setores.find((s) => s.id === "recebimento")!;
  assert.equal(doca.quantos, 2);
  assert.equal(doca.ultimo!.titulo, "Mercadoria recebida");
  assert.equal(doca.minutos_parado, 45);
});

test("baia contratada e sem movimento aparece como quieta, não como erro", () => {
  const setores = montarSetores({ fatos: [], contratados: TODOS, agora: "2026-09-12T10:00:00.000Z" });
  for (const s of setores.filter((x) => !x.em_breve)) {
    assert.equal(s.contratado, true);
    assert.equal(s.quantos, 0);
    assert.equal(s.minutos_parado, null);
  }
});

test("o tempo é dito como gente fala", () => {
  assert.equal(comoFazTempo(null), "nada ainda");
  assert.equal(comoFazTempo(0), "agora mesmo");
  assert.equal(comoFazTempo(12), "há 12 min");
  assert.equal(comoFazTempo(59), "há 59 min");
  assert.equal(comoFazTempo(60), "há 1 h");
  assert.equal(comoFazTempo(180), "há 3 h");
  assert.equal(comoFazTempo(60 * 24), "ontem");
  assert.equal(comoFazTempo(60 * 72), "há 3 dias");
});

test("minutos entre dois instantes nunca é negativo", () => {
  assert.equal(minutosEntre("2026-09-12T10:00:00.000Z", "2026-09-12T10:30:00.000Z"), 30);
  // Relógio do servidor atrás do carimbo do banco acontece; virar número
  // negativo faria a tela dizer "parado há -2 min".
  assert.equal(minutosEntre("2026-09-12T10:30:00.000Z", "2026-09-12T10:00:00.000Z"), 0);
});

test("o bonequinho leva só o primeiro nome", () => {
  assert.equal(primeiroNome("Juliana Barbosa dos Santos"), "Juliana");
  assert.equal(primeiroNome("  Cida  "), "Cida");
  assert.equal(primeiroNome(""), null);
  assert.equal(primeiroNome(null), null);
});

test("o que precisa de atenção continua marcado depois de arrumado", () => {
  const r = arrumarFatos([
    fato("a", "recepcao", "2026-09-12T10:00:00.000Z", { atencao: true, titulo: "Reserva esperando" }),
    fato("b", "salao", "2026-09-12T11:00:00.000Z"),
  ]);
  assert.equal(r.filter((f) => f.atencao).length, 1);
  assert.equal(r.find((f) => f.atencao)!.titulo, "Reserva esperando");
});

// ============================================================
// Quem está fazendo o quê
// ============================================================

const trabalhador = (nome: string, setor: string, extra: Partial<Trabalhador> = {}): Trabalhador => ({
  id: `pessoa:${nome}`,
  nome,
  tipo: "pessoa",
  papel: null,
  setor,
  fazendo: null,
  desde: null,
  minutos_parado: null,
  em_pausa: false,
  ...extra,
});

test("quem acabou de fazer alguma coisa aparece fazendo aquilo", () => {
  const r = oQueCadaUmFaz({
    trabalhadores: [trabalhador("Juliana", "salao")],
    fatos: [fato("a", "salao", "2026-09-12T20:50:00.000Z", { quem: "Juliana", titulo: "Mesa 12: Chamou o garçom" })],
    agora: "2026-09-12T21:00:00.000Z",
  });
  assert.equal(r[0]!.fazendo, "Mesa 12: Chamou o garçom");
  assert.equal(r[0]!.minutos_parado, 10);
});

test("quem não fez nada há muito tempo fica ocioso, e a tela diz há quanto", () => {
  const r = oQueCadaUmFaz({
    trabalhadores: [trabalhador("Cida", "cozinha", { desde: "2026-09-12T18:00:00.000Z" })],
    fatos: [fato("a", "cozinha", "2026-09-12T18:10:00.000Z", { quem: "Cida", titulo: "Produziu 4 lote(s)" })],
    agora: "2026-09-12T21:00:00.000Z",
  });
  assert.equal(r[0]!.fazendo, null, "quase três horas depois não é mais 'fazendo'");
  assert.equal(r[0]!.minutos_parado, 170);
});

test("a fronteira do ocioso é o limite, não um chute", () => {
  const cenario = (minutos: number) => oQueCadaUmFaz({
    trabalhadores: [trabalhador("JB", "salao")],
    fatos: [fato("a", "salao", "2026-09-12T21:00:00.000Z", { quem: "JB", titulo: "Bateu entrada" })],
    agora: new Date(Date.parse("2026-09-12T21:00:00.000Z") + minutos * 60000).toISOString(),
    minutosParaOcioso: 25,
  })[0];

  assert.equal(cenario(25)!.fazendo, "Bateu entrada", "em cima do limite ainda está fazendo");
  assert.equal(cenario(26)!.fazendo, null, "um minuto depois, ocioso");
});

test("quem está em pausa não é ocioso: está em pausa", () => {
  const r = oQueCadaUmFaz({
    trabalhadores: [trabalhador("Tiago", "salao", { em_pausa: true, desde: "2026-09-12T20:40:00.000Z" })],
    fatos: [fato("a", "salao", "2026-09-12T20:58:00.000Z", { quem: "Tiago", titulo: "Mesa 7: Curtiu um item" })],
    agora: "2026-09-12T21:00:00.000Z",
  });
  assert.equal(r[0]!.fazendo, null);
  assert.equal(r[0]!.em_pausa, true);
  assert.equal(r[0]!.minutos_parado, 20, "conta desde a pausa, não desde o último fato");
});

test("o agente que já sabe o que faz não tem isso sobrescrito", () => {
  const r = oQueCadaUmFaz({
    trabalhadores: [trabalhador("Atendente", "atendimento", { tipo: "agente", fazendo: "Respondendo Renata" })],
    fatos: [],
    agora: "2026-09-12T21:00:00.000Z",
  });
  assert.equal(r[0]!.fazendo, "Respondendo Renata");
});

test("fato de outra pessoa não vira trabalho de quem tem nome parecido", () => {
  const r = oQueCadaUmFaz({
    trabalhadores: [trabalhador("Ana", "salao"), trabalhador("Ana Paula", "salao")],
    fatos: [fato("a", "salao", "2026-09-12T20:55:00.000Z", { quem: "Ana Paula", titulo: "Mesa 3" })],
    agora: "2026-09-12T21:00:00.000Z",
  });
  // "Ana Paula" casa com "Ana Paula" e, por prefixo, também com "Ana" —
  // o cadastro guarda apelido e nome completo da mesma pessoa.
  assert.equal(r.find((t) => t.nome === "Ana Paula")!.fazendo, "Mesa 3");

  const semParentesco = oQueCadaUmFaz({
    trabalhadores: [trabalhador("Marcos", "recepcao")],
    fatos: [fato("a", "recepcao", "2026-09-12T20:55:00.000Z", { quem: "Marcelo", titulo: "Bateu entrada" })],
    agora: "2026-09-12T21:00:00.000Z",
  });
  assert.equal(semParentesco[0]!.fazendo, null, "Marcelo não é Marcos");
});

test("ninguém na casa não quebra a conta", () => {
  const r = oQueCadaUmFaz({ trabalhadores: [], fatos: [], agora: "2026-09-12T21:00:00.000Z" });
  assert.deepEqual(r, []);
});

// ============================================================
// As mesas do salão
// ============================================================

test("a mesa acende quando alguém lê o QR, e apaga sozinha depois", () => {
  const agora = "2026-09-12T21:00:00.000Z";
  const mesas = montarMesas({
    cadastro: [1, 2, 3],
    sessoes: [
      { mesa: 1, cliente: "Renata", olhando: "Costela no bafo", ultimoEm: "2026-09-12T20:52:00.000Z" },
      // Abriu o cardápio de manhã e foi embora: a sessão continua "ativa" no
      // banco, mas ninguém está sentado ali.
      { mesa: 2, cliente: "Alguém", olhando: null, ultimoEm: "2026-09-12T14:00:00.000Z" },
    ],
    chamados: [],
    garcons: new Map(),
    agora,
  });

  const um = mesas.find((m) => m.numero === 1)!;
  assert.equal(um.estado, "ocupada");
  assert.equal(um.cliente, "Renata");
  assert.equal(um.olhando, "Costela no bafo");
  assert.equal(um.minutos, 8);

  const dois = mesas.find((m) => m.numero === 2)!;
  assert.equal(dois.estado, "livre", "sete horas depois ninguém está mais na mesa");
  assert.equal(dois.cliente, null, "e não se mostra o nome de quem já foi embora");

  assert.equal(mesas.find((m) => m.numero === 3)!.estado, "livre");
});

test("mesa que chamou o garçom pisca, e é o estado que manda", () => {
  const mesas = montarMesas({
    cadastro: [5],
    sessoes: [{ mesa: 5, cliente: "Paulo", olhando: null, ultimoEm: "2026-09-12T20:58:00.000Z" }],
    chamados: [{ mesa: 5, em: "2026-09-12T20:57:00.000Z" }],
    garcons: new Map([[5, "Juliana"]]),
    agora: "2026-09-12T21:00:00.000Z",
  });
  assert.equal(mesas[0]!.estado, "chamando", "chamar o garçom manda sobre estar ocupada");
  assert.equal(mesas[0]!.garcom, "Juliana");
});

test("chamado velho para de piscar", () => {
  const mesas = montarMesas({
    cadastro: [5],
    sessoes: [],
    chamados: [{ mesa: 5, em: "2026-09-12T20:00:00.000Z" }],
    garcons: new Map(),
    agora: "2026-09-12T21:00:00.000Z",
  });
  assert.equal(mesas[0]!.estado, "livre", "uma hora depois o garçom já foi lá");
});

test("o salão vazio mostra as mesas no lugar, e não um vazio", () => {
  const mesas = montarMesas({
    cadastro: [1, 2, 3, 4, 5],
    sessoes: [],
    chamados: [],
    garcons: new Map(),
    agora: "2026-09-12T21:00:00.000Z",
  });
  assert.equal(mesas.length, 5);
  assert.ok(mesas.every((m) => m.estado === "livre"));
  assert.deepEqual(mesas.map((m) => m.numero), [1, 2, 3, 4, 5], "em ordem, como no salão");
});

test("mesa com movimento e sem cadastro aparece assim mesmo", () => {
  // Acontece: alguém colou o QR de uma mesa nova e não cadastrou.
  const mesas = montarMesas({
    cadastro: [1, 2],
    sessoes: [{ mesa: 99, cliente: "Ana", olhando: null, ultimoEm: "2026-09-12T20:59:00.000Z" }],
    chamados: [],
    garcons: new Map(),
    agora: "2026-09-12T21:00:00.000Z",
  });
  assert.deepEqual(mesas.map((m) => m.numero), [1, 2, 99]);
  assert.equal(mesas.find((m) => m.numero === 99)!.estado, "ocupada");
});

// ============================================================
// A fila do Carteiro — o que o clique no agente abre
// ============================================================

test("a fila do carteiro põe o que falhou na frente, com o motivo", () => {
  const linhas = filaDoCarteiro([
    { status: "pending", template: "pesquisa_convite", destination: "65 9999-0000", error: null, created_at: "2026-09-12T23:00:00.000Z" },
    { status: "failed", template: "reserva_aprovada", destination: "189554237694113", error: 'Telefone inválido: "189554237694113".', created_at: "2026-08-14T01:41:31.000Z" },
  ]);

  assert.equal(linhas[0]!.titulo, "Confirmação de reserva", "o problema vem primeiro, ainda que seja o mais antigo");
  assert.equal(linhas[0]!.ruim, true);
  assert.match(linhas[0]!.detalhe!, /não é um número de WhatsApp/, "diz o que fazer, não o que o servidor achou");
  assert.equal(linhas[1]!.ruim, false);
  assert.match(linhas[1]!.detalhe!, /na fila para enviar/);
});

test("aviso parado esperando o conector diz isso, e não 'na fila'", () => {
  const [linha] = filaDoCarteiro([{
    status: "pending",
    template: "reserva_aprovada",
    destination: "189554237694113@lid",
    error: "Esperando o conector do WhatsApp: este contato só é alcançável por ele.",
    created_at: "2026-09-12T23:00:00.000Z",
  }]);
  assert.equal(linha!.ruim, false, "não é falha: ninguém precisa correr");
  assert.match(linha!.detalhe!, /Esperando o conector/);
});

test("aviso sem nome conhecido ainda aparece legível", () => {
  // Template novo entra no sistema antes de alguém traduzir o nome dele.
  assert.equal(nomeDoAviso("promo_quarta_feira"), "promo quarta feira");
  assert.equal(nomeDoAviso(null), "Aviso");
});

test("o motivo da falha cabe numa linha", () => {
  assert.equal(motivoDaFalha(null), "Não deu para enviar");
  assert.match(motivoDaFalha("Template not approved by Meta"), /não está aprovado/);
  assert.match(motivoDaFalha("Expired token"), /conexão com o WhatsApp caiu/);
  // O que não se reconhece passa cru, mas cortado: a gaveta tem de caber.
  const comprido = motivoDaFalha("x".repeat(400));
  assert.equal(comprido.length, 120);
});
