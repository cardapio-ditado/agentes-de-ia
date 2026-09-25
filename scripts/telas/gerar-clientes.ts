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
import { balanco, type Envio } from "../../src/disparos.js";
import { diasAte, textoDeParabens } from "../../src/aniversarios.js";
import { resumirModelo } from "../../src/whatsappOficial.js";

// Os modelos como a Meta devolve, passados pelo mesmo resumo do servidor.
const MODELOS = [
  resumirModelo({
    name: "quinta_do_chope",
    language: "pt_BR",
    category: "MARKETING",
    status: "APPROVED",
    components: [
      { type: "BODY", text: "Oi, {{1}}! Faz tempo que a gente não te vê no {{2}}. Quinta tem {{3}} — te esperamos?" },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero!" }, { type: "QUICK_REPLY", text: "Não, obrigado" }] },
    ],
  }),
  resumirModelo({
    name: "parabens_ditado",
    language: "pt_BR",
    category: "MARKETING",
    status: "APPROVED",
    components: [{ type: "BODY", text: "{{1}}, o {{2}} quer comemorar seu aniversário com você. Vem com a galera que o primeiro chope é por nossa conta!" }],
  }),
  resumirModelo({
    name: "cardapio_novo",
    language: "pt_BR",
    category: "MARKETING",
    status: "PENDING",
    components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Cardápio novo no ar!" }],
  }),
];

const CONFIG_PADRAO = {
  aniversario_ativo: false,
  aniversario_hora: 10,
  aniversario_antecedencia: 10,
  aniversario_texto: null,
  aniversario_teto_por_dia: 40,
  aniversario_modelo: null,
  aniversario_modelo_variaveis: [],
};

// A agenda como a API devolve: os dias até o aniversário e a mensagem saem
// do próprio domínio, e não de contas feitas à mão aqui.
const montarAniversariantes = () => GENTE
  .filter((p) => p.nascimento_dia && p.nascimento_mes)
  .map((p) => {
    const { dias, proximo } = diasAte(p.nascimento_dia!, p.nascimento_mes!, HOJE);
    return {
      ...comRetrato(p),
      dias_ate: dias,
      proximo,
      mensagem: textoDeParabens({ aniversario_texto: null }, "Ditado Popular", p.nome, { dia: p.nascimento_dia!, mes: p.nascimento_mes!, diasAntes: dias }),
      ja_avisado: p.id === "c1",
      envio: p.id === "c1" ? { status: "sent", erro: null, criado_em: "2026-09-12T13:00:00.000Z", enviado_em: "2026-09-12T13:00:05.000Z" } : null,
    };
  })
  .filter((p) => p.dias_ate <= 90)
  .sort((a, b) => a.dias_ate - b.dias_ate);

const ENVIOS: Envio[] = [
  { id: "e1", disparo_id: "d1", venue_id: "v", cliente_id: "c3", telefone: "5565988774455", nome: "Bruno Camargo", status: "respondeu", provider_id: "wamid.1", erro: null, enviado_em: "2026-09-24T21:00:00.000Z", entregue_em: "2026-09-24T21:00:05.000Z", lido_em: "2026-09-24T21:03:00.000Z", respondeu_em: "2026-09-24T21:04:00.000Z", resposta: "Quero!" },
  { id: "e2", disparo_id: "d1", venue_id: "v", cliente_id: "c10", telefone: "5565990098877", nome: "Hugo Barreto", status: "lido", provider_id: "wamid.2", erro: null, enviado_em: "2026-09-24T21:00:01.000Z", entregue_em: "2026-09-24T21:00:06.000Z", lido_em: "2026-09-24T22:10:00.000Z", respondeu_em: null, resposta: null },
  { id: "e3", disparo_id: "d1", venue_id: "v", cliente_id: null, telefone: "5565991110099", nome: null, status: "entregue", provider_id: "wamid.3", erro: null, enviado_em: "2026-09-24T21:00:02.000Z", entregue_em: "2026-09-24T21:00:07.000Z", lido_em: null, respondeu_em: null, resposta: null },
  { id: "e4", disparo_id: "d1", venue_id: "v", cliente_id: null, telefone: "5565993332211", nome: "Fábio Rocha", status: "falhou", provider_id: null, erro: "(#131026) Message undeliverable", enviado_em: "2026-09-24T21:00:03.000Z", entregue_em: null, lido_em: null, respondeu_em: null, resposta: null },
  { id: "e5", disparo_id: "d1", venue_id: "v", cliente_id: null, telefone: "5565997001122", nome: "Carla Menezes", status: "pendente", provider_id: null, erro: null, enviado_em: null, entregue_em: null, lido_em: null, respondeu_em: null, resposta: null },
];

