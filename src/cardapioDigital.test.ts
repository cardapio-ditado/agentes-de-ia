import assert from "node:assert/strict";
import test from "node:test";
import {
  ErroDoCardapio,
  LimiteDeRitmo,
  caminhoNoBalde,
  cidadeDoEndereco,
  formatoDaMidia,
  grupoValido,
  horarioDeHoje,
  nomeParaExibir,
  slugDe,
  validarComentario,
} from "./cardapioDigital.js";

/* ---------- limite de ritmo: a rede de baixo das rotas públicas ---------- */

test("deixa passar até o teto e barra o seguinte, dentro da janela", () => {
  const limite = new LimiteDeRitmo(3, 1000);
  assert.equal(limite.permitir("ip", 0), true);
  assert.equal(limite.permitir("ip", 10), true);
  assert.equal(limite.permitir("ip", 20), true);
  assert.equal(limite.permitir("ip", 30), false);
  // Outra chave não é afetada: o vizinho de mesa continua curtindo.
  assert.equal(limite.permitir("outro", 30), true);
});

test("passada a janela, a cota volta", () => {
  const limite = new LimiteDeRitmo(2, 1000);
  assert.equal(limite.permitir("ip", 0), true);
  assert.equal(limite.permitir("ip", 1), true);
  assert.equal(limite.permitir("ip", 2), false);
  assert.equal(limite.permitir("ip", 1001), true);
});

/* ---------- comentário: o que entra na fila da casa ---------- */

test("comentário válido sai limpo", () => {
  const c = validarComentario({ nome: "  Mariana   Souza ", nota: "5", texto: " Muito bom. " });
  assert.deepEqual(c, { nome: "Mariana Souza", nota: 5, texto: "Muito bom." });
});

test("comentário sem nome, sem nota ou com link é recusado com motivo", () => {
  for (const ruim of [
    { nome: "M", nota: 5, texto: "Bom demais" },
    { nome: "Mariana", nota: 0, texto: "Bom demais" },
    { nome: "Mariana", nota: 4.5, texto: "Bom demais" },
    { nome: "Mariana", nota: 5, texto: "ok" },
    { nome: "Mariana", nota: 5, texto: "veja www.spam.com" },
    { nome: "Mariana", nota: 5, texto: "x".repeat(281) },
  ]) {
    assert.throws(() => validarComentario(ruim), (e: unknown) => e instanceof ErroDoCardapio && e.status === 400, JSON.stringify(ruim));
  }
});

test("o nome exibido é o primeiro e a inicial do último", () => {
  assert.equal(nomeParaExibir("Mariana Souza"), "Mariana S.");
  assert.equal(nomeParaExibir("Mariana de Souza Lima"), "Mariana L.");
  assert.equal(nomeParaExibir("Rafael"), "Rafael");
  assert.equal(nomeParaExibir("  "), "");
});

/* ---------- slugs e grupos ---------- */

test("slug tira acento, espaço e símbolo", () => {
  assert.equal(slugDe("Na brasa"), "na-brasa");
  assert.equal(slugDe("Chopp & Cerveja"), "chopp-cerveja");
  assert.equal(slugDe("  Rodízio de petisco!! "), "rodizio-de-petisco");
  assert.equal(slugDe("###"), "item");
});

test("grupo é comer ou beber, nunca outra coisa", () => {
  assert.equal(grupoValido("beber"), "beber");
  assert.equal(grupoValido(" BEBER "), "beber");
  assert.equal(grupoValido("comer"), "comer");
  assert.equal(grupoValido(""), "comer");
  assert.equal(grupoValido(null), "comer");
  assert.equal(grupoValido("sobremesa"), "comer");
});

/* ---------- a casa como a página a mostra ---------- */

test("a cidade sai do fim do endereço, sem o estado nem o CEP", () => {
  assert.equal(cidadeDoEndereco("Rua Barão de Melgaço, 10 - Centro, Cuiabá - MT"), "Cuiabá");
  assert.equal(cidadeDoEndereco("Av. Brasil 100, Várzea Grande/MT, 78100-000"), "Várzea Grande");
  assert.equal(cidadeDoEndereco("Cuiabá"), "Cuiabá");
  assert.equal(cidadeDoEndereco(""), null);
  assert.equal(cidadeDoEndereco(null), null);
});

test("o horário de hoje é o do dia da semana no calendário da casa", () => {
  const venue = {
    timezone: "America/Cuiaba",
    opening_hours: { seg: "fechado", ter: "18h às 0h", sab: "12h às 2h" },
  };
  // 2026-09-05 é sábado; 23h UTC de sábado ainda é sábado 19h em Cuiabá.
  assert.equal(horarioDeHoje(venue, new Date("2026-09-05T23:00:00Z")), "12h às 2h");
  // 03h UTC de domingo é sábado 23h em Cuiabá: o horário ainda é o do sábado.
  assert.equal(horarioDeHoje(venue, new Date("2026-09-06T03:00:00Z")), "12h às 2h");
  // Quarta não tem horário cadastrado.
  assert.equal(horarioDeHoje(venue, new Date("2026-09-09T15:00:00Z")), null);
  assert.equal(horarioDeHoje({ timezone: "America/Cuiaba", opening_hours: null }, new Date()), null);
});

/* ---------- mídia ---------- */

test("só foto e vídeo conhecidos entram no balde", () => {
  assert.deepEqual(formatoDaMidia("image/jpeg"), { extensao: "jpg", tipo: "image" });
  assert.deepEqual(formatoDaMidia("video/mp4; codecs=avc1"), { extensao: "mp4", tipo: "video" });
  assert.equal(formatoDaMidia("application/pdf"), null);
  assert.equal(formatoDaMidia(""), null);
  assert.equal(formatoDaMidia(null), null);
});

test("o caminho no balde vem da URL pública, e só quando é nosso", () => {
  assert.equal(
    caminhoNoBalde("https://x.supabase.co/storage/v1/object/public/cardapio/abc/itens/1.jpg?x=1"),
    "abc/itens/1.jpg",
  );
  assert.equal(caminhoNoBalde("https://x.supabase.co/storage/v1/object/public/marcas/abc/logo.png"), null);
  assert.equal(caminhoNoBalde("https://fotos.de.outro.lugar/prato.jpg"), null);
  assert.equal(caminhoNoBalde(null), null);
});
