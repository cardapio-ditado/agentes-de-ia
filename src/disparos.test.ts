import assert from "node:assert/strict";
import test from "node:test";
import {
  balanco,
  contextoDoDisparo,
  descreverPublico,
  lacunasDe,
  porQueNaoAgenda,
  preencherVariaveis,
  publicoValido,
  renderizar,
  retratoParaOAgente,
  selecionarPublico,
  sobe,
  statusDaMeta,
  variaveisValidas,
  type Variavel,
} from "./disparos.js";
import { resumirModelo } from "./whatsappOficial.js";
import { retratoDe } from "./crm.js";
import type { Cliente } from "./clientes.js";

const CORPO = "Oi, {{1}}! O {{2}} tem novidade: {{3}}.";
const VARIAVEIS: Variavel[] = [{ tipo: "primeiro_nome" }, { tipo: "casa" }, { tipo: "fixo", texto: "chope em dobro na quinta" }];

test("as lacunas do modelo saem preenchidas com a pessoa, a casa e o texto fixo", () => {
  const valores = preencherVariaveis(VARIAVEIS, { nome: "Renata Prado" }, "Ditado Popular");
  assert.deepEqual(valores, ["Renata", "Ditado Popular", "chope em dobro na quinta"]);
  assert.equal(renderizar(CORPO, valores), "Oi, Renata! O Ditado Popular tem novidade: chope em dobro na quinta.");
  assert.equal(lacunasDe(CORPO), 3);
  assert.equal(lacunasDe("sem lacuna"), 0);
});

test("ninguém recebe lacuna vazia: sem nome vira 'você', fixo vazio vira traço", () => {
  // A Meta recusa parâmetro em branco, e a casa não pode perder o disparo
  // inteiro por causa de um cliente sem nome.
  const valores = preencherVariaveis([{ tipo: "primeiro_nome" }, { tipo: "nome" }, { tipo: "fixo", texto: "  " }], { nome: null }, "Casa");
  assert.deepEqual(valores, ["você", "você", "-"]);
});

test("as variáveis e o público não confiam no que vem da tela", () => {
  assert.deepEqual(variaveisValidas([{ tipo: "primeiro_nome" }, { tipo: "invento" }, { tipo: "fixo", texto: 5 }, "lixo"]), [
    { tipo: "primeiro_nome" },
    { tipo: "fixo", texto: "5" },
  ]);
  assert.deepEqual(publicoValido({ selo: "vip" }), { selo: "vip" });
  assert.deepEqual(publicoValido({ selo: "rei" }), {});
  assert.deepEqual(publicoValido({ aniversario_mes: "10" }), { aniversario_mes: 10 });
  assert.deepEqual(publicoValido({ aniversario_mes: 13, todos: true }), { todos: true });
  assert.equal(descreverPublico({ aniversario_mes: 10 }), "aniversariantes de outubro");
  assert.equal(descreverPublico({ selo: "sumido" }), "clientes sumidos");
  assert.equal(descreverPublico({}), "ninguém escolhido");

  // O DDD anda junto do público, nunca sozinho: "só o 65" de ninguém é ninguém.
  assert.deepEqual(publicoValido({ selo: "sumido", ddd: "(65)" }), { selo: "sumido", ddd: "65" });
  assert.deepEqual(publicoValido({ todos: true, fora_do_ddd: "65" }), { todos: true, fora_do_ddd: "65" });
  assert.deepEqual(publicoValido({ ddd: "65" }), {});
  assert.deepEqual(publicoValido({ selo: "vip", ddd: "abc" }), { selo: "vip" });
  assert.equal(descreverPublico({ selo: "sumido", ddd: "65" }), "clientes sumidos do DDD 65");
  assert.equal(descreverPublico({ todos: true, fora_do_ddd: "65" }), "a base inteira de fora do DDD 65");
});

test("o público sai sem repetir telefone, sem quem pediu para sair e sem quem não tem telefone", () => {
  const base = (t: Partial<Cliente>): Cliente => ({
    id: "x", telefone: "", nome: null, nascimento_dia: null, nascimento_mes: null, nascimento_ano: null,
    email: null, documento: null, observacoes: null, origens: [], visitas: 0, gasto_total_centavos: 0,
    ultima_visita: null, descadastrado_em: null, criado_em: "", ...t,
  });
  const lista = selecionarPublico([
    base({ id: "a", telefone: "5565999990000", nome: "Ana" }),
    base({ id: "b", telefone: "+55 65 99999-0000", nome: "Ana de novo" }),
    base({ id: "c", telefone: "5565988880000", descadastrado_em: "2026-09-01T00:00:00Z" }),
    base({ id: "d", telefone: "abc" }),
    base({ id: "e", telefone: "5565977770000", nome: "Edu" }),
  ]);
  assert.deepEqual(lista.map((p) => p.id), ["a", "e"]);
});

