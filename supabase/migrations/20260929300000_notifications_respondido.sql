-- Quando a pessoa RESPONDEU ao aviso (parabéns, convite da pesquisa).
--
-- "Entregue" e "lida" vêm da Meta; "respondeu" vem da própria conversa: a
-- mensagem seguinte da pessoa, dentro da janela de resposta ao aviso. É o
-- último degrau do quadro de envios — e o que interessa de verdade para a
-- casa, porque é o que vira reserva.
alter table notifications add column if not exists respondido_em timestamptz;

comment on column notifications.respondido_em is
  'Primeira mensagem da pessoa depois do aviso, dentro da janela de resposta. Só o primeiro carimbo vale.';
