import Anthropic from "@anthropic-ai/sdk";
import { anthropicConfig } from "./config.js";
import { blocoDeConhecimento } from "./training.js";
import {
  atualizarContatoConversa,
  getAgentBySlug,
  getOrCreateConversation,
  insertMessage,
  insertToolCall,
  listMessages,
  logEvent,
  type Agent,
  type Message,
} from "./repository.js";
import { agenteDeveResponder, definirAtendimento } from "./inbox.js";
import { estadoDoPlano, PlanoBloqueadoError } from "./pontos.js";
import { resolveTools, type AgentTool, type ToolContext } from "./tools/index.js";
import { findVenueBySlug } from "./venues.js";
import type { Json } from "./database.types.js";

/** Trava de segurança: impede loop infinito de chamadas de ferramenta. */
const MAX_ITERACOES = 12;

let cachedClient: Anthropic | undefined;

function anthropic(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: anthropicConfig().apiKey });
  }
  return cachedClient;
}

export interface RunAgentParams {
  /** Slug do agente na tabela `agents`. */
  agentSlug: string;
  /** Texto enviado pelo usuário. */
  userMessage: string;
  /** Canal de origem: api, web, whatsapp... Padrão: "api". */
  channel?: string;
  /** Identificador do interlocutor no canal — o que dá continuidade à conversa. */
  externalId?: string;
  /** Slug do estabelecimento atendido. Necessário para as ferramentas de restaurante. */
  venueSlug?: string;
  /** Nome de perfil e telefone legível do interlocutor, quando o canal os conhece. */
  contato?: { nome?: string | null; telefone?: string | null };
  /** Recebe os eventos conforme acontecem. Omitir roda sem streaming. */
  onEvent?: (evento: AgentStreamEvent) => void;
}

export interface RunAgentResult {
  conversationId: string;
  text: string;
  stopReason: string | null;
  /**
   * O agente respondeu de verdade, ou o canal deve ficar CALADO?
   *
   * `false` quando uma pessoa assumiu o atendimento. A diferença importa
   * porque "sem texto" não é a mesma coisa que "não fale": os conectores
   * trocam texto vazio por uma frase de desculpas, e mandar qualquer frase
   * aqui atropelaria o gerente que está digitando a resposta.
   */
  respondeu: boolean;
}

/** Eventos emitidos durante a execução, para streaming ao cliente. */
export type AgentStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; name: string }
  | { type: "tool_result"; name: string; isError: boolean }
  | { type: "done"; conversationId: string; text: string };

/**
 * Executa um turno completo do agente: carrega histórico, chama o modelo,
 * executa as ferramentas que ele pedir e persiste tudo.
 */
