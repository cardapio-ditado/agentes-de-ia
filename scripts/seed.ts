import { db } from "../src/supabase.js";

/**
 * Cria uma organização, um estabelecimento de exemplo e o agente recepcionista.
 * Idempotente: rodar de novo atualiza os registros em vez de duplicar.
 *
 *   npm run seed
 */

const ORG_SLUG = "ditado";
const VENUE_SLUG = "ditado-popular";
const AGENT_SLUG = "recepcionista";

const SYSTEM_PROMPT = `Você é o recepcionista virtual de um bar e restaurante. Atende clientes por mensagem, tira dúvidas sobre a casa e registra pedidos de reserva.

## O que você faz
Responde sobre a programação (shows, jogos, promoções), informações do estabelecimento (endereço, horário, estacionamento, formas de pagamento) e coleta pedidos de reserva.

## Ferramentas — quando usar
- Antes de qualquer pergunta factual sobre a casa, chame informacoes_do_restaurante. Não responda endereço, horário ou regras de memória.
- Perguntas sobre o que vai rolar, quem toca, se passa jogo ou se tem promoção: chame consultar_programacao. Se ela não retornar nada, diga que não há programação cadastrada — nunca invente uma atração.
- Antes de registrar uma reserva, ou ao interpretar "hoje", "amanhã", "sexta que vem": chame hora_atual. Você não sabe a data atual sem essa chamada.
- Com os quatro dados obrigatórios confirmados (nome, telefone, número de pessoas, data e hora), chame registrar_reserva.
- Cliente perguntando se a reserva dele saiu: chame consultar_reserva com o protocolo.

## Reservas
Colete os quatro dados obrigatórios um assunto por vez, de forma natural — não despeje um formulário. Confirme o resumo com o cliente antes de registrar.

A reserva NÃO fica confirmada quando você a registra: ela entra na fila de aprovação do restaurante. Diga isso com todas as letras e passe o protocolo. Nunca prometa que a mesa está garantida, nem sugira um horário como disponível — quem decide é a equipe.

Se a ferramenta recusar o pedido (grupo grande demais, antecedência insuficiente), explique o motivo em uma frase e ofereça o caminho alternativo que a mensagem de erro indicar.

## Tom
Cordial e direto, como um bom maître no telefone. Português brasileiro, respostas curtas — a pessoa está no celular. Sem emoji, a menos que o cliente use primeiro. Não repita o que o cliente acabou de dizer antes de responder.

Quando não souber algo e nenhuma ferramenta cobrir, diga que vai verificar com a equipe e ofereça o telefone da casa. Não improvise informação sobre cardápio, preço ou disponibilidade.`;

async function main(): Promise<void> {
  const supabase = db();

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .upsert({ slug: ORG_SLUG, name: "Ditado Gestão" }, { onConflict: "slug" })
    .select()
    .single();
  if (orgError) throw new Error(`organizations: ${orgError.message}`);
  console.log(`organização  ${org.name} (${org.id})`);

  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .upsert(
      {
        org_id: org.id,
        slug: VENUE_SLUG,
        name: "Ditado Popular",
        description: "Bar e restaurante em Cuiabá-MT, com música ao vivo e transmissão de jogos.",
        address: "Cuiabá - MT",
        phone: "(65) 0000-0000",
        timezone: "America/Cuiaba",
        capacity: 120,
        opening_hours: {
          ter: [{ abre: "18:00", fecha: "23:30" }],
          qua: [{ abre: "18:00", fecha: "23:30" }],
          qui: [{ abre: "18:00", fecha: "00:30" }],
          sex: [{ abre: "18:00", fecha: "02:00" }],
          sab: [{ abre: "12:00", fecha: "02:00" }],
          dom: [{ abre: "12:00", fecha: "22:00" }],
        },
        settings: { max_party_size: 12, min_advance_minutes: 120, max_advance_days: 60 },
      },
      { onConflict: "org_id,slug" },
    )
    .select()
    .single();
  if (venueError) throw new Error(`venues: ${venueError.message}`);
  console.log(`estabelecimento  ${venue.name} (${venue.id})`);

  const infos = [
    { topic: "Estacionamento", content: "Estacionamento próprio com manobrista a partir das 19h." },
    { topic: "Formas de pagamento", content: "Dinheiro, Pix, débito e crédito. Não dividimos a conta em mais de 4 cartões." },
    { topic: "Pets", content: "Aceitamos pets na área externa, com guia." },
    { topic: "Couvert artístico", content: "Cobrado nos dias com música ao vivo; o valor varia por atração." },
    { topic: "Crianças", content: "Ambiente familiar até 21h. Temos cadeirão mediante solicitação na reserva." },
  ];
  const { error: infoError } = await supabase
    .from("venue_info")
    .upsert(
      infos.map((info) => ({ venue_id: venue.id, ...info })),
      { onConflict: "venue_id,topic" },
    );
  if (infoError) throw new Error(`venue_info: ${infoError.message}`);
  console.log(`base de conhecimento  ${infos.length} tópicos`);

  // Programação de exemplo, sempre no futuro para aparecer nas consultas.
  const emDias = (dias: number, hora: number) => {
    const data = new Date();
    data.setUTCDate(data.getUTCDate() + dias);
    data.setUTCHours(hora + 4, 0, 0, 0); // 4h = offset de America/Cuiaba
    return data.toISOString();
  };

  const { error: eventError } = await supabase.from("venue_events").insert([
    {
      venue_id: venue.id,
      kind: "musica",
      title: "Samba de Raiz — Grupo Água de Coco",
      description: "Roda de samba na área externa.",
      starts_at: emDias(2, 20),
      cover_charge: 25,
      details: { artista: "Grupo Água de Coco", estilo: "samba" },
    },
    {
      venue_id: venue.id,
      kind: "jogo",
      title: "Brasileirão — Cuiabá x Palmeiras",
      description: "Transmissão em 3 telões, com promoção de chope durante o jogo.",
      starts_at: emDias(4, 21),
      cover_charge: 0,
      details: { times: ["Cuiabá", "Palmeiras"], campeonato: "Brasileirão Série A" },
    },
    {
      venue_id: venue.id,
      kind: "promocao",
      title: "Happy hour dobrado",
      description: "Chope em dobro das 18h às 20h, de terça a quinta.",
      starts_at: emDias(1, 18),
      cover_charge: 0,
    },
  ]);
  if (eventError) throw new Error(`venue_events: ${eventError.message}`);
  console.log("programação  3 eventos de exemplo");

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .upsert(
      {
        org_id: org.id,
        slug: AGENT_SLUG,
        name: "Recepcionista",
        description: "Atende clientes, informa a programação e coleta pedidos de reserva.",
        system_prompt: SYSTEM_PROMPT,
        model: "claude-opus-5",
        effort: "medium",
        max_tokens: 8000,
        config: {
          venue_slug: VENUE_SLUG,
          tools: [
            "hora_atual",
            "informacoes_do_restaurante",
            "consultar_programacao",
            "registrar_reserva",
            "consultar_reserva",
          ],
        },
      },
      { onConflict: "slug" },
    )
    .select()
    .single();
  if (agentError) throw new Error(`agents: ${agentError.message}`);
  console.log(`agente  ${agent.name} (${agent.slug})`);

  console.log(`\nPronto. Teste com:\n  npm run chat -- --agent ${AGENT_SLUG} --venue ${VENUE_SLUG}\n`);
}

main().catch((erro) => {
  console.error(`\n[erro] ${erro instanceof Error ? erro.message : erro}\n`);
  process.exit(1);
});
