import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agendaEmTexto,
  avaliarExecucao,
  diaDaSemana,
  diasEntre,
  nomeDeQuemFez,
  nomesParaEscolher,
  oQueSeRepete,
  periodoPedido,
  resumirChecklist,
} from "./checklistPainel.js";
import type { Checklist, ChecklistRun } from "./checklists.js";
import type { Rodada } from "./rodadas.js";

const ITENS = [
  { id: "papel", tipo: "sim_nao", pergunta: "Papel higiênico reposto?", obrigatorio: true },
  { id: "obs", tipo: "texto", pergunta: "Observações", obrigatorio: false },
];

function checklist(mudar: Partial<Checklist> = {}, agenda: Record<string, unknown> = {}): Checklist {
  return {
    id: "chk1",
    venue_id: "v1",
    name: "Limpeza do banheiro",
    description: null,
    items: ITENS,
    schedule: { dias: ["seg", "ter", "qua", "qui", "sex", "sab", "dom"], hora: "09:00", responsavel_nome: "Lucineide", responsavel_telefone: "65999990000", avisar_telefone: "", ...agenda },
    active: true,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    ...mudar,
  } as unknown as Checklist;
}

function run(data: string, mudar: Partial<ChecklistRun> = {}): ChecklistRun {
  return {
    id: `run-${data}`,
    checklist_id: "chk1",
    venue_id: "v1",
    token: "t",
    scheduled_for: data,
    status: "concluida",
    answers: [],
    executor_nome: "Lucineide",
    started_at: null,
    completed_at: `${data}T12:00:00Z`,
    resumo_ia: null,
    alertas_ia: [],
    rodadas: [],
    created_at: `${data}T12:00:00Z`,
    ...mudar,
  } as unknown as ChecklistRun;
}

function rodada(numero: number, prevista: string, minuto: number, feita: boolean, atraso = 0, respostas: Rodada["respostas"] = []): Rodada {
  return {
    numero,
    prevista,
    minuto,
    iniciada_em: null,
    concluida_em: feita ? "2026-11-20T23:00:00Z" : null,
    minuto_feita: feita ? minuto + atraso : null,
    executor_nome: feita ? "andrew" : null,
    respostas: feita ? respostas : null,
    cutucada_em: null,
  };
}

const HOJE = "2026-11-26";

