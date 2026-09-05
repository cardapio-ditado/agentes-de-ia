-- ============================================================
-- CMV: as quatro lições que o Ditado aprendeu apanhando
-- ============================================================
--
-- O motor de estoque da Brasa já nasceu com as regras do Gorjeta (front não
-- escreve saldo, uma régua só, produção transacional, contagem absoluta).
-- Faltavam quatro coisas que só a operação ensina:
--
--   1. IDEMPOTÊNCIA — clique duplo, reenvio, trigger rodando duas vezes:
--      o Ditado teve movimento em dobro de verdade. Cada ação passa a levar
--      uma chave; a repetição da mesma chave não move nada.
--   2. CONCILIAÇÃO — o cache de saldo pode desviar do histórico (trigger
--      que falhou, SQL na mão). Uma visão mostra a divergência; uma função
--      ressincroniza e registra. Meta: zero linhas.
--   3. DIA OPERACIONAL — a venda de 1h30 da madrugada de sábado é da
--      sexta. Cada casa diz a que horas o dia dela vira; período, previsão
--      por dia da semana e baixa de vendas passam a respeitar isso.
--   4. "NÃO BAIXA ESTOQUE" — o chopp do patrocinador, a cortesia: vende no
--      PDV e não sai do barril. Apelido de venda aprende a ignorar.

-- ------------------------------------------------------------
-- 1. Idempotência
-- ------------------------------------------------------------

alter table public.estoque_movimentos
  add column if not exists chave_idempotencia text;

-- Índice de busca (não único): uma ação gera VÁRIOS movimentos com a mesma
-- chave — uma transferência são dois, uma produção são N. A unicidade é da
-- AÇÃO, e quem garante é a função: trava consultiva pela chave, depois
-- "já existe movimento com esta chave? então já foi".
create index if not exists estoque_movimentos_chave_idx
  on public.estoque_movimentos (venue_id, chave_idempotencia)
  where chave_idempotencia is not null;

-- As assinaturas mudam (parâmetro novo), e `create or replace` com outra
-- lista de parâmetros cria uma SEGUNDA função em vez de trocar a primeira —
-- e aí o PostgREST não sabe qual chamar. Derruba a antiga antes.
drop function if exists public.cmv_transferir(uuid, uuid, uuid, uuid, numeric, uuid);
drop function if exists public.cmv_registrar_perda(uuid, uuid, uuid, numeric, text, uuid);
drop function if exists public.cmv_registrar_producao(uuid, uuid, uuid, numeric, uuid);

create or replace function public.cmv_transferir(
  p_venue_id uuid,
  p_insumo_id uuid,
  p_de_local uuid,
  p_para_local uuid,
  p_quantidade numeric,
  p_usuario uuid default null,
  p_chave text default null
)
returns void language plpgsql as $$
declare
  v_saldo numeric;
  v_custo numeric;
begin
  if p_chave is not null then
    perform pg_advisory_xact_lock(hashtext(p_venue_id::text || ':' || p_chave));
    if exists (select 1 from public.estoque_movimentos
                where venue_id = p_venue_id and chave_idempotencia = p_chave) then
      return; -- a mesma ação, de novo: já está feita
    end if;
  end if;

  if p_quantidade is null or p_quantidade <= 0 then raise exception 'quantidade_invalida'; end if;
  if p_de_local = p_para_local then raise exception 'mesmo_local'; end if;

  v_saldo := public.cmv_saldo(p_insumo_id, p_de_local);
  if v_saldo < p_quantidade then raise exception 'saldo_insuficiente'; end if;

  select custo_medio into v_custo from public.insumos where id = p_insumo_id;

  insert into public.estoque_movimentos
    (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario, origem_tipo, criado_por, chave_idempotencia)
  values
    (p_venue_id, p_insumo_id, p_de_local,  -p_quantidade, 'transferencia_saida',  coalesce(v_custo,0), 'transferencia', p_usuario, p_chave),
    (p_venue_id, p_insumo_id, p_para_local, p_quantidade, 'transferencia_entrada', coalesce(v_custo,0), 'transferencia', p_usuario, p_chave);
