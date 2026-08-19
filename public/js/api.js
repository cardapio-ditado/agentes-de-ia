/**
 * Cliente da API.
 *
 * A chave fica no localStorage e nunca sai daqui num corpo de requisição —
 * vai sempre no cabeçalho Authorization.
 */

const GUARDA = "agentes.chave";
const GUARDA_REFRESH = "brasa.refresh";

/**
 * Onde a sessão fica: no aparelho ou só nesta janela.
 *
 * O mesmo painel é usado no celular da pessoa e no computador do estoque, e
 * os dois pedem coisas opostas. No celular, exigir senha a cada turno produz
 * senha fraca colada em algum lugar. No computador compartilhado, manter a
 * sessão faz o próximo que sentar lançar recebimento no nome do anterior —
 * e aí o histórico de quem conferiu o quê deixa de valer.
 *
 * `sessionStorage` morre quando a janela fecha; `localStorage` sobrevive. A
 * pessoa escolhe no login, e o padrão é lembrar — porque o caso comum é o
 * celular próprio.
 */
function guarda() {
  // A de sessão vem primeiro: se existe token aqui, este aparelho foi
  // marcado como compartilhado, e o do localStorage seria sobra de antes.
  return sessionStorage.getItem(GUARDA) ? sessionStorage : localStorage;
}

export function chaveSalva() {
  return sessionStorage.getItem(GUARDA) ?? localStorage.getItem(GUARDA);
}

export function salvarChave(chave, { lembrar = true } = {}) {
  (lembrar ? localStorage : sessionStorage).setItem(GUARDA, chave);
}

/**
 * Apaga dos DOIS lugares.
 *
 * Limpar só um deixaria a sessão antiga ressuscitar no próximo carregamento
 * — o pior tipo de "saí do sistema": a pessoa vê a tela de login, acredita
 * que saiu, e o aparelho continua com a conta dela dentro.
 */
export function esquecerChave() {
  for (const onde of [localStorage, sessionStorage]) {
    onde.removeItem(GUARDA);
    onde.removeItem(GUARDA_REFRESH);
  }
}

/**
 * Guarda o par de tokens do login por e-mail e senha.
 *
 * O de acesso vive no mesmo lugar da chave `sk_...` de propósito: para o
 * resto do painel, "o que vai no Authorization" continua sendo uma coisa só.
 * Quem sabe a diferença é o servidor, que decide pelo prefixo.
 */
export function salvarSessao({ access_token, refresh_token }, { lembrar = true } = {}) {
  // Trocar de modo não pode deixar rastro no outro lugar: sem a limpeza,
  // entrar como "compartilhado" num aparelho que já teve login lembrado
  // manteria o token antigo vivo no localStorage.
  esquecerChave();
  const onde = lembrar ? localStorage : sessionStorage;
  onde.setItem(GUARDA, access_token);
  if (refresh_token) onde.setItem(GUARDA_REFRESH, refresh_token);
}

export function entrouComSenha() {
  return Boolean(sessionStorage.getItem(GUARDA_REFRESH) ?? localStorage.getItem(GUARDA_REFRESH));
}

/**
 * Troca o token de renovação por um par novo.
 *
 * O token de acesso do Supabase dura cerca de uma hora. Sem isto, quem deixa
 * o painel aberto durante o serviço seria expulso no meio do movimento.
 */
let renovacaoEmCurso = null;

async function renovarSessao() {
  const refresh = sessionStorage.getItem(GUARDA_REFRESH) ?? localStorage.getItem(GUARDA_REFRESH);
  if (!refresh) return false;

  // Várias telas podem levar 401 ao mesmo tempo; uma renovação só atende
  // todas, senão o primeiro sucesso invalida o refresh dos outros.
  if (!renovacaoEmCurso) {
    renovacaoEmCurso = (async () => {
      try {
        const resposta = await fetch("/v1/auth/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        const corpo = await resposta.json();
        if (!resposta.ok || corpo?.success === false) return false;
        // O token novo vai para o MESMO lugar de onde veio o antigo. Sem
        // isto, a primeira renovação promoveria a sessão do computador
        // compartilhado para permanente — a escolha da pessoa no login
        // duraria uma hora e ninguém saberia que ela expirou.
        salvarSessao(corpo.data, { lembrar: guarda() === localStorage });
        return true;
      } catch {
        return false;
      } finally {
        renovacaoEmCurso = null;
      }
    })();
  }
  return renovacaoEmCurso;
}

/** Erro com o código da API preservado, para a tela decidir o que dizer. */
export class ErroApi extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ErroApi";
    this.status = status;
    this.code = code;
  }
}

