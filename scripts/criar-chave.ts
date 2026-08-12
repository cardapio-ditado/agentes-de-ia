import { parseArgs } from "node:util";
import { createApiKey } from "../src/apikeys.js";
import { db } from "../src/supabase.js";

/**
 * Cria uma chave de API para uma organização.
 *
 *   npm run criar-chave -- --org ditado --nome "Painel interno"
 *
 * A chave é exibida uma única vez: guardamos só o hash.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      org: { type: "string", default: "ditado" },
      nome: { type: "string", default: "Chave padrão" },
    },
  });

  const { data: org, error } = await db()
    .from("organizations")
    .select("id, name")
    .eq("slug", values.org!)
    .maybeSingle();

  if (error) throw new Error(`organizations: ${error.message}`);
  if (!org) throw new Error(`Organização "${values.org}" não encontrada. Rode \`npm run seed\`.`);

  const { chave, registro } = await createApiKey({ orgId: org.id, name: values.nome! });

  console.log(`\nChave criada para ${org.name}`);
  console.log(`  Nome    : ${registro.name}`);
  console.log(`  Escopos : ${registro.scopes.join(", ")}`);
  console.log(`\n  ${chave}\n`);
  console.log("Esta é a única vez que a chave aparece — guarde agora.");
  console.log("Guardamos apenas o hash; não há como recuperá-la depois.\n");
}

main().catch((erro) => {
  console.error(`\n[erro] ${erro instanceof Error ? erro.message : erro}\n`);
  process.exit(1);
});
