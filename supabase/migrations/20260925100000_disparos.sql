-- ============================================================
-- DISPAROS — a casa manda, pelo número oficial, para quem ela escolher.
--
-- Promoção para os sumidos, convite para os VIPs, parabéns do mês. Tudo
-- que a CASA inicia no WhatsApp oficial só sai por MODELO aprovado pela
-- Meta (texto livre é só resposta, nas 24 h depois de o cliente falar).
-- Um disparo é: um modelo, quem recebe, quando — e o que aconteceu com
-- cada um depois (entregue, lido, respondeu).
-- ============================================================

create table if not exists public.disparos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,

  nome text not null,

  -- O modelo como está na Meta: nome e idioma. E o corpo dele, copiado no
  -- momento de criar, para a tela mostrar e o agente saber o que a pessoa
  -- recebeu — mesmo que o modelo mude na Meta depois.
  modelo text not null,
  idioma text not null default 'pt_BR',
  corpo text not null default '',

  -- O que vai em cada lacuna {{1}}, {{2}}…, por posição:
  --   {"tipo":"primeiro_nome"} | {"tipo":"nome"} | {"tipo":"casa"} | {"tipo":"fixo","texto":"…"}
  variaveis jsonb not null default '[]'::jsonb,

  -- Quem recebe: {"selo":"vip"} | {"aniversario_mes":10} | {"todos":true}
  publico jsonb not null default '{}'::jsonb,

  status text not null default 'rascunho'
    check (status in ('rascunho', 'agendado', 'enviando', 'concluido', 'cancelado')),
  agendado_para timestamptz,
  concluido_em timestamptz,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists disparos_venue_status on public.disparos (venue_id, status, criado_em desc);

-- Uma linha por pessoa: a foto do público no momento de agendar, e o que
-- aconteceu com a mensagem dela. O `provider_id` é o id que a Meta dá à
-- mensagem (wamid) — é por ele que o webhook diz "entregue", "lida", e é
-- por ele que se sabe a que mensagem a pessoa está respondendo.
create table if not exists public.disparos_envios (
  id uuid primary key default gen_random_uuid(),
  disparo_id uuid not null references public.disparos(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  telefone text not null,
  nome text,

  status text not null default 'pendente'
    check (status in ('pendente', 'enviado', 'entregue', 'lido', 'respondeu', 'falhou')),
  provider_id text,
  erro text,

  enviado_em timestamptz,
  entregue_em timestamptz,
  lido_em timestamptz,
  respondeu_em timestamptz,
  -- O que a pessoa respondeu primeiro (o botão, ou o começo do texto).
  resposta text,

  unique (disparo_id, telefone)
);

create index if not exists disparos_envios_provider on public.disparos_envios (provider_id)
  where provider_id is not null;
create index if not exists disparos_envios_telefone on public.disparos_envios (venue_id, telefone, enviado_em desc);
create index if not exists disparos_envios_pendentes on public.disparos_envios (disparo_id)
  where status = 'pendente';

alter table public.disparos enable row level security;
alter table public.disparos_envios enable row level security;

comment on table public.disparos is
  'Campanhas pelo WhatsApp oficial: um modelo aprovado, um público, um horário.';
comment on table public.disparos_envios is
  'Uma linha por pessoa de cada disparo: enviado, entregue, lido, respondeu.';

-- O parabéns também precisa de modelo quando sai pelo número oficial. O
-- aviso leva o modelo junto; o conector (Baileys) ignora e manda o texto.
alter table public.notifications add column if not exists modelo jsonb;

alter table public.clientes_config add column if not exists aniversario_modelo text;
alter table public.clientes_config add column if not exists aniversario_modelo_variaveis jsonb not null default '[]'::jsonb;
