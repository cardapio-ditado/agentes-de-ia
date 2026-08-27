import assert from "node:assert/strict";
import test from "node:test";
import { ETIQUETAS, etiquetasValidas, liberacaoDoPremio, notaDoNps, primeiraMinuscula, telefoneLimpo } from "./pesquisa.js";
import type { ItemDaPesquisa } from "./pesquisaModelo.js";

test("etiqueta fora da lista não entra no gráfico da casa", () => {
  // A lista fixa é o que permite dizer "as reclamações de espera dobraram".
  // Um POST feito à mão com texto livre estragaria isso em silêncio.
  assert.deepEqual(etiquetasValidas(["Comida", "<script>", "qualquer coisa"]), ["Comida"]);
});

test("etiqueta repetida conta uma vez", () => {
  assert.deepEqual(etiquetasValidas(["Comida", "Comida"]), ["Comida"]);
});

test("corpo estranho não derruba o registro da resposta", () => {
  // A opinião do cliente vale mais que a etiqueta: entra sem ela.
  assert.deepEqual(etiquetasValidas("Comida"), []);
  assert.deepEqual(etiquetasValidas(null), []);
  assert.deepEqual(etiquetasValidas(undefined), []);
  assert.deepEqual(etiquetasValidas({ 0: "Comida" }), []);
});

test("toda etiqueta oferecida é aceita de volta", () => {
  // Se a tela mostra uma opção que o servidor recusa, o cliente marca e some.
  assert.deepEqual(etiquetasValidas([...ETIQUETAS]), [...ETIQUETAS]);
});

test("o telefone perde a formatação e fica só em dígitos", () => {
  assert.equal(telefoneLimpo("(65) 99999-0000"), "65999990000");
  assert.equal(telefoneLimpo("+55 65 9 9999-0000"), "5565999990000");
});

/* ---------- a carência do prêmio ---------- */

test("o cupom só é liberado no dia seguinte, no relógio da casa", () => {
  // Usado na mesma conta, o prêmio vira desconto no que o cliente já ia
  // pagar — o oposto de trazer alguém de volta.
  const cuiaba = "America/Cuiaba";
  // 20h de 22/08 em Cuiabá = 23/08 00:00 UTC. A liberação tem que ser a
  // meia-noite do dia 23 EM CUIABÁ, que é 23/08 04:00 UTC.
  const r = liberacaoDoPremio(cuiaba, new Date("2026-08-23T00:00:00Z"));
  assert.equal(r, "2026-08-23T04:00:00.000Z");
});

test("a virada do dia é a da casa, não a do UTC", () => {
  // 23h de sábado em Cuiabá já é domingo em UTC. Calculado em UTC, o cupom
  // ganho no sábado à noite seria liberado no próprio sábado.
  const ganho = new Date("2026-08-23T03:00:00Z"); // sábado 22, 23h em Cuiabá
  const liberado = liberacaoDoPremio("America/Cuiaba", ganho);
  assert.ok(
    Date.parse(liberado) > ganho.getTime(),
    `liberou antes de ganhar: ${liberado} <= ${ganho.toISOString()}`,
  );
  // E é a meia-noite do domingo 23 em Cuiabá.
  assert.equal(liberado, "2026-08-23T04:00:00.000Z");
});

test("a liberação é sempre no futuro, a qualquer hora do dia", () => {
  // O caso que quebraria em silêncio: responder às 00:05 e o cupom já nascer
  // liberado, porque a conta pegou "hoje" em vez de "amanhã".
  for (const hora of ["04:05", "10:00", "16:30", "23:59", "03:59"]) {
    const agora = new Date(`2026-08-22T${hora}:00Z`);
    const liberado = liberacaoDoPremio("America/Cuiaba", agora);
    assert.ok(
      Date.parse(liberado) > agora.getTime(),
      `${hora}: liberou em ${liberado}, que não é depois de ${agora.toISOString()}`,
    );
  }
});

test("cada fuso tem a sua virada", () => {
  const emCuiaba = liberacaoDoPremio("America/Cuiaba", new Date("2026-08-22T18:00:00Z"));
  const emSaoPaulo = liberacaoDoPremio("America/Sao_Paulo", new Date("2026-08-22T18:00:00Z"));
  assert.notEqual(emCuiaba, emSaoPaulo);
});

/* ---------- a nota vem da pergunta do NPS ---------- */

const perguntaNps = (over: Partial<ItemDaPesquisa> = {}): ItemDaPesquisa => ({
  id: "nps-1",
  categoria: "NPS",
  pergunta: "De 0 a 10, o quanto você indicaria esta casa?",
  tipo: "nota",
  obrigatorio: false,
  nps: true,
  ...over,
});

