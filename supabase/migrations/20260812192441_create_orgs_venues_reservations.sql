-- Camada de plataforma (organizações, chaves de API) + domínio de bares/restaurantes.
-- Continua tudo backend-only: RLS ligado, sem policy permissiva.

-- ============================================================
-- Organizações e membros (multi-tenant)
-- ============================================================
create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  plan       text not null default 'free' check (plan in ('free','pro','enterprise')),
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is 'Tenant da plataforma: um grupo/rede de bares e restaurantes.';

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.org_members (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

comment on table public.org_members is 'RBAC: papel de cada usuário dentro da organização.';

create index org_members_user_idx on public.org_members (user_id);

-- ============================================================
-- Chaves de API (guardadas apenas como hash)
-- ============================================================
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null,
  key_prefix   text not null,
  key_hash     text not null unique,
  scopes       text[] not null default array['runs:write']::text[],
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.api_keys is 'Chaves de API por organização. Guardamos só o hash — a chave crua aparece uma única vez, na criação.';
comment on column public.api_keys.key_prefix is 'Primeiros caracteres da chave, para o usuário identificá-la na lista.';

create index api_keys_org_active_idx on public.api_keys (org_id)
  where revoked_at is null;

-- ============================================================
-- Vínculo dos agentes com a organização
-- ============================================================
alter table public.agents
  add column org_id uuid references public.organizations(id) on delete cascade;

create index agents_org_idx on public.agents (org_id);

-- ============================================================
-- venues: cada bar/restaurante
-- ============================================================
create table public.venues (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  slug          text not null,
  name          text not null,
  description   text,
  address       text,
  phone         text,
  whatsapp      text,
  email         text,
  timezone      text not null default 'America/Cuiaba',
  capacity      integer check (capacity is null or capacity > 0),
  opening_hours jsonb not null default '{}'::jsonb,
  settings      jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, slug)
);

comment on table public.venues is 'Bar ou restaurante atendido pelos agentes.';
comment on column public.venues.opening_hours is 'Horários por dia da semana, ex.: {"seg": [{"abre":"18:00","fecha":"23:00"}]}.';
comment on column public.venues.settings is 'Regras operacionais: antecedência mínima, tamanho máximo de grupo, aprovação automática.';

create trigger venues_set_updated_at
  before update on public.venues
  for each row execute function public.set_updated_at();

-- ============================================================
-- venue_events: programação musical, jogos, promoções
-- ============================================================
create table public.venue_events (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references public.venues(id) on delete cascade,
  kind         text not null default 'musica'
               check (kind in ('musica','jogo','promocao','evento','outro')),
  title        text not null,
  description  text,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  cover_charge numeric(10,2) check (cover_charge is null or cover_charge >= 0),
  details      jsonb not null default '{}'::jsonb,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint venue_events_periodo_valido
    check (ends_at is null or ends_at > starts_at)
);

comment on table public.venue_events is 'Programação do estabelecimento: shows, jogos transmitidos, promoções.';
comment on column public.venue_events.details is 'Campos por tipo: {"artista":"..."} para música, {"times":["A","B"],"campeonato":"..."} para jogo.';

create index venue_events_agenda_idx
  on public.venue_events (venue_id, starts_at)
  where active;

create trigger venue_events_set_updated_at
  before update on public.venue_events
  for each row execute function public.set_updated_at();

-- ============================================================
-- venue_info: informações consultáveis pelo agente
-- ============================================================
create table public.venue_info (
  id         uuid primary key default gen_random_uuid(),
  venue_id   uuid not null references public.venues(id) on delete cascade,
  topic      text not null,
  content    text not null,
  tags       text[] not null default array[]::text[],
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, topic)
);

comment on table public.venue_info is 'Base de conhecimento do estabelecimento: estacionamento, wi-fi, formas de pagamento, política de pets.';

create trigger venue_info_set_updated_at
  before update on public.venue_info
  for each row execute function public.set_updated_at();

