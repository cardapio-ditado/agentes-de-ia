import { get, put } from "./api.js";
import { avisar, el } from "./ui.js";

/**
 * A ajuda do mentor: o botão "?" no topo de cada tela.
 *
 * Depois do desmame, a dúvida "para que serve isto mesmo?" aparece numa
 * terça à noite, sem ninguém para perguntar. A resposta curta está escrita
 * aqui, tela por tela, na língua do dono de restaurante; a longa é o vídeo
 * do mentor explicando aquela tela — gravado uma vez, igual para todas as
 * casas, cadastrado pela equipe Brasa Food no próprio botão.
 */

const TEXTOS = {
  hoje: ["A primeira tela do dia: o que espera por você e se os números de WhatsApp estão ligados.", "Comece pelo vermelho. Cada linha abre a tela onde se resolve."],
  trilha: ["O passo a passo da implantação. A maior parte o sistema marca sozinho quando fica pronto.", "Os passos com “marcar” são para o mentor confirmar: treino da equipe e o desmame."],
  empresa: ["Os dados da casa que todo módulo usa: nome, endereço, horário e fuso.", "O atendente responde o cliente com o que está aqui — mantenha o horário em dia."],
  pessoas: ["Quem entra no painel. Cada pessoa com o seu login, para o histórico ter dono.", "Gerente configura; Equipe só usa o dia a dia; Só leitura olha os números."],
  "canais-casa": ["Os números da casa, pelo que cada um faz: atender o cliente, avisar a equipe, mandar o parabéns.", "Bolinha verde é funcionando. Use “Mandar teste” para ter certeza de que chega."],
  integracoes: ["Os sistemas que a casa já usa e que o Brasa Food pode ler, como a Zig.", "Nada aqui é obrigatório: sem integração, o painel funciona igual."],
  organizacao: ["As unidades da rede e as chaves de acesso de máquinas.", "É coisa de implantação: no dia a dia ninguém precisa mexer."],
  painel: ["O movimento do atendente: conversas, reservas e mensagens da semana.", "Reserva na fila é cliente esperando — aprove ou recuse logo."],
  conversas: ["Tudo que o atendente conversou com cada cliente.", "Se precisar responder você mesmo, assuma a conversa: o atendente para de falar nela."],
  reservas: ["Os pedidos de reserva que o atendente anotou.", "Aprovar ou recusar manda a resposta para o cliente no WhatsApp."],
  programacao: ["Shows, jogos e promoções. É o que o atendente conta quando o cliente pergunta “o que tem hoje?”.", "Sem programação cadastrada, ele não tem o que dizer."],
  atendente: ["Quem é o atendente virtual: o jeito de falar, as regras e o que ele sabe da casa.", "Mudou algo? Teste na aba Testar antes de soltar para o cliente."],
  cardapio: ["O cardápio digital: itens com foto e preço, e o QR na mesa.", "Item acabou? Desative aqui que some do cardápio na hora."],
  rh: ["A ficha de cada pessoa da equipe e os documentos com validade.", "O sistema avisa antes de um documento vencer."],
  execucoes: ["Os checklists que a equipe fez: quem, quando, as fotos e o que a IA achou.", "Alerta da IA é o que merece um olhar seu."],
  checklists: ["As rotinas da equipe: abertura, fechamento, banheiro. O link sai no WhatsApp no horário.", "Comece por um modelo pronto e troque o que não serve."],
  "clientes-casa": ["Quem já esteve na casa, os aniversários e as mensagens em massa.", "O parabéns de aniversário é a mensagem que mais traz cliente de volta."],
  pesquisa: ["O que os clientes acham da casa: a nota, o que elogiam e o que criticam.", "Cliente insatisfeito de ontem ainda dá para recuperar com um telefonema."],
  avaliacoes: ["As avaliações do Google, com a resposta já escrita no tom da casa.", "Confira e aprove: a resposta sai publicada no Google."],
  "pesquisa-ajustes": ["O QR da mesa, a equipe que aparece na pesquisa, o prêmio e os convites.", "Imprima o QR e deixe em cada mesa."],
  compras: ["Os pedidos ao fornecedor e o recebimento da mercadoria.", "Tire foto da nota: a IA lê e vira entrada no estoque."],
  producao: ["Quando a cozinha produz uma receita (molho, massa), os ingredientes saem do estoque.", "Registre no dia em que produziu."],
  vendas: ["O que foi vendido baixa o estoque pelas receitas.", "Mande o relatório do caixa (ou ligue a Zig) e decida o que o sistema não reconheceu."],
  contagem: ["Contar o estoque de verdade. O contado vira o saldo, e a diferença aparece em reais.", "Conte sempre no mesmo dia da semana, antes de abrir."],
  estoque: ["Quanto tem de cada item, onde está, e tudo que entrou e saiu.", "Perda e transferência entre locais se lançam aqui."],
  "cmv-painel": ["Quanto do que a casa vendeu foi custo de mercadoria (o CMV), com a conta aberta.", "Para bar e restaurante, entre 28% e 35% é o comum."],
  "engenharia-cardapio": ["Cada prato pelo que vende e pelo que dá de lucro.", "Proteja o que vende e dá lucro; reprecifique o que vende e não dá."],
  cadastros: ["Os itens que a casa compra, as categorias e os fornecedores — a base de tudo.", "Use sempre o mesmo nome para o mesmo item: duplicado bagunça o estoque."],
  fichas: ["A receita de cada prato: o que ele consome e quanto custa.", "Com a receita pronta, cada venda baixa o estoque sozinha."],
};

