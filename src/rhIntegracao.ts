import Anthropic from "@anthropic-ai/sdk";
import { anthropicConfig } from "./config.js";
import { db, ehMigracaoPendente } from "./supabase.js";
import { ErroDoRh, guardarDocumento } from "./rh.js";
import { hojeNaCasa } from "./fuso.js";

/**
 * RH — Rodada B: quem chega, o que aprende, e o cantinho do funcionário.
 *
 *   · INTEGRAÇÃO: as etapas dos primeiros 90 dias (dia 1, primeira semana,
 *     dia 30, 45, 60, 90). Quem entra sabe o que esperar, e o gerente não
 *     esquece a conversa do dia 30 — que é quando o novato decide se fica.
 *   · TREINAMENTOS: vídeo curto (do mentor ou da casa) e três perguntas, por
 *     função. O sistema registra quem fez e quanto acertou.
 *   · ESPAÇO DO FUNCIONÁRIO: um link fixo, mandado no WhatsApp, onde a pessoa
 *     vê a escala, a gorjeta da semana, as férias, os treinos, o próprio DISC
 *     e as avaliações já conversadas — e manda o atestado por foto.
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

// ============================================================
// Integração
// ============================================================

export interface EtapaDaIntegracao {
  id: string;
  /** Até que dia de casa a etapa deveria estar feita (o 1º dia é o 1). */
  dia: number;
  titulo: string;
  ajuda: string;
  /** Conferida sozinha pelo sistema — ninguém precisa marcar. */
  automatica?: "disc" | "avaliacao_45" | "efetivacao" | "ficha" | "treinos";
}

export const ETAPAS_DA_INTEGRACAO: EtapaDaIntegracao[] = [
  { id: "dia1_apresentacao", dia: 1, titulo: "Apresentar a casa e a equipe", ajuda: "Um tour: salão, cozinha, bar, estoque, banheiro da equipe. E o nome de cada um." },
  { id: "dia1_regras", dia: 1, titulo: "Explicar as regras da casa", ajuda: "Horário, celular, refeição, uniforme, como funciona a gorjeta, a quem pedir ajuda." },
  { id: "dia1_uniforme", dia: 1, titulo: "Entregar uniforme e o que for preciso", ajuda: "Uniforme, crachá, armário, senha do que for usar." },
  { id: "dia1_padrinho", dia: 1, titulo: "Apresentar o padrinho", ajuda: "O colega experiente que acompanha a pessoa nas primeiras semanas. Anote na ficha." },
  { id: "dia3_ficha", dia: 3, titulo: "Ficha e documentos completos", ajuda: "Mande o link para a pessoa preencher e tirar foto dos documentos.", automatica: "ficha" },
  { id: "semana1_treinos", dia: 7, titulo: "Treinamentos da função feitos", ajuda: "Os vídeos e as perguntas, pelo espaço do funcionário.", automatica: "treinos" },
  { id: "semana1_disc", dia: 7, titulo: "Teste DISC respondido", ajuda: "Para a liderança saber o melhor jeito de trabalhar com a pessoa.", automatica: "disc" },
  { id: "dia30_conversa", dia: 30, titulo: "Conversa de 30 dias", ajuda: "Como está sendo? O que está difícil? É aqui que o novato decide se fica." },
  { id: "dia45_avaliacao", dia: 45, titulo: "Avaliação do fim do 1º período", ajuda: "Antes de decidir a experiência.", automatica: "avaliacao_45" },
  { id: "dia60_conversa", dia: 60, titulo: "Conversa de 60 dias", ajuda: "Os combinados da avaliação estão sendo cumpridos?" },
  { id: "dia90_efetivacao", dia: 90, titulo: "Decisão de efetivação", ajuda: "Efetivar ou encerrar antes do fim do 2º período.", automatica: "efetivacao" },
];

export interface EtapaNaTela extends EtapaDaIntegracao {
  vence_em: string;
  feita: boolean;
  como: "automatica" | "manual" | null;
  atrasada: boolean;
}

