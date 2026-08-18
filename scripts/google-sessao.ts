import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  abrirNavegador,
  DIRETORIO_SESSAO,
  pausaHumana,
  sessaoValida,
} from "../src/googleNavegador.js";

/**
 * Sessão da conta gerente do Google: entrar, conferir e diagnosticar.
 *
 *   npx tsx scripts/google-sessao.ts login
 *   npx tsx scripts/google-sessao.ts estado
 *   npx tsx scripts/google-sessao.ts diagnostico --url "https://business.google.com/..."
 *
 * O `login` precisa de tela. Numa VPS sem ambiente gráfico ele não roda — e
 * essa é uma limitação de verdade, não um detalhe: veja o README do módulo.
 */
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { url: { type: "string" } },
  });
  const comando = positionals[0] ?? "estado";

  if (comando === "login") return await login();
  if (comando === "estado") return await estado();
  if (comando === "diagnostico") return await diagnostico(values.url);

  console.error(`Comando "${comando}" não existe. Use: login | estado | diagnostico`);
  process.exit(1);
}

async function login(): Promise<void> {
  console.log(`Abrindo o navegador. A sessão ficará em: ${DIRETORIO_SESSAO}`);
  console.log("Entre com a conta GERENTE — nunca com a conta pessoal do dono do restaurante.\n");

  const sessao = await abrirNavegador({ visivel: true });
  const pagina = await sessao.contexto.newPage();
  await pagina.goto("https://business.google.com/");

  const rl = createInterface({ input: stdin, output: stdout });
  await rl.question(
    "Faça o login na janela que abriu. Quando o perfil da empresa aparecer, tecle ENTER aqui… ",
  );
  rl.close();

  const valida = await sessaoValida(sessao);
  await sessao.fechar();

  if (!valida) {
    console.error("\nA sessão não ficou válida — o Google ainda pede login. Tente de novo.");
    process.exit(1);
  }
  console.log("\nSessão salva. O conector já consegue usar esta conta.");
}

async function estado(): Promise<void> {
  const sessao = await abrirNavegador();
  const valida = await sessaoValida(sessao);
  await sessao.fechar();
  console.log(valida ? "Sessão VÁLIDA." : "Sessão EXPIRADA — rode o login de novo.");
  process.exit(valida ? 0 : 1);
}

/**
 * Guarda o que a página realmente é: uma foto e o HTML.
 *
 * Existe porque os seletores desta automação não podem ser adivinhados. A
 * interface do Google muda sem aviso e não tem contrato público; escrever
 * seletor de cabeça produz código que parece pronto e nunca funcionou. Com a
 * foto e o HTML na mão, o seletor é escrito a partir do que existe.
 */
async function diagnostico(url?: string): Promise<void> {
  // Sem --url, usa o link que o painel guardou: é o mesmo que o dono salvou
  // na tela de Avaliações, e poupa o operador de digitar endereço no terminal.
  let alvo = url;
  if (!alvo) {
    const { db } = await import("../src/supabase.js");
    const { data } = await db()
      .from("google_perfis")
      .select("local_id")
      .not("local_id", "is", null)
      .limit(1)
      .maybeSingle();
    alvo = data?.local_id ?? "https://business.google.com/";
    console.log(`Usando o link salvo no painel: ${alvo}`);
  }
  const sessao = await abrirNavegador();
  const pagina = await sessao.contexto.newPage();

  try {
    await pagina.goto(alvo, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await pausaHumana(2500, 4000);

    const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
    const foto = `diagnostico-${carimbo}.png`;
    const html = `diagnostico-${carimbo}.html`;

    await pagina.screenshot({ path: foto, fullPage: true });
    await writeFile(html, await pagina.content(), "utf8");

    console.log(`URL final: ${pagina.url()}`);
    console.log(`Foto:  ${foto}`);
    console.log(`HTML:  ${html}`);
    if (/accounts\.google\.com/.test(pagina.url())) {
      console.log("\nO Google redirecionou para o login: a sessão expirou.");
    }
  } finally {
    await pagina.close().catch(() => undefined);
    await sessao.fechar();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
