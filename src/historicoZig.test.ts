import assert from "node:assert/strict";
import test from "node:test";
import { buracos, diasDaJanela } from "./historicoZig.js";

test("a janela vem do mais recente para o mais antigo", () => {
  assert.deepEqual(
    diasDaJanela("2026-09-12", 4),
    ["2026-09-12", "2026-09-11", "2026-09-10", "2026-09-09"],
  );
});

test("a janela atravessa a virada do mês e do ano", () => {
  assert.deepEqual(diasDaJanela("2026-03-01", 2), ["2026-03-01", "2026-02-28"]);
  assert.deepEqual(diasDaJanela("2027-01-01", 2), ["2027-01-01", "2026-12-31"]);
});

test("dia com visita gravada não é buraco", () => {
  const janela = diasDaJanela("2026-09-12", 5);
  const jaTem = new Set(["2026-09-12", "2026-09-11", "2026-09-09"]);
  assert.deepEqual(buracos(janela, jaTem), ["2026-09-10", "2026-09-08"]);
});

test("base vazia é uma janela inteira de buracos", () => {
  // O caso da carga inicial: nenhum dia gravado, tudo por buscar.
  const janela = diasDaJanela("2026-09-12", 365);
  assert.equal(buracos(janela, new Set()).length, 365);
});

test("o buraco mais recente é o primeiro a ser tapado", () => {
  // A carga leva dias e vai ser interrompida no meio. Quando for, o que já
  // entrou tem de ser a semana passada, não a terça de onze meses atrás.
  const janela = diasDaJanela("2026-09-12", 300);
  const faltando = buracos(janela, new Set(["2026-09-12"]));
  assert.equal(faltando[0], "2026-09-11");
  assert.ok(faltando[0]! > faltando[faltando.length - 1]!);
});
