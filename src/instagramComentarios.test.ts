import assert from "node:assert/strict";
import test from "node:test";
import { comentarioDescartavel, comentariosDoEntry, contextoDoComentario, modoValido, peneiraBarata, promptDaPeneira, promptDoAgradecimento } from "./instagramComentarios.js";

test("os comentários saem do webhook com autor, post e texto; o resto do lote é ignorado", () => {
  const entry = {
    id: "178",
    changes: [
      { field: "mentions", value: { comment_id: "x" } },
      { field: "comments", value: { id: "c1", text: "tem mesa sábado?", from: { id: "99", username: "renata" }, media: { id: "m1", media_product_type: "FEED" } } },
      { field: "comments", value: { id: "c2", text: "", from: { id: "98" } } },
      { field: "comments", value: { id: "c3", text: "@amiga olha", from: { id: "97", username: "bia" }, media: { id: "m1" }, parent_id: "c1" } },
    ],
  };
  const lista = comentariosDoEntry(entry);
  assert.deepEqual(lista.map((c) => c.id), ["c1", "c2", "c3"]);
  assert.equal(lista[0]!.autor, "renata");
  assert.equal(lista[0]!.media_id, "m1");
  assert.equal(lista[2]!.parent_id, "c1");
  assert.deepEqual(comentariosDoEntry(undefined), []);
});

test("a peneira barata: emoji, marcação de amigo e nada não viram direct", () => {
  assert.equal(comentarioDescartavel("🔥🔥🔥"), true);
  assert.equal(comentarioDescartavel("❤️"), true);
  assert.equal(comentarioDescartavel("@fulano @ciclana"), true);
  assert.equal(comentarioDescartavel("  "), true);
  assert.equal(comentarioDescartavel("ok"), true);
  assert.equal(comentarioDescartavel("tem mesa sábado?"), false);
  assert.equal(comentarioDescartavel("quero!"), false);
  assert.equal(comentarioDescartavel("@fulano bora sábado?"), false);
});

test("o agente fica sabendo que começou num comentário, e de qual post", () => {
  const texto = contextoDoComentario({ autor: "renata", texto: "tem mesa sábado?", legenda: "Sábado tem feijoada!", casa: "Ditado Popular" });
  assert.match(texto, /@renata COMENTOU/);
  assert.match(texto, /Sábado tem feijoada/);
  assert.match(texto, /MENSAGEM PRIVADA/);
  assert.match(texto, /não pergunte "como posso ajudar"/i);
  assert.match(promptDaPeneira({ casa: "Ditado", legenda: null }), /"direct"/);
});

test("o modo de comentários não confia na tela", () => {
  assert.equal(modoValido("privado"), "privado");
  assert.equal(modoValido("publico_e_privado"), "publico_e_privado");
  assert.equal(modoValido("desligado"), "desligado");
  assert.equal(modoValido("tudo"), null);
  assert.equal(modoValido(undefined), null);
});

test("a peneira barata manda emoji para o obrigado, marcação de amigo para o nada, e o resto para o modelo", () => {
  assert.equal(peneiraBarata("🔥🔥🔥"), "agradecer");
  assert.equal(peneiraBarata("❤️"), "agradecer");
  assert.equal(peneiraBarata("@fulano @ciclana"), "ignorar");
  assert.equal(peneiraBarata("  "), "ignorar");
  assert.equal(peneiraBarata("ok"), "ignorar");
  assert.equal(peneiraBarata("melhor chope da cidade"), null);
  assert.equal(peneiraBarata("tem mesa sábado?"), null);
  assert.match(promptDaPeneira({ casa: "Ditado", legenda: null }), /"direct", "agradecer" ou "ignorar"/);
  assert.match(promptDoAgradecimento("Ditado"), /até 10 palavras/);
});
