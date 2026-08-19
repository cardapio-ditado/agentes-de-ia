\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Cenário: um bar com dois locais e três insumos.
insert into venues (id, name) values ('11111111-1111-1111-1111-111111111111','Bar Teste');
insert into estoque_locais (id, venue_id, nome, principal) values
  ('22222222-2222-2222-2222-222222222221','11111111-1111-1111-1111-111111111111','Cozinha', true),
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Bar', false);

insert into insumos (id, venue_id, nome, unidade) values
  ('33333333-3333-3333-3333-333333333331','11111111-1111-1111-1111-111111111111','Tilápia congelada','kg'),
  ('33333333-3333-3333-3333-333333333332','11111111-1111-1111-1111-111111111111','Óleo de soja','L'),
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','Farinha de trigo','kg');

\echo '--- 1. NOME DUPLICADO POR GRAFIA (o bug pendente do Gorjeta) ---'
do $$
begin
  insert into insumos (venue_id, nome) values ('11111111-1111-1111-1111-111111111111','  TILÁPIA   Congelada ');
  raise exception 'FALHA: aceitou grafia duplicada';
exception when unique_violation then
  raise notice 'ok   "  TILÁPIA   Congelada " barrada — mesma coisa que "Tilápia congelada"';
end $$;

\echo '--- 2. CUSTO MÉDIO PONDERADO ---'
-- Compra 1: 10 kg a R$ 20
insert into compras (id, venue_id, local_id) values ('44444444-4444-4444-4444-444444444441','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221');
insert into compra_itens (compra_id, insumo_id, quantidade_pedida, custo_unitario_pedido, quantidade_recebida)
values ('44444444-4444-4444-4444-444444444441','33333333-3333-3333-3333-333333333331',10,20,10);
select cmv_receber_compra('44444444-4444-4444-4444-444444444441');

-- Compra 2: 10 kg a R$ 30 → média tem que ser 25, não 30
insert into compras (id, venue_id, local_id) values ('44444444-4444-4444-4444-444444444442','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221');
insert into compra_itens (compra_id, insumo_id, quantidade_pedida, custo_unitario_pedido, quantidade_recebida)
values ('44444444-4444-4444-4444-444444444442','33333333-3333-3333-3333-333333333331',10,30,10);
select cmv_receber_compra('44444444-4444-4444-4444-444444444442');

select case when custo_medio = 25 then 'ok   custo médio 25,00 (10kg a 20 + 10kg a 30)'
            else 'FALHA custo médio saiu ' || custo_medio end from insumos where id='33333333-3333-3333-3333-333333333331';
select case when quantidade = 20 then 'ok   saldo 20 kg, escrito pelo trigger'
            else 'FALHA saldo ' || quantidade end from estoque_saldos where insumo_id='33333333-3333-3333-3333-333333333331';

\echo '--- 3. COMPRA NÃO É RECEBIDA DUAS VEZES ---'
do $$
begin
  perform cmv_receber_compra('44444444-4444-4444-4444-444444444441');
  raise exception 'FALHA: recebeu a mesma compra duas vezes';
exception when others then
  if sqlerrm = 'compra_ja_recebida' then raise notice 'ok   segunda tentativa recusada (compra_ja_recebida)';
  else raise; end if;
end $$;

\echo '--- 4. FICHA SEM ITEM DE CARDÁPIO (cliente sem o módulo) ---'
insert into fichas_tecnicas (id, venue_id, nome, rendimento, sugerida_por_ia)
values ('55555555-5555-5555-5555-555555555551','11111111-1111-1111-1111-111111111111','Isca de tilápia', 1, true);
insert into ficha_insumos (ficha_id, insumo_id, quantidade) values
  ('55555555-5555-5555-5555-555555555551','33333333-3333-3333-3333-333333333331',0.180),
  ('55555555-5555-5555-5555-555555555551','33333333-3333-3333-3333-333333333332',0.050);
select case when item_id is null then 'ok   ficha criada sem vínculo com cardápio' else 'FALHA' end
  from fichas_tecnicas where id='55555555-5555-5555-5555-555555555551';

