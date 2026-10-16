-- A casa ao vivo, pela Zig: um retrato por casa, tirado de tanto em tanto
-- tempo pelo servidor (quem está na casa, quem consome, quanto entrou, por
-- garçom). A planta lê a linha; não consulta a Zig a cada quinze segundos.
create table if not exists public.casa_ao_vivo (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  atualizado_em timestamptz not null default now(),
  retrato jsonb not null default '{}'::jsonb
);

comment on table public.casa_ao_vivo is
  'O último retrato da casa segundo a Zig: presentes, consumo, garçons.';

alter table public.casa_ao_vivo enable row level security;

notify pgrst, 'reload schema';
