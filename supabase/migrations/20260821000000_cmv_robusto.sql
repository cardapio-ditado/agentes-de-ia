-- CMV robusto: fornecedores, sugestão de compra, extrato, transferência e perda.
--
-- O melhor do Gorjeta Pro, trazido com as adaptações do multi-cliente. A
-- regra de desenho continua: poder por baixo, um toque por cima. Cada função
-- daqui alimenta um botão, não uma tela de configuração.

-- ============================================================
-- Fornecedores
-- ============================================================
-- O ciclo de compra é o campo que trabalha: "o Atacadão entrega a cada 7
-- dias" é o que transforma consumo médio em quantidade a pedir. Sem ele, a
-- sugestão de compra não sabe para quantos dias comprar.

create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nome text not null,
  nome_normalizado text not null,
  cnpj text,
  telefone text,
  email text,
  -- A cada quantos dias este fornecedor entrega. É o horizonte da sugestão.
  ciclo_compra_dias integer not null default 7 check (ciclo_compra_dias between 1 and 60),
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (venue_id, nome_normalizado)
);

create or replace function public.fornecedores_normalizar()
returns trigger language plpgsql as $$
begin
  new.nome_normalizado := public.cmv_normalizar(new.nome);
  return new;
end;
$$;

drop trigger if exists fornecedores_antes_de_gravar on public.fornecedores;
create trigger fornecedores_antes_de_gravar
  before insert or update on public.fornecedores
  for each row execute function public.fornecedores_normalizar();

-- O insumo aponta para o fornecedor de quem se costuma comprar: é o que
-- agrupa a sugestão de compra em pedidos prontos, um por fornecedor.
alter table public.insumos
  add column if not exists fornecedor_id uuid references public.fornecedores(id) on delete set null;

alter table public.compras
  add column if not exists fornecedor_id uuid references public.fornecedores(id) on delete set null;

alter table public.fornecedores enable row level security;

-- ============================================================
-- Transferência entre locais
-- ============================================================
-- Uma função, dois movimentos, tudo ou nada: a cerveja que sai do depósito
-- ENTRA no bar na mesma transação. Fazer em duas chamadas do front é como
-- nascem saldos que somem no meio do caminho.

create or replace function public.cmv_transferir(
  p_venue_id uuid,
  p_insumo_id uuid,
  p_de_local uuid,
  p_para_local uuid,
  p_quantidade numeric,
  p_usuario uuid default null
)
returns void language plpgsql as $$
declare
  v_saldo numeric;
  v_custo numeric;
begin
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'quantidade_invalida'; end if;
  if p_de_local = p_para_local then raise exception 'mesmo_local'; end if;

  v_saldo := public.cmv_saldo(p_insumo_id, p_de_local);
  -- Transferir mais do que há criaria saldo negativo num lugar e positivo
  -- noutro — estoque inventado do nada.
  if v_saldo < p_quantidade then raise exception 'saldo_insuficiente'; end if;

  select custo_medio into v_custo from public.insumos where id = p_insumo_id;

  insert into public.estoque_movimentos
    (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario, origem_tipo, criado_por)
  values
    (p_venue_id, p_insumo_id, p_de_local,  -p_quantidade, 'transferencia_saida',  coalesce(v_custo,0), 'transferencia', p_usuario),
    (p_venue_id, p_insumo_id, p_para_local, p_quantidade, 'transferencia_entrada', coalesce(v_custo,0), 'transferencia', p_usuario);
end;
$$;

-- ============================================================
-- Perda / desperdício
-- ============================================================
-- Quebrou, venceu, caiu no chão. Registrar na hora é o que separa "quebra
-- conhecida" de "desvio a investigar" na próxima contagem — sem isto, os
-- dois chegam misturados e a contagem não diz nada.

create or replace function public.cmv_registrar_perda(
  p_venue_id uuid,
  p_insumo_id uuid,
  p_local_id uuid,
  p_quantidade numeric,
  p_motivo text,
  p_usuario uuid default null
)
returns void language plpgsql as $$
declare
  v_custo numeric;
begin
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'quantidade_invalida'; end if;
  if p_motivo is null or trim(p_motivo) = '' then raise exception 'motivo_obrigatorio'; end if;

  select custo_medio into v_custo from public.insumos where id = p_insumo_id;

  insert into public.estoque_movimentos
    (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario, origem_tipo, observacao, criado_por)
  values
    (p_venue_id, p_insumo_id, p_local_id, -p_quantidade, 'perda', coalesce(v_custo,0), 'perda', trim(p_motivo), p_usuario);
end;
$$;

-- ============================================================
-- Extrato do insumo (kardex)
-- ============================================================
-- "Por que o saldo é esse?" — a pergunta que o razão existe para responder.
-- Movimentos com saldo acumulado, do mais novo para o mais velho.

create or replace function public.cmv_extrato_insumo(
  p_insumo_id uuid,
  p_local_id uuid default null,
  p_limite integer default 50
)
returns table (
  criado_em timestamptz,
  tipo text,
  quantidade numeric,
  custo_unitario numeric,
  local_nome text,
  observacao text,
  saldo_apos numeric
)
language sql stable as $$
  select m.criado_em, m.tipo, m.quantidade, m.custo_unitario, l.nome, m.observacao,
         sum(m.quantidade) over (order by m.criado_em, m.id) as saldo_apos
  from public.estoque_movimentos m
  join public.estoque_locais l on l.id = m.local_id
  where m.insumo_id = p_insumo_id
    and (p_local_id is null or m.local_id = p_local_id)
  order by m.criado_em desc, m.id desc
  limit p_limite;
$$;

-- ============================================================
-- Posição do estoque, valorizada
-- ============================================================

