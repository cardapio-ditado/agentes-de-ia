import assert from "node:assert/strict";
import test from "node:test";
import {
  casarVenda,
  entraSozinho,
  type ApelidoDeVenda,
  type FichaConhecida,
  type InsumoVendavel,
} from "./casarVenda.js";
import { converter, impressaoDaEstrutura } from "./lerVendas.js";

const FICHAS: FichaConhecida[] = [
  { id: "f1", nome: "Isca de tilápia", confirmada: true },
  { id: "f2", nome: "Bolinho de bacalhau", confirmada: false },
];

const INSUMOS: InsumoVendavel[] = [
  { id: "i1", nome: "Cerveja long neck", codigo: "7891" },
  { id: "i2", nome: "Tilápia filé", codigo: null },
];

test("apelido aprendido casa com confiança total", () => {
  const apelidos: ApelidoDeVenda[] = [
    { apelidoNormalizado: "porc isca tilapia g", fichaId: "f1", insumoId: null },
  ];
  const c = casarVenda("PORC ISCA TILAPIA G", null, FICHAS, INSUMOS, apelidos);
  assert.equal(c.fichaId, "f1");
  assert.equal(c.como, "apelido");
  assert.equal(c.confianca, 1);
  assert.ok(entraSozinho(c));
});

test("código do PDV bate com o código do insumo", () => {
  const c = casarVenda("CERV LN QUALQUER COISA", "7891", FICHAS, INSUMOS, []);
  assert.equal(c.insumoId, "i1");
  assert.equal(c.como, "codigo");
  assert.ok(entraSozinho(c));
});

test("nome exato prefere a FICHA ao insumo cru", () => {
  // Vendeu-se o prato do cardápio, não o quilo de peixe da câmara fria.
  const c = casarVenda("isca de tilápia", null, FICHAS, INSUMOS, []);
  assert.equal(c.fichaId, "f1");
  assert.equal(c.insumoId, null);
});

test("venda direta casa com o insumo quando não há ficha", () => {
  const c = casarVenda("Cerveja long neck", null, FICHAS, INSUMOS, []);
  assert.equal(c.insumoId, "i1");
  assert.equal(c.fichaId, null);
});

test("ficha não confirmada casa mas não baixa sozinha", () => {
  // O vínculo está certo; o que falta é conferir a receita. Dizer isso é
  // melhor que fingir que não achou.
  const c = casarVenda("Bolinho de bacalhau", null, FICHAS, INSUMOS, []);
  assert.equal(c.fichaId, "f2");
  assert.equal(c.impedimento, "ficha_nao_confirmada");
  assert.equal(entraSozinho(c), false);
});

test("parecença nunca entra sozinha, por melhor que seja", () => {
  const c = casarVenda("ISCA TILAPIA PORCAO", null, FICHAS, INSUMOS, []);
  assert.equal(c.como, "nome_parecido");
  assert.ok(c.confianca <= 0.85);
  assert.equal(entraSozinho(c), false);
});

test("produto sem parecença nenhuma não casa com nada", () => {
  const c = casarVenda("COUVERT ARTISTICO", null, FICHAS, INSUMOS, []);
  assert.equal(c.fichaId, null);
  assert.equal(c.insumoId, null);
  assert.equal(c.como, "nenhum");
  assert.equal(entraSozinho(c), false);
});

test("nome vazio não casa", () => {
  assert.equal(casarVenda("   ", null, FICHAS, INSUMOS, []).como, "nenhum");
});

/* ---------- leitura do relatório ---------- */

test("linha sem quantidade utilizável vira aviso, não venda", () => {
  // Baixaria do estoque uma mercadoria que não saiu, e o erro só apareceria
  // na contagem.
  const r = converter(
    {
      linhas: [
        { produto: "Isca de tilápia", quantidade: 0 },
        { produto: "Long neck", quantidade: 12 },
      ],
      avisos: [],
    },
    "2026-08-15",
  );
  assert.equal(r.linhas.length, 1);
  assert.match(r.avisos.join(" "), /quantidade ilegível/i);
});

test("linha sem data usa a data padrão do relatório", () => {
  const r = converter({ linhas: [{ produto: "X", quantidade: 2 }], avisos: [] }, "2026-08-15");
  assert.equal(r.linhas[0]!.data, "2026-08-15");
});

test("data em formato estranho não vira baixa no dia errado", () => {
  const r = converter(
    { linhas: [{ produto: "X", quantidade: 2, data: "15/08/2026" }], avisos: [] },
    "2026-08-15",
  );
  assert.equal(r.linhas[0]!.data, "2026-08-15");
});

test("o período sai das próprias linhas quando o relatório não diz", () => {
  const r = converter(
    {
      linhas: [
        { produto: "A", quantidade: 1, data: "2026-08-10" },
        { produto: "B", quantidade: 1, data: "2026-08-14" },
      ],
      avisos: [],
    },
    "2026-08-15",
  );
  assert.equal(r.periodoInicio, "2026-08-10");
  assert.equal(r.periodoFim, "2026-08-14");
});

test("arquivo sem venda nenhuma avisa em vez de sair vazio em silêncio", () => {
  const r = converter({ linhas: [], avisos: [] }, "2026-08-15");
  assert.match(r.avisos.join(" "), /Nenhuma venda/i);
});

test("a impressão da estrutura ignora os números — mesmo layout, dias diferentes", () => {
  // O relatório de terça e o de quarta têm o mesmo formato e dados
  // diferentes; é o formato que se aprende.
  const terca = "Relatorio de vendas 10/08/2026\nProduto | Qtd | Valor\nIsca | 12 | 480,00";
  const quarta = "Relatorio de vendas 11/08/2026\nProduto | Qtd | Valor\nIsca | 30 | 1200,00";
  assert.equal(impressaoDaEstrutura(terca), impressaoDaEstrutura(quarta));
});

test("layouts diferentes têm impressões diferentes", () => {
  const a = "Produto | Qtd | Valor\nIsca | 12 | 480,00";
  const b = "Descricao;Quantidade;Total\nIsca;12;480,00";
  assert.notEqual(impressaoDaEstrutura(a), impressaoDaEstrutura(b));
});
