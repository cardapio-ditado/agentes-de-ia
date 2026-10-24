import { db, ehMigracaoPendente } from "./supabase.js";
import { ErroDoRh } from "./rh.js";
import { minutosDoTurno } from "./rhJornada.js";

/**
 * RH — Fase 5: a gorjeta do turno, rateada e guardada.
 *
 * O fim da noite num bar é sempre a mesma cena: alguém soma o serviço na
 * calculadora do celular, divide de cabeça e anota num papel. No dia
 * seguinte ninguém lembra quanto foi nem quem estava — e discussão sobre
 * gorjeta é das que mais azedam equipe.
 *
 * O valor total é DIGITADO À MÃO de propósito: assim a casa que não tem o
 * CMV contratado usa a gorjeta do mesmo jeito. Nenhum módulo depende do
 * outro.
 *
 * O que este arquivo entrega de verdade é a conta fechando: a soma das
 * cotas é exatamente o valor lançado, sem centavo sumindo nem sobrando.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

function falhar(status: number, contexto: string, mensagem: string): never {
  if (ehMigracaoPendente(mensagem)) {
    throw new ErroDoRh(
      503,
      `${contexto}: o banco ainda não recebeu a migração da gorjeta. Rode o SQL e tente de novo.`,
    );
  }
  throw new ErroDoRh(status, `${contexto}: ${mensagem}`);
}

export const CRITERIOS = [
  { id: "igual", nome: "Igual para todos" },
  { id: "peso", nome: "Por peso da função" },
  { id: "horas", nome: "Pelas horas da escala" },
  { id: "venda", nome: "Por venda individual" },
] as const;

const IDS_DE_CRITERIO = new Set<string>(CRITERIOS.map((c) => c.id));

export interface Participante {
  atendente_id: string;
  nome: string;
  funcao: string | null;
  peso: number;
  minutos: number;
  /** Venda própria no turno. Só entra na conta no critério por venda. */
  venda?: number;
}

/**
 * A conta da gorjeta, do faturamento até o bolso.
 *
 *   base de venda  ×  % de serviço  =  arrecadado
 *   arrecadado     ×  % de repasse  =  repassado (é isto que se divide)
 *
 * A diferença entre arrecadado e repassado fica com a casa — taxa de cartão,
 * quebra, o que a casa combinar. Mostrar os dois números é o que impede a
 * conversa de "então cadê o resto?".
 */
export function calcularGorjeta(params: {
  base?: unknown;
  percentualServico?: unknown;
  /** Quando a casa lança o valor fechado, sem percentual. */
  valorFechado?: unknown;
  percentualRepasse?: unknown;
}): { arrecadado: number; repassado: number; retido: number } {
  const emCentavos = (n: number) => Math.round(n * 100);

  let arrecadadoCentavos: number;
  if (params.valorFechado !== undefined && params.valorFechado !== null && params.valorFechado !== "") {
    const valor = Number(params.valorFechado);
    if (!Number.isFinite(valor) || valor < 0) throw new ErroDoRh(400, "Valor da gorjeta inválido.");
    arrecadadoCentavos = emCentavos(valor);
  } else {
    const base = Number(params.base);
    const percentual = Number(params.percentualServico);
    if (!Number.isFinite(base) || base < 0) throw new ErroDoRh(400, "Informe a venda do turno.");
    if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
      throw new ErroDoRh(400, "O percentual de serviço precisa estar entre 0 e 100.");
    }
    arrecadadoCentavos = Math.round(emCentavos(base) * (percentual / 100));
  }

  const repasse = params.percentualRepasse === undefined || params.percentualRepasse === null || params.percentualRepasse === ""
    ? 100
    : Number(params.percentualRepasse);
  if (!Number.isFinite(repasse) || repasse < 0 || repasse > 100) {
    throw new ErroDoRh(400, "O percentual repassado precisa estar entre 0 e 100.");
  }

  const repassadoCentavos = Math.round(arrecadadoCentavos * (repasse / 100));
  return {
    arrecadado: arrecadadoCentavos / 100,
    repassado: repassadoCentavos / 100,
    retido: (arrecadadoCentavos - repassadoCentavos) / 100,
  };
}

