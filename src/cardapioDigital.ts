import { db, ehMigracaoPendente } from "./supabase.js";
import { inserirAvisos } from "./notifications.js";
import { promocaoVigente } from "./cardapio.js";
import { hojeNaCasa } from "./fuso.js";
import type { Venue } from "./venues.js";

/**
 * O cardápio digital, dentro do Brasa Food.
 *
 * Duas portas para as mesmas tabelas. A PÚBLICA é o que o cliente abre pelo
 * QR da mesa: lê o cardápio, curte, comenta e chama o garçom — sem login, e
 * por isso com limite de ritmo e com tudo que ele escreve entrando como
 * "pendente". A do PAINEL é o que a casa mexe: categorias, itens, fotos,
 * vídeo, banners, promoções e a fila de comentários para liberar.
 *
 * As tabelas (`categories`, `items`, `item_media`, `banners`, `promotions`,
 * `feedbacks`, `mesas`…) vieram do app antigo e os nomes ficaram: renomear
 * custaria o histórico de quem já cadastrou cardápio lá.
 *
 * `database.types.ts` não conhece a maioria delas — foram criadas pelo app
 * antigo e pela migração multi-cliente, e os tipos só são regerados depois.
 * Daí o `cliente()` sem tipo, como no CMV: são tabelas inteiras, não uma
 * coluna aqui e outra ali.
 */

export class ErroDoCardapio extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDoCardapio";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cliente = () => db() as any;

/** "Este objeto ainda não existe" vira uma mensagem que o dono entende. */
function falhar(status: number, contexto: string, mensagem: string): never {
  if (ehMigracaoPendente(mensagem)) {
    throw new ErroDoCardapio(
      503,
      `${contexto}: o banco ainda não recebeu a migração do cardápio. Rode o SQL e tente de novo.`,
    );
  }
  throw new ErroDoCardapio(status, `${contexto}: ${mensagem}`);
}

// ============================================================
// Limite de ritmo para as rotas públicas
// ============================================================

/**
 * Quantas vezes uma chave (IP + ação) pode agir numa janela de tempo.
 *
 * Mora na memória do processo. Na Vercel cada instância tem a sua, então o
 * limite real é "N por instância" — mais folgado que o número, mas o bastante
 * para o que ele existe: um celular na mesa não manda 30 comentários por
 * minuto, e um script que tente enche o próprio balde em segundos. Não é a
 * trava contra ataque sério (essa é o firewall da plataforma); é a rede de
 * baixo que impede a fila de moderação de virar lixo por descuido.
 */
export class LimiteDeRitmo {
  private readonly batidas = new Map<string, number[]>();

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
  ) {}

  permitir(chave: string, agora = Date.now()): boolean {
    const recentes = (this.batidas.get(chave) ?? []).filter((t) => agora - t < this.janelaMs);
    if (recentes.length >= this.maximo) {
      this.batidas.set(chave, recentes);
      return false;
    }
    recentes.push(agora);
    this.batidas.set(chave, recentes);
    // O mapa não pode crescer para sempre: a cada batida, uma varredura
    // barata tira quem já saiu da janela.
    if (this.batidas.size > 5000) {
      for (const [k, v] of this.batidas) {
        if (v.every((t) => agora - t >= this.janelaMs)) this.batidas.delete(k);
      }
    }
    return true;
  }
}

export const LIMITES = {
  curtir: new LimiteDeRitmo(60, 60_000),
  comentar: new LimiteDeRitmo(5, 10 * 60_000),
  garcom: new LimiteDeRitmo(6, 5 * 60_000),
};

// ============================================================
// Leitura pública
// ============================================================

export interface MidiaDoItem {
  id: string;
  url: string;
  tipo: "image" | "video";
}

export interface ItemPublico {
  id: string;
  categoria_id: string | null;
  nome: string;
  descricao: string;
  preco: number;
  /** Preço em vigor agora, quando alguma promoção vale hoje. */
  promocao: { nome: string; preco: number } | null;
  destaque: boolean;
  capa: string | null;
  video: string | null;
  midias: MidiaDoItem[];
  variacoes: Array<{
    id: string;
    nome: string;
    obrigatorio: boolean;
    opcoes: Array<{ id: string; nome: string; adicional: number }>;
  }>;
  etiquetas: string[];
  alergenicos: string[];
  serve: number | null;
  curtidas: number;
  comentarios: number;
}

