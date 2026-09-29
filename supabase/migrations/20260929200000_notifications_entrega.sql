-- O que a Meta conta de volta sobre cada aviso: entregue e lido.
--
-- "sent" era a Meta ACEITANDO a mensagem, e a tela chamava isso de
-- "entregue". A Meta contou 3 entregues onde a tela dizia 44 — e ninguém
-- tinha como confrontar. Os disparos já guardavam isso; os avisos
-- (parabéns, convite da pesquisa) não.
alter table public.notifications
  add column if not exists entregue_em timestamptz,
  add column if not exists lido_em timestamptz;

create index if not exists notifications_provider_id on public.notifications (provider_id)
  where provider_id is not null;
