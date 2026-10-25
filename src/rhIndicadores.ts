import { randomBytes } from "node:crypto";
import { db, ehMigracaoPendente } from "./supabase.js";
import { ErroDoRh } from "./rh.js";
import { hojeNaCasa } from "./fuso.js";

/**
 * RH — Rodada D: o clima da equipe, os números de gente, quem pode estar
 * para sair, e a contratação com a lista de extras.
 *
 * Tudo aqui é para o dono enxergar o que só aparecia quando já era tarde:
 * a equipe insatisfeita (clima), a rotatividade custando caro (indicadores),
 * o bom funcionário dando sinais (risco de saída) e o sábado sem gente
 * porque ninguém guardou o telefone do extra que foi bem (banco de extras).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

function falhar(contexto: string, mensagem: string): never {
  if (ehMigracaoPendente(mensagem)) {
    throw new ErroDoRh(503, `${contexto}: o banco ainda não recebeu a migração do RH. Rode o SQL e tente de novo.`);
  }
  throw new ErroDoRh(500, `${contexto}: ${mensagem}`);
}

const DIA_MS = 86_400_000;
const somarDias = (iso: string, dias: number) =>
  new Date(new Date(`${iso}T12:00:00Z`).getTime() + dias * DIA_MS).toISOString().slice(0, 10);
const diasEntre = (de: string, ate: string) =>
  Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / DIA_MS);

// ============================================================
// Clima (anônimo)
// ============================================================

export const PERGUNTAS_DO_CLIMA = [
  { id: "lideranca", texto: "A liderança me trata com respeito e me ajuda quando preciso." },
  { id: "ambiente", texto: "O clima entre a equipe é bom." },
  { id: "reconhecimento", texto: "Meu trabalho é reconhecido." },
  { id: "carga", texto: "A carga de trabalho é justa para a minha função." },
] as const;

/** Menos que isso, o resultado não aparece: com duas respostas dá para adivinhar quem foi. */
export const MINIMO_DE_RESPOSTAS = 3;

/** eNPS: % de 9–10 menos % de 0–6. Pura. */
export function calcularEnps(notas: number[]): number | null {
  if (!notas.length) return null;
  const promotores = notas.filter((n) => n >= 9).length;
  const detratores = notas.filter((n) => n <= 6).length;
  return Math.round(((promotores - detratores) / notas.length) * 100);
}

/**
 * Abre a pesquisa do mês e manda um link para cada pessoa ativa com
 * WhatsApp na ficha. O link é individual (vota uma vez), a resposta não.
 */
export async function abrirClima(params: { venueId: string; casa: string; timezone: string; quem: string; base: string }) {
  const mes = hojeNaCasa(params.timezone).slice(0, 7);
  let { data: rodada } = await cliente().from("rh_clima_rodadas").select("id").eq("venue_id", params.venueId).eq("mes", mes).maybeSingle();
  if (!rodada) {
    const r = await cliente().from("rh_clima_rodadas").insert({ venue_id: params.venueId, mes, criada_por: params.quem }).select("id").single();
    if (r.error) falhar("Falha ao abrir a pesquisa de clima", r.error.message);
    rodada = r.data;
  }
  const [{ data: pessoas }, { data: fichas }] = await Promise.all([
    cliente().from("pesquisa_atendentes").select("id, nome, apelido").eq("venue_id", params.venueId).eq("ativo", true),
    cliente().from("rh_fichas").select("atendente_id, telefone, desligamento").eq("venue_id", params.venueId),
  ]);
  const telefoneDe = new Map(((fichas ?? []) as Array<{ atendente_id: string; telefone: string | null; desligamento: string | null }>).filter((f) => !f.desligamento).map((f) => [f.atendente_id, f.telefone]));
  const { normalizarTelefone, inserirAvisos } = await import("./notifications.js");

  const semTelefone: string[] = [];
  let enviados = 0;
  for (const p of (pessoas ?? []) as Array<{ id: string; nome: string; apelido: string | null }>) {
    const telefone = normalizarTelefone(String(telefoneDe.get(p.id) ?? ""));
    if (!telefone) {
      semTelefone.push(p.apelido || p.nome);
      continue;
    }
    const token = randomBytes(18).toString("base64url");
    const { error } = await cliente().from("rh_clima_convites").insert({ rodada_id: rodada.id, token });
    if (error) continue;
    await inserirAvisos({
      venue_id: params.venueId,
      channel: "whatsapp",
      destination: telefone,
      papel: "administrativo",
      template: "rh_clima",
      body:
        `Oi, ${(p.apelido || p.nome).split(" ")[0]}! A ${params.casa} quer saber como está sendo trabalhar aqui. ` +
        `São 5 perguntas, leva 1 minuto, e é ANÔNIMO — ninguém fica sabendo o que você respondeu:\n${params.base}/clima/${token}`,
    });
    enviados += 1;
  }
  return { mes, enviados, sem_telefone: semTelefone };
}

