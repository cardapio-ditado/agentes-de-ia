import assert from "node:assert/strict";
import test from "node:test";
import { chamadaLocal, enderecoDeLoopback } from "./origemLocal.js";

test("loopback é 127.x, ::1 e o IPv4 embrulhado em IPv6", () => {
  for (const sim of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1", "::FFFF:127.0.0.1"]) {
    assert.equal(enderecoDeLoopback(sim), true, sim);
  }
  for (const nao of ["192.168.0.10", "10.0.0.1", "::ffff:192.168.0.10", "128.0.0.1", "1127.0.0.1", "127.0.0.1.evil", "fe80::1", "", undefined, null]) {
    assert.equal(enderecoDeLoopback(nao), false, String(nao));
  }
});

test("a chamada só é local pelo socket — o x-forwarded-for nunca promove ninguém", () => {
  const req = (remoteAddress: string | undefined, headers: Record<string, string> = {}) => ({ headers, socket: { remoteAddress } });

  assert.equal(chamadaLocal(req("127.0.0.1")), true);
  assert.equal(chamadaLocal(req("::1")), true);
  // O celular na rede do bar dizendo que é a própria máquina: não é.
  assert.equal(chamadaLocal(req("192.168.0.23", { "x-forwarded-for": "127.0.0.1" })), false);
  assert.equal(chamadaLocal(req("192.168.0.23")), false);
  // Atrás do Caddy/nginx todo mundo chega como 127.0.0.1 — mas com o
  // cabeçalho do proxy, e por isso não ganha o atalho.
  assert.equal(chamadaLocal(req("127.0.0.1", { "x-forwarded-for": "200.1.2.3" })), false);
  assert.equal(chamadaLocal(req("127.0.0.1", { forwarded: "for=200.1.2.3" })), false);
  assert.equal(chamadaLocal(req("127.0.0.1", { "x-real-ip": "200.1.2.3" })), false);
  // Sem socket (não deveria acontecer): não é local.
  assert.equal(chamadaLocal({ headers: {}, socket: null }), false);
  assert.equal(chamadaLocal(req(undefined)), false);
});
