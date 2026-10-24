import { db } from "./supabase.js";
import { lerEstadoPonte } from "./ponteWhatsapp.js";
import { conexaoDaCasa as oficialDaCasa } from "./whatsappOficial.js";
import type { Json } from "./database.types.js";

/**
 * A trilha de implantação: o roteiro da consultoria, casa por casa.
 *
 * O mentor implanta e o mentorado tem de saber, sem perguntar, o que já foi
 * feito e o que falta. Quase todo passo se confere sozinho no banco (tem
 * atendente? tem receita? já houve contagem?) — ninguém precisa lembrar de
 * marcar, e o passo não mente. Os poucos que o sistema não tem como ver
 * ("a equipe foi treinada", "a casa rodou sozinha") o mentor marca à mão.
 * Qualquer passo pode ser marcado à mão também: a casa que não trabalha com
 * fornecedor fixo não fica com a trilha travada para sempre.
 *
 * Os passos seguem a ordem em que se implanta: a base da casa, depois cada
 * módulo contratado, por fim o desmame.
 */

export interface DefinicaoDoPasso {
  id: string;
  /** null = toda casa; senão, só aparece se o módulo foi contratado. */
  modulo: string | null;
  etapa: string;
  titulo: string;
  explicacao: string;
  destino: string;
  /** Sem conferência automática: só o mentor sabe se aconteceu. */
  manual?: boolean;
}

export const PASSOS: DefinicaoDoPasso[] = [
  { id: "casa", modulo: null, etapa: "A base da casa", titulo: "Preencher os dados da casa", explicacao: "Endereço, telefone e horário de funcionamento. Todo módulo usa.", destino: "empresa" },
  { id: "pessoas", modulo: null, etapa: "A base da casa", titulo: "Criar o acesso do gerente e da equipe", explicacao: "Cada pessoa com o seu login — é o que faz o histórico ter dono.", destino: "pessoas" },
  { id: "avisos", modulo: null, etapa: "A base da casa", titulo: "Conectar o número de avisos", explicacao: "O WhatsApp que manda o checklist, a reserva nova e os alertas para a equipe.", destino: "canais-casa" },

  { id: "atendente", modulo: "agentes-ia", etapa: "Atendente virtual", titulo: "Criar o atendente", explicacao: "Comece por um modelo pronto e troque o nome da casa.", destino: "atendente:agentes" },
  { id: "atendente-sabe", modulo: "agentes-ia", etapa: "Atendente virtual", titulo: "Ensinar o que ele precisa saber", explicacao: "Pelo menos três respostas: cardápio, estacionamento, couvert, o que o cliente mais pergunta.", destino: "atendente:sabe" },
  { id: "atendente-testado", modulo: "agentes-ia", etapa: "Atendente virtual", titulo: "Testar como se fosse um cliente", explicacao: "Peça uma reserva, pergunte o preço, tente confundir. Marque quando estiver bom.", destino: "atendente:testar", manual: true },
  { id: "atendente-numero", modulo: "agentes-ia", etapa: "Atendente virtual", titulo: "Ligar o número do atendimento", explicacao: "O WhatsApp em que o cliente escreve e o atendente responde.", destino: "canais-casa" },
  { id: "programacao", modulo: "agentes-ia", etapa: "Atendente virtual", titulo: "Cadastrar a programação", explicacao: "Shows, jogos e promoções: sem isso o atendente não tem o que contar.", destino: "programacao" },

  { id: "checklist", modulo: "checklist", etapa: "Checklist", titulo: "Montar o primeiro checklist", explicacao: "Abertura e fechamento já vêm prontos nos modelos.", destino: "checklists" },
  { id: "checklist-feito", modulo: "checklist", etapa: "Checklist", titulo: "Ver o primeiro checklist feito", explicacao: "A equipe recebeu o link, respondeu, e o resumo chegou.", destino: "execucoes" },
  { id: "equipe-treinada", modulo: "checklist", etapa: "Checklist", titulo: "Treinar a equipe", explicacao: "Mostre no celular de cada um como abrir o link e mandar a foto.", destino: "execucoes", manual: true },

  { id: "clientes", modulo: "clientes", etapa: "Clientes", titulo: "Trazer a base de clientes", explicacao: "Planilha, Zig ou à mão: quem já esteve na casa.", destino: "clientes-casa" },
  { id: "parabens", modulo: "clientes", etapa: "Clientes", titulo: "Ligar o parabéns de aniversário", explicacao: "A mensagem que mais traz cliente de volta.", destino: "clientes-casa:parabens" },
  { id: "pesquisa", modulo: "pesquisa", etapa: "Clientes", titulo: "Pôr o QR da pesquisa na mesa e receber a primeira resposta", explicacao: "Imprima o QR em Ajustes da pesquisa.", destino: "pesquisa-ajustes" },
  { id: "google", modulo: "avaliacoes", etapa: "Clientes", titulo: "Conectar as avaliações do Google", explicacao: "As respostas saem no tom da casa.", destino: "avaliacoes" },

  { id: "itens", modulo: "cmv", etapa: "Custos e estoque", titulo: "Cadastrar pelo menos 10 itens", explicacao: "O que a casa compra: carnes, bebidas, descartáveis.", destino: "cadastros" },
  { id: "fornecedores", modulo: "cmv", etapa: "Custos e estoque", titulo: "Cadastrar os fornecedores", explicacao: "Quem entrega o quê — é o que alimenta o histórico de preço.", destino: "cadastros" },
  { id: "receitas", modulo: "cmv", etapa: "Custos e estoque", titulo: "Montar a receita dos pratos que mais vendem", explicacao: "Com a receita, cada venda baixa o estoque e o custo do prato aparece.", destino: "fichas" },
  { id: "compra", modulo: "cmv", etapa: "Custos e estoque", titulo: "Receber a primeira compra pelo sistema", explicacao: "Foto da nota vira entrada no estoque.", destino: "compras" },
  { id: "contagem", modulo: "cmv", etapa: "Custos e estoque", titulo: "Fazer a primeira contagem", explicacao: "O contado vira o saldo e a quebra aparece em reais.", destino: "contagem" },

  { id: "rh", modulo: "rh", etapa: "RH", titulo: "Cadastrar a equipe no RH", explicacao: "Ficha de cada um e os documentos com validade.", destino: "rh" },
  { id: "cardapio", modulo: "cardapio-digital", etapa: "Cardápio", titulo: "Publicar o cardápio", explicacao: "Itens com foto e preço, e o QR na mesa.", destino: "cardapio" },

  { id: "desmame", modulo: null, etapa: "Desmame", titulo: "A casa rodou duas semanas sem o mentor", explicacao: "Checklist saindo, atendente respondendo, números conferidos pela própria casa. É aqui que a implantação termina.", destino: "hoje", manual: true },
];

