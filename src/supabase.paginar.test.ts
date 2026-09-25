import assert from "node:assert/strict";
import test from "node:test";
import { todasAsLinhas } from "./supabase.js";
import { mesesDaJanela } from "./aniversarios.js";

/** Um banco de mentira que, como o PostgREST, nunca devolve mais de 1000 por vez. */
function bancoCom(total: number) {
  const pedidos: Array<[number, number]> = [];
  const monta = () => ({
    range: async (de: number, ate: number) => {
      pedidos.push([de, ate]);
      const fim = Math.min(ate + 1, total, de + 1000);
      return { data: Array.from({ length: Math.max(0, fim - de) }, (_, i) => de + i), error: null };
    },
  });
  return { monta, pedidos };
}

test("pega todas as linhas em páginas de mil — o corte que escondeu 2.414 aniversariantes", async () => {
  const { monta, pedidos } = bancoCom(2414);
  const { data, error } = await todasAsLinhas<number>(monta);
  assert.equal(error, null);
  assert.equal(data.length, 2414);
  assert.equal(data[2413], 2413);
  assert.deepEqual(pedidos, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("para na primeira página curta, e respeita o teto", async () => {
  const curto = bancoCom(300);
  assert.equal((await todasAsLinhas<number>(curto.monta)).data.length, 300);
  assert.equal(curto.pedidos.length, 1);

  const comTeto = bancoCom(10_000);
  const { data } = await todasAsLinhas<number>(comTeto.monta, { teto: 2500 });
  assert.equal(data.length, 2500);
  assert.deepEqual(comTeto.pedidos, [[0, 999], [1000, 1999], [2000, 2499]]);
});

test("erro no meio devolve o que já veio, com o erro", async () => {
  let vez = 0;
  const monta = () => ({
    range: async (de: number, ate: number) => {
      vez += 1;
      if (vez === 2) return { data: null, error: { message: "caiu" } };
      return { data: Array.from({ length: ate - de + 1 }, (_, i) => de + i), error: null };
    },
  });
  const { data, error } = await todasAsLinhas<number>(monta);
  assert.equal(data.length, 1000);
  assert.equal(error?.message, "caiu");
});

test("os meses da janela atravessam a virada do ano", () => {
  assert.deepEqual(mesesDaJanela("2026-09-25", 45), [9, 10, 11]);
  assert.deepEqual(mesesDaJanela("2026-12-20", 30), [12, 1]);
  assert.deepEqual(mesesDaJanela("2026-03-01", 0), [3]);
  assert.equal(mesesDaJanela("2026-01-01", 366).length, 12);
});
