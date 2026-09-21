-- UMA ROTINA, UM PROCESSO POR VEZ.
--
-- O servidor roda em QUATRO processos no VPS — um conector por número de
-- WhatsApp e por casa —, e cada um deles acorda as mesmas rotinas de fundo
-- no mesmo minuto. As rotinas antigas aguentam isso porque o banco trava a
-- repetição (índice único por dia, por cliente, por checklist). As novas
-- não tinham trava nenhuma: quatro processos leriam "1 aviso encalhado" ao
-- mesmo tempo e o dono receberia quatro mensagens iguais.
--
-- Aqui a trava é a mais simples que existe: a rotina, antes de rodar, tenta
-- gravar (nome, janela de tempo) numa tabela com chave primária. Só um
-- insert entra; os outros três levam violação de chave e desistem. Não
-- precisa de líder eleito, de configuração por processo, nem de saber
-- quantos processos existem.

create table if not exists public.rotinas_reivindicadas (
  rotina text not null,
  -- A janela: "2026-09-21T15" para a de hora em hora, "2026-09-21T15:07"
  -- para a de minuto em minuto. Quem chega primeiro na janela é quem roda.
  janela text not null,
  reivindicada_em timestamptz not null default now(),
  primary key (rotina, janela)
);

alter table public.rotinas_reivindicadas enable row level security;

comment on table public.rotinas_reivindicadas is
  'A trava das rotinas de fundo: um processo por janela de tempo. Insert que entra roda; insert que bate na chave desiste.';

-- A tabela cresceria uma linha por minuto para sempre. Uma limpeza de
-- passagem, feita pela própria rotina, mantém só o último dia.
create index if not exists rotinas_reivindicadas_quando
  on public.rotinas_reivindicadas (reivindicada_em);

notify pgrst, 'reload schema';
