import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { ItemPublico } from "./cardapioDigital.js";
import {
  ErroDoDelivery,
  abertoAgora,
  acharItem,
  cashbackDoPedido,
  configParaATela,
  cotar,
  escolherOpcoes,
  lerHorario,
  precificar,
  proximosStatus,
  resumoDosPedidos,
  CONFIG_PADRAO,
  type Bairro,
  type Cupom,
} from "./delivery.js";
import { assinaturaConfere, corpoDoPix } from "./deliveryPagamento.js";
import { comDelivery, FERRAMENTAS_PADRAO, resolveTools } from "./tools/index.js";

const item = (campos: Partial<ItemPublico> & { id: string; nome: string; preco: number }): ItemPublico => ({
  categoria_id: null, descricao: "", promocao: null, destaque: false, capa: null, video: null, midias: [],
  variacoes: [], etiquetas: [], alergenicos: [], serve: null, curtidas: 0, comentarios: 0, ...campos,
});

const BURGER = item({
  id: "i-burger", nome: "X-Burger", preco: 22,
  variacoes: [
    { id: "g-ponto", nome: "Ponto", obrigatorio: true, opcoes: [{ id: "o-mal", nome: "Mal passado", adicional: 0 }, { id: "o-bem", nome: "Bem passado", adicional: 0 }] },
    { id: "g-add", nome: "Adicionais", obrigatorio: false, opcoes: [{ id: "o-bacon", nome: "Bacon", adicional: 5 }, { id: "o-ovo", nome: "Ovo", adicional: 3 }] },
  ],
});
const BATATA = item({ id: "i-batata", nome: "Batata frita", preco: 18, promocao: { nome: "Terça", preco: 15.9 } });
const CARDAPIO = [BURGER, BATATA, item({ id: "i-duplo", nome: "X-Burger Duplo", preco: 30 })];

// ---------- horário ----------

test("abertoAgora: a chave manual vence o horário, e sem grade vale só a chave", () => {
  assert.equal(abertoAgora({ aceitando: true, horario: {} }, "America/Cuiaba"), true);
  assert.equal(abertoAgora({ aceitando: false, horario: {} }, "America/Cuiaba"), false);
  assert.equal(abertoAgora({ aceitando: false, horario: { 5: ["00:00", "23:59"] } }, "America/Cuiaba", new Date("2026-11-13T20:00:00Z")), false);
});

test("abertoAgora: usa o fuso da casa e segura o turno que atravessa a meia-noite", () => {
  const cfg = { aceitando: true, horario: { 5: ["18:00", "02:00"] as [string, string] } }; // sexta
  // Cuiabá é UTC-4: sexta 18:00 lá = 22:00 UTC.
  const em = (iso: string) => abertoAgora(cfg, "America/Cuiaba", new Date(iso));
  assert.equal(em("2026-11-13T21:59:00Z"), false); // sexta 17:59
  assert.equal(em("2026-11-13T22:00:00Z"), true); // sexta 18:00
  assert.equal(em("2026-11-14T05:30:00Z"), true); // sábado 01:30 — ainda é a noite de sexta
  assert.equal(em("2026-11-14T06:00:00Z"), false); // sábado 02:00
  assert.equal(em("2026-11-14T23:00:00Z"), false); // sábado 19:00 — sábado não abre
});

test("lerHorario recusa dia e hora que não existem", () => {
  assert.deepEqual(lerHorario({ 0: ["18:00", "23:00"] }), { 0: ["18:00", "23:00"] });
  assert.deepEqual(lerHorario(null), {});
  assert.throws(() => lerHorario({ 7: ["18:00", "23:00"] }), ErroDoDelivery);
  assert.throws(() => lerHorario({ 1: ["18h", "23:00"] }), /18:00/);
  assert.throws(() => lerHorario({ 1: ["25:00", "23:00"] }), ErroDoDelivery);
});

// ---------- opções e preço ----------

