/**
 * Modelos prontos: o ponto de partida que a consultoria leva para cada casa.
 *
 * Restaurante do interior não começa do zero e não precisa de mentor para
 * escrever a primeira rotina de fechamento: escolhe o modelo, troca o que
 * não serve e salva. São as rotinas que se repetem em toda implantação —
 * escritas uma vez aqui, revisadas na prática.
 *
 * Nada aqui é gravado sozinho: o modelo só preenche o editor.
 */

const TODO_DIA = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
const DE_TERCA_A_DOMINGO = ["ter", "qua", "qui", "sex", "sab", "dom"];

let seq = 0;
const item = (pergunta, tipo = "sim_nao", obrigatorio = true) => ({ id: `m${++seq}`, tipo, pergunta, obrigatorio });

export const MODELOS_DE_CHECKLIST = [
  {
    chave: "abertura",
    titulo: "Abertura da casa",
    resumo: "Antes de abrir as portas: salão, banheiro, bar, cozinha e caixa.",
    modelo: {
      name: "Abertura da casa",
      description: "Rotina de abertura: salão, banheiros, bar, cozinha e caixa.",
      schedule: { dias: DE_TERCA_A_DOMINGO, hora: "16:00" },
      items: [
        item("O salão está varrido e as mesas limpas e arrumadas?"),
        item("Foto do salão pronto para abrir", "foto"),
        item("Os banheiros estão limpos, com papel, sabonete e lixeira vazia?"),
        item("As geladeiras e freezers estão ligados e gelando?"),
        item("Gelo, limão e copos suficientes no bar?"),
        item("A praça da cozinha está montada (mise en place pronta)?"),
        item("O troco do caixa foi conferido?"),
        item("As máquinas de cartão estão carregadas e funcionando?"),
        item("Alguma coisa em falta ou quebrada? Escreva aqui.", "texto", false),
      ],
    },
  },
  {
    chave: "fechamento",
    titulo: "Fechamento da casa",
    resumo: "Antes de ir embora: gás, luzes, freezers, lixo e porta trancada.",
    modelo: {
      name: "Fechamento da casa",
      description: "Rotina de fechamento: cozinha, bar, salão e segurança.",
      schedule: { dias: DE_TERCA_A_DOMINGO, hora: "23:30" },
      items: [
        item("O gás da cozinha foi fechado?"),
        item("Fogão, chapa e fritadeira desligados?"),
        item("Freezers e geladeiras fechados e ligados?"),
        item("Foto das geladeiras fechadas", "foto"),
        item("O lixo foi retirado e as lixeiras lavadas?"),
        item("O bar foi limpo e a louça lavada?"),
        item("O caixa foi fechado e o dinheiro guardado?"),
        item("Luzes, ar-condicionado e som desligados?"),
        item("Portas e janelas trancadas?"),
        item("Alguma ocorrência da noite? Escreva aqui.", "texto", false),
      ],
    },
  },
  {
    chave: "banheiro",
    titulo: "Ronda do banheiro",
    resumo: "As mesmas perguntas a cada hora, durante a noite, num link só.",
    modelo: {
      name: "Ronda do banheiro",
      description: "Conferência do banheiro a cada hora enquanto a casa está aberta.",
      schedule: { dias: ["qui", "sex", "sab"], hora: "19:00", a_cada_minutos: 60, ate: "01:00" },
      items: [
        item("Tem papel higiênico e papel toalha?"),
        item("Tem sabonete?"),
        item("O chão está seco e limpo?"),
        item("As lixeiras foram esvaziadas?"),
        item("Foto do banheiro", "foto"),
      ],
    },
  },
  {
    chave: "temperatura",
    titulo: "Temperatura das geladeiras",
    resumo: "Uma foto do termômetro de cada equipamento, todo dia de manhã.",
    modelo: {
      name: "Temperatura das geladeiras",
      description: "Registro diário da temperatura — o que a vigilância sanitária pede.",
      schedule: { dias: TODO_DIA, hora: "10:00" },
      items: [
        item("Foto do termômetro da geladeira da cozinha", "foto"),
        item("Foto do termômetro do freezer", "foto"),
        item("Foto do termômetro da geladeira do bar", "foto"),
        item("Algum equipamento fora da temperatura? Qual?", "texto", false),
      ],
    },
  },
  {
    chave: "recebimento",
    titulo: "Recebimento de mercadoria",
    resumo: "Na hora que o fornecedor chega: conferir antes de assinar.",
    modelo: {
      name: "Recebimento de mercadoria",
      description: "Conferência da entrega — dispare na hora que o fornecedor chegar.",
      schedule: { dias: [], hora: "09:00" },
      items: [
        item("Foto da nota fiscal", "foto"),
        item("As quantidades batem com o pedido?"),
        item("A validade dos produtos está boa?"),
        item("Os congelados chegaram congelados?"),
        item("Algum item faltando ou avariado? Qual?", "texto", false),
      ],
    },
  },
];

