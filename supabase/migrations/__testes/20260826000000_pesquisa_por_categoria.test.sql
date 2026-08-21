\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

insert into venues (id, name) values ('11111111-1111-1111-1111-111111111111','Bar Teste');

\echo '--- 1. UMA PESQUISA ATIVA POR CASA ---'
insert into pesquisas (id, venue_id, nome, ativa)
values ('55555555-5555-5555-5555-555555555551','11111111-1111-1111-1111-111111111111','Pesquisa do salão', true);

do $$
begin
  insert into pesquisas (venue_id, nome, ativa)
  values ('11111111-1111-1111-1111-111111111111','Outra pesquisa', true);
  raise exception 'FALHA: aceitou duas pesquisas ativas';
exception when unique_violation then
  raise notice 'ok   segunda pesquisa ativa barrada — o QR da mesa não escolhe entre duas';
end $$;

-- Guardar rascunho continua liberado: só a ATIVA é única.
insert into pesquisas (id, venue_id, nome, ativa)
values ('55555555-5555-5555-5555-555555555552','11111111-1111-1111-1111-111111111111','Rascunho de dezembro', false),
       ('55555555-5555-5555-5555-555555555553','11111111-1111-1111-1111-111111111111','Rascunho de férias', false);
select case when count(*) = 2 then 'ok   rascunhos podem ser vários'
            else 'FALHA rascunhos limitados indevidamente' end
  from pesquisas where venue_id='11111111-1111-1111-1111-111111111111' and not ativa;

\echo '--- 2. NOTA NORMALIZADA FORA DA FAIXA ---'
insert into pesquisa_respostas (id, venue_id, nota, pesquisa_id)
values ('33333333-3333-3333-3333-333333333331','11111111-1111-1111-1111-111111111111',
        9,'55555555-5555-5555-5555-555555555551');

do $$
begin
  insert into pesquisa_resposta_itens (resposta_id, venue_id, item_id, categoria, pergunta, tipo, nota)
  values ('33333333-3333-3333-3333-333333333331','11111111-1111-1111-1111-111111111111',
          'i1','Comida','A comida agradou?','nota', 12);
  raise exception 'FALHA: aceitou nota 12 na escala normalizada';
exception when check_violation then
  raise notice 'ok   nota 12 recusada — tudo é normalizado de 0 a 10';
end $$;

\echo '--- 3. A MESMA PERGUNTA NÃO CONTA DUAS VEZES ---'
insert into pesquisa_resposta_itens (resposta_id, venue_id, item_id, categoria, pergunta, tipo, nota, valor)
values ('33333333-3333-3333-3333-333333333331','11111111-1111-1111-1111-111111111111',
        'i1','Comida','A comida agradou?','nota', 8, '8');
do $$
begin
  insert into pesquisa_resposta_itens (resposta_id, venue_id, item_id, categoria, pergunta, tipo, nota, valor)
  values ('33333333-3333-3333-3333-333333333331','11111111-1111-1111-1111-111111111111',
          'i1','Comida','A comida agradou?','nota', 3, '3');
  raise exception 'FALHA: reenvio contou a mesma nota duas vezes';
exception when unique_violation then
  raise notice 'ok   reenvio por falha de rede não puxa a média da casa';
end $$;

\echo '--- 4. PERGUNTA DE TEXTO NÃO PONTUA ---'
insert into pesquisa_resposta_itens (resposta_id, venue_id, item_id, categoria, pergunta, tipo, texto)
values ('33333333-3333-3333-3333-333333333331','11111111-1111-1111-1111-111111111111',
        'i2','Geral','Quer contar mais?','texto','O som estava alto demais');
select case when nota is null then 'ok   pergunta de texto entra sem nota, sem estragar a média'
            else 'FALHA texto ganhou nota ' || nota end
  from pesquisa_resposta_itens where item_id = 'i2';

