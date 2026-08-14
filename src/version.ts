import { execSync } from "node:child_process";

let cached: string | null | undefined;

/**
 * Commit curto do código em execução.
 *
 * Existe para responder "que versão está rodando AQUI?" — a pergunta certa
 * quando o site (Vercel) e o PC do bar se comportam diferente: mesmo banco,
 * mesmo agente, só o código pode divergir.
 *
 * Na Vercel vem do ambiente; num clone, do próprio git; num tarball sem
 * git, fica nulo e a tela mostra "desconhecida".
 */
export function versaoDoCodigo(): string | null {
  if (cached !== undefined) return cached;

  const daVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (daVercel) {
    cached = daVercel.slice(0, 7);
    return cached;
  }

  try {
    cached = execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    cached = null;
  }
  return cached;
}
