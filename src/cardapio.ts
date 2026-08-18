import { db } from "./supabase.js";

/**
 * Leitura do cardápio para o agente.
 *
 * O cardápio é cadastrado no módulo Cardápio Digital, no mesmo banco. Este
 * arquivo existe para o agente responder preço e disponibilidade a partir do
 * que o restaurante realmente cadastrou — em vez de inventar, que é o que ele
 * faz quando não tem a informação.
 *
 * Tudo aqui lê apenas itens ATIVOS. Item desativado é item que a casa não quer
 * vender hoje; oferecê-lo por WhatsApp gera cliente na porta pedindo algo que
 * não existe.
 */

export interface ItemDoCardapio {
  nome: string;
  descricao: string | null;
  /** Quantas pessoas o prato serve. É a pergunta mais feita numa mesa. */
  servePessoas: number | null;
  preco: number;
  categoria: string | null;
  grupo: string | null;
  /** Preço promocional em vigor agora, se houver. */
  promocao: { nome: string; preco: number } | null;
  variacoes: Array<{ grupo: string; obrigatorio: boolean; opcoes: Array<{ nome: string; adicional: number }> }>;
}

/** Uma linha do banco com os relacionamentos que buscamos. */
interface LinhaItem {
  name: string;
  description: string | null;
  descricao_agente: string | null;
  serve_pessoas: number | null;
  price: number;
  categories: { name: string; grupo: string | null } | null;
  promotion_items: Array<{
    promotional_price: number;
    promotions: {
      name: string;
      is_active: boolean;
      starts_at: string;
      ends_at: string;
      weekly_days: number[] | null;
    } | null;
  }> | null;
  item_variation_groups: Array<{
    name: string;
    required: boolean;
    item_variation_options: Array<{ name: string; price_modifier: number }> | null;
  }> | null;
}

const SELECAO = `
  name, description, descricao_agente, serve_pessoas, price,
  categories ( name, grupo ),
  promotion_items ( promotional_price, promotions ( name, is_active, starts_at, ends_at, weekly_days ) ),
  item_variation_groups ( name, required, item_variation_options ( name, price_modifier ) )
`;

/**
 * A promoção está valendo NESTE instante?
 *
 * Não basta o intervalo de datas: promoção pode ser só de certos dias da
 * semana ("quarta de macarrão"). Anunciar no domingo um preço que só vale na
 * quarta é o tipo de erro que o cliente descobre na hora de pagar.
 */
export function promocaoVigente(
  promocao: { is_active: boolean; starts_at: string; ends_at: string; weekly_days: number[] | null },
  agora: Date,
  timezone: string,
): boolean {
  if (!promocao.is_active) return false;

  const inicio = new Date(promocao.starts_at);
  const fim = new Date(promocao.ends_at);
  if (agora < inicio || agora > fim) return false;

  const dias = promocao.weekly_days;
  if (!dias || dias.length === 0) return true;

  // O dia da semana tem que ser lido no fuso da casa: às 22h de Cuiabá já é
  // outro dia em UTC, e a promoção de sexta sumiria na própria sexta à noite.
  const diaLocal = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" })
    .format(agora)
    .toLowerCase();
  const ordem = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return dias.includes(ordem.indexOf(diaLocal));
}

function converter(linha: LinhaItem, agora: Date, timezone: string): ItemDoCardapio {
  const emPromocao = (linha.promotion_items ?? [])
    .filter((p) => p.promotions && promocaoVigente(p.promotions, agora, timezone))
    // Mais de uma promoção no mesmo item: vale a mais barata para o cliente.
    .sort((a, b) => a.promotional_price - b.promotional_price)[0];

  return {
    nome: linha.name,
    // A descrição escrita para o agente vence a pública: uma foi feita para
    // fundamentar resposta, a outra para vender numa vitrine.
    descricao: linha.descricao_agente?.trim() || linha.description || null,
    servePessoas: linha.serve_pessoas ?? null,
    preco: Number(linha.price),
    categoria: linha.categories?.name ?? null,
    grupo: linha.categories?.grupo ?? null,
    promocao: emPromocao
      ? { nome: emPromocao.promotions!.name, preco: Number(emPromocao.promotional_price) }
      : null,
    variacoes: (linha.item_variation_groups ?? []).map((g) => ({
      grupo: g.name,
      obrigatorio: g.required,
      opcoes: (g.item_variation_options ?? []).map((o) => ({
        nome: o.name,
        adicional: Number(o.price_modifier),
      })),
    })),
  };
}