test("o balanço conta a escada: quem leu também foi entregue e enviado", () => {
  const b = balanco([
    { status: "pendente" }, { status: "enviado" }, { status: "entregue" }, { status: "lido" }, { status: "respondeu" }, { status: "falhou" },
  ]);
  assert.deepEqual(b, { pessoas: 6, pendentes: 1, enviados: 4, entregues: 3, lidos: 2, responderam: 1, falharam: 1 });
});

test("o status só sobe: 'lida' que chega antes de 'entregue' não é desfeita", () => {
  assert.equal(statusDaMeta("delivered"), "entregue");
  assert.equal(statusDaMeta("read"), "lido");
  assert.equal(statusDaMeta("failed"), "falhou");
  assert.equal(statusDaMeta("sent"), null);
  assert.equal(sobe("enviado", "lido"), true);
  assert.equal(sobe("lido", "entregue"), false);
  assert.equal(sobe("respondeu", "lido"), false);
  assert.equal(sobe("pendente", "falhou"), true);
});

test("não agenda sem modelo, sem público ou com lacuna a menos", () => {
  const base = { modelo: "promo", corpo: CORPO, variaveis: VARIAVEIS, publico: { selo: "vip" as const }, status: "rascunho" as const };
  assert.deepEqual(porQueNaoAgenda(base), []);
  assert.match(porQueNaoAgenda({ ...base, modelo: "" })[0]!, /modelo/);
  assert.match(porQueNaoAgenda({ ...base, publico: {} })[0]!, /quem recebe/);
  assert.match(porQueNaoAgenda({ ...base, variaveis: VARIAVEIS.slice(0, 2) })[0]!, /3 lacuna/);
  assert.match(porQueNaoAgenda({ ...base, status: "concluido" })[0]!, /já saiu/);
});

test("o agente recebe o que a pessoa leu, e o botão que ela tocou", () => {
  const texto = contextoDoDisparo(
    { nome: "Quinta do chope", corpo: CORPO, variaveis: VARIAVEIS },
    { nome: "Bruno Camargo", enviado_em: "2026-09-24T21:00:00.000Z" },
    "Ditado Popular",
    "America/Cuiaba",
    "Quero!",
  );
  assert.match(texto, /RESPONDENDO/);
  assert.match(texto, /24\/09/);
  assert.match(texto, /Oi, Bruno! O Ditado Popular tem novidade/);
  assert.match(texto, /botão "Quero!"/);
  assert.match(texto, /não pergunte "como posso ajudar"/);
});

test("o retrato para o agente diz quem é a pessoa em uma frase", () => {
  const sumido = retratoDe({ visitas: 11, gasto_total_centavos: 520_000, ultima_visita: "2026-06-02" }, "2026-09-25");
  const texto = retratoParaOAgente({ nome: "Bruno Camargo", ultima_visita: "2026-06-02" }, sumido);
  assert.match(texto, /Bruno Camargo — cliente Sumido/);
  assert.match(texto, /11 visita/);
  assert.match(texto, /R\$ 473/);
  assert.match(texto, /trazer de volta/);

  const nunca = retratoParaOAgente({ nome: null, ultima_visita: null }, retratoDe({ visitas: 0, gasto_total_centavos: 0, ultima_visita: null }, "2026-09-25"));
  assert.match(nunca, /sem nome/);
  assert.match(nunca, /Nunca teve visita/);
});

test("o modelo da Meta vira o nosso vocabulário, e diz quando não dá para mandar daqui", () => {
  const bom = resumirModelo({
    name: "quinta_do_chope",
    language: "pt_BR",
    category: "MARKETING",
    status: "APPROVED",
    components: [
      { type: "BODY", text: "Oi, {{1}}! Quinta tem chope em dobro no {{2}}." },
      { type: "FOOTER", text: "Responda SAIR para não receber mais." },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero!" }, { type: "QUICK_REPLY", text: "Não, obrigado" }] },
    ],
  });
  assert.equal(bom.lacunas, 2);
  assert.deepEqual(bom.botoes, ["Quero!", "Não, obrigado"]);
  assert.equal(bom.suportado, true);

  const comImagem = resumirModelo({ name: "x", status: "APPROVED", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "oi" }] });
  assert.equal(comImagem.suportado, false);
  assert.match(comImagem.motivo!, /imagem/);

  const pendente = resumirModelo({ name: "y", status: "PENDING", components: [{ type: "BODY", text: "oi" }] });
  assert.match(pendente.motivo!, /não aprovou/);
});