/** As etapas de uma pessoa, com o que já foi feito. Pura: testável sem banco. */
export function montarIntegracao(params: {
  admissao: string;
  hoje: string;
  manuais: Set<string>;
  automaticas: Set<string>;
}): { etapas: EtapaNaTela[]; feitas: number; total: number; ativa: boolean } {
  const etapas = ETAPAS_DA_INTEGRACAO.map((e): EtapaNaTela => {
    const auto = Boolean(e.automatica && params.automaticas.has(e.automatica));
    const manual = params.manuais.has(e.id);
    const venceEm = somarDias(params.admissao, e.dia - 1);
    const feita = auto || manual;
    return { ...e, vence_em: venceEm, feita, como: auto ? "automatica" : manual ? "manual" : null, atrasada: !feita && venceEm < params.hoje };
  });
  const diasDeCasa = Math.round((new Date(`${params.hoje}T12:00:00Z`).getTime() - new Date(`${params.admissao}T12:00:00Z`).getTime()) / DIA_MS);
  return {
    etapas,
    feitas: etapas.filter((e) => e.feita).length,
    total: etapas.length,
    // Depois de 100 dias, a integração é história.
    ativa: diasDeCasa >= 0 && diasDeCasa <= 100,
  };
}

async function automaticasDa(venueId: string, atendenteId: string, funcao: string | null): Promise<Set<string>> {
  const [disc, aval, ficha, docs, treinos, feitos] = await Promise.all([
    cliente().from("rh_disc").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("atendente_id", atendenteId),
    cliente().from("rh_avaliacoes").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("atendente_id", atendenteId).in("momento", ["experiencia_45", "experiencia_90"]),
    cliente().from("rh_fichas").select("cpf, nome_completo, telefone, experiencia_decisao").eq("atendente_id", atendenteId).maybeSingle(),
    cliente().from("rh_documentos").select("tipo").eq("atendente_id", atendenteId),
    treinamentosDaFuncao(venueId, funcao).catch(() => []),
    cliente().from("rh_treinamentos_feitos").select("treinamento_id").eq("venue_id", venueId).eq("atendente_id", atendenteId),
  ]);
  const s = new Set<string>();
  if ((disc.count ?? 0) > 0) s.add("disc");
  if ((aval.count ?? 0) > 0) s.add("avaliacao_45");
  const f = ficha.data ?? {};
  const tipos = new Set(((docs.data ?? []) as Array<{ tipo: string }>).map((d) => d.tipo));
  if (f.cpf && f.nome_completo && f.telefone && tipos.has("rg")) s.add("ficha");
  if (f.experiencia_decisao === "efetivado" || f.experiencia_decisao === "encerrado") s.add("efetivacao");
  const feitosIds = new Set(((feitos.data ?? []) as Array<{ treinamento_id: string }>).map((x) => x.treinamento_id));
  const daFuncao = treinos as Array<{ id: string }>;
  if (daFuncao.length > 0 && daFuncao.every((t) => feitosIds.has(t.id))) s.add("treinos");
  return s;
}

export async function integracaoDaPessoa(params: { venueId: string; atendenteId: string; timezone: string }) {
  const [{ data: ficha }, { data: pessoa }, { data: marcadas }] = await Promise.all([
    cliente().from("rh_fichas").select("admissao, desligamento, padrinho_id, cargo").eq("atendente_id", params.atendenteId).maybeSingle(),
    cliente().from("pesquisa_atendentes").select("funcao").eq("id", params.atendenteId).maybeSingle(),
    cliente().from("rh_integracao").select("etapa").eq("venue_id", params.venueId).eq("atendente_id", params.atendenteId),
  ]);
  if (!ficha?.admissao || ficha.desligamento) return null;
  const automaticas = await automaticasDa(params.venueId, params.atendenteId, ficha.cargo || pessoa?.funcao || null);
  return {
    padrinho_id: ficha.padrinho_id ?? null,
    ...montarIntegracao({
      admissao: ficha.admissao,
      hoje: hojeNaCasa(params.timezone),
      manuais: new Set(((marcadas ?? []) as Array<{ etapa: string }>).map((m) => m.etapa)),
      automaticas,
    }),
  };
}

