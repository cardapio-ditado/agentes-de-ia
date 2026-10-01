import assert from "node:assert/strict";
import test from "node:test";
import { assinarState, lerState, paraOPainel, precisaRenovar, urlDeLogin } from "./instagramOficial.js";

const SEGREDO = "segredo-de-teste";

test("o state do login leva a casa assinada, e volta só se a assinatura e a hora batem", () => {
  const agora = new Date("2026-10-01T12:00:00.000Z");
  const state = assinarState("ditado-popular", SEGREDO, agora);
  assert.equal(lerState(state, SEGREDO, agora), "ditado-popular");
  // Dez minutos depois ainda vale; dezesseis, não — login não demora isso.
  assert.equal(lerState(state, SEGREDO, new Date(agora.getTime() + 10 * 60_000)), "ditado-popular");
  assert.equal(lerState(state, SEGREDO, new Date(agora.getTime() + 16 * 60_000)), null);
  // Outro segredo, state mexido, lixo: nada passa.
  assert.equal(lerState(state, "outro", agora), null);
  assert.equal(lerState(`${state}x`, SEGREDO, agora), null);
  assert.equal(lerState("lixo", SEGREDO, agora), null);
  assert.equal(lerState(null, SEGREDO, agora), null);
});

test("a URL de login pede as permissões de mensagens e força a escolha da conta", () => {
  const url = new URL(urlDeLogin({ appId: "123", redirectUri: "https://brasafood.app/v1/instagram/oauth/callback", state: "abc" }));
  assert.equal(url.origin + url.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "123");
  assert.equal(url.searchParams.get("redirect_uri"), "https://brasafood.app/v1/instagram/oauth/callback");
  assert.equal(url.searchParams.get("scope"), "instagram_business_basic,instagram_business_manage_messages");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "abc");
  assert.equal(url.searchParams.get("force_reauth"), "true");
});

test("renova quando faltam menos de 30 dias — e sempre que não se sabe quando vence", () => {
  const agora = new Date("2026-10-01T12:00:00.000Z");
  assert.equal(precisaRenovar({ expira_em: "2026-11-29T12:00:00.000Z" }, agora), false);
  assert.equal(precisaRenovar({ expira_em: "2026-10-20T12:00:00.000Z" }, agora), true);
  assert.equal(precisaRenovar({ expira_em: null }, agora), true);
});

test("o painel vê a conta e o agente, nunca o token", () => {
  const tela = paraOPainel({
    venue_id: "v",
    ig_user_id: "178",
    usuario: "ditadopopular",
    nome: "Ditado Popular",
    token: "IGQ-segredo",
    expira_em: "2099-01-01T00:00:00.000Z",
    renovado_em: null,
    agent_slug: "recepcionista",
    conectado_em: "2026-10-01T12:00:00.000Z",
  });
  assert.equal(tela.conectado, true);
  assert.equal(tela.usuario, "ditadopopular");
  assert.equal(tela.agent_slug, "recepcionista");
  assert.equal(tela.vencido, false);
  assert.equal(JSON.stringify(tela).includes("IGQ-segredo"), false);
  assert.equal(paraOPainel(null).conectado, false);
});
