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

/**
 * Campanhas prontas: o primeiro disparo sem a página em branco.
 *
 * Casa com cinquenta mil clientes na base e nenhuma campanha enviada não
 * está sem público — está sem texto. Estas são as mensagens que bar e
 * restaurante mandam de verdade, já no formato que a Meta aprova.
 *
 * COMO ENCAIXAM NO NÚMERO OFICIAL. Mensagem que a casa inicia só sai por
 * modelo aprovado pela Meta, então a campanha pronta não é "o texto do
 * disparo": é o texto de um MODELO (para mandar aprovar uma vez) mais o
 * público sugerido e o que vai em cada lacuna. As lacunas são sempre as
 * mesmas três, de propósito:
 *
 *   {{1}} o primeiro nome · {{2}} o nome da casa · {{3}} um texto fixo
 *
 * O {{3}} é o que muda de uma semana para a outra (a oferta, a atração, o
 * jogo). Fica FORA do texto aprovado para a casa não esperar a Meta toda
 * vez que a programação muda: aprova uma vez, reusa sempre.
 *
 * O QUE OS TEXTOS EVITAM, porque a Meta rejeita: caixa alta, exclamações
 * em série, lacuna abrindo ou fechando a mensagem, bebida alcoólica. E não
 * prometem nada sozinhos — a oferta é a casa que escreve, no {{3}}.
 *
 * `publico` é o valor do seletor "Quem recebe" da tela; só existem os
 * grupos que o servidor conhece (selos do CRM, aniversariantes do mês, a
 * base inteira). "mes:atual" vira o mês corrente na hora de usar.
 *
 * Nada aqui é enviado sozinho: a campanha só preenche o formulário.
 */

const SAIR = "Responda SAIR para não receber mais mensagens.";
const NOME_CASA_E_TEXTO = [{ tipo: "primeiro_nome" }, { tipo: "casa" }, { tipo: "fixo", texto: "" }];

const campanha = (chave, titulo, resumo, publico, lacuna, exemplo, corpo, botoes = ["Quero reservar", "Agora não"]) => ({
  chave,
  titulo,
  resumo,
  publico,
  /** O que a casa escreve no {{3}} — a pergunta que o campo faz a ela. */
  lacuna,
  variaveis: NOME_CASA_E_TEXTO,
  modelo: {
    name: chave,
    corpo,
    // A Meta exige um exemplo por lacuna para revisar. O do {{3}} também
    // serve de dica na tela; não é enviado a ninguém.
    exemplos: ["Maria", "Casa de Exemplo", exemplo],
    botoes,
    rodape: SAIR,
  },
});

export const CAMPANHAS_PRONTAS = [
  campanha(
    "cliente_sumido",
    "Cliente sumido",
    "Chamar de volta quem vinha e parou. Costuma ser a campanha que mais traz gente.",
    "sumido",
    "O motivo para voltar, com a condição",
    "sobremesa por conta da casa na quinta-feira, para mesas a partir de 2 pessoas",
    "Oi, {{1}}, tudo bem? Faz um tempo que você não aparece no {{2}} e a gente sentiu a sua falta. Para te ver de novo, esta semana tem {{3}}. Quer que a gente guarde uma mesa para você?",
  ),
  campanha(
    "convite_vip",
    "Convite para os VIPs",
    "Avisar primeiro quem mais gasta na casa: novidade, noite especial, lugar garantido.",
    "vip",
    "A novidade, com dia e condição",
    "na sexta-feira tem menu novo do chef, com lugares limitados e reserva antecipada",
    "Oi, {{1}}. Você está entre os clientes que o {{2}} mais gosta de receber, e por isso fica sabendo antes: {{3}}. Quer que a gente reserve a sua mesa?",
  ),
  campanha(
    "veio_uma_vez",
    "Novo que não voltou",
    "Quem veio uma vez ainda não decidiu se volta. Um convite para a segunda visita.",
    "novo",
    "O que a pessoa ganha na segunda visita, com a condição",
    "a entrada é por nossa conta, de terça a quinta-feira, mostrando esta mensagem",
    "Oi, {{1}}. Obrigado por ter vindo conhecer o {{2}}. A gente quer te receber de novo, e na sua próxima visita {{3}}. Quer deixar uma mesa reservada?",
  ),
  campanha(
    "programacao_da_semana",
    "Programação da semana",
    "O que tem na casa nos próximos dias. Aprova uma vez e reusa toda semana, trocando só a programação.",
    "todos",
    "A programação, numa linha só",
    "quinta-feira tem música ao vivo, sexta-feira tem samba e domingo tem almoço em família",
    "Oi, {{1}}. A programação desta semana no {{2}} já saiu: {{3}}. Quer garantir a sua mesa?",
  ),
  campanha(
    "dia_de_jogo",
    "Dia de jogo",
    "Jogo no telão para quem é de casa. Troque só o jogo a cada rodada.",
    "fiel",
    "O jogo, o dia e a hora",
    "Brasil x Argentina, na terça-feira às 21h",
    "Oi, {{1}}. Tem jogo chegando e o {{2}} vai passar no telão: {{3}}. Quer que a gente guarde uma mesa para você e para a turma?",
  ),
  campanha(
    "aniversariante_do_mes",
    "Aniversariante do mês",
    "Um convite para quem faz aniversário neste mês comemorar na casa.",
    "mes:atual",
    "O que o aniversariante ganha, com a condição",
    "o aniversariante ganha a sobremesa, em mesas a partir de 4 pessoas, em qualquer dia do mês",
    "Oi, {{1}}. Este é o mês do seu aniversário e o {{2}} quer comemorar com você: {{3}}. Quer reservar a sua mesa?",
  ),
  campanha(
    "delivery_da_casa",
    "Delivery",
    "Contar a quem já é de casa que dá para pedir sem sair de casa.",
    "fiel",
    "O link do cardápio de delivery da casa",
    "https://exemplo.com.br/delivery",
    "Oi, {{1}}. Agora dá para pedir o {{2}} sem sair de casa. O pedido é feito direto com a gente, por aqui: {{3}} — é só escolher e acompanhar a entrega pelo celular.",
    [],
  ),
];

/** O valor do seletor "Quem recebe" para esta campanha, hoje. */
export function publicoDaCampanha(c, hoje = new Date()) {
  return c.publico === "mes:atual" ? `mes:${hoje.getMonth() + 1}` : c.publico;
}
