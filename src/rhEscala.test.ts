import assert from "node:assert/strict";
import test from "node:test";
import { ErroDoRh } from "./rh.js";
import {
  alertasDeDescanso,
  descreverTurno,
  diaCurto,
  diasDaSemana,
  horaCurta,
  mensagemDaSemana,
  segundaDaSemana,
  somarDias,
  viraODia,
  type LinhaDaEscala,
  type Turno,
} from "./rhEscala.js";

const NOITE: Turno = { id: "t1", nome: "Noite", inicio: "18:00:00", fim: "02:00:00", ordem: 2, ativo: true };
const ALMOCO: Turno = { id: "t2", nome: "Almoço", inicio: "11:00:00", fim: "15:30:00", ordem: 1, ativo: true };

function linha(mudancas: Partial<LinhaDaEscala>): LinhaDaEscala {
  return {
    id: "x",
    data: "2026-09-14",
    atendente_id: "p1",
    turno_id: NOITE.id,
    situacao: "trabalha",
    funcao: null,
    observacao: null,
    ...mudancas,
  };
}

test("a semana começa na segunda, e domingo pertence à semana que passou", () => {
  // 14/09/2026 é uma segunda-feira.
  assert.equal(segundaDaSemana("2026-09-14"), "2026-09-14");
  assert.equal(segundaDaSemana("2026-09-17"), "2026-09-14", "quinta");
  assert.equal(segundaDaSemana("2026-09-19"), "2026-09-14", "sábado");
  // O domingo é o fim da semana da casa, não o começo — é o dia de maior
  // movimento e ninguém chama aquilo de "semana nova".
  assert.equal(segundaDaSemana("2026-09-20"), "2026-09-14", "domingo");
  assert.equal(segundaDaSemana("2026-09-21"), "2026-09-21", "segunda seguinte");
});

test("a semana tem sete dias e atravessa a virada do mês", () => {
  const dias = diasDaSemana("2026-09-28");
  assert.equal(dias.length, 7);
  assert.equal(dias[0], "2026-09-28");
  assert.equal(dias[3], "2026-10-01", "quinta cai em outubro");
  assert.equal(dias[6], "2026-10-04");
  // Ano bissexto: 2028 tem 29 de fevereiro.
  assert.equal(somarDias("2028-02-28", 1), "2028-02-29");
  assert.equal(somarDias("2026-01-01", -1), "2025-12-31");
});

test("data que não é data não vira semana", () => {
  assert.throws(() => segundaDaSemana("14/09/2026"), ErroDoRh);
  assert.throws(() => segundaDaSemana(""), ErroDoRh);
});

test("turno de bar atravessa a meia-noite, e a tela diz isso", () => {
  assert.equal(viraODia(NOITE), true);
  assert.equal(viraODia(ALMOCO), false);
  assert.equal(horaCurta("18:00:00"), "18h");
  assert.equal(horaCurta("15:30:00"), "15h30");
  assert.equal(descreverTurno(NOITE), "Noite · 18h → 2h (vira o dia)");
  assert.equal(descreverTurno(ALMOCO), "Almoço · 11h → 15h30");
});

test("o dia aparece do jeito que a casa fala", () => {
  assert.equal(diaCurto("2026-09-14"), "seg 14/09");
  assert.equal(diaCurto("2026-09-20"), "dom 20/09");
});