const outraPergunta: ItemDaPesquisa = {
  id: "p2",
  categoria: "Comida",
  pergunta: "Como estava a comida?",
  tipo: "nota",
  obrigatorio: false,
};

test("a resposta da pergunta marcada vira a nota", () => {
  // O caso real: o cliente respondeu 2 na pergunta da casa e o painel mostrou
  // 10, porque a mesma pergunta estava sendo feita duas vezes.
  assert.equal(notaDoNps([perguntaNps(), outraPergunta], [{ item_id: "nps-1", valor: 2 }]), 2);
});

test("sem pergunta marcada, quem manda é o passo embutido", () => {
  // Null e não zero: null significa "vale a nota que veio do passo de sempre".
  assert.equal(notaDoNps([outraPergunta], [{ item_id: "p2", valor: 9 }]), null);
});

test("pergunta marcada mas não respondida não zera a avaliação", () => {
  // Gravar zero aqui transformaria "pulou a pergunta" em "detrator", e a casa
  // receberia aviso de nota baixa de quem não deu nota nenhuma.
  assert.equal(notaDoNps([perguntaNps()], []), null);
  assert.equal(notaDoNps([perguntaNps()], [{ item_id: "outra", valor: 3 }]), null);
  assert.equal(notaDoNps([perguntaNps()], [{ item_id: "nps-1", valor: null }]), null);
});

test("nota zero é nota, e não ausência de nota", () => {
  // O erro clássico do `||`: zero é a pior avaliação possível e a mais
  // importante de registrar.
  assert.equal(notaDoNps([perguntaNps()], [{ item_id: "nps-1", valor: 0 }]), 0);
});

test("a lista vazia ou inválida não quebra a gravação", () => {
  assert.equal(notaDoNps([perguntaNps()], null), null);
  assert.equal(notaDoNps([perguntaNps()], "nada disso"), null);
  assert.equal(notaDoNps([], [{ item_id: "nps-1", valor: 2 }]), null);
});

/* ---------- salvar um campo não apaga os outros ---------- */

test("campo ausente não sobrescreve o que está guardado", () => {
  // `{...atual, ...campos}` PARECE guardar o que não veio, e não guarda: uma
  // chave presente com valor undefined sobrescreve. Como a rota preenche com
  // undefined tudo o que não veio no corpo, salvar um campo sozinho — o X que
  // desliga o aviso manda só ele — zeraria os outros.
  const atual: Record<string, unknown> = { premio_titulo: "Um chopp", detrator_nota_maxima: 8, ativa: true };
  const campos = { detrator_avisar_whatsapp: "65999998888", premio_titulo: undefined, ativa: undefined };

  const informados = Object.fromEntries(
    Object.entries(campos).filter(([, valor]) => valor !== undefined),
  );
  const nova = { ...atual, ...informados };

  assert.equal(nova.premio_titulo, "Um chopp");
  assert.equal(nova.ativa, true);
  assert.equal(nova.detrator_nota_maxima, 8);
  assert.equal(nova.detrator_avisar_whatsapp, "65999998888");
});

test("valor explicitamente vazio APAGA — é diferente de ausente", () => {
  // O X manda "" de propósito. Confundir "não mandei" com "mandei vazio"
  // deixaria o aviso ligado depois de o dono desligá-lo.
  const campos = { detrator_avisar_whatsapp: "", premio_titulo: undefined };
  const informados = Object.fromEntries(
    Object.entries(campos).filter(([, valor]) => valor !== undefined),
  );
  assert.equal("detrator_avisar_whatsapp" in informados, true);
  assert.equal("premio_titulo" in informados, false);
});

/**
 * O prêmio entra no convite por extenso, e a emenda tem que soar natural:
 * "quem responde ganha um chopp por nossa conta na próxima visita".
 */
test("primeiraMinuscula emenda o prêmio no meio da frase", () => {
  assert.equal(
    primeiraMinuscula("Um chopp por nossa conta na próxima visita"),
    "um chopp por nossa conta na próxima visita",
  );
  assert.equal(primeiraMinuscula("Uma sobremesa"), "uma sobremesa");
});

test("primeiraMinuscula não estraga marca escrita em maiúscula", () => {
  // "Chopp Brahma" tem maiúscula no meio? Não — mas "IPA" e "CHOPP" têm, e
  // rebaixá-las faria a casa ver o próprio produto escrito errado.
  assert.equal(primeiraMinuscula("IPA da casa"), "IPA da casa");
  assert.equal(primeiraMinuscula("CHOPP grátis"), "CHOPP grátis");
});