\echo '--- 5. FICHA SUGERIDA PELA IA NÃO TEM CUSTO NEM PRODUZ ---'
select case when cmv_custo_da_ficha('55555555-5555-5555-5555-555555555551') is null
            then 'ok   custo NULL enquanto ninguém confere (não zero)'
            else 'FALHA: custo saiu ' || cmv_custo_da_ficha('55555555-5555-5555-5555-555555555551') end;
do $$
begin
  perform cmv_registrar_producao('11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555551','22222222-2222-2222-2222-222222222221', 10);
  raise exception 'FALHA: produziu com ficha não confirmada';
exception when others then
  if sqlerrm = 'ficha_nao_confirmada' then raise notice 'ok   produção recusada: ficha da IA sem conferência';
  else raise; end if;
end $$;

\echo '--- 6. DEPOIS DE CONFERIDA: CUSTO E PRODUÇÃO ---'
update fichas_tecnicas set confirmada_em = now(), sugerida_por_ia = false where id='55555555-5555-5555-5555-555555555551';
-- 0.180 kg * 25 = 4.50 ; óleo custo 0 (nunca comprado) = 0 → 4.50
select case when cmv_custo_da_ficha('55555555-5555-5555-5555-555555555551') = 4.5
            then 'ok   custo da porção 4,50 (0,180kg x 25,00)'
            else 'FALHA custo ' || cmv_custo_da_ficha('55555555-5555-5555-5555-555555555551') end;

select cmv_registrar_producao('11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555551','22222222-2222-2222-2222-222222222221', 10) is not null;
select case when quantidade = 18.2 then 'ok   10 porções baixaram 1,8kg: saldo 18,200'
            else 'FALHA saldo ' || quantidade end from estoque_saldos where insumo_id='33333333-3333-3333-3333-333333333331';

\echo '--- 7. CONTAGEM É VERDADE ABSOLUTA (sem tolerância) ---'
insert into contagens (id, venue_id, local_id) values ('66666666-6666-6666-6666-666666666661','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221');
-- Contou 18,000 mas o sistema diz 18,200: some 0,200 (quebra real)
insert into contagem_itens (contagem_id, insumo_id, quantidade_contada) values
  ('66666666-6666-6666-6666-666666666661','33333333-3333-3333-3333-333333333331',18.0);
select 'ajustes: ' || cmv_processar_contagem('66666666-6666-6666-6666-666666666661');
select case when quantidade = 18.0 then 'ok   saldo virou exatamente 18,000 — sem resíduo'
            else 'FALHA saldo ' || quantidade end from estoque_saldos where insumo_id='33333333-3333-3333-3333-333333333331';
select case when quantidade = -0.2 and tipo = 'ajuste_contagem'
            then 'ok   a diferença virou movimento visível no razão (-0,200)'
            else 'FALHA' end from estoque_movimentos where tipo='ajuste_contagem';

\echo '--- 8. SALDO É POR LOCAL, NÃO SOMADO ---'
select case when count(*) = 0 then 'ok   o Bar não tem tilápia; só a Cozinha'
            else 'FALHA' end from estoque_saldos
 where insumo_id='33333333-3333-3333-3333-333333333331' and local_id='22222222-2222-2222-2222-222222222222';

\echo '--- 9. CMV DO PERÍODO: EI + COMPRAS - EF ---'
-- EI = 0 (sem snapshot anterior); compras = 200+300 = 500; EF = valor atual
select 'EI=' || estoque_inicial || ' compras=' || compras || ' EF=' || round(estoque_final,2) || ' CMV=' || round(cmv,2)
  from cmv_do_periodo('11111111-1111-1111-1111-111111111111', current_date, current_date);
select case when compras = 500 then 'ok   compras do período somam 500,00' else 'FALHA' end
  from cmv_do_periodo('11111111-1111-1111-1111-111111111111', current_date, current_date);

