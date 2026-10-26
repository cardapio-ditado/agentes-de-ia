-- Financeiro — Rodada 1: os cadastros e as contas a pagar e a receber.
--
-- Módulo à parte (`financeiro` em venue_modulos). Pensado para a casa que
-- não tem sistema financeiro nenhum: o caderno, a planilha e o "vê aí no
-- banco" viram contas com vencimento, parcelas e baixa.
--
-- O plano de contas, as formas de pagamento e o "Caixa da casa" NÃO nascem
-- aqui: o servidor cria o padrão de restaurante na primeira vez que a casa
-- abre o Financeiro (src/financeiro.ts), sem id fixo em migração.

-- ============================================================
-- 1. Bancos e caixas
-- ============================================================
create table if not exists public.fin_contas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nome text not null,
  tipo text not null default 'corrente'
    check (tipo in ('corrente', 'poupanca', 'caixa', 'digital', 'investimento')),
  banco text,
  agencia text,
  numero text,
  -- O saldo do dia em que a casa começou a usar o Financeiro. Daí em diante
  -- o saldo é conta: entradas pagas − saídas pagas ± transferências.
  saldo_inicial numeric(14, 2) not null default 0,
  saldo_inicial_em date not null default current_date,
  ativo boolean not null default true,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists idx_fin_contas_casa on public.fin_contas (venue_id, ativo);
alter table public.fin_contas enable row level security;

-- ============================================================
-- 2. Plano de contas: categoria e subcategoria
-- ============================================================
-- Dois níveis e só: categoria (pai_id nulo) e subcategoria. O `grupo` é a
-- linha do resultado do mês (DRE) e vale da categoria para baixo.
create table if not exists public.fin_categorias (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  pai_id uuid references public.fin_categorias(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('receita', 'despesa')),
  grupo text not null default 'outros' check (grupo in (
    'receita', 'deducao', 'cmv', 'pessoal', 'ocupacao', 'operacao',
    'administrativo', 'marketing', 'financeiro', 'investimento', 'retirada', 'outros'
  )),
  ordem integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists idx_fin_categorias_casa on public.fin_categorias (venue_id, tipo, ativo);
create unique index if not exists idx_fin_categorias_nome
  on public.fin_categorias (venue_id, coalesce(pai_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(nome));
alter table public.fin_categorias enable row level security;

-- ============================================================
-- 3. Formas de pagamento
-- ============================================================
create table if not exists public.fin_formas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nome text not null,
  tipo text not null default 'outro' check (tipo in (
    'dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'cheque', 'voucher', 'outro'
  )),
  -- Em quantos dias o dinheiro cai (cartão D+1, D+30…) e quanto a
  -- maquininha fica. Usado nas contas a receber das vendas.
  prazo_dias integer not null default 0 check (prazo_dias between 0 and 120),
  taxa numeric(6, 3) not null default 0 check (taxa >= 0 and taxa < 100),
  conta_id uuid references public.fin_contas(id) on delete set null,
  ativo boolean not null default true,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists idx_fin_formas_casa on public.fin_formas (venue_id, ativo);
alter table public.fin_formas enable row level security;

-- ============================================================
-- 4. Fornecedor: a mesma tabela do estoque, com a ficha completa
-- ============================================================
-- Um fornecedor só para as compras e para o financeiro: quem entrega a
-- cerveja é o mesmo que manda o boleto.
alter table public.fornecedores add column if not exists razao_social text;
alter table public.fornecedores add column if not exists tipo_pessoa text not null default 'pj';
alter table public.fornecedores add column if not exists contato text;
alter table public.fornecedores add column if not exists endereco text;
alter table public.fornecedores add column if not exists chave_pix text;
alter table public.fornecedores add column if not exists banco text;
alter table public.fornecedores add column if not exists agencia text;
alter table public.fornecedores add column if not exists conta text;
alter table public.fornecedores add column if not exists prazo_dias integer;
alter table public.fornecedores add column if not exists categoria_id uuid
  references public.fin_categorias(id) on delete set null;
alter table public.fornecedores add column if not exists forma_id uuid
  references public.fin_formas(id) on delete set null;

-- ============================================================
-- 5. Lançamentos: cada linha é UMA conta (ou uma parcela dela)
-- ============================================================
create table if not exists public.fin_lancamentos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  tipo text not null check (tipo in ('pagar', 'receber')),
  descricao text not null,
  categoria_id uuid references public.fin_categorias(id) on delete set null,
  fornecedor_id uuid references public.fornecedores(id) on delete set null,
  -- Quem paga ou recebe quando não é um fornecedor cadastrado (cliente do
  -- evento, a Zig, o sócio).
  pessoa text,
  documento text,
  -- O mês a que a conta pertence no resultado (a nota de outubro paga em
  -- novembro é custo de outubro).
  competencia date not null,
  vencimento date not null,
  valor numeric(14, 2) not null check (valor > 0),
  forma_id uuid references public.fin_formas(id) on delete set null,
  conta_id uuid references public.fin_contas(id) on delete set null,
  situacao text not null default 'aberto' check (situacao in ('aberto', 'pago', 'cancelado')),
  pago_em date,
  valor_pago numeric(14, 2),
  juros numeric(14, 2) not null default 0 check (juros >= 0),
  desconto numeric(14, 2) not null default 0 check (desconto >= 0),
  -- Parcelamento: as parcelas de uma mesma compra dividem o grupo.
  grupo_id uuid,
  parcela integer,
  parcelas integer,
  recorrente boolean not null default false,
  observacoes text,
  origem text not null default 'manual',
  origem_id text,
  criado_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_fin_lanc_vencimento on public.fin_lancamentos (venue_id, tipo, situacao, vencimento);
create index if not exists idx_fin_lanc_pagamento on public.fin_lancamentos (venue_id, pago_em) where pago_em is not null;
create index if not exists idx_fin_lanc_grupo on public.fin_lancamentos (grupo_id) where grupo_id is not null;
create index if not exists idx_fin_lanc_fornecedor on public.fin_lancamentos (venue_id, fornecedor_id);
create unique index if not exists idx_fin_lanc_origem
  on public.fin_lancamentos (venue_id, origem, origem_id) where origem_id is not null;
alter table public.fin_lancamentos enable row level security;

-- ============================================================
-- 6. Transferência entre contas (do caixa para o banco, do banco para o cofre)
-- ============================================================
create table if not exists public.fin_transferencias (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  de_conta_id uuid not null references public.fin_contas(id) on delete cascade,
  para_conta_id uuid not null references public.fin_contas(id) on delete cascade,
  valor numeric(14, 2) not null check (valor > 0),
  dia date not null,
  descricao text,
  criado_por text,
  criado_em timestamptz not null default now(),
  check (de_conta_id <> para_conta_id)
);
create index if not exists idx_fin_transf_casa on public.fin_transferencias (venue_id, dia);
alter table public.fin_transferencias enable row level security;

notify pgrst, 'reload schema';
