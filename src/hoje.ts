import { db } from "./supabase.js";
import { hojeNaCasa } from "./fuso.js";
import { lerEstadoPonte, type EstadoPonte } from "./ponteWhatsapp.js";
import { conexaoDaCasa as oficialDaCasa, situacaoDa, type SituacaoDaConexao } from "./whatsappOficial.js";
import { conexaoDaCasa as instagramDaCasa, paraOPainel as instagramParaOPainel } from "./instagramOficial.js";
import { filaDeAprovacao } from "./avaliacoes.js";
import { aniversariantesDoDia } from "./aniversarios.js";
import { resumoDoRh } from "./rh.js";
import { MAX_TENTATIVAS } from "./notifications.js";
import type { Json } from "./database.types.js";

/**
 * A tela "Hoje": a primeira pergunta de quem abre o painel de manhã.
 *
 * Duas partes, nesta ordem:
 *
 *   · SAÚDE — está tudo ligado? O número do atendimento, o de avisos, o
 *     oficial, o Instagram, a fila de mensagens. Depois do desmame, ninguém
 *     da Brasa Food olha isso pela casa todo dia; o dono precisa enxergar
 *     sozinho, em verde e vermelho, que o checklist das 17h vai sair.
 *   · O QUE FAZER — o que espera uma pessoa: reserva para aprovar, resposta
 *     do Google para liberar, cliente insatisfeito para ligar, compra para
 *     receber. Cada item leva à tela onde se resolve.
 *
 * Cada pedaço só aparece se a casa contratou o módulo e a pessoa pode
 * abri-lo — e cada um falha sozinho: um pedaço que não carregou some da
 * lista em vez de derrubar a tela inteira.
 */

export type Estado = "ok" | "alerta" | "problema";

export interface Sinal {
  id: string;
  titulo: string;
  estado: Estado;
  detalhe: string;
  /** Endereço do painel onde se resolve (#pagina ou #pagina:aba). */
  destino: string;
}

export interface Pendencia {
  id: string;
  modulo: string;
  titulo: string;
  quantidade: number;
  detalhe: string;
  destino: string;
  /** Urgente sobe para o topo e ganha cor: é o que perde dinheiro hoje. */
  urgente: boolean;
}

export interface Hoje {
  dia: string;
  saude: Sinal[];
  pendencias: Pendencia[];
  /** Nada vermelho na saúde e nada urgente: a frase do topo diz isso. */
  tudo_certo: boolean;
}

const cliente = () => db() as any;

// ============================================================
// Saúde — as regras puras, testáveis sem banco
// ============================================================

export interface EntradaDaSaude {
  atendimentoContratado: boolean;
  /** Estado publicado do WhatsApp Web do atendente (null = nunca ligou). */
  atendente: EstadoPonte | null;
  /** Estado publicado do WhatsApp Web de avisos (null = nunca ligou). */
  avisos: EstadoPonte | null;
  oficial: { situacao: SituacaoDaConexao; atende: boolean; telefone: string | null } | null;
  instagram: { conectado: boolean; vencido: boolean; precisa_renovar: boolean; agent_slug: string | null; usuario: string | null } | null;
  /** Mensagens que gastaram as tentativas nas últimas 48h. */
  mensagensQueFalharam: number;
  /** Mensagens esperando há mais de 30 minutos. */
  mensagensParadas: number;
}

