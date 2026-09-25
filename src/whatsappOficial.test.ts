import assert from "node:assert/strict";
import test from "node:test";
import {
  conexaoVazia,
  explicarErroDaMeta,
  faltaOQue,
  mascarar,
  mesclar,
  paraOPainel,
  prontaParaAtender,
  prontaParaEnviar,
  situacaoDa,
  type ConexaoOficial,
} from "./whatsappOficial.js";

const completa: ConexaoOficial = {
  ...conexaoVazia("casa-1"),
  token: "EAAB-token-comprido-k3Qa",
  phone_number_id: "1370957436093649",
  waba_id: "1582085583665675",
  agent_slug: "fernanda",
};

test("a conexão diz o que falta, em português de tela", () => {
  assert.deepEqual(faltaOQue(conexaoVazia("x")), ["o token de acesso", "o ID do telefone", "o ID da conta"]);
  assert.deepEqual(faltaOQue({ ...completa, waba_id: null }), ["o ID da conta"]);
  assert.deepEqual(faltaOQue(completa), []);
});

test("enviar precisa de token e telefone; atender precisa de alguém do outro lado", () => {
  assert.equal(prontaParaEnviar(null), false);
  assert.equal(prontaParaEnviar({ ...completa, waba_id: null, agent_slug: null }), true);
  assert.equal(prontaParaAtender({ ...completa, agent_slug: null }), false);
  assert.equal(prontaParaAtender(completa), true);
});

test("a situação só vira 'ativa' depois do teste", () => {
  // Preenchida mas nunca testada pode ter o ID trocado — o erro que calou
  // a primeira casa. A tela não pode dizer "ativa" nesse estado.
  assert.equal(situacaoDa(conexaoVazia("x")), "nao_configurada");
  assert.equal(situacaoDa({ ...completa, token: null }), "incompleta");
  assert.equal(situacaoDa(completa), "falta_testar");
  assert.equal(situacaoDa({ ...completa, testada_em: "2026-09-25T10:00:00Z", inscrita_em: null }), "falta_testar");
  assert.equal(situacaoDa({ ...completa, testada_em: "2026-09-25T10:00:00Z", inscrita_em: "2026-09-25T10:00:00Z" }), "ativa");
});

test("o painel nunca recebe o token — só o rabo dele", () => {
  const tela = paraOPainel(completa);
  assert.equal(JSON.stringify(tela).includes("EAAB"), false);
  assert.equal(tela.tem_token, true);
  assert.equal(tela.token_final, "…k3Qa");
  assert.equal(mascarar(null), null);
  assert.equal(paraOPainel(conexaoVazia("x")).tem_token, false);
});

test("mesclar: undefined não mexe, string vazia apaga, e mudar ID invalida o teste", () => {
  const testada: ConexaoOficial = {
    ...completa,
    telefone: "+55 65 9985-5207",
    nome_verificado: "Ditado Popular",
    inscrita_em: "2026-09-25T10:00:00Z",
    testada_em: "2026-09-25T10:00:00Z",
  };

  // Salvar só o agente não pode derrubar o token: a tela nunca o recebe de
  // volta, então "não digitei" é "mantém".
  const soAgente = mesclar(testada, { agent_slug: "lucas", token: undefined });
  assert.equal(soAgente.token, completa.token);
  assert.equal(soAgente.agent_slug, "lucas");
  assert.equal(soAgente.testada_em, testada.testada_em, "trocar o agente não invalida o teste");

  const apagouToken = mesclar(testada, { token: "" });
  assert.equal(apagouToken.token, null);
  assert.equal(apagouToken.testada_em, null);

  const trocouTelefone = mesclar(testada, { phone_number_id: " 999 " });
  assert.equal(trocouTelefone.phone_number_id, "999");
  assert.equal(trocouTelefone.telefone, null);
  assert.equal(trocouTelefone.inscrita_em, null);

  // O mesmo valor de novo não é troca.
  const igual = mesclar(testada, { phone_number_id: completa.phone_number_id! });
  assert.equal(igual.testada_em, testada.testada_em);
});

test("o erro da Meta vira uma frase que diz o que conferir", () => {
  assert.match(explicarErroDaMeta({ code: 190, message: "Invalid OAuth access token" }, "telefone"), /token/i);
  assert.match(explicarErroDaMeta({ code: 100, message: "Unsupported get request" }, "telefone"), /ID do TELEFONE/);
  assert.match(explicarErroDaMeta({ code: 100, message: "Unsupported post request" }, "conta"), /ID da CONTA/);
  assert.match(explicarErroDaMeta({ code: 10, message: "Application does not have permission" }, "conta"), /permiss/i);
  assert.match(explicarErroDaMeta({ message: "Algo inesperado" }, "conta"), /Algo inesperado/);
  assert.match(explicarErroDaMeta(undefined, "conta"), /não respondeu/);
});