test("escolherOpcoes: obrigatório é exatamente uma; opcional é quantas quiser; aceita id ou nome", () => {
  assert.throws(() => escolherOpcoes(BURGER, []), /escolha uma opção de "Ponto" \(Mal passado, Bem passado\)/);
  assert.throws(() => escolherOpcoes(BURGER, ["Mal passado", "Bem passado"]), /escolha uma opção de "Ponto"/);
  assert.throws(() => escolherOpcoes(BURGER, ["mal passado", "Cheddar"]), /não tem a opção "cheddar"/);
  const escolha = escolherOpcoes(BURGER, ["o-bem", " BACON ", "ovo"]);
  assert.deepEqual(escolha.map((o) => o.nome), ["Bem passado", "Bacon", "Ovo"]);
  assert.deepEqual(escolherOpcoes(BATATA, []), []);
});

test("acharItem: id, nome exato ou pedaço que só casa com um — nunca adivinha entre vários", () => {
  assert.equal(acharItem(CARDAPIO, "i-batata").nome, "Batata frita");
  assert.equal(acharItem(CARDAPIO, "x-burger").nome, "X-Burger"); // exato vence o "Duplo"
  assert.equal(acharItem(CARDAPIO, "batata").nome, "Batata frita");
  assert.throws(() => acharItem(CARDAPIO, "burger"), /pode ser: X-Burger; X-Burger Duplo/);
  assert.throws(() => acharItem(CARDAPIO, "pizza"), /não está no cardápio/);
});

test("precificar: o preço é o do cardápio de AGORA — promoção, adicionais e item que saiu", () => {
  const { linhas, subtotal } = precificar(
    [
      { id: "1", item_id: "i-burger", quantidade: 2, observacao: null, opcoes: [{ id: "o-mal", grupo: "Ponto", nome: "Mal passado" }, { id: "o-bacon", grupo: "Adicionais", nome: "Bacon" }] },
      { id: "2", item_id: "i-batata", quantidade: 1, observacao: null, opcoes: [] },
      { id: "3", item_id: "i-sumiu", quantidade: 1, observacao: null, opcoes: [] },
      { id: "4", item_id: "i-burger", quantidade: 1, observacao: null, opcoes: [{ id: "o-apagada", grupo: "Adicionais", nome: "Cheddar" }] },
    ],
    CARDAPIO,
  );
  assert.deepEqual(linhas.map((l) => l.preco_centavos), [2700, 1590, 0, 2200]);
  assert.deepEqual(linhas.map((l) => l.indisponivel), [false, false, true, true]);
  assert.equal(subtotal, 2 * 2700 + 1590 + 2200);
});

// ---------- cotação ----------

const BAIRROS: Bairro[] = [
  { id: "b-centro", nome: "Centro", taxa_centavos: 500, ativo: true },
  { id: "b-jardins", nome: "Jardins", taxa_centavos: 900, ativo: true },
  { id: "b-longe", nome: "Distrito", taxa_centavos: 2000, ativo: false },
];
const cupom = (campos: Partial<Cupom> = {}): Cupom => ({
  id: "c1", codigo: "VOLTA10", tipo: "percentual", valor: 10, minimo_centavos: 2000, limite_usos: 0, usos: 0, expira_em: null, ativo: true, ...campos,
});
const base = { cfg: { taxa_unica_centavos: 700 }, bairros: [] as Bairro[], cupom: null, saldoDeCashback: 0, hoje: "2026-11-14" };

test("cotar: sem bairro cadastrado vale a taxa única; retirada não paga taxa", () => {
  assert.equal(cotar({ ...base, subtotal: 3000, pedido: { tipo: "entrega" } }).total, 3700);
  assert.equal(cotar({ ...base, subtotal: 3000, pedido: { tipo: "retirada" } }).total, 3000);
});

test("cotar: com bairros, só os ativos são atendidos — por id ou por nome", () => {
  const com = { ...base, bairros: BAIRROS, subtotal: 3000 };
  assert.match(cotar({ ...com, pedido: { tipo: "entrega" } }).pendencias[0]!, /Atendemos: Centro, Jardins\./);
  assert.match(cotar({ ...com, pedido: { tipo: "entrega", bairro: "Distrito" } }).pendencias[0]!, /Escolha o bairro/);
  assert.equal(cotar({ ...com, pedido: { tipo: "entrega", bairro: "b-jardins" } }).taxa, 900);
  const porNome = cotar({ ...com, pedido: { tipo: "entrega", bairro: " centro " } });
  assert.deepEqual([porNome.taxa, porNome.bairro, porNome.pendencias.length], [500, "Centro", 0]);
});

