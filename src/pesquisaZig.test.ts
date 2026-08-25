import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  diaAnterior,
  diaParaBuscar,
  diaSeguinte,
  mesclarVisitantes,
} from "./pesquisaZig.js";
import { horaNaCasa } from "./fuso.js";

/**
 * As peças puras da ponte com a Zig.
 *
 * O que se testa aqui é o que erra caro em produção: telefone da Zig com e
 * sem +55 virando duas pessoas, a varredura convidando o mesmo dia duas
 * vezes, e o convite saindo às três da manhã porque o relógio era o do
 * servidor e não o do bar.
 */

const CONFIG = {
  ativo: true,
  token: "tok",
  loja: "123",
  hora_envio: 11,
  ultimo_dia: null as string | null,
};

// Cuiabá é UTC-4 o ano inteiro — sem horário de verão desde 2019.
const CUIABA = "America/Cuiaba";

describe("mesclarVisitantes", () => {
  it("junta comprador e check-in do mesmo telefone numa pessoa só", () => {
    const lista = mesclarVisitantes(
      [{ userPhone: "+55 65 98765-4321", userName: "João Silva" }],
      [{ phone: "65 98765-4321", name: "João S." }],
    );
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.telefone, "5565987654321");
    assert.equal(lista[0]!.nome, "João Silva");
  });

  it("completa o nome com a outra fonte quando a primeira não tem", () => {
    const lista = mesclarVisitantes(
      [{ userPhone: "65987654321", userName: null }],
      [{ phone: "+5565987654321", name: "Maria" }],
    );
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.nome, "Maria");
  });

  it("descarta telefone curto demais em vez de gastar convite com ele", () => {
    const lista = mesclarVisitantes(
      [{ userPhone: "9999", userName: "Sem DDD" }, { userPhone: null, userName: "Sem fone" }],
      [],
    );
    assert.equal(lista.length, 0);
  });

  it("põe o 55 na frente do número nacional — um formato só para a trava comparar", () => {
    const lista = mesclarVisitantes([{ userPhone: "(11) 98765-4321", userName: "A" }], []);
    assert.equal(lista[0]!.telefone, "5511987654321");
  });
});

describe("diaAnterior / diaSeguinte", () => {
  it("atravessa mês e ano sem tropeçar", () => {
    assert.equal(diaAnterior("2026-01-01"), "2025-12-31");
    assert.equal(diaSeguinte("2026-02-28"), "2026-03-01");
  });
});

describe("horaNaCasa", () => {
  it("lê o relógio do bar, não o do servidor", () => {
    // 14h UTC = 10h em Cuiabá.
    assert.equal(horaNaCasa(CUIABA, new Date("2026-08-25T14:00:00Z")), 10);
    // 2h UTC = 22h do dia anterior em Cuiabá.
    assert.equal(horaNaCasa(CUIABA, new Date("2026-08-26T02:00:00Z")), 22);
  });
});

describe("diaParaBuscar", () => {
  // 16h UTC = meio-dia em Cuiabá, 25/08 — depois da hora padrão (11h).
  const meioDia = new Date("2026-08-25T16:00:00Z");

  it("busca ontem quando é hora e o dia ainda não foi buscado", () => {
    assert.equal(diaParaBuscar(CONFIG, CUIABA, meioDia), "2026-08-24");
  });

  it("não busca antes da hora configurada — convite às 7h incomoda", () => {
    // 13h UTC = 9h em Cuiabá.
    assert.equal(diaParaBuscar(CONFIG, CUIABA, new Date("2026-08-25T13:00:00Z")), null);
  });

  it("não busca o mesmo dia duas vezes", () => {
    assert.equal(diaParaBuscar({ ...CONFIG, ultimo_dia: "2026-08-24" }, CUIABA, meioDia), null);
  });

  it("desligado, sem token ou sem loja: silêncio", () => {
    assert.equal(diaParaBuscar({ ...CONFIG, ativo: false }, CUIABA, meioDia), null);
    assert.equal(diaParaBuscar({ ...CONFIG, token: null }, CUIABA, meioDia), null);
    assert.equal(diaParaBuscar({ ...CONFIG, loja: null }, CUIABA, meioDia), null);
  });

  it("de madrugada, ontem ainda é ontem no calendário da casa", () => {
    // 3h UTC de 26/08 = 23h de 25/08 em Cuiabá → ontem é 24/08 (com hora 0
    // para o teste não depender da hora de envio).
    const madrugada = new Date("2026-08-26T03:00:00Z");
    assert.equal(
      diaParaBuscar({ ...CONFIG, hora_envio: 0 }, CUIABA, madrugada),
      "2026-08-24",
    );
  });
});