\echo '--- 10. CMV PERCENTUAL (o número que o dono olha) ---'
select case when cmv_percentual is null then 'ok   sem faturamento lançado, percentual NULL (não 0%)'
            else 'FALHA: ' || cmv_percentual end
  from cmv_do_periodo('11111111-1111-1111-1111-111111111111', current_date, current_date);

insert into faturamento_diario (venue_id, data_referencia, valor)
values ('11111111-1111-1111-1111-111111111111', current_date, 200);

-- CMV 50 sobre faturamento 200 = 25,00%
select 'CMV=' || round(cmv,2) || ' faturamento=' || faturamento || ' -> ' || cmv_percentual || '%'
  from cmv_do_periodo('11111111-1111-1111-1111-111111111111', current_date, current_date);
select case when cmv_percentual = 25.00 then 'ok   50 sobre 200 = 25,00%'
            else 'FALHA percentual ' || cmv_percentual end
  from cmv_do_periodo('11111111-1111-1111-1111-111111111111', current_date, current_date);

\echo '--- 11. FATURAMENTO NÃO DUPLICA NO MESMO DIA ---'
do $$
begin
  insert into faturamento_diario (venue_id, data_referencia, valor)
  values ('11111111-1111-1111-1111-111111111111', current_date, 999);
  raise exception 'FALHA: aceitou dois faturamentos no mesmo dia';
exception when unique_violation then
  raise notice 'ok   um faturamento por dia — relançar corrige, não soma';
end $$;

\echo '--- 12. PEDIDO E RECEBIMENTO SÃO MOMENTOS DIFERENTES ---'
-- Carne com 3% de tolerância: variação de açougue é rotina.
insert into insumos (id, venue_id, nome, unidade, tolerancia_divergencia_pct)
values ('33333333-3333-3333-3333-333333333334','11111111-1111-1111-1111-111111111111','Picanha','kg',3);
-- Refrigerante sem tolerância: lata não varia de peso.
insert into insumos (id, venue_id, nome, unidade)
values ('33333333-3333-3333-3333-333333333335','11111111-1111-1111-1111-111111111111','Refrigerante lata','un');

insert into compras (id, venue_id, local_id, fornecedor, status)
values ('44444444-4444-4444-4444-444444444443','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','Açougue Central','rascunho');
select cmv_enviar_pedido('44444444-4444-4444-4444-444444444443');
select case when status = 'pedido' and pedido_em is not null then 'ok   rascunho virou pedido enviado'
            else 'FALHA status ' || status end from compras where id='44444444-4444-4444-4444-444444444443';

do $$
begin
  perform cmv_enviar_pedido('44444444-4444-4444-4444-444444444443');
  raise exception 'FALHA: reenviou pedido já enviado';
exception when others then
  if sqlerrm = 'pedido_nao_esta_em_rascunho' then raise notice 'ok   pedido já enviado não é reenviado';
  else raise; end if;
end $$;

\echo '--- 13. RECEBER SEM CONFERIR NADA É RECUSADO ---'
insert into compra_itens (compra_id, insumo_id, quantidade_pedida, custo_unitario_pedido) values
  ('44444444-4444-4444-4444-444444444443','33333333-3333-3333-3333-333333333334',5,80),
  ('44444444-4444-4444-4444-444444444443','33333333-3333-3333-3333-333333333335',24,4);
do $$
begin
  perform cmv_receber_compra('44444444-4444-4444-4444-444444444443');
  raise exception 'FALHA: recebeu sem ninguém conferir';
exception when others then
  if sqlerrm = 'nada_conferido' then raise notice 'ok   recusado: nenhum item foi conferido';
  else raise; end if;
end $$;

\echo '--- 14. O QUE ENTRA NO ESTOQUE É O QUE CHEGOU ---'
-- Pediu 5kg de picanha, veio 4,900. Pediu 24 latas, vieram 20.
update compra_itens set quantidade_recebida = 4.9
 where compra_id='44444444-4444-4444-4444-444444444443' and insumo_id='33333333-3333-3333-3333-333333333334';
update compra_itens set quantidade_recebida = 20, divergencia_motivo = 'faltaram 4 latas'
 where compra_id='44444444-4444-4444-4444-444444444443' and insumo_id='33333333-3333-3333-3333-333333333335';
