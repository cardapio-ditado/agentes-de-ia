-- Núcleo da plataforma de agentes de IA
-- Todas as tabelas são de backend: RLS habilitado sem policies permissivas,
-- ou seja, as chaves anon/publishable não leem nem escrevem nada.
-- O acesso é feito pelo backend com a service_role key (que ignora RLS).

-- Função de updated_at (search_path fixo para não cair no advisor de segurança)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- agents: definição de cada agente (prompt, modelo, parâmetros)
-- ============================================================
create table public.agents (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  description   text,
  system_prompt text not null default '',
  model         text not null default 'claude-opus-5',
  effort        text not null default 'high'
                check (effort in ('low','medium','high','xhigh','max')),
  max_tokens    integer not null default 16000 check (max_tokens > 0),
  enabled       boolean not null default true,
  config        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.agents is 'Definição de cada agente de IA: prompt, modelo e parâmetros.';
comment on column public.agents.effort is 'Nível de esforço do modelo (output_config.effort da API da Anthropic).';
comment on column public.agents.config is 'Configuração livre por agente: ferramentas habilitadas, integrações, limites.';

create index agents_enabled_idx on public.agents (enabled) where enabled;

create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

-- ============================================================
-- conversations: uma thread por interlocutor/canal
-- ============================================================
create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agents(id) on delete cascade,
  channel     text not null default 'api',
  external_id text,
  title       text,
  status      text not null default 'open'
              check (status in ('open','closed','archived')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.conversations is 'Thread de conversa entre um agente e um interlocutor.';
comment on column public.conversations.channel is 'Origem: api, web, whatsapp, telegram, cron, etc.';
comment on column public.conversations.external_id is 'Identificador no canal de origem (telefone, user id, ticket).';

create unique index conversations_channel_external_idx
  on public.conversations (agent_id, channel, external_id)
  where external_id is not null;

create index conversations_agent_updated_idx
  on public.conversations (agent_id, updated_at desc);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- ============================================================
-- messages: histórico + telemetria de tokens
-- ============================================================
create table public.messages (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        uuid not null references public.conversations(id) on delete cascade,
  role                   text not null check (role in ('user','assistant','system','tool')),
  content                text,
  blocks                 jsonb,
  model                  text,
  stop_reason            text,
  input_tokens           integer,
  output_tokens          integer,
  cache_read_tokens      integer,
  cache_creation_tokens  integer,
  latency_ms             integer,
  created_at             timestamptz not null default now()
);

comment on table public.messages is 'Histórico de mensagens com telemetria de uso de tokens.';
comment on column public.messages.blocks is 'Content blocks brutos da API (texto, thinking, tool_use) para replay fiel.';

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

-- ============================================================
-- tool_calls: auditoria de cada ferramenta executada
-- ============================================================
create table public.tool_calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id      uuid references public.messages(id) on delete set null,
  tool_use_id     text,
  tool_name       text not null,
  input           jsonb not null default '{}'::jsonb,
  output          jsonb,
  is_error        boolean not null default false,
  duration_ms     integer,
  created_at      timestamptz not null default now()
);

comment on table public.tool_calls is 'Auditoria de cada ferramenta chamada pelo agente.';

create index tool_calls_conversation_created_idx
  on public.tool_calls (conversation_id, created_at desc);

create index tool_calls_errors_idx
  on public.tool_calls (created_at desc) where is_error;

-- ============================================================
-- agent_events: log operacional (erros, avisos, marcos)
-- ============================================================
create table public.agent_events (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid references public.agents(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  level           text not null default 'info' check (level in ('debug','info','warn','error')),
  event           text not null,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.agent_events is 'Log operacional dos agentes: erros, avisos e marcos de execução.';

create index agent_events_created_idx on public.agent_events (created_at desc);
create index agent_events_level_idx on public.agent_events (level, created_at desc)
  where level in ('warn','error');

-- ============================================================
-- RLS: habilitado em tudo, sem policy permissiva.
-- anon/publishable => zero acesso. service_role => acesso total (ignora RLS).
-- ============================================================
alter table public.agents        enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.tool_calls    enable row level security;
alter table public.agent_events  enable row level security;
