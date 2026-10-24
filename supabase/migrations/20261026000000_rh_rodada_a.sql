-- RH — Rodada A: a ficha que o próprio funcionário preenche, o contrato de
-- experiência com prazo, e as ocorrências (elogio, feedback, atraso,
-- advertência).
--
-- Nada do que existe é apagado. Tudo é tabela ou coluna nova.

-- ============================================================
-- 1. O contrato de experiência (CLT: até 90 dias, em no máximo dois
--    períodos). O padrão de bar é 45 + 45.
-- ============================================================
alter table public.rh_fichas add column if not exists experiencia_primeiro integer not null default 45
  check (experiencia_primeiro between 0 and 90);
alter table public.rh_fichas add column if not exists experiencia_segundo integer not null default 45
  check (experiencia_segundo between 0 and 90);
-- O que a casa decidiu: 'efetivado', 'prorrogado' (passou para o segundo
-- período) ou 'encerrado'. Nulo = ninguém decidiu ainda — é o que gera o
-- alerta.
alter table public.rh_fichas add column if not exists experiencia_decisao text
  check (experiencia_decisao is null or experiencia_decisao in ('prorrogado', 'efetivado', 'encerrado'));
alter table public.rh_fichas add column if not exists experiencia_decidida_em timestamptz;
-- O consentimento da LGPD, quando a pessoa preencheu a própria ficha.
alter table public.rh_fichas add column if not exists consentimento_em timestamptz;

-- ============================================================
-- 2. O convite para o funcionário preencher a própria ficha
-- ============================================================
-- Um link por pessoa, que vale 7 dias. O token é o segredo: quem tem o link
-- preenche a ficha daquela pessoa, e só dela.
create table if not exists public.rh_convites (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  atendente_id uuid not null references public.pesquisa_atendentes(id) on delete cascade,
  token text not null unique,
  criado_em timestamptz not null default now(),
  criado_por text,
  expira_em timestamptz not null,
  -- Quando a pessoa mandou a ficha. O link continua valendo até expirar para
  -- ela poder mandar um documento que faltou.
  enviado_em timestamptz
);
create index if not exists idx_rh_convites_pessoa on public.rh_convites (venue_id, atendente_id);
alter table public.rh_convites enable row level security;

-- ============================================================
-- 3. Ocorrências: tudo que acontece com a pessoa e merece registro
-- ============================================================
-- Elogio e feedback são o dia a dia da liderança; atraso e falta alimentam o
-- resumo do mês; advertência e suspensão são o registro formal, com PDF para
-- assinar, que protege a casa numa conversa trabalhista.
create table if not exists public.rh_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  atendente_id uuid not null references public.pesquisa_atendentes(id) on delete cascade,
  dia date not null,
  tipo text not null check (tipo in (
    'elogio', 'feedback', 'conversa', 'atraso', 'falta', 'advertencia', 'suspensao', 'elogio_cliente'
  )),
  descricao text,
  -- Atraso: quantos minutos. Suspensão: quantos dias.
  minutos integer check (minutos is null or minutos >= 0),
  dias integer check (dias is null or dias >= 0),
  -- De onde veio: o gerente, ou automático (o elogio do cliente na pesquisa).
  origem text not null default 'gerente',
  pesquisa_resposta_id uuid,
  criado_por text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_rh_ocorrencias_pessoa on public.rh_ocorrencias (venue_id, atendente_id, dia desc);
create index if not exists idx_rh_ocorrencias_periodo on public.rh_ocorrencias (venue_id, tipo, dia);
-- O elogio automático de uma resposta entra uma vez só.
create unique index if not exists idx_rh_ocorrencias_resposta
  on public.rh_ocorrencias (pesquisa_resposta_id) where pesquisa_resposta_id is not null;
alter table public.rh_ocorrencias enable row level security;

notify pgrst, 'reload schema';
