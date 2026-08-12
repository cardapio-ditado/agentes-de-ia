import { canalAtivo, listPendingNotifications, tentarEnviar } from "../src/notifications.js";

/**
 * Reenvia notificações que ainda não saíram.
 *
 *   npm run reenviar-notificacoes
 *
 * Feito para rodar em cron (a cada poucos minutos). Cada execução tenta uma
 * vez por notificação; o limite de tentativas mora em `listPendingNotifications`,
 * então uma mensagem que nunca sai para de ser tentada em vez de girar para sempre.
 */
async function main(): Promise<void> {
  const pendentes = await listPendingNotifications();

  if (pendentes.length === 0) {
    console.log("Nenhuma notificação pendente.");
    return;
  }

  console.log(`${pendentes.length} pendente(s). Canal ativo: ${canalAtivo()}.\n`);
  let enviadas = 0;

  for (const notificacao of pendentes) {
    const resultado = await tentarEnviar(notificacao);
    const ok = resultado.status === "sent";
    if (ok) enviadas++;
    console.log(
      `  ${ok ? "enviada" : "falhou "}  ${resultado.destination}  ${resultado.template}` +
        (ok ? "" : `  — ${resultado.error ?? "erro desconhecido"}`),
    );
  }

  console.log(`\n${enviadas} de ${pendentes.length} enviada(s).`);
}

main().catch((erro) => {
  console.error(`\n[erro] ${erro instanceof Error ? erro.message : erro}\n`);
  process.exit(1);
});
