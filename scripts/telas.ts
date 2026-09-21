import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Abrir uma tela do painel sem banco, sem login e sem deploy.
 *
 * O problema que isto resolve: conferir uma mudança de tela custava subir
 * para a Vercel, entrar no painel, achar a casa certa e torcer para os dados
 * da produção estarem no estado que interessa. Para ver como a tela fica
 * quando alguém tem férias vencidas, alguém precisava ter férias vencidas de
 * verdade.
 *
 * Aqui a tela roda com DADOS DE MENTIRA, escritos à mão num arquivo JSON, e
 * o servidor de araque responde o que ela pedir. Dá para forçar qualquer
 * situação — a semana sem venda nenhuma, a pessoa sem admissão, o período
 * que venceu ontem — em dois segundos.
 *
 *   npm run telas                    lista as telas que têm dados de mentira
 *   npm run telas -- rh              abre no navegador de teste e tira foto
 *   npm run telas -- rh --servir     sobe em localhost e você abre no SEU navegador
 *   npm run telas -- rh --largura 900
 *   npm run telas -- --todas         passa por todas as telas de uma vez
 *
 * As fotos caem em `.telas/`, que não vai para o Git.
 *
 * Quando a tela pede uma rota que o arquivo de dados não tem, ela recebe uma
 * resposta vazia e o comando imprime, no fim, o esqueleto pronto para colar
 * no JSON. Ninguém precisa adivinhar o que falta.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const PUBLICO = join(AQUI, "..", "public");
const DADOS = join(AQUI, "telas");
const FOTOS = join(AQUI, "..", ".telas");

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

interface Tela {
  /** Uma frase dizendo o que esta tela mostra. */
  rotulo: string;
  /** Caminho do módulo dentro de public/, como o navegador vê. */
  modulo?: string;
  /** O nome da função que desenha a tela. */
  funcao?: string;
  /**
   * Uma PÁGINA PÚBLICA em vez de um módulo do painel: "/checklist.html?t=x".
   *
   * O checklist no celular, a pesquisa, o cardápio da mesa — não montam no
   * painel, são páginas inteiras servidas de public/. Com isto elas ganham
   * as mesmas situações e as mesmas fotos que as telas do painel.
   */
  pagina?: string;
  /** O slug da casa, se a tela usar. */
  venue?: string;
  /** O que semear no sessionStorage antes de desenhar (aba aberta, etc). */
  guarda?: Record<string, string>;
  /** "GET /rh/ferias": a resposta. O prefixo /v1/venues/<casa> é opcional. */
  rotas: Record<string, unknown>;
  /**
   * O que clicar antes de tirar a foto, em seletores de CSS.
   *
   * Tela que só mostra a coisa depois de um clique — uma gaveta, uma aba,
   * um menu — ficava fora do alcance desta ferramenta: a foto pegava sempre
   * o estado fechado. Com isto, a situação "gaveta aberta" é uma linha no
   * arquivo de dados.
   */
  cliques?: string[];
  /**
   * O que digitar antes dos cliques: seletor → texto.
   *
   * Um formulário que exige o nome de quem preenche não se conclui só com
   * clique — e "concluiu o checklist" é a situação que mais vale fotografar.
   */
  digita?: Record<string, string>;
  /**
   * Situações da mesma tela, cada uma com o seu nome.
   *
   * É o que faz esta ferramenta valer a pena: a tela vazia, a casa que ainda
   * não escolheu o método, a semana sem venda nenhuma. O que na produção
   * exige combinar dados reais, aqui é um objeto de cinco linhas.
   */
  variacoes?: Record<string, {
    rotulo?: string;
    guarda?: Record<string, string>;
    rotas?: Record<string, unknown>;
    cliques?: string[];
    digita?: Record<string, string>;
  }>;
}

/** A tela com uma variação aplicada por cima. */
function comVariacao(tela: Tela, nome: string | null): Tela {
  if (!nome) return tela;
  const v = tela.variacoes?.[nome];
  if (!v) {
    const nomes = Object.keys(tela.variacoes ?? {});
    throw new Error(`A tela não tem a situação "${nome}". Tem: ${nomes.join(", ") || "nenhuma"}.`);
  }
  return {
    ...tela,
    rotulo: v.rotulo ? `${tela.rotulo} — ${v.rotulo}` : tela.rotulo,
    guarda: { ...(tela.guarda ?? {}), ...(v.guarda ?? {}) },
    rotas: { ...tela.rotas, ...(v.rotas ?? {}) },
    cliques: v.cliques ?? tela.cliques,
    digita: v.digita ?? tela.digita,
  };
}