export interface MarcaManual {
  feito_em: string;
  por: string | null;
}

export interface PassoDaTrilha extends DefinicaoDoPasso {
  feito: boolean;
  /** Como ficou feito: o sistema viu, ou alguém marcou. */
  como: "automatico" | "manual" | null;
  marcado_por: string | null;
}

export interface Trilha {
  passos: PassoDaTrilha[];
  feitos: number;
  total: number;
  proximo: PassoDaTrilha | null;
}

/** As regras puras: quais passos valem para a casa, e qual está feito. */
export function montarTrilha(params: {
  contratados: Set<string>;
  automaticos: Set<string>;
  manuais: Record<string, MarcaManual>;
}): Trilha {
  const passos = PASSOS.filter((p) => p.modulo === null || params.contratados.has(p.modulo)).map((p): PassoDaTrilha => {
    const auto = !p.manual && params.automaticos.has(p.id);
    const marca = params.manuais[p.id];
    return {
      ...p,
      feito: auto || Boolean(marca),
      como: auto ? "automatico" : marca ? "manual" : null,
      marcado_por: !auto && marca ? marca.por : null,
    };
  });
  const feitos = passos.filter((p) => p.feito).length;
  return { passos, feitos, total: passos.length, proximo: passos.find((p) => !p.feito) ?? null };
}

// ============================================================
// Coleta
// ============================================================

const cliente = () => db() as any;
const CONTAGEM = { count: "exact" as const, head: true };
const CHAVE = "trilha_manual";

async function contar(consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await consulta;
  // Tabela de módulo que a instalação não tem: o passo fica por fazer, sem
  // derrubar a trilha.
  if (error) return 0;
  return count ?? 0;
}

function comoObjeto(v: Json | null | undefined): Record<string, Json | undefined> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json | undefined>) : {};
}

export function marcasManuais(settings: Json | null): Record<string, MarcaManual> {
  return comoObjeto(comoObjeto(settings)[CHAVE]) as unknown as Record<string, MarcaManual>;
}

