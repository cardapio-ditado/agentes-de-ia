import assert from "node:assert/strict";
import test from "node:test";
import { lerEstadoPonte, papelValido } from "./ponteWhatsapp.js";
import type { Json } from "./database.types.js";

/**
 * As regras dos dois números.
 *
 * O que se testa aqui é a leitura do estado — a parte que decide o que a tela
 * mostra. Publicar e consumir tocam o banco e são exercitados em uso; a
 * conversão do formato antigo, não: ela só acontece uma vez, na atualização,
 * e se estiver errada o cliente vê "desconectado" e pareia de novo sem
 * precisar — exatamente o tipo de coisa que ninguém reporta como bug.
 */

const agora = () => new Date().toISOString();

test("papel inválido cai no agente, nunca no administrativo", () => {
  // Errar para o lado do administrativo faria um conector sem papel definido
  // parear o número de atendimento como se fosse o de disparo.
  assert.equal(papelValido("administrativo"), "administrativo");
  assert.equal(papelValido("agente"), "agente");
  assert.equal(papelValido("qualquer-coisa"), "agente");
  assert.equal(papelValido(null), "agente");
  assert.equal(papelValido(undefined), "agente");
});

test("cada papel lê o seu próprio estado", () => {
  const settings = {
    whatsapp_ponte: {
      agente: { status: "conectado", qr: null, telefone: "5565911111111", atualizado_em: agora() },
      administrativo: { status: "aguardando_qr", qr: "data:x", telefone: null, atualizado_em: agora() },
    },
  } as unknown as Json;

  assert.equal(lerEstadoPonte(settings, "agente")?.telefone, "5565911111111");
  assert.equal(lerEstadoPonte(settings, "administrativo")?.status, "aguardando_qr");
});

test("estado no formato antigo é lido como o do agente", () => {
  // Antes de existirem dois números havia uma conexão só, e ela era a do
  // agente. Sem esta conversão, quem já está conectado apareceria
  // desconectado depois da atualização e parearia de novo sem motivo.
  const antigo = {
    whatsapp_ponte: { status: "conectado", qr: null, telefone: "5565999999999", atualizado_em: agora() },
  } as unknown as Json;

  assert.equal(lerEstadoPonte(antigo, "agente")?.status, "conectado");
  assert.equal(lerEstadoPonte(antigo, "agente")?.telefone, "5565999999999");
});

test("formato antigo não vira estado do administrativo", () => {
  // O contrário seria pior que nada: a tela do WhatsApp da casa mostraria
  // "conectado" apontando para o número do agente, e o dono acharia que já
  // pode disparar checklist.
  const antigo = {
    whatsapp_ponte: { status: "conectado", qr: null, telefone: "5565999999999", atualizado_em: agora() },
  } as unknown as Json;

  assert.equal(lerEstadoPonte(antigo, "administrativo"), null);
});

test("sem nada publicado, o estado é nulo — e a tela diz 'sem conector'", () => {
  assert.equal(lerEstadoPonte(null, "administrativo"), null);
  assert.equal(lerEstadoPonte({} as Json, "agente"), null);
});

test("sinal velho vira sem_conector, mesmo que o último estado diga conectado", () => {
  // O conector morreu (ou o PC desligou) sem se despedir: o último estado
  // gravado mente, e mostrar "conectado" faria o dono esperar por um disparo
  // que não vai sair.
  const velho = {
    whatsapp_ponte: {
      administrativo: {
        status: "conectado",
        qr: null,
        telefone: "556599",
        atualizado_em: new Date(Date.now() - 120_000).toISOString(),
      },
    },
  } as unknown as Json;

  const estado = lerEstadoPonte(velho, "administrativo");
  assert.equal(estado?.status, "sem_conector");
  assert.equal(estado?.qr, null);
});

test("o padrão de lerEstadoPonte é o agente — compatível com quem chama sem papel", () => {
  const settings = {
    whatsapp_ponte: {
      agente: { status: "conectado", qr: null, telefone: "111", atualizado_em: agora() },
      administrativo: { status: "conectado", qr: null, telefone: "222", atualizado_em: agora() },
    },
  } as unknown as Json;

  assert.equal(lerEstadoPonte(settings)?.telefone, "111");
});
