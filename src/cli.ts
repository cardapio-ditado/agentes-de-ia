import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { parseArgs } from "node:util";
import { runAgent } from "./agent.js";

/**
 * Chat de linha de comando para testar um agente.
 *
 *   npm run chat -- --agent recepcionista --venue ditado-popular
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      agent: { type: "string", default: "recepcionista" },
      venue: { type: "string" },
      canal: { type: "string", default: "cli" },
      contato: { type: "string" },
    },
  });

  const agentSlug = values.agent!;
  const externalId = values.contato ?? `cli-${Date.now()}`;

  console.log(`Agente: ${agentSlug}${values.venue ? ` | Estabelecimento: ${values.venue}` : ""}`);
  console.log('Digite sua mensagem. Use "sair" para encerrar.\n');

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const entrada = (await rl.question("você > ")).trim();
      if (entrada === "" ) continue;
      if (["sair", "exit", "quit"].includes(entrada.toLowerCase())) break;

      try {
        const resultado = await runAgent({
          agentSlug,
          userMessage: entrada,
          channel: values.canal!,
          externalId,
          venueSlug: values.venue,
        });
        console.log(`\nagente > ${resultado.text}\n`);
      } catch (erro) {
        console.error(`\n[erro] ${erro instanceof Error ? erro.message : String(erro)}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
