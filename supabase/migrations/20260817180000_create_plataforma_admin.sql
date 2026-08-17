-- Administração da plataforma e dados comerciais do cliente.
--
-- Até aqui o acesso ao painel era uma chave `sk_...` colada numa caixa: um
-- segredo compartilhado pela casa inteira, sem conta por pessoa e sem
-- "esqueci minha senha". Isso não sobrevive a 100 clientes — um garçom que
-- vê a chave na tela pode apagar reservas, e demitir alguém obriga a trocar
-- a chave de todo mundo.
--
-- A estrutura para resolver já existia (org_members com papéis, ligada a
-- auth.users). Falta o que está aqui: quem é administrador DA PLATAFORMA, e
-- os dados comerciais que a tela de cadastro de cliente precisa gravar.

-- ============================================================
-- Administradores da plataforma (Brasa Food)
-- ============================================================
-- Tabela própria, e não uma flag em org_members, porque é um poder de outra
-- natureza: dono de organização manda na casa dele; admin de plataforma cria
-- e enxerga TODAS as casas. Misturar os dois num campo só é como se perde a
-- diferença de quem pode o quê.
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nome       text,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Quem pode criar clientes e administrar a plataforma inteira. Só a equipe Brasa Food.';

alter table public.platform_admins enable row level security;

-- ============================================================
-- Dados comerciais da organização
-- ============================================================
alter table public.organizations
  add column if not exists email_contato text,
  add column if not exists telefone_contato text,
  add column if not exists observacoes text;

comment on column public.organizations.email_contato is
  'E-mail do responsável — para cobrança e suporte.';

-- ============================================================
-- Convites / primeiro acesso
-- ============================================================
-- O dono é criado no Supabase Auth na hora do cadastro, mas a senha inicial
-- não pode ficar guardada em lugar nenhum. Gravamos só o registro de que o
-- convite foi feito, para a tela saber o que já foi enviado.
alter table public.org_members
  add column if not exists convidado_em timestamptz,
  add column if not exists primeiro_acesso_em timestamptz;

create index if not exists org_members_org_idx on public.org_members (org_id);

notify pgrst, 'reload schema';