let videos = null;

async function carregarVideos() {
  if (videos) return videos;
  try {
    videos = await get("/v1/ajuda");
  } catch {
    videos = {};
  }
  return videos;
}

/** Abre a ajuda da tela. `admin` mostra o campo para cadastrar o vídeo. */
export async function abrirAjuda({ pagina, rotulo, admin }) {
  const lista = await carregarVideos();
  const texto = TEXTOS[pagina] ?? ["Esta tela ainda não tem explicação escrita.", "Fale com o seu mentor."];
  const url = lista[pagina] ?? "";

  const janela = el("dialog", { classe: "ajuda" });
  const fechar = () => {
    janela.close();
    janela.remove();
  };
  janela.addEventListener("click", (e) => {
    if (e.target === janela) fechar(); // clique fora do quadro
  });
  janela.addEventListener("close", () => janela.remove());

  const campo = el("input", { value: url, placeholder: "https://youtu.be/…", inputmode: "url" });
  janela.append(
    el("div", { classe: "pilha" }, [
      el("div", { classe: "cabecalho-secao" }, [
        el("h2", { texto: rotulo }),
        el("button", { classe: "btn-icone", type: "button", "aria-label": "Fechar", texto: "✕", onclick: fechar }),
      ]),
      ...texto.map((t) => el("p", { texto: t })),
      url
        ? el("a", { classe: "btn btn-primario", href: url, target: "_blank", rel: "noopener", texto: "▶ Assistir o vídeo do mentor" })
        : el("p", { classe: "muted", texto: "O vídeo desta tela ainda não foi gravado." }),
      admin
        ? el("div", { classe: "detalhes-tecnicos pilha" }, [
            el("label", { classe: "muted", texto: "Link do vídeo desta tela (só a equipe Brasa Food vê este campo; vale para todas as casas)" }),
            el("div", { classe: "linha-campos" }, [
              campo,
              el("button", {
                classe: "btn",
                type: "button",
                texto: "Salvar link",
                onclick: async (e) => {
                  e.target.disabled = true;
                  try {
                    await put(`/v1/admin/ajuda/${encodeURIComponent(pagina)}`, { url: campo.value.trim() });
                    if (campo.value.trim()) lista[pagina] = campo.value.trim();
                    else delete lista[pagina];
                    avisar(campo.value.trim() ? "Vídeo salvo para esta tela." : "Vídeo retirado desta tela.", "ok");
                    fechar();
                  } catch (err) {
                    avisar(err.message, "erro");
                    e.target.disabled = false;
                  }
                },
              }),
            ]),
          ])
        : null,
    ]),
  );
  document.body.append(janela);
  janela.showModal();
}
