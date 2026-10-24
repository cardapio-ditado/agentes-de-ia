import { db } from "./supabase.js";

/**
 * Os vídeos da ajuda do mentor, um por tela do painel.
 *
 * A explicação escrita de cada tela mora no próprio painel (ela muda junto
 * com a tela); aqui fica só o link do vídeo, que a equipe Brasa Food grava
 * e troca sem precisar de deploy.
 */

const cliente = () => db() as any;

/** Id de tela do painel: letras, números, hífen e "pagina:aba". */
const PAGINA = /^[a-z0-9-]{2,40}(:[a-z0-9-]{2,40})?$/;

export function urlDeVideoValida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function videosDaAjuda(): Promise<Record<string, string>> {
  const { data, error } = await cliente().from("ajuda_videos").select("pagina, url");
  // Tabela que ainda não existe (migração por rodar): ajuda sem vídeo.
  if (error) return {};
  return Object.fromEntries(((data ?? []) as Array<{ pagina: string; url: string }>).map((v) => [v.pagina, v.url]));
}

/** Grava o link da tela; link vazio apaga. */
export async function salvarVideoDaAjuda(params: { pagina: string; url: string; por: string | null }): Promise<void> {
  if (!PAGINA.test(params.pagina)) throw new Error("Tela desconhecida.");
  const url = params.url.trim();
  if (!url) {
    const { error } = await cliente().from("ajuda_videos").delete().eq("pagina", params.pagina);
    if (error) throw new Error(`Falha ao apagar o vídeo: ${error.message}`);
    return;
  }
  if (!urlDeVideoValida(url)) throw new Error("Cole um link que comece com https:// (YouTube, Drive, Loom…).");
  const { error } = await cliente()
    .from("ajuda_videos")
    .upsert({ pagina: params.pagina, url, atualizado_em: new Date().toISOString(), atualizado_por: params.por });
  if (error) throw new Error(`Falha ao gravar o vídeo: ${error.message}`);
}
