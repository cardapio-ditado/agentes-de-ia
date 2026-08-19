-- Importação de vendas: o relatório do PDV baixa o estoque.
--
-- Cada casa usa um PDV diferente e nenhum deles exporta igual. A saída não é
-- padronizar o relatório (impossível) — é padronizar o RESULTADO da leitura:
-- data, produto, quantidade, valor. Depois dessa linha o sistema não sabe
-- nem se importa de onde veio.
--
-- Três armadilhas do Gorjeta que este desenho evita, todas verificadas no
-- código dele:
--
--   1. Lá não há nada que impeça importar o mesmo relatório duas vezes — sem
--      hash, sem chave única. O estoque baixa em dobro e ninguém entende por
--      quê. Aqui a impressão digital do arquivo é única por casa.
--
--   2. Lá o movimento é gravado com a data de HOJE
--      (`data_movimentacao: new Date()`). O relatório de sábado importado na
--      segunda tira o estoque na segunda, e o CMV do período fecha com venda
--      de um mês e baixa de outro. Aqui o movimento carimba a DATA DA VENDA.
--
--   3. Lá existem três tabelas de mapeamento fazendo o mesmo trabalho
--      (mapeamentos_itens_excel, mapeamentos_vendas_estoque,
--      mapeamento_itens_vendas) — a mesma doença das três funções de saldo.
--      Aqui é uma só.

-- ============================================================
-- A importação: um arquivo, uma vez
-- ============================================================

create table if not exists public.venda_importacoes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  arquivo_nome text,
  -- SHA-256 do arquivo. É a trava contra a baixa em dobro: o mesmo relatório
  -- enviado de novo é reconhecido antes de mexer em qualquer saldo.
  arquivo_hash text not null,
  periodo_inicio date,
  periodo_fim date,
  origem text not null default 'arquivo'
    check (origem in ('arquivo', 'foto', 'api')),
  status text not null default 'revisao'
    check (status in ('revisao', 'baixada', 'descartada')),
  -- O que a IA leu, cru. Guardado para quando a leitura sair torta e for
  -- preciso entender o que ela viu.
  extracao_ia jsonb,
  observacao text,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  baixada_em timestamptz,

  unique (venue_id, arquivo_hash)
);

comment on column public.venda_importacoes.arquivo_hash is
  'SHA-256 do arquivo. Único por casa: o mesmo relatório não entra duas vezes, e é isso que impede o estoque de baixar em dobro.';

-- ============================================================
-- As linhas do relatório
-- ============================================================

create table if not exists public.venda_itens (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references public.venda_importacoes(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  linha_numero int,

  -- Como veio escrito no relatório. Fica gravado mesmo depois de casar: é a
  -- memória de como ESTE PDV escreve, e é o que faz a próxima importação
  -- casar sozinha.
  produto_externo text not null,
  produto_normalizado text not null,
  codigo_externo text,

  -- A data da VENDA. Não é a data da importação, e essa diferença é o que
  -- mantém o CMV do período honesto.
  data_venda date not null,
  quantidade numeric(12,3) not null check (quantidade > 0),
  valor_total numeric(12,2),

  -- O alvo da baixa: uma ficha (prato → saem os insumos da receita) OU um
  -- insumo direto (long neck → sai ela mesma). Nunca os dois.
  ficha_id uuid references public.fichas_tecnicas(id) on delete set null,
  insumo_id uuid references public.insumos(id) on delete set null,
  local_id uuid references public.estoque_locais(id) on delete set null,

  confianca numeric(4,3) not null default 0,
  como text,
  status text not null default 'pendente'
    check (status in ('pendente', 'mapeado', 'ignorado', 'baixado')),

  criado_em timestamptz not null default now(),

  constraint venda_item_alvo_unico
    check (num_nonnulls(ficha_id, insumo_id) <= 1),
  -- Mapeado sem alvo não existe: seria uma linha que promete baixa e não
  -- baixa nada.
  constraint venda_item_mapeado_tem_alvo
    check (status <> 'mapeado' or num_nonnulls(ficha_id, insumo_id) = 1)
);

create index if not exists venda_itens_importacao
  on public.venda_itens (importacao_id, status);
create index if not exists venda_itens_produto
  on public.venda_itens (venue_id, produto_normalizado);

-- ============================================================
-- O aprendizado: nome do PDV → o que baixar
-- ============================================================
-- Uma tabela. Cada correção humana grava aqui, e a próxima importação já
-- casa sozinha. É o que faz a primeira importação levar vinte minutos e a
-- terceira, um toque.

create table if not exists public.venda_apelidos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  apelido text not null,
  apelido_normalizado text not null,
  ficha_id uuid references public.fichas_tecnicas(id) on delete cascade,
  insumo_id uuid references public.insumos(id) on delete cascade,
  usos int not null default 1,
  ultimo_uso timestamptz not null default now(),
  criado_em timestamptz not null default now(),

  unique (venue_id, apelido_normalizado),
  constraint venda_apelido_alvo_unico
    check (num_nonnulls(ficha_id, insumo_id) = 1)
);

