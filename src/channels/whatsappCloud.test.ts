import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  assinaturaWhatsappValida,
  descreverMidia,
  estadoWhatsappCloud,
  textoDaMensagem,
  verificarWebhookWhatsapp,
} from "./whatsappCloud.js";

function comAmbiente(vars: Record<string, string | undefined>, fn: () => void) {
  const antes: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("a verificação do webhook ecoa o challenge só com o verify token certo", () => {
  comAmbiente({ WHATSAPP_VERIFY_TOKEN: "segredo-da-casa" }, () => {
    const certo = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "segredo-da-casa", "hub.challenge": "123" });
    assert.equal(verificarWebhookWhatsapp(certo), "123");
    const errado = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "outro", "hub.challenge": "123" });
    assert.equal(verificarWebhookWhatsapp(errado), null);
    const semModo = new URLSearchParams({ "hub.verify_token": "segredo-da-casa", "hub.challenge": "123" });
    assert.equal(verificarWebhookWhatsapp(semModo), null);
  });
  comAmbiente({ WHATSAPP_VERIFY_TOKEN: undefined }, () => {
    const p = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" });
    assert.equal(verificarWebhookWhatsapp(p), null);
  });
});

test("a assinatura HMAC do corpo é conferida com o App Secret (e cai no do Instagram)", () => {
  const corpo = Buffer.from('{"object":"whatsapp_business_account"}');
  comAmbiente({ WHATSAPP_APP_SECRET: undefined, INSTAGRAM_APP_SECRET: "app-secret" }, () => {
    const boa = "sha256=" + createHmac("sha256", "app-secret").update(corpo).digest("hex");
    assert.equal(assinaturaWhatsappValida(corpo, boa), true);
    assert.equal(assinaturaWhatsappValida(corpo, "sha256=" + "0".repeat(64)), false);
    assert.equal(assinaturaWhatsappValida(corpo, undefined), false);
    assert.equal(assinaturaWhatsappValida(Buffer.from("outro corpo"), boa), false);
  });
  comAmbiente({ WHATSAPP_APP_SECRET: undefined, INSTAGRAM_APP_SECRET: undefined }, () => {
    assert.equal(assinaturaWhatsappValida(corpo, "sha256=abc"), false);
  });
});

test("o texto sai de mensagem de texto, botão ou lista; mídia vira null com acolhida", () => {
  assert.equal(textoDaMensagem({ type: "text", text: { body: "  Tem mesa hoje?  " } }), "Tem mesa hoje?");
  assert.equal(textoDaMensagem({ type: "button", button: { text: "Reservar" } }), "Reservar");
  assert.equal(textoDaMensagem({ type: "interactive", interactive: { list_reply: { title: "Sexta" } } }), "Sexta");
  assert.equal(textoDaMensagem({ type: "image", image: {} }), null);
  assert.equal(textoDaMensagem({ type: "text", text: { body: "   " } }), null);
  assert.equal(descreverMidia({ type: "audio", audio: {} }).registro, "[áudio recebido]");
  assert.equal(descreverMidia({ type: "image", image: {} }).registro, "[foto recebida]");
  assert.match(descreverMidia({ type: "unknown" }).acolhida, /texto/);
});

test("o estado do webhook lista só o que é do app, sem expor os segredos", () => {
  // Token, telefone e agente são da CASA agora (whatsapp_oficial); aqui só
  // entra o que a Meta precisa para falar com o app.
  comAmbiente(
    { WHATSAPP_VERIFY_TOKEN: undefined, WHATSAPP_APP_SECRET: undefined, INSTAGRAM_APP_SECRET: "segredo-s" },
    () => {
      const estado = estadoWhatsappCloud();
      assert.equal(estado.webhook_pronto, false);
      assert.deepEqual(estado.faltando, ["WHATSAPP_VERIFY_TOKEN"]);
      assert.equal(JSON.stringify(estado).includes("segredo-s"), false);
    },
  );
  comAmbiente({ WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s" }, () => {
    assert.equal(estadoWhatsappCloud().webhook_pronto, true);
  });
});
