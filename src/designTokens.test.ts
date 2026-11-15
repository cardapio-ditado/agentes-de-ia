import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * O kit de marca tem dois lugares: design/tokens/colors.json (a fonte, em três
 * camadas) e o bloco "brandkit" de public/styles.css (o que o navegador lê).
 * Estes testes garantem duas coisas que a olho ninguém garante:
 *   1. os pares de texto e fundo passam o contraste da WCAG 2.2 AA, no claro
 *      E no escuro;
 *   2. o CSS diz exatamente o que o JSON diz — mudar um sem o outro quebra.
 */

const raiz = fileURLToPath(new URL("..", import.meta.url));
const json = JSON.parse(readFileSync(`${raiz}design/tokens/colors.json`, "utf8"));
const css = readFileSync(`${raiz}public/styles.css`, "utf8");

type No = Record<string, unknown>;
const ir = (obj: unknown, caminho: string): unknown => caminho.split(".").reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as No)[k] : undefined), obj);

/** Segue {alias} até o hexadecimal. `tema` escuro olha primeiro em `dark`. */
function cor(caminho: string, tema: "claro" | "escuro"): string {
  let no = tema === "escuro" && caminho.startsWith("semantic.") ? ir(json.dark, caminho.slice("semantic.".length)) : undefined;
  no ??= ir(json, caminho);
  let valor = (no as No | undefined)?.$value;
  for (let i = 0; i < 12 && typeof valor === "string" && valor.startsWith("{"); i++) {
    const ref = valor.slice(1, -1);
    const alvo = (tema === "escuro" && ref.startsWith("semantic.") ? ir(json.dark, ref.slice("semantic.".length)) : undefined) ?? ir(json, ref);
    valor = (alvo as No | undefined)?.$value;
  }
  assert.match(String(valor), /^#[0-9a-f]{6}$/i, `token sem cor: ${caminho} (${tema})`);
  return String(valor).toLowerCase();
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (escuro + 0.05);
}

// [frente, fundo, mínimo, o que é]
const PARES: [string, string, number, string][] = [
  ["semantic.text.primary", "semantic.surface.page", 4.5, "texto na página"],
  ["semantic.text.primary", "semantic.surface.card", 4.5, "texto no cartão"],
  ["semantic.text.secondary", "semantic.surface.page", 4.5, "texto secundário na página"],
  ["semantic.text.secondary", "semantic.surface.card", 4.5, "texto secundário no cartão"],
  ["semantic.text.secondary", "semantic.surface.raised", 4.5, "texto secundário no cabeçalho da tabela"],
  ["semantic.text.tertiary", "semantic.surface.card", 4.5, "texto de apoio no cartão"],
  ["semantic.text.link", "semantic.surface.page", 4.5, "link na página"],
  ["semantic.text.on-action", "semantic.action.primary", 4.5, "texto no botão principal"],
  ["semantic.text.on-action", "semantic.action.primary-hover", 4.5, "texto no botão principal com o mouse em cima"],
  ["semantic.border.strong", "semantic.surface.page", 3, "borda de campo na página"],
  ["semantic.border.strong", "semantic.surface.card", 3, "borda de campo no cartão"],
  ["semantic.feedback.success-text", "semantic.surface.card", 4.5, "situação concluída"],
  ["semantic.feedback.warning-text", "semantic.surface.card", 4.5, "situação de atenção"],
  ["semantic.feedback.error-text", "semantic.surface.card", 4.5, "situação de problema"],
  ["semantic.feedback.info-text", "semantic.surface.card", 4.5, "situação informativa"],
  ["semantic.feedback.success-text", "semantic.feedback.success-bg", 4.5, "texto sobre fundo de concluído"],
  ["semantic.feedback.warning-text", "semantic.feedback.warning-bg", 4.5, "texto sobre fundo de atenção"],
  ["semantic.feedback.error-text", "semantic.feedback.error-bg", 4.5, "texto sobre fundo de problema"],
];

for (const tema of ["claro", "escuro"] as const) {
  test(`contraste WCAG 2.2 AA no tema ${tema}`, () => {
    for (const [frente, fundo, minimo, nome] of PARES) {
      const r = contraste(cor(frente, tema), cor(fundo, tema));
      assert.ok(r >= minimo, `${nome}: ${r.toFixed(2)}:1, pede ${minimo}:1 (${cor(frente, tema)} sobre ${cor(fundo, tema)})`);
    }
  });
}

test("rampas: o tom 500 serve para texto e o 600 para interface, sobre branco", () => {
  for (const familia of ["terracota", "neutro", "musgo", "ambar", "verde", "vermelho"]) {
    // 4,49 arredonda para 4,5 na conta de qualquer ferramenta; a folga é de centésimo.
    assert.ok(contraste(cor(`primitive.${familia}.500`, "claro"), "#ffffff") >= 4.48, `${familia}.500 abaixo de 4,5:1`);
    assert.ok(contraste(cor(`primitive.${familia}.600`, "claro"), "#ffffff") >= 3, `${familia}.600 abaixo de 3:1`);
  }
});

/** As variáveis que o bloco brandkit do CSS declara, por tema, já resolvidas. */
function variaveisDoCss(): Record<"claro" | "escuro", Map<string, string>> {
  const bloco = css.slice(css.indexOf("/* brandkit:inicio"), css.indexOf("/* brandkit:fim */"));
  assert.ok(bloco.length > 100, "bloco brandkit não encontrado em public/styles.css");
  const ler = (seletor: string): Map<string, string> => {
    const inicio = bloco.indexOf(`${seletor} {`);
    const corpo = bloco.slice(inicio, bloco.indexOf("\n}", inicio));
    return new Map([...corpo.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
  };
  const claro = ler(":root");
  const escuro = new Map([...claro, ...ler('[data-tema="escuro"]')]);
  const resolver = (mapa: Map<string, string>) => {
    for (const [nome, valor] of mapa) {
      let v = valor;
      for (let i = 0; i < 6; i++) {
        const m = /^var\((--[\w-]+)\)$/.exec(v);
        if (!m) break;
        v = mapa.get(m[1]!) ?? v;
      }
      mapa.set(nome, v.toLowerCase());
    }
    return mapa;
  };
  return { claro: resolver(claro), escuro: resolver(escuro) };
}

// papel no JSON → variável no CSS
const ESPELHO: [string, string][] = [
  ["semantic.surface.page", "--fundo"],
  ["semantic.surface.card", "--superficie"],
  ["semantic.surface.raised", "--superficie-2"],
  ["semantic.border.default", "--borda"],
  ["semantic.border.strong", "--borda-controle"],
  ["semantic.border.focus", "--foco"],
  ["semantic.text.primary", "--texto"],
  ["semantic.text.secondary", "--texto-2"],
  ["semantic.text.tertiary", "--texto-3"],
  ["semantic.text.on-action", "--cta-texto"],
  ["semantic.text.link", "--marca-forte"],
  ["semantic.action.primary", "--cta"],
  ["semantic.action.primary-hover", "--cta-hover"],
  ["semantic.brand.accent", "--marca"],
  ["semantic.feedback.success-text", "--ok"],
  ["semantic.feedback.success-bg", "--ok-suave"],
  ["semantic.feedback.warning-text", "--alerta"],
  ["semantic.feedback.warning-bg", "--alerta-suave"],
  ["semantic.feedback.error-text", "--perigo"],
  ["semantic.feedback.error-bg", "--perigo-suave"],
  ["semantic.feedback.info-text", "--info"],
  ["semantic.feedback.info-bg", "--info-suave"],
];

test("o CSS do painel diz o mesmo que o kit de marca", () => {
  const vars = variaveisDoCss();
  for (const tema of ["claro", "escuro"] as const) {
    for (const [papel, variavel] of ESPELHO) {
      assert.equal(vars[tema].get(variavel), cor(papel, tema), `${variavel} no tema ${tema} difere de ${papel}`);
    }
  }
  // As rampas também: cada tom do JSON tem a sua variável no CSS, com o mesmo valor.
  for (const [familia, tons] of Object.entries(json.primitive as Record<string, unknown>)) {
    if (!tons || typeof tons !== "object" || "$value" in (tons as No)) continue;
    for (const [tom, t] of Object.entries(tons as Record<string, No>)) {
      assert.equal(vars.claro.get(`--${familia}-${tom}`), String(t.$value).toLowerCase(), `--${familia}-${tom}`);
    }
  }
});