test("a mensagem traz só os dias da pessoa, com turno, função e folga", () => {
  const texto = mensagemDaSemana({
    nome: "Cida",
    casa: "Ditado Popular",
    segunda: "2026-09-14",
    turnos: [NOITE, ALMOCO],
    linhas: [
      linha({ data: "2026-09-18", turno_id: ALMOCO.id, funcao: "Caixa" }),
      linha({ data: "2026-09-14" }),
      linha({ data: "2026-09-16", situacao: "folga", turno_id: null }),
    ],
  });

  assert.match(texto, /Olá, Cida!/);
  assert.match(texto, /Ditado Popular/);
  assert.match(texto, /seg 14\/09 a dom 20\/09/);
  // Ordem cronológica, mesmo com as linhas chegando fora de ordem do banco.
  assert.ok(texto.indexOf("seg 14/09 · Noite") < texto.indexOf("qua 16/09 · Folga"));
  assert.ok(texto.indexOf("qua 16/09 · Folga") < texto.indexOf("sex 18/09 · Almoço"));
  assert.match(texto, /sex 18\/09 · Almoço 11h → 15h30 \(Caixa\)/);
  assert.match(texto, /seg 14\/09 · Noite 18h → 2h/);
  // Terça e quinta não foram lançadas: não aparecem, e a última linha impede
  // que o silêncio seja lido como folga.
  assert.doesNotMatch(texto, /ter 15/);
  assert.match(texto, /não aparecem aqui não estão na sua escala/);
});

test("semana sem nada lançado ainda gera mensagem honesta", () => {
  const texto = mensagemDaSemana({
    nome: "JB",
    casa: "Ditado Popular",
    segunda: "2026-09-14",
    turnos: [NOITE],
    linhas: [],
  });
  assert.match(texto, /Nenhum turno lançado para você nesta semana/);
});

test("férias e atestado aparecem pelo nome, não como turno vazio", () => {
  const texto = mensagemDaSemana({
    nome: "Ana",
    casa: "Ditado",
    segunda: "2026-09-14",
    turnos: [NOITE],
    linhas: [
      linha({ data: "2026-09-15", situacao: "ferias", turno_id: null }),
      linha({ data: "2026-09-16", situacao: "atestado", turno_id: null }),
    ],
  });
  assert.match(texto, /ter 15\/09 · Férias/);
  assert.match(texto, /qua 16\/09 · Atestado/);
});

// ---- Alertas de descanso ----
// A semana de teste: segunda 09/11/2026 a domingo 15/11/2026.
const SEMANA = "2026-11-09";
const noite = (data: string) => ({ data, inicio: "18:00:00", fim: "02:00:00" });
const almoco = (data: string) => ({ data, inicio: "11:00:00", fim: "15:00:00" });
const tipos = (a: Array<{ tipo: string }>) => a.map((x) => x.tipo);
const alertas = (turnos: Array<{ data: string; inicio: string; fim: string }>, nascimento?: string | null) =>
  alertasDeDescanso({ nome: "Bia", semana: SEMANA, turnos, nascimento });

test("descanso: semana comum de cinco noites não gera alerta nenhum", () => {
  const dias = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"];
  assert.deepEqual(alertas(dias.map(noite)), []);
  assert.deepEqual(alertas([]), []);
});

test("descanso: seis dias seguidos passam; o sétimo avisa, uma vez, e diz o dia", () => {
  const seis = Array.from({ length: 6 }, (_, i) => almoco(somarDias(SEMANA, i)));
  assert.deepEqual(tipos(alertas(seis)), []);

  const sete = Array.from({ length: 7 }, (_, i) => almoco(somarDias(SEMANA, i)));
  const a = alertas(sete).filter((x) => x.tipo === "setimo_dia");
  assert.equal(a.length, 1);
  assert.match(a[0]!.texto, /Bia chega ao 7º dia seguido de trabalho em dom 15\/11/);
  assert.match(a[0]!.texto, /sem folga desde seg 09\/11/);
});

test("descanso: o sétimo dia atravessa a virada da semana", () => {
  // Trabalhou de quarta a domingo da semana passada, e segunda e terça desta.
  const turnos = ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"].map(almoco);
  const a = alertas(turnos).filter((x) => x.tipo === "setimo_dia");
  assert.equal(a.length, 1);
  assert.match(a[0]!.texto, /7º dia seguido de trabalho em ter 10\/11 \(sem folga desde qua 04\/11\)/);
});

test("descanso: sequência que estourou na semana passada segue avisando, uma vez só", () => {
  // Sete dias na semana passada (o 7º foi lá) e mais dois nesta.
  const turnos = Array.from({ length: 9 }, (_, i) => almoco(somarDias("2026-11-02", i)));
  const a = alertas(turnos).filter((x) => x.tipo === "setimo_dia");
  assert.equal(a.length, 1);
  assert.match(a[0]!.texto, /8º dia seguido de trabalho em seg 09\/11/);
});

