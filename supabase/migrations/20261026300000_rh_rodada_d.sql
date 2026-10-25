-- RH — Rodada D: o clima da equipe, os indicadores, e a contratação com a
-- lista de extras.

-- ============================================================
-- 1. Pesquisa de clima (anônima)
-- ============================================================
-- Uma rodada por mês. Cada pessoa recebe um link próprio (para votar uma vez
-- só), mas a RESPOSTA não guarda quem foi: o convite é marcado como usado e
-- a resposta entra solta. É o que dá coragem para a equipe falar.
create table if not exists public.rh_clima_rodadas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  mes text not null,
  criada_em timestamptz not null default now(),
  criada_por text,
  unique (venue_id, mes)
);
alter table public.rh_clima_rodadas enable row level security;

create table if not exists public.rh_clima_convites (
  id uuid primary key default gen_random_uuid(),
  rodada_id uuid not null references public.rh_clima_rodadas(id) on delete cascade,
  token text not null unique,
  usado_em timestamptz
);
alter table public.rh_clima_convites enable row level security;

create table if not exists public.rh_clima_respostas (
  id uuid primary key default gen_random_uuid(),
  rodada_id uuid not null references public.rh_clima_rodadas(id) on delete cascade,
  -- "De 0 a 10, você indicaria trabalhar aqui para um amigo?" (eNPS)
  enps integer not null check (enps between 0 and 10),
  -- 1 a 5: liderança, ambiente, reconhecimento, carga de trabalho.
  notas jsonb not null default '{}'::jsonb,
  comentario text,
  -- Só o dia, sem hora: a hora exata ajudaria a descobrir quem respondeu.
  dia date not null default current_date
);
alter table public.rh_clima_respostas enable row level security;

-- ============================================================
-- 2. Candidatos e a lista de extras
-- ============================================================
create table if not exists public.rh_candidatos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nome text not null,
  telefone text,
  funcao text,
  -- 'vaga' = quer emprego fixo; 'extra' = freelancer de fim de semana.
  tipo text not null default 'vaga' check (tipo in ('vaga', 'extra')),
  situacao text not null default 'novo'
    check (situacao in ('novo', 'conversando', 'contratado', 'nao_serve', 'disponivel')),
  -- Só para extras: como foi da última vez (1 a 5).
  nota integer check (nota is null or nota between 1 and 5),
  experiencia text,
  observacoes text,
  origem text not null default 'painel',
  ultima_vez date,
  criado_em timestamptz not null default now()
);
create index if not exists idx_rh_candidatos_casa on public.rh_candidatos (venue_id, tipo, situacao);
alter table public.rh_candidatos enable row level security;

notify pgrst, 'reload schema';
