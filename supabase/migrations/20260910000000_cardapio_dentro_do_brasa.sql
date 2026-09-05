-- O cardápio digital passa a morar DENTRO do Brasa Food.
--
-- Até aqui ele era um deploy separado, com domínio por cliente, e o painel só
-- guardava o link (venue_modulos.url). Agora a página pública é servida pelo
-- próprio Brasa em /cardapio/<casa>, e as telas de gestão vivem no favo
-- Cardápio. As tabelas são as mesmas que o app antigo usava — nomes
-- preservados de propósito —, e esta migração só acrescenta o que faltava:
--
--   1. As colunas que o cardápio novo usa, com `add column if not exists`
--      em cada uma. As tabelas foram criadas em duas épocas (pelo app antigo
--      e pela migração multi-cliente), e "create table if not exists" pula a
--      tabela inteira quando ela já existe — inclusive as colunas que só a
--      segunda versão tinha. Aqui cada coluna é garantida uma a uma.
--   2. Banner com vídeo: `banners.video_url`. Quando preenchido, a página toca
--      o vídeo (mudo, em laço) e usa `image_url` como capa.
--   3. Curtida sem corrida: `cardapio_curtir` soma no banco, dentro de uma
--      só instrução. Dois celulares curtindo o mesmo prato no mesmo segundo
--      não perdem uma curtida — e o contador nunca fica negativo.
--   4. O balde público `cardapio`, onde ficam as fotos e vídeos dos pratos e
--      dos banners. Mesma lógica do balde `marcas`: quem escreve é o servidor,
--      qualquer um lê.
--
-- Os comentários com aprovação já existiam: é a tabela `feedbacks`, com
-- status pending/approved/rejected e quem moderou. Só ganha índice.

-- ============================================================
-- 1. Colunas que o cardápio novo usa
-- ============================================================

alter table public.categories add column if not exists description text default '';
alter table public.categories add column if not exists image_url text default '';
alter table public.categories add column if not exists grupo text default '';
alter table public.categories add column if not exists sort_order int default 0;
alter table public.categories add column if not exists is_active boolean default true;
alter table public.categories add column if not exists updated_at timestamptz default now();

comment on column public.categories.grupo is
  'Comer ou beber: as duas portas do cardápio. Vazio cai em "comer".';

alter table public.items add column if not exists description text default '';
alter table public.items add column if not exists tags text[] default '{}';
alter table public.items add column if not exists allergens text[] default '{}';
alter table public.items add column if not exists serving_size text default '';
alter table public.items add column if not exists cover_image_url text default '';
alter table public.items add column if not exists cover_video_url text default '';
alter table public.items add column if not exists is_active boolean default true;
alter table public.items add column if not exists is_featured boolean default false;
alter table public.items add column if not exists sort_order int default 0;
alter table public.items add column if not exists likes_count int not null default 0;
alter table public.items add column if not exists updated_at timestamptz default now();
-- As duas que o agente já lia e que nunca tiveram migração própria.
alter table public.items add column if not exists descricao_agente text;
alter table public.items add column if not exists serve_pessoas int;

comment on column public.items.is_featured is
  'Destaque da categoria: aparece em cartão grande com foto, acima da lista.';
comment on column public.items.likes_count is
  'Curtidas. Só muda por cardapio_curtir(); ninguém escreve aqui direto.';

alter table public.banners add column if not exists subtitle text default '';
alter table public.banners add column if not exists link_type text default 'none';
alter table public.banners add column if not exists link_value text default '';
alter table public.banners add column if not exists cta_text text default '';
alter table public.banners add column if not exists sort_order int default 0;
alter table public.banners add column if not exists is_active boolean default true;
alter table public.banners add column if not exists starts_at timestamptz;
alter table public.banners add column if not exists ends_at timestamptz;
alter table public.banners add column if not exists updated_at timestamptz default now();

-- ============================================================
-- 2. Banner com vídeo
-- ============================================================

alter table public.banners add column if not exists video_url text default '';

comment on column public.banners.video_url is
  'Vídeo do banner (mp4/webm), mudo e em laço. Vazio = banner de imagem. image_url vira a capa.';

-- O banner de vídeo pode não ter imagem nenhuma: a capa é opcional. A coluna
-- nasceu NOT NULL para o app antigo; hoje um banner precisa de imagem OU vídeo.
alter table public.banners alter column image_url drop not null;
alter table public.banners alter column image_url set default '';

-- ============================================================
-- 3. Curtida
-- ============================================================

-- `p_delta` só decide o sentido: +1 curte, -1 desfaz. Nunca soma mais que um
-- por chamada, então mesmo quem chamar a rota em laço só anda de um em um —
-- e o limite por aparelho fica na rota. `greatest(0, …)` impede o negativo
-- quando alguém desfaz uma curtida que o banco nunca viu.
create or replace function public.cardapio_curtir(
  p_venue_id uuid,
  p_item_id uuid,
  p_delta int
) returns int
language sql
security definer
set search_path = public
as $$
  update public.items
     set likes_count = greatest(0, likes_count + sign(p_delta)::int)
   where id = p_item_id
     and venue_id = p_venue_id
     and is_active = true
  returning likes_count;
$$;

comment on function public.cardapio_curtir is
  'Soma ou tira UMA curtida do item, sem corrida e sem ficar negativo.';

-- ============================================================
-- 4. Comentários: índice para a fila de moderação
-- ============================================================

alter table public.feedbacks add column if not exists item_id uuid references public.items(id) on delete set null;
alter table public.feedbacks add column if not exists rating int;
alter table public.feedbacks add column if not exists status text not null default 'pending';
alter table public.feedbacks add column if not exists moderated_by uuid;
alter table public.feedbacks add column if not exists moderated_at timestamptz;
alter table public.feedbacks add column if not exists moderation_note text default '';

create index if not exists idx_feedbacks_item_status on public.feedbacks (item_id, status, created_at desc);
create index if not exists idx_feedbacks_venue_status on public.feedbacks (venue_id, status, created_at desc);

-- ============================================================
-- 5. Onde ficam as fotos e os vídeos
-- ============================================================
--
-- 50 MB porque o vídeo do banner sai do celular com 20 a 40 MB. O painel
-- reduz a foto antes de subir; o vídeo vai como veio — reduzir vídeo no
-- navegador ainda não é coisa que dê para fazer sem biblioteca pesada.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cardapio', 'cardapio', true, 52428800,
  array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 52428800,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime'];

drop policy if exists "cardapio e publico para leitura" on storage.objects;
create policy "cardapio e publico para leitura"
  on storage.objects for select
  using (bucket_id = 'cardapio');

-- ============================================================
-- 6. Chamados de mesa
-- ============================================================
--
-- "Chamar o garçom" grava um evento de mesa. A tabela já existia para o app
-- antigo; aqui só ganha o índice que a tela do painel usa para listar os
-- chamados do dia.
create index if not exists idx_mesa_eventos_tipo on public.mesa_eventos (venue_id, tipo, criado_em desc);

notify pgrst, 'reload schema';
