-- Módulo Checklist Inteligente.
--
-- `checklists` é o modelo (perguntas + agenda); `checklist_runs` é cada
-- execução: nasce agendada com um token público — quem preenche recebe o
-- link pelo WhatsApp e não precisa de login. RLS ligado sem policies:
-- acesso só pelo backend (service_role), como nas demais tabelas.

create table checklists (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  name text not null,
  description text,
  -- Itens do modelo: [{id, tipo: "sim_nao"|"texto"|"foto", pergunta, obrigatorio}]
  items jsonb not null default '[]'::jsonb,
  -- {dias:["seg",...], hora:"09:00", responsavel_nome, responsavel_telefone, avisar_telefone}
  schedule jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table checklists is 'Modelos de checklist: perguntas, agenda e responsável.';

create table checklist_runs (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  venue_id uuid not null references venues(id),
  -- Chave do link público de preenchimento — é a única credencial de quem executa.
  token text not null unique,
  scheduled_for date not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'em_andamento', 'concluida')),
  -- [{item, valor ("sim"|"nao"|texto livre), foto (caminho no storage), observacao}]
  answers jsonb not null default '[]'::jsonb,
  executor_nome text,
  started_at timestamptz,
  completed_at timestamptz,
  -- O que a IA achou da execução: resumo em texto e alertas acionáveis.
  resumo_ia text,
  alertas_ia jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table checklist_runs is 'Execuções de checklist, uma por dia agendado, preenchidas via link público.';

-- Uma execução por checklist por dia — o agendador pode rodar quantas vezes
-- quiser que não duplica.
create unique index checklist_runs_por_dia on checklist_runs (checklist_id, scheduled_for);
create index checklist_runs_venue on checklist_runs (venue_id, scheduled_for desc);

alter table checklists enable row level security;
alter table checklist_runs enable row level security;

-- Fotos das execuções. Privado: o painel vê por URL assinada.
insert into storage.buckets (id, name, public)
values ('checklists', 'checklists', false)
on conflict (id) do nothing;