export interface Cota extends Participante {
  valor: number;
}

// ============================================================
// O rateio — conta pura, sem banco
// ============================================================

/**
 * Reparte um valor entre participantes, em centavos, sem perder nada.
 *
 * Dividir 100 por 3 dá 33,333… e três pagamentos de 33,33 somam 99,99. O
 * centavo que falta não pode sumir nem ser dado a quem o código listar
 * primeiro: vai para quem ficou com a maior sobra na divisão (método da
 * maior sobra), e o desempate é pelo nome, para a conta ser a mesma toda vez
 * que for refeita.
 *
 * Quem tem peso zero ou não trabalhou minuto nenhum não entra na divisão —
 * mas continua na lista, com zero, para a tela poder mostrar que ele estava
 * lá e por que não recebeu.
 */
export function ratear(params: {
  valor: number;
  criterio: string;
  participantes: Participante[];
}): Cota[] {
  const centavosTotais = Math.round((Number(params.valor) || 0) * 100);
  if (centavosTotais < 0) throw new ErroDoRh(400, "O valor da gorjeta não pode ser negativo.");

  const fatia = (p: Participante): number => {
    if (params.criterio === "peso") return Math.max(0, Number(p.peso) || 0);
    if (params.criterio === "horas") return Math.max(0, Number(p.minutos) || 0);
    // Por venda individual: quem vendeu mais leva mais, que é a comissão de
    // garçom como a maioria das casas combina.
    if (params.criterio === "venda") return Math.max(0, Number(p.venda) || 0);
    return 1;
  };

  const soma = params.participantes.reduce((t, p) => t + fatia(p), 0);
  if (soma <= 0 || centavosTotais === 0) {
    return params.participantes.map((p) => ({ ...p, valor: 0 }));
  }

  const exatos = params.participantes.map((p) => ({
    pessoa: p,
    exato: (centavosTotais * fatia(p)) / soma,
  }));

  const cotas = exatos.map((e) => ({ ...e, centavos: Math.floor(e.exato) }));
  let sobra = centavosTotais - cotas.reduce((t, c) => t + c.centavos, 0);

  // A sobra vai para as maiores frações; empate decide pelo nome, para o
  // mesmo lançamento dar sempre o mesmo resultado.
  const fila = [...cotas]
    .filter((c) => c.exato > 0)
    .sort((a, b) => {
      const fracaoA = a.exato - Math.floor(a.exato);
      const fracaoB = b.exato - Math.floor(b.exato);
      if (fracaoB !== fracaoA) return fracaoB - fracaoA;
      return a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR");
    });

  for (let i = 0; sobra > 0 && fila.length > 0; i += 1, sobra -= 1) {
    fila[i % fila.length]!.centavos += 1;
  }

  return cotas.map((c) => ({ ...c.pessoa, valor: c.centavos / 100 }));
}

// ============================================================
// Peso por função
// ============================================================

export async function listarPesos(venueId: string): Promise<Array<{ id: string; funcao: string; peso: number }>> {
  const { data, error } = await cliente()
    .from("rh_pesos")
    .select("id, funcao, peso")
    .eq("venue_id", venueId)
    .order("funcao", { ascending: true });
  if (error) falhar(500, "Falha ao listar os pesos", error.message);
  return ((data ?? []) as Array<{ id: string; funcao: string; peso: string | number }>).map((p) => ({
    ...p,
    peso: Number(p.peso),
  }));
}

