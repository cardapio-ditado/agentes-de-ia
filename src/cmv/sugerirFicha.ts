import Anthropic from "@anthropic-ai/sdk";
import { anthropicConfig } from "./../config.js";

/**
 * Propõe a ficha técnica de um prato.
 *
 * É a peça que tira o cliente do zero. Montar duzentas fichas à mão é o
 * motivo número um de um módulo de CMV morrer na terceira semana: o dono
 * cadastra as dez primeiras, cansa, e o custo nunca fica pronto. Aqui ele
 * digita "Isca de tilápia", a IA propõe os ingredientes e as quantidades, e
 * o trabalho vira CORRIGIR em vez de LEMBRAR — que é uma tarefa muito mais
 * barata para quem cozinha.
 *
 * A sugestão NÃO vira custo sozinha. Ela só preenche a tela; a ficha nasce
 * com `confirmada_em` nulo, e o banco recusa produzir por ficha não
 * confirmada. Uma quantidade inventada pela IA que entrasse no custo sem
 * ninguém olhar contaminaria o preço de venda — e preço errado no cardápio
 * é dinheiro perdido em cada prato até alguém desconfiar.
 *
 * A IA escolhe insumo por NÚMERO, nunca por nome. Pedir o nome exato faz o
 * modelo parafrasear ("Tilápia filé" vira "filé de tilápia") e a escolha se
 * perde; o número é conferível, e índice fora da faixa vira aviso em vez de
 * ingrediente errado.
 */

/** O que já está cadastrado — o único vocabulário que a IA pode usar. */
export interface InsumoDoVocabulario {
  id: string;
  nome: string;
  unidade: string;
  categoria?: string | null;
}

export interface IngredienteSugerido {
  insumoId: string;
  nome: string;
  unidade: string;
  quantidade: number;
  observacao: string | null;
}

/** O que a receita pede e a casa não cadastrou. Vira botão de cadastrar. */
export interface FaltandoNoCadastro {
  nome: string;
  unidade: string;
  quantidade: number;
}

export interface FichaSugerida {
  rendimento: number;
  ingredientes: IngredienteSugerido[];
  faltando: FaltandoNoCadastro[];
  avisos: string[];
}

/**
 * O julgamento aqui é caro de errar e barato de fazer: uma chamada por
 * prato, algumas dezenas na vida de um cliente. Quantidade mal proposta que
 * passa despercebida vira custo errado no cardápio inteiro — vale o modelo
 * maior.
 */
const MODELO = "claude-opus-5";

/** Acima disto o vocabulário estoura o prompt sem melhorar a sugestão. */
const TETO_DO_VOCABULARIO = 400;

const FERRAMENTA = {
  name: "propor_ficha",
  description: "Propõe os ingredientes e as quantidades de uma receita.",
  input_schema: {
    type: "object" as const,
    properties: {
      rendimento: {
        type: "number",
        description: "Quantas porções este lote rende. Use 1 se a receita for de uma porção só.",
      },
      ingredientes: {
        type: "array",
        description: "Os ingredientes que EXISTEM na lista fornecida.",
        items: {
          type: "object",
          properties: {
            numero: {
              type: "integer",
              description: "O número do insumo na lista fornecida. Nunca invente um número fora dela.",
            },
            quantidade: {
              type: "number",
              description:
                "Quantidade TOTAL do lote, na unidade do insumo. Se o insumo é medido em kg e a receita pede 800 g, escreva 0.8.",
            },
            observacao: {
              type: ["string", "null"],
              description: 'Detalhe de preparo, curto: "peso limpo, sem espinha", "picada fina".',
            },
          },
          required: ["numero", "quantidade"],
        },
      },
      faltando: {
        type: "array",
        description:
          "Ingredientes que a receita precisa e NÃO existem na lista. Nunca substitua por um parecido — liste aqui.",
        items: {
          type: "object",
          properties: {
            nome: { type: "string", description: "Nome do ingrediente que falta cadastrar." },
            unidade: { type: "string", description: "Unidade em que ele costuma ser comprado: kg, L, un, cx." },
            quantidade: { type: "number", description: "Quanto o lote usaria, na unidade acima." },
          },
          required: ["nome", "unidade", "quantidade"],
        },
      },
      avisos: {
        type: "array",
        items: { type: "string" },
        description:
          "O que ficou incerto: prato ambíguo, variação regional, quantidade que depende do modo da casa. Vazio se a receita é padrão.",
      },
    },
    required: ["rendimento", "ingredientes", "faltando", "avisos"],
  },
};

const INSTRUCOES = `Você monta fichas técnicas para bares e restaurantes brasileiros. Conhece porcionamento de cozinha profissional: o que de fato vai no prato, e quanto.

Sua proposta é um PONTO DE PARTIDA para o cozinheiro corrigir — não a verdade da casa. Prefira a receita comum e honesta à receita elaborada.

Regras:
- Use SOMENTE insumos da lista fornecida, escolhendo pelo NÚMERO. Não invente número.
- A quantidade é a do LOTE INTEIRO, na unidade do insumo. O insumo em kg recebe 0.8, não "800 g". O insumo em unidade recebe 2, não "duas".
- O que a receita precisa e não está na lista vai em "faltando". NUNCA troque por um parecido: pôr leite no lugar de creme de leite muda o custo e o sabor, e ninguém vai perceber depois.
- Não inclua o que não é insumo de estoque: água da torneira, gelo feito na casa, tempero que a casa não compra separado.
- Sal, óleo e temperos básicos entram só se estiverem na lista — são baratos, mas somam no CMV do mês.
- Rendimento: pense em quanto uma cozinha produz de uma vez. Uma porção de petisco de bar serve 2 a 3 pessoas.
- Se o nome do prato for ambíguo ("Porção mista", "Executivo"), proponha a versão mais comum e diga a dúvida nos avisos.
- Não invente ingrediente para "completar" a receita. Ficha curta e certa vale mais que ficha longa e chutada.`;

