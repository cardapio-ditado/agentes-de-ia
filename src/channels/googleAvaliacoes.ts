import type { Page } from "playwright";
import {
  lerConfiguracao,
  marcarErroDePublicacao,
  marcarPublicada,
  prepararResposta,
  prontasParaPublicar,
  registrarAvaliacoes,
  type AvaliacaoRecebida,
  type GooglePerfil,
} from "../avaliacoes.js";
import {
  abrirNavegador,
  NavegadorIndisponivelError,
  pausaHumana,
  sessaoValida,
} from "../googleNavegador.js";
import { db } from "../supabase.js";
import { getVenue } from "../venues.js";

/**
 * Conector provisório das avaliações do Google, por navegação na interface.
 *
 * É a ponte até o acesso à API oficial sair. Duas consequências que valem
 * estar escritas aqui, e não só na conversa:
 *
 * 1. Automatizar a interface está fora dos termos do Google. A punição
 *    possível cai na conta gerente e no acesso dela ao perfil — por isso a
 *    conta é descartável e nunca é a do dono do restaurante.
 * 2. A interface muda sem aviso, e não existe contrato público. Quando este
 *    arquivo quebrar, é assim que ele vai quebrar: seletor que não encontra
 *    nada. O erro diz isso em vez de fingir que a casa não tem avaliação.
 */

/** Teto por execução. Uma rajada de respostas é o que mais parece robô. */
const MAXIMO_PUBLICACOES_POR_VEZ = 5;

/**
 * Seletores da interface do Google.
 *
 * Isolados num lugar só porque são a parte que apodrece. Confira contra a
 * página de verdade antes de confiar:
 *
 *   npx tsx scripts/google-sessao.ts diagnostico --url "<url das avaliações>"
 *
 * O comando salva uma foto e o HTML da página, e é a partir deles que estes
 * valores devem ser corrigidos — não de memória.
 */
export const SELETORES = {
  /** Cada bloco de avaliação na lista. */
  cartao: '[data-review-id], div[jsname][data-review-id]',
  /** Nome de quem avaliou, dentro do cartão. */
  autor: '[class*="reviewer"], [data-reviewer-name]',
  /** Elemento cujo aria-label carrega a nota ("Classificado como 4 de 5"). */
  nota: '[aria-label*="strela"], [aria-label*="star"], [role="img"][aria-label]',
  /** Texto escrito pelo cliente. */
  comentario: '[data-review-text], [class*="review-text"]',
  /** Abre a caixa de resposta. */
  botaoResponder: 'button:has-text("Responder"), button:has-text("Reply")',
  /** Onde a resposta é digitada. */
  campoResposta: 'textarea',
  /** Confirma o envio. */
  botaoEnviar: 'button:has-text("Enviar"), button:has-text("Publicar"), button:has-text("Post")',
};

export class InterfaceMudouError extends Error {
  constructor(oQue: string) {
    super(
      `A interface do Google mudou: não encontrei ${oQue}. ` +
        `Rode "npx tsx scripts/google-sessao.ts diagnostico" e ajuste SELETORES ` +
        `em src/channels/googleAvaliacoes.ts a partir do HTML salvo.`,
    );
    this.name = "InterfaceMudouError";
  }
}

