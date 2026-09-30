import { el, limpar } from "./ui.js";

/**
 * Os modelos aprovados da Meta, nas telas.
 *
 * O mesmo seletor e o mesmo editor de lacunas servem ao parabéns, aos
 * disparos e ao convite da pesquisa: um modelo é sempre "qual" e "o que
 * vai em cada lacuna". Mora aqui para as três telas não divergirem.
 */

export const TIPOS_DE_LACUNA = [
  ["primeiro_nome", "Primeiro nome do cliente"],
  ["nome", "Nome completo do cliente"],
  ["casa", "Nome da casa"],
  ["data_aniversario", "Data do aniversário (“25 de dezembro”)"],
  ["dia_visita", "Dia da visita (“ontem”, “sábado”, “dia 27/09”)"],
  ["link", "O link (da pesquisa, do cardápio…)"],
  ["fixo", "Um texto fixo…"],
];

/** "ditado-popular" → "Ditado Popular", para prévia sem consultar o servidor. */
export function nomeAproximadoDaCasa(slug) {
  return String(slug ?? "")
    .split("-")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** O seletor de modelos: os que dá para mandar daqui; o resto desabilitado com o motivo. */
export function seletorDeModelo(modelos, escolhido) {
  return el("select", { classe: "select" }, [
    el("option", { value: "", texto: "— Nenhum —" }),
    ...(modelos ?? []).map((m) =>
      el("option", {
        value: m.name,
        texto: m.suportado ? `${m.name} (${m.categoria.toLowerCase()})` : `${m.name} — ${m.motivo}`,
        disabled: !m.suportado,
        selected: m.name === escolhido,
      }),
    ),
  ]);
}

export function modeloEscolhido(modelos, name) {
  return (modelos ?? []).find((m) => m.name === name) ?? null;
}

/**
 * Um seletor por lacuna do modelo. Devolve a função que lê o que está
 * escolhido, no formato que o servidor grava.
 *
 * `padrao` é o tipo sugerido para a primeira lacuna vazia (o convite da
 * pesquisa sugere "link" onde o parabéns sugere "primeiro nome").
 */
export function editorDeLacunas(area, modelo, valoresSalvos, aoMudar, padrao = ["primeiro_nome"]) {
  limpar(area);
  if (!modelo || modelo.lacunas === 0) {
    if (modelo) {
      area.append(el("small", { classe: "muted", texto: modelo.botao_url_dinamico
        ? "Este modelo não tem lacunas no texto; o link vai no botão."
        : "Este modelo não tem lacunas." }));
    }
    return () => [];
  }
  const linhas = [];
  for (let i = 0; i < modelo.lacunas; i += 1) {
    const salvo = valoresSalvos[i] ?? { tipo: padrao[i] ?? "fixo", texto: "" };
    const tipo = el("select", { classe: "select" }, TIPOS_DE_LACUNA.map(([id, rotulo]) => el("option", { value: id, texto: rotulo, selected: id === salvo.tipo })));
    const texto = el("input", { placeholder: "O texto que vai nessa lacuna", value: salvo.texto ?? "", style: salvo.tipo === "fixo" ? "" : "display:none" });
    tipo.addEventListener("change", () => {
      texto.style.display = tipo.value === "fixo" ? "" : "none";
      aoMudar?.();
    });
    linhas.push({ tipo, texto });
    area.append(
      el("div", { classe: "linha-campos" }, [
        el("span", { classe: "muted", style: "min-width:64px", texto: `{{${i + 1}}} =` }),
        tipo,
        texto,
      ]),
    );
  }
  if (modelo.botao_url_dinamico) {
    area.append(el("small", { classe: "muted", texto: `O botão de link do modelo (${modelo.botao_url}) recebe o link de cada pessoa sozinho.` }));
  }
  return () => linhas.map(({ tipo, texto }) => (tipo.value === "fixo" ? { tipo: "fixo", texto: texto.value } : { tipo: tipo.value }));
}

/** A prévia como uma pessoa leria — aproximada, com "Maria" e a casa de exemplo. */
export function renderizarPrevia(corpo, variaveis, casa = "sua casa") {
  const valores = (variaveis ?? []).map((v) =>
    v.tipo === "primeiro_nome" ? "Maria"
      : v.tipo === "nome" ? "Maria Souza"
        : v.tipo === "casa" ? casa
          : v.tipo === "data_aniversario" ? "25 de dezembro"
            : v.tipo === "dia_visita" ? "ontem"
              : v.tipo === "link" ? "https://brasafood.app/pesquisa?t=…"
                : (v.texto || "…"),
  );
  return (corpo ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (tudo, n) => valores[Number(n) - 1] ?? tudo);
}