test("descanso: uma folga no meio zera a contagem, e dia sem lançamento é folga", () => {
  const dias = Array.from({ length: 9 }, (_, i) => somarDias("2026-11-04", i)).filter((d) => d !== "2026-11-08");
  assert.deepEqual(tipos(alertas(dias.map(almoco))), []);
});

test("descanso: fechar às 2h e abrir às 11h são 9h — avisa com os horários", () => {
  const a = alertas([noite("2026-11-13"), almoco("2026-11-14")]);
  assert.deepEqual(tipos(a), ["entre_jornadas"]);
  assert.match(a[0]!.texto, /Bia sai às 2h do turno de sex 13\/11 e volta às 11h de sáb 14\/11: só 9h de descanso/);
  assert.match(a[0]!.texto, /11h/);
});

test("descanso: o turno que vira a noite conta o fim no dia seguinte", () => {
  // Sem tratar a virada, 02:00 pareceria ANTES das 18h do mesmo dia e o
  // descanso até o almoço do dia seguinte daria 33h em vez de 9h.
  assert.deepEqual(tipos(alertas([noite("2026-11-10"), almoco("2026-11-11")])), ["entre_jornadas"]);
  // Noite depois de noite: sai 2h, volta 18h = 16h. Tudo certo.
  assert.deepEqual(alertas([noite("2026-11-10"), noite("2026-11-11")]), []);
  // Termina à meia-noite em ponto e volta às 11h: 11h exatas, no limite, passa.
  assert.deepEqual(alertas([{ data: "2026-11-10", inicio: "18:00", fim: "00:00" }, almoco("2026-11-11")]), []);
  // Termina 00:30 e volta às 11h: 10h30.
  const a = alertas([{ data: "2026-11-10", inicio: "18:00", fim: "00:30" }, almoco("2026-11-11")]);
  assert.match(a[0]!.texto, /só 10h30 de descanso/);
});

test("descanso: dobrar almoço e noite no mesmo dia não é descanso curto", () => {
  // As 3h entre um turno e outro são intervalo dentro da jornada.
  assert.deepEqual(alertas([almoco("2026-11-12"), noite("2026-11-12")]), []);
  // Mas a jornada do dia vai até o fim do ÚLTIMO turno: 2h → 11h do dia seguinte.
  assert.deepEqual(tipos(alertas([almoco("2026-11-12"), noite("2026-11-12"), almoco("2026-11-13")])), ["entre_jornadas"]);
});

test("descanso: a virada de domingo para segunda aparece na semana da segunda", () => {
  // Domingo passado à noite, segunda no almoço: é desta semana que se avisa.
  assert.deepEqual(tipos(alertas([noite("2026-11-08"), almoco("2026-11-09")])), ["entre_jornadas"]);
  // O par inteiro na semana passada não é assunto desta tela.
  assert.deepEqual(alertas([noite("2026-11-06"), almoco("2026-11-07")]), []);
});

test("descanso: turnos que se atropelam viram uma frase que dá para entender", () => {
  const a = alertas([{ data: "2026-11-10", inicio: "22:00", fim: "08:00" }, { data: "2026-11-11", inicio: "06:00", fim: "12:00" }]);
  assert.equal(a[0]!.tipo, "entre_jornadas");
  assert.match(a[0]!.texto, /os horários se atropelam/);
});

test("descanso: 44h é o limite — seis noites de 8h (com 1h de intervalo) dão 42h e passam", () => {
  const seis = Array.from({ length: 6 }, (_, i) => noite(somarDias(SEMANA, i)));
  assert.deepEqual(tipos(alertas(seis)), []);
});

