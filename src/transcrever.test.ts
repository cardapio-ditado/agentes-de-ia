import assert from "node:assert/strict";
import test from "node:test";
import { longoDemais, textoDaResposta, transcricaoConfigurada } from "./transcrever.js";

test("transcrição normal vira texto aproveitável", () => {
  assert.equal(
    textoDaResposta({ text: "  Oi, queria reservar mesa pra quatro hoje  " }),
    "Oi, queria reservar mesa pra quatro hoje",
  );
});

test("silêncio não vira mensagem", () => {
  // Whisper devolve string vazia para áudio mudo; tratar isso como pergunta
  // faria o agente responder do nada.
  assert.equal(textoDaResposta({ text: "" }), "");
  assert.equal(textoDaResposta({ text: "   " }), "");
});

test("alucinação de ruído é descartada", () => {
  // A mais famosa do Whisper: em áudio sem fala, ele inventa a legenda de
  // rodapé que aparece em milhares de vídeos do material de treino.
  assert.equal(textoDaResposta({ text: "Legendas pela comunidade Amara.org" }), "");
  assert.equal(textoDaResposta({ text: "Legendas por Amara.org" }), "");
});

test("resposta inesperada não quebra o conector", () => {
  assert.equal(textoDaResposta(null), "");
  assert.equal(textoDaResposta({}), "");
  assert.equal(textoDaResposta({ text: 42 }), "");
});

test("áudio de recado comum não é recusado por tamanho", () => {
  // ~30 segundos de voz no WhatsApp.
  assert.equal(longoDemais(60_000), false);
});

test("áudio absurdamente longo é recusado antes de gastar transcrição", () => {
  // ~20 minutos.
  assert.equal(longoDemais(2_400_000), true);
});

test("sem chave configurada, a transcrição se declara indisponível", () => {
  const antes = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  assert.equal(transcricaoConfigurada(), false);
  process.env.GROQ_API_KEY = "  ";
  assert.equal(transcricaoConfigurada(), false, "chave em branco não conta como configurada");
  process.env.GROQ_API_KEY = "gsk_teste";
  assert.equal(transcricaoConfigurada(), true);
  if (antes === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = antes;
});