export async function marcarEtapa(params: { venueId: string; atendenteId: string; etapa: string; feita: boolean; quem: string }) {
  if (!ETAPAS_DA_INTEGRACAO.some((e) => e.id === params.etapa)) throw new ErroDoRh(400, "Etapa desconhecida.");
  const consulta = params.feita
    ? cliente()
        .from("rh_integracao")
        .upsert({ venue_id: params.venueId, atendente_id: params.atendenteId, etapa: params.etapa, feito_por: params.quem }, { onConflict: "atendente_id,etapa" })
    : cliente().from("rh_integracao").delete().eq("atendente_id", params.atendenteId).eq("etapa", params.etapa);
  const { error } = await consulta;
  if (error) falhar("Falha ao marcar a etapa", error.message);
  return { ok: true };
}

export async function definirPadrinho(params: { venueId: string; atendenteId: string; padrinhoId: unknown }) {
  const padrinho = params.padrinhoId ? String(params.padrinhoId) : null;
  if (padrinho === params.atendenteId) throw new ErroDoRh(400, "A pessoa não pode ser padrinho de si mesma.");
  const { error } = await cliente()
    .from("rh_fichas")
    .upsert({ venue_id: params.venueId, atendente_id: params.atendenteId, padrinho_id: padrinho }, { onConflict: "atendente_id" });
  if (error) falhar("Falha ao definir o padrinho", error.message);
  if (padrinho) await marcarEtapa({ ...params, etapa: "dia1_padrinho", feita: true, quem: "sistema" }).catch(() => undefined);
  return { ok: true };
}

/** Quem tem etapa de integração atrasada — para o Hoje. */
export async function integracoesAtrasadas(venueId: string, timezone: string): Promise<Array<{ nome: string; etapa: string }>> {
  const hoje = hojeNaCasa(timezone);
  const { data: fichas } = await cliente()
    .from("rh_fichas")
    .select("atendente_id, admissao")
    .eq("venue_id", venueId)
    .is("desligamento", null)
    .gte("admissao", somarDias(hoje, -100))
    .lte("admissao", hoje);
  const resultado: Array<{ nome: string; etapa: string }> = [];
  for (const f of (fichas ?? []) as Array<{ atendente_id: string }>) {
    const i = await integracaoDaPessoa({ venueId, atendenteId: f.atendente_id, timezone }).catch(() => null);
    const atrasada = i?.etapas.find((e) => e.atrasada);
    if (!atrasada) continue;
    const { data: p } = await cliente().from("pesquisa_atendentes").select("nome, apelido").eq("id", f.atendente_id).maybeSingle();
    resultado.push({ nome: p?.apelido || p?.nome || "—", etapa: atrasada.titulo });
  }
  return resultado;
}

// ============================================================
// Treinamentos
// ============================================================

export interface Pergunta {
  pergunta: string;
  opcoes: string[];
  certa: number;
}

export interface Treinamento {
  id: string;
  titulo: string;
  funcao: string | null;
  descricao: string | null;
  video_url: string | null;
  perguntas: Pergunta[];
  ativo: boolean;
}