/**
 * Modelos de atendente. Os colchetes são o que a casa troca: o resto já é
 * o que funciona no atendimento de bar e restaurante.
 */
const REGRAS = `Regras:
- NUNCA confirme uma reserva. Diga que ela será analisada pela equipe e que a confirmação chega pelo WhatsApp.
- Não invente informação. Se não souber, diga que vai verificar com a equipe.
- Não fale de outros assuntos além da casa.
- Mensagens curtas, como no WhatsApp: no máximo três frases por resposta.`;

export const MODELOS_DE_ATENDENTE = [
  {
    chave: "bar",
    titulo: "Bar com música ao vivo",
    resumo: "Reservas de mesa, programação de shows e jogos, dúvidas da casa.",
    agente: {
      name: "Recepcionista",
      slug: "recepcionista",
      description: "Atende o WhatsApp: reservas, programação e dúvidas",
      system_prompt: `Você é a recepcionista virtual do [NOME DA CASA], um bar com música ao vivo em [CIDADE].

Personalidade: calorosa, direta e bem-humorada — como quem recebe na porta. Trata o cliente pelo primeiro nome.

O que você faz:
- Conta a programação: quem toca hoje e nos próximos dias, jogos na TV, promoções.
- Responde horários, endereço, couvert, cardápio e estacionamento.
- Coleta os dados da reserva: nome, quantidade de pessoas, data e horário.

${REGRAS}`,
    },
  },
  {
    chave: "restaurante",
    titulo: "Restaurante",
    resumo: "Reservas, horário de almoço e jantar, cardápio e datas especiais.",
    agente: {
      name: "Recepcionista",
      slug: "recepcionista",
      description: "Atende o WhatsApp: reservas, cardápio e dúvidas",
      system_prompt: `Você é a recepcionista virtual do [NOME DA CASA], um restaurante em [CIDADE].

Personalidade: educada, acolhedora e objetiva.

O que você faz:
- Informa os horários de almoço e jantar, o endereço e o cardápio.
- Ajuda em datas especiais (aniversário, confraternização): pergunta quantas pessoas e se precisa de algo diferente.
- Coleta os dados da reserva: nome, quantidade de pessoas, data e horário.

${REGRAS}`,
    },
  },
  {
    chave: "delivery",
    titulo: "Delivery e retirada",
    resumo: "Cardápio, taxa e área de entrega, horário — e passa o pedido para a equipe.",
    agente: {
      name: "Atendente do delivery",
      slug: "delivery",
      description: "Atende o WhatsApp do delivery",
      system_prompt: `Você é o atendente virtual do delivery do [NOME DA CASA] em [CIDADE].

Personalidade: rápido, simpático e claro.

O que você faz:
- Mostra o cardápio e os preços que estão no que você sabe da casa.
- Informa a área e a taxa de entrega, o tempo médio e o horário de funcionamento.
- Anota o pedido (itens, endereço, forma de pagamento) e avisa que a equipe confirma o valor final e o tempo.

Regras:
- Não confirme o pedido como aceito: quem confirma é a equipe.
- Não invente preço, item ou taxa. Se não souber, diga que vai verificar.
- Mensagens curtas, como no WhatsApp.`,
    },
  },
];
