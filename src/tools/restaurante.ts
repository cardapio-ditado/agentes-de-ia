import {
  createReservation,
  getReservation,
  getVenue,
  listUpcomingEvents,
  listVenueInfo,
  venueSettings,
  type Venue,
  type VenueEvent,
} from "../venues.js";
import { publicarReservaCriada } from "../reservationFlow.js";
import type { AgentTool, ToolContext } from "./types.js";

const TIPOS_DE_EVENTO = ["musica", "jogo", "promocao", "evento", "outro"] as const;

function venueIdObrigatorio(ctx: ToolContext): string {
  if (!ctx.venueId) {
    throw new Error(
      "Esta conversa não está vinculada a nenhum estabelecimento. " +
        "Informe o venue ao iniciar a execução do agente.",
    );
  }
  return ctx.venueId;
}

function formatarData(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** Deslocamento UTC atual do fuso, no formato "-04:00". */
function offsetAtual(timezone: string): string {
  const parte = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName");

  // "GMT-04:00" -> "-04:00"; "GMT" (UTC) -> "+00:00"
  const bruto = parte?.value.replace("GMT", "") ?? "";
  return bruto === "" ? "+00:00" : bruto;
}

// ============================================================
// hora_atual
// ============================================================
const horaAtual: AgentTool = {
  definition: {
    name: "hora_atual",
    description:
      "Retorna a data e hora atuais no fuso do estabelecimento, junto com o deslocamento UTC. " +
      "Chame esta ferramenta ANTES de registrar qualquer reserva ou de interpretar " +
      "expressões como 'hoje', 'amanhã', 'sexta que vem' ou 'daqui a duas horas'. " +
      "Nunca deduza a data atual de memória.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  async run(_input, ctx) {
    const venue = await getVenue(venueIdObrigatorio(ctx));
    const agora = new Date();
    const offset = offsetAtual(venue.timezone);
    return [
      `Agora: ${formatarData(agora.toISOString(), venue.timezone)}`,
      `Fuso do estabelecimento: ${venue.timezone} (UTC${offset})`,
      `Use este deslocamento ao montar a data da reserva, ex.: 2026-08-15T20:00:00${offset}`,
    ].join("\n");
  },
};

// ============================================================
// consultar_programacao
// ============================================================
const consultarProgramacao: AgentTool = {
  definition: {
    name: "consultar_programacao",
    description:
      "Lista a programação futura do estabelecimento: shows e música ao vivo, jogos transmitidos, " +
      "promoções e eventos. Use sempre que o cliente perguntar o que vai rolar, quem toca, " +
      "se passa algum jogo, se tem promoção, ou o que tem em determinado dia. " +
      "Não invente atrações: se a ferramenta não retornar nada, diga que não há programação cadastrada.",
    input_schema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: [...TIPOS_DE_EVENTO],
          description:
            "Filtra por tipo. Omita para trazer a programação completa.",
        },
        dias: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          description: "Janela em dias a partir de hoje. Padrão: 14.",
        },
      },
      required: [],
    },
  },
  async run(input, ctx) {
    const venue = await getVenue(venueIdObrigatorio(ctx));
    const dias = typeof input.dias === "number" ? input.dias : 14;
    const tipo = typeof input.tipo === "string" ? input.tipo : undefined;

    const until = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
    const eventos = await listUpcomingEvents({ venueId: venue.id, kind: tipo, until });

    if (eventos.length === 0) {
      const filtro = tipo ? ` do tipo "${tipo}"` : "";
      return `Nenhuma programação${filtro} cadastrada para os próximos ${dias} dias.`;
    }
    return eventos.map((evento) => descreverEvento(evento, venue)).join("\n\n");
  },
};

function descreverEvento(evento: VenueEvent, venue: Venue): string {
  const linhas = [
    `${evento.title} (${evento.kind})`,
    `Quando: ${formatarData(evento.starts_at, venue.timezone)}`,
  ];
  if (evento.description) linhas.push(`Sobre: ${evento.description}`);
  if (evento.cover_charge !== null) {
    linhas.push(
      evento.cover_charge > 0
        ? `Couvert: R$ ${evento.cover_charge.toFixed(2)}`
        : "Entrada franca",
    );
  }
  const detalhes = evento.details;
  if (detalhes && typeof detalhes === "object" && !Array.isArray(detalhes)) {
    for (const [chave, valor] of Object.entries(detalhes)) {
      if (valor !== undefined && valor !== null) {
        linhas.push(`${chave}: ${Array.isArray(valor) ? valor.join(" x ") : String(valor)}`);
      }
    }
  }
  return linhas.join("\n");
}