export async function abrirConviteDoClima(token: string) {
  const { data } = await cliente()
    .from("rh_clima_convites")
    .select("id, usado_em, rh_clima_rodadas(id, mes, venue_id, venues(name))")
    .eq("token", token)
    .maybeSingle();
  if (!data) throw new ErroDoRh(404, "Este link não existe.");
  if (data.usado_em) throw new ErroDoRh(410, "Você já respondeu esta pesquisa. Obrigado!");
  return { convite_id: data.id, rodada_id: data.rh_clima_rodadas.id, mes: data.rh_clima_rodadas.mes, casa: data.rh_clima_rodadas.venues?.name ?? "" };
}

export async function responderClima(params: { token: string; enps: unknown; notas: unknown; comentario: unknown }) {
  const c = await abrirConviteDoClima(params.token);
  const enps = Math.round(Number(params.enps));
  if (!(enps >= 0 && enps <= 10)) throw new ErroDoRh(400, "Escolha uma nota de 0 a 10.");
  const brutas = (params.notas ?? {}) as Record<string, unknown>;
  const notas: Record<string, number> = {};
  for (const p of PERGUNTAS_DO_CLIMA) {
    const n = Math.round(Number(brutas[p.id]));
    if (n >= 1 && n <= 5) notas[p.id] = n;
  }
  // Marca o convite ANTES de gravar: se gravar falhar, a pessoa pede outro
  // link; o contrário deixaria votar duas vezes.
  const { data: marcado } = await cliente().from("rh_clima_convites").update({ usado_em: new Date().toISOString() }).eq("id", c.convite_id).is("usado_em", null).select("id");
  if (!marcado?.length) throw new ErroDoRh(410, "Você já respondeu esta pesquisa. Obrigado!");
  const { error } = await cliente().from("rh_clima_respostas").insert({
    rodada_id: c.rodada_id,
    enps,
    notas,
    comentario: String(params.comentario ?? "").trim().slice(0, 1000) || null,
  });
  if (error) falhar("Falha ao guardar a resposta", error.message);
  return { ok: true };
}

export async function resultadoDoClima(venueId: string) {
  const { data: rodadas } = await cliente().from("rh_clima_rodadas").select("id, mes").eq("venue_id", venueId).order("mes", { ascending: false }).limit(6);
  const lista = (rodadas ?? []) as Array<{ id: string; mes: string }>;
  if (!lista.length) return [];
  const [{ data: respostas }, { data: convites }] = await Promise.all([
    cliente().from("rh_clima_respostas").select("rodada_id, enps, notas, comentario").in("rodada_id", lista.map((r) => r.id)),
    cliente().from("rh_clima_convites").select("rodada_id, usado_em").in("rodada_id", lista.map((r) => r.id)),
  ]);
  return lista.map((r) => {
    const deste = ((respostas ?? []) as Array<{ rodada_id: string; enps: number; notas: Record<string, number>; comentario: string | null }>).filter((x) => x.rodada_id === r.id);
    const convidados = ((convites ?? []) as Array<{ rodada_id: string }>).filter((x) => x.rodada_id === r.id).length;
    const visivel = deste.length >= MINIMO_DE_RESPOSTAS;
    const media = (id: string) => {
      const v = deste.map((x) => x.notas?.[id]).filter((n): n is number => typeof n === "number");
      return v.length ? Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 10) / 10 : null;
    };
    return {
      mes: r.mes,
      convidados,
      respostas: deste.length,
      visivel,
      enps: visivel ? calcularEnps(deste.map((x) => x.enps)) : null,
      notas: visivel ? Object.fromEntries(PERGUNTAS_DO_CLIMA.map((p) => [p.id, media(p.id)])) : null,
      // Os comentários embaralhados: a ordem de chegada também identifica.
      comentarios: visivel ? deste.map((x) => x.comentario).filter(Boolean).sort(() => Math.random() - 0.5) : [],
    };
  });
}