test("cotar: cupom percentual e fixo, com mínimo, validade e limite de usos", () => {
  const com = (c: Cupom | null, subtotal = 3600, codigo = "volta10") => cotar({ ...base, cupom: c, subtotal, pedido: { tipo: "retirada", cupom: codigo } });
  assert.deepEqual([com(cupom()).desconto, com(cupom()).cupom, com(cupom()).total], [360, "VOLTA10", 3240]);
  assert.equal(com(cupom({ tipo: "fixo", valor: 5000 })).desconto, 3600); // nunca passa do subtotal
  assert.match(com(cupom(), 1500).pendencias[0]!, /a partir de R\$\s20,00/);
  assert.match(com(cupom({ expira_em: "2026-11-13" })).pendencias[0]!, /expirou/);
  assert.equal(com(cupom({ expira_em: "2026-11-14" })).pendencias.length, 0); // vale até o fim do dia
  assert.match(com(cupom({ limite_usos: 3, usos: 3 })).pendencias[0]!, /esgotou/);
  assert.match(com(cupom({ ativo: false })).pendencias[0]!, /não é válido/);
  assert.match(com(null).pendencias[0]!, /não é válido/);
  // Pendência de cupom não zera o resto da conta.
  assert.equal(com(null).total, 3600);
});

test("cotar: cashback abate os itens depois do cupom, nunca a taxa, e só quando pedido", () => {
  const com = { ...base, bairros: BAIRROS, cupom: cupom(), saldoDeCashback: 5000, subtotal: 3000 };
  const sem = cotar({ ...com, pedido: { tipo: "entrega", bairro: "Centro", cupom: "VOLTA10" } });
  assert.deepEqual([sem.cashback_usado, sem.cashback_disponivel, sem.total], [0, 5000, 3000 - 300 + 500]);
  const usando = cotar({ ...com, pedido: { tipo: "entrega", bairro: "Centro", cupom: "VOLTA10", usar_cashback: true } });
  assert.deepEqual([usando.cashback_usado, usando.total], [2700, 500]); // sobra só a entrega
});

test("cashbackDoPedido: só para telefone verificado, sobre o que foi pago pelos itens", () => {
  const pedido = { subtotal_centavos: 5000, desconto_centavos: 500, cashback_usado_centavos: 1000, telefone_verificado: true };
  assert.equal(cashbackDoPedido(pedido, 10), 350);
  assert.equal(cashbackDoPedido(pedido, 0), 0);
  assert.equal(cashbackDoPedido({ ...pedido, telefone_verificado: false }, 10), 0);
});

// ---------- vida do pedido ----------

test("proximosStatus: pedido sem pagamento só pode ser cancelado — a cozinha não vê antes de pago", () => {
  assert.deepEqual(proximosStatus({ status: "aguardando_pagamento", tipo: "entrega" }), ["cancelado"]);
  assert.ok(proximosStatus({ status: "recebido", tipo: "entrega" }).includes("saiu_para_entrega"));
  assert.ok(!proximosStatus({ status: "recebido", tipo: "retirada" }).includes("saiu_para_entrega"));
  assert.ok(proximosStatus({ status: "recebido", tipo: "retirada" }).includes("pronto_para_retirada"));
  assert.deepEqual(proximosStatus({ status: "entregue", tipo: "entrega" }), []);
  assert.deepEqual(proximosStatus({ status: "cancelado", tipo: "entrega" }), []);
});

