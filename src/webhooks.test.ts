import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { assinar, tentarComBackoff } from "./webhooks.js";

const SEGREDO = "segredo-de-teste";

/** Verificação do lado do receptor — o que um integrador teria de implementar. */
function verificar(segredo: string, assinatura: string, corpo: string): boolean {
  const partes = Object.fromEntries(
    assinatura.split(",").map((p) => p.split("=") as [string, string]),
  );
  if (!partes.t || !partes.v1) return false;

  const esperado = createHmac("sha256", segredo).update(`${partes.t}.${corpo}`).digest();
  const recebido = Buffer.from(partes.v1, "hex");
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

/** Sobe um receptor que responde os status da lista, um por requisição. */
function receptor(statusPorTentativa: number[]): Promise<{
  servidor: Server;
  url: string;
  recebidas: { assinatura: string; corpo: string }[];
}> {
  const recebidas: { assinatura: string; corpo: string }[] = [];

  const servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (parte: Buffer) => partes.push(parte));
    req.on("end", () => {
      recebidas.push({
        assinatura: String(req.headers["x-webhook-signature"] ?? ""),
        corpo: Buffer.concat(partes).toString("utf8"),
      });
      const status = statusPorTentativa[recebidas.length - 1] ?? 200;
      res.writeHead(status).end();
    });
  });

  return new Promise((resolve) => {
    servidor.listen(0, "127.0.0.1", () => {
      const endereco = servidor.address();
      const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
      resolve({ servidor, url: `http://127.0.0.1:${porta}/hook`, recebidas });
    });
  });
}

const servidores: Server[] = [];
after(() => {
  for (const s of servidores) s.close();
});

describe("assinatura de webhook", () => {
  it("gera assinatura que o receptor consegue verificar", () => {
    const corpo = JSON.stringify({ event: "reservation.approved" });
    const assinatura = assinar(SEGREDO, 1_700_000_000, corpo);

    assert.match(assinatura, /^t=\d+,v1=[0-9a-f]{64}$/);
    assert.equal(verificar(SEGREDO, assinatura, corpo), true);
  });

  it("rejeita corpo adulterado", () => {
    const assinatura = assinar(SEGREDO, 1_700_000_000, '{"party_size":2}');
    assert.equal(verificar(SEGREDO, assinatura, '{"party_size":200}'), false);
  });

  it("rejeita assinatura feita com outro segredo", () => {
    const corpo = '{"a":1}';
    const assinatura = assinar("outro-segredo", 1_700_000_000, corpo);
    assert.equal(verificar(SEGREDO, assinatura, corpo), false);
  });
});

describe("entrega com retentativa", () => {
  it("entrega de primeira quando o receptor responde 200", async () => {
    const { servidor, url, recebidas } = await receptor([200]);
    servidores.push(servidor);

    const corpo = JSON.stringify({ event: "reservation.approved" });
    const resultado = await tentarComBackoff({ url, secret: SEGREDO }, corpo, 5);

    assert.equal(resultado.entregue, true);
    assert.equal(resultado.tentativas, 1);
    assert.equal(recebidas.length, 1);
    assert.equal(verificar(SEGREDO, recebidas[0]!.assinatura, corpo), true);
  });

  it("repete no 500 e desiste após 5 tentativas", async () => {
    const { servidor, url, recebidas } = await receptor([500, 500, 500, 500, 500]);
    servidores.push(servidor);

    const resultado = await tentarComBackoff({ url, secret: SEGREDO }, "{}", 5);

    assert.equal(resultado.entregue, false);
    assert.equal(resultado.tentativas, 5);
    assert.equal(recebidas.length, 5);
  });

  it("repete no 500 e para assim que o receptor volta", async () => {
    const { servidor, url, recebidas } = await receptor([503, 200]);
    servidores.push(servidor);

    const resultado = await tentarComBackoff({ url, secret: SEGREDO }, "{}", 5);

    assert.equal(resultado.entregue, true);
    assert.equal(resultado.tentativas, 2);
    assert.equal(recebidas.length, 2);
  });

  it("não repete no 400 — erro do cliente não melhora sozinho", async () => {
    const { servidor, url, recebidas } = await receptor([400]);
    servidores.push(servidor);

    const resultado = await tentarComBackoff({ url, secret: SEGREDO }, "{}", 5);

    assert.equal(resultado.entregue, false);
    assert.equal(resultado.tentativas, 1);
    assert.equal(recebidas.length, 1, "não deveria ter tentado de novo");
  });
});