export async function sugerirFicha(params: {
  prato: string;
  observacao?: string | null;
  vocabulario: InsumoDoVocabulario[];
}): Promise<FichaSugerida> {
  const prato = params.prato.trim();
  if (prato.length < 2) {
    throw new Error("Diga o nome do prato para a IA propor a ficha.");
  }
  if (params.vocabulario.length === 0) {
    throw new Error(
      "Cadastre alguns insumos antes: a IA monta a ficha com o que a casa compra, não com ingredientes genéricos.",
    );
  }

  const vocabulario = params.vocabulario.slice(0, TETO_DO_VOCABULARIO);
  const lista = vocabulario
    .map((i, n) => `${n}. ${i.nome} (${i.unidade})${i.categoria ? ` — ${i.categoria}` : ""}`)
    .join("\n");

  const { apiKey } = anthropicConfig();
  const anthropic = new Anthropic({ apiKey });

  const resposta = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 3000,
    system: INSTRUCOES,
    tools: [FERRAMENTA],
    // Sem isto o modelo às vezes responde a receita em prosa, e a tela fica
    // sem o que preencher.
    tool_choice: { type: "tool", name: "propor_ficha" },
    messages: [
      {
        role: "user",
        content: `Prato: ${prato}${params.observacao?.trim() ? `\nComo a casa faz: ${params.observacao.trim()}` : ""}

Insumos cadastrados nesta casa (escolha pelo número):
${lista}`,
      },
    ],
  });

  const uso = resposta.content.find((b) => b.type === "tool_use");
  if (!uso || uso.type !== "tool_use") {
    throw new Error("A IA não conseguiu propor a ficha. Tente de novo, ou monte à mão.");
  }

  return converter(uso.input as Record<string, unknown>, vocabulario);
}

/**
 * Traduz a resposta do modelo, descartando o que não serve.
 *
 * Exportada para teste: é aqui que mora a regra sobre o que é um
 * ingrediente aproveitável, e testá-la não deveria custar uma chamada de
 * API.
 */
export function converter(
  bruto: Record<string, unknown>,
  vocabulario: InsumoDoVocabulario[],
): FichaSugerida {
  const avisos = Array.isArray(bruto.avisos) ? bruto.avisos.map(String) : [];

  const rendimentoBruto = Number(bruto.rendimento);
  const rendimento = Number.isFinite(rendimentoBruto) && rendimentoBruto > 0 ? rendimentoBruto : 1;
  if (rendimento !== rendimentoBruto) {
    avisos.push("A IA não disse quantas porções o lote rende — assumi 1. Corrija se for diferente.");
  }

  const ingredientes: IngredienteSugerido[] = [];
  const jaUsados = new Set<string>();

  for (const cru of (Array.isArray(bruto.ingredientes) ? bruto.ingredientes : []) as Array<
    Record<string, unknown>
  >) {
    const numero = Number(cru.numero);
    const quantidade = Number(cru.quantidade);

    // Índice fora da lista é o modelo inventando: vira aviso, nunca
    // ingrediente. Escolher "o mais parecido" aqui poria no prato um insumo
    // que ninguém pediu.
    if (!Number.isInteger(numero) || numero < 0 || numero >= vocabulario.length) {
      avisos.push("A IA sugeriu um ingrediente que não está no cadastro e ele foi ignorado.");
      continue;
    }
    const insumo = vocabulario[numero]!;

    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      avisos.push(`"${insumo.nome}": a IA não deu uma quantidade utilizável — preencha à mão.`);
      continue;
    }
    // Repetido soma em vez de virar duas linhas do mesmo insumo, que na tela
    // parecem dois ingredientes diferentes.
    if (jaUsados.has(insumo.id)) {
      const anterior = ingredientes.find((i) => i.insumoId === insumo.id)!;
      anterior.quantidade += quantidade;
      continue;
    }
    jaUsados.add(insumo.id);

    ingredientes.push({
      insumoId: insumo.id,
      nome: insumo.nome,
      unidade: insumo.unidade,
      quantidade,
      observacao:
        typeof cru.observacao === "string" && cru.observacao.trim() ? cru.observacao.trim() : null,
    });
  }

  const faltando: FaltandoNoCadastro[] = [];
  for (const cru of (Array.isArray(bruto.faltando) ? bruto.faltando : []) as Array<
    Record<string, unknown>
  >) {
    const nome = typeof cru.nome === "string" ? cru.nome.trim() : "";
    if (!nome) continue;
    const quantidade = Number(cru.quantidade);
    faltando.push({
      nome,
      unidade: typeof cru.unidade === "string" && cru.unidade.trim() ? cru.unidade.trim() : "un",
      quantidade: Number.isFinite(quantidade) && quantidade > 0 ? quantidade : 0,
    });
  }

  if (ingredientes.length === 0) {
    avisos.push("Nenhum ingrediente da receita está cadastrado ainda. Cadastre os que faltam e peça de novo.");
  }

  return { rendimento, ingredientes, faltando, avisos };
}