// ============================================================
// O servidor de araque
// ============================================================

/** Rotas que a tela pediu e o arquivo de dados não tinha. */
const faltando = new Set<string>();
/** O que a tela mandou gravar, para o comando mostrar no fim. */
const escritas: string[] = [];
/** Arquivos que a tela pediu e não existem em public/. */
const semArquivo = new Set<string>();

/**
 * A chave do JSON casa com o caminho pedido?
 *
 * Segmento que começa com `:` aceita qualquer coisa, e `*` no fim aceita o
 * resto. É o suficiente para `/rh/ferias/:id` e `/rh/documentos/*`.
 */
function combina(chave: string, caminho: string): boolean {
  const esperados = chave.split("/").filter(Boolean);
  const recebidos = caminho.split("/").filter(Boolean);
  for (let i = 0; i < esperados.length; i += 1) {
    const esperado = esperados[i]!;
    if (esperado === "*") return true;
    if (recebidos[i] === undefined) return false;
    if (esperado.startsWith(":")) continue;
    if (esperado !== recebidos[i]) return false;
  }
  return esperados.length === recebidos.length;
}

/** O caminho sem o prefixo da casa, que é sempre igual e só atrapalha. */
function semPrefixo(caminho: string, venue: string): string {
  const prefixo = `/v1/venues/${venue}`;
  return caminho.startsWith(prefixo) ? caminho.slice(prefixo.length) || "/" : caminho;
}

function respostaDaRota(tela: Tela, metodo: string, caminho: string): unknown | undefined {
  const curto = semPrefixo(caminho, tela.venue ?? "casa-de-teste");
  for (const [chave, valor] of Object.entries(tela.rotas)) {
    const [metodoDaChave, ...resto] = chave.split(" ");
    if ((metodoDaChave ?? "").toUpperCase() !== metodo) continue;
    const caminhoDaChave = semPrefixo(resto.join(" "), tela.venue ?? "casa-de-teste");
    if (combina(caminhoDaChave, curto)) return valor;
  }
  return undefined;
}

function servir(tela: Tela, porta: number) {
  const paginaDeTeste = montarHtml(tela);

  const servidor = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const metodo = (req.method ?? "GET").toUpperCase();

    // O navegador pede o ícone sozinho; sem isto ele vira um 404 barulhento
    // que parece defeito da tela.
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }

    if (url.pathname === "/" || url.pathname === "/__tela.html") {
      res.writeHead(200, { "content-type": TIPOS[".html"]! });
      return res.end(paginaDeTeste);
    }

    if (url.pathname.startsWith("/v1/")) {
      const achou = respostaDaRota(tela, metodo, url.pathname);
      if (achou === undefined) {
        faltando.add(`${metodo} ${semPrefixo(url.pathname, tela.venue ?? "casa-de-teste")}`);
      }
      if (metodo !== "GET") {
        escritas.push(`${metodo} ${semPrefixo(url.pathname, tela.venue ?? "casa-de-teste")}`);
      }
      // Resposta vazia em vez de erro: a tela que pede uma rota sem dado
      // continua desenhando o resto, e o comando avisa no fim o que faltou.
      res.writeHead(metodo === "POST" ? 201 : 200, { "content-type": TIPOS[".json"]! });
      return res.end(JSON.stringify({ success: true, data: achou ?? {} }));
    }

    try {
      const arquivo = await readFile(join(PUBLICO, url.pathname));
      res.writeHead(200, { "content-type": TIPOS[extname(url.pathname)] ?? "application/octet-stream" });
      res.end(arquivo);
    } catch {
      semArquivo.add(url.pathname);
      res.writeHead(404).end("não encontrado");
    }
  });

  return new Promise<{ servidor: ReturnType<typeof createServer>; endereco: string }>((pronto) => {
    servidor.listen(porta, () => pronto({ servidor, endereco: `http://localhost:${porta}/` }));
  });
}

/**
 * A casca do painel em volta da tela.
 *
 * Sem `.app`, `.conteudo` e `.pagina` o CSS não se aplica igual ao real e a
 * conferência não vale nada — largura, espaçamento e rolagem mudam todos.
 */
function montarHtml(tela: Tela): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${tela.rotulo}</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div id="app" class="app">
  <aside class="lateral"></aside>
  <div class="conteudo">
    <main id="pagina" class="pagina"></main>
  </div>
</div>
<div id="avisos"></div>
<script>
  for (const [chave, valor] of Object.entries(${JSON.stringify(tela.guarda ?? {})})) {
    sessionStorage.setItem(chave, valor);
  }