export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const { agentSlug, userMessage, channel = "api", externalId, venueSlug, contato, onEvent } = params;

  const agent = await getAgentBySlug(agentSlug);
  const venue = venueSlug ? await findVenueBySlug(venueSlug) : null;
  const conversation = await getOrCreateConversation({
    agentId: agent.id,
    channel,
    externalId,
    venueId: venue?.id ?? null,
  });
  // Nome e telefone na inbox em vez do id técnico do canal. Antes da resposta
  // do modelo: a conversa já aparece identificada enquanto o agente digita.
  if (contato) await atualizarContatoConversa(conversation, contato);

  const toolContext: ToolContext = {
    agentId: agent.id,
    conversationId: conversation.id,
    venueId: conversation.venue_id ?? venue?.id ?? null,
    channel,
  };

  const historico = await listMessages(conversation.id);
  const messages: Anthropic.MessageParam[] = historico.map(toMessageParam);

  // A mensagem GRAVADA é a do cliente, limpa: é ela que aparece na inbox e no
  // histórico das próximas chamadas. A ENVIADA leva a data grudada no fim.
  //
  // O motivo é concreto: o bloco de data fica no começo do prompt, e numa
  // conversa com dias de histórico ele perde para o que está mais perto da
  // pergunta. Uma conversa que teve mensagens no domingo faz o modelo dizer
  // que hoje é domingo — ele não está inventando, está lendo o vizinho mais
  // próximo. Repetir a data como última coisa antes da resposta resolve.
  const agora = contextoDeAgora(venue?.timezone ?? "America/Cuiaba");
  // No log porque erro de data não aparece em stack trace nenhum: ele chega
  // como "o agente falou que hoje é domingo", e aí só o que foi ENVIADO
  // resolve a discussão.
  console.log(`[agente] ${agent.slug} <- ${agora}`);
  messages.push({ role: "user", content: comContextoDeAgora(userMessage, agora) });
  await insertMessage({
    conversation_id: conversation.id,
    role: "user",
    content: userMessage,
  });

  // Uma pessoa assumiu esta conversa: o agente cala a boca.
  //
  // A trava mora AQUI, e não em cada conector, porque a decisão é a mesma para
  // WhatsApp, Instagram e qualquer canal que venha depois — e porque o
  // conector nem sabe qual é a conversa antes desta função resolvê-la.
  //
  // Depois de gravar a mensagem do cliente, de propósito: quem assumiu precisa
  // continuar VENDO o que o cliente escreve. Calar o agente não pode significar
  // ficar cego.
  //
  // E antes da cobrança, também de propósito: conversa que a pessoa está
  // atendendo não gasta ponto de IA nem esbarra em plano bloqueado.
  if (!(await agenteDeveResponder(conversation.id))) {
    await logEvent({
      agentId: agent.id,
      conversationId: conversation.id,
      level: "info",
      event: "atendimento_humano",
      payload: { canal: channel },
    }).catch(() => undefined);
    onEvent?.({ type: "done", conversationId: conversation.id, text: "" });
    return {
      conversationId: conversation.id,
      text: "",
      stopReason: "atendimento_humano",
      respondeu: false,
    };
  }

  // Cobrança entra DEPOIS de gravar a mensagem do cliente, de propósito: mesmo
  // com o plano travado o restaurante precisa ver na inbox quem chamou, para
  // responder na mão. Travar o agente não pode significar perder o pedido.
  let agenteEfetivo = agent;
  if (venue) {
    const plano = await estadoDoPlano(venue);
    if (plano.estado === "bloqueado") {
      // Passa a conversa para atendimento humano: travada, ela precisa aparecer
      // na inbox como algo que espera resposta, não sumir no silêncio.
      await definirAtendimento({
        conversationId: conversation.id,
        por: "humano",
        quem: "pontos esgotados",
      }).catch(() => undefined);
      await logEvent({
        agentId: agent.id,
        conversationId: conversation.id,
        level: "warn",
        event: "plano_bloqueado",
        payload: { usados: plano.extrato.usados, total: plano.extrato.total },
      });
      throw new PlanoBloqueadoError(plano.extrato, conversation.id);
    }
    if (plano.modelo) agenteEfetivo = { ...agent, model: plano.modelo };
  }

  const tools = resolveTools(readToolNames(agent));
  let stopReason: string | null = null;
  let textoFinal = "";

  for (let iteracao = 0; iteracao < MAX_ITERACOES; iteracao++) {
    const inicio = Date.now();
    // Sempre em streaming: com max_tokens alto a requisição não-streaming
    // estoura o timeout HTTP do SDK.
    const stream = anthropic().messages.stream(
      buildRequest(agenteEfetivo, messages, tools, venue?.timezone ?? "America/Cuiaba"),
    );
    if (onEvent) {
      stream.on("text", (delta) => onEvent({ type: "text_delta", text: delta }));
    }
    const response = await stream.finalMessage();
    const latencia = Date.now() - inicio;
    stopReason = response.stop_reason;

    const assistantMessage = await insertMessage({
      conversation_id: conversation.id,
      role: "assistant",
      content: extractText(response.content) || null,
      blocks: response.content as unknown as Json,
      model: response.model,
      stop_reason: response.stop_reason,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? null,
      cache_creation_tokens: response.usage.cache_creation_input_tokens ?? null,
      latency_ms: latencia,
    });

    // Sempre devolve os blocos completos ao modelo — thinking e tool_use inclusos.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      await logEvent({
        agentId: agent.id,
        conversationId: conversation.id,
        level: "warn",
        event: "modelo_recusou",
        payload: { stop_reason: response.stop_reason },
      });
      const recusa = "O modelo recusou esta solicitação por política de uso.";
      onEvent?.({ type: "done", conversationId: conversation.id, text: recusa });
      return { conversationId: conversation.id, text: recusa, stopReason, respondeu: true };
    }

    // Ferramenta do lado do servidor atingiu o limite de iterações: reenviar retoma.
    if (response.stop_reason === "pause_turn") continue;

    const toolUses = response.content.filter(
      (bloco): bloco is Anthropic.ToolUseBlock => bloco.type === "tool_use",
    );

    if (toolUses.length === 0) {
      textoFinal = extractText(response.content);
      onEvent?.({ type: "done", conversationId: conversation.id, text: textoFinal });
      if (response.stop_reason === "max_tokens") {
        await logEvent({
          agentId: agent.id,
          conversationId: conversation.id,
          level: "warn",
          event: "resposta_truncada",
          payload: { max_tokens: agent.max_tokens },
        });
      }
      return { conversationId: conversation.id, text: textoFinal, stopReason, respondeu: true };
    }

    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      onEvent?.({ type: "tool_use", name: toolUse.name });
      const resultado = await executeTool({
        toolUse,
        tools,
        messageId: assistantMessage.id,
        ctx: toolContext,
      });
      onEvent?.({
        type: "tool_result",
        name: toolUse.name,
        isError: resultado.is_error === true,
      });
      resultados.push(resultado);
    }

    // Todos os resultados vão numa única mensagem — separá-los ensina o modelo
    // a parar de pedir ferramentas em paralelo.
    messages.push({ role: "user", content: resultados });
    await insertMessage({
      conversation_id: conversation.id,
      role: "tool",
      blocks: resultados as unknown as Json,
    });
  }

  await logEvent({
    agentId: agent.id,
    conversationId: conversation.id,
    level: "error",
    event: "limite_de_iteracoes",
    payload: { max: MAX_ITERACOES },
  });

  throw new Error(
    `O agente "${agentSlug}" excedeu ${MAX_ITERACOES} rodadas de ferramentas sem concluir.`,
  );
}