\echo '--- 5. MÉDIA POR CATEGORIA ---'
insert into pesquisa_respostas (id, venue_id, nota, pesquisa_id)
values ('33333333-3333-3333-3333-333333333332','11111111-1111-1111-1111-111111111111',
        7,'55555555-5555-5555-5555-555555555551');
insert into pesquisa_resposta_itens (resposta_id, venue_id, item_id, categoria, pergunta, tipo, nota, valor)
values ('33333333-3333-3333-3333-333333333332','11111111-1111-1111-1111-111111111111',
        'i1','Comida','A comida agradou?','nota', 6, '6'),
       ('33333333-3333-3333-3333-333333333332','11111111-1111-1111-1111-111111111111',
        'i3','Atendimento','Como foi o atendimento?','estrelas', 10, '5');

select case when round(avg(nota),2) = 7.00 then 'ok   média de Comida = 7,00 (8 e 6)'
            else 'FALHA média de Comida saiu ' || round(avg(nota),2) end
  from pesquisa_resposta_itens where categoria = 'Comida';

select case when round(avg(nota),2) = 10.00
            then 'ok   estrelas somam junto com nota na mesma escala'
            else 'FALHA Atendimento saiu ' || round(avg(nota),2) end
  from pesquisa_resposta_itens where categoria = 'Atendimento';

\echo '--- 6. O PRÊMIO SÓ VALE NA PRÓXIMA VISITA ---'
select pesquisa_emitir_premio('33333333-3333-3333-3333-333333333331','Chopp em dobro',30,
                              now() + interval '6 hours');
do $$
declare v_cod text;
begin
  select codigo into v_cod from pesquisa_premios
   where resposta_id = '33333333-3333-3333-3333-333333333331';
  perform pesquisa_resgatar_premio('11111111-1111-1111-1111-111111111111', v_cod);
  raise exception 'FALHA: resgatou o cupom no mesmo dia em que ganhou';
exception when restrict_violation then
  raise notice 'ok   cupom recusado hoje — é prêmio pela PRÓXIMA visita';
end $$;

-- Passado o dia, resgata normalmente.
update pesquisa_premios set liberado_em = now() - interval '1 minute'
 where resposta_id = '33333333-3333-3333-3333-333333333331';
select case when resgatado_em is not null then 'ok   liberado, resgata normalmente'
            else 'FALHA não resgatou depois de liberado' end
  from pesquisa_resgatar_premio('11111111-1111-1111-1111-111111111111',
    (select codigo from pesquisa_premios where resposta_id='33333333-3333-3333-3333-333333333331'));

\echo '--- 7. CUPOM ANTIGO NÃO É TRAVADO PELA REGRA NOVA ---'
select case when liberado_em is not null and liberado_em <= now()
            then 'ok   cupom já existente continua valendo (liberado_em = created_at)'
            else 'FALHA cupom antigo travou' end
  from pesquisa_premios where resposta_id = '33333333-3333-3333-3333-333333333331';

\echo '--- 8. APAGAR O MODELO NÃO APAGA O HISTÓRICO ---'
delete from pesquisas where id = '55555555-5555-5555-5555-555555555551';
select case when (select count(*) from pesquisa_respostas) = 2
             and (select count(*) from pesquisa_resposta_itens) = 4
            then 'ok   pesquisa apagada, as 200 respostas de agosto continuam lá'
            else 'FALHA apagar o modelo levou as respostas junto' end;

select case when pesquisa_id is null then 'ok   a resposta perde o vínculo mas guarda a pergunta copiada'
            else 'FALHA vínculo sobreviveu ao delete' end
  from pesquisa_respostas where id = '33333333-3333-3333-3333-333333333331';

\echo '--- 9. APAGAR A RESPOSTA LEVA AS NOTAS DELA ---'
delete from pesquisa_respostas where id = '33333333-3333-3333-3333-333333333332';
select case when count(*) = 2 then 'ok   as notas da resposta apagada foram junto'
            else 'FALHA sobraram ' || count(*) || ' linhas órfãs' end
  from pesquisa_resposta_itens;