select cmv_receber_compra('44444444-4444-4444-4444-444444444443');

select case when quantidade = 4.9 then 'ok   entrou 4,900 kg de picanha — não os 5 pedidos'
            else 'FALHA saldo ' || quantidade end
  from estoque_saldos where insumo_id='33333333-3333-3333-3333-333333333334';
select case when quantidade = 20 then 'ok   entraram 20 latas — não as 24 pedidas'
            else 'FALHA saldo ' || quantidade end
  from estoque_saldos where insumo_id='33333333-3333-3333-3333-333333333335';
-- 4,9 x 80 + 20 x 4 = 392 + 80 = 472
select case when valor_total = 472 then 'ok   valor da compra = o que chegou (472,00), bate com a nota'
            else 'FALHA valor ' || valor_total end from compras where id='44444444-4444-4444-4444-444444444443';

\echo '--- 15. DIVERGÊNCIAS: A TOLERÂNCIA SÓ DECIDE SE COBRA ---'
select insumo_nome || ': pediu ' || quantidade_pedida || ', veio ' || quantidade_recebida
       || ' (' || diferenca_pct || '%) ' || case when acima_da_tolerancia then '-> COBRAR' else '-> normal' end
  from cmv_divergencias('44444444-4444-4444-4444-444444444443');

select case when not acima_da_tolerancia then 'ok   picanha -2% dentro da tolerância de 3% — não vira cobrança'
            else 'FALHA' end
  from cmv_divergencias('44444444-4444-4444-4444-444444444443') where insumo_nome='Picanha';
select case when acima_da_tolerancia and motivo = 'faltaram 4 latas'
            then 'ok   refrigerante -16,67% acima da tolerância 0% — vira cobrança, com motivo'
            else 'FALHA' end
  from cmv_divergencias('44444444-4444-4444-4444-444444444443') where insumo_nome='Refrigerante lata';

\echo '--- 16. COMPRA AVULSA: comprou na rua, lança depois ---'
insert into compras (id, venue_id, local_id, fornecedor, origem, status)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222221','Mercado da esquina','avulsa','rascunho');
-- Sem quantidade pedida: não houve pedido.
insert into compra_itens (compra_id, insumo_id, descricao_nota, quantidade_recebida, custo_unitario_recebido)
values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','FARINHA TRIGO 5KG', 3, 18);
select cmv_receber_compra('44444444-4444-4444-4444-444444444444');

select case when quantidade = 3 then 'ok   3 kg de farinha entraram sem nunca ter sido pedidos'
            else 'FALHA saldo ' || quantidade end
  from estoque_saldos where insumo_id='33333333-3333-3333-3333-333333333333';
select case when count(*) = 0 then 'ok   compra avulsa não gera divergência — não há pedido contra o que comparar'
            else 'FALHA: ' || count(*) || ' divergências' end
  from cmv_divergencias('44444444-4444-4444-4444-444444444444');

\echo '--- 17. AVULSA NÃO VIRA PEDIDO ---'
insert into compras (id, venue_id, local_id, origem, status)
values ('44444444-4444-4444-4444-444444444445','11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222221','avulsa','rascunho');
do $$
begin
  perform cmv_enviar_pedido('44444444-4444-4444-4444-444444444445');
  raise exception 'FALHA: enviou compra avulsa como pedido';
exception when others then
  if sqlerrm = 'pedido_nao_esta_em_rascunho' then raise notice 'ok   avulsa não pode ser "enviada ao fornecedor"';
  else raise; end if;
end $$;

\echo '--- 18. LINHA SEM QUANTIDADE NENHUMA É RECUSADA ---'
do $$
begin
  insert into compra_itens (compra_id, descricao_nota) values ('44444444-4444-4444-4444-444444444445','LIXO');
  raise exception 'FALHA: aceitou linha sem quantidade';
exception when check_violation then
  raise notice 'ok   linha sem pedida nem recebida barrada pela constraint';
end $$;
