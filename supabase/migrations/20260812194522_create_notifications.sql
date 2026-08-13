-- Fila de notificações ao cliente (confirmação/recusa de reserva).
-- Persistida antes do envio: se o provedor cair, a mensagem não se perde e
-- pode ser reenviada.

create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references public.venues(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  channel        text not null default 'whatsapp'
                 check (channel in ('whatsapp','email','sms','console')),
  destination    text not null,
  template       text not null,
  body           text not null,
  status         text not null default 'pending'
                 check (status in ('pending','sent','failed','skipped')),
  attempts       integer not null default 0,
  error          text,
  provider_id    text,
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.notifications is 'Mensagens enviadas ao cliente. Gravadas antes do envio para permitir reenvio.';
comment on column public.notifications.destination is 'Telefone ou e-mail de destino, como informado pelo cliente.';
comment on column public.notifications.template is 'Qual mensagem foi usada: reserva_aprovada, reserva_recusada.';
comment on column public.notifications.provider_id is 'Id da mensagem no provedor (WhatsApp, e-mail), para rastrear entrega.';

-- Fila do worker de reenvio: pendentes e falhas com poucas tentativas.
create index notifications_fila_idx
  on public.notifications (created_at)
  where status in ('pending','failed');

create index notifications_reserva_idx
  on public.notifications (reservation_id)
  where reservation_id is not null;

create trigger notifications_set_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;
