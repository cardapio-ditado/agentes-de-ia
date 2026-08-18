import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lerConfiguracao,
  politicaDeResposta,
  promptDeResposta,
  traduzirFalha,
  NOTA_MINIMA_PARA_AUTOMATICO,
} from "./avaliacoes.js";

const PADRAO = lerConfiguracao({ configuracao: {} });

test("4 e 5 estrelas saem sozinhas; 3 espera gente", () => {
  assert.equal(politicaDeResposta(5, PADRAO), "automatica");
  assert.equal(politicaDeResposta(4, PADRAO), "automatica");
  assert.equal(politicaDeResposta(3, PADRAO), "humana");
});

test("1 e 2 estrelas NUNCA são automáticas, mesmo mandando responder tudo", () => {
  // Um cliente afobado marca "responder tudo sozinho". A pior avaliação
  // possível não pode virar resposta automática por causa disso.
  const tudoAutomatico = lerConfiguracao({ configuracao: { nota_automatica: 1 } });

  assert.equal(politicaDeResposta(1, tudoAutomatico), "humana");
  assert.equal(politicaDeResposta(2, tudoAutomatico), "humana");
  // E o piso não trava o resto: 3 para cima obedece a configuração.
  assert.equal(politicaDeResposta(3, tudoAutomatico), "automatica");
});

test("a casa pode ser mais conservadora que o padrão", () => {
  const soCincoEstrelas = lerConfiguracao({ configuracao: { nota_automatica: 5 } });

  assert.equal(politicaDeResposta(5, soCincoEstrelas), "automatica");
  assert.equal(politicaDeResposta(4, soCincoEstrelas), "humana");
});

test("configuração inválida cai no padrão em vez de quebrar", () => {
  const lixo = lerConfiguracao({ configuracao: { nota_automatica: "muito" } });
  assert.equal(lixo.nota_automatica, 4);
  assert.equal(politicaDeResposta(4, lixo), "automatica");

  const vazio = lerConfiguracao({ configuracao: null as never });
  assert.equal(vazio.nota_automatica, 4);
});

test("o piso é o que a constante diz — regra e teste não podem divergir", () => {
  assert.equal(politicaDeResposta(NOTA_MINIMA_PARA_AUTOMATICO - 1, PADRAO), "humana");
});

test("o prompt proíbe prometer cortesia e inventar fato", () => {
  const p = promptDeResposta({
    venue: { name: "Ditado Popular" },
    config: PADRAO,
    respostasAnteriores: [],
  });

  assert.match(p, /Ditado Popular/);
  assert.match(p, /NUNCA prometa cortesia, desconto, reembolso/);
  assert.match(p, /NUNCA invente fato/);
  assert.match(p, /Não peça para a pessoa mudar a nota/);
});

test("respostas anteriores entram no prompt para o modelo não repetir a fórmula", () => {
  const p = promptDeResposta({
    venue: { name: "Ditado Popular" },
    config: lerConfiguracao({ configuracao: { assinatura: "Equipe Ditado", tom: "informal" } }),
    respostasAnteriores: ["Obrigado pela visita, Marina!"],
  });

  assert.match(p, /escreva DIFERENTE destas/);
  assert.match(p, /Obrigado pela visita, Marina!/);
  assert.match(p, /Tom desta casa: informal/);
  assert.match(p, /Assine como: Equipe Ditado/);
});

test("tabela faltando vira instrução, não 'erro interno'", () => {
  // O PostgREST responde assim quando a migração não rodou. Sem tradução, o
  // painel mostra "consulte o trace-id no log" e manda a pessoa caçar log.
  const mensagens = [
    "Could not find the table 'public.google_avaliacoes' in the schema cache",
    'relation "public.google_perfis" does not exist',
    "42P01",
  ];

  for (const m of mensagens) {
    assert.throws(
      () => traduzirFalha(m, "Falha ao carregar"),
      (e) =>
        e.status === 503 &&
        e.code === "modulo_nao_instalado" &&
        /20260818000000_create_avaliacoes_google\.sql/.test(e.message),
      `não traduziu: ${m}`,
    );
  }
});

test("falha de verdade continua sendo erro de verdade", () => {
  assert.throws(
    () => traduzirFalha("connection refused", "Falha ao carregar"),
    (e) => e instanceof Error && /Falha ao carregar: connection refused/.test(e.message),
  );
});
