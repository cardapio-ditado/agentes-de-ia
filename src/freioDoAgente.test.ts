import assert from "node:assert/strict";
import test from "node:test";
import {
  JANELA_DO_FREIO_MINUTOS,
  MAXIMO_DE_MENSAGENS_NO_CONTEXTO,
  MAXIMO_DE_RESPOSTAS_NA_JANELA,
  pareceLoop,
  recortarHistorico,
  type LinhaDoHistorico,
} from "./freioDoAgente.js";

const AGORA = new Date("2026-10-15T12:50:00Z");

function faz(minutos: number): string {
  return new Date(AGORA.getTime() - minutos * 60_000).toISOString();
}

function troca(n: number, espacoMin: number, texto = "Antes de continuar, preciso te identificar."): LinhaDoHistorico[] {
  const linhas: LinhaDoHistorico[] = [];
  for (let i = n; i >= 1; i--) {
    linhas.push({ role: "user", content: `${texto} ${i}`, created_at: faz(i * espacoMin + 0.5) });
    linhas.push({ role: "assistant", content: "Oi! Sou a Fernanda…", created_at: faz(i * espacoMin) });
  }
  return linhas;
}

test("o histórico que vai para o modelo tem teto e começa numa fala do cliente", () => {
  const longo = Array.from({ length: 300 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", i }));
  const recorte = recortarHistorico(longo);
  assert.equal(recorte.length, MAXIMO_DE_MENSAGENS_NO_CONTEXTO);
  assert.equal(recorte[0]?.role, "user");
  assert.equal(recorte[recorte.length - 1]?.i, 299);

  // O corte caiu num resultado de ferramenta: avança até o cliente.
  const comFerramenta = [
    { role: "user", i: 0 }, { role: "assistant", i: 1 }, { role: "tool", i: 2 }, { role: "assistant", i: 3 },
    { role: "user", i: 4 }, { role: "assistant", i: 5 },
  ];
  assert.deepEqual(recortarHistorico(comFerramenta, 4).map((m) => m.i), [4, 5]);
  assert.deepEqual(recortarHistorico([], 4), []);
  assert.deepEqual(recortarHistorico([{ role: "assistant", i: 1 }], 4), []);
});

test("rajada de respostas em dez minutos aciona o freio", () => {
  const calmo = troca(8, 5); // 8 respostas, espaçadas de 5 min: só 2 na janela
  assert.equal(pareceLoop({ historico: calmo, novaMensagem: "tem mesa hoje?", agora: AGORA }).freia, false);

  const rajada = troca(MAXIMO_DE_RESPOSTAS_NA_JANELA, 0.5); // 10 respostas em 5 minutos
  const r = pareceLoop({ historico: rajada, novaMensagem: "tem mesa hoje?", agora: AGORA });
  assert.equal(r.freia, true);
  assert.match(r.motivo ?? "", new RegExp(`${MAXIMO_DE_RESPOSTAS_NA_JANELA} respostas em ${JANELA_DO_FREIO_MINUTOS} minutos`));
});

test("a mesma mensagem chegando três vezes aciona o freio; mensagens curtas não contam", () => {
  const historico: LinhaDoHistorico[] = [
    { role: "user", content: "Antes de continuar, *preciso te identificar*. São poucos dados.", created_at: faz(30) },
    { role: "assistant", content: "Oi!", created_at: faz(29) },
    { role: "user", content: "antes de continuar,  *preciso te identificar*.  são poucos dados.", created_at: faz(20) },
    { role: "assistant", content: "Oi!", created_at: faz(19) },
  ];
  const r = pareceLoop({ historico, novaMensagem: "Antes de continuar, *preciso te identificar*. São poucos dados.", agora: AGORA });
  assert.equal(r.freia, true);
  assert.match(r.motivo ?? "", /3 vezes/);

  // Duas vezes só: ainda não.
  assert.equal(pareceLoop({ historico: historico.slice(0, 2), novaMensagem: "Antes de continuar, *preciso te identificar*. São poucos dados.", agora: AGORA }).freia, false);

  // "ok" repetido é gente normal, não robô.
  const oks: LinhaDoHistorico[] = Array.from({ length: 5 }, (_, i) => ({ role: "user", content: "ok", created_at: faz(40 - i) }));
  assert.equal(pareceLoop({ historico: oks, novaMensagem: "ok", agora: AGORA }).freia, false);
});
