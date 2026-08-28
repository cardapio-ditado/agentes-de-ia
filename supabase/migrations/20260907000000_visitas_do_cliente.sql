-- O histórico de visitas: uma linha por pessoa, por dia.
--
-- Até aqui o cliente tinha dois números soltos — `visitas` e
-- `gasto_total_centavos` — que só cresciam. Eles respondem "quanto ele já
-- gastou aqui?" e mais nada. Não respondem "quando ele veio?", "de quanto em
-- quanto tempo ele volta?", "ele sumiu?" — que é o que decide se vale ligar
-- para alguém no aniversário dele.
--
-- E, pior, eram frágeis: cada chamada somava. A varredura rodar duas vezes no
-- mesmo dia contava duas visitas que não existiram, e não havia como desfazer
-- porque não se sabia de qual dia era cada soma.
--
-- Com uma linha por dia, a trava é o banco: `unique (cliente_id, dia)`. Rodar
-- a varredura dez vezes no mesmo dia grava uma visita.

create table if not exists public.clientes_visitas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,

  -- O dia no calendário DA CASA, não em UTC. Bar fecha às 2h da manhã, e a
  -- venda da 1h pertence à noite anterior — quem resolve isso é quem grava.
  dia date not null,

  gasto_centavos bigint not null default 0,

  -- De onde veio a informação desta visita. Hoje é sempre a Zig; amanhã pode
  -- ser um check-in manual na porta.
  origem text not null default 'zig',

  criado_em timestamptz not null default now(),

  -- Uma pessoa, um dia, uma visita. É esta trava que faz a varredura ser
  -- idempotente — e idempotência aqui não é elegância, é o que impede o
  -- relatório de gasto do cliente de dobrar sozinho.
  unique (cliente_id, dia)
);

alter table public.clientes_visitas enable row level security;

comment on table public.clientes_visitas is
  'Uma linha por cliente por dia de visita, com o gasto do dia. A trava única impede contagem dobrada.';

-- "Quem veio ontem?" e "quanto vendemos para clientes conhecidos no mês?"
create index if not exists idx_visitas_casa_dia
  on public.clientes_visitas (venue_id, dia desc);

-- "Quando este cliente veio?" — a pergunta da ficha dele.
create index if not exists idx_visitas_do_cliente
  on public.clientes_visitas (cliente_id, dia desc);

-- ============================================================
-- O parabéns precisa de mais espaço
-- ============================================================
--
-- Avisar no dia não serve para o que a mensagem existe: o cliente já
-- combinou onde vai comemorar. Dez dias antes ele ainda está decidindo, e um
-- mês antes ele ainda nem pensou no assunto — que é quando a casa entra na
-- conversa. O teto de 30 dias impedia o "no mês".

alter table public.clientes_config
  drop constraint if exists clientes_config_aniversario_antecedencia_check;

alter table public.clientes_config
  add constraint clientes_config_aniversario_antecedencia_check
  check (aniversario_antecedencia between 0 and 60);

alter table public.clientes_config
  alter column aniversario_antecedencia set default 10;

comment on column public.clientes_config.aniversario_antecedencia is
  'Dias ANTES do aniversário em que a mensagem sai. 0 = no dia, e no dia é tarde: a pessoa já escolheu onde comemorar.';

notify pgrst, 'reload schema';