-- ============================================================
-- reservations: coletadas pelo agente, liberadas por um humano
-- ============================================================
create table public.reservations (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references public.venues(id) on delete cascade,
  agent_id         uuid references public.agents(id) on delete set null,
  conversation_id  uuid references public.conversations(id) on delete set null,
  customer_name    text not null,
  customer_phone   text not null,
  customer_email   text,
  party_size       integer not null check (party_size > 0),
  reserved_for     timestamptz not null,
  area_preference  text,
  occasion         text,
  notes            text,
  status           text not null default 'pending'
                   check (status in ('pending','approved','rejected','cancelled','seated','no_show')),
  source_channel   text not null default 'api',
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  review_reason    text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Toda decisão precisa registrar quando foi tomada.
  constraint reservations_revisao_datada
    check (status not in ('approved','rejected') or reviewed_at is not null)
);

comment on table public.reservations is 'Reserva coletada pelo agente. Nasce como pending e aguarda aprovação humana.';
comment on column public.reservations.status is 'pending -> approved/rejected; approved -> seated/no_show/cancelled.';
comment on column public.reservations.review_reason is 'Justificativa da recusa ou observação de quem aprovou.';

-- A fila de aprovação é a consulta mais quente do módulo.
create index reservations_fila_aprovacao_idx
  on public.reservations (venue_id, reserved_for)
  where status = 'pending';

create index reservations_agenda_idx on public.reservations (venue_id, reserved_for desc);
create index reservations_telefone_idx on public.reservations (customer_phone);
create index reservations_conversation_idx on public.reservations (conversation_id)
  where conversation_id is not null;

create trigger reservations_set_updated_at
  before update on public.reservations
  for each row execute function public.set_updated_at();

-- ============================================================
-- reservation_status_history: trilha de auditoria da aprovação
-- ============================================================
create table public.reservation_status_history (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  from_status    text,
  to_status      text not null,
  actor_user_id  uuid references auth.users(id) on delete set null,
  actor_type     text not null default 'human' check (actor_type in ('human','agent','system')),
  reason         text,
  created_at     timestamptz not null default now()
);

comment on table public.reservation_status_history is 'Quem mudou o status da reserva, quando e por quê.';

create index reservation_status_history_reserva_idx
  on public.reservation_status_history (reservation_id, created_at desc);

-- Registra automaticamente toda transição de status.
create or replace function public.log_reservation_status_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.reservation_status_history
      (reservation_id, from_status, to_status, actor_type, reason)
    values (new.id, null, new.status, 'agent', 'reserva criada');
  elsif new.status is distinct from old.status then
    insert into public.reservation_status_history
      (reservation_id, from_status, to_status, actor_user_id, actor_type, reason)
    values (new.id, old.status, new.status, new.reviewed_by,
            case when new.reviewed_by is null then 'system' else 'human' end,
            new.review_reason);
  end if;
  return new;
end;
$$;

create trigger reservations_log_status
  after insert or update on public.reservations
  for each row execute function public.log_reservation_status_change();

-- ============================================================
-- Webhooks
-- ============================================================
create table public.webhooks (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  url        text not null,
  events     text[] not null default array[]::text[],
  secret     text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webhooks is 'Endpoints notificados em eventos como reservation.created e reservation.approved.';

create trigger webhooks_set_updated_at
  before update on public.webhooks
  for each row execute function public.set_updated_at();

create table public.webhook_deliveries (
  id           uuid primary key default gen_random_uuid(),
  webhook_id   uuid not null references public.webhooks(id) on delete cascade,
  event        text not null,
  payload      jsonb not null default '{}'::jsonb,
  status_code  integer,
  attempts     integer not null default 0,
  error        text,
  delivered_at timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.webhook_deliveries is 'Histórico de entregas para depurar integrações e reprocessar falhas.';

create index webhook_deliveries_pendentes_idx
  on public.webhook_deliveries (created_at)
  where delivered_at is null;

-- ============================================================
-- Vínculo do agente com o estabelecimento que ele atende
-- ============================================================
alter table public.conversations
  add column venue_id uuid references public.venues(id) on delete set null;

create index conversations_venue_idx on public.conversations (venue_id)
  where venue_id is not null;

-- ============================================================
-- RLS em tudo
-- ============================================================
alter table public.organizations              enable row level security;
alter table public.org_members                enable row level security;
alter table public.api_keys                   enable row level security;
alter table public.venues                     enable row level security;
alter table public.venue_events               enable row level security;
alter table public.venue_info                 enable row level security;
alter table public.reservations               enable row level security;
alter table public.reservation_status_history enable row level security;
alter table public.webhooks                   enable row level security;
alter table public.webhook_deliveries         enable row level security;
