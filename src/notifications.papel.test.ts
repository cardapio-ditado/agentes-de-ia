import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARENCIA_DO_OUTRO_PAPEL_MS, filtroDePapel } from "./notifications.js";
import type { PapelWhatsapp } from "./ponteWhatsapp.js";

/**
 * A regra que decide QUAL NÚMERO o cliente vê.
 *
 * Errar aqui não dá erro em lugar nenhum: a mensagem sai, entregue, pelo
 * número errado — e o cliente que responde ao convite da pesquisa é atendido
 * por uma IA achando que quer fazer reserva. Foi exatamente esse o defeito
 * que estes testes existem para não deixar voltar.
 */

/** As cláusulas do filtro, sem depender da ordem em que foram escritas. */
function clausulas(papel: PapelWhatsapp, agora: Date): string[] {
  return filtroDePapel(papel, agora).split(",");
}

describe("filtroDePapel", () => {
  const agora = new Date("2026-08-28T12:00:00.000Z");

  it("cada conector pega o que é dele", () => {
    assert.ok(clausulas("administrativo", agora).includes("papel.eq.administrativo"));
    assert.ok(clausulas("agente", agora).includes("papel.eq.agente"));
  });

  it("o que não tem dono é de quem estiver no ar", () => {
    // Tudo que existia antes da coluna `papel` cai aqui. Sem esta cláusula,
    // a fila antiga pararia de ser entregue no dia da migração.
    for (const papel of ["agente", "administrativo"] as PapelWhatsapp[]) {
      assert.ok(clausulas(papel, agora).includes("papel.is.null"), papel);
    }
  });

  it("o agente NÃO pega um aviso administrativo recém-criado", () => {
    // O caso do defeito: administrativo reinicia, some da ponte por 40
    // segundos, e um lote de convites de pesquisa sai pelo número que
    // responde com IA. A carência é o que fecha essa janela.
    const filtro = filtroDePapel("agente", agora);
    assert.ok(!filtro.includes("papel.eq.administrativo"), filtro);

    const corte = filtro.split("created_at.lt.")[1]!;
    assert.ok(agora.toISOString() > corte, "aviso criado agora tem que ficar fora do corte");
  });

  it("depois da carência, entregar pelo número errado é melhor que não entregar", () => {
    const corte = new Date(filtroDePapel("agente", agora).split("created_at.lt.")[1]!);
    const velho = new Date(agora.getTime() - CARENCIA_DO_OUTRO_PAPEL_MS - 60_000);
    const novo = new Date(agora.getTime() - 60_000);

    assert.ok(velho < corte, "parado há mais de dez minutos: o outro assume");
    assert.ok(novo > corte, "parado há um minuto: continua esperando o dono");
  });

  it("a carência é maior que qualquer reinício e menor que um conector morto", () => {
    // Um restart do systemd volta em 5s; a ponte considera o sinal velho aos
    // 45s. Dez minutos fica confortavelmente acima disso, e bem abaixo do
    // tempo em que alguém percebe que o conector morreu de vez.
    assert.ok(CARENCIA_DO_OUTRO_PAPEL_MS > 60_000);
    assert.ok(CARENCIA_DO_OUTRO_PAPEL_MS <= 30 * 60_000);
  });
});