// ============================================================
// informacoes_do_restaurante
// ============================================================
const informacoesDoRestaurante: AgentTool = {
  definition: {
    name: "informacoes_do_restaurante",
    description:
      "Retorna os dados cadastrados do estabelecimento: endereço, telefone, horário de funcionamento, " +
      "capacidade e a base de conhecimento (estacionamento, formas de pagamento, política de pets, wi-fi). " +
      "Consulte antes de responder qualquer pergunta factual sobre o local — não responda de memória.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  async run(_input, ctx) {
    const venue = await getVenue(venueIdObrigatorio(ctx));
    const infos = await listVenueInfo(venue.id);

    const linhas = [`Nome: ${venue.name}`];
    if (venue.description) linhas.push(`Descrição: ${venue.description}`);
    if (venue.address) linhas.push(`Endereço: ${venue.address}`);
    if (venue.phone) linhas.push(`Telefone: ${venue.phone}`);
    if (venue.whatsapp) linhas.push(`WhatsApp: ${venue.whatsapp}`);
    if (venue.capacity) linhas.push(`Capacidade: ${venue.capacity} lugares`);

    const horarios = venue.opening_hours;
    if (horarios && typeof horarios === "object" && Object.keys(horarios).length > 0) {
      linhas.push(`Horário de funcionamento: ${JSON.stringify(horarios)}`);
    }
    for (const info of infos) {
      linhas.push(`${info.topic}: ${info.content}`);
    }
    return linhas.join("\n");
  },
};

// ============================================================
// registrar_reserva
// ============================================================
const registrarReserva: AgentTool = {
  definition: {
    name: "registrar_reserva",
    description:
      "Registra um pedido de reserva e o envia para aprovação humana. " +
      "Chame apenas quando tiver TODOS os dados obrigatórios confirmados com o cliente: " +
      "nome, telefone, número de pessoas e data/hora. " +
      "A reserva NÃO é confirmada na hora — ela entra na fila de aprovação do restaurante. " +
      "Deixe isso claro para o cliente: diga que o pedido foi enviado e que a confirmação virá em seguida. " +
      "Nunca prometa que a mesa está garantida.",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome completo de quem reserva." },
        telefone: {
          type: "string",
          description: "Telefone de contato com DDD, ex.: (65) 99999-8888.",
        },
        pessoas: {
          type: "integer",
          minimum: 1,
          description: "Quantidade de pessoas na mesa.",
        },
        data_hora: {
          type: "string",
          description:
            "Data e hora em ISO 8601 COM deslocamento, ex.: 2026-08-15T20:00:00-04:00. " +
            "Obtenha o deslocamento correto com a ferramenta hora_atual.",
        },
        email: { type: "string", description: "E-mail, se o cliente informar." },
        area: {
          type: "string",
          description: "Preferência de área: varanda, salão, área externa, mesa perto do palco.",
        },
        ocasiao: {
          type: "string",
          description: "Motivo da visita: aniversário, jantar de negócios, encontro.",
        },
        observacoes: {
          type: "string",
          description: "Pedidos especiais: cadeirão, acessibilidade, restrição alimentar, bolo.",
        },
      },
      required: ["nome", "telefone", "pessoas", "data_hora"],
    },
  },
  async run(input, ctx) {
    const venue = await getVenue(venueIdObrigatorio(ctx));
    const settings = venueSettings(venue);

    const nome = textoObrigatorio(input.nome, "nome");
    const telefone = textoObrigatorio(input.telefone, "telefone");
    const pessoas = inteiroObrigatorio(input.pessoas, "pessoas");
    const reservedFor = dataObrigatoria(input.data_hora);

    if (pessoas > settings.max_party_size) {
      throw new Error(
        `Grupos acima de ${settings.max_party_size} pessoas não podem ser reservados pelo agente. ` +
          `Oriente o cliente a falar direto com o restaurante${venue.phone ? ` (${venue.phone})` : ""}.`,
      );
    }

    const minimo = new Date(Date.now() + settings.min_advance_minutes * 60 * 1000);
    if (reservedFor < minimo) {
      throw new Error(
        `Reservas exigem ao menos ${settings.min_advance_minutes} minutos de antecedência. ` +
          `Ofereça um horário mais tarde ou oriente a ligar para o restaurante.`,
      );
    }

    const maximo = new Date(Date.now() + settings.max_advance_days * 24 * 60 * 60 * 1000);
    if (reservedFor > maximo) {
      throw new Error(
        `Só aceitamos reservas com até ${settings.max_advance_days} dias de antecedência.`,
      );
    }

    const reserva = await createReservation({
      venue_id: venue.id,
      agent_id: ctx.agentId,
      conversation_id: ctx.conversationId,
      customer_name: nome,
      customer_phone: telefone,
      customer_email: textoOpcional(input.email),
      party_size: pessoas,
      reserved_for: reservedFor.toISOString(),
      area_preference: textoOpcional(input.area),
      occasion: textoOpcional(input.ocasiao),
      notes: textoOpcional(input.observacoes),
      source_channel: ctx.channel,
      status: "pending",
    });

    // Avisa as integrações que há reserva na fila.
    await publicarReservaCriada(reserva, venue);

    return [
      `Pedido de reserva registrado e enviado para aprovação.`,
      `Protocolo: ${reserva.id}`,
      `${nome} — ${pessoas} pessoa(s)`,
      `Data: ${formatarData(reserva.reserved_for, venue.timezone)}`,
      `Status: pendente de confirmação pelo restaurante.`,
      ``,
      `Informe o protocolo ao cliente e avise que a confirmação chega em seguida pelo telefone informado.`,
    ].join("\n");
  },
};

