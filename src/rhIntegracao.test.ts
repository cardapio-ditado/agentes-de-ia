import assert from "node:assert/strict";
import test from "node:test";
import { ErroDoRh } from "./rh.js";
import { ETAPAS_DA_INTEGRACAO, corrigirTreino, lerPerguntas, montarIntegracao } from "./rhIntegracao.js";

test("integração: prazos contados do dia da admissão, e atraso só do que venceu", () => {
  const i = montarIntegracao({ admissao: "2026-10-01", hoje: "2026-10-08", manuais: new Set(["dia1_apresentacao"]), automaticas: new Set(["disc"]) });
  const etapa = (id: string) => i.etapas.find((e) => e.id === id)!;
  assert.equal(etapa("dia1_apresentacao").vence_em, "2026-10-01");
  assert.equal(etapa("dia1_apresentacao").feita, true);
  assert.equal(etapa("dia1_regras").atrasada, true);
  assert.equal(etapa("semana1_disc").como, "automatica");
  assert.equal(etapa("dia30_conversa").atrasada, false);
  assert.equal(i.total, ETAPAS_DA_INTEGRACAO.length);
  assert.equal(i.ativa, true);
  assert.equal(montarIntegracao({ admissao: "2026-01-01", hoje: "2026-10-08", manuais: new Set(), automaticas: new Set() }).ativa, false);
});

test("treino: perguntas conferidas e corrigidas no servidor", () => {
  const p = lerPerguntas([{ pergunta: "A?", opcoes: ["x", "y"], certa: 1 }, { pergunta: "B?", opcoes: ["x", "y", "z"], certa: 0 }]);
  assert.deepEqual(corrigirTreino(p, [1, 2]), { acertos: 1, total: 2 });
  assert.throws(() => lerPerguntas([{ pergunta: "A?", opcoes: ["x"], certa: 0 }]), ErroDoRh);
  assert.throws(() => lerPerguntas([{ pergunta: "A?", opcoes: ["x", "y"], certa: 5 }]), ErroDoRh);
});