export interface CardapioPublico {
  casa: {
    id: string;
    slug: string;
    nome: string;
    cidade: string | null;
    horario_hoje: string | null;
  };
  categorias: Array<{
    id: string;
    nome: string;
    grupo: "comer" | "beber";
    descricao: string;
    imagem: string | null;
  }>;
  itens: ItemPublico[];
  banners: Array<{
    id: string;
    titulo: string;
    subtitulo: string;
    imagem: string | null;
    video: string | null;
    chamada: string;
    link_tipo: string;
    link_valor: string;
  }>;
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

/** "18h às 2h" do dia de hoje no calendário da casa, ou null se não há. */
export function horarioDeHoje(venue: Pick<Venue, "opening_hours" | "timezone">, agora = new Date()): string | null {
  const horarios = venue.opening_hours;
  if (!horarios || typeof horarios !== "object" || Array.isArray(horarios)) return null;
  const hoje = hojeNaCasa(venue.timezone, agora);
  const dia = DIAS[new Date(`${hoje}T12:00:00Z`).getUTCDay()]!;
  const valor = (horarios as Record<string, unknown>)[dia];
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** A cidade, a partir do endereço livre: "Rua X, 10 - Centro, Cuiabá - MT". */
export function cidadeDoEndereco(endereco: string | null | undefined): string | null {
  const texto = String(endereco ?? "").trim();
  if (!texto) return null;
  // O último pedaço antes do estado costuma ser a cidade. Sem estado, é o
  // último pedaço mesmo. É um palpite bom para endereço brasileiro escrito à
  // mão; quando erra, mostra um bairro — nunca algo ofensivo ou vazio.
  const semCep = texto.replace(/\b\d{5}-?\d{3}\b/g, "").trim();
  const pedacos = semCep.split(/[,\n]+/).map((p) => p.trim()).filter(Boolean);
  if (pedacos.length === 0) return null;
  const ultimo = pedacos[pedacos.length - 1]!;
  const semEstado = ultimo.replace(/\s*[-–/]\s*[A-Z]{2}\s*$/, "").trim();
  return semEstado || null;
}

export function grupoValido(bruto: unknown): "comer" | "beber" {
  return String(bruto ?? "").trim().toLowerCase() === "beber" ? "beber" : "comer";
}

/** O cardápio inteiro, como a página pública o desenha. */
export async function cardapioPublico(venue: Venue, agora = new Date()): Promise<CardapioPublico> {
  const [categorias, itens, banners, comentarios] = await Promise.all([
    cliente()
      .from("categories")
      .select("id, name, grupo, description, image_url, sort_order")
      .eq("venue_id", venue.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    cliente()
      .from("items")
      .select(
        `id, category_id, name, description, price, tags, allergens, serve_pessoas,
         cover_image_url, cover_video_url, is_featured, sort_order, likes_count,
         item_media ( id, url, type, sort_order ),
         item_variation_groups ( id, name, required, sort_order,
           item_variation_options ( id, name, price_modifier, sort_order ) ),
         promotion_items ( promotional_price,
           promotions ( name, is_active, starts_at, ends_at, weekly_days ) )`,
      )
      .eq("venue_id", venue.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    cliente()
      .from("banners")
      .select("id, title, subtitle, image_url, video_url, cta_text, link_type, link_value, sort_order, starts_at, ends_at")
      .eq("venue_id", venue.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    cliente().from("feedbacks").select("item_id").eq("venue_id", venue.id).eq("status", "approved"),
  ]);

  for (const [nome, r] of [
    ["categorias", categorias],
    ["itens", itens],
    ["banners", banners],
    ["comentários", comentarios],
  ] as const) {
    if (r.error) falhar(500, `Falha ao ler ${nome}`, r.error.message);
  }

  const liberadosPorItem = new Map<string, number>();
  for (const f of comentarios.data ?? []) {
    if (f.item_id) liberadosPorItem.set(f.item_id, (liberadosPorItem.get(f.item_id) ?? 0) + 1);
  }

  const porOrdem = <T extends { sort_order?: number | null }>(a: T, b: T) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0);

  return {
    casa: {
      id: venue.id,
      slug: venue.slug,
      nome: venue.name,
      cidade: cidadeDoEndereco(venue.address),
      horario_hoje: horarioDeHoje(venue, agora),
    },
    categorias: (categorias.data ?? []).map((c: Record<string, unknown>) => ({
      id: String(c.id),
      nome: String(c.name),
      grupo: grupoValido(c.grupo),
      descricao: String(c.description ?? ""),
      imagem: (c.image_url as string) || null,
    })),
    itens: (itens.data ?? []).map((i: Record<string, unknown>): ItemPublico => {
      const midias = ([...((i.item_media as Array<Record<string, unknown>>) ?? [])] as Array<Record<string, unknown>>)
        .sort(porOrdem as never)
        .map((m) => ({ id: String(m.id), url: String(m.url), tipo: m.type === "video" ? ("video" as const) : ("image" as const) }));
      const capa = (i.cover_image_url as string) || midias.find((m) => m.tipo === "image")?.url || null;
      const video = (i.cover_video_url as string) || midias.find((m) => m.tipo === "video")?.url || null;

      const emPromocao = (((i.promotion_items as Array<Record<string, unknown>>) ?? []) as Array<{
        promotional_price: number;
        promotions: { name: string; is_active: boolean; starts_at: string; ends_at: string; weekly_days: number[] | null } | null;
      }>)
        .filter((p) => p.promotions && promocaoVigente(p.promotions, agora, venue.timezone))
        .sort((a, b) => Number(a.promotional_price) - Number(b.promotional_price))[0];

      return {
        id: String(i.id),
        categoria_id: (i.category_id as string) ?? null,
        nome: String(i.name),
        descricao: String(i.description ?? ""),
        preco: Number(i.price),
        promocao: emPromocao
          ? { nome: emPromocao.promotions!.name, preco: Number(emPromocao.promotional_price) }
          : null,
        destaque: Boolean(i.is_featured),
        capa,
        video,
        midias,
        variacoes: ([...((i.item_variation_groups as Array<Record<string, unknown>>) ?? [])] as Array<Record<string, unknown>>)
          .sort(porOrdem as never)
          .map((g) => ({
            id: String(g.id),
            nome: String(g.name ?? ""),
            obrigatorio: Boolean(g.required),
            opcoes: ([...((g.item_variation_options as Array<Record<string, unknown>>) ?? [])] as Array<Record<string, unknown>>)
              .sort(porOrdem as never)
              .map((o) => ({ id: String(o.id), nome: String(o.name ?? ""), adicional: Number(o.price_modifier ?? 0) })),
          })),
        etiquetas: Array.isArray(i.tags) ? (i.tags as string[]) : [],
        alergenicos: Array.isArray(i.allergens) ? (i.allergens as string[]) : [],
        serve: i.serve_pessoas == null ? null : Number(i.serve_pessoas),
        curtidas: Number(i.likes_count ?? 0),
        comentarios: liberadosPorItem.get(String(i.id)) ?? 0,
      };
    }),
    banners: (banners.data ?? [])
      .filter((b: Record<string, unknown>) => {
        // A janela de exibição: banner de "quinta é dia de samba" some na
        // sexta sem ninguém precisar lembrar de apagar.
        const inicio = b.starts_at ? new Date(String(b.starts_at)) : null;
        const fim = b.ends_at ? new Date(String(b.ends_at)) : null;
        if (inicio && agora < inicio) return false;
        if (fim && agora > fim) return false;
        return Boolean(b.image_url || b.video_url);
      })
      .map((b: Record<string, unknown>) => ({
        id: String(b.id),
        titulo: String(b.title ?? ""),
        subtitulo: String(b.subtitle ?? ""),
        imagem: (b.image_url as string) || null,
        video: (b.video_url as string) || null,
        chamada: String(b.cta_text ?? ""),
        link_tipo: String(b.link_type ?? "none"),
        link_valor: String(b.link_value ?? ""),
      })),
  };
}

// ============================================================
// Curtida
// ============================================================

export async function curtirItem(params: {
  venueId: string;
  itemId: string;
  desfazer?: boolean;
}): Promise<{ curtidas: number }> {
  const { data, error } = await cliente().rpc("cardapio_curtir", {
    p_venue_id: params.venueId,
    p_item_id: params.itemId,
    p_delta: params.desfazer ? -1 : 1,
  });
  if (error) falhar(500, "Falha ao curtir", error.message);
  if (data === null || data === undefined) throw new ErroDoCardapio(404, "Item não encontrado.");
  return { curtidas: Number(data) };
}

// ============================================================
// Comentários: o cliente escreve, a casa libera
// ============================================================

export interface Comentario {
  id: string;
  item_id: string | null;
  item_nome: string | null;
  autor: string;
  nota: number | null;
  texto: string;
  status: "pending" | "approved" | "rejected";
  criado_em: string;
  moderado_em: string | null;
  nota_moderacao: string;
}

/** Só o primeiro nome e a inicial: "Mariana Souza" vira "Mariana S." */
export function nomeParaExibir(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes[0]} ${partes[partes.length - 1]![0]!.toUpperCase()}.`;
}

export function validarComentario(corpo: { nome?: unknown; nota?: unknown; texto?: unknown }): {
  nome: string;
  nota: number;
  texto: string;
} {
  const nome = String(corpo.nome ?? "").trim().replace(/\s+/g, " ");
  const texto = String(corpo.texto ?? "").trim();
  const nota = Number(corpo.nota);
  if (nome.length < 2 || nome.length > 40) {
    throw new ErroDoCardapio(400, "Escreva seu nome (2 a 40 letras).");
  }
  if (texto.length < 3 || texto.length > 280) {
    throw new ErroDoCardapio(400, "O comentário precisa ter de 3 a 280 caracteres.");
  }
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
    throw new ErroDoCardapio(400, "Dê uma nota de 1 a 5 estrelas.");
  }
  // Link em comentário público é o formato clássico de spam; o cliente que
  // quer indicar um site não é o caso comum de um cardápio.
  if (/https?:\/\/|www\./i.test(texto)) {
    throw new ErroDoCardapio(400, "Comentário não pode ter link.");
  }
  return { nome, nota, texto };
}

export async function comentarItem(params: {
  venueId: string;
  itemId: string;
  nome: string;
  nota: number;
  texto: string;
}): Promise<{ id: string; status: "pending" }> {
  const item = await cliente()
    .from("items")
    .select("id")
    .eq("id", params.itemId)
    .eq("venue_id", params.venueId)
    .eq("is_active", true)
    .maybeSingle();
  if (item.error) falhar(500, "Falha ao localizar o item", item.error.message);
  if (!item.data) throw new ErroDoCardapio(404, "Item não encontrado.");

  const { data, error } = await cliente()
    .from("feedbacks")
    .insert({
      venue_id: params.venueId,
      item_id: params.itemId,
      author_name: params.nome,
      rating: params.nota,
      content: params.texto,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) falhar(500, "Falha ao guardar o comentário", error.message);
  return { id: String(data.id), status: "pending" };
}

/** Os comentários que a casa liberou para um item, do mais novo ao mais velho. */
export async function comentariosLiberados(
  venueId: string,
  itemId: string,
): Promise<Array<{ id: string; autor: string; nota: number | null; texto: string; criado_em: string }>> {
  const { data, error } = await cliente()
    .from("feedbacks")
    .select("id, author_name, rating, content, created_at")
    .eq("venue_id", venueId)
    .eq("item_id", itemId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) falhar(500, "Falha ao ler os comentários", error.message);
  return (data ?? []).map((c: Record<string, unknown>) => ({
    id: String(c.id),
    autor: nomeParaExibir(String(c.author_name ?? "")),
    nota: c.rating == null ? null : Number(c.rating),
    texto: String(c.content ?? ""),
    criado_em: String(c.created_at),
  }));
}

export async function listarComentarios(
  venueId: string,
  status: "pending" | "approved" | "rejected",
): Promise<Comentario[]> {
  const { data, error } = await cliente()
    .from("feedbacks")
    .select("id, item_id, author_name, rating, content, status, created_at, moderated_at, moderation_note, items ( name )")
    .eq("venue_id", venueId)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) falhar(500, "Falha ao listar os comentários", error.message);
  return (data ?? []).map((c: Record<string, unknown>) => ({
    id: String(c.id),
    item_id: (c.item_id as string) ?? null,
    item_nome: ((c.items as { name?: string } | null)?.name as string) ?? null,
    autor: String(c.author_name ?? ""),
    nota: c.rating == null ? null : Number(c.rating),
    texto: String(c.content ?? ""),
    status: c.status as Comentario["status"],
    criado_em: String(c.created_at),
    moderado_em: (c.moderated_at as string) ?? null,
    nota_moderacao: String(c.moderation_note ?? ""),
  }));
}

export async function moderarComentario(params: {
  venueId: string;
  id: string;
  decisao: "approved" | "rejected";
  /** Quem decidiu, para o histórico. É o e-mail do painel. */
  quem: string;
  userId: string | null;
}): Promise<{ id: string; status: string }> {
  const { data, error } = await cliente()
    .from("feedbacks")
    .update({
      status: params.decisao,
      moderated_at: new Date().toISOString(),
      // `moderated_by` aponta para auth.users; chave de máquina não tem. O
      // nome vai na nota para o histórico não ficar mudo nesse caso.
      moderated_by: params.userId,
      moderation_note: params.quem,
    })
    .eq("id", params.id)
    .eq("venue_id", params.venueId)
    .select("id, status")
    .maybeSingle();
  if (error) falhar(500, "Falha ao moderar", error.message);
  if (!data) throw new ErroDoCardapio(404, "Comentário não encontrado.");
  return { id: String(data.id), status: String(data.status) };
}

export async function contarComentariosPendentes(venueId: string): Promise<number> {
  const { count, error } = await cliente()
    .from("feedbacks")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .eq("status", "pending");
  if (error) {
    if (ehMigracaoPendente(error.message)) return 0;
    falhar(500, "Falha ao contar comentários", error.message);
  }
  return count ?? 0;
}

// ============================================================
// Chamar o garçom
// ============================================================

export async function chamarGarcom(params: {
  venue: Venue;
  mesa: string | null;
  pedido: string | null;
}): Promise<{ registrado: boolean; avisado: boolean }> {
  const numeroDaMesa = Number.parseInt(String(params.mesa ?? "").replace(/\D/g, ""), 10);
  const mesa = Number.isFinite(numeroDaMesa) ? numeroDaMesa : 0;

  let registrado = false;
  const evento = await cliente().from("mesa_eventos").insert({
    venue_id: params.venue.id,
    mesa_numero: mesa,
    tipo: "chamou_garcom",
    item_nome: params.pedido ? params.pedido.slice(0, 200) : null,
  });
  if (evento.error) {
    if (!ehMigracaoPendente(evento.error.message)) {
      console.error(`[cardapio] chamado de mesa não entrou: ${evento.error.message}`);
    }
  } else {
    registrado = true;
  }

  // O aviso vai para o WhatsApp de quem cuida da casa — o mesmo número que
  // recebe reserva nova. Sem número cadastrado, fica só o registro.
  const destino = (params.venue.reservas_avisar_whatsapp ?? "").trim();
  if (!destino) return { registrado, avisado: false };

  const linhas = [
    `🛎️ ${mesa ? `Mesa ${mesa}` : "Uma mesa"} chamou o garçom — ${params.venue.name}.`,
  ];
  if (params.pedido) linhas.push(``, `Quer pedir: ${params.pedido.slice(0, 200)}`);

  const { error } = await inserirAvisos({
    venue_id: params.venue.id,
    channel: "whatsapp",
    destination: destino,
    template: "cardapio_chamou_garcom",
    papel: "administrativo",
    body: linhas.join("\n"),
  });
  if (error) {
    console.error(`[cardapio] aviso de chamado não entrou: ${error.message}`);
    return { registrado, avisado: false };
  }
  return { registrado, avisado: true };
}

// ============================================================
// Painel: categorias
// ============================================================

/** "Na brasa" vira "na-brasa"; "Chopp & Cerveja" vira "chopp-cerveja". */
export function slugDe(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}

/** Um slug que ainda não existe nesta casa, nesta tabela. */
async function slugLivre(tabela: "categories" | "items", venueId: string, nome: string, ignorarId?: string): Promise<string> {
  const base = slugDe(nome);
  const { data, error } = await cliente()
    .from(tabela)
    .select("id, slug")
    .eq("venue_id", venueId)
    .like("slug", `${base}%`);
  if (error) falhar(500, "Falha ao conferir o nome", error.message);
  const usados = new Set(
    (data ?? []).filter((l: { id: string }) => l.id !== ignorarId).map((l: { slug: string }) => l.slug),
  );
  if (!usados.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    if (!usados.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

export interface DadosDaCategoria {
  nome?: string;
  grupo?: string;
  descricao?: string;
  ativa?: boolean;
}

function textoCurto(valor: unknown, campo: string, maximo: number): string {
  const texto = String(valor ?? "").trim();
  if (texto.length > maximo) {
    throw new ErroDoCardapio(400, `${campo} pode ter no máximo ${maximo} caracteres.`);
  }
  return texto;
}

export async function listarCategoriasDoPainel(venueId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await cliente()
    .from("categories")
    .select("id, name, slug, grupo, description, image_url, sort_order, is_active")
    .eq("venue_id", venueId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) falhar(500, "Falha ao listar categorias", error.message);
  return (data ?? []).map((c: Record<string, unknown>) => ({
    id: c.id,
    nome: c.name,
    slug: c.slug,
    grupo: grupoValido(c.grupo),
    descricao: c.description ?? "",
    imagem: c.image_url || null,
    ordem: c.sort_order ?? 0,
    ativa: c.is_active !== false,
  }));
}

export async function criarCategoria(venueId: string, dados: DadosDaCategoria): Promise<{ id: string }> {
  const nome = textoCurto(dados.nome, "O nome", 60);
  if (!nome) throw new ErroDoCardapio(400, "A categoria precisa de um nome.");

  const ultima = await cliente()
    .from("categories")
    .select("sort_order")
    .eq("venue_id", venueId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ordem = Number(ultima.data?.sort_order ?? -1) + 1;

  const { data, error } = await cliente()
    .from("categories")
    .insert({
      venue_id: venueId,
      name: nome,
      slug: await slugLivre("categories", venueId, nome),
      grupo: grupoValido(dados.grupo),
      description: textoCurto(dados.descricao, "A descrição", 200),
      sort_order: ordem,
      is_active: dados.ativa !== false,
    })
    .select("id")
    .single();
  if (error) falhar(500, "Falha ao criar a categoria", error.message);
  return { id: String(data.id) };
}

export async function atualizarCategoria(venueId: string, id: string, dados: DadosDaCategoria): Promise<void> {
  const mudancas: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (dados.nome !== undefined) {
    const nome = textoCurto(dados.nome, "O nome", 60);
    if (!nome) throw new ErroDoCardapio(400, "A categoria precisa de um nome.");
    mudancas.name = nome;
    mudancas.slug = await slugLivre("categories", venueId, nome, id);
  }
  if (dados.grupo !== undefined) mudancas.grupo = grupoValido(dados.grupo);
  if (dados.descricao !== undefined) mudancas.description = textoCurto(dados.descricao, "A descrição", 200);
  if (dados.ativa !== undefined) mudancas.is_active = Boolean(dados.ativa);

  const { data, error } = await cliente()
    .from("categories")
    .update(mudancas)
    .eq("id", id)
    .eq("venue_id", venueId)
    .select("id")
    .maybeSingle();
  if (error) falhar(500, "Falha ao salvar a categoria", error.message);
  if (!data) throw new ErroDoCardapio(404, "Categoria não encontrada.");
}

export async function apagarCategoria(venueId: string, id: string): Promise<void> {
  // Os itens ficam, sem categoria: apagar a categoria "Petiscos" não pode
  // sumir com quarenta pratos que alguém passou uma tarde cadastrando.
  const { error } = await cliente().from("categories").delete().eq("id", id).eq("venue_id", venueId);
  if (error) falhar(500, "Falha ao apagar a categoria", error.message);
}

/** Grava a ordem que a tela mandou: a posição na lista vira `sort_order`. */
export async function reordenar(tabela: "categories" | "items" | "banners", venueId: string, ids: unknown): Promise<void> {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new ErroDoCardapio(400, "Mande a lista de ids na ordem nova.");
  }
  // Um update por linha. Lista de cardápio tem dezenas de itens, não milhares;
  // e a alternativa (upsert em lote) exigiria mandar todas as colunas.
  for (const [posicao, id] of (ids as string[]).entries()) {
    const { error } = await cliente()
      .from(tabela)
      .update({ sort_order: posicao })
      .eq("id", id)
      .eq("venue_id", venueId);
    if (error) falhar(500, "Falha ao reordenar", error.message);
  }
}

// ============================================================
// Painel: itens
// ============================================================

export interface DadosDoItem {
  nome?: string;
  categoria_id?: string | null;
  descricao?: string;
  preco?: number;
  etiquetas?: string[];
  alergenicos?: string[];
  serve?: number | null;
  destaque?: boolean;
  ativo?: boolean;
  descricao_agente?: string;
}

function listaDeTextos(bruto: unknown, campo: string): string[] {
  if (bruto === undefined || bruto === null) return [];
  const lista = Array.isArray(bruto) ? bruto : String(bruto).split(",");
  const limpa = lista.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  if (limpa.length > 12) throw new ErroDoCardapio(400, `${campo}: no máximo 12.`);
  return [...new Set(limpa)];
}

function precoValido(bruto: unknown): number {
  const n = Number(String(bruto ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100_000) {
    throw new ErroDoCardapio(400, "Preço inválido. Use números, por exemplo 42 ou 42,90.");
  }
  return Math.round(n * 100) / 100;
}

function colunasDoItem(dados: DadosDoItem): Record<string, unknown> {
  const colunas: Record<string, unknown> = {};
  if (dados.nome !== undefined) {
    const nome = textoCurto(dados.nome, "O nome", 80);
    if (!nome) throw new ErroDoCardapio(400, "O item precisa de um nome.");
    colunas.name = nome;
  }
  if (dados.categoria_id !== undefined) colunas.category_id = dados.categoria_id || null;
  if (dados.descricao !== undefined) colunas.description = textoCurto(dados.descricao, "A descrição", 400);
  if (dados.preco !== undefined) colunas.price = precoValido(dados.preco);
  if (dados.etiquetas !== undefined) colunas.tags = listaDeTextos(dados.etiquetas, "Etiquetas");
  if (dados.alergenicos !== undefined) colunas.allergens = listaDeTextos(dados.alergenicos, "Alergênicos");
  if (dados.serve !== undefined) {
    const n = dados.serve === null || dados.serve === ("" as unknown) ? null : Number(dados.serve);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 50)) {
      throw new ErroDoCardapio(400, "\"Serve\" precisa ser um número de pessoas entre 1 e 50.");
    }
    colunas.serve_pessoas = n;
  }
  if (dados.destaque !== undefined) colunas.is_featured = Boolean(dados.destaque);
  if (dados.ativo !== undefined) colunas.is_active = Boolean(dados.ativo);
  if (dados.descricao_agente !== undefined) {
    colunas.descricao_agente = textoCurto(dados.descricao_agente, "A descrição para o agente", 600) || null;
  }
  return colunas;
}

export async function listarItensDoPainel(venueId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await cliente()
    .from("items")
    .select(
      `id, category_id, name, slug, description, price, tags, allergens, serve_pessoas,
       cover_image_url, cover_video_url, is_featured, is_active, sort_order, likes_count, descricao_agente,
       item_media ( id, url, type, sort_order ),
       item_variation_groups ( id, name, required, sort_order,
         item_variation_options ( id, name, price_modifier, sort_order ) )`,
    )
    .eq("venue_id", venueId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) falhar(500, "Falha ao listar itens", error.message);

  const porOrdem = (a: { sort_order?: number }, b: { sort_order?: number }) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
  return (data ?? []).map((i: Record<string, unknown>) => {
    const midias = ([...((i.item_media as Array<Record<string, unknown>>) ?? [])] as Array<Record<string, unknown>>)
      .sort(porOrdem as never)
      .map((m) => ({ id: m.id, url: m.url, tipo: m.type === "video" ? "video" : "image" }));
    return {
      id: i.id,
      categoria_id: i.category_id ?? null,
      nome: i.name,
      slug: i.slug,
      descricao: i.description ?? "",
      preco: Number(i.price),
      etiquetas: Array.isArray(i.tags) ? i.tags : [],
      alergenicos: Array.isArray(i.allergens) ? i.allergens : [],
      serve: i.serve_pessoas ?? null,
      destaque: Boolean(i.is_featured),
      ativo: i.is_active !== false,
      ordem: i.sort_order ?? 0,
      curtidas: Number(i.likes_count ?? 0),
      descricao_agente: i.descricao_agente ?? "",
      capa: (i.cover_image_url as string) || midias.find((m) => m.tipo === "image")?.url || null,
      video: (i.cover_video_url as string) || midias.find((m) => m.tipo === "video")?.url || null,
      midias,
      variacoes: ([...((i.item_variation_groups as Array<Record<string, unknown>>) ?? [])] as Array<Record<string, unknown>>)
        .sort(porOrdem as never)
        .map((g) => ({
          id: g.id,
          nome: g.name ?? "",
          obrigatorio: Boolean(g.required),
          opcoes: ([...((g.item_variation_options as Array<Record<string, unknown>>) ?? [])] as Array<Record<string, unknown>>)
            .sort(porOrdem as never)
            .map((o) => ({ id: o.id, nome: o.name ?? "", adicional: Number(o.price_modifier ?? 0) })),
        })),
    };
  });
}

export async function criarItem(venueId: string, dados: DadosDoItem): Promise<{ id: string }> {
  const colunas = colunasDoItem(dados);
  if (!colunas.name) throw new ErroDoCardapio(400, "O item precisa de um nome.");
  if (colunas.price === undefined) colunas.price = 0;

  const ultimo = await cliente()
    .from("items")
    .select("sort_order")
    .eq("venue_id", venueId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await cliente()
    .from("items")
    .insert({
      venue_id: venueId,
      slug: await slugLivre("items", venueId, String(colunas.name)),
      sort_order: Number(ultimo.data?.sort_order ?? -1) + 1,
      ...colunas,
    })
    .select("id")
    .single();
  if (error) falhar(500, "Falha ao criar o item", error.message);
  return { id: String(data.id) };
}

export async function atualizarItem(venueId: string, id: string, dados: DadosDoItem): Promise<void> {
  const colunas = colunasDoItem(dados);
  if (colunas.name) colunas.slug = await slugLivre("items", venueId, String(colunas.name), id);
  colunas.updated_at = new Date().toISOString();

  const { data, error } = await cliente()
    .from("items")
    .update(colunas)
    .eq("id", id)
    .eq("venue_id", venueId)
    .select("id")
    .maybeSingle();
  if (error) falhar(500, "Falha ao salvar o item", error.message);
  if (!data) throw new ErroDoCardapio(404, "Item não encontrado.");
}

export async function apagarItem(venueId: string, id: string): Promise<void> {
  const midias = await cliente().from("item_media").select("url").eq("item_id", id);
  const { error } = await cliente().from("items").delete().eq("id", id).eq("venue_id", venueId);
  if (error) falhar(500, "Falha ao apagar o item", error.message);
  // As fotos saem do balde depois — e sem derrubar a operação se falhar.
  await apagarDoBalde((midias.data ?? []).map((m: { url: string }) => m.url));
}

/**
 * Troca as variações inteiras do item pelas que a tela mandou.
 *
 * Substituir tudo é mais simples e mais seguro do que casar grupo a grupo:
 * a tela manda o estado final, e o banco fica igual à tela. Item tem um ou
 * dois grupos com meia dúzia de opções; não há volume que justifique diff.
 */
export async function salvarVariacoes(
  venueId: string,
  itemId: string,
  grupos: unknown,
): Promise<void> {
  if (!Array.isArray(grupos)) throw new ErroDoCardapio(400, "Mande a lista de grupos de variação.");
  if (grupos.length > 8) throw new ErroDoCardapio(400, "No máximo 8 grupos de variação por item.");

  const item = await cliente().from("items").select("id").eq("id", itemId).eq("venue_id", venueId).maybeSingle();
  if (item.error) falhar(500, "Falha ao localizar o item", item.error.message);
  if (!item.data) throw new ErroDoCardapio(404, "Item não encontrado.");

  const limpos = grupos.map((g: Record<string, unknown>, gi: number) => {
    const nome = textoCurto(g.nome, "O nome do grupo", 60);
    if (!nome) throw new ErroDoCardapio(400, `O grupo ${gi + 1} precisa de um nome (ex.: "Ponto da carne").`);
    const opcoes = Array.isArray(g.opcoes) ? g.opcoes : [];
    if (opcoes.length === 0) throw new ErroDoCardapio(400, `"${nome}" precisa de pelo menos uma opção.`);
    if (opcoes.length > 20) throw new ErroDoCardapio(400, `"${nome}": no máximo 20 opções.`);
    return {
      nome,
      obrigatorio: Boolean(g.obrigatorio),
      opcoes: opcoes.map((o: Record<string, unknown>) => {
        const nomeOpcao = textoCurto(o.nome, "O nome da opção", 60);
        if (!nomeOpcao) throw new ErroDoCardapio(400, `Opção sem nome em "${nome}".`);
        const adicional = Number(String(o.adicional ?? 0).replace(",", "."));
        if (!Number.isFinite(adicional) || adicional < -100_000 || adicional > 100_000) {
          throw new ErroDoCardapio(400, `Valor inválido na opção "${nomeOpcao}".`);
        }
        return { nome: nomeOpcao, adicional: Math.round(adicional * 100) / 100 };
      }),
    };
  });

  const apagar = await cliente().from("item_variation_groups").delete().eq("item_id", itemId);
  if (apagar.error) falhar(500, "Falha ao limpar as variações antigas", apagar.error.message);

  for (const [gi, g] of limpos.entries()) {
    const grupo = await cliente()
      .from("item_variation_groups")
      .insert({ item_id: itemId, name: g.nome, required: g.obrigatorio, sort_order: gi })
      .select("id")
      .single();
    if (grupo.error) falhar(500, "Falha ao gravar o grupo de variação", grupo.error.message);
    const opcoes = await cliente().from("item_variation_options").insert(
      g.opcoes.map((o, oi) => ({ group_id: grupo.data.id, name: o.nome, price_modifier: o.adicional, sort_order: oi })),
    );
    if (opcoes.error) falhar(500, "Falha ao gravar as opções", opcoes.error.message);
  }
}

// ============================================================
// Mídia: fotos e vídeos no balde
// ============================================================

export const BUCKET_CARDAPIO = "cardapio";
export const LIMITE_MIDIA_BYTES = 50 * 1024 * 1024;

const FORMATOS_DE_MIDIA: Record<string, { extensao: string; tipo: "image" | "video" }> = {
  "image/png": { extensao: "png", tipo: "image" },
  "image/jpeg": { extensao: "jpg", tipo: "image" },
  "image/jpg": { extensao: "jpg", tipo: "image" },
  "image/webp": { extensao: "webp", tipo: "image" },
  "image/gif": { extensao: "gif", tipo: "image" },
  "video/mp4": { extensao: "mp4", tipo: "video" },
  "video/webm": { extensao: "webm", tipo: "video" },
  "video/quicktime": { extensao: "mov", tipo: "video" },
};

export function formatoDaMidia(contentType: string | null | undefined): { extensao: string; tipo: "image" | "video" } | null {
  const tipo = String(contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return FORMATOS_DE_MIDIA[tipo] ?? null;
}

/** Guarda o arquivo e devolve o endereço público. */
export async function guardarMidia(params: {
  venueId: string;
  pasta: "itens" | "banners" | "categorias";
  arquivo: Buffer;
  contentType: string;
}): Promise<{ url: string; tipo: "image" | "video" }> {
  const formato = formatoDaMidia(params.contentType);
  if (!formato) {
    throw new ErroDoCardapio(400, "Mande foto em JPG, PNG, WEBP ou GIF, ou vídeo em MP4, WEBM ou MOV.");
  }
  if (params.arquivo.length === 0) throw new ErroDoCardapio(400, "O arquivo chegou vazio.");
  if (params.arquivo.length > LIMITE_MIDIA_BYTES) {
    throw new ErroDoCardapio(400, "O arquivo precisa ter no máximo 50 MB.");
  }

  const caminho = `${params.venueId}/${params.pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${formato.extensao}`;
  const { error } = await db()
    .storage.from(BUCKET_CARDAPIO)
    .upload(caminho, params.arquivo, { contentType: params.contentType, upsert: false });
  if (error) {
    if (/bucket not found/i.test(error.message)) {
      throw new ErroDoCardapio(503, "O balde de mídia do cardápio ainda não existe. Rode a migração do cardápio.");
    }
    throw new ErroDoCardapio(500, `Falha ao guardar o arquivo: ${error.message}`);
  }
  const { data } = db().storage.from(BUCKET_CARDAPIO).getPublicUrl(caminho);
  return { url: data.publicUrl, tipo: formato.tipo };
}

/** O caminho dentro do balde, a partir da URL pública — ou null se não é nosso. */
export function caminhoNoBalde(url: string | null | undefined): string | null {
  const texto = String(url ?? "");
  const marca = `/${BUCKET_CARDAPIO}/`;
  const corte = texto.indexOf(marca);
  if (corte === -1) return null;
  const caminho = texto.slice(corte + marca.length).split("?")[0]!;
  return caminho.includes("/") ? caminho : null;
}

/** Nunca lança: o registro já saiu; sobra no balde custa bytes, não operação. */
async function apagarDoBalde(urls: string[]): Promise<void> {
  const caminhos = urls.map(caminhoNoBalde).filter((c): c is string => Boolean(c));
  if (caminhos.length === 0) return;
  try {
    await db().storage.from(BUCKET_CARDAPIO).remove(caminhos);
  } catch (e) {
    console.error(`[cardapio] mídia antiga não saiu do balde: ${(e as Error).message}`);
  }
}

export async function adicionarMidiaAoItem(params: {
  venueId: string;
  itemId: string;
  arquivo: Buffer;
  contentType: string;
}): Promise<{ id: string; url: string; tipo: "image" | "video" }> {
  const item = await cliente()
    .from("items")
    .select("id, cover_image_url, cover_video_url")
    .eq("id", params.itemId)
    .eq("venue_id", params.venueId)
    .maybeSingle();
  if (item.error) falhar(500, "Falha ao localizar o item", item.error.message);
  if (!item.data) throw new ErroDoCardapio(404, "Item não encontrado.");

  const quantas = await cliente().from("item_media").select("id", { count: "exact", head: true }).eq("item_id", params.itemId);
  if ((quantas.count ?? 0) >= 8) throw new ErroDoCardapio(400, "No máximo 8 fotos ou vídeos por item.");

  const guardado = await guardarMidia({ venueId: params.venueId, pasta: "itens", arquivo: params.arquivo, contentType: params.contentType });
  const { data, error } = await cliente()
    .from("item_media")
    .insert({ item_id: params.itemId, url: guardado.url, type: guardado.tipo, sort_order: quantas.count ?? 0 })
    .select("id")
    .single();
  if (error) falhar(500, "Falha ao registrar a mídia", error.message);

  // A primeira foto vira a capa; o primeiro vídeo, o vídeo da ficha. É o que
  // a pessoa espera ao subir a primeira imagem — sem um segundo passo.
  const capa: Record<string, unknown> = {};
  if (guardado.tipo === "image" && !item.data.cover_image_url) capa.cover_image_url = guardado.url;
  if (guardado.tipo === "video" && !item.data.cover_video_url) capa.cover_video_url = guardado.url;
  if (Object.keys(capa).length > 0) {
    await cliente().from("items").update(capa).eq("id", params.itemId);
  }
  return { id: String(data.id), url: guardado.url, tipo: guardado.tipo };
}

export async function removerMidiaDoItem(params: { venueId: string; itemId: string; midiaId: string }): Promise<void> {
  const item = await cliente()
    .from("items")
    .select("id, cover_image_url, cover_video_url")
    .eq("id", params.itemId)
    .eq("venue_id", params.venueId)
    .maybeSingle();
  if (item.error) falhar(500, "Falha ao localizar o item", item.error.message);
  if (!item.data) throw new ErroDoCardapio(404, "Item não encontrado.");

  const midia = await cliente().from("item_media").select("id, url, type").eq("id", params.midiaId).eq("item_id", params.itemId).maybeSingle();
  if (midia.error) falhar(500, "Falha ao localizar a mídia", midia.error.message);
  if (!midia.data) throw new ErroDoCardapio(404, "Foto ou vídeo não encontrado.");

  const { error } = await cliente().from("item_media").delete().eq("id", params.midiaId);
  if (error) falhar(500, "Falha ao remover a mídia", error.message);

  // Se era a capa, a próxima do mesmo tipo assume — ou nenhuma.
  const restantes = await cliente().from("item_media").select("url, type, sort_order").eq("item_id", params.itemId).order("sort_order");
  const proxima = (tipo: string) => (restantes.data ?? []).find((m: { type: string }) => m.type === tipo)?.url ?? "";
  const capa: Record<string, unknown> = {};
  if (item.data.cover_image_url === midia.data.url) capa.cover_image_url = proxima("image");
  if (item.data.cover_video_url === midia.data.url) capa.cover_video_url = proxima("video");
  if (Object.keys(capa).length > 0) await cliente().from("items").update(capa).eq("id", params.itemId);

  await apagarDoBalde([midia.data.url]);
}

export async function definirCapaDoItem(params: { venueId: string; itemId: string; midiaId: string }): Promise<void> {
  const midia = await cliente().from("item_media").select("url, type").eq("id", params.midiaId).eq("item_id", params.itemId).maybeSingle();
  if (midia.error) falhar(500, "Falha ao localizar a mídia", midia.error.message);
  if (!midia.data) throw new ErroDoCardapio(404, "Foto ou vídeo não encontrado.");
  const coluna = midia.data.type === "video" ? "cover_video_url" : "cover_image_url";
  const { data, error } = await cliente()
    .from("items")
    .update({ [coluna]: midia.data.url })
    .eq("id", params.itemId)
    .eq("venue_id", params.venueId)
    .select("id")
    .maybeSingle();
  if (error) falhar(500, "Falha ao definir a capa", error.message);
  if (!data) throw new ErroDoCardapio(404, "Item não encontrado.");
}

export async function trocarImagemDaCategoria(params: {
  venueId: string;
  categoriaId: string;
  arquivo: Buffer;
  contentType: string;
}): Promise<{ url: string }> {
  const formato = formatoDaMidia(params.contentType);
  if (!formato || formato.tipo !== "image") throw new ErroDoCardapio(400, "A imagem da categoria precisa ser JPG, PNG ou WEBP.");
  const atual = await cliente().from("categories").select("image_url").eq("id", params.categoriaId).eq("venue_id", params.venueId).maybeSingle();
  if (atual.error) falhar(500, "Falha ao localizar a categoria", atual.error.message);
  if (!atual.data) throw new ErroDoCardapio(404, "Categoria não encontrada.");
  const guardado = await guardarMidia({ venueId: params.venueId, pasta: "categorias", arquivo: params.arquivo, contentType: params.contentType });
  const { error } = await cliente().from("categories").update({ image_url: guardado.url }).eq("id", params.categoriaId);
  if (error) falhar(500, "Falha ao salvar a imagem", error.message);
  await apagarDoBalde([atual.data.image_url]);
  return { url: guardado.url };
}

// ============================================================
// Painel: banners
// ============================================================

export interface DadosDoBanner {
  titulo?: string;
  subtitulo?: string;
  chamada?: string;
  link_tipo?: string;
  link_valor?: string;
  ativo?: boolean;
  inicio?: string | null;
  fim?: string | null;
}

const TIPOS_DE_LINK = new Set(["none", "item", "category", "external"]);

function dataOuNula(bruto: unknown, campo: string): string | null {
  if (bruto === undefined || bruto === null || bruto === "") return null;
  const d = new Date(String(bruto));
  if (Number.isNaN(d.getTime())) throw new ErroDoCardapio(400, `${campo}: data inválida.`);
  return d.toISOString();
}

function colunasDoBanner(dados: DadosDoBanner): Record<string, unknown> {
  const colunas: Record<string, unknown> = {};
  if (dados.titulo !== undefined) colunas.title = textoCurto(dados.titulo, "O título", 80);
  if (dados.subtitulo !== undefined) colunas.subtitle = textoCurto(dados.subtitulo, "O subtítulo", 160);
  if (dados.chamada !== undefined) colunas.cta_text = textoCurto(dados.chamada, "A chamada do botão", 30);
  if (dados.link_tipo !== undefined) {
    const tipo = String(dados.link_tipo || "none");
    if (!TIPOS_DE_LINK.has(tipo)) throw new ErroDoCardapio(400, "Tipo de link inválido.");
    colunas.link_type = tipo;
  }
  if (dados.link_valor !== undefined) {
    const valor = textoCurto(dados.link_valor, "O destino do link", 500);
    if (valor && dados.link_tipo === "external" && !/^https:\/\//.test(valor)) {
      throw new ErroDoCardapio(400, "Link externo precisa começar com https://");
    }
    colunas.link_value = valor;
  }
  if (dados.ativo !== undefined) colunas.is_active = Boolean(dados.ativo);
  if (dados.inicio !== undefined) colunas.starts_at = dataOuNula(dados.inicio, "Início");
  if (dados.fim !== undefined) colunas.ends_at = dataOuNula(dados.fim, "Fim");
  return colunas;
}

export async function listarBannersDoPainel(venueId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await cliente()
    .from("banners")
    .select("id, title, subtitle, image_url, video_url, cta_text, link_type, link_value, sort_order, is_active, starts_at, ends_at")
    .eq("venue_id", venueId)
    .order("sort_order", { ascending: true });
  if (error) falhar(500, "Falha ao listar banners", error.message);
  return (data ?? []).map((b: Record<string, unknown>) => ({
    id: b.id,
    titulo: b.title ?? "",
    subtitulo: b.subtitle ?? "",
    imagem: b.image_url || null,
    video: b.video_url || null,
    chamada: b.cta_text ?? "",
    link_tipo: b.link_type ?? "none",
    link_valor: b.link_value ?? "",
    ordem: b.sort_order ?? 0,
    ativo: b.is_active !== false,
    inicio: b.starts_at ?? null,
    fim: b.ends_at ?? null,
  }));
}

export async function criarBanner(venueId: string, dados: DadosDoBanner): Promise<{ id: string }> {
  const colunas = colunasDoBanner(dados);
  if (!colunas.title) throw new ErroDoCardapio(400, "O banner precisa de um título.");
  const ultimo = await cliente().from("banners").select("sort_order").eq("venue_id", venueId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await cliente()
    .from("banners")
    .insert({ venue_id: venueId, image_url: "", sort_order: Number(ultimo.data?.sort_order ?? -1) + 1, ...colunas })
    .select("id")
    .single();
  if (error) falhar(500, "Falha ao criar o banner", error.message);
  return { id: String(data.id) };
}

export async function atualizarBanner(venueId: string, id: string, dados: DadosDoBanner): Promise<void> {
  const colunas = colunasDoBanner(dados);
  colunas.updated_at = new Date().toISOString();
  const { data, error } = await cliente().from("banners").update(colunas).eq("id", id).eq("venue_id", venueId).select("id").maybeSingle();
  if (error) falhar(500, "Falha ao salvar o banner", error.message);
  if (!data) throw new ErroDoCardapio(404, "Banner não encontrado.");
}

export async function apagarBanner(venueId: string, id: string): Promise<void> {
  const atual = await cliente().from("banners").select("image_url, video_url").eq("id", id).eq("venue_id", venueId).maybeSingle();
  const { error } = await cliente().from("banners").delete().eq("id", id).eq("venue_id", venueId);
  if (error) falhar(500, "Falha ao apagar o banner", error.message);
  await apagarDoBalde([atual.data?.image_url, atual.data?.video_url].filter(Boolean));
}

/** Foto vira `image_url`; vídeo vira `video_url`. A anterior do mesmo tipo sai. */
export async function trocarMidiaDoBanner(params: {
  venueId: string;
  bannerId: string;
  arquivo: Buffer;
  contentType: string;
}): Promise<{ url: string; tipo: "image" | "video" }> {
  const atual = await cliente().from("banners").select("image_url, video_url").eq("id", params.bannerId).eq("venue_id", params.venueId).maybeSingle();
  if (atual.error) falhar(500, "Falha ao localizar o banner", atual.error.message);
  if (!atual.data) throw new ErroDoCardapio(404, "Banner não encontrado.");

  const guardado = await guardarMidia({ venueId: params.venueId, pasta: "banners", arquivo: params.arquivo, contentType: params.contentType });
  const coluna = guardado.tipo === "video" ? "video_url" : "image_url";
  const { error } = await cliente().from("banners").update({ [coluna]: guardado.url }).eq("id", params.bannerId);
  if (error) falhar(500, "Falha ao salvar a mídia do banner", error.message);
  await apagarDoBalde([atual.data[coluna]]);
  return guardado;
}

// ============================================================
// Painel: promoções
// ============================================================

export interface DadosDaPromocao {
  nome?: string;
  descricao?: string;
  inicio?: string;
  fim?: string;
  dias?: number[];
  ativa?: boolean;
  itens?: Array<{ item_id: string; preco: number }>;
}

export async function listarPromocoesDoPainel(venueId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await cliente()
    .from("promotions")
    .select("id, name, description, starts_at, ends_at, weekly_days, is_active, promotion_items ( item_id, promotional_price, items ( name ) )")
    .eq("venue_id", venueId)
    .order("starts_at", { ascending: false });
  if (error) falhar(500, "Falha ao listar promoções", error.message);
  return (data ?? []).map((p: Record<string, unknown>) => ({
    id: p.id,
    nome: p.name,
    descricao: p.description ?? "",
    inicio: p.starts_at,
    fim: p.ends_at,
    dias: Array.isArray(p.weekly_days) ? p.weekly_days : [],
    ativa: p.is_active !== false,
    itens: ((p.promotion_items as Array<Record<string, unknown>>) ?? []).map((pi) => ({
      item_id: pi.item_id,
      item_nome: (pi.items as { name?: string } | null)?.name ?? null,
      preco: Number(pi.promotional_price),
    })),
  }));
}

function colunasDaPromocao(dados: DadosDaPromocao): Record<string, unknown> {
  const colunas: Record<string, unknown> = {};
  if (dados.nome !== undefined) {
    const nome = textoCurto(dados.nome, "O nome", 80);
    if (!nome) throw new ErroDoCardapio(400, "A promoção precisa de um nome.");
    colunas.name = nome;
  }
  if (dados.descricao !== undefined) colunas.description = textoCurto(dados.descricao, "A descrição", 300);
  if (dados.inicio !== undefined) colunas.starts_at = dataOuNula(dados.inicio, "Início");
  if (dados.fim !== undefined) colunas.ends_at = dataOuNula(dados.fim, "Fim");
  if (dados.dias !== undefined) {
    const dias = Array.isArray(dados.dias) ? dados.dias.map(Number) : [];
    if (dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new ErroDoCardapio(400, "Dias da semana vão de 0 (domingo) a 6 (sábado).");
    }
    colunas.weekly_days = [...new Set(dias)].sort();
  }
  if (dados.ativa !== undefined) colunas.is_active = Boolean(dados.ativa);
  return colunas;
}

async function gravarItensDaPromocao(promocaoId: string, venueId: string, itens: unknown): Promise<void> {
  if (!Array.isArray(itens)) throw new ErroDoCardapio(400, "Mande os itens da promoção.");
  const limpos = itens.map((i: Record<string, unknown>) => {
    if (typeof i.item_id !== "string") throw new ErroDoCardapio(400, "Item sem id na promoção.");
    return { item_id: i.item_id, preco: precoValido(i.preco) };
  });
  if (limpos.length > 0) {
    // Só itens DESTA casa entram: o id de um item de outra casa daria preço
    // promocional no cardápio do vizinho.
    const daCasa = await cliente().from("items").select("id").eq("venue_id", venueId).in("id", limpos.map((i) => i.item_id));
    if (daCasa.error) falhar(500, "Falha ao conferir os itens", daCasa.error.message);
    const validos = new Set((daCasa.data ?? []).map((i: { id: string }) => i.id));
    for (const i of limpos) {
      if (!validos.has(i.item_id)) throw new ErroDoCardapio(400, "Um dos itens não é desta casa.");
    }
  }
  const apagar = await cliente().from("promotion_items").delete().eq("promotion_id", promocaoId);
  if (apagar.error) falhar(500, "Falha ao limpar os itens da promoção", apagar.error.message);
  if (limpos.length === 0) return;
  const { error } = await cliente()
    .from("promotion_items")
    .insert(limpos.map((i) => ({ promotion_id: promocaoId, item_id: i.item_id, promotional_price: i.preco })));
  if (error) falhar(500, "Falha ao gravar os itens da promoção", error.message);
}

export async function criarPromocao(venueId: string, dados: DadosDaPromocao): Promise<{ id: string }> {
  const colunas = colunasDaPromocao(dados);
  if (!colunas.name) throw new ErroDoCardapio(400, "A promoção precisa de um nome.");
  // Sem datas, vale "para sempre": de hoje a dez anos. O cliente que quer
  // "chopp em dobro toda terça" não tem uma data de fim em mente.
  if (!colunas.starts_at) colunas.starts_at = new Date(Date.now() - 24 * 3600_000).toISOString();
  if (!colunas.ends_at) colunas.ends_at = new Date(Date.now() + 10 * 365 * 24 * 3600_000).toISOString();
  const { data, error } = await cliente().from("promotions").insert({ venue_id: venueId, ...colunas }).select("id").single();
  if (error) falhar(500, "Falha ao criar a promoção", error.message);
  if (dados.itens !== undefined) await gravarItensDaPromocao(String(data.id), venueId, dados.itens);
  return { id: String(data.id) };
}

export async function atualizarPromocao(venueId: string, id: string, dados: DadosDaPromocao): Promise<void> {
  const colunas = colunasDaPromocao(dados);
  colunas.updated_at = new Date().toISOString();
  const { data, error } = await cliente().from("promotions").update(colunas).eq("id", id).eq("venue_id", venueId).select("id").maybeSingle();
  if (error) falhar(500, "Falha ao salvar a promoção", error.message);
  if (!data) throw new ErroDoCardapio(404, "Promoção não encontrada.");
  if (dados.itens !== undefined) await gravarItensDaPromocao(id, venueId, dados.itens);
}

export async function apagarPromocao(venueId: string, id: string): Promise<void> {
  const { error } = await cliente().from("promotions").delete().eq("id", id).eq("venue_id", venueId);
  if (error) falhar(500, "Falha ao apagar a promoção", error.message);
}

// ============================================================
// Painel: chamados de mesa
// ============================================================

export async function chamadosRecentes(venueId: string, horas = 12): Promise<Array<Record<string, unknown>>> {
  const desde = new Date(Date.now() - horas * 3600_000).toISOString();
  const { data, error } = await cliente()
    .from("mesa_eventos")
    .select("id, mesa_numero, item_nome, criado_em")
    .eq("venue_id", venueId)
    .eq("tipo", "chamou_garcom")
    .gte("criado_em", desde)
    .order("criado_em", { ascending: false })
    .limit(100);
  if (error) {
    if (ehMigracaoPendente(error.message)) return [];
    falhar(500, "Falha ao listar os chamados", error.message);
  }
  return (data ?? []).map((e: Record<string, unknown>) => ({
    id: e.id,
    mesa: e.mesa_numero,
    pedido: e.item_nome ?? null,
    em: e.criado_em,
  }));
}
