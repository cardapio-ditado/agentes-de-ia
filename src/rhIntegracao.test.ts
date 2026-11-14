import assert from "node:assert/strict";
import test from "node:test";
import { ErroDoRh } from "./rh.js";
import { ETAPAS_DA_INTEGRACAO, corrigirTreino, lerAtestadoAConfirmar, lerPerguntas, montarIntegracao, periodoDoAtestado, tituloDoAtestadoAConfirmar } from "./rhIntegracao.js";

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

test("atestado: o título guarda o que a IA leu, e a leitura de volta bate", () => {
  const titulo = tituloDoAtestadoAConfirmar("2026-11-12", 3);
  assert.equal(titulo, "A confirmar — 3 dias a partir de 12/11/2026");
  assert.deepEqual(lerAtestadoAConfirmar(titulo), { inicio: "2026-11-12", dias: 3 });
  assert.deepEqual(lerAtestadoAConfirmar(tituloDoAtestadoAConfirmar("2026-11-12", 1)), { inicio: "2026-11-12", dias: 1 });
  // Sem período lido continua pendente — só não tem sugestão.
  assert.deepEqual(lerAtestadoAConfirmar(tituloDoAtestadoAConfirmar(null, null)), { inicio: null, dias: null });
  assert.deepEqual(lerAtestadoAConfirmar(tituloDoAtestadoAConfirmar("2026-11-12", null)), { inicio: null, dias: null });
});

test("atestado: o que já foi decidido, ou veio do gestor, não é pendência", () => {
  assert.equal(lerAtestadoAConfirmar(null), null);
  assert.equal(lerAtestadoAConfirmar("enviado pelo funcionário"), null);
  assert.equal(lerAtestadoAConfirmar("Atestado de 3 dias (12/11/2026 a 14/11/2026) — confirmado por Ana"), null);
  assert.equal(lerAtestadoAConfirmar("Atestado não aceito — conferido por Ana"), null);
});

test("atestado: o período do gestor vale mais que o da IA, e vira os dias da escala", () => {
  const lido = { inicio: "2026-11-29", dias: 3 };
  assert.deepEqual(periodoDoAtestado(lido), ["2026-11-29", "2026-11-30", "2026-12-01"]);
  // A IA leu 3, o papel diz 2 a partir do dia 30: vale o que o gestor conferiu.
  assert.deepEqual(periodoDoAtestado(lido, { inicio: "2026-11-30", dias: "2" }), ["2026-11-30", "2026-12-01"]);
  // Campo vazio na tela não apaga a sugestão.
  assert.deepEqual(periodoDoAtestado(lido, { inicio: "", dias: "" }), ["2026-11-29", "2026-11-30", "2026-12-01"]);
});

test("atestado: sem período não se confirma — a tela pede o que falta", () => {
  const vazio = { inicio: null, dias: null };
  assert.throws(() => periodoDoAtestado(vazio), (e) => e instanceof ErroDoRh && e.status === 400 && /primeiro dia/.test(e.message));
  assert.throws(() => periodoDoAtestado(vazio, { inicio: "2026-11-12" }), /quantos dias/);
  assert.throws(() => periodoDoAtestado(vazio, { inicio: "2026-11-12", dias: 0 }), /quantos dias/);
  assert.throws(() => periodoDoAtestado(vazio, { inicio: "2026-11-12", dias: 45 }), /quantos dias/);
  assert.throws(() => periodoDoAtestado(vazio, { inicio: "12/11/2026", dias: 2 }), /primeiro dia/);
});
