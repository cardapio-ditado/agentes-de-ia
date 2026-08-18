import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { sincronizar } from "../src/channels/googleAvaliacoes.js";
import { db } from "../src/supabase.js";

/**
 * Trava de consentimento.
 *
 * Na primeira visita automatizada o Google respondeu com CAPTCHA de "tráfego
 * incomum" (18/08/2026) — o degrau seguinte dessa escada é restrição na conta
 * gerente. Rodar de novo tem que ser decisão consciente de quem entende o
 * risco, nunca um duplo clique por hábito. A recomendação é esperar a API
 * oficial, já solicitada.
 */
async function confirmarRisco(): Promise<boolean> {
  console.log("AVISO: o Google sinalizou esta automação com CAPTCHA em 18/08/2026.");
  console.log("Insistir pode restringir a conta gerente. Recomendado: aguardar a API oficial.");
  const rl = createInterface({ input: stdin, output: stdout });
  const resposta = await rl.question('Digite "ENTENDO O RISCO" para rodar mesmo assim: ');
  rl.close();
  return resposta.trim().toUpperCase() === "ENTENDO O RISCO";
}

/**
 * Uma passada de sincronização em todos os perfis conectados.
 *
 *   npx tsx scripts/google-sincronizar.ts
 *
 * Feito para rodar por agendamento (cron/systemd timer), e não como serviço
 * ligado o tempo todo: o Chromium ocupa centenas de megabytes parado, e
 * avaliação nova é evento de horas, não de segundos.
 *
 * Um perfil por vez, em série. Abrir vários navegadores ao mesmo tempo derruba
 * uma VPS pequena — e é o padrão de tráfego que menos parece gente.
 */
async function main(): Promise<void> {
  if (!(await confirmarRisco())) {
    console.log("Cancelado. As respostas continuam disponíveis no painel para copiar e colar.");
    return;
  }
  const { data, error } = await db()
    .from("google_perfis")
    .select("*")
    .in("status", ["pendente", "conectado", "sessao_expirada"]);

  if (error) {
    console.error(`Falha ao listar os perfis: ${error.message}`);
    process.exit(1);
  }
  const perfis = data ?? [];
  if (perfis.length === 0) {
    console.log("Nenhum perfil do Google conectado.");
    return;
  }

  let comFalha = 0;
  for (const perfil of perfis) {
    try {
      const r = await sincronizar(perfil);
      console.log(
        `[${perfil.venue_id}] lidas=${r.lidas} novas=${r.novas} ` +
          `publicadas=${r.publicadas} falhas=${r.falhas}`,
      );
      if (r.falhas > 0) comFalha += 1;
    } catch (e) {
      // Um perfil quebrado não pode impedir os outros de rodar: numa carteira
      // de clientes, isso seria um cliente derrubando o serviço de todos.
      comFalha += 1;
      console.error(`[${perfil.venue_id}] ${e instanceof Error ? e.message : e}`);
    }
  }

  if (comFalha > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
