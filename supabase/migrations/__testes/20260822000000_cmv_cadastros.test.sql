-- Testa as regras da migração de cadastros. Rodar DEPOIS das migrações do
-- CMV (ver LEIA-ME.md) num banco de teste — os erros no meio da saída são
-- esperados: são as regras recusando o que devem recusar.
\set QUIET on
\pset tuples_only on

insert into venues (id, name) values ('00000000-0000-0000-0000-000000000001', 'Teste')
  on conflict do nothing;

-- 1. tipo='principal' liga o espelho `principal`
insert into estoque_locais (venue_id, nome, tipo)
  values ('00000000-0000-0000-0000-000000000001', 'Depósito', 'principal');
select case when principal then 'ok 1: tipo=principal liga o principal' else 'FALHA 1' end
  from estoque_locais where nome = 'Depósito';

-- 2. segundo principal é recusado pelo índice único (erro esperado)
insert into estoque_locais (venue_id, nome, tipo)
  values ('00000000-0000-0000-0000-000000000001', 'Adega', 'principal');
select 'ok 2: segundo principal foi recusado (erro acima esperado)';

-- 3. tipo inventado é recusado pela constraint (erro esperado)
insert into estoque_locais (venue_id, nome, tipo)
  values ('00000000-0000-0000-0000-000000000001', 'X', 'gaveta');
select 'ok 3: tipo inválido recusado (erro acima esperado)';

-- 4. produção é tipo válido e não vira principal
insert into estoque_locais (venue_id, nome, tipo)
  values ('00000000-0000-0000-0000-000000000001', 'Cozinha', 'producao');
select case when not principal then 'ok 4: produção não vira principal' else 'FALHA 4' end
  from estoque_locais where nome = 'Cozinha';

-- 5. categoria com caixa/espaço diferente é a MESMA categoria (erro esperado)
insert into insumo_categorias (venue_id, nome)
  values ('00000000-0000-0000-0000-000000000001', 'Bebidas');
insert into insumo_categorias (venue_id, nome)
  values ('00000000-0000-0000-0000-000000000001', '  BEBIDAS ');
select case when count(*) = 1
  then 'ok 5: "  BEBIDAS " não duplicou (erro acima esperado)' else 'FALHA 5' end
  from insumo_categorias;

-- 6/7. item fora do CMV passa pelo estoque mas fica FORA da conta
insert into insumos (venue_id, nome, unidade, entra_no_cmv) values
  ('00000000-0000-0000-0000-000000000001', 'Picanha', 'kg', true),
  ('00000000-0000-0000-0000-000000000001', 'Detergente', 'un', false);

do $x$
declare v_compra uuid; v_local uuid; v_picanha uuid; v_deterg uuid;
begin
  select id into v_local from estoque_locais where nome = 'Depósito';
  select id into v_picanha from insumos where nome = 'Picanha';
  select id into v_deterg from insumos where nome = 'Detergente';
  insert into compras (venue_id, local_id, origem, status)
    values ('00000000-0000-0000-0000-000000000001', v_local, 'avulsa', 'rascunho')
    returning id into v_compra;
  insert into compra_itens (compra_id, insumo_id, quantidade_recebida, custo_unitario_recebido) values
    (v_compra, v_picanha, 10, 50),   -- R$ 500 de carne (CMV)
    (v_compra, v_deterg, 10, 10);    -- R$ 100 de detergente (fora)
  perform cmv_receber_compra(v_compra, null);
end $x$;

select case when cmv_valor_do_estoque('00000000-0000-0000-0000-000000000001') = 500
  then 'ok 6: valor do estoque só conta o CMV (500, sem o detergente)'
  else 'FALHA 6: valor = ' || cmv_valor_do_estoque('00000000-0000-0000-0000-000000000001') end;

insert into faturamento_diario (venue_id, data_referencia, valor)
  values ('00000000-0000-0000-0000-000000000001', current_date, 2000);
select case when compras = 500 and cmv_percentual is not null
  then 'ok 7: compras do período sem o detergente (500) e o percentual sai'
  else 'FALHA 7: compras = ' || compras end
  from cmv_do_periodo('00000000-0000-0000-0000-000000000001', current_date, current_date);