/** As perguntas, conferidas: de 1 a 5, cada uma com 2 a 4 opções e a certa marcada. */
export function lerPerguntas(valor: unknown): Pergunta[] {
  const lista = Array.isArray(valor) ? valor : [];
  if (lista.length > 5) throw new ErroDoRh(400, "No máximo 5 perguntas por treinamento.");
  return lista.map((p, n) => {
    const linha = (p ?? {}) as Record<string, unknown>;
    const pergunta = String(linha.pergunta ?? "").trim();
    const opcoes = (Array.isArray(linha.opcoes) ? linha.opcoes : []).map((o) => String(o ?? "").trim()).filter(Boolean);
    const certa = Number(linha.certa);
    if (!pergunta) throw new ErroDoRh(400, `A pergunta ${n + 1} está vazia.`);
    if (opcoes.length < 2 || opcoes.length > 4) throw new ErroDoRh(400, `A pergunta ${n + 1} precisa de 2 a 4 opções.`);
    if (!Number.isInteger(certa) || certa < 0 || certa >= opcoes.length) throw new ErroDoRh(400, `Marque a resposta certa da pergunta ${n + 1}.`);
    return { pergunta, opcoes, certa };
  });
}

export function corrigirTreino(perguntas: Pergunta[], respostas: unknown): { acertos: number; total: number } {
  const r = Array.isArray(respostas) ? respostas.map(Number) : [];
  const acertos = perguntas.filter((p, i) => r[i] === p.certa).length;
  return { acertos, total: perguntas.length };
}

const COLUNAS_DO_TREINO = "id, titulo, funcao, descricao, video_url, perguntas, ativo";

export async function listarTreinamentos(venueId: string) {
  const [{ data, error }, { data: feitos }, { data: pessoas }] = await Promise.all([
    cliente().from("rh_treinamentos").select(COLUNAS_DO_TREINO).eq("venue_id", venueId).eq("ativo", true).order("criado_em"),
    cliente().from("rh_treinamentos_feitos").select("treinamento_id, atendente_id, acertos, total, concluido_em").eq("venue_id", venueId).order("concluido_em", { ascending: false }),
    cliente().from("pesquisa_atendentes").select("id, nome, apelido, funcao").eq("venue_id", venueId).eq("ativo", true),
  ]);
  if (error) falhar("Falha ao listar os treinamentos", error.message);
  const nomeDe = new Map(((pessoas ?? []) as Array<{ id: string; nome: string; apelido: string | null }>).map((p) => [p.id, p.apelido || p.nome]));
  return ((data ?? []) as Treinamento[]).map((t) => {
    const deste = ((feitos ?? []) as Array<{ treinamento_id: string; atendente_id: string; acertos: number; total: number; concluido_em: string }>)
      .filter((f) => f.treinamento_id === t.id && nomeDe.has(f.atendente_id));
    const melhor = new Map<string, { nome: string; acertos: number; total: number; concluido_em: string }>();
    for (const f of deste) {
      const atual = melhor.get(f.atendente_id);
      if (!atual || f.acertos > atual.acertos) melhor.set(f.atendente_id, { nome: nomeDe.get(f.atendente_id)!, acertos: f.acertos, total: f.total, concluido_em: f.concluido_em });
    }
    return { ...t, feitos: [...melhor.values()] };
  });
}