create or replace function public.venda_apelidos_normalizar()
returns trigger
language plpgsql
as $$
begin
  new.apelido_normalizado := public.cmv_normalizar(new.apelido);
  return new;
end;
$$;

drop trigger if exists venda_apelidos_antes on public.venda_apelidos;
create trigger venda_apelidos_antes
  before insert or update on public.venda_apelidos
  for each row execute function public.venda_apelidos_normalizar();

-- ============================================================
-- O aprendizado do formato do relatório
-- ============================================================
-- A segunda aprendizagem, que o Gorjeta não tem: como ESTE relatório é
-- montado (qual coluna é o produto, quantas linhas de cabeçalho pular).
-- Sabendo isso, a segunda importação do mesmo PDV é lida sem IA nenhuma —
-- instantânea e de graça.

create table if not exists public.venda_layouts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nome text not null,
  -- Impressão digital da ESTRUTURA (cabeçalho normalizado), não do conteúdo:
  -- o relatório de terça e o de quarta têm o mesmo layout e dados diferentes.
  impressao_digital text not null,
  receita jsonb not null,
  usos int not null default 1,
  ultimo_uso timestamptz not null default now(),
  criado_em timestamptz not null default now(),

  unique (venue_id, impressao_digital)
);

-- ============================================================
-- A baixa
-- ============================================================

/**
 * Baixa do estoque as vendas de uma importação — tudo ou nada.
 *
 * Só o que está 'mapeado' baixa. Linha pendente (a IA não achou o alvo) NÃO
 * trava a importação e NÃO baixa nada: fica visível como "venda sem receita",
 * e o painel diz a verdade — "82% das vendas baixaram" vale mais que 100%
 * com 18% de chute.
 *
 * A ficha baixa POR PORÇÃO: a receita guarda a quantidade do lote e quantas
 * porções ele rende, então vender 3 porções consome quantidade/rendimento*3.
 * Usar a quantidade do lote direto baixaria a produção inteira a cada prato
 * vendido — o erro que faz o estoque zerar no primeiro dia.
 */
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
begin
  select * into v_imp
    from public.venda_importacoes
   where id = p_importacao_id;
  if not found then
    raise exception 'importacao_nao_encontrada';
  end if;
  -- A trava que impede a baixa em dobro mesmo que a tela chame duas vezes.
  if v_imp.status = 'baixada' then
    raise exception 'vendas_ja_baixadas';
  end if;
  if v_imp.status = 'descartada' then
    raise exception 'importacao_descartada';
  end if;

  -- O estoque de onde a venda sai: o do item, se alguém escolheu; senão o
  -- principal da casa.
  select id into v_local
    from public.estoque_locais
   where venue_id = v_imp.venue_id and principal and ativo
   limit 1;

  for v_item in
    select * from public.venda_itens
     where importacao_id = p_importacao_id and status = 'mapeado'
     order by linha_numero
  loop
    if v_item.ficha_id is not null then
      -- Prato: saem os insumos da receita, proporcionais à porção vendida.
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
           'venda', v_item.id, p_usuario, v_item.data_venda::timestamptz);
        v_movs := v_movs + 1;
      end loop;

    elsif v_item.insumo_id is not null then
      -- Venda direta: sai o próprio item (a long neck vendida é uma a menos).
      insert into public.estoque_movimentos
        (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario,
         origem_tipo, origem_id, criado_por, criado_em)
      select
        v_imp.venue_id, v_item.insumo_id, coalesce(v_item.local_id, v_local),
        -v_item.quantidade, 'venda', i.custo_medio,
        'venda', v_item.id, p_usuario, v_item.data_venda::timestamptz
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

/**
 * Consumo teórico × real por insumo, no período.
 *
 * O prêmio de ter a venda baixando por ficha: as fichas dizem que os pratos
 * vendidos consumiram tanto; a contagem diz que sumiu tanto. A diferença tem
 * nome — porção passada do ponto, quebra, ficha desatualizada ou desvio — e
 * é item a item, não um número só no fim do mês.
 */
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
       and m.criado_em >= p_inicio
       and m.criado_em < (p_fim + 1)
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

-- ============================================================
-- Acesso
-- ============================================================

alter table public.venda_importacoes enable row level security;
alter table public.venda_itens       enable row level security;
alter table public.venda_apelidos    enable row level security;
alter table public.venda_layouts     enable row level security;

notify pgrst, 'reload schema';
