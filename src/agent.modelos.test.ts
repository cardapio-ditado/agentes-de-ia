import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suportaRaciocinioAdaptativo } from "./agent.js";
import { MODELO_DE_CORTESIA, MOTORES } from "./pontos.js";

/**
 * `thinking: adaptive` só existe da geração 4.6 em diante. Mandar para um
 * modelo antigo devolve 400 e o cliente do restaurante recebe "problema
 * técnico" — sem nada no painel indicando o motivo.
 */
describe("suporte a raciocínio adaptativo por modelo", () => {
  it("aceita nos modelos 4.6 em diante", () => {
    for (const m of [
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-6",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
      "claude-fable-5",
    ]) {
      assert.equal(suportaRaciocinioAdaptativo(m), true, `${m} deveria aceitar`);
    }
  });

  it("recusa no Haiku 4.5, que é de geração anterior", () => {
    // O "4" no nome engana: haiku-4-5 é ANTERIOR ao sonnet-4-6.
    assert.equal(suportaRaciocinioAdaptativo("claude-haiku-4-5-20251001"), false);
  });

  it("recusa em modelo desconhecido", () => {
    // Diante da dúvida, não mandar: o pedido funciona sem o campo, e o custo
    // de omitir é menor que o de derrubar um atendimento.
    assert.equal(suportaRaciocinioAdaptativo("modelo-que-nao-existe"), false);
  });

  it("o motor de cortesia não pede adaptativo", () => {
    // Este é o caso que quebrou em produção: a cortesia força o Haiku, então
    // o modo criado para manter o restaurante atendendo quando os pontos
    // acabam seria justamente o único que nunca funcionaria.
    assert.equal(suportaRaciocinioAdaptativo(MODELO_DE_CORTESIA), false);
  });

  it("todo motor oferecido no painel resolve para algum comportamento válido", () => {
    // Não exige que todos aceitem adaptativo — exige que a função responda
    // sem explodir para cada um dos que o cliente pode escolher.
    for (const motor of MOTORES) {
      assert.equal(typeof suportaRaciocinioAdaptativo(motor.id), "boolean");
    }
  });
});
