-- RH — Rodada B: a integração de quem chega, os treinamentos por função e
-- o espaço do funcionário (escala, gorjeta, férias, treinos, atestado).

-- O convite ganha um terceiro tipo: o link do espaço do funcionário, que
-- vale meses (é o "meu cantinho" dele), e não sete dias.
alter table public.rh_convites drop constraint if exists rh_convites_tipo_check;
alter table public.rh_convites add constraint rh_convites_tipo_check
  check (tipo in ('ficha', 'disc', 'portal'));

-- O padrinho: o colega mais experiente que acompanha quem chegou.
alter table public.rh_fichas add column if not exists padrinho_id uuid
  references public.pesquisa_atendentes(id) on delete set null;

-- ============================================================
-- 1. A integração: as etapas dos primeiros 90 dias, por pessoa
-- ============================================================
-- As etapas são uma lista fixa no código (dia 1, primeira semana, dia 30,
-- 60, 90); aqui fica só o que já foi feito.
create table if not exists public.rh_integracao (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  atendente_id uuid not null references public.pesquisa_atendentes(id) on delete cascade,
  etapa text not null,
  feito_em timestamptz not null default now(),
  feito_por text,
  unique (atendente_id, etapa)
);
alter table public.rh_integracao enable row level security;

-- ============================================================
-- 2. Treinamentos: vídeo curto + três perguntas, por função
-- ============================================================
create table if not exists public.rh_treinamentos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  titulo text not null,
  -- Para quem: a função ("Garçom", "Cozinha"…) ou nulo para a equipe toda.
  funcao text,
  descricao text,
  video_url text,
  -- [{"pergunta": "...", "opcoes": ["a","b","c"], "certa": 1}]
  perguntas jsonb not null default '[]'::jsonb,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists idx_rh_treinamentos_casa on public.rh_treinamentos (venue_id, ativo);
alter table public.rh_treinamentos enable row level security;

create table if not exists public.rh_treinamentos_feitos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  treinamento_id uuid not null references public.rh_treinamentos(id) on delete cascade,
  atendente_id uuid not null references public.pesquisa_atendentes(id) on delete cascade,
  acertos integer not null,
  total integer not null,
  concluido_em timestamptz not null default now()
);
create index if not exists idx_rh_treinos_feitos_pessoa on public.rh_treinamentos_feitos (venue_id, atendente_id);
alter table public.rh_treinamentos_feitos enable row level security;

notify pgrst, 'reload schema';