// ============================================================
// Sinais de saída
// ============================================================

export interface EntradaDoRisco {
  faltas_e_atrasos_30d: number;
  faltas_e_atrasos_30d_antes: number;
  registro_formal_60d: number;
  ultima_avaliacao: number | null;
  dias_de_casa: number | null;
  conversa_30_atrasada: boolean;
  nota_cliente_30d: number | null;
  nota_cliente_antes: number | null;
}

/** Os sinais de que alguém pode estar para sair. Pura: testável sem banco. */
export function sinaisDeSaida(e: EntradaDoRisco): { nivel: "alto" | "atencao" | null; sinais: string[] } {
  const sinais: string[] = [];
  if (e.faltas_e_atrasos_30d >= 2 && e.faltas_e_atrasos_30d > e.faltas_e_atrasos_30d_antes) {
    sinais.push(`faltas e atrasos subindo (${e.faltas_e_atrasos_30d} no último mês, ${e.faltas_e_atrasos_30d_antes} no anterior)`);
  }
  if (e.registro_formal_60d > 0) sinais.push("advertência ou suspensão nos últimos 60 dias");
  if (e.ultima_avaliacao !== null && e.ultima_avaliacao < 3) sinais.push(`última avaliação baixa (${String(e.ultima_avaliacao).replace(".", ",")} de 5)`);
  if (e.dias_de_casa !== null && e.dias_de_casa < 90 && e.conversa_30_atrasada) sinais.push("novato sem a conversa de 30 dias");
  if (e.nota_cliente_30d !== null && e.nota_cliente_antes !== null && e.nota_cliente_antes - e.nota_cliente_30d >= 0.5) {
    sinais.push(`nota do cliente caindo (${String(e.nota_cliente_antes).replace(".", ",")} → ${String(e.nota_cliente_30d).replace(".", ",")})`);
  }
  return { nivel: sinais.length >= 2 ? "alto" : sinais.length === 1 ? "atencao" : null, sinais };
}

// ============================================================
// Indicadores
// ============================================================

