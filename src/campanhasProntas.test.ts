import { test } from "node:test";
import assert from "node:assert/strict";
import { lacunasDe, porQueNaoAgenda, publicoValido, variaveisValidas } from "./disparos.js";
import { porQueNaoCria } from "./whatsappOficial.js";

/**
 * As campanhas prontas moram no navegador (public/js/modelosProntos.js),
 * mas quem diz se elas PRESTAM é o servidor: o público tem de ser um que o
 * disparo aceita, e o texto tem de passar pelas mesmas regras que barram um
 * modelo antes de ele ir para a Meta. Uma campanha pronta que o servidor
 * recusa é pior do que não ter campanha pronta.
 *
 * O caminho vai numa variável para o TypeScript não tentar tipar um
 * arquivo que é do navegador.
 */
interface Campanha {
  chave: string;
  titulo: string;
  resumo: string;
  publico: string;
  lacuna: string;
  variaveis: unknown[];
  modelo: { name: string; corpo: string; exemplos: string[]; botoes: string[]; rodape: string };
}

const caminho = "../public/js/modelosProntos.js";
const { CAMPANHAS_PRONTAS, publicoDaCampanha } = (await import(caminho)) as {
  CAMPANHAS_PRONTAS: Campanha[];
  publicoDaCampanha: (c: Campanha, hoje?: Date) => string;
};

/** O mesmo que `publicoDoSeletor` faz na tela. */
function publicoDoSeletor(valor: string): Record<string, unknown> {
  if (valor === "todos") return { todos: true };
  if (valor.startsWith("mes:")) return { aniversario_mes: Number(valor.slice(4)) };
  return { selo: valor };
}

test("há de seis a oito campanhas, cada uma com chave e nome de modelo únicos", () => {
  assert.ok(CAMPANHAS_PRONTAS.length >= 6 && CAMPANHAS_PRONTAS.length <= 8);
  assert.equal(new Set(CAMPANHAS_PRONTAS.map((c) => c.chave)).size, CAMPANHAS_PRONTAS.length);
  assert.equal(new Set(CAMPANHAS_PRONTAS.map((c) => c.modelo.name)).size, CAMPANHAS_PRONTAS.length);
});

test("o público sugerido é sempre um que o disparo conhece", () => {
  for (const c of CAMPANHAS_PRONTAS) {
    const pedido = publicoDoSeletor(publicoDaCampanha(c, new Date(2026, 10, 14)));
    // publicoValido devolve {} para o que não conhece: tem de voltar igual.
    assert.deepEqual(publicoValido(pedido), pedido, c.chave);
  }
});

test("aniversariante do mês aponta para o mês corrente", () => {
  const c = CAMPANHAS_PRONTAS.find((x) => x.publico === "mes:atual");
  assert.ok(c);
  assert.equal(publicoDaCampanha(c, new Date(2026, 0, 31)), "mes:1");
  assert.equal(publicoDaCampanha(c, new Date(2026, 11, 1)), "mes:12");
});

test("todo texto passa nas regras que barram um modelo antes da Meta", () => {
  for (const c of CAMPANHAS_PRONTAS) {
    assert.deepEqual(porQueNaoCria({ ...c.modelo, categoria: "MARKETING" }), [], c.chave);
  }
});

test("todo texto evita o que a Meta costuma rejeitar em marketing", () => {
  for (const c of CAMPANHAS_PRONTAS) {
    const { corpo } = c.modelo;
    assert.ok(!/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{4,}/.test(corpo), `${c.chave}: caixa alta`);
    assert.ok(!/!\s*!|!.*!/.test(corpo), `${c.chave}: mais de uma exclamação`);
    assert.ok(!/chope|chopp|cerveja|drink|caipirinha|vinho|dose\b/i.test(corpo), `${c.chave}: bebida alcoólica`);
  }
});

test("o rodapé de saída está em todas — é ele que ensina a pessoa a sair", () => {
  for (const c of CAMPANHAS_PRONTAS) assert.match(c.modelo.rodape, /SAIR/, c.chave);
});

test("as lacunas sugeridas cobrem as do texto, e o disparo montado só espera a casa escrever o {{3}}", () => {
  for (const c of CAMPANHAS_PRONTAS) {
    const variaveis = variaveisValidas(c.variaveis);
    assert.equal(variaveis.length, lacunasDe(c.modelo.corpo), c.chave);
    assert.equal(c.modelo.exemplos.length, variaveis.length, c.chave);
    const publico = publicoValido(publicoDoSeletor(publicoDaCampanha(c)));
    assert.deepEqual(
      porQueNaoAgenda({ modelo: c.modelo.name, corpo: c.modelo.corpo, variaveis, publico, status: "rascunho" }),
      [],
      c.chave,
    );
  }
});