export async function definirPeso(params: {
  venueId: string;
  funcao: string;
  peso: unknown;
}): Promise<{ funcao: string; peso: number }> {
  const funcao = String(params.funcao ?? "").trim();
  if (!funcao) throw new ErroDoRh(400, "Diga a função que vai ter peso próprio.");
  const peso = Number(params.peso);
  if (!Number.isFinite(peso) || peso < 0) throw new ErroDoRh(400, "O peso precisa ser um número maior ou igual a zero.");

  const { error } = await cliente()
    .from("rh_pesos")
    .upsert({ venue_id: params.venueId, funcao, peso } as never, { onConflict: "venue_id,funcao" });
  if (error) falhar(500, "Falha ao salvar o peso", error.message);
  return { funcao, peso };
}

export async function apagarPeso(params: { venueId: string; id: string }): Promise<{ apagado: boolean }> {
  const { error } = await cliente().from("rh_pesos").delete().eq("venue_id", params.venueId).eq("id", params.id);
  if (error) falhar(500, "Falha ao apagar o peso", error.message);
  return { apagado: true };
}

// ============================================================
// Quem estava no turno
// ============================================================

/**
 * Quem entra no rateio de um turno.
 *
 * A lista sai da escala (quem estava previsto para trabalhar) somada a quem
 * bateu ponto naquele dia — porque em bar entra gente de última hora, e
 * quem trabalhou tem direito mesmo sem estar na grade.
 */
export async function participantesDoTurno(params: {
  venueId: string;
  dia: string;
  turnoId?: string | null;
  timezone: string;
}): Promise<Participante[]> {
  const [{ data: escala, error }, { data: turnos }, { data: pessoas }, pesos] = await Promise.all([
    cliente()
      .from("rh_escala")
      .select("atendente_id, turno_id, situacao, funcao")
      .eq("venue_id", params.venueId)
      .eq("data", params.dia),
    cliente().from("rh_turnos").select("id, inicio, fim").eq("venue_id", params.venueId),
    cliente().from("pesquisa_atendentes").select("id, nome, apelido, funcao").eq("venue_id", params.venueId),
    listarPesos(params.venueId),
  ]);
  if (error) falhar(500, "Falha ao ler a escala do turno", error.message);

  const pesoDa = new Map(pesos.map((p) => [p.funcao.toLowerCase(), p.peso]));
  const cadastro = new Map(
    ((pessoas ?? []) as Array<{ id: string; nome: string; apelido: string | null; funcao: string | null }>).map((p) => [
      p.id,
      p,
    ]),
  );

  const duracaoDo = new Map(
    ((turnos ?? []) as Array<{ id: string; inicio: string; fim: string }>).map((t) => [t.id, minutosDoTurno(t.inicio, t.fim)]),
  );

  const doTurno = ((escala ?? []) as Array<{
    atendente_id: string;
    turno_id: string | null;
    situacao: string;
    funcao: string | null;
  }>).filter((e) => e.situacao === "trabalha" && (!params.turnoId || e.turno_id === params.turnoId));

  const ids = new Set(doTurno.map((e) => e.atendente_id));
  const funcaoNaEscala = new Map(doTurno.map((e) => [e.atendente_id, e.funcao]));
  // As horas de cada um são as do turno escalado (somadas, se fez dois).
  const minutosDe = new Map<string, number>();
  for (const e of doTurno) {
    minutosDe.set(e.atendente_id, (minutosDe.get(e.atendente_id) ?? 0) + (e.turno_id ? (duracaoDo.get(e.turno_id) ?? 0) : 0));
  }

  const lista: Participante[] = [...ids].map((id) => {
    const pessoa = cadastro.get(id);
    const funcao = funcaoNaEscala.get(id) || pessoa?.funcao || null;
    return {
      atendente_id: id,
      nome: pessoa?.apelido || pessoa?.nome || "—",
      funcao,
      peso: funcao ? (pesoDa.get(funcao.toLowerCase()) ?? 1) : 1,
      minutos: minutosDe.get(id) ?? 0,
    };
  });

  lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return lista;
}

// ============================================================
// Lançar, listar e apagar
// ============================================================

