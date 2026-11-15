import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { chaveDoBalde, esquecerDescansoDoBanco, LimiteDuravel, type RespostaDoBalde } from "./limiteDeRitmo.js";

beforeEach(() => esquecerDescansoDoBanco());

// Sem barulho de console.error/warn nos casos em que o banco falha de propósito.
const emSilencio = async <T>(acao: () => Promise<T>): Promise<T> => {
  const { error, warn } = console;
  console.error = () => undefined;
  console.warn = () => undefined;
  try {
    return await acao();
  } finally {
    console.error = error;
    console.warn = warn;
  }
};

test("a chave do balde é embaralhada, estável, e separa um limite do outro", () => {
  const chave = chaveDoBalde("login:email", "Dono@Casa.com ");
  assert.match(chave, /^[0-9a-f]{64}$/);
  assert.ok(!chave.includes("dono"));
  // Maiúscula e espaço não abrem um balde novo para a mesma pessoa.
  assert.equal(chave, chaveDoBalde("login:email", "dono@casa.com"));
  assert.notEqual(chave, chaveDoBalde("login:ip", "dono@casa.com"));
  assert.notEqual(chave, chaveDoBalde("login:email", "outro@casa.com"));
});

test("com o banco respondendo, quem decide é o banco", async () => {
  const chamadas: Array<[string, number, number]> = [];
  let resposta: RespostaDoBalde = { permitido: true };
  const limite = new LimiteDuravel("teste", 3, 10 * 60_000, async (chave, maximo, janela) => {
    chamadas.push([chave, maximo, janela]);
    return resposta;
  });

  assert.equal(await limite.permitir("1.2.3.4"), true);
  assert.deepEqual(chamadas[0], [chaveDoBalde("teste", "1.2.3.4"), 3, 600]);

  // Outra instância já gastou a cota: a memória daqui diria "pode", o banco diz "não".
  resposta = { permitido: false };
  assert.equal(await limite.permitir("1.2.3.4"), false);

  // E o contrário: a memória daqui estourou, mas a janela do banco virou.
  resposta = { permitido: true };
  for (let i = 0; i < 5; i++) assert.equal(await limite.permitir("1.2.3.4"), true);
});

test("sem a migração, cai na memória — e não insiste no banco a cada chamada", async () => {
  let chamadas = 0;
  const limite = new LimiteDuravel("teste", 2, 60_000, async () => {
    chamadas++;
    return { erro: "Could not find the function public.limite_de_ritmo_bater(p_chave, p_janela_segundos, p_maximo) in the schema cache" };
  });
  const agora = 1_000_000;
  await emSilencio(async () => {
    assert.equal(await limite.permitir("ip", agora), true);
    assert.equal(await limite.permitir("ip", agora + 1), true);
    // A terceira estoura o limite EM MEMÓRIA: abrir para a memória não é abrir de vez.
    assert.equal(await limite.permitir("ip", agora + 2), false);
    assert.equal(chamadas, 1);
    // Passado o descanso, tenta o banco de novo.
    await limite.permitir("ip", agora + 5 * 60_000 + 1);
    assert.equal(chamadas, 2);
  });
});

test("banco fora do ar não tranca ninguém: vale a memória", async () => {
  const estoura = new LimiteDuravel("teste", 5, 60_000, async () => {
    throw new Error("fetch failed");
  });
  const erra = new LimiteDuravel("teste2", 5, 60_000, async () => ({ erro: "connection refused" }));
  await emSilencio(async () => {
    assert.equal(await estoura.permitir("ip", 1000), true);
    esquecerDescansoDoBanco();
    assert.equal(await erra.permitir("ip", 1000), true);
  });
});

test("banco que demora perde a vez para a memória", async () => {
  let solto: (() => void) | undefined;
  const limite = new LimiteDuravel(
    "teste",
    1,
    60_000,
    () => new Promise<RespostaDoBalde>((resolver) => { solto = () => resolver({ permitido: false }); }),
    20,
  );
  await emSilencio(async () => {
    const inicio = Date.now();
    assert.equal(await limite.permitir("ip"), true);
    assert.ok(Date.now() - inicio < 1000);
  });
  solto?.();
});

test("depois de um erro, o descanso vale para todos os limites — e passa", async () => {
  let chamadas = 0;
  const quebrado = new LimiteDuravel("a", 5, 60_000, async () => ({ erro: "timeout" }));
  const outro = new LimiteDuravel("b", 5, 60_000, async () => {
    chamadas++;
    return { permitido: false };
  });
  await emSilencio(async () => {
    await quebrado.permitir("ip", 10_000);
    // Dentro do descanso: nem pergunta ao banco, decide pela memória.
    assert.equal(await outro.permitir("ip", 10_001), true);
    assert.equal(chamadas, 0);
    // Depois do descanso (30 s), o banco volta a mandar.
    assert.equal(await outro.permitir("ip", 10_000 + 30_001), false);
    assert.equal(chamadas, 1);
  });
});
