-- RH — Rodada C: o perfil comportamental (DISC) e a avaliação de desempenho.

-- O mesmo link de convite serve aos dois: preencher a ficha e responder o
-- DISC. O tipo diz qual página o token abre.
alter table public.rh_convites add column if not exists tipo text not null default 'ficha'
  check (tipo in ('ficha', 'disc'));

-- ============================================================
-- 1. DISC
-- ============================================================
-- Uma linha por teste respondido; vale o mais recente. As respostas ficam
-- guardadas para o resultado poder ser recalculado se a régua mudar.
create table if not exists public.rh_disc (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  atendente_id uuid not null references public.pesquisa_atendentes(id) on delete cascade,
  respostas jsonb not null,
  d integer not null check (d between 0 and 100),
  i integer not null check (i between 0 and 100),
  s integer not null check (s between 0 and 100),
  c integer not null check (c between 0 and 100),
  -- "D", "DI", "SC"…: o fator mais alto, e o segundo quando está perto.
  perfil text not null,
  concluido_em timestamptz not null default now()
);
create index if not exists idx_rh_disc_pessoa on public.rh_disc (venue_id, atendente_id, concluido_em desc);
alter table public.rh_disc enable row level security;

-- ============================================================
-- 2. Avaliação de desempenho
-- ============================================================
-- A nota do gestor por competência (1 a 5) e, ao lado, o retrato dos números
-- do período (nota do cliente, faltas, atrasos, elogios, advertências) — o
-- que torna a conversa uma conversa sobre fatos.
create table if not exists public.rh_avaliacoes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  atendente_id uuid not null references public.pesquisa_atendentes(id) on delete cascade,
  momento text not null default 'avulsa'
    check (momento in ('experiencia_45', 'experiencia_90', 'semestral', 'avulsa')),
  dia date not null,
  notas jsonb not null,
  media numeric(3, 2) not null,
  numeros jsonb not null default '{}'::jsonb,
  pontos_fortes text,
  melhorar text,
  combinados text[] not null default '{}',
  avaliador text,
  -- Quando o gestor conversou com a pessoa sobre a avaliação.
  conversada_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists idx_rh_avaliacoes_pessoa on public.rh_avaliacoes (venue_id, atendente_id, dia desc);
alter table public.rh_avaliacoes enable row level security;

notify pgrst, 'reload schema';
