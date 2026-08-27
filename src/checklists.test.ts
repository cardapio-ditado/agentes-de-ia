import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agoraLocal, estaNaHora, jsonDaResposta, telefonesDeAviso, validarItens, type AgendaChecklist } from "./checklists.js";

const TZ = "America/Cuiaba"; // UTC-4, sem horário de verão

const agenda = (dias: string[], hora: string): AgendaChecklist => ({
  dias,
  hora,
  responsavel_nome: "João",
  responsavel_telefone: "65999999999",
  avisar_telefone: "",
});

describe("agoraLocal", () => {
  it("converte o instante para o dia e a hora da casa", () => {
    // 2026-08-13 22:00 UTC = quinta 18:00 em Cuiabá
    const local = agoraLocal(new Date("2026-08-13T22:00:00Z"), TZ);
    assert.equal(local.dia, "qui");
    assert.equal(local.data, "2026-08-13");
    assert.equal(local.hhmm, "18:00");
  });

  it("vira o dia da semana no fuso local, não no UTC", () => {
    // 2026-08-14 01:00 UTC ainda é quinta 21:00 em Cuiabá
    const local = agoraLocal(new Date("2026-08-14T01:00:00Z"), TZ);
    assert.equal(local.dia, "qui");
    assert.equal(local.data, "2026-08-13");
  });
});

describe("estaNaHora", () => {
  it("dispara quando o dia bate e a hora já passou", () => {
    const quinta18h = new Date("2026-08-13T22:00:00Z");
    assert.equal(estaNaHora(agenda(["qui"], "17:30"), quinta18h, TZ), true);
    assert.equal(estaNaHora(agenda(["qui"], "18:00"), quinta18h, TZ), true);
  });

  it("não dispara antes da hora nem em dia errado", () => {
    const quinta18h = new Date("2026-08-13T22:00:00Z");
    assert.equal(estaNaHora(agenda(["qui"], "19:00"), quinta18h, TZ), false);
    assert.equal(estaNaHora(agenda(["sex"], "09:00"), quinta18h, TZ), false);
  });

  it("agenda sem dias nunca dispara sozinha (só manual)", () => {
    assert.equal(estaNaHora(agenda([], "09:00"), new Date(), TZ), false);
  });
});

describe("validarItens", () => {
  it("aceita os três tipos e preenche id e obrigatório", () => {
    const itens = validarItens([
      { tipo: "sim_nao", pergunta: "Freezer ligado?" },
      { tipo: "texto", pergunta: "Temperatura da câmara fria", obrigatorio: false },
      { tipo: "foto", pergunta: "Foto da área do bar" },
    ]);
    assert.equal(itens.length, 3);
    assert.ok(itens[0]!.id.length > 0);
    assert.equal(itens[0]!.obrigatorio, true);
    assert.equal(itens[1]!.obrigatorio, false);
  });

  it("recusa lista vazia e tipo desconhecido", () => {
    assert.throws(() => validarItens([]));
    assert.throws(() => validarItens([{ tipo: "nota", pergunta: "x" }]));
  });
});

/**
 * Quem cobra o checklist numa casa de verdade não é uma pessoa só: o gerente
 * responde pelo turno e o líder está no salão. O campo aceita os dois.
 */
describe("telefonesDeAviso", () => {
  it("separa vários números, seja qual for a pontuação", () => {
    assert.deepEqual(telefonesDeAviso("65999990001, 65999990002"), ["65999990001", "65999990002"]);
    assert.deepEqual(telefonesDeAviso("65999990001; 65999990002"), ["65999990001", "65999990002"]);
    assert.deepEqual(telefonesDeAviso("65999990001 / 65999990002"), ["65999990001", "65999990002"]);
    assert.deepEqual(telefonesDeAviso("65999990001\n65999990002"), ["65999990001", "65999990002"]);
  });

  it("limpa a formatação — o número é o que importa", () => {
    assert.deepEqual(telefonesDeAviso("(65) 99999-0001, +55 65 99999-0002"), [
      "65999990001",
      "5565999990002",
    ]);
  });

  it("a mesma pessoa duas vezes recebe UMA mensagem", () => {
    assert.deepEqual(telefonesDeAviso("(65) 99999-0001, 65999990001"), ["65999990001"]);
  });

  it("descarta o que não é telefone em vez de gastar disparo", () => {
    assert.deepEqual(telefonesDeAviso("65999990001, 1234, , abc"), ["65999990001"]);
  });

  it("campo vazio não avisa ninguém", () => {
    assert.deepEqual(telefonesDeAviso(""), []);
    assert.deepEqual(telefonesDeAviso("  ,  ; "), []);
  });

  it("um número só continua funcionando como sempre", () => {
    assert.deepEqual(telefonesDeAviso("65999990001"), ["65999990001"]);
  });
});

/**
 * A resposta da IA cortada no limite de tokens.
 *
 * Foi o que aconteceu ao gerar uma rotina grande de limpeza: o recorte do
 * primeiro "{" ao último "}" pegava um pedaço inválido — ou nada — e o painel
 * mostrava "Unexpected end of JSON input", que não diz nada a quem só queria
 * montar um checklist.
 */
const resposta = (texto, stop = "end_turn") =>
  ({ content: [{ type: "text", text: texto }], stop_reason: stop });

describe("jsonDaResposta", () => {
  it("lê o JSON quando a resposta veio inteira", () => {
    const r = jsonDaResposta(resposta('{"tipo":"pergunta","texto":"quantos itens?"}'), "a rotina");
    assert.equal(r.tipo, "pergunta");
  });

  it("aceita conversa em volta do JSON", () => {
    const r = jsonDaResposta(resposta('Claro!\n{"tipo":"pergunta","texto":"oi"}\nEspero ajudar.'), "a rotina");
    assert.equal(r.texto, "oi");
  });

  it("cortada no limite: explica o que houve, e o que fazer", () => {
    const truncada = resposta('{"tipo":"itens","itens":[{"tipo":"foto","pergunta":"Foto do arm', "max_tokens");
    assert.throws(() => jsonDaResposta(truncada, "a rotina"), /cortada no meio|menos itens/i);
  });

  it("cortada DEPOIS de um item completo também é recusada", () => {
    // O caso traiçoeiro: existe um "}" no fim, mas ele fecha o item, não a
    // lista. Sem olhar o stop_reason, isso viraria JSON inválido silencioso.
    const truncada = resposta(
      '{"tipo":"itens","itens":[{"tipo":"foto","pergunta":"Foto do armário","obrigatorio":true}',
      "max_tokens",
    );
    assert.throws(() => jsonDaResposta(truncada, "a rotina"), /cortada no meio|menos itens/i);
  });

  it("resposta sem JSON nenhum não estoura com erro técnico", () => {
    assert.throws(() => jsonDaResposta(resposta("Desculpe, não entendi."), "a rotina"), /formato inesperado/i);
  });

  it("JSON malformado não estoura com erro técnico", () => {
    assert.throws(() => jsonDaResposta(resposta('{"tipo": itens}'), "a rotina"), /formato inesperado/i);
  });
});