test("dias e dia da semana no calendário da casa", () => {
  assert.deepEqual(diasEntre("2026-11-29", "2026-12-02"), ["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
  assert.equal(diaDaSemana("2026-11-26"), "qui");
  assert.equal(diaDaSemana("2026-11-29"), "dom");
});

test("período: sem nada são 30 dias até hoje; nunca passa de hoje nem inverte", () => {
  assert.deepEqual(periodoPedido(null, null, HOJE), { de: "2026-10-28", ate: HOJE });
  assert.deepEqual(periodoPedido("2026-11-01", "2026-12-31", HOJE), { de: "2026-11-01", ate: HOJE });
  assert.deepEqual(periodoPedido("2026-11-30", "2026-11-10", HOJE), { de: "2026-11-10", ate: "2026-11-10" });
  assert.deepEqual(periodoPedido("lixo", "2026-11-10", HOJE), { de: "2026-10-12", ate: "2026-11-10" });
});

test("nome de quem fez: acerta caixa e espaço, mas não junta nomes diferentes", () => {
  assert.equal(nomeDeQuemFez("  lucineide  "), "Lucineide");
  assert.equal(nomeDeQuemFez("JOAO PEDRO"), "Joao Pedro");
  assert.equal(nomeDeQuemFez("maria da silva"), "Maria da Silva");
  assert.equal(nomeDeQuemFez("Lili"), "Lili");
  assert.equal(nomeDeQuemFez(""), null);
  assert.equal(nomeDeQuemFez(null), null);
});

test("execução comum: feita, com alerta, aberta hoje e esquecida", () => {
  assert.equal(avaliarExecucao(run("2026-11-25"), HOJE).situacao, "feito");
  const comAlerta = avaliarExecucao(run("2026-11-25", { alertas_ia: ["Pia entupida"] }), HOJE);
  assert.equal(comAlerta.situacao, "com_problema");
  assert.equal(comAlerta.motivo, "Pia entupida");
  assert.equal(avaliarExecucao(run(HOJE, { status: "pendente", executor_nome: null }), HOJE).situacao, "aguardando");
  const aberta = avaliarExecucao(run("2026-11-25", { status: "em_andamento", executor_nome: null }), HOJE);
  assert.equal(aberta.situacao, "nao_feito");
  assert.equal(aberta.motivo, "abriram o link, mas não terminaram");
  assert.equal(avaliarExecucao(run("2026-11-25", { status: "pendente", executor_nome: null }), HOJE).motivo, "ninguém abriu o link");
});

test("execução de rodadas: pulada é problema, nenhuma feita é não feito", () => {
  const tres = (feitas: boolean[]) => feitas.map((f, i) => rodada(i + 1, `2${i}:00`, i * 60, f)) as unknown as ChecklistRun["rodadas"];
  assert.equal(avaliarExecucao(run("2026-11-25", { rodadas: tres([true, true, true]) }), HOJE).situacao, "feito");
  const pulada = avaliarExecucao(run("2026-11-25", { rodadas: tres([true, false, true]) }), HOJE);
  assert.equal(pulada.situacao, "com_problema");
  assert.equal(pulada.motivo, "1 rodada pulada de 3");
  assert.deepEqual(pulada.executores, ["Lucineide", "Andrew"]);
  assert.equal(avaliarExecucao(run("2026-11-25", { status: "em_andamento", rodadas: tres([false, false, false]) }), HOJE).situacao, "nao_feito");
  // Hoje, ainda na noite: não é nem verde nem vermelho.
  assert.equal(avaliarExecucao(run(HOJE, { status: "em_andamento", rodadas: tres([true, false, false]) }), HOJE).situacao, "aguardando");
});

test("o que se repete: rodada mais pulada, atrasos e o Não mais frequente", () => {
  const nao = [{ item: "papel", valor: "nao", foto: null, observacao: null }];
  const noite = (d: string) =>
    run(d, {
      rodadas: [
        rodada(1, "20:00", 0, true, 30, nao),
        rodada(2, "22:00", 120, false),
        rodada(3, "00:00", 240, true, 0, nao),
      ] as unknown as ChecklistRun["rodadas"],
    });
  const frases = oQueSeRepete([noite("2026-11-23"), noite("2026-11-24"), noite("2026-11-25")], ITENS, HOJE);
  assert.deepEqual(frases, [
    '"Papel higiênico reposto?" respondido Não 6 vezes',
    "A rodada das 22:00 ficou sem fazer 3 vezes",
    "3 rodadas feitas com mais de 15 min de atraso",
  ]);
});

test("o que se repete: sem padrão, mostra o último alerta da IA; sem nada, vazio", () => {
  assert.deepEqual(oQueSeRepete([run("2026-11-24", { alertas_ia: ["Velho"] }), run("2026-11-25", { alertas_ia: ["Novo"] })], ITENS, HOJE), ["Último alerta da IA: Novo"]);
  assert.deepEqual(oQueSeRepete([run("2026-11-25")], ITENS, HOJE), []);
});

test("cartão: dias, faixa de 14, cumprimento e último feito", () => {
  const runs = [
    run("2026-11-20"),
    run("2026-11-21", { alertas_ia: ["Sabonete acabando"] }),
    run("2026-11-22", { status: "pendente", executor_nome: null, completed_at: null }),
    // 23 e 24 sem execução: o link não saiu.
    run("2026-11-25", { executor_nome: "  andrew " }),
    run(HOJE, { status: "pendente", executor_nome: null, completed_at: null }),
  ];
  const r = resumirChecklist(checklist({ created_at: "2026-11-20T08:00:00Z" }), runs, { de: "2026-11-20", ate: HOJE }, { hoje: HOJE, agora: "08:00" });
  assert.deepEqual(
    r.dias.map((d) => d.situacao),
    ["feito", "com_problema", "nao_feito", "nao_saiu", "nao_saiu", "feito", "aguardando"],
  );
  assert.equal(r.faixa.length, 14);
  // Antes de o checklist existir, é folga — não pode pintar de vermelho.
  assert.equal(r.faixa[0]!.situacao, "folga");
  assert.deepEqual(r.cumprimento, { feitos: 3, devidos: 6, percentual: 50, unidade: "dias" });
  assert.deepEqual(r.ultimo_feito, { data: "2026-11-25", executor: "Andrew", concluido_em: "2026-11-25T12:00:00Z" });
  assert.deepEqual(r.por_executor, { Lucineide: 2, Andrew: 1 });
  assert.equal(r.agenda, "todo dia às 09:00");
  assert.equal(r.hoje?.situacao, "aguardando");
  assert.equal(r.hoje?.atrasado, false);
  assert.equal(r.nunca_feito, null);
});

test("hoje: passou da hora (mais uma de folga) e ninguém fez, está atrasado", () => {
  const r = resumirChecklist(checklist(), [run(HOJE, { status: "pendente", executor_nome: null, completed_at: null })], { de: HOJE, ate: HOJE }, { hoje: HOJE, agora: "10:01" });
  assert.equal(r.hoje?.atrasado, true);
  const cedo = resumirChecklist(checklist(), [], { de: HOJE, ate: HOJE }, { hoje: HOJE, agora: "09:30" });
  assert.equal(cedo.hoje?.situacao, "aguardando");
  assert.equal(cedo.hoje?.atrasado, false);
});

test("nunca feito: o link saiu todos os dias e ninguém terminou", () => {
  const runs = ["2026-11-23", "2026-11-24", "2026-11-25"].map((d, i) =>
    run(d, { status: i === 0 ? "em_andamento" : "pendente", executor_nome: null, completed_at: null }),
  );
  const r = resumirChecklist(checklist({ name: "Vigia noturno", created_at: "2026-11-23T00:00:00Z" }), runs, { de: "2026-11-23", ate: "2026-11-25" }, { hoje: HOJE, agora: "08:00" });
  assert.deepEqual(r.nunca_feito, { links: 3, abertos: 1 });
  assert.equal(r.ultimo_feito, null);
  assert.equal(r.cumprimento.percentual, 0);
});

test("rodadas: o cumprimento conta rodadas, e a noite sem link conta as previstas", () => {
  const agenda = { hora: "20:00", ate: "23:00", a_cada_minutos: 60 };
  const noite = (feitas: boolean[]) => feitas.map((f, i) => rodada(i + 1, `${20 + i}:00`, i * 60, f)) as unknown as ChecklistRun["rodadas"];
  const runs = [
    run("2026-11-23", { rodadas: noite([true, true, true, true]) }),
    run("2026-11-24", { rodadas: noite([true, false, true, false]) }),
    // 25 sem execução: o link não saiu — as quatro rodadas previstas contam.
  ];
  const r = resumirChecklist(checklist({ created_at: "2026-11-01T00:00:00Z" }, agenda), runs, { de: "2026-11-23", ate: "2026-11-25" }, { hoje: HOJE, agora: "08:00" });
  assert.deepEqual(r.cumprimento, { feitos: 6, devidos: 12, percentual: 50, unidade: "rodadas" });
});

test("agenda em texto", () => {
  assert.equal(agendaEmTexto(checklist({}, { dias: ["seg", "qua", "sex"] })), "seg, qua e sex às 09:00");
  assert.equal(agendaEmTexto(checklist({}, { dias: ["sab"] })), "sáb às 09:00");
  assert.equal(agendaEmTexto(checklist({}, { dias: [] })), "só quando disparado");
  assert.equal(agendaEmTexto(checklist({}, { hora: "18:00", ate: "02:00", a_cada_minutos: 60 })), "todo dia das 18:00 às 02:00, a cada 60 min");
});

test("nomes para escolher: responsável, quem mais preencheu, depois a equipe, sem repetir", () => {
  const nomes = nomesParaEscolher({
    responsavel: "Lucineide",
    jaPreencheram: ["andrew", "Andrew", "lucineide", "Lili", null, "Andrew"],
    equipe: [{ nome: "Joel", apelido: null }, { nome: "JOAO", apelido: "JOAO" }, { nome: "André", apelido: null }],
  });
  assert.deepEqual(nomes, ["Lucineide", "Andrew", "Lili", "André", "Joao", "Joel"]);
});
