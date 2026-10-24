import assert from "node:assert/strict";
import test from "node:test";
import { PASSOS, montarTrilha } from "./trilha.js";

test("só entram os passos da base e dos módulos contratados", () => {
  const t = montarTrilha({ contratados: new Set(["checklist"]), automaticos: new Set(), manuais: {} });
  const modulos = new Set(t.passos.map((p) => p.modulo));
  assert.deepEqual([...modulos].sort(), [null, "checklist"].sort());
  assert.equal(t.total, PASSOS.filter((p) => p.modulo === null || p.modulo === "checklist").length);
});

test("o próximo é o primeiro por fazer, na ordem da implantação", () => {
  const t = montarTrilha({ contratados: new Set(), automaticos: new Set(["casa"]), manuais: {} });
  assert.equal(t.proximo?.id, "pessoas");
  assert.equal(t.feitos, 1);
});

test("passo manual não se marca sozinho, mesmo que a conferência diga sim", () => {
  const t = montarTrilha({ contratados: new Set(["checklist"]), automaticos: new Set(["equipe-treinada"]), manuais: {} });
  assert.equal(t.passos.find((p) => p.id === "equipe-treinada")?.feito, false);
});

test("marca do mentor vale para qualquer passo e diz quem marcou", () => {
  const t = montarTrilha({
    contratados: new Set(["cmv"]),
    automaticos: new Set(),
    manuais: { fornecedores: { feito_em: "2026-10-24T12:00:00Z", por: "kadu" } },
  });
  const passo = t.passos.find((p) => p.id === "fornecedores");
  assert.equal(passo?.feito, true);
  assert.equal(passo?.como, "manual");
  assert.equal(passo?.marcado_por, "kadu");
});

test("o desmame fecha a trilha", () => {
  const ultimo = PASSOS[PASSOS.length - 1];
  assert.equal(ultimo?.id, "desmame");
  assert.equal(ultimo?.manual, true);
});
