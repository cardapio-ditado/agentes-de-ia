import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { comContextoDeAgora } from "./agent.js";

/**
 * A data vai junto da última fala do cliente porque o bloco de sistema fica
 * no começo do prompt e, numa conversa com dias de histórico, perde para o
 * que está mais perto da pergunta. Foi assim que um agente passou a dizer que
 * era domingo numa segunda: a conversa tinha mensagens reais de domingo, e
 * ele leu o vizinho mais próximo em vez do bloco distante.
 */
describe("contexto de tempo grudado na mensagem", () => {
  const CONTEXTO = "Data e hora atuais: segunda-feira, 17 de agosto de 2026 às 17:23.";

  it("preserva a fala do cliente no começo, intacta", () => {
    const saida = comContextoDeAgora("tem mesa pra hoje?", CONTEXTO);
    assert.ok(saida.startsWith("tem mesa pra hoje?"));
  });

  it("põe a data DEPOIS da fala, não antes", () => {
    const saida = comContextoDeAgora("que dia é hoje?", CONTEXTO);
    assert.ok(
      saida.indexOf("que dia é hoje?") < saida.indexOf("Data e hora"),
      "a data precisa ser a última coisa antes da resposta",
    );
  });

  it("delimita o contexto para não virar fala do cliente", () => {
    // Sem marcação o modelo pode responder à data como se o cliente a tivesse
    // enviado — "por que você me mandou a hora?".
    const saida = comContextoDeAgora("oi", CONTEXTO);
    assert.ok(saida.includes("<contexto-do-sistema>"));
    assert.ok(saida.includes("</contexto-do-sistema>"));
  });

  it("não estraga mensagem vazia nem com quebras de linha", () => {
    assert.ok(comContextoDeAgora("", CONTEXTO).includes(CONTEXTO));
    const multi = comContextoDeAgora("linha 1\nlinha 2", CONTEXTO);
    assert.ok(multi.startsWith("linha 1\nlinha 2"));
  });
});
