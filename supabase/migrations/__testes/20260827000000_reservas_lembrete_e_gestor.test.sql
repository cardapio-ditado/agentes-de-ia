\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

insert into organizations (id, slug, name) values ('99999999-9999-9999-9999-999999999999','org-teste','Org Teste');
insert into venues (id, org_id, slug, name)
values ('11111111-1111-1111-1111-111111111111','99999999-9999-9999-9999-999999999999','bar-teste','Bar Teste');

insert into reservations (id, venue_id, customer_name, customer_phone, party_size, reserved_for, status, reviewed_at)
values ('22222222-2222-2222-2222-222222222221','11111111-1111-1111-1111-111111111111',
        'Mariana Prado','65999991111', 6, now() + interval '50 minutes', 'approved', now()),
       ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',
        'Rodrigo Alencar','65988882222', 4, now() + interval '3 hours', 'approved', now());

\echo '--- 1. O PADRÃO É UMA HORA ANTES ---'
select case when reserva_lembrete_minutos = 60
            then 'ok   casa nova já nasce lembrando 60 minutos antes'
            else 'FALHA padrão saiu ' || reserva_lembrete_minutos end
  from venues where id = '11111111-1111-1111-1111-111111111111';

\echo '--- 2. ANTECEDÊNCIA FORA DA FAIXA ---'
do $$
begin
  update venues set reserva_lembrete_minutos = 4320
   where id = '11111111-1111-1111-1111-111111111111';
  raise exception 'FALHA: aceitou lembrete com três dias de antecedência';
exception when check_violation then
  raise notice 'ok   três dias recusado — lembrete assim não é lembrete';
end $$;

do $$
begin
  update venues set reserva_lembrete_minutos = -10
   where id = '11111111-1111-1111-1111-111111111111';
  raise exception 'FALHA: aceitou antecedência negativa';
exception when check_violation then
  raise notice 'ok   antecedência negativa recusada';
end $$;

update venues set reserva_lembrete_minutos = 0 where id = '11111111-1111-1111-1111-111111111111';
select case when reserva_lembrete_minutos = 0 then 'ok   zero é aceito — é como se desliga'
            else 'FALHA zero recusado' end
  from venues where id = '11111111-1111-1111-1111-111111111111';
update venues set reserva_lembrete_minutos = 60 where id = '11111111-1111-1111-1111-111111111111';

\echo '--- 3. UM LEMBRETE POR RESERVA ---'
insert into notifications (venue_id, reservation_id, channel, destination, template, body)
values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221',
        'whatsapp','65999991111','reserva_lembrete','Passando pra lembrar...');

do $$
begin
  insert into notifications (venue_id, reservation_id, channel, destination, template, body)
  values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221',
          'whatsapp','65999991111','reserva_lembrete','Passando pra lembrar...');
  raise exception 'FALHA: mandou o mesmo lembrete duas vezes';
exception when unique_violation then
  raise notice 'ok   segundo lembrete barrado — o cliente não recebe cinco vezes';
end $$;

-- Outra reserva pode ter o seu.
insert into notifications (venue_id, reservation_id, channel, destination, template, body)
values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
        'whatsapp','65988882222','reserva_lembrete','Passando pra lembrar...');
select case when count(*) = 2 then 'ok   cada reserva tem o lembrete dela'
            else 'FALHA ' || count(*) || ' lembretes' end
  from notifications where template = 'reserva_lembrete';

\echo '--- 4. UM AVISO AO GESTOR POR RESERVA ---'
insert into notifications (venue_id, reservation_id, channel, destination, template, body)
values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221',
        'whatsapp','65977773333','reserva_nova_gestor','Entrou reserva nova...');
do $$
begin
  insert into notifications (venue_id, reservation_id, channel, destination, template, body)
  values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221',
          'whatsapp','65977773333','reserva_nova_gestor','Entrou reserva nova...');
  raise exception 'FALHA: avisou o gestor duas vezes da mesma reserva';
exception when unique_violation then
  raise notice 'ok   aviso repetido barrado — dez iguais viram silenciar a casa';
end $$;

\echo '--- 5. AS OUTRAS MENSAGENS PODEM REPETIR ---'
-- Uma reserva pode ser recusada, o cliente insistir, e ser aprovada depois.
insert into notifications (venue_id, reservation_id, channel, destination, template, body)
values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221',
        'whatsapp','65999991111','reserva_recusada','Infelizmente...'),
       ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221',
        'whatsapp','65999991111','reserva_aprovada','Confirmada!');
select case when count(*) = 2 then 'ok   aprovada e recusada convivem na mesma reserva'
            else 'FALHA travou mensagem que deveria poder repetir' end
  from notifications
 where reservation_id = '22222222-2222-2222-2222-222222222221'
   and template in ('reserva_aprovada','reserva_recusada');

\echo '--- 6. O ÍNDICE DA VARREDURA EXISTE ---'
select case when count(*) = 1
            then 'ok   varredura tem índice — ela roda a cada minuto, para sempre'
            else 'FALHA índice da varredura não foi criado' end
  from pg_indexes
 where tablename = 'reservations' and indexname = 'idx_reservas_aprovadas_por_horario';

\echo '--- 7. O CAMPO DO GESTOR ACEITA VAZIO ---'
select case when reservas_avisar_whatsapp is null
            then 'ok   casa que não quer ser avisada fica sem número, e nada quebra'
            else 'FALHA campo veio preenchido' end
  from venues where id = '11111111-1111-1111-1111-111111111111';