</script>
<script type="module">
  const modulo = await import(${JSON.stringify(tela.modulo ?? "")});
  const desenhar = modulo[${JSON.stringify(tela.funcao ?? "default")}] ?? modulo.default;
  if (typeof desenhar !== "function") {
    document.getElementById("pagina").textContent =
      'O módulo não exporta "${tela.funcao ?? "default"}". Confira o campo "funcao" no arquivo de dados.';
  } else {
    const ctx = {
      venue: ${JSON.stringify(tela.venue ?? "casa-de-teste")},
      agente: null,
      definirAgente() {},
      aoSair() {},
      temModulo: () => true,
      atualizarContador() {},
    };
    await desenhar(document.getElementById("pagina"), ctx);
  }
</script>
</body>
</html>`;
}

// ============================================================
// O navegador de teste
// ============================================================

interface Achados {
  largura: number;
  titulos: string[];
  colunas: string[];
  rolaDeLado: boolean;
  /** Quem está estourando a largura, quando a página rola de lado. */
  culpados: string[];
  erros: string[];
  foto: string;
}

/**
 * Quem empurrou a página para fora da tela.
 *
 * Roda no navegador. Descobrir isto à mão custa abrir o inspetor e ir
 * clicando elemento por elemento; a pergunta é sempre a mesma, então ela
 * mora aqui.
 */
const PROCURAR_CULPADOS = `(() => {
  const limite = window.innerWidth + 1;
  const achados = [];
  for (const n of document.querySelectorAll("body *")) {
    const r = n.getBoundingClientRect();
    if (r.right <= limite && r.left >= -1) continue;
    if (r.width === 0 || r.height === 0) continue;
    // Só o elemento mais de fora de cada galho interessa: o filho estoura
    // junto com o pai, e listar os dois é ruído.
    if (achados.some((a) => a.node.contains(n))) continue;
    const classe = typeof n.className === "string" && n.className ? "." + n.className.trim().split(/\\s+/).join(".") : "";
    achados.push({ node: n, texto: n.tagName.toLowerCase() + classe + " (" + Math.round(r.width) + "px, borda em " + Math.round(r.right) + ")" });
  }
  return achados.slice(0, 4).map((a) => a.texto);
})()`;

/**
 * O Chromium que este computador tem.
 *
 * O playwright procura um navegador com o número de build da versão dele; um
 * `npm install` que sobe a versão deixa o build antigo no disco e o harness
 * para de abrir, dizendo que tem de baixar navegador. Quando há um Chromium
 * instalado aqui do lado, usamos esse e seguimos a vida.
 */
function ondeEstaOChromium(): string | undefined {
  const candidatos = [
    process.env.CHROMIUM,
    process.env.PLAYWRIGHT_BROWSERS_PATH ? join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium") : null,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean) as string[];
  return candidatos.find((c) => existsSync(c));
}

async function abrirNoNavegador(
  nome: string,
  endereco: string,
  larguras: number[],
  cliques: string[] = [],
  digita: Record<string, string> = {},
): Promise<Achados[]> {
  // O playwright é opcional de propósito: quem só quer clicar na tela usa
  // --servir e não precisa baixar navegador nenhum.
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "O navegador de teste não está instalado. Rode `npm i -D playwright && npx playwright install chromium`, "
      + "ou use `--servir` para abrir a tela no seu próprio navegador.",
    );
  }

  await mkdir(FOTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: ondeEstaOChromium() });
  const achados: Achados[] = [];

  try {
    for (const largura of larguras) {
      const pagina = await navegador.newPage({ viewport: { width: largura, height: 1100 } });
      const erros: string[] = [];
      pagina.on("pageerror", (e) => erros.push(e.message));
      pagina.on("console", (m) => {
        if (m.type() !== "error" || m.text().includes("favicon")) return;
        // Fonte do Google, script de terceiro: recurso de FORA que não
        // carregou não é defeito da tela — é a rede do lugar onde o teste
        // roda. O que é do próprio servidor de araque continua contando.
        const origem = m.location()?.url ?? "";
        if (m.text().startsWith("Failed to load resource") && origem && !origem.includes("localhost")) return;
        erros.push(m.text());
      });

      await pagina.goto(endereco);
      // Tempo de a tela buscar o que precisa e desenhar. Não é corrida: o
      // servidor é local e responde na hora.
      await pagina.waitForTimeout(900);

      for (const [seletor, texto] of Object.entries(digita)) {
        const alvo = pagina.locator(seletor).first();
        if (await alvo.count() === 0) {
          erros.push(`o campo "${seletor}" para digitar não existe na tela`);
          continue;
        }
        await alvo.fill(texto);
      }

      for (const seletor of cliques) {
        const alvo = pagina.locator(seletor).first();
        // Clique que não acha nada é defeito, e não silêncio: a situação
        // prometia mostrar a gaveta aberta e mostrou a tela fechada.
        if (await alvo.count() === 0) {
          erros.push(`o clique de "${seletor}" não achou nada na tela`);
          continue;
        }
        await alvo.click();
        await pagina.waitForTimeout(250);
      }

      const foto = join(FOTOS, `${nome}-${largura}.png`);
      await pagina.screenshot({ path: foto, fullPage: true });

      const rolaDeLado = Boolean(await pagina.evaluate("document.body.scrollWidth > window.innerWidth + 1"));
      achados.push({
        largura,
        titulos: await pagina.$$eval("h1, h2, h3", (ns) => ns.map((n) => n.textContent!.trim()).slice(0, 6)),
        colunas: await pagina.$$eval("thead th", (ns) => ns.map((n) => n.textContent!.trim())),
        // Expressão em texto, e não função: este código roda no navegador, e
        // o TypeScript daqui não conhece `document` nem `window`.
        rolaDeLado,
        culpados: rolaDeLado ? ((await pagina.evaluate(PROCURAR_CULPADOS)) as string[]) : [],
        erros,
        foto,
      });
      await pagina.close();
    }
  } finally {
    await navegador.close();
  }
  return achados;
}

// ============================================================
// O comando
// ============================================================

async function telasDisponiveis(): Promise<string[]> {
  const arquivos = await readdir(DADOS).catch(() => [] as string[]);
  return arquivos.filter((a) => a.endsWith(".json")).map((a) => a.replace(/\.json$/, "")).sort();
}

async function lerTela(nome: string): Promise<Tela> {
  const bruto = await readFile(join(DADOS, `${nome}.json`), "utf8").catch(() => null);
  if (bruto === null) {
    const lista = await telasDisponiveis();
    throw new Error(`Não existe "${nome}". Telas com dados de mentira: ${lista.join(", ") || "nenhuma ainda"}.`);
  }
  return JSON.parse(bruto) as Tela;
}

function relatar(achados: Achados[]): boolean {
  let houveErro = false;
  for (const a of achados) {
    console.log(`  ${a.largura}px — ${a.foto}`);
    if (a.titulos.length) console.log(`    títulos: ${a.titulos.join(" · ")}`);
    if (a.colunas.length) console.log(`    colunas: ${a.colunas.join(" | ")}`);
    if (a.rolaDeLado) {
      console.log("    ⚠ a página rola de lado nesta largura");
      for (const c of a.culpados) console.log(`      estoura: ${c}`);
      houveErro = true;
    }
    if (a.erros.length) {
      console.log(`    ⚠ erro de JavaScript: ${a.erros.join(" | ")}`);
      houveErro = true;
    }
    if (!a.rolaDeLado && a.erros.length === 0) console.log("    sem erro de JavaScript, não rola de lado");
  }
  return houveErro;
}

/** O que ficou faltando nos dados de mentira, pronto para colar no JSON. */
function relatarPendencias(): void {
  if (escritas.length > 0) {
    console.log(`    a tela mandou gravar: ${[...new Set(escritas)].join(", ")}`);
  }
  if (semArquivo.size > 0) {
    console.log(`    ⚠ arquivos que a tela pediu e não existem: ${[...semArquivo].join(", ")}`);
  }
  if (faltando.size === 0) return;
  console.log("\n    Rotas que a tela pediu e o arquivo de dados não tem. Cole no `rotas` e preencha:\n");
  const esqueleto = Object.fromEntries([...faltando].map((r) => [r, {}]));
  console.log(JSON.stringify(esqueleto, null, 2).split("\n").map((l) => `      ${l}`).join("\n"));
  console.log("");
}

interface Pedido {
  tela: string;
  situacao: string | null;
}

interface Opcoes {
  pedidos: Pedido[];
  todas: boolean;
  servir: boolean;
  porta: number;
  larguras: number[];
}

/**
 * Lê a linha de comando.
 *
 * `rh:ferias` é atalho para a tela `rh` na situação `ferias` — é o formato
 * que se digita sem pensar, e por isso o principal.
 */
function lerOpcoes(args: string[]): Opcoes {
  const pedidos: Pedido[] = [];
  let todas = false;
  let servir = false;
  let porta = 4600;
  let largura = 0;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--todas") { todas = true; continue; }
    if (arg === "--servir") { servir = true; continue; }
    if (arg === "--porta") { porta = Number(args[++i]) || porta; continue; }
    if (arg === "--largura") { largura = Number(args[++i]) || 0; continue; }
    if (arg.startsWith("--porta=")) { porta = Number(arg.slice(8)) || porta; continue; }
    if (arg.startsWith("--largura=")) { largura = Number(arg.slice(10)) || 0; continue; }
    if (arg.startsWith("--em")) {
      const nome = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++i];
      if (nome && pedidos.length > 0) pedidos[pedidos.length - 1]!.situacao = nome;
      continue;
    }
    if (arg.startsWith("--")) continue;
    const [tela, situacao] = arg.split(":");
    pedidos.push({ tela: tela!, situacao: situacao ?? null });
  }

  return { pedidos, todas, servir, porta, larguras: largura ? [largura] : [1280, 400] };
}

async function listar(): Promise<void> {
  const disponiveis = await telasDisponiveis();
  console.log("\nTelas com dados de mentira:\n");
  for (const nome of disponiveis) {
    const tela = await lerTela(nome);
    console.log(`  ${nome.padEnd(14)} ${tela.rotulo}`);
    for (const [chave, v] of Object.entries(tela.variacoes ?? {})) {
      console.log(`    ${`${nome}:${chave}`.padEnd(26)} ${v.rotulo ?? ""}`);
    }
  }
  if (disponiveis.length === 0) console.log(`  Nenhuma ainda. Crie ${DADOS}/<nome>.json.`);
  console.log("\n  npm run telas -- rh                abre e tira foto");
  console.log("  npm run telas -- rh:ferias         abre numa situação específica");
  console.log("  npm run telas -- rh --servir       sobe em localhost para você clicar");
  console.log("  npm run telas -- --todas           passa por todas as telas e situações");
  console.log("  npm run telas -- rh --largura 900  confere numa largura só\n");
}

/** Tudo que `--todas` precisa rodar: cada tela, em cada situação que ela tem. */
async function tudo(): Promise<Pedido[]> {
  const pedidos: Pedido[] = [];
  for (const tela of await telasDisponiveis()) {
    const situacoes = Object.keys((await lerTela(tela)).variacoes ?? {});
    if (situacoes.length === 0) pedidos.push({ tela, situacao: null });
    for (const situacao of situacoes) pedidos.push({ tela, situacao });
  }
  return pedidos;
}

async function rodarUm(pedido: Pedido, o: Opcoes): Promise<boolean> {
  const base = await lerTela(pedido.tela);
  const tela = comVariacao(base, pedido.situacao);
  const apelido = pedido.situacao ? `${pedido.tela}-${pedido.situacao}` : pedido.tela;

  faltando.clear();
  semArquivo.clear();
  escritas.length = 0;

  const { servidor, endereco: raiz } = await servir(tela, o.porta);
  // Página pública abre no caminho dela; tela do painel abre na raiz, que é
  // onde o servidor de araque monta o módulo.
  // Sem barra dobrada: "//checklist.html" o navegador lê como host
  // "checklist.html" e caminho "/", e o servidor serve a casca do painel.
  const endereco = tela.pagina ? `${raiz.replace(/\/$/, "")}${tela.pagina}` : raiz;
  console.log(`\n${apelido} — ${tela.rotulo}`);

  if (o.servir) {
    console.log(`\n  Aberto em ${endereco}`);
    console.log("  Abra no seu navegador e clique à vontade. Ctrl+C para parar.\n");
    await new Promise(() => {}); // fica no ar de propósito
  }

  try {
    const houveErro = relatar(await abrirNoNavegador(apelido, endereco, o.larguras, tela.cliques, tela.digita));
    relatarPendencias();
    return houveErro;
  } catch (e) {
    console.error(`  ${(e as Error).message}`);
    return true;
  } finally {
    servidor.close();
  }
}

async function principal(): Promise<void> {
  const o = lerOpcoes(process.argv.slice(2));
  if (!o.todas && o.pedidos.length === 0) return listar();

  const pedidos = o.todas ? await tudo() : o.pedidos;
  let houveErro = false;
  for (const pedido of pedidos) houveErro = (await rodarUm(pedido, o)) || houveErro;

  console.log(houveErro ? "\nAlguma coisa pede atenção acima.\n" : "\nTodas as telas abriram limpas.\n");
  if (houveErro) process.exitCode = 1;
}

principal().catch((e) => {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
});
