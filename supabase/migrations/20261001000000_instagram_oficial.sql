-- ============================================================
-- O Instagram da casa, conectado por LOGIN — e não por token colado.
--
-- O canal do Instagram nasceu nas variáveis de ambiente: um token, um
-- agente, uma casa, para o sistema inteiro. Aqui a conexão vira dado da
-- casa: o dono clica em "Conectar Instagram", entra com a conta do bar,
-- autoriza, e o token (de 60 dias, renovado toda semana pelo relógio) fica
-- guardado aqui. Não precisa de Business Manager, nem o nosso nem o dele.
--
-- O webhook da Meta é um só para todas as contas do app; ele descobre a
-- casa pelo id da conta profissional que vem em cada evento. Daí o índice.
-- ============================================================

create table if not exists public.instagram_oficial (
  venue_id uuid primary key references public.venues(id) on delete cascade,

  -- O id da conta profissional do Instagram (o `user_id` do /me). É o que
  -- vem no `entry.id` do webhook e o que amarra a mensagem à casa.
  ig_user_id text not null,
  usuario text,
  nome text,

  -- O token de longa duração (60 dias). O relógio renova quando faltam
  -- menos de 30 dias; `renovado_em` diz quando foi a última vez.
  token text not null,
  expira_em timestamptz,
  renovado_em timestamptz,

  -- Quem responde os DMs. Vazio = a conta está ligada, mas ninguém atende.
  agent_slug text,

  conectado_em timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists instagram_oficial_ig_user_id
  on public.instagram_oficial (ig_user_id);

alter table public.instagram_oficial enable row level security;

comment on table public.instagram_oficial is
  'O Instagram profissional de cada casa, conectado por login: token renovável, id da conta e o agente que atende os DMs.';