end;
$$;

create or replace function public.cmv_registrar_perda(
  p_venue_id uuid,
  p_insumo_id uuid,
  p_local_id uuid,
  p_quantidade numeric,
  p_motivo text,
  p_usuario uuid default null,
  p_chave text default null
)
returns void language plpgsql as $$
declare
  v_custo numeric;
begin
  if p_chave is not null then
    perform pg_advisory_xact_lock(hashtext(p_venue_id::text || ':' || p_chave));
    if exists (select 1 from public.estoque_movimentos
                where venue_id = p_venue_id and chave_idempotencia = p_chave) then
      return;
    end if;
  end if;

  if p_quantidade is null or p_quantidade <= 0 then raise exception 'quantidade_invalida'; end if;
  if p_motivo is null or trim(p_motivo) = '' then raise exception 'motivo_obrigatorio'; end if;

  select custo_medio into v_custo from public.insumos where id = p_insumo_id;

  insert into public.estoque_movimentos
    (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario, origem_tipo, observacao, criado_por, chave_idempotencia)
  values
    (p_venue_id, p_insumo_id, p_local_id, -p_quantidade, 'perda', coalesce(v_custo,0), 'perda', trim(p_motivo), p_usuario, p_chave);
end;
$$;

create or replace function public.cmv_registrar_producao(
  p_venue_id uuid,
  p_ficha_id uuid,
  p_local_id uuid,
  p_lotes numeric,
  p_usuario uuid default null,
  p_chave text default null
)
returns uuid
language plpgsql
as $$
declare
  v_producao_id uuid;
  v_ing record;
  v_confirmada timestamptz;
begin
  if p_chave is not null then
    perform pg_advisory_xact_lock(hashtext(p_venue_id::text || ':' || p_chave));
    -- Repetição: devolve a produção que a primeira chamada criou, para a tela
    -- receber a mesma resposta das duas vezes.
    select origem_id into v_producao_id
      from public.estoque_movimentos
     where venue_id = p_venue_id and chave_idempotencia = p_chave
     limit 1;
    if v_producao_id is not null then return v_producao_id; end if;
  end if;

  if p_lotes is null or p_lotes <= 0 then
    raise exception 'lotes_invalidos';
  end if;

  select confirmada_em into v_confirmada
    from public.fichas_tecnicas
   where id = p_ficha_id and venue_id = p_venue_id and ativa;
  if not found then
    raise exception 'ficha_nao_encontrada';
  end if;
  if v_confirmada is null then
    raise exception 'ficha_nao_confirmada';
  end if;

  insert into public.producoes (venue_id, ficha_id, local_id, lotes, criado_por)
  values (p_venue_id, p_ficha_id, p_local_id, p_lotes, p_usuario)
  returning id into v_producao_id;

  for v_ing in
    select fi.insumo_id, fi.quantidade, i.custo_medio
      from public.ficha_insumos fi
      join public.insumos i on i.id = fi.insumo_id
     where fi.ficha_id = p_ficha_id
  loop
    insert into public.estoque_movimentos
      (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario, origem_tipo, origem_id, criado_por, chave_idempotencia)
    values
      (p_venue_id, v_ing.insumo_id, p_local_id, -(v_ing.quantidade * p_lotes),
       'producao_saida', v_ing.custo_medio, 'producao', v_producao_id, p_usuario, p_chave);
  end loop;

  return v_producao_id;
end;
$$;

-- ------------------------------------------------------------
-- 2. Conciliação do cache de saldo
-- ------------------------------------------------------------

