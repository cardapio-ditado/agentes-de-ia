import assert from "node:assert/strict";
import test from "node:test";
import { ErroDoRh } from "./rh.js";
import { calcularEnps, montarCandidato, sinaisDeSaida } from "./rhIndicadores.js";

test("eNPS: promotores menos detratores, em %", () => {
  assert.equal(calcularEnps([10, 9, 8, 6]), 25);
  assert.equal(calcularEnps([5, 5]), -100);
  assert.equal(calcularEnps([]), null);
});

const base = {
  faltas_e_atrasos_30d: 0, faltas_e_atrasos_30d_antes: 0, registro_formal_60d: 0, ultima_avaliacao: null,
  dias_de_casa: 400, conversa_30_atrasada: false, nota_cliente_30d: null, nota_cliente_antes: null,
};

test("risco: nada é nada; um sinal é atenção; dois é alto", () => {
  assert.equal(sinaisDeSaida(base).nivel, null);
  assert.equal(sinaisDeSaida({ ...base, registro_formal_60d: 1 }).nivel, "atencao");
  const alto = sinaisDeSaida({ ...base, faltas_e_atrasos_30d: 3, faltas_e_atrasos_30d_antes: 1, nota_cliente_30d: 4, nota_cliente_antes: 4.8 });
  assert.equal(alto.nivel, "alto");
  assert.equal(alto.sinais.length, 2);
});

test("risco: faltas iguais ao mês anterior não são sinal (é o jeito da pessoa, não uma mudança)", () => {
  assert.equal(sinaisDeSaida({ ...base, faltas_e_atrasos_30d: 2, faltas_e_atrasos_30d_antes: 2 }).nivel, null);
});

test("candidato: extra começa disponível; nota de 1 a 5", () => {
  assert.equal(montarCandidato({ nome: "João", tipo: "extra" }).situacao, "disponivel");
  assert.equal(montarCandidato({ nome: "Ana", telefone: "(65) 99999-0000" }).telefone, "65999990000");
  assert.throws(() => montarCandidato({ nome: "" }), ErroDoRh);
  assert.throws(() => montarCandidato({ nome: "X", nota: 9 }), ErroDoRh);
});
