/**
 * Gera as fichas do checklist: a página pública no celular e o painel.
 *
 * As rodadas saem do próprio domínio (`rodadasPrevistas`, `estadoDa`), como
 * na casa — a ficha nunca inventa um estado que o servidor não daria.
 *
 *     npx tsx scripts/telas/gerar-checklist.ts
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { concluirRodada, estadoDa, rodadasPrevistas } from "../../src/rodadas.js";

const TOKEN = "chk_teste";

const ITENS = [
  { id: "i1", tipo: "sim_nao", pergunta: "Papel higiênico nos dois boxes?", obrigatorio: true },
  { id: "i2", tipo: "sim_nao", pergunta: "Pia limpa e sem água parada?", obrigatorio: true },
  { id: "i3", tipo: "sim_nao", pergunta: "Lixeira com saco e abaixo da metade?", obrigatorio: true },
  { id: "i4", tipo: "foto", pergunta: "Foto do banheiro", obrigatorio: false },
  { id: "i5", tipo: "texto", pergunta: "Algum reparo para avisar?", obrigatorio: false },
];

const RESPOSTAS_OK = [
  { item: "i1", valor: "sim", foto: null, observacao: null },
  { item: "i2", valor: "sim", foto: null, observacao: null },
  { item: "i3", valor: "sim", foto: null, observacao: null },
  { item: "i4", valor: null, foto: null, observacao: null },
  { item: "i5", valor: "", foto: null, observacao: null },
];

// A noite: 18:00 até 02:00 a cada 45 min = 11 rodadas. São 21:10 no relógio
// da casa — minuto 190. As três primeiras feitas, a das 20:15 (minuto 135)
// pulada, e a das 21:00 na vez.
const AGORA_MINUTO = 190;
let rodadas = rodadasPrevistas("18:00", "02:00", 45);
for (const [numero, minuto, executor] of [[1, 3, "Zilda"], [2, 47, "Zilda"], [3, 92, "Marcos"]] as const) {
  rodadas = concluirRodada(rodadas, numero, {
    agoraIso: `2026-09-25T${String(18 + Math.floor(minuto / 60)).padStart(2, "0")}:${String(minuto % 60).padStart(2, "0")}:00-04:00`,
    agoraMinuto: minuto,
    executor,
    respostas: RESPOSTAS_OK,
  });
}

const paraTela = (lista: typeof rodadas, agora: number) =>
  lista.map((r) => ({
    numero: r.numero,
    prevista: r.prevista,
    estado: estadoDa(r, agora),
    concluida_em: r.concluida_em,
    executor_nome: r.executor_nome,
  }));

const BASE = {
  checklist: "Banheiro — a cada 45 min",
  descricao: "Conferência dos banheiros durante o serviço",
  venue: "Ditado Popular",
  data: "2026-09-25",
  status: "em_andamento",
  executor: "Marcos",
  itens: ITENS,
  janela: { de: "18:00", ate: "02:00", a_cada_minutos: 45 },
};

// A noite fechada: 9 de 11 feitas, a das 20:15 e a das 00:45 puladas.
let fechada = rodadasPrevistas("18:00", "02:00", 45);
for (const r of fechada) {
  if (r.prevista === "20:15" || r.prevista === "00:45") continue;
  fechada = concluirRodada(fechada, r.numero, {
    agoraIso: "2026-09-26T05:40:00.000Z",
    agoraMinuto: r.minuto + 4,
    executor: r.numero % 2 ? "Zilda" : "Marcos",
    respostas: r.prevista === "23:15"
      ? RESPOSTAS_OK.map((x) => (x.item === "i3" ? { ...x, valor: "nao", observacao: "Saco rasgou, troquei" } : x))
      : RESPOSTAS_OK,
  });
}
const respondidas = fechada.map((r) => ({
  numero: r.numero,
  prevista: r.prevista,
  concluida_em: r.concluida_em,
  executor_nome: r.executor_nome,
  respostas: r.concluida_em
    ? ITENS.map((item) => {
        const x = (r.respostas ?? []).find((y) => y.item === item.id);
        return { pergunta: item.pergunta, tipo: item.tipo, valor: x?.valor ?? null, observacao: x?.observacao ?? null, foto: null };
      })
    : [],
}));

const publico = {
  rotulo: "Checklist no celular — o link público",
  pagina: `/checklist.html?t=${TOKEN}`,
  rotas: {
    [`GET /v1/checklist-publico/${TOKEN}`]: {
      ...BASE,
      rodadas: paraTela(rodadas, AGORA_MINUTO),
      na_vez: 5,
    },
  },
  variacoes: {
    "rodada-feita": {
      rotulo: "acabou de concluir a rodada das 21:00",
      digita: { "#executor": "Marcos" },
      cliques: [
        '[data-item="i1"] .opcao.sim',
        '[data-item="i2"] .opcao.sim',
        '[data-item="i3"] .opcao.sim',
        "#btn-enviar",
      ],
      rotas: {
        [`POST /v1/checklist-publico/${TOKEN}/rodada`]: {
          rodada: { numero: 5, prevista: "21:00", concluida_em: "2026-09-26T01:12:00.000Z" },
          proxima: { numero: 6, prevista: "21:45" },
          fechou: false,
          rodadas: paraTela(
            concluirRodada(rodadas, 5, { agoraIso: "2026-09-26T01:12:00.000Z", agoraMinuto: 192, executor: "Marcos", respostas: RESPOSTAS_OK }),
            192,
          ),
          resumo: null,
          alertas: [],
        },
      },
    },
    "noite-fechada": {
      rotulo: "a noite encerrada, aberta pelo gerente",
      rotas: {
        [`GET /v1/checklist-publico/${TOKEN}`]: {
          ...BASE,
          status: "concluida",
          concluido_em: "2026-09-26T05:46:00.000Z",
          resumo: "Noite tranquila nos banheiros: 9 de 11 rodadas feitas. Duas rodadas puladas (20:15 e 00:45), a primeira no pico do jantar. Lixeira rasgou às 23:15 e foi trocada na hora.",
          alertas: ["Rodada das 20:15 pulada no horário de pico — vale reforçar com a equipe.", "Saco de lixo rasgou às 23:15: conferir a qualidade dos sacos."],
          respostas: [],
          rodadas: paraTela(fechada, 999),
          rodadas_respondidas: respondidas,
        },
      },
    },
    "tudo-feito": {
      rotulo: "todas as rodadas de hoje já foram feitas",
      rotas: {
        [`GET /v1/checklist-publico/${TOKEN}`]: {
          ...BASE,
          rodadas: paraTela(rodadas.map((r) => ({ ...r, concluida_em: r.concluida_em ?? "2026-09-26T05:00:00.000Z" })), 999),
          na_vez: null,
        },
      },
    },
    "checklist-comum": {
      rotulo: "o checklist de uma vez por dia, como sempre foi",
      rotas: {
        [`GET /v1/checklist-publico/${TOKEN}`]: {
          ...BASE,
          checklist: "Abertura do bar",
          status: "pendente",
          janela: undefined,
        },
      },
    },
  },
};

const painel = {
  rotulo: "Checklists — os modelos e o editor",
  modulo: "/js/pages/checklists.js",
  funcao: "checklists",
  venue: "casa-de-teste",
  rotas: {
    "GET /checklists": [
      {
        id: "c1",
        name: "Banheiro — a cada 45 min",
        description: "Conferência dos banheiros durante o serviço",
        items: ITENS,
        schedule: {
          dias: ["qui", "sex", "sab"],
          hora: "18:00",
          ate: "02:00",
          a_cada_minutos: 45,
          responsavel_nome: "Zilda",
          responsavel_telefone: "65999990000",
          avisar_telefone: "65988880000",
        },
        active: true,
      },
      {
        id: "c2",
        name: "Abertura do bar",
        description: "Limpeza, freezers e caixa",
        items: ITENS.slice(0, 3),
        schedule: { dias: ["seg", "ter", "qua", "qui", "sex", "sab"], hora: "16:00", responsavel_nome: "Marcos", responsavel_telefone: "65999990000", avisar_telefone: "" },
        active: true,
      },
    ],
  },
  variacoes: {
    "editor-rodadas": {
      rotulo: "editando o checklist de rodadas",
      cliques: ['button:has-text("Editar")'],
      rotas: {},
    },
  },
};

const execucoes = {
  rotulo: "Execuções — o histórico dos checklists",
  modulo: "/js/pages/execucoes.js",
  funcao: "execucoes",
  venue: "casa-de-teste",
  rotas: {
    "GET /checklist-runs": [
      { id: "r1", checklist_id: "c1", checklist_nome: "Banheiro — a cada 45 min", scheduled_for: "2026-09-25", status: "concluida", executor_nome: "Marcos", alertas_ia: ["Rodada das 20:15 pulada no horário de pico"], rodadas_previstas: 11, rodadas_feitas: 9 },
      { id: "r2", checklist_id: "c1", checklist_nome: "Banheiro — a cada 45 min", scheduled_for: "2026-09-26", status: "em_andamento", executor_nome: "Zilda", alertas_ia: [], rodadas_previstas: 11, rodadas_feitas: 3 },
      { id: "r3", checklist_id: "c2", checklist_nome: "Abertura do bar", scheduled_for: "2026-09-26", status: "concluida", executor_nome: "Marcos", alertas_ia: [] },
    ],
    "GET /v1/checklist-runs/r1": {
      id: "r1",
      checklist_id: "c1",
      scheduled_for: "2026-09-25",
      status: "concluida",
      executor_nome: "Marcos",
      completed_at: "2026-09-26T05:46:00.000Z",
      resumo_ia: "Noite tranquila nos banheiros: 9 de 11 rodadas feitas.",
      alertas_ia: ["Rodada das 20:15 pulada no horário de pico — vale reforçar com a equipe."],
      answers: [],
      rodadas: fechada.map((r) => ({ ...r, respostas: (r.respostas ?? []).map((x) => ({ ...x, foto_url: null })) })),
      checklist: { name: "Banheiro — a cada 45 min", items: ITENS },
    },
  },
  variacoes: {
    "noite-aberta": {
      rotulo: "abriu a noite de rodadas no histórico",
      cliques: [".cartao-clicavel"],
      rotas: {},
    },
  },
};

const aqui = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(aqui, "checklist-publico.json"), `${JSON.stringify(publico, null, 2)}\n`);
writeFileSync(join(aqui, "checklists.json"), `${JSON.stringify(painel, null, 2)}\n`);
writeFileSync(join(aqui, "execucoes.json"), `${JSON.stringify(execucoes, null, 2)}\n`);
console.log("checklist-publico.json, checklists.json e execucoes.json escritos a partir do domínio.");
