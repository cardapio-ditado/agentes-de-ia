-- Cadastros de verdade, copiados do que funciona no Gorjeta e ajustados:
--
-- 1. CATEGORIAS viram cadastro próprio (lá é texto livre com lista fixa no
--    código; aqui é tabela, porque cada casa agrupa do seu jeito).
-- 2. ITEM diz se ENTRA NO CMV ou não — material de limpeza, descartável e
--    escritório passam pelo estoque mas não são custo de mercadoria vendida.
--    No Gorjeta esse campo existe (`entra_no_cmv`) e é o que separa o CMV
--    de 32% real do CMV inflado por detergente.
-- 3. ESTOQUE ganha TIPO (principal | producao | geral), como lá
--    (central/producao/secundario/geral) — só que aqui o "principal" continua
--    sendo um só por casa, garantido por índice.

-- ============================================================
-- 1. Categorias de item
-- ============================================================

create table if not exists public.insumo_categorias (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nome text not null,
  nome_normalizado text not null,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  -- "Bebidas" e "bebidas " são a mesma categoria — a mesma regra que já
  -- protege o nome do insumo.
  unique (venue_id, nome_normalizado)
);

create or replace function public.insumo_categorias_normalizar()
returns trigger
language plpgsql
as $$
begin
  new.nome_normalizado := public.cmv_normalizar(new.nome);
  return new;
end;
$$;

drop trigger if exists insumo_categorias_antes on public.insumo_categorias;
create trigger insumo_categorias_antes
  before insert or update on public.insumo_categorias
  for each row execute function public.insumo_categorias_normalizar();

alter table public.insumo_categorias enable row level security;

-- ============================================================
-- 2. Item entra no CMV?
-- ============================================================

alter table public.insumos
  add column if not exists entra_no_cmv boolean not null default true;

comment on column public.insumos.entra_no_cmv is
  'false para o que passa pelo estoque mas não é custo de mercadoria: limpeza, descartáveis, escritório. Fica fora do valor do estoque e da conta do CMV.';

-- ============================================================
-- 3. Tipo do estoque
-- ============================================================

alter table public.estoque_locais
  add column if not exists tipo text not null default 'geral';

do $$
begin
  alter table public.estoque_locais
    add constraint estoque_locais_tipo_valido
    check (tipo in ('principal', 'producao', 'geral'));
exception
  when duplicate_object then null;
end;
$$;

-- Quem já era principal vira tipo 'principal'.
update public.estoque_locais set tipo = 'principal' where principal and tipo = 'geral';

-- O tipo passa a ser a verdade; `principal` vira espelho dele, mantido por
-- trigger. Duas colunas dizendo a mesma coisa por caminhos diferentes é como
-- nascem os descompassos — então uma escreve a outra, sempre.
create or replace function public.estoque_locais_sincronizar()
returns trigger
language plpgsql
as $$
begin
  new.principal := (new.tipo = 'principal');
  return new;
end;
$$;

drop trigger if exists estoque_locais_antes on public.estoque_locais;
create trigger estoque_locais_antes
  before insert or update on public.estoque_locais
  for each row execute function public.estoque_locais_sincronizar();

-- ============================================================
-- 4. O CMV só conta o que entra no CMV
-- ============================================================

-- O valor do estoque (que vira snapshot, EI e EF) ignora itens fora do CMV.
create or replace function public.cmv_valor_do_estoque(p_venue_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(s.quantidade * i.custo_medio), 0)
  from public.estoque_saldos s
  join public.insumos i on i.id = s.insumo_id
  where s.venue_id = p_venue_id
    and s.quantidade > 0
    and i.entra_no_cmv;
$$;

-- E as compras do período também: a nota de detergente entra no estoque,
-- não na conta do CMV.
create or replace function public.cmv_do_periodo(
  p_venue_id uuid,
  p_inicio date,
  p_fim date
)
returns table (
  estoque_inicial numeric,
  compras numeric,
  estoque_final numeric,
  cmv numeric,
  faturamento numeric,
  cmv_percentual numeric
)
language sql
stable
as $$
  with inicial as (
    select coalesce((
      select valor_total from public.estoque_snapshots
      where venue_id = p_venue_id and data_referencia < p_inicio
      order by data_referencia desc limit 1
    ), 0) as valor
  ),
  final as (
    select coalesce((
      select valor_total from public.estoque_snapshots
      where venue_id = p_venue_id and data_referencia <= p_fim
      order by data_referencia desc limit 1
    ), public.cmv_valor_do_estoque(p_venue_id)) as valor
  ),
  compradas as (
    select coalesce(sum(m.quantidade * m.custo_unitario), 0) as valor
    from public.estoque_movimentos m
    join public.insumos i on i.id = m.insumo_id
    where m.venue_id = p_venue_id
      and m.tipo = 'compra'
      and i.entra_no_cmv
      and m.criado_em >= p_inicio
      and m.criado_em < (p_fim + 1)
  ),
  faturado as (
    select sum(valor) as valor
    from public.faturamento_diario
    where venue_id = p_venue_id
      and data_referencia between p_inicio and p_fim
  )
  select
    i.valor,
    c.valor,
    f.valor,
    i.valor + c.valor - f.valor,
    coalesce(fat.valor, 0),
    case
      when coalesce(fat.valor, 0) > 0
        then round((i.valor + c.valor - f.valor) / fat.valor * 100, 2)
      else null
    end
  from inicial i, compradas c, final f, faturado fat;
$$;

notify pgrst, 'reload schema';
