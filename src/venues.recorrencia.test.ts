import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gerarOcorrencias } from "./venues.js";

const TZ = "America/Cuiaba"; // UTC-4, sem horário de verão

describe("gerarOcorrencias", () => {
  it("semanal em dois dias respeita o horário local em cada ocorrência", () => {
    // Quarta 19/08/2026 20:00 em Cuiabá = 00:00 UTC de 20/08.
    const primeiraData = new Date("2026-08-20T00:00:00Z");
    const datas = gerarOcorrencias({
      primeiraData,
      timezone: TZ,
      freq: "weekly",
      dias: ["qua", "sex"],
      ate: new Date(Date.UTC(2026, 8, 5)), // 05/09/2026
    });

    const isoLocal = datas.map((d) => d.toISOString());
    assert.deepEqual(isoLocal, [
      "2026-08-20T00:00:00.000Z", // qua 19/08 20h Cuiabá
      "2026-08-22T00:00:00.000Z", // sex 21/08 20h Cuiabá
      "2026-08-27T00:00:00.000Z", // qua 26/08
      "2026-08-29T00:00:00.000Z", // sex 28/08
      "2026-09-03T00:00:00.000Z", // qua 02/09
      "2026-09-05T00:00:00.000Z", // sex 04/09
    ]);
  });

  it("diária gera uma ocorrência por dia dentro do intervalo", () => {
    const primeiraData = new Date("2026-12-20T22:00:00Z"); // 18h Cuiabá
    const datas = gerarOcorrencias({
      primeiraData,
      timezone: TZ,
      freq: "daily",
      ate: new Date(Date.UTC(2026, 11, 23)), // 23/12
    });
    assert.equal(datas.length, 4); // 20, 21, 22, 23
    assert.equal(datas[0]!.toISOString(), "2026-12-20T22:00:00.000Z");
    assert.equal(datas[3]!.toISOString(), "2026-12-23T22:00:00.000Z");
  });

  it("não inclui ocorrências antes da primeira data", () => {
    // Primeira data cai numa sexta; pedir "toda quarta e sexta" não deve
    // voltar pra quarta da mesma semana, que já passou.
    const primeiraData = new Date("2026-08-22T00:00:00Z"); // sex 21/08 20h Cuiabá
    const datas = gerarOcorrencias({
      primeiraData,
      timezone: TZ,
      freq: "weekly",
      dias: ["qua", "sex"],
      ate: new Date(Date.UTC(2026, 7, 27)), // 27/08, antes da próxima sexta
    });
    assert.deepEqual(
      datas.map((d) => d.toISOString()),
      ["2026-08-22T00:00:00.000Z", "2026-08-27T00:00:00.000Z"],
    );
  });

  it("dia da semana sem ocorrência no intervalo retorna lista vazia", () => {
    const primeiraData = new Date("2026-08-20T00:00:00Z"); // qua
    const datas = gerarOcorrencias({
      primeiraData,
      timezone: TZ,
      freq: "weekly",
      dias: ["dom"],
      ate: new Date(Date.UTC(2026, 7, 22)), // sáb 22/08 — antes do próximo domingo
    });
    assert.deepEqual(datas, []);
  });
});
