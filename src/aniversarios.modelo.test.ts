import assert from "node:assert/strict";
import test from "node:test";
import { modeloDeParabens, modeloSugeridoDeParabens } from "./aniversarios.js";
import { corpoParaAMeta, porQueNaoCria } from "./whatsappOficial.js";
import { preencherVariaveis, renderizar } from "./disparos.js";

const CASA = { name: "Ditado Popular", slug: "ditado-popular" };
const TEXTO =
  "Oi, {nome}! 🎉 Feliz aniversário adiantado: dia {data} é o seu dia, e a gente quer comemorar junto aqui no {casa}.\n\nMe responde aqui com o dia que a gente separa a mesa 🍻";

test("o texto do parabéns vira modelo da Meta, com as lacunas na ordem em que os marcadores aparecem", () => {
  const m = modeloSugeridoDeParabens({ aniversario_texto: TEXTO }, CASA);
  assert.equal(m.name, "parabens_ditado_popular");
  assert.equal(m.categoria, "MARKETING");
  assert.match(m.corpo, /^Oi, \{\{1\}\}! 🎉 Feliz aniversário adiantado: dia \{\{2\}\} é o seu dia, e a gente quer comemorar junto aqui no \{\{3\}\}\./);
  assert.deepEqual(m.variaveis, [{ tipo: "primeiro_nome" }, { tipo: "data_aniversario" }, { tipo: "casa" }]);
  assert.deepEqual(m.exemplos, ["Maria", "25 de dezembro", "Ditado Popular"]);
  assert.deepEqual(m.botoes, ["Quero reservar", "Vou pensar"]);
  assert.deepEqual(porQueNaoCria(m), []);
});

test("as lacunas do modelo se preenchem de volta com a pessoa de verdade — o que ela lê é o texto da casa", () => {
  const m = modeloSugeridoDeParabens({ aniversario_texto: TEXTO }, CASA);
  const valores = preencherVariaveis(m.variaveis, { nome: "Bruno Camargo", nascimento_dia: 14, nascimento_mes: 11 }, CASA.name);
  assert.equal(
    renderizar(m.corpo, valores),
    TEXTO.replace("{nome}", "Bruno").replace("{data}", "14 de novembro").replace("{casa}", "Ditado Popular"),
  );
  // E o aviso do parabéns leva exatamente esses parâmetros.
  const aviso = modeloDeParabens(
    { aniversario_modelo: m.name, aniversario_modelo_variaveis: m.variaveis },
    CASA.name,
    { nome: "Bruno Camargo", nascimento_dia: 14, nascimento_mes: 11 },
  );
  assert.deepEqual(aviso, { name: "parabens_ditado_popular", language: "pt_BR", parametros: ["Bruno", "14 de novembro", "Ditado Popular"] });
});

test("sem texto próprio, o sugerido sai do padrão; {quando} vira 'em breve'", () => {
  const m = modeloSugeridoDeParabens({ aniversario_texto: "{nome}, {quando} é seu dia no {casa}!" }, CASA);
  assert.equal(m.corpo, "{{1}}, em breve é seu dia no {{2}}!");
  assert.match(porQueNaoCria(m)[0]!, /começa ou termina com uma lacuna/);

  const padrao = modeloSugeridoDeParabens({ aniversario_texto: null }, CASA);
  assert.match(padrao.corpo, /\{\{1\}\}/);
  assert.deepEqual(porQueNaoCria(padrao), []);
});

test("o corpo para a Meta tem BODY com exemplos, e os botões de resposta rápida", () => {
  const corpo = corpoParaAMeta({
    name: "parabens_x",
    categoria: "MARKETING",
    corpo: "Oi, {{1}}! Parabéns.",
    exemplos: ["Maria"],
    botoes: ["Quero reservar", "Vou pensar"],
  });
  assert.equal(corpo.language, "pt_BR");
  const comps = corpo.components as Array<Record<string, unknown>>;
  assert.equal(comps[0]!.type, "BODY");
  assert.deepEqual(comps[0]!.example, { body_text: [["Maria"]] });
  assert.deepEqual(comps[1], { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero reservar" }, { type: "QUICK_REPLY", text: "Vou pensar" }] });
});

test("o que a Meta recusaria é dito antes de chamar a Meta", () => {
  const base = { name: "ok_nome", categoria: "MARKETING" as const, corpo: "Oi, {{1}}! Tudo bem?", exemplos: ["Maria"], botoes: [] };
  assert.deepEqual(porQueNaoCria(base), []);
  assert.match(porQueNaoCria({ ...base, name: "Nome Com Espaço" })[0]!, /minúsculas/);
  assert.match(porQueNaoCria({ ...base, exemplos: [] })[0]!, /exemplo/);
  assert.match(porQueNaoCria({ ...base, corpo: "Oi {{2}}, tudo?" })[0]!, /seguidas/);
  assert.match(porQueNaoCria({ ...base, botoes: ["x".repeat(30)] })[0]!, /25 caracteres/);
  assert.match(porQueNaoCria({ ...base, corpo: "a".repeat(1025) })[0]!, /1024/);
});
