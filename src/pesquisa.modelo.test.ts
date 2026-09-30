import assert from "node:assert/strict";
import test from "node:test";
import { modeloDoConvite } from "./pesquisa.js";
import { resumirModelo, sufixoParaBotao } from "./whatsappOficial.js";
import { diaDaVisitaPorExtenso, preencherVariaveis } from "./disparos.js";

const LINK = "https://brasafood.app/pesquisa?t=abc123";

test("o botão de link recebe só o sufixo — a Meta guarda o começo fixo", () => {
  assert.equal(sufixoParaBotao("https://brasafood.app/pesquisa?t={{1}}", LINK), "abc123");
  // Modelo com outra base: vai o link inteiro, e o teste da casa mostra o erro.
  assert.equal(sufixoParaBotao("https://outro.site/{{1}}", LINK), LINK);
  assert.equal(sufixoParaBotao(null, LINK), LINK);
});

test("o resumo do modelo enxerga o botão de link e se ele varia por pessoa", () => {
  const comBotao = resumirModelo({
    name: "convite_nps",
    language: "pt_BR",
    category: "MARKETING",
    status: "APPROVED",
    components: [
      { type: "BODY", text: "Oi, {{1}}! Como foi ontem no {{2}}? Conta pra gente em 30 segundos." },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Responder", url: "https://brasafood.app/pesquisa?t={{1}}" }] },
    ],
  });
  assert.equal(comBotao.botao_url, "https://brasafood.app/pesquisa?t={{1}}");
  assert.equal(comBotao.botao_url_dinamico, true);
  assert.deepEqual(comBotao.botoes, ["Responder"]);
  assert.equal(comBotao.suportado, true);

  const fixo = resumirModelo({ name: "x", status: "APPROVED", components: [{ type: "BODY", text: "oi" }, { type: "BUTTONS", buttons: [{ type: "URL", text: "Site", url: "https://brasafood.app" }] }] });
  assert.equal(fixo.botao_url_dinamico, false);
});

test("o convite vira modelo: link no botão quando o modelo tem, na lacuna quando não tem", () => {
  const pessoa = { nome: "Bruno Camargo", link: LINK };

  const peloBotao = modeloDoConvite(
    { convite_modelo: "convite_nps", convite_modelo_variaveis: [{ tipo: "primeiro_nome" }, { tipo: "casa" }] },
    { botao_url_dinamico: true, botao_url: "https://brasafood.app/pesquisa?t={{1}}", idioma: "pt_BR" },
    pessoa,
    "Ditado Popular",
  );
  assert.deepEqual(peloBotao, { name: "convite_nps", language: "pt_BR", parametros: ["Bruno", "Ditado Popular"], botao_url: "abc123" });

  const naLacuna = modeloDoConvite(
    { convite_modelo: "convite_simples", convite_modelo_variaveis: [{ tipo: "primeiro_nome" }, { tipo: "link" }] },
    { botao_url_dinamico: false, botao_url: null, idioma: "pt_BR" },
    pessoa,
    "Ditado Popular",
  );
  assert.deepEqual(naLacuna, { name: "convite_simples", language: "pt_BR", parametros: ["Bruno", LINK], botao_url: null });

  // Sem modelo escolhido, sem modelo — o convite sai pelo conector.
  assert.equal(modeloDoConvite({ convite_modelo: null, convite_modelo_variaveis: [] }, null, pessoa, "x"), null);
});

test("a lacuna do dia da visita fala como gente: hoje, ontem, o dia da semana, a data", () => {
  const hoje = "2026-09-30"; // quarta
  assert.equal(diaDaVisitaPorExtenso("2026-09-30", hoje), "hoje");
  assert.equal(diaDaVisitaPorExtenso("2026-09-29", hoje), "ontem");
  assert.equal(diaDaVisitaPorExtenso("2026-09-26", hoje), "sábado");
  assert.equal(diaDaVisitaPorExtenso("2026-09-24", hoje), "quinta");
  assert.equal(diaDaVisitaPorExtenso("2026-09-20", hoje), "dia 20/09");
  // Data quebrada não derruba o convite.
  assert.equal(diaDaVisitaPorExtenso("lixo", hoje), "hoje");

  // No convite: o dia da Zig quando veio dela; sem dia, a visita foi hoje.
  assert.deepEqual(preencherVariaveis([{ tipo: "dia_visita" }], { nome: null, dia_visita: "2026-09-29", hoje }, "x"), ["ontem"]);
  assert.deepEqual(preencherVariaveis([{ tipo: "dia_visita" }], { nome: null }, "x"), ["hoje"]);
  const m = modeloDoConvite(
    { convite_modelo: "convite_nps", convite_modelo_variaveis: [{ tipo: "primeiro_nome" }, { tipo: "dia_visita" }] },
    { botao_url_dinamico: true, botao_url: "https://brasafood.app/pesquisa?t={{1}}", idioma: "pt_BR" },
    { nome: "Bruno Camargo", link: LINK, dia_visita: "2026-09-26", hoje },
    "Ditado Popular",
  );
  assert.deepEqual(m?.parametros, ["Bruno", "sábado"]);
});

test("a lacuna de link nunca sai vazia", () => {
  assert.deepEqual(preencherVariaveis([{ tipo: "link" }], { nome: null }, "x"), ["-"]);
  assert.deepEqual(preencherVariaveis([{ tipo: "link" }], { nome: null, link: LINK }, "x"), [LINK]);
});
