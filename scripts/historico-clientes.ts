import { parseArgs } from "node:util";
import { casasComZig, preencherHistorico } from "../src/historicoZig.js";

/**
 * A carga histórica da base de clientes, de uma vez.
 *
 *   npm run clientes:historico                      # 365 dias, todas as casas
 *   npm run clientes:historico -- --dias 180
 *   npm run clientes:historico -- --casa ditado-popular
 *
 * RODE ISTO NO SERVIDOR, não na sua máquina: é lá que o token da Zig está
 * configurado e é de lá que a API dela responde.
 *
 * Pode parar no meio (Ctrl+C) e rodar de novo depois — os dias já buscados
 * são pulados, porque o marcador é o próprio dado. E mesmo que ninguém rode
 * este comando, a varredura de hora em hora tapa os mesmos buracos sozinha,
 * só que em dias em vez de horas.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dias: { type: "string", default: "365" },
      casa: { type: "string" },
      // Uma pausa entre os dias, para não martelar a API da Zig.
      pausa: { type: "string", default: "1200" },
    },
  });

  const janela = Number(values.dias);
  const pausa = Number(values.pausa);
  if (!Number.isFinite(janela) || janela < 1) {
    throw new Error(`--dias precisa ser um número de dias, veio "${values.dias}".`);
  }

  const todas = await casasComZig();
  const casas = values.casa
    ? todas.filter((c) => c.name.toLowerCase().includes(values.casa!.toLowerCase()))
    : todas;

  if (casas.length === 0) {
    console.log(
      todas.length === 0
        ? "Nenhuma casa com token e loja da Zig preenchidos."
        : `Nenhuma casa casa com "${values.casa}". Tem: ${todas.map((c) => c.name).join(", ")}.`,
    );
    return;
  }

  for (const casa of casas) {
    console.log(`\n${casa.name} — procurando buracos nos últimos ${janela} dias…`);
    let jaContei = false;
    let faltavamAntes = Infinity;

    // Em voltas, e não de uma vez: `preencherHistorico` só busca o teto dela
    // por chamada, e assim o progresso aparece na tela em vez de o comando
    // ficar mudo por meia hora.
    for (;;) {
      const r = await preencherHistorico(casa, {
        janela,
        teto: 10,
        aoAndar: (dia, visitantes) => console.log(`  ${dia} — ${visitantes} visitante(s)`),
      });
      if (!jaContei) {
        console.log(`  ${r.faltavam} dia(s) faltando.`);
        jaContei = true;
      }
      if (r.buscados === 0) {
        if (r.falharam > 0) {
          console.log(`  parei: ${r.falharam} dia(s) deram erro e não saem do lugar.`);
        }
        break;
      }

      // A TRAVA QUE FALTAVA.
      //
      // O comando já buscou as mesmas dez datas em laço, sem fim, porque os
      // dias vinham vazios e nada os tirava da lista de buracos. A conta de
      // "quantos faltam" tem de DIMINUIR a cada volta; se não diminuir, o
      // marcador não está pegando e insistir é martelar a Zig à toa.
      if (r.faltavam >= faltavamAntes) {
        console.log(
          `  parei: busquei ${r.buscados} dia(s) e a conta de faltantes não caiu ` +
            `(${r.faltavam}). Alguma coisa não está anotando os dias buscados.`,
        );
        break;
      }
      faltavamAntes = r.faltavam;

      if (pausa > 0) await new Promise((ok) => setTimeout(ok, pausa));
    }
    console.log(`${casa.name}: histórico completo.`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
