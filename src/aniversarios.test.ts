import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diaDoParabens, diasAte, primeiroNome, textoDeParabens } from "./aniversarios.js";

/**
 * As três decisões que a varredura toma antes de tocar no banco: QUE dia
 * procurar, COMO chamar a pessoa e O QUE escrever. Errar qualquer uma manda
 * mensagem errada para gente de verdade — e mensagem enviada não volta.
 */

describe("diaDoParabens", () => {
  const cuiaba = "America/Cuiaba"; // UTC-4, sem horário de verão

  it("sem antecedência, é o aniversário de hoje na casa", () => {
    const agora = new Date("2026-05-10T15:00:00Z"); // 11h em Cuiabá
    assert.deepEqual(diaDoParabens(cuiaba, 0, agora), { dia: 10, mes: 5, ano: 2026 });
  });

  it("com antecedência, anda para frente", () => {
    const agora = new Date("2026-05-10T15:00:00Z");
    assert.deepEqual(diaDoParabens(cuiaba, 3, agora), { dia: 13, mes: 5, ano: 2026 });
  });

  it("atravessa o mês e o ano sem inventar dia 32", () => {
    assert.deepEqual(
      diaDoParabens(cuiaba, 3, new Date("2026-01-30T15:00:00Z")),
      { dia: 2, mes: 2, ano: 2026 },
    );
    assert.deepEqual(
      diaDoParabens(cuiaba, 2, new Date("2026-12-31T15:00:00Z")),
      { dia: 2, mes: 1, ano: 2027 },
    );
  });

  it("usa o calendário DA CASA, não o do servidor", () => {
    // 02:00 UTC de dia 11 ainda é dia 10 em Cuiabá. Um servidor em UTC
    // mandaria o parabéns um dia adiantado para a casa inteira.
    const agora = new Date("2026-05-11T02:00:00Z");
    assert.deepEqual(diaDoParabens(cuiaba, 0, agora), { dia: 10, mes: 5, ano: 2026 });
  });
});

describe("diasAte", () => {
  it("hoje é zero", () => {
    assert.deepEqual(diasAte(10, 5, "2026-05-10"), { dias: 0, proximo: "2026-05-10" });
  });

  it("conta os dias que faltam", () => {
    assert.deepEqual(diasAte(25, 5, "2026-05-10"), { dias: 15, proximo: "2026-05-25" });
  });

  it("aniversário que já passou cai no ano que vem", () => {
    // É o que "faltam quantos dias?" significa para uma pessoa — e é o que
    // faz a agenda de dezembro mostrar quem faz em janeiro.
    assert.deepEqual(diasAte(1, 3, "2026-05-10"), { dias: 295, proximo: "2027-03-01" });
  });

  it("29 de fevereiro em ano comum é comemorado em 1º de março", () => {
    // Melhor um dia depois que de quatro em quatro anos.
    assert.equal(diasAte(29, 2, "2027-01-01").proximo, "2027-03-01");
    // Em ano bissexto, o dia certo.
    assert.equal(diasAte(29, 2, "2028-01-01").proximo, "2028-02-29");
  });

  it("atravessa a virada do ano", () => {
    assert.deepEqual(diasAte(2, 1, "2026-12-31"), { dias: 2, proximo: "2027-01-02" });
  });
});

describe("primeiroNome", () => {
  it("pega só o primeiro e conserta a caixa", () => {
    assert.equal(primeiroNome("MARIA DAS GRAÇAS SILVA"), "Maria");
    assert.equal(primeiroNome("carlos"), "Carlos");
    assert.equal(primeiroNome("  João  Pedro "), "João");
  });

  it("sem nome, devolve vazio em vez de estourar", () => {
    assert.equal(primeiroNome(null), "");
    assert.equal(primeiroNome(undefined), "");
    assert.equal(primeiroNome("   "), "");
  });
});

describe("textoDeParabens", () => {
  it("troca {nome} e {casa} no texto da casa", () => {
    const t = textoDeParabens(
      { aniversario_texto: "Parabéns, {nome}! Seu chopp te espera no {casa}." },
      "Ditado Popular",
      "MARIA SILVA",
    );
    assert.equal(t, "Parabéns, Maria! Seu chopp te espera no Ditado Popular.");
  });

  it("o padrão sempre diz de onde a mensagem veio", () => {
    // Mensagem de número desconhecido que não se identifica é mensagem
    // denunciada — e denúncia derruba o WhatsApp da casa.
    const t = textoDeParabens({ aniversario_texto: null }, "Ditado Popular", "Ana");
    assert.ok(t.includes("Ditado Popular"), t);
    assert.ok(t.includes("Ana"), t);
  });

  it("sem nome, não sobra um buraco na frase", () => {
    const t = textoDeParabens({ aniversario_texto: null }, "Ditado Popular", null);
    assert.ok(!t.includes("{nome}"), t);
    assert.ok(!/Oi, !/.test(t), t);
    assert.ok(t.includes("Ditado Popular"), t);
  });

  it("texto em branco cai no padrão em vez de mandar nada", () => {
    const t = textoDeParabens({ aniversario_texto: "   " }, "Ditado Popular", "Ana");
    assert.ok(t.length > 20, t);
  });
});