export function montarSaude(e: EntradaDaSaude): Sinal[] {
  const sinais: Sinal[] = [];
  const CANAIS = "canais-casa";

  if (e.atendimentoContratado) {
    const webLigado = e.atendente?.status === "conectado";
    const oficialAtende = e.oficial?.situacao === "ativa" && e.oficial.atende;
    sinais.push(
      webLigado || oficialAtende
        ? { id: "atendimento", titulo: "Atendimento no WhatsApp", estado: "ok", detalhe: "O atendente virtual está respondendo os clientes.", destino: CANAIS }
        : e.atendente
          ? { id: "atendimento", titulo: "Atendimento no WhatsApp", estado: "problema", detalhe: "O número do atendimento caiu: quem escrever agora fica sem resposta.", destino: CANAIS }
          : { id: "atendimento", titulo: "Atendimento no WhatsApp", estado: "alerta", detalhe: "Nenhum número atende o cliente ainda.", destino: CANAIS },
    );
  }

  sinais.push(
    e.avisos?.status === "conectado"
      ? { id: "avisos", titulo: "Avisos para a equipe", estado: "ok", detalhe: "Checklist, reserva nova e alertas estão saindo.", destino: CANAIS }
      : e.avisos
        ? { id: "avisos", titulo: "Avisos para a equipe", estado: "problema", detalhe: "O número de avisos caiu: checklist e alertas da equipe não estão saindo.", destino: CANAIS }
        : { id: "avisos", titulo: "Avisos para a equipe", estado: "alerta", detalhe: "O número de avisos ainda não foi conectado.", destino: CANAIS },
  );

  // O oficial é opcional: quem nunca configurou não tem problema nenhum.
  if (e.oficial && e.oficial.situacao !== "nao_configurada") {
    sinais.push(
      e.oficial.situacao === "ativa"
        ? { id: "oficial", titulo: "Número oficial", estado: "ok", detalhe: "Parabéns, pesquisa e mensagens em massa saem pelo número oficial.", destino: CANAIS }
        : { id: "oficial", titulo: "Número oficial", estado: "alerta", detalhe: "Configurado pela metade: falta testar e ativar.", destino: CANAIS },
    );
  }

  if (e.instagram?.conectado) {
    sinais.push(
      e.instagram.vencido
        ? { id: "instagram", titulo: "Instagram", estado: "problema", detalhe: "A autorização venceu: os DMs não estão sendo respondidos.", destino: CANAIS }
        : !e.instagram.agent_slug
          ? { id: "instagram", titulo: "Instagram", estado: "alerta", detalhe: "Conectado, mas ninguém responde os DMs.", destino: CANAIS }
          : e.instagram.precisa_renovar
            ? { id: "instagram", titulo: "Instagram", estado: "alerta", detalhe: "A autorização vence logo — conecte de novo.", destino: CANAIS }
            : { id: "instagram", titulo: "Instagram", estado: "ok", detalhe: `@${e.instagram.usuario ?? "conta do bar"}: os DMs estão sendo respondidos.`, destino: CANAIS },
    );
  }

  if (e.mensagensQueFalharam > 0) {
    sinais.push({
      id: "falhas",
      titulo: "Mensagens que não saíram",
      estado: "problema",
      detalhe: `${e.mensagensQueFalharam} mensagem(ns) desistiram depois de ${MAX_TENTATIVAS} tentativas nas últimas 48 horas.`,
      destino: CANAIS,
    });
  } else if (e.mensagensParadas > 0) {
    sinais.push({
      id: "paradas",
      titulo: "Mensagens esperando",
      estado: "alerta",
      detalhe: `${e.mensagensParadas} mensagem(ns) na fila há mais de 30 minutos — o número que entrega pode estar desligado.`,
      destino: CANAIS,
    });
  }

  return sinais;
}

/** Urgentes primeiro; dentro do grupo, a maior pilha primeiro. */
export function ordenarPendencias(lista: Pendencia[]): Pendencia[] {
  return lista
    .filter((p) => p.quantidade > 0)
    .sort((a, b) => Number(b.urgente) - Number(a.urgente) || b.quantidade - a.quantidade);
}

// ============================================================
// Coleta
// ============================================================

