/**
 * Gera o `canais-casa.json` — as situações da tela "WhatsApp da casa".
 *
 * O retrato da conexão sai do próprio domínio (`paraOPainel`), como no
 * servidor: a tela nunca vê um estado que a API não devolveria.
 *
 *     npx tsx scripts/telas/gerar-canais-casa.ts
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { conexaoVazia, paraOPainel, type ConexaoOficial } from "../../src/whatsappOficial.js";

const AGENTES = [
  { slug: "fernanda", name: "Fernanda", description: null, model: "claude-opus-5", effort: "high", enabled: true },
  { slug: "lucas-promocoes", name: "Lucas (promoções)", description: null, model: "claude-opus-5", effort: "high", enabled: true },
];

const preenchida: ConexaoOficial = {
  ...conexaoVazia("casa-1"),
  token: "EAAB-token-de-mentira-k3Qa",
  phone_number_id: "1370957436093649",
  waba_id: "1582085583665675",
  agent_slug: "lucas-promocoes",
};

const ativa: ConexaoOficial = {
  ...preenchida,
  telefone: "+55 65 9985-5207",
  nome_verificado: "Ditado Popular",
  inscrita_em: "2026-09-25T17:40:00.000Z",
  testada_em: "2026-09-25T17:40:00.000Z",
};

// O conector administrativo pareado: é o caso comum das casas de hoje.
const CONECTOR = { status: "conectado", telefone: "5565999990000", versao: "2026.09.25", fonte: "ponte" };

const ficha = {
  rotulo: "WhatsApp da casa — o oficial da Meta e o do conector",
  modulo: "/js/pages/canaisDaCasa.js",
  funcao: "canaisDaCasa",
  venue: "casa-de-teste",
  rotas: {
    "GET /whatsapp-oficial": paraOPainel(ativa),
    "GET /v1/agents": AGENTES,
    "GET /v1/whatsapp/status": CONECTOR,
  },
  variacoes: {
    "nao-configurada": {
      rotulo: "casa que ainda não conectou o número oficial",
      rotas: { "GET /whatsapp-oficial": paraOPainel(conexaoVazia("casa-1")) },
    },
    "falta-testar": {
      rotulo: "dados colados, teste por fazer — o estado que enganou a primeira casa",
      rotas: { "GET /whatsapp-oficial": paraOPainel(preenchida) },
    },
    "so-envia": {
      rotulo: "ativa sem agente: o número só dispara, ninguém responde",
      rotas: { "GET /whatsapp-oficial": paraOPainel({ ...ativa, agent_slug: null }) },
    },
    "sem-conector": {
      rotulo: "o oficial ativo e o conector fora do ar",
      rotas: { "GET /v1/whatsapp/status": { status: "sem_conector", telefone: null, versao: null } },
    },
  },
};

const aqui = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(aqui, "canais-casa.json"), `${JSON.stringify(ficha, null, 2)}\n`);
console.log("canais-casa.json escrito a partir do domínio.");