// ============================================================
// consultar_reserva
// ============================================================
const consultarReserva: AgentTool = {
  definition: {
    name: "consultar_reserva",
    description:
      "Consulta a situação de uma reserva pelo protocolo. Use quando o cliente perguntar " +
      "se a reserva dele já foi confirmada ou quiser rever os dados.",
    input_schema: {
      type: "object",
      properties: {
        protocolo: {
          type: "string",
          description: "O identificador devolvido quando a reserva foi registrada.",
        },
      },
      required: ["protocolo"],
    },
  },
  async run(input, ctx) {
    const venue = await getVenue(venueIdObrigatorio(ctx));
    const protocolo = textoObrigatorio(input.protocolo, "protocolo");
    const reserva = await getReservation(protocolo);

    // Não confirmamos nem negamos reservas de outro estabelecimento.
    if (!reserva || reserva.venue_id !== venue.id) {
      return `Nenhuma reserva encontrada com o protocolo ${protocolo}.`;
    }

    const situacao: Record<string, string> = {
      pending: "aguardando aprovação do restaurante",
      approved: "confirmada",
      rejected: "não pôde ser confirmada",
      cancelled: "cancelada",
      seated: "cliente já acomodado",
      no_show: "cliente não compareceu",
    };

    const linhas = [
      `Protocolo: ${reserva.id}`,
      `Nome: ${reserva.customer_name} — ${reserva.party_size} pessoa(s)`,
      `Data: ${formatarData(reserva.reserved_for, venue.timezone)}`,
      `Situação: ${situacao[reserva.status] ?? reserva.status}`,
    ];
    if (reserva.status === "rejected" && reserva.review_reason) {
      linhas.push(`Motivo: ${reserva.review_reason}`);
    }
    return linhas.join("\n");
  },
};

// ---------- validação de entrada ----------

function textoObrigatorio(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new Error(`O campo "${campo}" é obrigatório. Pergunte ao cliente antes de tentar de novo.`);
  }
  return valor.trim();
}

function textoOpcional(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

function inteiroObrigatorio(valor: unknown, campo: string): number {
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isInteger(numero) || numero < 1) {
    throw new Error(`O campo "${campo}" precisa ser um número inteiro maior que zero.`);
  }
  return numero;
}

function dataObrigatoria(valor: unknown): Date {
  const texto = textoObrigatorio(valor, "data_hora");
  // Sem deslocamento explícito, o servidor interpretaria como UTC e a
  // reserva cairia no horário errado.
  if (!/[+-]\d{2}:\d{2}$|Z$/.test(texto)) {
    throw new Error(
      "data_hora precisa incluir o deslocamento UTC, ex.: 2026-08-15T20:00:00-04:00. " +
        "Chame hora_atual para descobrir o deslocamento do estabelecimento.",
    );
  }
  const data = new Date(texto);
  if (Number.isNaN(data.getTime())) {
    throw new Error(`data_hora inválida: "${texto}". Use ISO 8601, ex.: 2026-08-15T20:00:00-04:00.`);
  }
  return data;
}

export const ferramentasDeRestaurante: AgentTool[] = [
  horaAtual,
  consultarProgramacao,
  informacoesDoRestaurante,
  registrarReserva,
  consultarReserva,
];