test("descanso: mais de 44h na semana avisa, com a conta feita", () => {
  // Seis dias de 10h (9h depois do intervalo) = 54h.
  const longos = Array.from({ length: 6 }, (_, i) => ({ data: somarDias(SEMANA, i), inicio: "16:00", fim: "02:00" }));
  const a = alertas(longos).filter((x) => x.tipo === "horas_da_semana");
  assert.equal(a.length, 1);
  assert.match(a[0]!.texto, /Bia está com 54h na semana/);
  assert.match(a[0]!.texto, /44h/);
});

test("descanso: 44h em ponto passa; turno curto não perde intervalo; minutos aparecem", () => {
  // Onze turnos de 4h = 44h exatas, sem desconto (nenhum passa de 6h).
  const curtos = [0, 1, 2, 3, 4].flatMap((i) => [almoco(somarDias(SEMANA, i)), { data: somarDias(SEMANA, i), inicio: "18:00", fim: "22:00" }]);
  assert.deepEqual(tipos(alertas([...curtos, almoco("2026-11-14")])), []);
  const a = alertas([...curtos, { data: "2026-11-14", inicio: "11:00", fim: "15:30" }]);
  assert.match(a.find((x) => x.tipo === "horas_da_semana")!.texto, /44h30 na semana/);
});

test("descanso: as horas contam pelo dia em que o turno começa", () => {
  // O domingo passado à noite (que acaba na segunda) não entra na conta desta semana…
  const base = Array.from({ length: 5 }, (_, i) => ({ data: somarDias(SEMANA, i), inicio: "14:00", fim: "23:00" })); // 5 × 8h = 40h
  assert.deepEqual(tipos(alertas([{ data: "2026-11-08", inicio: "20:00", fim: "06:00" }, ...base])).includes("horas_da_semana"), false);
  // …e o deste domingo, que acaba na segunda que vem, entra inteiro: 40h + 9h.
  const a = alertas([...base, { data: "2026-11-15", inicio: "20:00", fim: "06:00" }]);
  assert.match(a.find((x) => x.tipo === "horas_da_semana")!.texto, /49h na semana/);
});

test("descanso: menor de 18 depois das 22h avisa; de dia, não", () => {
  const nascimento = "2009-06-20"; // 17 anos em novembro de 2026
  assert.deepEqual(alertas([almoco("2026-11-12")], nascimento), []);
  // Termina às 22h em ponto: ainda pode.
  assert.deepEqual(alertas([{ data: "2026-11-12", inicio: "16:00", fim: "22:00" }], nascimento), []);
  const a = alertas([{ data: "2026-11-12", inicio: "16:00", fim: "22:30" }], nascimento);
  assert.deepEqual(tipos(a), ["menor_a_noite"]);
  assert.match(a[0]!.texto, /Bia tem 17 anos e está no turno de qui 12\/11 \(16h → 22h30\)/);
  // O turno que vira a noite e o que começa de madrugada também.
  assert.deepEqual(tipos(alertas([noite("2026-11-12")], nascimento)), ["menor_a_noite"]);
  assert.deepEqual(tipos(alertas([{ data: "2026-11-12", inicio: "04:00", fim: "10:00" }], nascimento)), ["menor_a_noite"]);
  assert.deepEqual(alertas([{ data: "2026-11-12", inicio: "05:00", fim: "11:00" }], nascimento), []);
});

test("descanso: a idade é a do dia do turno, e sem nascimento não se supõe nada", () => {
  // Faz 18 na quinta 12/11: quarta ainda é menor, quinta já não.
  const a = alertas([noite("2026-11-11"), noite("2026-11-12")], "2008-11-12");
  assert.equal(a.filter((x) => x.tipo === "menor_a_noite").length, 1);
  assert.match(a[0]!.texto, /qua 11\/11/);
  assert.deepEqual(alertas([noite("2026-11-12")], null), []);
  assert.deepEqual(alertas([noite("2026-11-12")], "sem data"), []);
  assert.deepEqual(alertas([noite("2026-11-12")], "1990-01-01"), []);
});

test("descanso: horário ilegível fica de fora em vez de derrubar a conta", () => {
  assert.deepEqual(alertas([{ data: "2026-11-12", inicio: "", fim: "" }, { data: "x", inicio: "18:00", fim: "02:00" }]), []);
});
