import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toMessageParam } from "./agent.js";
import type { Message } from "./repository.js";

/**
 * O histórico que o modelo relê depois de uma conversa passar por uma pessoa.
 *
 * Um caso real: o gerente assumiu, respondeu pelo painel, devolveu ao agente
 * — e o agente passou a responder "tive um problema técnico" para sempre
 * naquela conversa. A resposta humana é gravada com uma etiqueta no campo
 * `blocks`, e a etiqueta ia para a API como se fosse conteúdo.
 */
const linha = (parte: Partial<Message>): Message =>
  ({
    id: "m1",
    conversation_id: "c1",
    role: "user",
    content: null,
    blocks: null,
    created_at: "2026-09-03T00:00:00Z",
    ...parte,
  }) as unknown as Message;

describe("toMessageParam", () => {
  it("a resposta escrita por uma pessoa vai como texto, não como etiqueta", () => {
    const m = toMessageParam(
      linha({
        role: "assistant",
        content: "Oi! Sou o Carlos, do Ditado. Tem mesa sim, pode vir.",
        blocks: { origem: "humano", autor: "painel" } as unknown as Message["blocks"],
      }),
    );
    assert.equal(m.role, "assistant");
    assert.equal(m.content, "Oi! Sou o Carlos, do Ditado. Tem mesa sim, pode vir.");
  });

  it("o que o modelo devolveu continua indo como blocos", () => {
    const blocos = [{ type: "text", text: "Boa noite!" }];
    const m = toMessageParam(
      linha({ role: "assistant", content: "Boa noite!", blocks: blocos as unknown as Message["blocks"] }),
    );
    assert.deepEqual(m.content, blocos);
  });

  it("resultado de ferramenta vira turno de usuário com os blocos", () => {
    const blocos = [{ type: "tool_result", tool_use_id: "t1", content: "ok" }];
    const m = toMessageParam(linha({ role: "tool", blocks: blocos as unknown as Message["blocks"] }));
    assert.equal(m.role, "user");
    assert.deepEqual(m.content, blocos);
  });

  it("mensagem do cliente sem blocos vai como o texto dela", () => {
    const m = toMessageParam(linha({ role: "user", content: "[foto recebida]" }));
    assert.equal(m.role, "user");
    assert.equal(m.content, "[foto recebida]");
  });
});
