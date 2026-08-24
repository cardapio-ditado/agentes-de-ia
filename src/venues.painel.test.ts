import assert from "node:assert/strict";
import test from "node:test";
import { dadosDaCasaParaOPainel } from "./venues.js";
import type { Venue } from "./venues.js";

/**
 * A lista de campos que o painel recebe é escrita à mão, e já esqueceu campo
 * novo duas vezes. O sintoma é traiçoeiro: a coluna entra no banco, a página
 * pública do cliente (que lê a casa direto) mostra o valor, e o painel do dono
 * insiste que não há nada salvo — sem erro em lugar nenhum.
 */

const casa = (over: Partial<Venue> = {}): Venue =>
  ({
    slug: "ditado-popular",
    name: "Ditado Popular",
    description: null,
    address: null,
    phone: null,
    whatsapp: null,
    email: null,
    capacity: null,
    timezone: "America/Cuiaba",
    opening_hours: null,
    settings: null,
    ...over,
  }) as Venue;

test("tudo o que a tela de ajustes edita volta na leitura", () => {
  // Cada um destes é um campo que a casa preenche numa tela. Faltando aqui, a
  // tela abre vazia e a pessoa preenche de novo por cima do que já existia.
  const dados = dadosDaCasaParaOPainel(casa());
  for (const campo of [
    "slug",
    "name",
    "description",
    "address",
    "phone",
    "whatsapp",
    "email",
    "capacity",
    "timezone",
    "opening_hours",
    "maps_url",
    "reservas_avisar_whatsapp",
    "reserva_lembrete_minutos",
    "logo_url",
    "cor_marca",
  ]) {
    assert.ok(campo in dados, `o painel não recebe "${campo}"`);
  }
});

test("a marca da casa chega ao painel", () => {
  // O caso concreto: a logo aparecia na pesquisa do cliente e o painel dizia
  // "sem logo ainda", porque a pesquisa lê a casa direto do banco e esta rota
  // só entrega o que está nomeado.
  const dados = dadosDaCasaParaOPainel(
    casa({ logo_url: "https://x/marcas/abc/logo-1.png", cor_marca: "#c1121f" }),
  );
  assert.equal(dados.logo_url, "https://x/marcas/abc/logo-1.png");
  assert.equal(dados.cor_marca, "#c1121f");
});

test("casa sem marca devolve null, e não some com o campo", () => {
  // `undefined` desaparece do JSON, e a tela receberia um objeto sem a chave —
  // indistinguível de "esta versão do servidor não conhece esse campo".
  const dados = dadosDaCasaParaOPainel(casa());
  assert.equal(dados.logo_url, null);
  assert.equal(dados.cor_marca, null);
});

test("o lembrete cai no padrão de 60 antes de a migração rodar", () => {
  assert.equal(dadosDaCasaParaOPainel(casa()).reserva_lembrete_minutos, 60);
  assert.equal(
    dadosDaCasaParaOPainel(casa({ reserva_lembrete_minutos: 0 })).reserva_lembrete_minutos,
    0,
  );
});

test("horário de funcionamento vazio vira objeto, não null", () => {
  // A tela faz laço sobre isto. Null quebraria a página de ajustes de uma casa
  // que ainda não preencheu horário nenhum.
  assert.deepEqual(dadosDaCasaParaOPainel(casa()).opening_hours, {});
});

test("settings NÃO vai para o navegador", () => {
  // Configuração interna da casa. A lista ser escrita à mão é o que impede
  // uma coluna nova de vazar para a tela sem ninguém decidir isso.
  const dados = dadosDaCasaParaOPainel(casa({ settings: { max_party_size: 12 } as never }));
  assert.equal("settings" in dados, false);
  assert.equal("id" in dados, false);
  assert.equal("org_id" in dados, false);
});
