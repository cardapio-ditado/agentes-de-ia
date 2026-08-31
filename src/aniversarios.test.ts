import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dataPorExtenso, diaDoParabens, diasAte, primeiroNome, textoDeParabens } from "./aniversarios.js";

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
      { dia: 25, mes: 12 },
    );
    assert.equal(t, "Parabéns, Maria! Seu chopp te espera no Ditado Popular.");
  });

  it("o padrão sempre diz de onde a mensagem veio", () => {
    // Mensagem de número desconhecido que não se identifica é mensagem
    // denunciada — e denúncia derruba o WhatsApp da casa.
    const t = textoDeParabens({ aniversario_texto: null }, "Ditado Popular", "Ana", { dia: 25, mes: 12 });
    assert.ok(t.includes("Ditado Popular"), t);
    assert.ok(t.includes("Ana"), t);
  });

  it("sem nome, não sobra um buraco na frase", () => {
    const t = textoDeParabens({ aniversario_texto: null }, "Ditado Popular", null, { dia: 25, mes: 12 });
    assert.ok(!t.includes("{nome}"), t);
    assert.ok(!/Oi, !/.test(t), t);
    assert.ok(t.includes("Ditado Popular"), t);
  });

  it("texto em branco cai no padrão em vez de mandar nada", () => {
    const t = textoDeParabens({ aniversario_texto: "   " }, "Ditado Popular", "Ana", { dia: 25, mes: 12 });
    assert.ok(t.length > 20, t);
  });
});

/**
 * OS DOIS DEFEITOS QUE ESTES TESTES FECHAM.
 *
 * O primeiro: a antecedência já existia como opção e o texto padrão continuava
 * dizendo "hoje é seu dia". Dez dias antes, isso é uma mensagem errada — o
 * cliente lê, confere o calendário e conclui que a casa não sabe quando ele
 * nasce.
 *
 * O segundo: dizer "daqui a 10 dias" é uma CONTA, e conta erra. Basta a
 * mensagem sair com atraso, a fila segurar o envio ou o fuso virar o dia para
 * o número não bater com o calendário de quem lê. "Dia 25 de dezembro" não tem
 * como estar errado.
 */
describe("textoDeParabens com antecedência", () => {
  const casa = "Ditado Popular";

  it("antes do dia, diz a DATA e não a contagem", () => {
    const t = textoDeParabens({ aniversario_texto: null }, casa, "Ana", { dia: 25, mes: 12, diasAntes: 10 });
    assert.ok(!/hoje/i.test(t), t);
    assert.ok(t.includes("25 de dezembro"), t);
    // A contagem é o que pode sair errado — não pode aparecer no padrão.
    assert.ok(!/daqui a|dias/i.test(t), t);
    assert.ok(t.includes(casa), t);
  });

  it("a data está certa em qualquer antecedência", () => {
    // O mesmo aniversário, avisado com 1 ou 40 dias, mostra a mesma data.
    for (const dias of [1, 10, 40]) {
      const t = textoDeParabens({ aniversario_texto: null }, casa, "Ana", { dia: 3, mes: 9, diasAntes: dias });
      assert.ok(t.includes("3 de setembro"), `${dias}: ${t}`);
    }
  });

  it("no dia continua sendo a mensagem de sempre", () => {
    const t = textoDeParabens({ aniversario_texto: null }, casa, "Ana", { dia: 25, mes: 12, diasAntes: 0 });
    assert.ok(/hoje é seu dia/i.test(t), t);
  });

  it("{quando} continua servindo a quem já escreveu o texto assim", () => {
    // Casa que escreveu o próprio texto com {quando} antes desta mudança não
    // pode ver o marcador cru na mensagem do cliente.
    const com = (dias: number) =>
      textoDeParabens({ aniversario_texto: "Seu niver é {quando}." }, casa, "Ana", {
        dia: 25, mes: 12, diasAntes: dias,
      });
    assert.equal(com(0), "Seu niver é hoje.");
    assert.equal(com(1), "Seu niver é amanhã.");
    assert.equal(com(10), "Seu niver é daqui a 10 dias.");
  });

  it("antes do dia, a mensagem CONVIDA — é para isso que ela existe", () => {
    // No dia é carinho: a pessoa já escolheu onde comemorar. Antes é convite,
    // e convite sem chamada para ação é só um cartão.
    const t = textoDeParabens({ aniversario_texto: null }, casa, "Ana", { dia: 25, mes: 12, diasAntes: 15 });
    assert.ok(/responder|mesa/i.test(t), t);
  });

  it("{quando} funciona no texto que a casa escreveu", () => {
    const t = textoDeParabens(
      { aniversario_texto: "Oi {nome}, seu niver é {quando}! Vem pro {casa}." },
      casa,
      "Ana",
      { dia: 25, mes: 12, diasAntes: 10 },
    );
    assert.equal(t, "Oi Ana, seu niver é daqui a 10 dias! Vem pro Ditado Popular.");
  });

  it("nenhum marcador sobra na mensagem, em nenhuma antecedência", () => {
    for (const dias of [0, 1, 7, 10, 30, 60]) {
      const t = textoDeParabens({ aniversario_texto: null }, casa, "Ana", { dia: 25, mes: 12, diasAntes: dias });
      assert.ok(!t.includes("{"), `${dias} dias: ${t}`);
    }
  });
});

describe("dataPorExtenso", () => {
  it("fala a data como uma pessoa fala", () => {
    assert.equal(dataPorExtenso(25, 12), "25 de dezembro");
    assert.equal(dataPorExtenso(1, 1), "1 de janeiro");
    assert.equal(dataPorExtenso(3, 9), "3 de setembro");
  });

  it("mês fora da faixa não estoura a mensagem", () => {
    assert.ok(dataPorExtenso(10, 13).startsWith("10 de "));
  });
});
