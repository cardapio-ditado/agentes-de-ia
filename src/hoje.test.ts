import assert from "node:assert/strict";
import test from "node:test";
import { montarSaude, ordenarPendencias, type EntradaDaSaude, type Pendencia } from "./hoje.js";

const LIGADO = { status: "conectado", qr: null, telefone: "5565999990000", agentSlug: "fernanda", venueSlug: "x", versao: null, atualizado_em: "2026-10-24T12:00:00Z" };
const CAIU = { ...LIGADO, status: "sem_conector" };

const base: EntradaDaSaude = {
  atendimentoContratado: true,
  atendente: LIGADO,
  avisos: LIGADO,
  oficial: null,
  instagram: null,
  mensagensQueFalharam: 0,
  mensagensParadas: 0,
};

const estadoDe = (sinais: ReturnType<typeof montarSaude>, id: string) => sinais.find((s) => s.id === id)?.estado;

test("tudo ligado: atendimento e avisos em verde, sem sinal de oficial nem Instagram", () => {
  const s = montarSaude(base);
  assert.equal(estadoDe(s, "atendimento"), "ok");
  assert.equal(estadoDe(s, "avisos"), "ok");
  assert.equal(estadoDe(s, "oficial"), undefined);
  assert.equal(estadoDe(s, "instagram"), undefined);
});

test("número que caiu é problema; número que nunca ligou é só alerta", () => {
  assert.equal(estadoDe(montarSaude({ ...base, avisos: CAIU }), "avisos"), "problema");
  assert.equal(estadoDe(montarSaude({ ...base, avisos: null }), "avisos"), "alerta");
});

test("o oficial com agente cobre o atendimento mesmo com o WhatsApp Web fora", () => {
  const s = montarSaude({ ...base, atendente: CAIU, oficial: { situacao: "ativa", atende: true, telefone: "+55 65 4042-0881" } });
  assert.equal(estadoDe(s, "atendimento"), "ok");
  assert.equal(estadoDe(s, "oficial"), "ok");
});

test("casa sem o módulo do atendente não ganha sinal de atendimento", () => {
  assert.equal(estadoDe(montarSaude({ ...base, atendimentoContratado: false }), "atendimento"), undefined);
});

test("Instagram vencido é problema; sem agente é alerta", () => {
  const ig = { conectado: true, vencido: false, precisa_renovar: false, agent_slug: "fernanda", usuario: "ditadopopular" };
  assert.equal(estadoDe(montarSaude({ ...base, instagram: { ...ig, vencido: true } }), "instagram"), "problema");
  assert.equal(estadoDe(montarSaude({ ...base, instagram: { ...ig, agent_slug: null } }), "instagram"), "alerta");
  assert.equal(estadoDe(montarSaude({ ...base, instagram: ig }), "instagram"), "ok");
});

test("mensagem que desistiu vence a que só está parada", () => {
  const s = montarSaude({ ...base, mensagensQueFalharam: 2, mensagensParadas: 5 });
  assert.equal(estadoDe(s, "falhas"), "problema");
  assert.equal(estadoDe(s, "paradas"), undefined);
  assert.equal(estadoDe(montarSaude({ ...base, mensagensParadas: 5 }), "paradas"), "alerta");
});

test("pendências: zeradas somem, urgentes primeiro, maior pilha antes", () => {
  const p = (id: string, quantidade: number, urgente: boolean): Pendencia => ({ id, modulo: "x", titulo: id, quantidade, detalhe: "", destino: "", urgente });
  const lista = ordenarPendencias([p("a", 3, false), p("b", 0, true), p("c", 1, true), p("d", 9, false), p("e", 4, true)]);
  assert.deepEqual(lista.map((x) => x.id), ["e", "c", "d", "a"]);
});