const DISPAROS = [
  {
    id: "d1",
    venue_id: "v",
    nome: "Quinta do chope — chamar os sumidos",
    modelo: "quinta_do_chope",
    idioma: "pt_BR",
    corpo: MODELOS[0]!.corpo,
    variaveis: [{ tipo: "primeiro_nome" }, { tipo: "casa" }, { tipo: "fixo", texto: "chope em dobro" }],
    publico: { selo: "sumido" },
    status: "enviando",
    agendado_para: "2026-09-24T21:00:00.000Z",
    concluido_em: null,
    criado_em: "2026-09-24T18:00:00.000Z",
    atualizado_em: "2026-09-24T21:00:00.000Z",
    balanco: balanco(ENVIOS),
  },
  {
    id: "d2",
    venue_id: "v",
    nome: "Aniversariantes de outubro",
    modelo: "parabens_ditado",
    idioma: "pt_BR",
    corpo: MODELOS[1]!.corpo,
    variaveis: [{ tipo: "primeiro_nome" }, { tipo: "casa" }],
    publico: { aniversario_mes: 10 },
    status: "rascunho",
    agendado_para: null,
    concluido_em: null,
    criado_em: "2026-09-25T10:00:00.000Z",
    atualizado_em: "2026-09-25T10:00:00.000Z",
    balanco: balanco([]),
  },
];

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
    "GET /clientes/ddds": [
      { ddd: "65", pessoas: 25364 },
      { ddd: "66", pessoas: 5225 },
      { ddd: "11", pessoas: 1784 },
      { ddd: "69", pessoas: 1221 },
    ],
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
    // As três situações que a frase antiga cobria com a MESMA palavra, e que
    // são três problemas diferentes com três saídas diferentes.
    "aniversarios": {
      rotulo: "a agenda com gente, enxuta, com os filtros de período e DDD",
      cliques: ['.aba[data-aba="aniversarios"]'],
      rotas: {
        "GET /aniversariantes": montarAniversariantes(),
        "GET /clientes/config": { ...CONFIG_PADRAO, aniversario_ativo: true, aniversario_modelo: "parabens_ditado" },
      },
    },
    "parabens-com-oficial": {
      rotulo: "a aba Parabéns com o número oficial conectado: o modelo da Meta é a mensagem",
      cliques: ['.aba[data-aba="parabens"]'],
      rotas: {
        "GET /clientes/config": { ...CONFIG_PADRAO, aniversario_modelo: "parabens_ditado", aniversario_modelo_variaveis: [{ tipo: "primeiro_nome" }, { tipo: "casa" }] },
        "GET /whatsapp-oficial/modelos": MODELOS,
      },
    },
    "aniversarios-fora-de-epoca": {
      rotulo: "agenda vazia porque ainda não é a época",
      cliques: ['.aba[data-aba="aniversarios"]'],
      rotas: {
        "GET /aniversariantes": [],
        "GET /aniversariantes/panorama": {
          na_base: 3646,
          com_data: 1865,
          proximo: { nome: "Mel Thichayla", dias_ate: 71, proximo: "2026-11-23" },
        },
      },
    },
    "aniversarios-sem-data": {
      rotulo: "agenda vazia porque a casa não tem data nenhuma",
      cliques: ['.aba[data-aba="aniversarios"]'],
      rotas: {
        "GET /aniversariantes": [],
        "GET /aniversariantes/panorama": { na_base: 69, com_data: 0, proximo: null },
      },
    },
    "aniversarios-casa-errada": {
      rotulo: "agenda vazia porque a casa não tem cliente nenhum",
      cliques: ['.aba[data-aba="aniversarios"]'],
      rotas: {
        "GET /aniversariantes": [],
        "GET /aniversariantes/panorama": { na_base: 0, com_data: 0, proximo: null },
      },
    },
    "disparos": {
      rotulo: "a aba de disparos, com uma campanha no meio do caminho",
      cliques: ['.aba[data-aba="disparos"]'],
      rotas: {
        "GET /disparos": DISPAROS,
        "GET /whatsapp-oficial/modelos": MODELOS,
        "POST /disparos/previa": { pessoas: 2, amostra: ["Bruno Camargo", "Hugo Barreto"] },
      },
    },
    "disparo-aberto": {
      rotulo: "um disparo aberto, com o que aconteceu com cada pessoa",
      cliques: ['.aba[data-aba="disparos"]', '[data-disparo="d1"]'],
      rotas: {
        "GET /disparos": DISPAROS,
        "GET /disparos/d1": { ...DISPAROS[0], envios: ENVIOS },
        "GET /whatsapp-oficial/modelos": MODELOS,
      },
    },
    "disparos-sem-oficial": {
      rotulo: "a aba de disparos numa casa sem o número oficial",
      cliques: ['.aba[data-aba="disparos"]'],
      rotas: { "GET /disparos": [] },
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
