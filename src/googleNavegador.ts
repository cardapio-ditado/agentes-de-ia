import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * O navegador da conta gerente.
 *
 * Sessão em disco, num diretório persistente — e não cookies exportados de
 * outra máquina. Uma sessão do Google carrega mais do que cookies: local
 * storage, IndexedDB e o identificador do dispositivo. Copiar só os cookies
 * faz o Google ver um aparelho novo com sessão antiga, que é exatamente o
 * padrão de uma sessão roubada — e ele pede verificação, ou derruba tudo.
 *
 * Por isso o login é feito UMA VEZ na própria máquina que vai rodar o
 * conector, e o diretório fica lá.
 */

/** Onde a sessão vive. Fora do repositório, como a do WhatsApp. */
export const DIRETORIO_SESSAO = resolve(process.env.GOOGLE_SESSAO_DIR ?? ".google");

/**
 * Ritmo humano entre ações.
 *
 * Não é superstição: uma sequência de cliques em intervalos idênticos de
 * milissegundos é o sinal mais fácil de automação que existe. O custo de
 * esperar é irrelevante — são dezenas de avaliações por dia, não milhares.
 */
export async function pausaHumana(min = 900, max = 2600): Promise<void> {
  const ms = min + Math.random() * (max - min);
  await new Promise((r) => setTimeout(r, ms));
}

export class NavegadorIndisponivelError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "NavegadorIndisponivelError";
  }
}

/**
 * Carrega o Playwright sob demanda.
 *
 * Importação dinâmica de propósito: o Playwright e o Chromium pesam centenas
 * de megabytes, e a maioria das instalações do Brasa Food só roda o conector
 * do WhatsApp. Exigir os dois em toda máquina, para um módulo que talvez nem
 * seja contratado, seria cobrar de todo mundo o custo de um.
 */
async function carregarPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new NavegadorIndisponivelError(
      "O Playwright não está instalado nesta máquina. Instale com:\n" +
        "  npm install playwright && npx playwright install --with-deps chromium",
    );
  }
}

export interface SessaoNavegador {
  contexto: import("playwright").BrowserContext;
  fechar(): Promise<void>;
}

/**
 * Abre o navegador com a sessão da conta gerente.
 *
 * `headless: false` quando `visivel` — é o modo do login inicial, que precisa
 * de gente digitando senha e resolvendo a verificação em duas etapas.
 */
export async function abrirNavegador(
  opcoes: { visivel?: boolean } = {},
): Promise<SessaoNavegador> {
  const { chromium } = await carregarPlaywright();
  await mkdir(DIRETORIO_SESSAO, { recursive: true });

  const contexto = await chromium.launchPersistentContext(DIRETORIO_SESSAO, {
    headless: !opcoes.visivel,
    locale: "pt-BR",
    timezoneId: process.env.TZ ?? "America/Cuiaba",
    viewport: { width: 1366, height: 900 },
    args: [
      // Sem isto o Chromium anuncia navigator.webdriver = true, que é a
      // primeira coisa que qualquer detecção de automação verifica.
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
  });

  return {
    contexto,
    async fechar() {
      await contexto.close().catch(() => undefined);
    },
  };
}

/**
 * A sessão ainda vale?
 *
 * Pergunta feita abrindo uma página conhecida e vendo se ela redireciona para
 * a tela de login. É grosseiro e é o que funciona: qualquer teste mais fino
 * depende do desenho da página, que muda sem aviso.
 */
export async function sessaoValida(sessao: SessaoNavegador): Promise<boolean> {
  const pagina = await sessao.contexto.newPage();
  try {
    await pagina.goto("https://business.google.com/", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await pausaHumana();
    return !/accounts\.google\.com/.test(pagina.url());
  } catch {
    return false;
  } finally {
    await pagina.close().catch(() => undefined);
  }
}
