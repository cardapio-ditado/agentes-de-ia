\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Cenário: um bar com dois atendentes e a pesquisa ligada.
insert into venues (id, name) values ('11111111-1111-1111-1111-111111111111','Bar Teste');
insert into pesquisa_config (venue_id) values ('11111111-1111-1111-1111-111111111111');
insert into pesquisa_atendentes (id, venue_id, nome) values
  ('22222222-2222-2222-2222-222222222221','11111111-1111-1111-1111-111111111111','Ana Paula'),
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Carlos');

\echo '--- 1. ATENDENTE REPETIDO POR GRAFIA ---'
do $$
begin
  insert into pesquisa_atendentes (venue_id, nome)
  values ('11111111-1111-1111-1111-111111111111','  ANA   paula ');
  raise exception 'FALHA: aceitou o mesmo atendente duas vezes';
exception when unique_violation then
  raise notice 'ok   "  ANA   paula " barrada — é a mesma pessoa que "Ana Paula"';
end $$;

\echo '--- 2. NOTA FORA DA ESCALA ---'
do $$
begin
  insert into pesquisa_respostas (venue_id, nota)
  values ('11111111-1111-1111-1111-111111111111', 11);
  raise exception 'FALHA: aceitou nota 11';
exception when check_violation then
  raise notice 'ok   nota 11 recusada — a escala do NPS vai de 0 a 10';
end $$;

\echo '--- 3. ATENDENTE SEM NOTA ---'
do $$
begin
  insert into pesquisa_respostas (venue_id, nota, atendente_id)
  values ('11111111-1111-1111-1111-111111111111', 10, '22222222-2222-2222-2222-222222222221');
  raise exception 'FALHA: gravou atendente sem a nota dele';
exception when check_violation then
  raise notice 'ok   atendente sem nota recusado — o ranking ficaria pela metade';
end $$;

\echo '--- 4. UM PRÊMIO POR RESPOSTA ---'
insert into pesquisa_respostas (id, venue_id, nota, atendente_id, atendente_nota, comentario)
values ('33333333-3333-3333-3333-333333333331','11111111-1111-1111-1111-111111111111',
        10,'22222222-2222-2222-2222-222222222221',5,'Atendimento excelente, comida muito boa');

select case when a.id = b.id and a.codigo = b.codigo
            then 'ok   emitir duas vezes devolve o MESMO cupom (' || a.codigo || ')'
            else 'FALHA emitiu dois cupons: ' || a.codigo || ' e ' || b.codigo end
  from pesquisa_emitir_premio('33333333-3333-3333-3333-333333333331','Chopp em dobro',30) a,
       pesquisa_emitir_premio('33333333-3333-3333-3333-333333333331','Chopp em dobro',30) b;

select case when count(*) = 1 then 'ok   uma linha de cupom para a resposta'
            else 'FALHA ' || count(*) || ' cupons na tabela' end
  from pesquisa_premios where resposta_id = '33333333-3333-3333-3333-333333333331';

\echo '--- 5. CÓDIGO SEM LETRA AMBÍGUA ---'
select case when codigo !~ '[01OI]' and length(codigo) = 6
            then 'ok   código ' || codigo || ' sem 0/O/1/I e com 6 caracteres'
            else 'FALHA código ruim de ditar: ' || codigo end
  from pesquisa_premios where resposta_id = '33333333-3333-3333-3333-333333333331';

\echo '--- 6. RESGATE ---'
select case when resgatado_em is not null
            then 'ok   resgatado com o código digitado em minúscula e com hífen'
            else 'FALHA não resgatou' end
  from pesquisa_resgatar_premio(
    '11111111-1111-1111-1111-111111111111',
    (select lower(substr(codigo,1,3) || '-' || substr(codigo,4,3))
       from pesquisa_premios where resposta_id = '33333333-3333-3333-3333-333333333331')
  );

do $$
declare v_cod text;
begin
  select codigo into v_cod from pesquisa_premios
   where resposta_id = '33333333-3333-3333-3333-333333333331';
  perform pesquisa_resgatar_premio('11111111-1111-1111-1111-111111111111', v_cod);
  raise exception 'FALHA: resgatou o mesmo cupom duas vezes';
exception when unique_violation then
  raise notice 'ok   segundo resgate recusado — um cupom vale uma vez';
end $$;

\echo '--- 7. CUPOM DE OUTRA CASA ---'
insert into venues (id, name) values ('11111111-1111-1111-1111-111111111112','Outro Bar');
do $$
declare v_cod text;
begin
  select codigo into v_cod from pesquisa_premios
   where resposta_id = '33333333-3333-3333-3333-333333333331';
  perform pesquisa_resgatar_premio('11111111-1111-1111-1111-111111111112', v_cod);
  raise exception 'FALHA: uma casa resgatou o cupom da outra';
exception when no_data_found then
  raise notice 'ok   cupom da casa vizinha não é encontrado aqui';
end $$;

\echo '--- 8. CUPOM VENCIDO ---'
insert into pesquisa_respostas (id, venue_id, nota)
values ('33333333-3333-3333-3333-333333333332','11111111-1111-1111-1111-111111111111', 9);
select pesquisa_emitir_premio('33333333-3333-3333-3333-333333333332','Sobremesa grátis',30);
update pesquisa_premios set expira_em = now() - interval '1 day'
 where resposta_id = '33333333-3333-3333-3333-333333333332';
do $$
declare v_cod text;
begin
  select codigo into v_cod from pesquisa_premios
   where resposta_id = '33333333-3333-3333-3333-333333333332';
  perform pesquisa_resgatar_premio('11111111-1111-1111-1111-111111111111', v_cod);
  raise exception 'FALHA: resgatou cupom vencido';
exception when check_violation then
  raise notice 'ok   cupom vencido recusado';
end $$;

\echo '--- 9. CONVITE DE USO ÚNICO ---'
insert into pesquisa_convites (id, venue_id, telefone, token)
values ('44444444-4444-4444-4444-444444444441','11111111-1111-1111-1111-111111111111','5565999990000','tok-abc');

insert into pesquisa_respostas (venue_id, nota, origem, convite_id)
values ('11111111-1111-1111-1111-111111111111', 8, 'whatsapp', '44444444-4444-4444-4444-444444444441');

select case when respondido_em is not null
            then 'ok   convite marcado como respondido pelo próprio banco'
            else 'FALHA convite continua em aberto' end
  from pesquisa_convites where id = '44444444-4444-4444-4444-444444444441';

do $$
begin
  insert into pesquisa_respostas (venue_id, nota, origem, convite_id)
  values ('11111111-1111-1111-1111-111111111111', 10, 'whatsapp', '44444444-4444-4444-4444-444444444441');
  raise exception 'FALHA: o mesmo convite respondeu duas vezes';
exception when unique_violation then
  raise notice 'ok   link repassado no grupo não vira dez respostas';
end $$;

\echo '--- 10. APAGAR A CASA LEVA TUDO JUNTO ---'
delete from venues where id = '11111111-1111-1111-1111-111111111111';
select case when (select count(*) from pesquisa_respostas) = 0
             and (select count(*) from pesquisa_premios) = 0
             and (select count(*) from pesquisa_atendentes) = 0
            then 'ok   cliente removido não deixa resposta nem cupom órfão'
            else 'FALHA sobrou dado da casa apagada' end;
