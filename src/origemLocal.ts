import type { IncomingMessage } from "node:http";

/**
 * A CHAMADA VEIO DESTA MÁQUINA?
 *
 * Duas rotas do WhatsApp (estado/QR e desconectar) falam direto com o
 * conector que mora neste processo, sem conferir de que casa ele é — o que
 * só é seguro para quem está sentado na própria máquina. O servidor, porém,
 * escuta em 0.0.0.0 por padrão (é o que deixa abrir o painel pelo celular na
 * rede do bar), e aí qualquer login válido de QUALQUER organização que
 * alcançasse a porta via o QR do número de outra casa, ou o derrubava.
 *
 * A resposta vem do SOCKET, nunca do x-forwarded-for: o cabeçalho é texto
 * que o próprio chamador escreve. Ele entra só no sentido contrário — se
 * existe, a chamada passou por um proxy (Caddy/nginx na mesma máquina, onde
 * todo mundo chega como 127.0.0.1) e portanto NÃO é local. Forjar o
 * cabeçalho só tira o atalho de quem forjou.
 */
export function enderecoDeLoopback(endereco: string | null | undefined): boolean {
  if (!endereco) return false;
  // IPv4 embrulhado em IPv6 ("::ffff:127.0.0.1") é como o Node entrega quando
  // escuta nas duas pilhas.
  const limpo = endereco.toLowerCase().replace(/^::ffff:/, "");
  return limpo === "::1" || /^127(?:\.\d{1,3}){3}$/.test(limpo);
}

const CABECALHOS_DE_PROXY = ["x-forwarded-for", "forwarded", "x-real-ip", "x-forwarded-host"] as const;

export function chamadaLocal(req: Pick<IncomingMessage, "headers"> & { socket?: { remoteAddress?: string } | null }): boolean {
  if (!enderecoDeLoopback(req.socket?.remoteAddress)) return false;
  return !CABECALHOS_DE_PROXY.some((nome) => req.headers[nome] !== undefined);
}