/** Extrai a nota de um aria-label como "Classificado como 4 de 5". */
export function notaDoRotulo(rotulo: string | null): number | null {
  if (!rotulo) return null;
  const m = rotulo.match(/(\d)([.,]\d)?\s*(de|out of|\/)\s*5/i) ?? rotulo.match(/^\s*(\d)\s/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

async function lerAvaliacoesDaPagina(pagina: Page): Promise<AvaliacaoRecebida[]> {
  const cartoes = pagina.locator(SELETORES.cartao);
  const total = await cartoes.count();
  if (total === 0) throw new InterfaceMudouError("nenhum cartão de avaliação");

  const lidas: AvaliacaoRecebida[] = [];
  for (let i = 0; i < total; i += 1) {
    const cartao = cartoes.nth(i);
    const id = await cartao.getAttribute("data-review-id");
    // Sem id não dá para garantir idempotência, e responder duas vezes a mesma
    // avaliação é pior que não responder. Pula.
    if (!id) continue;

    const nota = notaDoRotulo(
      await cartao.locator(SELETORES.nota).first().getAttribute("aria-label").catch(() => null),
    );
    if (nota === null) continue;

    lidas.push({
      avaliacao_id: id,
      autor: (await textoDe(cartao.locator(SELETORES.autor).first())) || null,
      nota,
      comentario: (await textoDe(cartao.locator(SELETORES.comentario).first())) || null,
      avaliada_em: null,
    });
  }
  return lidas;
}

async function textoDe(loc: ReturnType<Page["locator"]>): Promise<string> {
  return (await loc.textContent({ timeout: 3000 }).catch(() => null))?.trim() ?? "";
}

export interface ResultadoSincronizacao {
  lidas: number;
  novas: number;
  publicadas: number;
  falhas: number;
}

/**
 * Um ciclo completo: lê o que há de novo, redige e publica o que está liberado.
 */
export async function sincronizar(perfil: GooglePerfil): Promise<ResultadoSincronizacao> {
  const resultado: ResultadoSincronizacao = { lidas: 0, novas: 0, publicadas: 0, falhas: 0 };
  if (!perfil.local_id) {
    await marcarPerfil(perfil.id, "erro", "Falta o endereço do perfil no Google (local_id).");
    return resultado;
  }

  let sessao;
  try {
    sessao = await abrirNavegador();
  } catch (e) {
    if (e instanceof NavegadorIndisponivelError) {
      await marcarPerfil(perfil.id, "erro", e.message);
      return resultado;
    }
    throw e;
  }

  try {
    if (!(await sessaoValida(sessao))) {
      // Estado próprio, e não "erro": sessão caída é rotina nesse modelo e
      // tem conserto conhecido — rodar o login de novo. Misturar com falha
      // de verdade faria o painel gritar igual para as duas.
      await marcarPerfil(
        perfil.id,
        "sessao_expirada",
        "O Google pediu login. Rode: npx tsx scripts/google-sessao.ts login",
      );
      return resultado;
    }

    const venue = await getVenue(perfil.venue_id);
    const config = lerConfiguracao(perfil);
    const pagina = await sessao.contexto.newPage();

    try {
      await pagina.goto(perfil.local_id, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await pausaHumana(2500, 4500);

      const lidas = await lerAvaliacoesDaPagina(pagina);
      resultado.lidas = lidas.length;

      const novas = await registrarAvaliacoes(venue.id, lidas);
      resultado.novas = novas.length;
      for (const avaliacao of novas) {
        await prepararResposta({ avaliacao, venue, config });
      }

      // Publica só o que já está liberado — o que veio da política automática
      // e o que uma pessoa aprovou na fila.
      const aprovadas = (await prontasParaPublicar(venue.id)).slice(0, MAXIMO_PUBLICACOES_POR_VEZ);
      for (const avaliacao of aprovadas) {
        try {
          await publicarUma(pagina, avaliacao.avaliacao_id, avaliacao.resposta!);
          await marcarPublicada(avaliacao.id);
          resultado.publicadas += 1;
        } catch (e) {
          await marcarErroDePublicacao(
            avaliacao.id,
            e instanceof Error ? e.message : String(e),
          );
          resultado.falhas += 1;
        }
        await pausaHumana(4000, 9000);
      }

      await marcarPerfil(perfil.id, "conectado", null);
    } finally {
      await pagina.close().catch(() => undefined);
    }
  } finally {
    await sessao.fechar();
  }

  return resultado;
}

async function publicarUma(pagina: Page, avaliacaoId: string, texto: string): Promise<void> {
  const cartao = pagina.locator(`[data-review-id="${avaliacaoId}"]`).first();
  if ((await cartao.count()) === 0) {
    throw new Error("A avaliação não está mais nesta página.");
  }

  await cartao.locator(SELETORES.botaoResponder).first().click({ timeout: 10_000 });
  await pausaHumana();

  const campo = cartao.locator(SELETORES.campoResposta).first();
  // Digitação com atraso por caractere: colar um texto inteiro de uma vez não
  // acontece quando é gente escrevendo.
  await campo.fill("");
  await campo.type(texto, { delay: 25 + Math.random() * 35 });
  await pausaHumana();

  await cartao.locator(SELETORES.botaoEnviar).first().click({ timeout: 10_000 });
  await pausaHumana(2000, 4000);
}

async function marcarPerfil(
  id: string,
  status: string,
  erro: string | null,
): Promise<void> {
  await db()
    .from("google_perfis")
    .update({
      status,
      ultimo_erro: erro,
      ultima_sincronizacao: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}
