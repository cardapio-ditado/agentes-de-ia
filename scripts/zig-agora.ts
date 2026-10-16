import { parseArgs } from "node:util";
import { casasComZig } from "../src/historicoZig.js";
import { configZig } from "../src/pesquisaZig.js";
import { hojeNaCasa } from "../src/fuso.js";

/**
 * Sondagem: a Zig entrega o movimento de HOJE em tempo real?
 *
 *   npm run zig:agora
 *   npm run zig:agora -- --casa ditado-popular
 *
 * RODE NO SERVIDOR, com a casa aberta e gente consumindo. A Zig não tem
 * documentação pública, então a única forma de saber se os dados de hoje
 * aparecem antes de o evento fechar — e se vêm com horário — é perguntar.
 *
 * Mostra, por endpoint: quantos registros de hoje, soma gasta, e os NOMES
 * dos campos do primeiro registro (para descobrirmos se há hora de check-in,
 * hora da compra, id do evento). Nunca imprime telefone nem nome de cliente.
 */
const BASE_ZIG = process.env.ZIG_API_URL ?? "https://api.zigcore.com.br/integration";

async function chamar(caminho: string, token: string): Promise<{ status: number; corpo: unknown; ms: number }> {
  const inicio = Date.now();
  const r = await fetch(`${BASE_ZIG}${caminho}`, { headers: { authorization: token }, signal: AbortSignal.timeout(30_000) });
  const texto = await r.text();
  let corpo: unknown = texto;
  try {
    corpo = JSON.parse(texto);
  } catch {
    // fica como texto
  }
  return { status: r.status, corpo, ms: Date.now() - inicio };
}

const SENSIVEIS = /phone|name|email|document|cpf|birth/i;

function campos(registro: unknown): string {
  if (!registro || typeof registro !== "object") return typeof registro;
  return Object.entries(registro as Record<string, unknown>)
    .map(([k, v]) => {
      if (SENSIVEIS.test(k)) return `${k}: <oculto>`;
      const valor = v && typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v);
      return `${k}: ${valor}`;
    })
    .join("\n      ");
}

function somaCentavos(lista: unknown[], chave: string): number {
  return lista.reduce<number>((s, r) => s + (Number((r as Record<string, unknown>)?.[chave]) || 0), 0);
}

/** O quão fresco é o registro mais novo: minutos entre a hora dele e agora. */
function frescor(lista: unknown[], chave: string): string {
  const horas = lista
    .map((r) => new Date(String((r as Record<string, unknown>)?.[chave] ?? "")).getTime())
    .filter((t) => !Number.isNaN(t));
  if (horas.length === 0) return `sem ${chave} legível`;
  const maisNovo = Math.max(...horas);
  const minutos = Math.round((Date.now() - maisNovo) / 60_000);
  return `o mais novo tem ${chave} de ${minutos} min atrás (${new Date(maisNovo).toISOString()})`;
}

async function sondar(
  nome: string,
  caminho: string,
  token: string,
  chaveDeValor?: string,
  tempo?: { hora: string; saida?: string },
): Promise<void> {
  console.log(`\n== ${nome}`);
  console.log(`   GET ${caminho}`);
  try {
    const { status, corpo, ms } = await chamar(caminho, token);
    console.log(`   HTTP ${status} em ${ms} ms`);
    if (Array.isArray(corpo)) {
      console.log(`   registros: ${corpo.length}`);
      if (chaveDeValor) console.log(`   soma de ${chaveDeValor}: R$ ${(somaCentavos(corpo, chaveDeValor) / 100).toFixed(2)}`);
      if (tempo && corpo.length > 0) {
        console.log(`   frescor: ${frescor(corpo, tempo.hora)}`);
        if (tempo.saida) {
          const semSaida = corpo.filter((r) => !(r as Record<string, unknown>)?.[tempo.saida!]).length;
          console.log(`   sem ${tempo.saida} (ainda na casa, se a porta registra saída): ${semSaida} de ${corpo.length}`);
        }
      }
      if (corpo.length > 0) console.log(`   campos do 1º registro:\n      ${campos(corpo[0])}`);
      if (corpo.length > 1) console.log(`   campos do último registro:\n      ${campos(corpo[corpo.length - 1])}`);
    } else {
      console.log(`   resposta: ${typeof corpo === "string" ? corpo.slice(0, 300) : JSON.stringify(corpo).slice(0, 300)}`);
    }
  } catch (e) {
    console.log(`   falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { casa: { type: "string" } } });
  const casas = await casasComZig();
  const alvo = values.casa
    ? casas.filter((c) => c.name.toLowerCase().includes(values.casa!.toLowerCase()))
    : casas;
  if (alvo.length === 0) {
    console.error("Nenhuma casa com token e loja da Zig preenchidos.");
    process.exit(1);
  }

  for (const casa of alvo) {
    const config = await configZig(casa.id);
    if (!config.token || !config.loja) continue;
    const hoje = hojeNaCasa(casa.timezone);
    const amanha = new Date(`${hoje}T12:00:00Z`);
    amanha.setUTCDate(amanha.getUTCDate() + 1);
    const amanhaISO = amanha.toISOString().slice(0, 10);
    const loja = encodeURIComponent(config.loja);

    console.log(`\n######## ${casa.name} — ${new Date().toLocaleString("pt-BR", { timeZone: casa.timezone })} (hoje = ${hoje})`);
    await sondar("Eventos (hoje)", `/erp/events?loja=${loja}&dtinicio=${hoje}&dtfim=${hoje}`, config.token);
    await sondar("Compradores (hoje)", `/erp/compradores?dtinicio=${hoje}&dtfim=${hoje}&loja=${loja}`, config.token, "productsValue");
    await sondar("Check-ins (hoje)", `/erp/checkins?desde=${hoje}&dtfim=${amanhaISO}&loja=${loja}&page=1`, config.token, undefined, {
      hora: "checkinTime",
      saida: "checkoutTime",
    });
    await sondar("Saída de produtos (hoje)", `/erp/saida-produtos?dtinicio=${hoje}&dtfim=${hoje}&loja=${loja}`, config.token, "unitValue", {
      hora: "transactionDate",
    });
  }

  console.log(
    "\nComo ler: 'Saída de produtos (hoje)' com registros e frescor de poucos minutos = a Zig entrega\n" +
      "ao vivo, e dá para mostrar consumo e gente ativa na maquete. 'Check-ins' com checkinTime e\n" +
      "checkoutTime = dá para contar quem AINDA está na casa. Zero registros com a casa cheia = só\n" +
      "depois do evento fechar.",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