create or replace function public.cmv_posicao_estoque(p_venue_id uuid)
returns table (
  insumo_id uuid,
  insumo text,
  unidade text,
  local_nome text,
  quantidade numeric,
  custo_medio numeric,
  valor numeric
)
language sql stable as $$
  select i.id, i.nome, i.unidade, l.nome, s.quantidade, i.custo_medio,
         round(s.quantidade * i.custo_medio, 2)
  from public.estoque_saldos s
  join public.insumos i on i.id = s.insumo_id
  join public.estoque_locais l on l.id = s.local_id
  where s.venue_id = p_venue_id and s.quantidade <> 0 and i.ativo
  order by s.quantidade * i.custo_medio desc;
$$;

-- ============================================================
-- Sugestão de compra — o algoritmo do Gorjeta, adaptado
-- ============================================================
-- Prevê por DIA DA SEMANA, não por média achatada: sábado não consome como
-- terça, e a média mandaria comprar errado nos dois. O horizonte é o ciclo
-- do fornecedor + dias de segurança; sem histórico, cai no estoque mínimo.
--
-- Consumo = saídas reais (venda, produção, perda). Ajuste de contagem fica
-- de fora: ele corrige o passado, não prevê o futuro — e transferência não
-- é consumo, é mudança de endereço.

create or replace function public.cmv_sugestao_compra(
  p_venue_id uuid,
  p_dias_seguranca integer default 1,
  p_dias_historico integer default 28,
  p_timezone text default 'America/Cuiaba'
)
returns table (
  insumo_id uuid,
  insumo text,
  unidade text,
  fornecedor_id uuid,
  fornecedor text,
  ciclo_dias integer,
  consumo_medio_diario numeric,
  demanda_prevista numeric,
  saldo_atual numeric,
  quantidade_sugerida numeric,
  custo_estimado numeric,
  criterio text
)
language sql stable as $$
  with datas as (
    select d::date as dia
    from generate_series(current_date - p_dias_historico, current_date - 1, interval '1 day') d
  ),
  consumo_dia as (
    select m.insumo_id as cd_item,
           (m.criado_em at time zone p_timezone)::date as dia,
           sum(-m.quantidade) as qtd
    from public.estoque_movimentos m
    where m.venue_id = p_venue_id
      and m.quantidade < 0
      and m.tipo in ('venda', 'producao_saida', 'perda')
      and m.criado_em >= (current_date - p_dias_historico)::timestamp at time zone p_timezone
    group by 1, 2
  ),
  itens_com_consumo as (select distinct cd_item from consumo_dia),
  media_por_dow as (
    select ic.cd_item as md_item,
           extract(dow from d.dia)::int as dow,
           avg(coalesce(cd.qtd, 0)) as media
    from itens_com_consumo ic
    cross join datas d
    left join consumo_dia cd on cd.cd_item = ic.cd_item and cd.dia = d.dia
    group by 1, 2
  ),
  base as (
    select i.id as b_item, i.nome as b_nome, i.unidade as b_um,
           i.estoque_minimo as b_min, i.custo_medio as b_custo,
           f.id as b_forn_id, f.nome as b_forn,
           coalesce(f.ciclo_compra_dias, 7) as b_ciclo,
           (coalesce(f.ciclo_compra_dias, 7) + p_dias_seguranca) as b_k
    from public.insumos i
    left join public.fornecedores f on f.id = i.fornecedor_id
    where i.venue_id = p_venue_id and i.ativo
  ),
  demanda as (
    select b.b_item as d_item, sum(coalesce(md.media, 0)) as prevista
    from base b
    cross join lateral generate_series(0, b.b_k - 1) g
    left join media_por_dow md
      on md.md_item = b.b_item
     and md.dow = extract(dow from current_date + g)::int
    group by 1
  ),
  consumo_medio as (
    select cd_item as cm_item, sum(qtd) / p_dias_historico::numeric as diario
    from consumo_dia group by 1
  ),
  saldo as (
    select s.insumo_id as s_item, sum(s.quantidade) as total
    from public.estoque_saldos s where s.venue_id = p_venue_id group by 1
  )
  select
    b.b_item, b.b_nome, b.b_um, b.b_forn_id, b.b_forn, b.b_ciclo,
    round(coalesce(cm.diario, 0), 3),
    round(coalesce(d.prevista, 0), 3),
    round(coalesce(s.total, 0), 3),
    case
      when coalesce(d.prevista, 0) > 0
        then greatest(0, round(d.prevista - coalesce(s.total, 0), 2))
      -- Sem histórico de consumo, o mínimo segura: 20% acima dele para não
      -- pedir de novo na semana seguinte.
      when coalesce(b.b_min, 0) > 0 and coalesce(s.total, 0) < b.b_min
        then greatest(0, round(b.b_min * 1.2 - coalesce(s.total, 0), 2))
      else 0
    end,
    round(greatest(0,
      case
        when coalesce(d.prevista, 0) > 0 then d.prevista - coalesce(s.total, 0)
        when coalesce(b.b_min, 0) > 0 and coalesce(s.total, 0) < b.b_min
          then b.b_min * 1.2 - coalesce(s.total, 0)
        else 0
      end) * coalesce(b.b_custo, 0), 2),
    case
      when coalesce(d.prevista, 0) > 0 then 'previsao_dia_semana'
      when coalesce(b.b_min, 0) > 0 then 'estoque_minimo'
      else 'sem_dados'
    end
  from base b
  left join demanda d on d.d_item = b.b_item
  left join consumo_medio cm on cm.cm_item = b.b_item
  left join saldo s on s.s_item = b.b_item
  order by 10 desc nulls last;
$$;

notify pgrst, 'reload schema';