/**
 * "Agora é ..." no fuso da casa — sem isso o modelo só tem o conhecimento de
 * treinamento, que não sabe (nem podia saber) que dia é hoje.
 */
/**
 * Cola o contexto de tempo no fim da fala do cliente, delimitado.
 *
 * Delimitado porque o modelo precisa distinguir o que o cliente disse do que
 * o sistema informou — sem a marcação, ele pode responder à data como se
 * fosse parte da pergunta ("por que você me mandou a hora?").
 */
export function comContextoDeAgora(mensagem: string, contexto: string): string {
  return `${mensagem}\n\n<contexto-do-sistema>\n${contexto}\n</contexto-do-sistema>`;
}

/**
 * A frase de data que vai para o modelo — exportada de propósito.
 *
 * O /health devolve exatamente esta string. Quando o agente erra o dia da
 * semana, a primeira pergunta é sempre "o que o modelo recebeu?", e sem isso
 * a resposta vira dedução: o build da VPS pode estar velho, o relógio da
 * máquina errado, o Intl sem os dados de fuso. Um comando responde os três.
 */
export function contextoDeAgora(timezone: string): string {
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  return (
    `Data e hora atuais: ${data} (fuso ${timezone}). ` +
    "Use isso para calcular \"hoje\", \"amanhã\", dias da semana e qualquer data relativa — " +
    "nunca o seu conhecimento de treinamento, que não sabe que dia é agora."
  );
}

/**
 * Prefixos dos modelos que aceitam `thinking: adaptive` e `output_config`.
 *
 * Lista explícita, e não uma regra por número de versão: o nome do modelo não
 * carrega a geração de forma confiável (claude-haiku-4-5 é anterior ao
 * claude-sonnet-4-6 apesar do "4"), e errar aqui só aparece em produção, na
 * forma de um 400 no meio de um atendimento.
 */
const MODELOS_COM_ADAPTATIVO = [
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-fable-5",
  "claude-mythos-5",
];

export function suportaRaciocinioAdaptativo(model: string): boolean {
  return MODELOS_COM_ADAPTATIVO.some((prefixo) => model.startsWith(prefixo));
}

