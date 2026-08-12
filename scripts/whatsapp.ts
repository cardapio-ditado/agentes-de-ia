import { parseArgs } from "node:util";
import { iniciarWhatsapp, estadoWhatsapp, pararWhatsapp } from "../src/channels/whatsapp.js";

/**
 * Sobe o conector WhatsApp sozinho, sem a API.
 *
 *   npm run whatsapp -- --agent recepcionista --venue ditado-popular
 *
 * O QR aparece como arquivo PNG (data URL impressa no log) e também em
 * GET /v1/whatsapp/status quando o servidor está no ar.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      agent: { type: "string", default: "recepcionista" },
      venue: { type: "string", default: "ditado-popular" },
    },
  });

  console.log("AVISO: Baileys é um cliente não oficial do WhatsApp.");
  console.log("Está fora dos termos de uso da Meta e o número pode ser banido.");
  console.log("Use um chip separado do número principal da casa.\n");

  await iniciarWhatsapp({ agentSlug: values.agent!, venueSlug: values.venue! });

  const encerrar = async (): Promise<void> => {
    console.log("\nEncerrando…");
    await pararWhatsapp();
    process.exit(0);
  };
  process.on("SIGINT", () => void encerrar());
  process.on("SIGTERM", () => void encerrar());

  // Mantém o processo vivo e mostra o status de tempos em tempos.
  setInterval(() => {
    const estado = estadoWhatsapp();
    if (estado.status === "aguardando_qr") {
      console.log("[whatsapp] aguardando leitura do QR pelo painel…");
    }
  }, 30_000);
}

main().catch((erro) => {
  console.error(`\n[erro] ${erro instanceof Error ? erro.message : erro}\n`);
  process.exit(1);
});
