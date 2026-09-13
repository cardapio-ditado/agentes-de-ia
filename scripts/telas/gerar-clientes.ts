/**
 * Gera o `clientes.json` — as situações da base de clientes.
 *
 * Os retratos saem do próprio domínio (`retratoDe`, `resumoDaBase`), como na
 * casa: assim a ficha nunca inventa um selo que o servidor não daria.
 *
 *     npx tsx scripts/telas/gerar-clientes.ts
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resumoDaBase, retratoDe } from "../../src/crm.js";

const HOJE = "2026-09-13";

interface Pessoa {
  id: string;
  nome: string | null;
  telefone: string;
  visitas: number;
  gasto_total_centavos: number;
  ultima_visita: string | null;
  nascimento_dia?: number;
  nascimento_mes?: number;
  nascimento_ano?: number;
  origens: string[];
  nps?: number | null;
  descadastrado_em?: string | null;
}

/** Gente de bar de verdade, cada um representando um caso que a tela trata. */
const GENTE: Pessoa[] = [
  // O que fecha a mesa dos fundos: poucas visitas, conta alta. Vira VIP.
  { id: "c1", nome: "Renata Prado", telefone: "5565981382139", visitas: 4, gasto_total_centavos: 184_000, ultima_visita: "2026-09-11", nascimento_dia: 22, nascimento_mes: 9, nascimento_ano: 1988, origens: ["zig", "agente"], nps: 10 },
  // O freguês da quinta: vem sempre, gasta pouco. Mesmo total, outra pessoa.
  { id: "c2", nome: "Paulo Vieira", telefone: "5565999112233", visitas: 38, gasto_total_centavos: 190_000, ultima_visita: "2026-09-12", nascimento_dia: 3, nascimento_mes: 10, origens: ["zig"], nps: 9 },
  // O VIP que sumiu — a linha mais importante da tela.
  { id: "c3", nome: "Bruno Camargo", telefone: "5565988774455", visitas: 11, gasto_total_centavos: 520_000, ultima_visita: "2026-06-02", nascimento_dia: 14, nascimento_mes: 11, origens: ["zig", "pesquisa"], nps: 8 },
  { id: "c4", nome: "Carla Menezes", telefone: "5565997001122", visitas: 9, gasto_total_centavos: 76_500, ultima_visita: "2026-09-09", origens: ["zig"], nps: null },
  { id: "c5", nome: "Diego Nunes", telefone: "5565996543210", visitas: 1, gasto_total_centavos: 8_900, ultima_visita: "2026-09-12", origens: ["cardapio"], nps: null },
  { id: "c6", nome: "Elis Fontana", telefone: "5565994445566", visitas: 6, gasto_total_centavos: 61_200, ultima_visita: "2026-09-06", nascimento_dia: 30, nascimento_mes: 9, origens: ["zig", "pesquisa"], nps: 6 },
  // Quem pediu para não receber mensagem — continua na base, marcado.
  { id: "c7", nome: "Fábio Rocha", telefone: "5565993332211", visitas: 3, gasto_total_centavos: 27_400, ultima_visita: "2026-08-30", origens: ["planilha"], descadastrado_em: "2026-09-01T12:00:00.000Z" },
  // Cadastrado à mão e nunca passou pela porta: sem ticket, sem última visita.
  { id: "c8", nome: "Gabi Teixeira", telefone: "5565992221100", visitas: 0, gasto_total_centavos: 0, ultima_visita: null, nascimento_dia: 5, nascimento_mes: 12, origens: ["manual"] },
  // Sem nome: a lista mostra o telefone no lugar, e não um espaço vazio.
  { id: "c9", nome: null, telefone: "5565991110099", visitas: 2, gasto_total_centavos: 14_300, ultima_visita: "2026-09-10", origens: ["agente"] },
  { id: "c10", nome: "Hugo Barreto", telefone: "5565990098877", visitas: 17, gasto_total_centavos: 143_000, ultima_visita: "2026-05-18", origens: ["zig"], nps: 7 },
];

function comRetrato(p: Pessoa) {
  return {
    ...p,
    nascimento_dia: p.nascimento_dia ?? null,
    nascimento_mes: p.nascimento_mes ?? null,
    nascimento_ano: p.nascimento_ano ?? null,
    nps: p.nps ?? null,
    descadastrado_em: p.descadastrado_em ?? null,
    ...retratoDe(p, HOJE),
  };
}

const TODOS = GENTE.map(comRetrato);
const RESUMO = resumoDaBase(TODOS.map((p) => retratoDe(p, HOJE)));

const CONFIG = {
  parabens_ativo: true,
  parabens_hora: "10:00",
  parabens_dias_antes: 0,
  parabens_texto: "Parabéns, {nome}! Um brinde por conta da casa esperando você. 🍻",
};

const ficha = {
  rotulo: "Clientes — a base da casa",
  modulo: "/js/pages/clientesDaCasa.js",
  funcao: "clientesDaCasa",
  venue: "casa-de-teste",
  rotas: {
    "GET /clientes": TODOS,
    "GET /clientes/resumo": RESUMO,
    "GET /clientes/config": CONFIG,
    "GET /aniversariantes": [],
  },
  variacoes: {
    "so-os-sumidos": {
      rotulo: "filtrou quem vinha e parou de vir",
      cliques: ['.crm-tira[title="Vinha e parou de vir"]'],
      rotas: {
        "GET /clientes": TODOS.filter((p) => p.selo === "sumido"),
      },
    },
    "base-vazia": {
      rotulo: "casa que acabou de contratar o módulo",
      rotas: {
        "GET /clientes": [],
        "GET /clientes/resumo": resumoDaBase([]),
      },
    },
    "sem-consumo": {
      rotulo: "base sem Zig: tem gente, não tem consumo",
      rotas: {
        "GET /clientes": TODOS.map((p) => ({
          ...p,
          gasto_total_centavos: 0,
          ultima_visita: null,
          ...retratoDe({ visitas: 0, gasto_total_centavos: 0, ultima_visita: null }, HOJE),
        })),
        "GET /clientes/resumo": resumoDaBase(
          TODOS.map(() => retratoDe({ visitas: 0, gasto_total_centavos: 0, ultima_visita: null }, HOJE)),
        ),
      },
    },
  },
};

const aqui = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(aqui, "clientes.json"), `${JSON.stringify(ficha, null, 2)}\n`);
console.log("clientes.json escrito a partir do domínio.");