export async function indicadoresDoRh(params: { venueId: string; timezone: string }) {
  const { venueId } = params;
  const hoje = hojeNaCasa(params.timezone);
  const umAno = somarDias(hoje, -365);
  const sessenta = somarDias(hoje, -60);
  const trinta = somarDias(hoje, -30);

  const [{ data: pessoas }, { data: fichas }, { data: escala }, { data: ocorrencias }, { data: avaliacoes }, { data: notasCliente }, { data: integracao }] = await Promise.all([
    cliente().from("pesquisa_atendentes").select("id, nome, apelido, funcao, ativo").eq("venue_id", venueId),
    cliente().from("rh_fichas").select("atendente_id, admissao, desligamento, motivo_desligamento, salario").eq("venue_id", venueId),
    cliente().from("rh_escala").select("atendente_id, data, situacao").eq("venue_id", venueId).gte("data", somarDias(hoje, -180)).lte("data", hoje).in("situacao", ["falta", "atestado"]),
    cliente().from("rh_ocorrencias").select("atendente_id, dia, tipo").eq("venue_id", venueId).gte("dia", somarDias(hoje, -180)),
    cliente().from("rh_avaliacoes").select("atendente_id, dia, media").eq("venue_id", venueId).order("dia", { ascending: false }),
    cliente().from("pesquisa_respostas").select("atendente_id, atendente_nota, created_at").eq("venue_id", venueId).not("atendente_id", "is", null).gte("created_at", somarDias(hoje, -90)),
    cliente().from("rh_integracao").select("atendente_id, etapa").eq("venue_id", venueId).eq("etapa", "dia30_conversa"),
  ]);
  const listaFichas = (fichas ?? []) as Array<{ atendente_id: string; admissao: string | null; desligamento: string | null; motivo_desligamento: string | null; salario: number | null }>;
  const fichaDe = new Map(listaFichas.map((f) => [f.atendente_id, f]));
  const ativos = ((pessoas ?? []) as Array<{ id: string; nome: string; apelido: string | null; funcao: string | null; ativo: boolean }>).filter((p) => p.ativo && !fichaDe.get(p.id)?.desligamento);

  // Mês a mês: quem estava, quem entrou, quem saiu.
  const meses: Array<{ mes: string; ativos: number; admissoes: number; desligamentos: number; turnover: number | null; faltas: number; atrasos: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const ref = new Date(`${hoje.slice(0, 7)}-15T12:00:00Z`);
    ref.setUTCMonth(ref.getUTCMonth() - i);
    const mes = ref.toISOString().slice(0, 7);
    const inicio = `${mes}-01`;
    const fim = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
    const estavam = listaFichas.filter((f) => f.admissao && f.admissao <= fim && (!f.desligamento || f.desligamento > fim)).length;
    const admissoes = listaFichas.filter((f) => f.admissao && f.admissao >= inicio && f.admissao <= fim).length;
    const desligamentos = listaFichas.filter((f) => f.desligamento && f.desligamento >= inicio && f.desligamento <= fim).length;
    const faltas =
      ((escala ?? []) as Array<{ data: string; situacao: string }>).filter((e) => e.situacao === "falta" && e.data >= inicio && e.data <= fim).length +
      ((ocorrencias ?? []) as Array<{ dia: string; tipo: string }>).filter((o) => o.tipo === "falta" && o.dia >= inicio && o.dia <= fim).length;
    const atrasos = ((ocorrencias ?? []) as Array<{ dia: string; tipo: string }>).filter((o) => o.tipo === "atraso" && o.dia >= inicio && o.dia <= fim).length;
    meses.push({ mes, ativos: estavam, admissoes, desligamentos, turnover: estavam ? Math.round((desligamentos / estavam) * 1000) / 10 : null, faltas, atrasos });
  }

  const saidas12m = listaFichas.filter((f) => f.desligamento && f.desligamento >= umAno);
  const saidasNaExperiencia = saidas12m.filter((f) => f.admissao && diasEntre(f.admissao, f.desligamento!) <= 90).length;
  const motivos = new Map<string, number>();
  for (const f of saidas12m) {
    const m = (f.motivo_desligamento ?? "Sem motivo anotado").trim() || "Sem motivo anotado";
    motivos.set(m, (motivos.get(m) ?? 0) + 1);
  }
  const salarios = listaFichas.map((f) => Number(f.salario)).filter((n) => n > 0);
  const salarioMedio = salarios.length ? salarios.reduce((s, n) => s + n, 0) / salarios.length : null;
  const tempos = ativos.map((p) => fichaDe.get(p.id)?.admissao).filter((a): a is string => Boolean(a)).map((a) => diasEntre(a, hoje));

  // Sinais de saída, pessoa a pessoa.
  const conversaFeita = new Set(((integracao ?? []) as Array<{ atendente_id: string }>).map((x) => x.atendente_id));
  const ultimaAvaliacao = new Map<string, number>();
  for (const a of (avaliacoes ?? []) as Array<{ atendente_id: string; media: number }>) if (!ultimaAvaliacao.has(a.atendente_id)) ultimaAvaliacao.set(a.atendente_id, Number(a.media));
  const contar = (id: string, de: string, ate: string) =>
    ((escala ?? []) as Array<{ atendente_id: string; data: string; situacao: string }>).filter((e) => e.atendente_id === id && e.situacao === "falta" && e.data > de && e.data <= ate).length +
    ((ocorrencias ?? []) as Array<{ atendente_id: string; dia: string; tipo: string }>).filter((o) => o.atendente_id === id && (o.tipo === "falta" || o.tipo === "atraso") && o.dia > de && o.dia <= ate).length;
  const mediaCliente = (id: string, de: string, ate: string) => {
    const v = ((notasCliente ?? []) as Array<{ atendente_id: string; atendente_nota: number; created_at: string }>)
      .filter((r) => r.atendente_id === id && r.created_at.slice(0, 10) > de && r.created_at.slice(0, 10) <= ate)
      .map((r) => r.atendente_nota);
    return v.length >= 3 ? Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 10) / 10 : null;
  };
  const risco = ativos
    .map((p) => {
      const admissao = fichaDe.get(p.id)?.admissao ?? null;
      const diasDeCasa = admissao ? diasEntre(admissao, hoje) : null;
      const r = sinaisDeSaida({
        faltas_e_atrasos_30d: contar(p.id, trinta, hoje),
        faltas_e_atrasos_30d_antes: contar(p.id, somarDias(trinta, -30), trinta),
        registro_formal_60d: ((ocorrencias ?? []) as Array<{ atendente_id: string; dia: string; tipo: string }>).filter((o) => o.atendente_id === p.id && (o.tipo === "advertencia" || o.tipo === "suspensao") && o.dia >= sessenta).length,
        ultima_avaliacao: ultimaAvaliacao.get(p.id) ?? null,
        dias_de_casa: diasDeCasa,
        conversa_30_atrasada: diasDeCasa !== null && diasDeCasa > 30 && !conversaFeita.has(p.id),
        nota_cliente_30d: mediaCliente(p.id, trinta, hoje),
        nota_cliente_antes: mediaCliente(p.id, somarDias(hoje, -90), trinta),
      });
      return { atendente_id: p.id, nome: p.apelido || p.nome, funcao: p.funcao, ...r };
    })
    .filter((x) => x.nivel)
    .sort((a, b) => Number(b.nivel === "alto") - Number(a.nivel === "alto") || b.sinais.length - a.sinais.length);

  return {
    na_casa: ativos.length,
    tempo_medio_de_casa_dias: tempos.length ? Math.round(tempos.reduce((s, n) => s + n, 0) / tempos.length) : null,
    saidas_12m: saidas12m.length,
    saidas_na_experiencia_12m: saidasNaExperiencia,
    turnover_12m: ativos.length ? Math.round((saidas12m.length / Math.max(1, ativos.length)) * 1000) / 10 : null,
    // Estimativa grosseira e dita como tal: cada troca custa por volta de um
    // salário (anúncio, entrevista, treino, o ritmo perdido, a rescisão).
    custo_estimado_12m: salarioMedio ? Math.round(saidas12m.length * salarioMedio) : null,
    motivos: [...motivos.entries()].map(([motivo, vezes]) => ({ motivo, vezes })).sort((a, b) => b.vezes - a.vezes).slice(0, 6),
    meses,
    risco,
  };
}

