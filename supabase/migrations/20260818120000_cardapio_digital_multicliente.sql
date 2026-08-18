-- Módulo Cardápio Digital: traz o app do cardápio para o banco do Brasa Food,
-- já multi-cliente.
--
-- O cardápio nasceu para um restaurante só (protótipo do Ditado Popular) e por
-- isso não tinha noção de dono: "mesa 1" era A mesa 1 do mundo. Aqui cada
-- tabela ganha venue_id e cada chave única passa a ser única DENTRO da casa.
-- Isso é o coração da migração — sem isso, o segundo cliente que cadastrasse
-- uma "picanha" ou uma "mesa 1" esbarraria na do primeiro.
--
-- Os NOMES das tabelas são preservados de propósito: o app React consulta
-- "items", "categories", "mesas". Renomear economizaria elegância e custaria a
-- reescrita do front-end inteiro.
--
-- Diferença de arquitetura que se mantém: as tabelas do Brasa Food têm RLS sem
-- policies (só o backend entra, com service_role). As do cardápio PRECISAM de
-- policies, porque o app do cliente fala direto com o Supabase pela chave
-- anônima. Cardápio é informação pública — o que não é público está protegido
-- individualmente abaixo.

-- ============================================================
-- Ajustes e configurações da casa
-- ============================================================
create table if not exists cardapio_settings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  key text not null,
  value text not null default '',
  updated_at timestamptz not null default now(),
  unique (venue_id, key)
);

comment on table cardapio_settings is
  'Ajustes do cardápio por estabelecimento (url do app, prompt do garçom, etc).';

alter table cardapio_settings enable row level security;

-- ============================================================
-- Categorias e itens
-- ============================================================
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  name text not null,
  slug text not null,
  description text default '',
  image_url text default '',
  grupo text default '',
  sort_order int default 0,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- Era UNIQUE(slug) global. Duas casas podem ter "entradas".
  unique (venue_id, slug)
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  slug text not null,
  description text default '',
  price numeric(10,2) not null default 0,
  tags text[] default '{}',
  allergens text[] default '{}',
  calories int,
  serving_size text default '',
  cover_image_url text default '',
  cover_video_url text default '',
  is_active boolean default true,
  is_featured boolean default false,
  sort_order int default 0,
  likes_count int default 0,
  views_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (venue_id, slug)
);

-- Filhas de items: sem venue_id de propósito. O dono vem pelo item, e uma
-- coluna repetida seria uma verdade duplicada — com chance de divergir.
create table if not exists item_media (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  url text not null,
  type text not null default 'image' check (type in ('image', 'video')),
  sort_order int default 0,
  created_at timestamptz default now()
);

create table if not exists item_variation_groups (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  name text not null default '',
  required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists item_variation_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references item_variation_groups(id) on delete cascade,
  name text not null default '',
  price_modifier numeric(10,2) not null default 0.00,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Banners e promoções
-- ============================================================
create table if not exists banners (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  title text not null,
  subtitle text default '',
  image_url text not null,
  link_type text default 'none' check (link_type in ('none','item','category','promotion','external')),
  link_value text default '',
  cta_text text default '',
  sort_order int default 0,
  is_active boolean default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists promotions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  name text not null,
  description text default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  weekly_days int[] default '{}',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists promotion_items (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references promotions(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  promotional_price numeric(10,2) not null,
  unique (promotion_id, item_id)
);

-- ============================================================
-- Feedback do cliente
-- ============================================================
create table if not exists feedbacks (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  author_name text not null,
  author_email text default '',
  rating int check (rating between 1 and 5),
  content text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  -- Era profiles(id); o Brasa Food não tem profiles — quem modera é um usuário
  -- da organização, e a permissão vem de org_members.
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  moderation_note text default '',
  created_at timestamptz default now()
);

-- ============================================================
-- Mesas
-- ============================================================
create table if not exists mesas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  numero integer not null,
  ativa boolean not null default true,
  criada_em timestamptz not null default now(),
  -- Era UNIQUE(numero) global: a "mesa 5" de um bar bloquearia a de todos os
  -- outros. É o exemplo mais claro do que multi-cliente significa aqui.
  unique (venue_id, numero)
);

create table if not exists mesa_sessoes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  mesa_numero integer not null,
  -- Continua único no mundo: é um token aleatório, e é a credencial que o
  -- cliente da mesa carrega no navegador.
  sessao_id text unique not null,
  cliente_nome text,
  cliente_whatsapp text,
  iniciada_em timestamptz not null default now(),
  ultimo_evento_em timestamptz,
  ativa boolean not null default true
);

create table if not exists mesa_eventos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  mesa_numero int not null,
  sessao_id text,
  cliente_nome text,
  item_nome text,
  item_categoria text,
  tipo text not null default 'visualizacao',
  segundos_visualizado int not null default 0,
  criado_em timestamptz not null default now()
);