export async function trilhaDaCasa(params: {
  venue: {
    id: string;
    org_id: string;
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
    opening_hours: Json | null;
    settings: Json | null;
  };
  contratados: Set<string>;
}): Promise<Trilha> {
  const { venue, contratados } = params;
  const v = venue.id;
  const agora = new Date().toISOString();
  const temModulo = (m: string) => contratados.has(m);
  const horarios = comoObjeto(venue.opening_hours);

  const checagens: Array<[string, () => Promise<boolean>]> = [
    ["casa", async () => Boolean(venue.address && (venue.phone || venue.whatsapp) && Object.keys(horarios).length)],
    ["pessoas", async () => (await contar(cliente().from("org_members").select("*", CONTAGEM).eq("org_id", venue.org_id))) >= 2],
    ["avisos", async () => lerEstadoPonte(venue.settings, "administrativo") !== null],
  ];
  if (temModulo("agentes-ia")) {
    checagens.push(
      ["atendente", async () => (await contar(cliente().from("agents").select("*", CONTAGEM).eq("org_id", venue.org_id))) > 0],
      ["atendente-sabe", async () => (await contar(cliente().from("venue_info").select("*", CONTAGEM).eq("venue_id", v).eq("active", true))) >= 3],
      ["atendente-numero", async () => {
        if (lerEstadoPonte(venue.settings, "agente") !== null) return true;
        const oficial = await oficialDaCasa(venue).catch(() => null);
        return Boolean(oficial?.agent_slug && oficial.inscrita_em);
      }],
      ["programacao", async () => (await contar(cliente().from("venue_events").select("*", CONTAGEM).eq("venue_id", v).gte("starts_at", agora))) > 0],
    );
  }
  if (temModulo("checklist")) {
    checagens.push(
      ["checklist", async () => (await contar(cliente().from("checklists").select("*", CONTAGEM).eq("venue_id", v))) > 0],
      ["checklist-feito", async () => (await contar(cliente().from("checklist_runs").select("*", CONTAGEM).eq("venue_id", v).eq("status", "concluida"))) > 0],
    );
  }
  if (temModulo("clientes")) {
    checagens.push(
      ["clientes", async () => (await contar(cliente().from("clientes").select("*", CONTAGEM).eq("venue_id", v))) > 0],
      ["parabens", async () => {
        const { data } = await cliente().from("clientes_config").select("aniversario_ativo").eq("venue_id", v).maybeSingle();
        return data?.aniversario_ativo === true;
      }],
    );
  }
  if (temModulo("pesquisa")) {
    checagens.push(["pesquisa", async () => (await contar(cliente().from("pesquisa_respostas").select("*", CONTAGEM).eq("venue_id", v))) > 0]);
  }
  if (temModulo("avaliacoes")) {
    checagens.push(["google", async () => (await contar(cliente().from("google_perfis").select("*", CONTAGEM).eq("venue_id", v))) > 0]);
  }
  if (temModulo("cmv")) {
    checagens.push(
      ["itens", async () => (await contar(cliente().from("insumos").select("*", CONTAGEM).eq("venue_id", v).eq("ativo", true))) >= 10],
      ["fornecedores", async () => (await contar(cliente().from("fornecedores").select("*", CONTAGEM).eq("venue_id", v))) > 0],
      ["receitas", async () => (await contar(cliente().from("fichas_tecnicas").select("*", CONTAGEM).eq("venue_id", v).eq("ativa", true))) > 0],
      ["compra", async () => (await contar(cliente().from("compras").select("*", CONTAGEM).eq("venue_id", v).eq("status", "recebida"))) > 0],
      ["contagem", async () => (await contar(cliente().from("contagens").select("*", CONTAGEM).eq("venue_id", v).eq("status", "processada"))) > 0],
    );
  }
  if (temModulo("rh")) {
    checagens.push(["rh", async () => (await contar(cliente().from("rh_fichas").select("*", CONTAGEM).eq("venue_id", v))) > 0]);
  }
  if (temModulo("cardapio-digital")) {
    checagens.push(["cardapio", async () => (await contar(cliente().from("items").select("*", CONTAGEM).eq("venue_id", v).eq("is_active", true))) > 0]);
  }

  const resultados = await Promise.all(checagens.map(async ([id, f]) => [id, await f().catch(() => false)] as const));
  return montarTrilha({
    contratados,
    automaticos: new Set(resultados.filter(([, ok]) => ok).map(([id]) => id)),
    manuais: marcasManuais(venue.settings),
  });
}

/** Marca (ou desmarca) um passo à mão. Lê e regrava só a chave da trilha. */
export async function marcarPasso(params: { venueId: string; passo: string; feito: boolean; por: string | null }): Promise<void> {
  if (!PASSOS.some((p) => p.id === params.passo)) throw new Error("Passo desconhecido.");
  const { data, error } = await cliente().from("venues").select("settings").eq("id", params.venueId).single();
  if (error) throw new Error(`Falha ao ler a casa: ${error.message}`);
  const settings = comoObjeto(data?.settings as Json | null);
  const marcas = { ...marcasManuais(settings as Json) };
  if (params.feito) marcas[params.passo] = { feito_em: new Date().toISOString(), por: params.por };
  else delete marcas[params.passo];
  const { error: erroGravar } = await cliente()
    .from("venues")
    .update({ settings: { ...settings, [CHAVE]: marcas } })
    .eq("id", params.venueId);
  if (erroGravar) throw new Error(`Falha ao gravar a trilha: ${erroGravar.message}`);
}
