-- Pontos avulsos e a trava do plano.
--
-- `pontos_extras` soma ao ciclo corrente: é o "coloca mais mil" que a Brasa
-- Food faz quando o cliente pede — e zera quando o ciclo vira (a Brasa
-- decide se repõe). `plano_travar` desligado é a casa em teste ou em
-- cortesia negociada: o consumo continua contado, mas o agente nunca cala.
alter table public.venues
  add column if not exists pontos_extras integer not null default 0,
  add column if not exists plano_travar boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'venues_pontos_extras_positivos') then
    alter table public.venues add constraint venues_pontos_extras_positivos
      check (pontos_extras >= 0);
  end if;
end $$;

comment on column public.venues.pontos_extras is
  'Pontos avulsos somados ao ciclo corrente. 1 ponto = 1 resposta no Haiku.';
comment on column public.venues.plano_travar is
  'false = o agente não cala quando os pontos acabam (casa em teste ou cortesia).';
