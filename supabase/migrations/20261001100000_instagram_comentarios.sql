-- ============================================================
-- Comentários nos posts do Instagram: o que a casa quer que o agente faça.
--
-- 'desligado'          — nada; comentário é só comentário.
-- 'privado'            — o agente chama a pessoa no direct (resposta privada
--                        ao comentário, que a Meta permite por 7 dias).
-- 'publico_e_privado'  — além do direct, deixa uma resposta curta e fixa no
--                        próprio post ("te chamei no direct"), para quem lê
--                        o post ver que a casa responde.
-- ============================================================

alter table public.instagram_oficial
  add column if not exists comentarios text not null default 'privado',
  add column if not exists comentarios_aviso text;

-- Cada comentário tratado, uma vez. A Meta reentrega o webhook quando a
-- resposta demora, e sem esta trava a pessoa receberia dois directs.
create table if not exists public.instagram_comentarios (
  comment_id text primary key,
  venue_id uuid not null references public.venues(id) on delete cascade,
  autor_id text,
  autor text,
  texto text,
  media_id text,
  -- ignorado | direct | direct_e_post | falhou
  acao text,
  erro text,
  created_at timestamptz not null default now()
);

create index if not exists instagram_comentarios_venue on public.instagram_comentarios (venue_id, created_at desc);

alter table public.instagram_comentarios enable row level security;
