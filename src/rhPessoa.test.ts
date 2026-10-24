import assert from "node:assert/strict";
import test from "node:test";
import { ErroDoRh } from "./rh.js";
import { conferirComAFicha, montarOcorrencia, situacaoDaExperiencia } from "./rhPessoa.js";

const ficha = (extra: Record<string, unknown> = {}) => ({
  vinculo: "clt",
  admissao: "2026-10-01",
  desligamento: null,
  experiencia_primeiro: 45,
  experiencia_segundo: 45,
  experiencia_decisao: null,
  ...extra,
});

test("experiência: o primeiro período vence no 45º dia (o da admissão conta)", () => {
  const s = situacaoDaExperiencia(ficha(), "2026-10-10")!;
  assert.equal(s.fase, "primeiro");
  assert.equal(s.primeiro_vence, "2026-11-14");
  assert.equal(s.segundo_vence, "2026-12-29");
  assert.equal(s.alerta, false);
});

test("experiência: alerta a 7 dias, e vencido sem decisão", () => {
  assert.equal(situacaoDaExperiencia(ficha(), "2026-11-07")!.alerta, true);
  const vencido = situacaoDaExperiencia(ficha(), "2026-11-16")!;
  assert.equal(vencido.venceu_sem_decisao, true);
  assert.equal(vencido.alerta, true);
});

test("experiência: prorrogado olha o segundo período; efetivado acaba", () => {
  const p = situacaoDaExperiencia(ficha({ experiencia_decisao: "prorrogado" }), "2026-12-25")!;
  assert.equal(p.fase, "segundo");
  assert.equal(p.vence_em, "2026-12-29");
  assert.equal(p.alerta, true);
  assert.equal(situacaoDaExperiencia(ficha({ experiencia_decisao: "efetivado" }), "2026-11-10")!.fase, "fim");
});

test("experiência: só CLT ativo com admissão", () => {
  assert.equal(situacaoDaExperiencia(ficha({ vinculo: "freelancer" }), "2026-10-10"), null);
  assert.equal(situacaoDaExperiencia(ficha({ desligamento: "2026-10-05" }), "2026-10-10"), null);
});

test("ocorrência: advertência exige o motivo; atraso exige os minutos", () => {
  assert.throws(() => montarOcorrencia({ tipo: "advertencia", dia: "2026-10-10" }), ErroDoRh);
  assert.throws(() => montarOcorrencia({ tipo: "atraso", dia: "2026-10-10" }), ErroDoRh);
  assert.deepEqual(montarOcorrencia({ tipo: "atraso", dia: "2026-10-10", minutos: "25" }), {
    tipo: "atraso", dia: "2026-10-10", descricao: null, minutos: 25, dias: null,
  });
  // O elogio do cliente só entra pela pesquisa, nunca à mão.
  assert.throws(() => montarOcorrencia({ tipo: "elogio_cliente", dia: "2026-10-10" }), ErroDoRh);
});

test("documento: aponta CPF e nome diferentes, ignora acento e caixa", () => {
  const lido = { tipo: "rg", nome: "JOÃO DA SILVA", cpf: "52998224725", rg: null, nascimento: null, legivel: true };
  assert.deepEqual(conferirComAFicha(lido, { nome_completo: "Joao da Silva", cpf: "529.982.247-25" }), []);
  const avisos = conferirComAFicha(lido, { nome_completo: "João Souza", cpf: "11144477735" });
  assert.equal(avisos.length, 2);
});
