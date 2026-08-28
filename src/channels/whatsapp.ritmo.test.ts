import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { esperaAntesDe } from "./whatsapp.js";

/**
 * O RITMO DA FILA, E POR QUE ELE TEM DOIS.
 *
 * Em 27/08/2026, às 18:28:54, o WhatsApp registrou uma restrição por alcance
 * no número administrativo do Ditado Popular ("reachout timelock") e, 56
 * milissegundos depois, derrubou o aparelho ("device_removed"). Naquela tarde
 * saíram 39 convites de pesquisa em três lotes, com 2 a 5 segundos entre um e
 * outro. O número ficou fora do ar por um dia inteiro sem ninguém perceber.
 *
 * Estes testes existem para que ninguém volte o intervalo por achar que a
 * fila está lenta. Ela está lenta de propósito — mas só onde precisa.
 */

describe("esperaAntesDe", () => {
  const amostra = (template: string | null, quantas = 200) =>
    Array.from({ length: quantas }, () => esperaAntesDe(template));

  it("disparo em massa vai devagar: nunca menos de 20 segundos", () => {
    for (const t of ["pesquisa_convite", "aniversario_2026"]) {
      for (const espera of amostra(t)) {
        assert.ok(espera >= 20_000, `${t}: ${espera}ms`);
        assert.ok(espera <= 40_000, `${t}: ${espera}ms`);
      }
    }
  });

  it("mensagem que alguém espera continua rápida", () => {
    // Quem acabou de reservar está com o celular na mão. Fazer a confirmação
    // esperar atrás de vinte convites de pesquisa seria trocar o urgente pelo
    // volume.
    for (const t of ["reserva_aprovada", "checklist_link", "pesquisa_detrator", "conector_caiu"]) {
      for (const espera of amostra(t)) {
        assert.ok(espera >= 2_000 && espera <= 5_000, `${t}: ${espera}ms`);
      }
    }
  });

  it("template desconhecido é tratado como urgente, não como massa", () => {
    // Errar para o lado de entregar rápido: um aviso novo que ninguém marcou
    // não pode ficar dez minutos parado na fila.
    for (const espera of amostra(null, 20)) {
      assert.ok(espera <= 5_000, String(espera));
    }
    for (const espera of amostra("template_que_ainda_nao_existe", 20)) {
      assert.ok(espera <= 5_000, String(espera));
    }
  });

  it("o intervalo varia — ritmo cravado também é assinatura de robô", () => {
    const distintos = new Set(amostra("pesquisa_convite", 50));
    assert.ok(distintos.size > 40, `só ${distintos.size} valores diferentes em 50`);
  });

  it("vinte convites levam minutos, não segundos", () => {
    // A conta que importa: é ela que separa "parece gente" de "parece robô".
    const total = amostra("pesquisa_convite", 19).reduce((s, n) => s + n, 0);
    assert.ok(total >= 6 * 60_000, `20 convites em ${Math.round(total / 60_000)} min`);
  });
});
