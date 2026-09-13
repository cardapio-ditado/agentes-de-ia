/**
 * Gera o `a-casa.json` — as situações da planta da casa.
 *
 * Este arquivo existe porque a primeira versão do `a-casa.json` foi escrita à
 * mão: quando as áreas da casa mudaram, a ficha continuou falando de
 * "Portaria" e "Escritório", setores que não existem mais, e a tela abriu
 * com metade das baias faltando e os bonecos empilhados num canto.
 *
 * Agora a ficha nasce do próprio domínio (`SETORES`, `montarSetores`,
 * `montarMesas`). Mexeu nas áreas da casa? Rode:
 *
 *     npx tsx scripts/telas/gerar-a-casa.ts
 *
 * e as três situações se ajustam sozinhas.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { filaDoCarteiro, montarMesas, montarSetores, type Fato, type Trabalhador } from "../../src/aCasa.js";

const AGORA = "2026-09-12T23:40:00.000Z";
const DESDE = "2026-09-11T23:40:00.000Z";
const FUSO = "America/Cuiaba";

/** Minutos atrás, em ISO — para a ficha se ler como uma noite de verdade. */
function faz(minutos: number): string {
  return new Date(new Date(AGORA).getTime() - minutos * 60_000).toISOString();
}

const TODOS_OS_MODULOS = ["agentes-ia", "cardapio-digital", "cmv", "rh", "clientes", "checklist"];

const FATOS: Fato[] = [
  { id: "mesa:1", quando: faz(2), setor: "salao", tipo: "chamou_garcom", titulo: "Mesa 12: Chamou o garçom", detalhe: null, quem: "Juliana", atencao: true },
  { id: "reserva:1", quando: faz(3), setor: "recepcao", tipo: "reserva", titulo: "Reserva para 6 pessoa(s)", detalhe: "para hoje às 21:30", quem: "Renata Prado", atencao: true },
  { id: "msg:1", quando: faz(4), setor: "atendimento", tipo: "agente-respondeu", titulo: "O agente respondeu", detalhe: "Temos mesa para 6 às 21h30?", quem: "Renata Prado", atencao: false },
  { id: "mesa:2", quando: faz(9), setor: "salao", tipo: "visualizacao", titulo: "Mesa 7: Olhou um item", detalhe: "Costela no bafo", quem: "Mesa 7", atencao: false },
  { id: "producao:1", quando: faz(14), setor: "cozinha", tipo: "producao", titulo: "Produziu 4 lote(s)", detalhe: "Molho da casa", quem: "Cida", atencao: false },
  { id: "checklist:1", quando: faz(38), setor: "rotinas", tipo: "checklist", titulo: "Checklist concluído", detalhe: "2 ponto(s) de atenção", quem: "Marcos", atencao: true },
  { id: "resposta:1", quando: faz(55), setor: "atendimento", tipo: "pesquisa", titulo: "Respondeu a pesquisa: nota 9", detalhe: "Comida boa demais", quem: "Paulo", atencao: false },
  { id: "ponto:1", quando: faz(142), setor: "rh", tipo: "ponto", titulo: "Bateu entrada", detalhe: null, quem: "Juliana", atencao: false },
  { id: "compra:1", quando: faz(150), setor: "recebimento", tipo: "recebimento", titulo: "Mercadoria recebida", detalhe: "Distribuidora Cuiabá · R$ 3.480,00", quem: "Seu Nilton", atencao: false },
];

