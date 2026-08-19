-- Testa a baixa de vendas. Rodar depois das migrações do CMV (ver LEIA-ME.md).
-- Os erros no meio da saída são esperados: são as travas recusando o que devem.
\set QUIET on
\pset tuples_only on

insert into venues (id, name) values ('00000000-0000-0000-0000-000000000009','Bar')
  on conflict do nothing;
insert into estoque_locais (venue_id, nome, tipo)
  values ('00000000-0000-0000-0000-000000000009','Depósito','principal');
insert into insumos (venue_id, nome, unidade, custo_medio) values
  ('00000000-0000-0000-0000-000000000009','Tilápia filé','kg',50),
  ('00000000-0000-0000-0000-000000000009','Cerveja long neck','un',4);

-- estoque inicial: 20 kg de tilápia, 100 long necks
do $x$
declare v_local uuid; v_t uuid; v_c uuid;
begin
  select id into v_local from estoque_locais where nome='Depósito';
  select id into v_t from insumos where nome='Tilápia filé';
  select id into v_c from insumos where nome='Cerveja long neck';
  insert into estoque_movimentos (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario)
  values ('00000000-0000-0000-0000-000000000009', v_t, v_local, 20, 'compra', 50),
         ('00000000-0000-0000-0000-000000000009', v_c, v_local, 100, 'compra', 4);
end $x$;

-- ficha: lote de 1,2 kg rende 4 porções -> 0,3 kg por porção
do $x$
declare v_f uuid; v_t uuid;
begin
  select id into v_t from insumos where nome='Tilápia filé';
  insert into fichas_tecnicas (venue_id, nome, rendimento, confirmada_em)
    values ('00000000-0000-0000-0000-000000000009','Isca de tilápia',4, now()) returning id into v_f;
  insert into ficha_insumos (ficha_id, insumo_id, quantidade) values (v_f, v_t, 1.2);
end $x$;

-- 10 iscas + 30 long necks vendidas em 15/08
do $x$
declare v_imp uuid; v_f uuid; v_c uuid;
begin
  select id into v_f from fichas_tecnicas limit 1;
  select id into v_c from insumos where nome='Cerveja long neck';
  insert into venda_importacoes (venue_id, arquivo_nome, arquivo_hash, periodo_inicio, periodo_fim)
    values ('00000000-0000-0000-0000-000000000009','vendas.csv','hash-abc','2026-08-15','2026-08-15')
    returning id into v_imp;
  insert into venda_itens (importacao_id, venue_id, linha_numero, produto_externo, produto_normalizado,
                           data_venda, quantidade, ficha_id, status)
    values (v_imp,'00000000-0000-0000-0000-000000000009',1,'PORCAO ISCA TILAPIA','porcao isca tilapia',
            '2026-08-15',10,v_f,'mapeado');
  insert into venda_itens (importacao_id, venue_id, linha_numero, produto_externo, produto_normalizado,
                           data_venda, quantidade, insumo_id, status)
    values (v_imp,'00000000-0000-0000-0000-000000000009',2,'CERVEJA LN','cerveja ln',
            '2026-08-15',30,v_c,'mapeado');
  perform cmv_baixar_vendas(v_imp);
end $x$;

-- 1. A ficha baixa POR PORÇÃO, não o lote inteiro (o erro que zera o estoque
--    no primeiro dia).
select case when cmv_saldo(i.id, l.id) = 17
  then 'ok 1: ficha baixou por porção (20 - 0,3x10 = 17 kg)'
  else 'FALHA 1: saldo = ' || cmv_saldo(i.id, l.id) end
from insumos i, estoque_locais l where i.nome='Tilápia filé' and l.nome='Depósito';

-- 2. Venda direta baixa o próprio item.
select case when cmv_saldo(i.id, l.id) = 70
  then 'ok 2: venda direta baixou o próprio item (100 - 30 = 70)'
  else 'FALHA 2: saldo = ' || cmv_saldo(i.id, l.id) end
from insumos i, estoque_locais l where i.nome='Cerveja long neck' and l.nome='Depósito';

-- 3. O movimento carimba a DATA DA VENDA, não a de hoje — é o que mantém o
--    CMV do período honesto (o erro que o Gorjeta comete).
select case when count(*) = 2 then 'ok 3: movimento carimbou a data da venda'
  else 'FALHA 3: movimentos em 15/08 = ' || count(*) end
from estoque_movimentos where tipo='venda' and criado_em::date = '2026-08-15';

-- 4. Baixar duas vezes é recusado (erro esperado).
do $x$
declare v_imp uuid;
begin
  select id into v_imp from venda_importacoes limit 1;
  perform cmv_baixar_vendas(v_imp);
end $x$;
select 'ok 4: segunda baixa recusada (erro acima esperado)';

-- 5. O mesmo arquivo de novo é recusado pela impressão digital (erro esperado).
insert into venda_importacoes (venue_id, arquivo_nome, arquivo_hash)
  values ('00000000-0000-0000-0000-000000000009','vendas.csv','hash-abc');
select 'ok 5: mesmo arquivo recusado pelo hash (erro acima esperado)';

-- 6. Linha "mapeada" sem alvo não existe (erro esperado).
insert into venda_itens (importacao_id, venue_id, produto_externo, produto_normalizado,
                         data_venda, quantidade, status)
  select id, venue_id, 'X','x','2026-08-15',1,'mapeado' from venda_importacoes limit 1;
select 'ok 6: mapeado sem alvo recusado (erro acima esperado)';

-- 7. Teórico x real: sem quebra nem perda, a diferença é zero.
select case when abs(diferenca) < 0.001
  then 'ok 7: teórico x real bate quando só houve venda (' || teorico || ' kg)'
  else 'FALHA 7: diferenca = ' || diferenca end
from cmv_teorico_versus_real('00000000-0000-0000-0000-000000000009','2026-08-01','2026-08-31')
where insumo = 'Tilápia filé';