export interface GorjetaGravada {
  id: string;
  dia: string;
  turno_id: string | null;
  /** O total arrecadado de serviço. */
  valor: number;
  /** O que foi dividido entre a equipe. */
  valor_repassado: number;
  base_venda: number | null;
  percentual_servico: number | null;
  percentual_repasse: number;
  criterio: string;
  observacao: string | null;
  criado_por: string | null;
  cotas: Cota[];
}

const COLUNAS_DA_GORJETA =
  "id, dia, turno_id, valor, valor_repassado, base_venda, percentual_servico, percentual_repasse, criterio, observacao, criado_por";

export async function lancarGorjeta(params: {
  venueId: string;
  dia: string;
  turnoId?: string | null;
  /** Valor fechado. Quando vem, manda sobre base × percentual. */
  valor?: unknown;
  baseVenda?: unknown;
  percentualServico?: unknown;
  percentualRepasse?: unknown;
  criterio: string;
  observacao?: unknown;
  timezone: string;
  quem: string;
  /** Quando a tela manda a lista já ajustada à mão (venda individual). */
  participantes?: Participante[];
}): Promise<GorjetaGravada> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(params.dia))) throw new ErroDoRh(400, "Data inválida.");
  if (!IDS_DE_CRITERIO.has(params.criterio)) throw new ErroDoRh(400, "Critério de rateio desconhecido.");

  const conta = calcularGorjeta({
    valorFechado: params.valor,
    base: params.baseVenda,
    percentualServico: params.percentualServico,
    percentualRepasse: params.percentualRepasse,
  });
  if (conta.arrecadado <= 0) throw new ErroDoRh(400, "Informe o valor arrecadado ou a venda do turno.");

  const participantes =
    params.participantes && params.participantes.length > 0
      ? params.participantes
      : await participantesDoTurno({
          venueId: params.venueId,
          dia: params.dia,
          turnoId: params.turnoId ?? null,
          timezone: params.timezone,
        });

  if (participantes.length === 0) {
    throw new ErroDoRh(400, "Ninguém escalado nem com ponto batido neste turno — não há entre quem dividir.");
  }
  if (params.criterio === "venda" && !participantes.some((p) => Number(p.venda) > 0)) {
    throw new ErroDoRh(400, "No rateio por venda individual, informe quanto cada um vendeu.");
  }

  // Divide o REPASSADO, não o arrecadado: o que fica com a casa não entra no
  // bolo de ninguém.
  const cotas = ratear({ valor: conta.repassado, criterio: params.criterio, participantes });

  const { data, error } = await cliente()
    .from("rh_gorjetas")
    .upsert(
      {
        venue_id: params.venueId,
        dia: params.dia,
        turno_id: params.turnoId ?? null,
        valor: conta.arrecadado,
        valor_repassado: conta.repassado,
        base_venda: params.baseVenda === undefined || params.baseVenda === null || params.baseVenda === "" ? null : Number(params.baseVenda),
        percentual_servico:
          params.percentualServico === undefined || params.percentualServico === null || params.percentualServico === ""
            ? null
            : Number(params.percentualServico),
        percentual_repasse:
          params.percentualRepasse === undefined || params.percentualRepasse === null || params.percentualRepasse === ""
            ? 100
            : Number(params.percentualRepasse),
        criterio: params.criterio,
        observacao: String(params.observacao ?? "").trim() || null,
        criado_por: params.quem,
      } as never,
      { onConflict: "venue_id,dia,turno_id" },
    )
    .select(COLUNAS_DA_GORJETA)
    .single();
  if (error) falhar(500, "Falha ao lançar a gorjeta", error.message);

  const gorjeta = data as Record<string, unknown> & { id: string };

  // Relançar o mesmo turno refaz a divisão: as cotas velhas saem antes.
  await cliente().from("rh_gorjeta_cotas").delete().eq("venue_id", params.venueId).eq("gorjeta_id", gorjeta.id);

  const { error: erroCotas } = await cliente()
    .from("rh_gorjeta_cotas")
    .insert(
      cotas.map((c) => ({
        venue_id: params.venueId,
        gorjeta_id: gorjeta.id,
        atendente_id: c.atendente_id,
        peso: c.peso,
        minutos: c.minutos,
        venda: Number(c.venda) || 0,
        valor: c.valor,
      })) as never,
    );
  if (erroCotas) falhar(500, "Falha ao gravar o rateio", erroCotas.message);

  return { ...emGorjeta(gorjeta), cotas };
}

