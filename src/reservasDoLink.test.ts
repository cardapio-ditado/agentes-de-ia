import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PedidoInvalido, chaveDoLinkConfere, chaveGuardada, lerPedidoDoLink } from "./reservasDoLink.js";

const FUSO = "America/Cuiaba";
const AGORA = new Date("2026-11-23T15:00:00Z");
const pedido = (extra: Record<string, unknown> = {}) => ({
  evento: "criada",
  id: "9f1c2d3e",
  nome: "Mariana Costa",
  telefone: "(65) 99812-3344",
  dia: "2026-11-28",
  horario: "20:00",
  pessoas: 8,
  ambiente: "varanda",
  observacao: "Aniversário, vai levar bolo",
  ...extra,
});

test("lê uma pré-reserva do formulário e calcula a hora no fuso da casa", () => {
  const p = lerPedidoDoLink(pedido(), FUSO, AGORA);
  assert.equal(p.evento, "criada");
  assert.equal(p.id, "9f1c2d3e");
  // 20h em Cuiabá (UTC-4) é meia-noite UTC do dia seguinte.
  assert.equal(p.dados?.reservadoPara, "2026-11-29T00:00:00.000Z");
  assert.equal(p.dados?.pessoas, 8);
  assert.equal(p.dados?.ambiente, "varanda");
  assert.equal(p.dados?.telefone, "(65) 99812-3344");
});

test("sem evento vale como criada; id numérico vira texto; horário com segundos é aceito", () => {
  const p = lerPedidoDoLink(pedido({ evento: undefined, id: 4127, horario: "19:30:00", pessoas: "4" }), FUSO, AGORA);
  assert.equal(p.evento, "criada");
  assert.equal(p.id, "4127");
  assert.equal(p.dados?.reservadoPara, "2026-11-28T23:30:00.000Z");
  assert.equal(p.dados?.pessoas, 4);
});

test("'sem preferência' não ocupa o campo de ambiente; observação vazia vira nula", () => {
  const p = lerPedidoDoLink(pedido({ ambiente: "Sem preferência", observacao: "  " }), FUSO, AGORA);
  assert.equal(p.dados?.ambiente, null);
  assert.equal(p.dados?.observacao, null);
});

test("confirmar e cancelar só precisam do id", () => {
  assert.deepEqual(lerPedidoDoLink({ evento: "confirmada", id: "abc" }, FUSO, AGORA), { evento: "confirmada", id: "abc", dados: null });
  assert.deepEqual(lerPedidoDoLink({ evento: "CANCELADA", id: "abc" }, FUSO, AGORA), { evento: "cancelada", id: "abc", dados: null });
});

test("recusa o que não dá para virar reserva, dizendo o porquê", () => {
  const recusa = (extra: Record<string, unknown>, trecho: RegExp) =>
    assert.throws(() => lerPedidoDoLink(pedido(extra), FUSO, AGORA), (e: unknown) => e instanceof PedidoInvalido && trecho.test(e.message));
  recusa({ id: "" }, /id/);
  recusa({ evento: "apagada" }, /evento/);
  recusa({ nome: "A" }, /nome/);
  recusa({ telefone: "99812-3344" }, /telefone/);
  recusa({ pessoas: 0 }, /pessoas/);
  recusa({ pessoas: 2.5 }, /pessoas/);
  recusa({ dia: "28/11/2026" }, /dia/);
  recusa({ horario: "8 da noite" }, /horario/);
  recusa({ dia: "2026-11-20" }, /já passou/);
  recusa({ observacao: "x".repeat(501) }, /observacao/);
});

test("a chave confere pelo resumo, e casa sem chave recusa tudo", () => {
  const chave = "brl_" + "a1".repeat(32);
  const settings = { reservas_link: { segredo_sha256: createHash("sha256").update(chave).digest("hex"), criada_em: "2026-11-23T12:00:00Z" } };
  assert.equal(chaveDoLinkConfere(settings, chave), true);
  assert.equal(chaveDoLinkConfere(settings, ` ${chave} `), true);
  assert.equal(chaveDoLinkConfere(settings, [chave, "outra"]), true);
  assert.equal(chaveDoLinkConfere(settings, chave + "x"), false);
  assert.equal(chaveDoLinkConfere(settings, ""), false);
  assert.equal(chaveDoLinkConfere(settings, undefined), false);
  // Sem chave gerada, nem a string vazia nem um palpite entram.
  assert.equal(chaveDoLinkConfere({}, chave), false);
  assert.equal(chaveDoLinkConfere(null, chave), false);
  assert.equal(chaveDoLinkConfere({ reservas_link: { segredo_sha256: "curto" } }, "curto"), false);
});

test("o que fica guardado é o resumo, nunca a chave", () => {
  const guardada = chaveGuardada({ reservas_link: { segredo_sha256: "f".repeat(64), criada_em: "2026-11-23T12:00:00Z" } });
  assert.deepEqual(guardada, { resumo: "f".repeat(64), criada_em: "2026-11-23T12:00:00Z" });
  assert.equal(chaveGuardada({ reservas_link: { segredo: "brl_abc" } }), null);
});