export async function listarCardapio(params: {
  venueId: string;
  timezone: string;
  categoria?: string;
  limite?: number;
}): Promise<ItemDoCardapio[]> {
  const consulta = db()
    .from("items")
    .select(SELECAO)
    .eq("venue_id", params.venueId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(params.limite ?? 200);

  const { data, error } = await consulta;
  if (error) throw new Error(`Falha ao carregar o cardápio: ${error.message}`);

  const agora = new Date();
  let itens = (data as unknown as LinhaItem[]).map((l) => converter(l, agora, params.timezone));

  // O filtro de categoria é feito aqui, e não no banco, porque o cliente diz
  // "bebidas" e a casa cadastrou "Bebidas Geladas". Comparação exata devolveria
  // vazio, e o agente concluiria que a casa não vende bebida.
  if (params.categoria) {
    const alvo = normalizar(params.categoria);
    itens = itens.filter(
      (i) =>
        (i.categoria && normalizar(i.categoria).includes(alvo)) ||
        (i.grupo && normalizar(i.grupo).includes(alvo)),
    );
  }
  return itens;
}

export async function buscarNoCardapio(params: {
  venueId: string;
  timezone: string;
  termo: string;
}): Promise<ItemDoCardapio[]> {
  const todos = await listarCardapio({ venueId: params.venueId, timezone: params.timezone });
  const alvo = normalizar(params.termo);

  // Busca em nome, descrição e categoria: o cliente pergunta "tem algo sem
  // glúten?" e a resposta pode estar na descrição, não no nome.
  return todos.filter((i) =>
    [i.nome, i.descricao ?? "", i.categoria ?? ""].some((campo) => normalizar(campo).includes(alvo)),
  );
}

export async function promocoesDeHoje(params: {
  venueId: string;
  timezone: string;
}): Promise<ItemDoCardapio[]> {
  const todos = await listarCardapio(params);
  return todos.filter((i) => i.promocao !== null);
}

/** Sem acento e em minúsculas: "Açaí" tem que casar com "acai". */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Como o item é apresentado ao modelo. */
export function descreverItem(item: ItemDoCardapio): string {
  const linhas: string[] = [];
  const preco = item.promocao
    ? `R$ ${item.promocao.preco.toFixed(2)} (promoção "${item.promocao.nome}" — de R$ ${item.preco.toFixed(2)})`
    : `R$ ${item.preco.toFixed(2)}`;

  const serve = item.servePessoas
    ? ` — serve ${item.servePessoas} ${item.servePessoas === 1 ? "pessoa" : "pessoas"}`
    : "";
  linhas.push(`- ${item.nome} — ${preco}${serve}`);
  if (item.descricao) linhas.push(`  ${item.descricao}`);
  for (const v of item.variacoes) {
    if (v.opcoes.length === 0) continue;
    const opcoes = v.opcoes
      .map((o) => (o.adicional > 0 ? `${o.nome} (+R$ ${o.adicional.toFixed(2)})` : o.nome))
      .join(", ");
    linhas.push(`  ${v.grupo}${v.obrigatorio ? " (escolha obrigatória)" : ""}: ${opcoes}`);
  }
  return linhas.join("\n");
}

/** Agrupa por categoria — é como o cliente pensa o cardápio. */
export function descreverCardapio(itens: ItemDoCardapio[]): string {
  if (itens.length === 0) return "";

  const porCategoria = new Map<string, ItemDoCardapio[]>();
  for (const item of itens) {
    const chave = item.categoria ?? "Outros";
    porCategoria.set(chave, [...(porCategoria.get(chave) ?? []), item]);
  }

  return [...porCategoria.entries()]
    .map(([categoria, lista]) => `${categoria}:\n${lista.map(descreverItem).join("\n")}`)
    .join("\n\n");
}