-- Todo par (insumo, local) que tem movimento OU tem linha de saldo, com o
-- que o cache diz e o que o histórico diz. Meta: zero linhas.
create or replace view public.cmv_saldos_divergentes as
  with pares as (
    select venue_id, insumo_id, local_id from public.estoque_movimentos
    group by 1, 2, 3
    union
    select venue_id, insumo_id, local_id from public.estoque_saldos
  ),
  comparado as (
    select p.venue_id, p.insumo_id, p.local_id,
           coalesce(s.quantidade, 0) as saldo_cache,
           public.cmv_saldo(p.insumo_id, p.local_id) as saldo_historico
    from pares p
    left join public.estoque_saldos s
      on s.insumo_id = p.insumo_id and s.local_id = p.local_id
  )
  select c.venue_id, c.insumo_id, i.nome as insumo, i.unidade,
         c.local_id, l.nome as local,
         c.saldo_cache, c.saldo_historico,
         c.saldo_historico - c.saldo_cache as diferenca
  from comparado c
  join public.insumos i on i.id = c.insumo_id
  join public.estoque_locais l on l.id = c.local_id
  where abs(c.saldo_historico - c.saldo_cache) >= 0.0005;

-- Auditoria: quem ressincronizou, quando, e quantas linhas estavam tortas.
-- "Deu zero" sem histórico não diz se sempre deu zero ou se alguém arrumou.
create table if not exists public.cmv_conciliacoes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  divergentes integer not null,
  executado_por uuid,
  executado_em timestamptz not null default now()
);
alter table public.cmv_conciliacoes enable row level security;

create or replace function public.cmv_ressincronizar_saldos(
  p_venue_id uuid,
  p_usuario uuid default null
)
returns integer
language plpgsql
as $$
declare
  v_divergentes integer;
begin
  select count(*) into v_divergentes
    from public.cmv_saldos_divergentes
   where venue_id = p_venue_id;

  -- Reescreve o cache a partir do razão, par a par. Linha de saldo sem
  -- movimento nenhum vira zero em vez de sumir: sumir faria a tela dizer
  -- "nunca teve" onde havia "teve e acabou".
  insert into public.estoque_saldos (venue_id, insumo_id, local_id, quantidade, atualizado_em)
  select p.venue_id, p.insumo_id, p.local_id, public.cmv_saldo(p.insumo_id, p.local_id), now()
    from (
      select venue_id, insumo_id, local_id from public.estoque_movimentos where venue_id = p_venue_id
      union
      select venue_id, insumo_id, local_id from public.estoque_saldos where venue_id = p_venue_id
    ) p
  on conflict (insumo_id, local_id) do update
    set quantidade = excluded.quantidade,
        atualizado_em = now();

  insert into public.cmv_conciliacoes (venue_id, divergentes, executado_por)
  values (p_venue_id, v_divergentes, p_usuario);

  return v_divergentes;
end;
$$;

-- ------------------------------------------------------------
-- 3. Dia operacional
-- ------------------------------------------------------------

-- A que horas o dia da casa vira. 0 = meia-noite (como sempre foi). O Ditado
-- usa 5: a madrugada pertence ao dia anterior. Até 11, porque virada de tarde
-- não é virada de dia, é outro calendário.
alter table public.venues
  add column if not exists virada_do_dia smallint not null default 0
  check (virada_do_dia between 0 and 11);

-- O instante em que um dia da casa COMEÇA, no fuso dela.
-- É a única régua de "que dia é esse movimento?" — período, previsão por
-- dia da semana e baixa de vendas usam esta função, e não contas próprias.
create or replace function public.cmv_inicio_do_dia(p_venue_id uuid, p_dia date)
returns timestamptz
language sql
stable
as $$
  select (p_dia::timestamp + make_interval(hours => v.virada_do_dia)) at time zone v.timezone
  from public.venues v
  where v.id = p_venue_id;
$$;