export async function api(caminho, opcoes = {}, jaRenovou = false) {
  const chave = chaveSalva();
  // Corpo texto (JSON.stringify) leva content-type json; corpo binário
  // (File/Blob) deixa o navegador decidir — forçar json quebraria o upload.
  const corpoJson = typeof opcoes.body === "string";
  const resposta = await fetch(caminho, {
    ...opcoes,
    headers: {
      ...(corpoJson ? { "content-type": "application/json" } : {}),
      ...(chave ? { authorization: `Bearer ${chave}` } : {}),
      ...opcoes.headers,
    },
  });

  // Token vencido: renova uma vez e repete. `jaRenovou` impede laço infinito
  // quando o refresh também não vale mais.
  if (resposta.status === 401 && !jaRenovou && (await renovarSessao())) {
    return api(caminho, opcoes, true);
  }

  let corpo = null;
  try {
    corpo = await resposta.json();
  } catch {
    throw new ErroApi(resposta.status, "resposta_invalida", "A API respondeu algo que não é JSON.");
  }

  if (!resposta.ok || corpo?.success === false) {
    const e = corpo?.error ?? {};
    throw new ErroApi(resposta.status, e.code ?? "erro", e.message ?? "Falha na requisição.");
  }
  return corpo.data;
}

export const get = (caminho) => api(caminho);
export const post = (caminho, corpo) =>
  api(caminho, { method: "POST", body: JSON.stringify(corpo ?? {}) });
export const put = (caminho, corpo) =>
  api(caminho, { method: "PUT", body: JSON.stringify(corpo) });
export const patch = (caminho, corpo) =>
  api(caminho, { method: "PATCH", body: JSON.stringify(corpo ?? {}) });
export const del = (caminho) => api(caminho, { method: "DELETE" });

/**
 * Envia um arquivo cru no corpo da requisição — sem base64, sem JSON.
 *
 * Um PDF em base64 fica ~33% maior; embrulhado num JSON, mais um pouco.
 * Mandar o `File` direto como corpo do fetch evita as duas coisas — o
 * navegador já faz streaming dele sozinho.
 */
export const postArquivo = (caminho, arquivo) =>
  api(caminho, { method: "POST", body: arquivo });

/**
 * Executa o agente com streaming.
 *
 * EventSource não serve: ele só faz GET e não manda cabeçalho. Por isso o SSE
 * é lido na mão, a partir do corpo do fetch.
 */
export async function executarComStream(corpo, aoEvento) {
  const resposta = await fetch("/v1/runs?stream=true", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${chaveSalva()}`,
    },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    let msg = "Falha ao executar o agente.";
    try {
      const j = await resposta.json();
      msg = j?.error?.message ?? msg;
    } catch {
      /* corpo não-JSON: fica a mensagem padrão */
    }
    throw new ErroApi(resposta.status, "run_falhou", msg);
  }

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += decodificador.decode(value, { stream: true });

    // Um evento SSE termina em linha em branco; o resto fica para a próxima volta.
    const partes = buffer.split("\n\n");
    buffer = partes.pop() ?? "";

    for (const bloco of partes) {
      for (const linha of bloco.split("\n")) {
        if (!linha.startsWith("data:")) continue;
        try {
          aoEvento(JSON.parse(linha.slice(5).trim()));
        } catch {
          /* fragmento inválido: ignorar em vez de derrubar o stream */
        }
      }
    }
  }
}