test("resumoDosPedidos: conta só o que foi pago, e o dia é o da casa", () => {
  const p = (campos: Record<string, unknown>) => ({
    criado_em: "2026-11-14T02:00:00Z", total_centavos: 5000, desconto_centavos: 0, cashback_usado_centavos: 0,
    origem: "cardapio", canal: "site", pagamento: "pix", status: "entregue",
    itens: [{ nome: "X-Burger", quantidade: 2, preco_centavos: 2200 }], ...campos,
  });
  const r = resumoDosPedidos(
    [
      p({}),
      p({ origem: "conversa", canal: "whatsapp", pagamento: "cartao", total_centavos: 3000, desconto_centavos: 300, itens: [{ nome: "Batata frita", quantidade: 1, preco_centavos: 1800 }] }),
      p({ status: "cancelado" }),
      p({ status: "aguardando_pagamento" }),
    ],
    "America/Cuiaba",
  );
  assert.deepEqual([r.pedidos, r.faturamento_centavos, r.ticket_medio_centavos, r.descontos_centavos, r.cancelados], [2, 8000, 4000, 300, 1]);
  // 02:00 UTC do dia 14 ainda é dia 13 em Cuiabá.
  assert.deepEqual(r.por_dia, [{ rotulo: "2026-11-13", pedidos: 2, centavos: 8000 }]);
  assert.equal(r.por_canal[0]!.rotulo, "cardapio:site");
  assert.deepEqual(r.mais_vendidos[0], { rotulo: "X-Burger", quantidade: 2, centavos: 4400 });
});

// ---------- segredos e Mercado Pago ----------

test("configParaATela nunca devolve o token nem o segredo do Mercado Pago", () => {
  const tela = configParaATela({ ...CONFIG_PADRAO, mp_access_token: "APP_USR-segredo-1234", mp_webhook_secret: "s3gredo" });
  assert.deepEqual(tela.mercado_pago, { conectado: true, final_do_token: "1234", webhook_assinado: true });
  assert.ok(!JSON.stringify(tela).includes("segredo-"));
  assert.ok(!JSON.stringify(tela).includes("s3gredo"));
  assert.equal(configParaATela(CONFIG_PADRAO).mercado_pago.conectado, false);
});

test("assinatura do webhook do Mercado Pago", () => {
  const v1 = createHmac("sha256", "seg").update("id:123;request-id:req-1;ts:1700000000;").digest("hex");
  assert.equal(assinaturaConfere("seg", `ts=1700000000,v1=${v1}`, "req-1", "123"), true);
  assert.equal(assinaturaConfere("seg", `ts=1700000000,v1=${v1}`, "req-1", "124"), false);
  assert.equal(assinaturaConfere("outro", `ts=1700000000,v1=${v1}`, "req-1", "123"), false);
  assert.equal(assinaturaConfere("seg", undefined, "req-1", "123"), false);
});

test("corpoDoPix: valor em reais, pedido como referência, webhook da casa e 30 minutos de validade", () => {
  const corpo = corpoDoPix({
    pedido: { id: "11111111-1111-1111-1111-111111111111", numero: 42, total_centavos: 6790, nome: "Ana" },
    casa: { nome: "Delliris", slug: "delliris" },
    emailPagador: "financeiro@casa.com",
    agora: new Date("2026-11-14T20:00:00Z"),
  });
  assert.equal(corpo.transaction_amount, 67.9);
  assert.equal(corpo.external_reference, "11111111-1111-1111-1111-111111111111");
  assert.equal(corpo.date_of_expiration, "2026-11-14T20:30:00.000+00:00");
  assert.match(String(corpo.notification_url), /\/v1\/webhooks\/mercadopago\/delliris$/);
});

// ---------- o agente ----------

test("as ferramentas de delivery não entram no conjunto padrão — só na casa que tem o módulo", () => {
  assert.ok(!FERRAMENTAS_PADRAO.some((n) => n.startsWith("delivery_")));
  const padrao = resolveTools(undefined);
  const comModulo = comDelivery(padrao, undefined);
  assert.equal(comModulo.length, padrao.length + 9);
  assert.ok(comModulo.some((t) => t.definition.name === "delivery_finalizar_pedido"));
  // Lista explícita é respeitada à risca.
  const restrito = resolveTools(["hora_atual"]);
  assert.deepEqual(comDelivery(restrito, ["hora_atual"]).map((t) => t.definition.name), ["hora_atual"]);
  // …mas quem quiser cita a ferramenta pelo nome.
  assert.equal(resolveTools(["delivery_ver_sacola"])[0]!.definition.name, "delivery_ver_sacola");
});