-- O dia da casa a que um instante pertence.
create or replace function public.cmv_dia_operacional(p_venue_id uuid, p_instante timestamptz)
returns date
language sql
stable
as $$
  select ((p_instante at time zone v.timezone) - make_interval(hours => v.virada_do_dia))::date
  from public.venues v
  where v.id = p_venue_id;
$$;

-- O CMV do período, com as bordas no dia DA CASA. Antes, `criado_em >= p_inicio`
-- comparava com a meia-noite UTC — 20h do dia anterior em Cuiabá.
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
      and m.criado_em >= public.cmv_inicio_do_dia(p_venue_id, p_inicio)
      and m.criado_em <  public.cmv_inicio_do_dia(p_venue_id, p_fim + 1)
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

create or replace function public.cmv_teorico_versus_real(
  p_venue_id uuid,
  p_inicio date,
  p_fim date
)
returns table (
  insumo_id uuid,
  insumo text,
  unidade text,
  teorico numeric,
  real_consumido numeric,
  diferenca numeric,
  diferenca_valor numeric
)
language sql
stable
as $$
  with movimentos as (
    select m.insumo_id,
           sum(case when m.tipo = 'venda' then -m.quantidade else 0 end) as teorico,
           sum(case when m.tipo in ('venda', 'perda', 'ajuste_contagem', 'producao_saida')
                    then -m.quantidade else 0 end) as real_consumido
      from public.estoque_movimentos m
     where m.venue_id = p_venue_id
       and m.criado_em >= public.cmv_inicio_do_dia(p_venue_id, p_inicio)
       and m.criado_em <  public.cmv_inicio_do_dia(p_venue_id, p_fim + 1)
     group by m.insumo_id
  )
  select i.id,
         i.nome,
         i.unidade,
         round(mv.teorico, 3),
         round(mv.real_consumido, 3),
         round(mv.real_consumido - mv.teorico, 3),
         round((mv.real_consumido - mv.teorico) * i.custo_medio, 2)
    from movimentos mv
    join public.insumos i on i.id = mv.insumo_id
   where mv.teorico <> 0 or mv.real_consumido <> 0
   order by abs((mv.real_consumido - mv.teorico) * i.custo_medio) desc;
$$;