async function contar(consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

const CONTAGEM = { count: "exact" as const, head: true };

/** Um pedaço que falha vira null — e some da tela, sem derrubar o resto. */
async function talvez<T>(nome: string, acao: () => Promise<T>): Promise<T | null> {
  try {
    return await acao();
  } catch (e) {
    console.warn(`[hoje] ${nome}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export async function hojeDaCasa(params: {
  venue: { id: string; slug: string; name: string; timezone: string; settings: Json | null };
  /** A casa contratou e esta pessoa pode abrir? */
  podeVer: (modulo: string) => boolean;
  agora?: Date;
}): Promise<Hoje> {
  const { venue, podeVer } = params;
  const agora = params.agora ?? new Date();
  const fuso = venue.timezone || "America/Cuiaba";
  const dia = hojeNaCasa(fuso, agora);
  const [, mes, diaDoMes] = dia.split("-").map(Number);
  const horas = (h: number) => new Date(agora.getTime() - h * 3_600_000).toISOString();

  const [oficial, instagram, falharam, paradas] = await Promise.all([
    talvez("oficial", async () => {
      const c = await oficialDaCasa(venue);
      return { situacao: situacaoDa(c), atende: Boolean(c.agent_slug), telefone: c.telefone };
    }),
    talvez("instagram", async () => {
      const c = instagramParaOPainel(await instagramDaCasa(venue)) as Record<string, unknown>;
      return {
        conectado: Boolean(c.conectado),
        vencido: Boolean(c.vencido),
        precisa_renovar: Boolean(c.precisa_renovar),
        agent_slug: (c.agent_slug as string | null) ?? null,
        usuario: (c.usuario as string | null) ?? null,
      };
    }),
    talvez("falhas", () =>
      contar(
        cliente()
          .from("notifications")
          .select("*", CONTAGEM)
          .eq("venue_id", venue.id)
          .eq("status", "failed")
          .gte("attempts", MAX_TENTATIVAS)
          .gte("created_at", horas(48)),
      ),
    ),
    talvez("paradas", () =>
      contar(
        cliente()
          .from("notifications")
          .select("*", CONTAGEM)
          .eq("venue_id", venue.id)
          .in("status", ["pending", "failed"])
          .lt("attempts", MAX_TENTATIVAS)
          .lt("created_at", horas(0.5))
          .gte("created_at", horas(48)),
      ),
    ),
  ]);

  const saude = montarSaude({
    atendimentoContratado: podeVer("agentes-ia"),
    atendente: lerEstadoPonte(venue.settings, "agente"),
    avisos: lerEstadoPonte(venue.settings, "administrativo"),
    oficial,
    instagram,
    mensagensQueFalharam: falharam ?? 0,
    mensagensParadas: paradas ?? 0,
  });

  const pedacos: Array<Promise<Pendencia | null>> = [];
  const pendencia = (modulo: string, nome: string, acao: () => Promise<Pendencia>) => {
    if (podeVer(modulo)) pedacos.push(talvez(nome, acao));
  };

  pendencia("agentes-ia", "reservas", async () => {
    const n = await contar(cliente().from("reservations").select("*", CONTAGEM).eq("venue_id", venue.id).eq("status", "pending"));
    return { id: "reservas", modulo: "agentes-ia", titulo: "Reservas para aprovar", quantidade: n, detalhe: "O cliente está esperando a confirmação.", destino: "reservas", urgente: true };
  });

  pendencia("agentes-ia", "conversas", async () => {
    const { data, error } = await cliente().from("conversations").select("metadata").eq("venue_id", venue.id).eq("status", "open");
    if (error) throw new Error(error.message);
    const n = ((data ?? []) as Array<{ metadata: Record<string, unknown> | null }>).filter(
      (c) => c.metadata?.atendimento_por === "humano",
    ).length;
    return { id: "conversas", modulo: "agentes-ia", titulo: "Conversas com uma pessoa", quantidade: n, detalhe: "O atendente virtual parou nelas: alguém da casa precisa responder.", destino: "conversas", urgente: true };
  });

  pendencia("avaliacoes", "avaliacoes", async () => ({
    id: "avaliacoes",
    modulo: "avaliacoes",
    titulo: "Respostas do Google para liberar",
    quantidade: (await filaDeAprovacao(venue.id)).length,
    detalhe: "A resposta está escrita; falta você aprovar.",
    destino: "avaliacoes",
    urgente: false,
  }));

  pendencia("pesquisa", "pesquisa", async () => {
    const n = await contar(
      cliente().from("pesquisa_respostas").select("*", CONTAGEM).eq("venue_id", venue.id).lte("nota", 6).gte("created_at", horas(72)),
    );
    return { id: "insatisfeitos", modulo: "pesquisa", titulo: "Clientes insatisfeitos", quantidade: n, detalhe: "Deram nota 6 ou menos nos últimos 3 dias. Um telefonema hoje ainda recupera.", destino: "pesquisa", urgente: true };
  });

  pendencia("checklist", "checklists", async () => {
    // Só os que ninguém abriu. O que está em andamento pode ser a ronda da
    // noite, que fica aberta por horas de propósito — contar esse como
    // atrasado ensinaria o dono a ignorar o alerta.
    const n = await contar(
      cliente()
        .from("checklist_runs")
        .select("*", CONTAGEM)
        .eq("venue_id", venue.id)
        .eq("status", "pendente")
        .gte("scheduled_for", horas(24))
        .lt("scheduled_for", horas(1)),
    );
    return { id: "checklists", modulo: "checklist", titulo: "Checklists que ninguém abriu", quantidade: n, detalhe: "O link saiu há mais de uma hora e ninguém começou.", destino: "execucoes", urgente: true };
  });

  pendencia("clientes", "aniversarios", async () => ({
    id: "aniversarios",
    modulo: "clientes",
    titulo: "Aniversariantes de hoje",
    quantidade: (await aniversariantesDoDia(venue.id, diaDoMes!, mes!)).length,
    detalhe: "O parabéns sai sozinho se estiver ligado; confira em Clientes.",
    destino: "clientes-casa:aniversarios",
    urgente: false,
  }));

  pendencia("cmv", "compras", async () => {
    const n = await contar(
      cliente().from("compras").select("*", CONTAGEM).eq("venue_id", venue.id).eq("status", "pedido").lte("data_prevista", dia),
    );
    return { id: "compras", modulo: "cmv", titulo: "Compras para receber", quantidade: n, detalhe: "Pedidos com entrega prevista até hoje.", destino: "compras", urgente: false };
  });

  pendencia("cmv", "vendas", async () => {
    const n = await contar(cliente().from("venda_importacoes").select("*", CONTAGEM).eq("venue_id", venue.id).eq("status", "revisao"));
    return { id: "vendas", modulo: "cmv", titulo: "Vendas esperando você", quantidade: n, detalhe: "Produtos vendidos que ainda não sabem o que baixar do estoque.", destino: "vendas", urgente: false };
  });

  pendencia("rh", "rh", async () => ({
    id: "documentos",
    modulo: "rh",
    titulo: "Documentos vencendo",
    quantidade: (await resumoDoRh(venue.id)).documentos_em_alerta,
    detalhe: "Vencem nos próximos 30 dias ou já venceram.",
    destino: "rh",
    urgente: false,
  }));

  const pendencias = ordenarPendencias((await Promise.all(pedacos)).filter((p): p is Pendencia => p !== null));
  return {
    dia,
    saude,
    pendencias,
    tudo_certo: saude.every((s) => s.estado !== "problema") && pendencias.every((p) => !p.urgente),
  };
}