function buildRequest(
  agent: Agent,
  messages: Anthropic.MessageParam[],
  tools: AgentTool[],
  timezone: string,
): Anthropic.MessageCreateParamsNonStreaming {
  // Prompt e base de conhecimento em blocos separados, o cache no último:
  // um breakpoint cobre o prefixo inteiro, e editar o treinamento não obriga
  // a mexer no prompt (nem o contrário).
  const blocos: Anthropic.TextBlockParam[] = [];
  if (agent.system_prompt) {
    blocos.push({ type: "text", text: agent.system_prompt });
  }
  const conhecimento = blocoDeConhecimento(agent);
  if (conhecimento) {
    blocos.push({ type: "text", text: conhecimento });
  }
  if (blocos.length > 0) {
    blocos[blocos.length - 1]!.cache_control = { type: "ephemeral" };
  }
  // Fora do prefixo em cache: muda a cada minuto, e não pode invalidar o
  // cache do prompt + treinamento a cada chamada.
  blocos.push({ type: "text", text: contextoDeAgora(timezone) });

  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: agent.model,
    max_tokens: agent.max_tokens,
    messages,
    system: blocos.length > 0 ? blocos : undefined,
  };

  // Raciocínio adaptativo e esforço só existem da geração 4.6 em diante.
  // Mandar para um modelo mais antigo não degrada: a API recusa com 400 e o
  // cliente recebe "problema técnico". Pior ainda, isso quebrava justamente a
  // cortesia dos pontos esgotados, que força o Haiku — o modo pensado para
  // manter o restaurante atendendo era o único que nunca funcionaria.
  if (suportaRaciocinioAdaptativo(agent.model)) {
    request.thinking = { type: "adaptive" };
    request.output_config = { effort: agent.effort as Anthropic.OutputConfig["effort"] };
  }

  if (tools.length > 0) {
    request.tools = tools.map((tool) => tool.definition);
  }
  return request;
}

async function executeTool(params: {
  toolUse: Anthropic.ToolUseBlock;
  tools: AgentTool[];
  messageId: string;
  ctx: ToolContext;
}): Promise<Anthropic.ToolResultBlockParam> {
  const { toolUse, tools, messageId, ctx } = params;
  const { conversationId, agentId } = ctx;
  const tool = tools.find((t) => t.definition.name === toolUse.name);
  const input = (toolUse.input ?? {}) as Record<string, unknown>;
  const inicio = Date.now();

  if (!tool) {
    const mensagem = `Ferramenta "${toolUse.name}" não está habilitada para este agente.`;
    await insertToolCall({
      conversation_id: conversationId,
      message_id: messageId,
      tool_use_id: toolUse.id,
      tool_name: toolUse.name,
      input: input as Json,
      output: { erro: mensagem } as Json,
      is_error: true,
      duration_ms: 0,
    });
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: mensagem,
      is_error: true,
    };
  }

  try {
    const saida = await tool.run(input, ctx);
    await insertToolCall({
      conversation_id: conversationId,
      message_id: messageId,
      tool_use_id: toolUse.id,
      tool_name: toolUse.name,
      input: input as Json,
      output: { resultado: saida } as Json,
      is_error: false,
      duration_ms: Date.now() - inicio,
    });
    return { type: "tool_result", tool_use_id: toolUse.id, content: saida };
  } catch (erro) {
    // O erro volta como tool_result para o modelo tentar outro caminho —
    // derrubar o turno inteiro por uma ferramenta que falhou seria pior.
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await insertToolCall({
      conversation_id: conversationId,
      message_id: messageId,
      tool_use_id: toolUse.id,
      tool_name: toolUse.name,
      input: input as Json,
      output: { erro: mensagem } as Json,
      is_error: true,
      duration_ms: Date.now() - inicio,
    });
    await logEvent({
      agentId,
      conversationId,
      level: "error",
      event: "ferramenta_falhou",
      payload: { tool: toolUse.name, erro: mensagem } as Json,
    });
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: `Erro: ${mensagem}`,
      is_error: true,
    };
  }
}

/** Reconstrói uma mensagem persistida no formato que a API espera. */
function toMessageParam(row: Message): Anthropic.MessageParam {
  const blocks = row.blocks as Anthropic.ContentBlockParam[] | null;

  // Resultados de ferramenta são persistidos como role "tool", mas a API
  // os espera dentro de um turno de usuário.
  if (row.role === "tool") {
    return { role: "user", content: blocks ?? [] };
  }
  const role = row.role === "assistant" ? "assistant" : "user";
  return { role, content: blocks ?? row.content ?? "" };
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((bloco): bloco is Anthropic.TextBlock => bloco.type === "text")
    .map((bloco) => bloco.text)
    .join("\n")
    .trim();
}

function readToolNames(agent: Agent): unknown {
  const config = agent.config;
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return (config as Record<string, Json | undefined>).tools;
  }
  return undefined;
}