-- A previsão por dia da semana agrupa pelo dia DA CASA: a madrugada de
-- sábado conta como sexta, que é quando a cerveja foi de fato consumida.
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
  with hoje as (
    -- "Hoje" no calendário da casa, já descontada a virada: às 3h da manhã
    -- ainda é o dia de ontem para a previsão.
    select public.cmv_dia_operacional(p_venue_id, now()) as dia
  ),
  datas as (
    select d::date as dia
    from hoje h, generate_series(h.dia - p_dias_historico, h.dia - 1, interval '1 day') d
  ),
  consumo_dia as (
    select m.insumo_id as cd_item,
           public.cmv_dia_operacional(p_venue_id, m.criado_em) as dia,
           sum(-m.quantidade) as qtd
    from public.estoque_movimentos m, hoje h
    where m.venue_id = p_venue_id
      and m.quantidade < 0
      and m.tipo in ('venda', 'producao_saida', 'perda')
      and m.criado_em >= public.cmv_inicio_do_dia(p_venue_id, h.dia - p_dias_historico)
      and m.criado_em <  public.cmv_inicio_do_dia(p_venue_id, h.dia)
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
    -- `cross join hoje h`, e não `from base b, hoje h`: a vírgula tem
    -- precedência MENOR que JOIN, então ela parte o FROM em duas árvores e
    -- `b` deixa de existir para o `on` do left join. Foi o erro 42P01 que
    -- derrubou esta migração na primeira tentativa.
    select b.b_item as d_item, sum(coalesce(md.media, 0)) as prevista
    from base b
    cross join hoje h
    cross join lateral generate_series(0, b.b_k - 1) g
    left join media_por_dow md
      on md.md_item = b.b_item
     and md.dow = extract(dow from h.dia + g)::int
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

-- ------------------------------------------------------------
-- 4. Apelido de venda que não baixa estoque
-- ------------------------------------------------------------

alter table public.venda_apelidos
  add column if not exists ignorar boolean not null default false;

-- Um apelido aponta para UMA ficha, ou UM insumo, ou para "não baixa" — e
-- para nada mais. O check antigo exigia exatamente um alvo; agora "nenhum
-- alvo" é válido quando a marca de ignorar está ligada.
alter table public.venda_apelidos drop constraint if exists venda_apelido_alvo_unico;
alter table public.venda_apelidos add constraint venda_apelido_alvo_unico
  check (
    (ignorar and ficha_id is null and insumo_id is null)
    or (not ignorar and num_nonnulls(ficha_id, insumo_id) = 1)
  );

-- A baixa de vendas carimba o movimento NO DIA DA CASA — ao meio-dia
-- operacional, longe das duas bordas. Antes era `data_venda::timestamptz`:
-- meia-noite UTC, que em Cuiabá é 20h do dia ANTERIOR — toda venda entrava
-- no consumo do dia errado.
create or replace function public.cmv_baixar_vendas(
  p_importacao_id uuid,
  p_usuario uuid default null
)
returns table (itens_baixados int, insumos_movidos int)
language plpgsql
as $$
declare
  v_imp record;
  v_item record;
  v_ing record;
  v_local uuid;
  v_itens int := 0;
  v_movs int := 0;
  v_quando timestamptz;
begin
  select * into v_imp
    from public.venda_importacoes
   where id = p_importacao_id;
  if not found then
    raise exception 'importacao_nao_encontrada';
  end if;
  if v_imp.status = 'baixada' then
    raise exception 'vendas_ja_baixadas';
  end if;
  if v_imp.status = 'descartada' then
    raise exception 'importacao_descartada';
  end if;

  select id into v_local
    from public.estoque_locais
   where venue_id = v_imp.venue_id and principal and ativo
   limit 1;

  for v_item in
    select * from public.venda_itens
     where importacao_id = p_importacao_id and status = 'mapeado'
     order by linha_numero
  loop
    v_quando := public.cmv_inicio_do_dia(v_imp.venue_id, v_item.data_venda) + interval '12 hours';

    if v_item.ficha_id is not null then
      for v_ing in
        select fi.insumo_id,
               fi.quantidade / f.rendimento as por_porcao,
               i.custo_medio
          from public.ficha_insumos fi
          join public.fichas_tecnicas f on f.id = fi.ficha_id
          join public.insumos i on i.id = fi.insumo_id
         where fi.ficha_id = v_item.ficha_id
           and f.confirmada_em is not null
      loop
        insert into public.estoque_movimentos
          (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario,
           origem_tipo, origem_id, criado_por, criado_em)
        values
          (v_imp.venue_id, v_ing.insumo_id, coalesce(v_item.local_id, v_local),
           -(v_ing.por_porcao * v_item.quantidade), 'venda', v_ing.custo_medio,
           'venda', v_item.id, p_usuario, v_quando);
        v_movs := v_movs + 1;
      end loop;

    elsif v_item.insumo_id is not null then
      insert into public.estoque_movimentos
        (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario,
         origem_tipo, origem_id, criado_por, criado_em)
      select
        v_imp.venue_id, v_item.insumo_id, coalesce(v_item.local_id, v_local),
        -v_item.quantidade, 'venda', i.custo_medio,
        'venda', v_item.id, p_usuario, v_quando
      from public.insumos i where i.id = v_item.insumo_id;
      v_movs := v_movs + 1;
    end if;

    update public.venda_itens set status = 'baixado' where id = v_item.id;
    v_itens := v_itens + 1;
  end loop;

  update public.venda_importacoes
     set status = 'baixada', baixada_em = now()
   where id = p_importacao_id;

  return query select v_itens, v_movs;
end;
$$;

notify pgrst, 'reload schema';
