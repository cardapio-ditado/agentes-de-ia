import { db } from "./supabase.js";
import { lerNascimento } from "./clientes.js";
import type { Json } from "./database.types.js";

/**
 * O FIM DA PESQUISA — o que a casa ganha além da nota.
 *
 * Quem acabou de dar 9 ou 10 está no melhor momento para dizer isso em
 * público, e quem deixou o WhatsApp pode deixar também o dia do aniversário.
 * As duas coisas são acessórias: nenhuma delas pode atrapalhar a resposta,
 * que é o que a pesquisa existe para colher.
 *
 * Aqui ficam só as regras (puras, com teste) e a gravação do link.
 */

/** A partir desta nota a pessoa é promotora — a régua do NPS, de 0 a 10. */
export const NOTA_DE_PROMOTOR = 9;

/** A chave em `venues.settings`. Vizinha do `maps_url`, e pela mesma razão: é dado da casa, sem migração. */
const CHAVE = "google_avaliacao_url";

/** Onde um link de avaliação do Google pode morar. Subdomínio vale (search.google.com). */
const DOMINIOS_DO_GOOGLE = ["google.com", "g.page", "maps.app.goo.gl"];

export class LinkDeAvaliacaoInvalido extends Error {}

/**
 * O link como a casa colou, conferido — ou null, quando veio em branco.
 *
 * A conferência é pelo ENDEREÇO DE VERDADE (o host que o navegador abriria),
 * e não por "contém google.com": este link vira um botão na tela do cliente
 * da casa, e "https://google.com.golpe.net" ou "https://golpe.net/?google.com"
 * passariam por qualquer teste de texto.
 */
export function linkDeAvaliacaoValido(bruto: unknown): string | null {
  const texto = String(bruto ?? "").trim();
  if (!texto) return null;

  const recusa = new LinkDeAvaliacaoInvalido(
    "O link de avaliação precisa ser do Google e começar com https:// (google.com, g.page ou maps.app.goo.gl). " +
      'No Perfil da Empresa, use "Pedir avaliações" e cole o link aqui.',
  );
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw recusa;
  }
  const host = url.hostname.toLowerCase();
  const doGoogle = DOMINIOS_DO_GOOGLE.some((d) => host === d || host.endsWith(`.${d}`));
  // Usuário no endereço ("https://google.com@outro.site") não tem uso
  // legítimo aqui e só serve para enganar quem lê.
  if (url.protocol !== "https:" || !doGoogle || url.username || url.password || texto.length > 500) throw recusa;
  return url.toString();
}

/** O link gravado na casa, se houver um e ele ainda passar na conferência. */
export function linkDeAvaliacaoDaCasa(settings: Json | null | undefined): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  try {
    return linkDeAvaliacaoValido((settings as Record<string, unknown>)[CHAVE]);
  } catch {
    // Gravado à mão no banco, ou por uma regra antiga: não vira botão.
    return null;
  }
}

/**
 * O link que ESTA resposta recebe: só promotor, e só se a casa configurou.
 *
 * Decidido no servidor, com a nota que foi gravada — a tela pode estar com
 * a conta velha em cache, e convidar um cliente insatisfeito para avaliar em
 * público é o erro que este botão não pode cometer. Quem deu até 8 não
 * recebe o link nem escondido.
 */
export function linkParaQuemRespondeu(nota: number | null | undefined, settings: Json | null | undefined): string | null {
  if (typeof nota !== "number" || !Number.isFinite(nota) || nota < NOTA_DE_PROMOTOR) return null;
  return linkDeAvaliacaoDaCasa(settings);
}

/**
 * O aniversário que a pesquisa pergunta: dia e mês, nunca o ano.
 *
 * Devolve "DD/MM" (o que `registrarCliente` já sabe ler) ou null. O ano é
 * jogado fora mesmo que alguém mande: a tela promete que só pede dia e mês,
 * e a idade do cliente não é da conta do parabéns. Dia que o mês não tem
 * (31/04, 30/02) também não entra — um aniversário impossível nunca chega.
 */
export function aniversarioInformado(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const { dia, mes } = lerNascimento(bruto);
  if (!dia || !mes) return null;
  // 29/02 existe; por isso a conta é num ano bissexto.
  const diasDoMes = new Date(Date.UTC(2024, mes, 0)).getUTCDate();
  if (dia > diasDoMes) return null;
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}

/**
 * Grava (ou apaga, com null) o link de avaliação da casa.
 *
 * `settings` guarda outras chaves — o link do Maps, o estado do conector do
 * WhatsApp —, então lê de novo e mescla: gravar por cima do que estava na
 * memória apagaria o que entrou no meio.
 */
export async function salvarLinkDeAvaliacao(venueId: string, url: string | null): Promise<void> {
  const { data, error } = await db().from("venues").select("settings").eq("id", venueId).single();
  if (error) throw new Error(`Falha ao ler os ajustes da casa: ${error.message}`);
  const atual = data.settings && typeof data.settings === "object" && !Array.isArray(data.settings) ? data.settings : {};
  const settings = { ...atual, [CHAVE]: url } as Json;
  const { error: erroAoGravar } = await db().from("venues").update({ settings }).eq("id", venueId);
  if (erroAoGravar) throw new Error(`Falha ao salvar o link de avaliação: ${erroAoGravar.message}`);
}