export async function salvarTreinamento(params: { venueId: string; id?: string | null; campos: Record<string, unknown> }) {
  const titulo = String(params.campos.titulo ?? "").trim();
  if (!titulo) throw new ErroDoRh(400, "Dê um título ao treinamento.");
  const video = String(params.campos.video_url ?? "").trim() || null;
  if (video && !/^https:\/\//.test(video)) throw new ErroDoRh(400, "O link do vídeo precisa começar com https://");
  const linha = {
    venue_id: params.venueId,
    titulo,
    funcao: String(params.campos.funcao ?? "").trim() || null,
    descricao: String(params.campos.descricao ?? "").trim() || null,
    video_url: video,
    perguntas: lerPerguntas(params.campos.perguntas),
  };
  const consulta = params.id
    ? cliente().from("rh_treinamentos").update(linha).eq("venue_id", params.venueId).eq("id", params.id)
    : cliente().from("rh_treinamentos").insert(linha);
  const { data, error } = await consulta.select(COLUNAS_DO_TREINO).single();
  if (error) falhar("Falha ao salvar o treinamento", error.message);
  return data;
}

export async function arquivarTreinamento(params: { venueId: string; id: string }) {
  const { error } = await cliente().from("rh_treinamentos").update({ ativo: false }).eq("venue_id", params.venueId).eq("id", params.id);
  if (error) falhar("Falha ao tirar o treinamento", error.message);
  return { ok: true };
}

/** Os treinos de uma função: os dela e os da equipe toda (função vazia). */
async function treinamentosDaFuncao(venueId: string, funcao: string | null): Promise<Treinamento[]> {
  const { data, error } = await cliente().from("rh_treinamentos").select(COLUNAS_DO_TREINO).eq("venue_id", venueId).eq("ativo", true).order("criado_em");
  if (error) return [];
  const f = String(funcao ?? "").trim().toLowerCase();
  return ((data ?? []) as Treinamento[]).filter((t) => !t.funcao || (f && f.includes(t.funcao.trim().toLowerCase())) || (f && t.funcao.trim().toLowerCase().includes(f)));
}

/** Treinamentos prontos: o que se ensina em toda casa, com as perguntas. */
export const MODELOS_DE_TREINAMENTO: Array<Omit<Treinamento, "id" | "ativo">> = [
  {
    titulo: "Boas práticas de higiene",
    funcao: null,
    descricao: "O que a Vigilância Sanitária confere e o que evita intoxicação do cliente: mãos, uniforme, temperatura e armazenamento.",
    video_url: null,
    perguntas: [
      { pergunta: "Quando lavar as mãos?", opcoes: ["Só no começo do turno", "Ao chegar, depois do banheiro, ao trocar de tarefa e depois de mexer em lixo ou dinheiro", "Só quando estiverem sujas"], certa: 1 },
      { pergunta: "Até quantos graus a geladeira deve ficar?", opcoes: ["Até 5 °C", "Até 12 °C", "Tanto faz, se estiver gelando"], certa: 0 },
      { pergunta: "O que é PVPS?", opcoes: ["Primeiro que Vence, Primeiro que Sai", "Preço de Venda Por Serviço", "Produto Vendido Por Semana"], certa: 0 },
    ],
  },
  {
    titulo: "Como atender uma mesa",
    funcao: "Garçom",
    descricao: "Da chegada do cliente à conta: recepção, sugestão, pedido, acompanhamento e despedida.",
    video_url: null,
    perguntas: [
      { pergunta: "Em quanto tempo o cliente que sentou deve ser atendido?", opcoes: ["Até 2 minutos, nem que seja para dizer 'já venho'", "Quando ele chamar", "Depois de 10 minutos"], certa: 0 },
      { pergunta: "O cliente reclamou do prato. O que fazer primeiro?", opcoes: ["Explicar que a cozinha está cheia", "Ouvir, pedir desculpa e chamar o responsável para resolver", "Dizer que ninguém reclamou antes"], certa: 1 },
      { pergunta: "Qual a melhor hora de sugerir a sobremesa?", opcoes: ["Ao recolher os pratos principais", "Junto com a conta", "Não se sugere sobremesa"], certa: 0 },
    ],
  },
  {
    titulo: "Recebimento de mercadoria",
    funcao: "Cozinha",
    descricao: "Conferir antes de assinar: quantidade, validade, temperatura e a nota no sistema.",
    video_url: null,
    perguntas: [
      { pergunta: "O congelado chegou mole. O que fazer?", opcoes: ["Recusar e anotar o motivo", "Aceitar e congelar de novo", "Deixar na bancada até decidir"], certa: 0 },
      { pergunta: "A quantidade da nota não bate com o pedido. O que fazer?", opcoes: ["Assinar e resolver depois", "Anotar a diferença no recebimento do sistema antes de assinar", "Devolver tudo"], certa: 1 },
      { pergunta: "Onde vai o produto que chegou hoje na prateleira?", opcoes: ["Na frente do que já estava", "Atrás do que vence antes", "Em qualquer lugar"], certa: 1 },
    ],
  },
  {
    titulo: "Fechamento do caixa",
    funcao: "Caixa",
    descricao: "Fechar sem diferença: conferir dinheiro, cartão e Pix, sangria e o relatório do dia.",
    video_url: null,
    perguntas: [
      { pergunta: "Sobrou dinheiro no caixa. O que fazer?", opcoes: ["Guardar para cobrir falta de outro dia", "Registrar a sobra e avisar o gerente", "Ignorar"], certa: 1 },
      { pergunta: "Para que serve a sangria?", opcoes: ["Tirar o excesso de dinheiro do caixa durante o turno, com registro", "Pagar fornecedor", "Dar troco"], certa: 0 },
    ],
  },
];

// ============================================================
// O espaço do funcionário
// ============================================================

/** O que o funcionário vê no próprio link. Nada de salário nem do resto da equipe. */
export async function espacoDoFuncionario(params: { venueId: string; atendenteId: string; casa: string; nome: string; timezone: string }) {
  const { venueId, atendenteId } = params;
  const hoje = hojeNaCasa(params.timezone);
  const [{ data: pessoa }, { data: escala }, { data: turnos }] = await Promise.all([
    cliente().from("pesquisa_atendentes").select("nome, apelido, funcao").eq("id", atendenteId).maybeSingle(),
    cliente().from("rh_escala").select("data, turno_id, situacao, funcao").eq("venue_id", venueId).eq("atendente_id", atendenteId).gte("data", hoje).lte("data", somarDias(hoje, 13)).order("data"),
    cliente().from("rh_turnos").select("id, nome, inicio, fim").eq("venue_id", venueId),
  ]);
  const turnoDe = new Map(((turnos ?? []) as Array<{ id: string; nome: string; inicio: string; fim: string }>).map((t) => [t.id, t]));

  const { semanaDoDia, acertoDaSemana } = await import("./rhAcerto.js");
  const { situacaoDaEquipe } = await import("./rhFerias.js");
  const { discDaPessoa } = await import("./rhPessoa.js");
  const semana = semanaDoDia(hoje);
  const [acerto, ferias, disc, treinos, feitos, avaliacoes] = await Promise.all([
    acertoDaSemana({ venueId, ano: semana.ano, semana: semana.numero, timezone: params.timezone }).catch(() => null),
    situacaoDaEquipe({ venueId, hoje }).catch(() => null),
    discDaPessoa(venueId, atendenteId).catch(() => null),
    treinamentosDaFuncao(venueId, pessoa?.funcao ?? null),
    cliente().from("rh_treinamentos_feitos").select("treinamento_id, acertos, total").eq("venue_id", venueId).eq("atendente_id", atendenteId),
    cliente().from("rh_avaliacoes").select("momento, dia, media, notas, pontos_fortes, melhorar, combinados, conversada_em").eq("venue_id", venueId).eq("atendente_id", atendenteId).not("conversada_em", "is", null).order("dia", { ascending: false }),
  ]);
  const minhaLinha = acerto?.linhas.find((l) => l.atendente_id === atendenteId) ?? null;
  const minhasFerias = ferias?.pessoas.find((p) => p.atendente_id === atendenteId) ?? null;
  const melhorDe = new Map<string, { acertos: number; total: number }>();
  for (const f of (feitos.data ?? []) as Array<{ treinamento_id: string; acertos: number; total: number }>) {
    const atual = melhorDe.get(f.treinamento_id);
    if (!atual || f.acertos > atual.acertos) melhorDe.set(f.treinamento_id, { acertos: f.acertos, total: f.total });
  }

  return {
    casa: params.casa,
    nome: pessoa?.apelido || pessoa?.nome || params.nome,
    funcao: pessoa?.funcao ?? null,
    escala: ((escala ?? []) as Array<{ data: string; turno_id: string | null; situacao: string; funcao: string | null }>).map((e) => {
      const t = e.turno_id ? turnoDe.get(e.turno_id) : null;
      return { data: e.data, situacao: e.situacao, turno: t ? `${t.nome} · ${t.inicio.slice(0, 5)}–${t.fim.slice(0, 5)}` : null, funcao: e.funcao };
    }),
    gorjeta: minhaLinha
      ? {
          semana: `${acerto!.inicio.split("-").reverse().join("/")} a ${acerto!.fim.split("-").reverse().join("/")}`,
          vendas: minhaLinha.vendas,
          comissao: minhaLinha.comissao,
          rateio: minhaLinha.rateio,
          bonus_meta: minhaLinha.bonus_meta,
          meta_proxima: minhaLinha.meta_proxima,
          adicionais: minhaLinha.adicionais,
          descontos: minhaLinha.descontos,
          a_receber: minhaLinha.a_receber,
        }
      : null,
    ferias: minhasFerias
      ? {
          alerta: minhasFerias.alerta,
          proximas: minhasFerias.ferias.filter((f) => f.fim >= hoje && f.situacao !== "cancelado" && f.situacao !== "recusado").map((f) => ({ inicio: f.inicio, fim: f.fim, situacao: f.situacao })),
        }
      : null,
    treinos: treinos.map((t) => ({
      id: t.id,
      titulo: t.titulo,
      descricao: t.descricao,
      video_url: t.video_url,
      // A resposta certa não sai daqui: a correção é no servidor.
      perguntas: t.perguntas.map((p) => ({ pergunta: p.pergunta, opcoes: p.opcoes })),
      feito: melhorDe.get(t.id) ?? null,
    })),
    disc,
    avaliacoes: avaliacoes.data ?? [],
  };
}

export async function responderTreino(params: { venueId: string; atendenteId: string; treinamentoId: string; respostas: unknown }) {
  const { data: t, error } = await cliente().from("rh_treinamentos").select("perguntas").eq("venue_id", params.venueId).eq("id", params.treinamentoId).maybeSingle();
  if (error) falhar("Falha ao abrir o treinamento", error.message);
  if (!t) throw new ErroDoRh(404, "Treinamento não encontrado.");
  const r = corrigirTreino(t.perguntas as Pergunta[], params.respostas);
  const { error: erroGravar } = await cliente()
    .from("rh_treinamentos_feitos")
    .insert({ venue_id: params.venueId, atendente_id: params.atendenteId, treinamento_id: params.treinamentoId, ...r });
  if (erroGravar) falhar("Falha ao registrar o treinamento", erroGravar.message);
  // Que perguntas errou, para a pessoa rever: só os números, sem a resposta.
  const respostas = Array.isArray(params.respostas) ? params.respostas.map(Number) : [];
  const erradas = (t.perguntas as Pergunta[]).map((p, i) => (respostas[i] === p.certa ? null : i + 1)).filter((x): x is number => x !== null);
  return { ...r, erradas };
}

// ============================================================
// O atestado por foto
// ============================================================

const FERRAMENTA_ATESTADO = {
  name: "registrar_atestado",
  description: "Registra o período de afastamento de um atestado médico fotografado.",
  input_schema: {
    type: "object" as const,
    properties: {
      e_atestado: { type: "boolean", description: "Falso se a imagem não for um atestado médico ou odontológico." },
      inicio: { type: ["string", "null"], description: "Primeiro dia de afastamento, AAAA-MM-DD." },
      dias: { type: ["integer", "null"], description: "Quantos dias de afastamento." },
      profissional: { type: ["string", "null"], description: "Nome e registro (CRM/CRO) de quem assinou." },
    },
    required: ["e_atestado"],
  },
};

/**
 * O funcionário manda o atestado por foto: a IA lê o período, o documento é
 * guardado na pasta dele, a escala marca "atestado" nos dias, e o gestor é
 * avisado. O CID não é lido nem guardado em campo nenhum — é dado de saúde,
 * e a casa não precisa dele.
 */
export async function receberAtestado(params: {
  venueId: string;
  atendenteId: string;
  nome: string;
  casa: string;
  timezone: string;
  arquivo: Buffer;
  contentType: string;
}) {
  const media = params.contentType.split(";")[0]!.trim().toLowerCase();
  const documento = await guardarDocumento({
    venueId: params.venueId,
    atendenteId: params.atendenteId,
    arquivo: params.arquivo,
    contentType: media,
    tipo: "atestado",
    titulo: "enviado pelo funcionário",
    enviadoPor: params.nome,
  });

  let lido: { e_atestado: boolean; inicio: string | null; dias: number | null; profissional: string | null } = { e_atestado: true, inicio: null, dias: null, profissional: null };
  if (["image/jpeg", "image/png", "image/webp"].includes(media)) {
    try {
      const { apiKey } = anthropicConfig();
      const anthropic = new Anthropic({ apiKey });
      const resposta = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 400,
        system: `Você lê atestados médicos brasileiros. Hoje é ${hojeNaCasa(params.timezone)}. Leia só o período de afastamento e quem assinou. NÃO transcreva o CID nem o diagnóstico. Se não estiver legível, devolva null.`,
        tools: [FERRAMENTA_ATESTADO],
        tool_choice: { type: "tool", name: "registrar_atestado" },
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: media as "image/jpeg", data: params.arquivo.toString("base64") } }, { type: "text", text: "Leia este atestado." }] }],
      });
      const uso = resposta.content.find((b) => b.type === "tool_use");
      const bruto = (uso && uso.type === "tool_use" ? uso.input : {}) as Record<string, unknown>;
      lido = {
        e_atestado: bruto.e_atestado !== false,
        inicio: /^\d{4}-\d{2}-\d{2}$/.test(String(bruto.inicio ?? "")) ? String(bruto.inicio) : null,
        dias: Number.isInteger(bruto.dias) && Number(bruto.dias) > 0 && Number(bruto.dias) <= 30 ? Number(bruto.dias) : null,
        profissional: typeof bruto.profissional === "string" ? bruto.profissional.slice(0, 120) : null,
      };
    } catch (e) {
      console.warn(`[rh] não deu para ler o atestado: ${(e as Error).message}`);
    }
  }

  const dias: string[] = lido.inicio && lido.dias ? Array.from({ length: lido.dias }, (_, i) => somarDias(lido.inicio!, i)) : [];
  for (const dia of dias) {
    // O dia vira "atestado": sai o turno que estava, entra a ausência justificada.
    await cliente().from("rh_escala").delete().eq("venue_id", params.venueId).eq("atendente_id", params.atendenteId).eq("data", dia);
    await cliente().from("rh_escala").insert({ venue_id: params.venueId, atendente_id: params.atendenteId, data: dia, situacao: "atestado", observacao: "atestado enviado pelo funcionário" });
  }

  // O gestor fica sabendo na hora: a escala daquele dia mudou.
  const { data: venue } = await cliente().from("venues").select("reservas_avisar_whatsapp").eq("id", params.venueId).maybeSingle();
  const { normalizarTelefone, inserirAvisos } = await import("./notifications.js");
  const destino = normalizarTelefone(String(venue?.reservas_avisar_whatsapp ?? ""));
  if (destino) {
    const periodo = dias.length
      ? `${dias.length} dia(s), de ${dias[0]!.split("-").reverse().join("/")} a ${dias[dias.length - 1]!.split("-").reverse().join("/")}`
      : "não deu para ler o período — confira o documento na ficha";
    await inserirAvisos({
      venue_id: params.venueId,
      channel: "whatsapp",
      destination: destino,
      papel: "administrativo",
      template: "rh_atestado",
      body: `🩺 ${params.nome} mandou um atestado — ${params.casa}\nAfastamento: ${periodo}.\n${dias.length ? "A escala já foi marcada como atestado. " : ""}O documento está na ficha, no RH.`,
    }).catch(() => undefined);
  }

  return { documento_id: documento.id, e_atestado: lido.e_atestado, dias: dias.length, inicio: dias[0] ?? null, fim: dias[dias.length - 1] ?? null };
}