/** Os números do banco chegam como texto no numeric; aqui viram número. */
function emGorjeta(linha: Record<string, unknown>): Omit<GorjetaGravada, "cotas"> {
  return {
    id: String(linha.id),
    dia: String(linha.dia),
    turno_id: (linha.turno_id as string | null) ?? null,
    valor: Number(linha.valor),
    valor_repassado: linha.valor_repassado === null || linha.valor_repassado === undefined ? Number(linha.valor) : Number(linha.valor_repassado),
    base_venda: linha.base_venda === null || linha.base_venda === undefined ? null : Number(linha.base_venda),
    percentual_servico:
      linha.percentual_servico === null || linha.percentual_servico === undefined ? null : Number(linha.percentual_servico),
    percentual_repasse: linha.percentual_repasse === undefined || linha.percentual_repasse === null ? 100 : Number(linha.percentual_repasse),
    criterio: String(linha.criterio),
    observacao: (linha.observacao as string | null) ?? null,
    criado_por: (linha.criado_por as string | null) ?? null,
  };
}

export async function listarGorjetas(params: {
  venueId: string;
  de: string;
  ate: string;
}): Promise<GorjetaGravada[]> {
  const { data, error } = await cliente()
    .from("rh_gorjetas")
    .select(COLUNAS_DA_GORJETA)
    .eq("venue_id", params.venueId)
    .gte("dia", params.de)
    .lte("dia", params.ate)
    .order("dia", { ascending: false });
  if (error) falhar(500, "Falha ao listar as gorjetas", error.message);

  const gorjetas = (data ?? []) as Array<Record<string, unknown> & { id: string }>;
  if (gorjetas.length === 0) return [];

  const [{ data: cotas }, { data: pessoas }] = await Promise.all([
    cliente()
      .from("rh_gorjeta_cotas")
      .select("gorjeta_id, atendente_id, peso, minutos, venda, valor")
      .in("gorjeta_id", gorjetas.map((g) => g.id)),
    cliente().from("pesquisa_atendentes").select("id, nome, apelido, funcao").eq("venue_id", params.venueId),
  ]);

  const nomes = new Map(
    ((pessoas ?? []) as Array<{ id: string; nome: string; apelido: string | null; funcao: string | null }>).map((p) => [
      p.id,
      p,
    ]),
  );

  const porGorjeta = new Map<string, Cota[]>();
  for (const c of (cotas ?? []) as Array<{
    gorjeta_id: string;
    atendente_id: string;
    peso: string | number;
    minutos: number;
    venda: string | number | null;
    valor: string | number;
  }>) {
    const pessoa = nomes.get(c.atendente_id);
    const lista = porGorjeta.get(c.gorjeta_id) ?? [];
    lista.push({
      atendente_id: c.atendente_id,
      nome: pessoa?.apelido || pessoa?.nome || "—",
      funcao: pessoa?.funcao ?? null,
      peso: Number(c.peso),
      minutos: c.minutos,
      venda: Number(c.venda) || 0,
      valor: Number(c.valor),
    });
    porGorjeta.set(c.gorjeta_id, lista);
  }

  return gorjetas.map((g) => ({
    ...emGorjeta(g),
    cotas: (porGorjeta.get(g.id) ?? []).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
  }));
}

export async function apagarGorjeta(params: { venueId: string; id: string }): Promise<{ apagado: boolean }> {
  const { error } = await cliente()
    .from("rh_gorjetas")
    .delete()
    .eq("venue_id", params.venueId)
    .eq("id", params.id);
  if (error) falhar(500, "Falha ao apagar o fechamento", error.message);
  return { apagado: true };
}