/** A equipe da casa — uma pessoa em cada baia que tem gente de verdade. */
const EQUIPE: Trabalhador[] = [
  { id: "pessoa:1", nome: "Juliana Barbosa", tipo: "pessoa", papel: "Garçonete", setor: "salao", fazendo: "Mesa 12: Chamou o garçom", desde: faz(2), minutos_parado: 2, em_pausa: false },
  { id: "pessoa:3", nome: "Tiago Menezes", tipo: "pessoa", papel: "Barman", setor: "salao", fazendo: null, desde: faz(52), minutos_parado: 52, em_pausa: false },
  { id: "pessoa:4", nome: "Rose da Silva", tipo: "pessoa", papel: "Copa", setor: "salao", fazendo: null, desde: faz(93), minutos_parado: 93, em_pausa: false },
  { id: "pessoa:5", nome: "Marcos Aurélio", tipo: "pessoa", papel: "Segurança", setor: "recepcao", fazendo: null, desde: faz(38), minutos_parado: 38, em_pausa: false },
  { id: "pessoa:2", nome: "Cida Nogueira", tipo: "pessoa", papel: "Cozinha", setor: "cozinha", fazendo: "Produziu 4 lote(s)", desde: faz(14), minutos_parado: 14, em_pausa: false },
  { id: "pessoa:7", nome: "Seu Nilton", tipo: "pessoa", papel: "Estoquista", setor: "recebimento", fazendo: null, desde: faz(150), minutos_parado: 150, em_pausa: false },
  { id: "pessoa:6", nome: "Val Prado", tipo: "pessoa", papel: "Subgerente", setor: "rh", fazendo: null, desde: faz(20), minutos_parado: 20, em_pausa: true },
  { id: "pessoa:8", nome: "Dona Zilda", tipo: "pessoa", papel: "Limpeza", setor: "rotinas", fazendo: "Checklist concluído", desde: faz(38), minutos_parado: 38, em_pausa: false },
  {
    id: "agente:atendente", nome: "Atendente", tipo: "agente", papel: "Responde o WhatsApp",
    setor: "atendimento", fazendo: "Respondendo Renata", desde: faz(4), minutos_parado: 4, em_pausa: false,
    detalhes: [
      { titulo: "Renata Prado", detalhe: "última mensagem há 4 min", quando: faz(4), ruim: false },
      { titulo: "Paulo Vieira", detalhe: "última mensagem há 1 h", quando: faz(62), ruim: false },
    ],
  },
  {
    // O caso que existe na casa de verdade: um aviso de reserva que nunca
    // saiu porque o telefone do cadastro era o id da Meta, não um celular.
    // Era o boneco dizendo "1 aviso falhou" e ninguém podendo perguntar qual.
    id: "agente:carteiro", nome: "Carteiro", tipo: "agente", papel: "Manda os avisos",
    setor: "rh", fazendo: "1 aviso(s) falharam", desde: faz(180), minutos_parado: 180, em_pausa: false,
    detalhes: filaDoCarteiro([
      {
        status: "failed",
        template: "reserva_aprovada",
        destination: "189554237694113",
        error: 'Telefone inválido: "189554237694113".',
        created_at: faz(2880),
      },
      {
        status: "pending",
        template: "pesquisa_convite",
        destination: "65 99999-0000",
        error: null,
        created_at: faz(3),
      },
    ]),
  },
];

const CADASTRO_DE_MESAS = Array.from({ length: 34 }, (_, i) => i + 1);

/** O salão de uma sexta comum: algumas mesas acesas, duas chamando. */
const MOVIMENTO_NORMAL = [
  { mesa: 3, cliente: "Renata", olhando: "Costela no bafo", ultimoEm: faz(22) },
  { mesa: 7, cliente: "Paulo", olhando: "Chopp Brahma", ultimoEm: faz(41) },
  { mesa: 12, cliente: "Ana", olhando: null, ultimoEm: faz(8) },
  { mesa: 18, cliente: "Bruno", olhando: "Picanha", ultimoEm: faz(63) },
  { mesa: 25, cliente: "Carla", olhando: null, ultimoEm: faz(15) },
  { mesa: 31, cliente: "Diego", olhando: "Batata frita", ultimoEm: faz(34) },
];

/** Sexta cheia: quase toda mesa acesa, e a casa correndo. */
const MOVIMENTO_CHEIO = CADASTRO_DE_MESAS.filter((n) => n % 7 !== 0).map((numero, i) => ({
  mesa: numero,
  cliente: ["Ana", "Bruno", "Carla", "Diego", "Elis", "Fabio", "Gabi", "Hugo"][i % 8]!,
  olhando: i % 3 === 0 ? "Costela no bafo" : null,
  ultimoEm: faz(4 + (i % 11) * 9),
}));

const GARCONS = new Map<number, string>([
  [3, "Juliana"], [7, "Juliana"], [12, "Tiago"], [18, "Tiago"], [25, "Rose"], [31, "Juliana"], [44, "Rose"],
]);

function situacao(params: {
  fatos: Fato[];
  equipe: Trabalhador[];
  contratados: string[];
  sessoes: Array<{ mesa: number; cliente: string | null; olhando: string | null; ultimoEm: string }>;
  chamados: number[];
  mesas?: number[];
}) {
  return {
    agora: AGORA,
    desde: DESDE,
    timezone: FUSO,
    setores: montarSetores({ fatos: params.fatos, contratados: params.contratados, agora: AGORA }),
    fatos: params.fatos,
    trabalhadores: params.equipe,
    mesas: montarMesas({
      cadastro: params.mesas ?? CADASTRO_DE_MESAS,
      sessoes: params.sessoes,
      chamados: params.chamados.map((mesa) => ({ mesa, em: faz(3) })),
      garcons: GARCONS,
      agora: AGORA,
    }),
    setoresMudos: [],
  };
}