// ============================================================
// Candidatos e extras
// ============================================================

const SITUACOES = new Set(["novo", "conversando", "contratado", "nao_serve", "disponivel"]);

export function montarCandidato(campos: Record<string, unknown>) {
  const nome = String(campos.nome ?? "").trim().slice(0, 120);
  if (!nome) throw new ErroDoRh(400, "Informe o nome.");
  const tipo = campos.tipo === "extra" ? "extra" : "vaga";
  const situacao = SITUACOES.has(String(campos.situacao)) ? String(campos.situacao) : tipo === "extra" ? "disponivel" : "novo";
  const notaBruta = campos.nota === undefined || campos.nota === null || campos.nota === "" ? null : Math.round(Number(campos.nota));
  if (notaBruta !== null && !(notaBruta >= 1 && notaBruta <= 5)) throw new ErroDoRh(400, "A nota vai de 1 a 5.");
  const texto = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max) || null;
  const ultima = String(campos.ultima_vez ?? "");
  return {
    nome,
    telefone: String(campos.telefone ?? "").replace(/\D/g, "").slice(0, 13) || null,
    funcao: texto(campos.funcao, 60),
    tipo,
    situacao,
    nota: notaBruta,
    experiencia: texto(campos.experiencia, 1000),
    observacoes: texto(campos.observacoes, 1000),
    ultima_vez: /^\d{4}-\d{2}-\d{2}$/.test(ultima) ? ultima : null,
  };
}

export async function listarCandidatos(venueId: string) {
  const { data, error } = await cliente().from("rh_candidatos").select("*").eq("venue_id", venueId).order("criado_em", { ascending: false }).limit(300);
  if (error) falhar("Falha ao listar os candidatos", error.message);
  return data ?? [];
}

export async function salvarCandidato(params: { venueId: string; id?: string | null; campos: Record<string, unknown>; origem?: string }) {
  const linha = montarCandidato(params.campos);
  const consulta = params.id
    ? cliente().from("rh_candidatos").update(linha).eq("venue_id", params.venueId).eq("id", params.id)
    : cliente().from("rh_candidatos").insert({ venue_id: params.venueId, origem: params.origem ?? "painel", ...linha });
  const { data, error } = await consulta.select("*").single();
  if (error) falhar("Falha ao salvar", error.message);
  return data;
}

export async function apagarCandidato(params: { venueId: string; id: string }) {
  const { error } = await cliente().from("rh_candidatos").delete().eq("venue_id", params.venueId).eq("id", params.id);
  if (error) falhar("Falha ao apagar", error.message);
  return { apagado: true };
}