create table if not exists turno_mesas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  turno_data date not null default current_date,
  mesa_numero integer not null,
  garcom_nome text not null,
  criado_em timestamptz not null default now(),
  unique (venue_id, turno_data, mesa_numero)
);

-- ============================================================
-- Conversas do chat da mesa
-- ============================================================
-- Provisória: na Fase 3 o chat da mesa passa a usar o agente do Brasa Food,
-- que já guarda conversa em `conversations`/`messages` — com histórico,
-- ferramentas e cobrança por pontos. Até lá o app grava aqui, e apagar esta
-- tabela agora quebraria o widget que está no ar.
create table if not exists ai_chat_logs (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  session_id text not null,
  item_id uuid references items(id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

comment on table ai_chat_logs is
  'Conversas do chat da mesa. Provisória até o chat migrar para o agente do Brasa Food.';

alter table ai_chat_logs enable row level security;


-- ============================================================
-- Índices
-- ============================================================
create index if not exists idx_ai_chat_logs_sessao on ai_chat_logs (venue_id, session_id, created_at);
create index if not exists idx_categories_venue on categories (venue_id, sort_order);
create index if not exists idx_items_venue on items (venue_id, is_active, sort_order);
create index if not exists idx_items_category on items (category_id);
create index if not exists idx_item_media_item on item_media (item_id);
create index if not exists idx_banners_venue on banners (venue_id, is_active);
create index if not exists idx_promotions_venue on promotions (venue_id, starts_at, ends_at);
create index if not exists idx_promotion_items_promo on promotion_items (promotion_id);
create index if not exists idx_promotion_items_item on promotion_items (item_id);
create index if not exists idx_feedbacks_venue on feedbacks (venue_id, status);
create index if not exists idx_mesas_venue on mesas (venue_id, numero);
create index if not exists idx_mesa_sessoes_venue on mesa_sessoes (venue_id, mesa_numero);
create index if not exists idx_mesa_eventos_venue on mesa_eventos (venue_id, criado_em desc);
create index if not exists idx_turno_mesas_venue on turno_mesas (venue_id, turno_data);

-- ============================================================
-- RLS
-- ============================================================
alter table categories enable row level security;
alter table items enable row level security;
alter table item_media enable row level security;
alter table item_variation_groups enable row level security;
alter table item_variation_options enable row level security;
alter table banners enable row level security;
alter table promotions enable row level security;
alter table promotion_items enable row level security;
alter table feedbacks enable row level security;
alter table mesas enable row level security;
alter table mesa_sessoes enable row level security;
alter table mesa_eventos enable row level security;
alter table turno_mesas enable row level security;

/*
  Quem é da casa?

  Uma função em vez de repetir o EXISTS em trinta policies: a regra de quem
  pode editar o cardápio é uma decisão só, e precisa poder mudar num lugar só.
  O caminho é venue -> organização -> membro.
*/
create or replace function public.e_da_casa(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from venues v
      join org_members m on m.org_id = v.org_id
     where v.id = p_venue_id
       and m.user_id = auth.uid()
  );
$$;

comment on function public.e_da_casa is
  'true se o usuário logado pertence à organização dona do estabelecimento.';

-- ---- Conteúdo público: qualquer um lê o que está ativo ----
create policy "cardapio publico le categorias ativas"
  on categories for select using (is_active = true);
create policy "cardapio publico le itens ativos"
  on items for select using (is_active = true);
create policy "cardapio publico le midia"
  on item_media for select using (true);
create policy "cardapio publico le grupos de variacao"
  on item_variation_groups for select using (true);
create policy "cardapio publico le opcoes de variacao"
  on item_variation_options for select using (true);
create policy "cardapio publico le banners no ar"
  on banners for select using (
    is_active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );
create policy "cardapio publico le promocoes ativas"
  on promotions for select using (is_active = true);
create policy "cardapio publico le itens de promocao"
  on promotion_items for select using (true);
create policy "cardapio publico le feedback aprovado"
  on feedbacks for select using (status = 'approved');
create policy "cardapio publico le mesas"
  on mesas for select using (true);

-- Qualquer visitante pode elogiar ou reclamar; a moderação decide o que aparece.
create policy "visitante envia feedback"
  on feedbacks for insert with check (true);

-- ---- Mesa: o cliente da mesa não faz login, carrega um token ----
-- Ele só enxerga a PRÓPRIA sessão. Sem este recorte, quem estivesse em
-- qualquer mesa leria o nome e o WhatsApp de todo mundo no salão.
create policy "cliente le a propria sessao de mesa"
  on mesa_sessoes for select
  to anon
  using (sessao_id = current_setting('request.headers', true)::json->>'x-sessao-id');
create policy "cliente abre sessao de mesa"
  on mesa_sessoes for insert to anon with check (true);
create policy "cliente registra evento de mesa"
  on mesa_eventos for insert to anon with check (true);

-- ---- Equipe da casa: lê tudo e escreve tudo, no próprio estabelecimento ----
create policy "equipe administra categorias"
  on categories for all to authenticated
  using (e_da_casa(venue_id)) with check (e_da_casa(venue_id));
create policy "equipe administra itens"
  on items for all to authenticated
  using (e_da_casa(venue_id)) with check (e_da_casa(venue_id));
create policy "equipe administra banners"
  on banners for all to authenticated
  using (e_da_casa(venue_id)) with check (e_da_casa(venue_id));
create policy "equipe administra promocoes"
  on promotions for all to authenticated
  using (e_da_casa(venue_id)) with check (e_da_casa(venue_id));
create policy "equipe administra feedbacks"
  on feedbacks for all to authenticated
  using (e_da_casa(venue_id)) with check (e_da_casa(venue_id));
create policy "equipe administra mesas"
  on mesas for all to authenticated
  using (e_da_casa(venue_id)) with check (e_da_casa(venue_id));
create policy "equipe administra sessoes de mesa"
  on mesa_sessoes for all to authenticated
  using (e_da_casa(venue_id)) with check (e_da_casa(venue_id));
create policy "equipe le eventos de mesa"
  on mesa_eventos for all to authenticated
  using (e_da_casa(venue_id)) with check (e_da_casa(venue_id));
create policy "equipe administra turnos"
  on turno_mesas for all to authenticated
  using (e_da_casa(venue_id)) with check (e_da_casa(venue_id));

-- Filhas: a permissão vem do item/promoção dono.
create policy "equipe administra midia do item"
  on item_media for all to authenticated
  using (exists (select 1 from items i where i.id = item_id and e_da_casa(i.venue_id)))
  with check (exists (select 1 from items i where i.id = item_id and e_da_casa(i.venue_id)));
create policy "equipe administra grupos de variacao"
  on item_variation_groups for all to authenticated
  using (exists (select 1 from items i where i.id = item_id and e_da_casa(i.venue_id)))
  with check (exists (select 1 from items i where i.id = item_id and e_da_casa(i.venue_id)));
create policy "equipe administra opcoes de variacao"
  on item_variation_options for all to authenticated
  using (exists (
    select 1 from item_variation_groups g join items i on i.id = g.item_id
     where g.id = group_id and e_da_casa(i.venue_id)))
  with check (exists (
    select 1 from item_variation_groups g join items i on i.id = g.item_id
     where g.id = group_id and e_da_casa(i.venue_id)));
create policy "equipe administra itens de promocao"
  on promotion_items for all to authenticated
  using (exists (select 1 from promotions p where p.id = promotion_id and e_da_casa(p.venue_id)))
  with check (exists (select 1 from promotions p where p.id = promotion_id and e_da_casa(p.venue_id)));

create policy "cliente registra conversa do chat"
  on ai_chat_logs for insert to anon, authenticated with check (true);
create policy "equipe le conversas do chat"
  on ai_chat_logs for select to authenticated using (e_da_casa(venue_id));

-- Realtime: o painel do garçom precisa ver evento de mesa na hora.
alter publication supabase_realtime add table mesa_eventos;
alter publication supabase_realtime add table mesa_sessoes;

notify pgrst, 'reload schema';