const ficha = {
  rotulo: "A casa agora — a planta do bar ao vivo",
  modulo: "/js/pages/aCasa.js",
  funcao: "aCasa",
  venue: "casa-de-teste",
  rotas: {
    "GET /a-casa": situacao({
      fatos: FATOS,
      equipe: EQUIPE,
      contratados: TODOS_OS_MODULOS,
      sessoes: MOVIMENTO_NORMAL,
      chamados: [12, 31],
    }),
  },
  variacoes: {
    "sexta-cheia": {
      rotulo: "sexta à noite, o salão lotado",
      rotas: {
        "GET /a-casa": situacao({
          fatos: FATOS,
          equipe: EQUIPE,
          contratados: TODOS_OS_MODULOS,
          sessoes: MOVIMENTO_CHEIO,
          chamados: [5, 12, 19, 31],
        }),
      },
    },
    "casa-vazia": {
      rotulo: "abriu agora: as mesas todas livres",
      rotas: {
        "GET /a-casa": situacao({
          fatos: [],
          equipe: EQUIPE.map((t) => ({ ...t, fazendo: null, minutos_parado: 120 })),
          contratados: TODOS_OS_MODULOS,
          sessoes: [],
          chamados: [],
        }),
      },
    },
    "poucos-modulos": {
      rotulo: "casa que só assina o RH: o resto fica apagado",
      rotas: {
        "GET /a-casa": situacao({
          fatos: FATOS.filter((f) => f.setor === "rh"),
          equipe: EQUIPE.filter((t) => t.setor === "rh"),
          contratados: ["rh"],
          sessoes: [],
          chamados: [],
          mesas: [],
        }),
      },
    },
    "gaveta-do-carteiro": {
      rotulo: "clicou no agente que tem aviso falhado",
      cliques: [".boneco-com-problema .boneco-corpo"],
      rotas: {
        "GET /a-casa": situacao({
          fatos: FATOS,
          equipe: EQUIPE,
          contratados: TODOS_OS_MODULOS,
          sessoes: MOVIMENTO_NORMAL,
          chamados: [12, 31],
        }),
      },
    },
    "gaveta-da-mesa": {
      rotulo: "clicou na mesa que está chamando o garçom",
      cliques: [".iso-mesa-placa-chamando"],
      rotas: {
        "GET /a-casa": situacao({
          fatos: FATOS,
          equipe: EQUIPE,
          contratados: TODOS_OS_MODULOS,
          sessoes: MOVIMENTO_NORMAL,
          chamados: [12, 31],
        }),
      },
    },
    "gaveta-da-baia": {
      rotulo: "clicou na baia do atendimento ao cliente",
      cliques: ['[data-setor="atendimento"]'],
      rotas: {
        "GET /a-casa": situacao({
          fatos: FATOS,
          equipe: EQUIPE,
          contratados: TODOS_OS_MODULOS,
          sessoes: MOVIMENTO_NORMAL,
          chamados: [12, 31],
        }),
      },
    },
    "gaveta-do-nao-contratado": {
      rotulo: "clicou numa baia que a casa não assina",
      cliques: ['[data-setor="cozinha"]'],
      rotas: {
        "GET /a-casa": situacao({
          fatos: FATOS.filter((f) => f.setor === "rh"),
          equipe: EQUIPE.filter((t) => t.setor === "rh"),
          contratados: ["rh"],
          sessoes: [],
          chamados: [],
          mesas: [],
        }),
      },
    },
    "sem-mesa-cadastrada": {
      rotulo: "cardápio contratado e nenhuma mesa cadastrada",
      rotas: {
        "GET /a-casa": situacao({
          fatos: FATOS.filter((f) => f.setor !== "salao"),
          equipe: EQUIPE,
          contratados: TODOS_OS_MODULOS,
          sessoes: [],
          chamados: [],
          mesas: [],
        }),
      },
    },
  },
};

const aqui = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(aqui, "a-casa.json"), `${JSON.stringify(ficha, null, 2)}\n`);
console.log("a-casa.json escrito a partir do domínio.");
