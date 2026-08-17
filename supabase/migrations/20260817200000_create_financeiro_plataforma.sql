-- Controle comercial de cada cliente.
--
-- Não é integração com gateway de pagamento: é o registro do que foi
-- combinado e de como a conta está. Um SaaS com poucos clientes se controla
-- assim por bastante tempo, e ter o campo desde já evita o pior cenário —
-- descobrir quem está inadimplente pelo WhatsApp do dono reclamando que o
-- agente parou.

alter table public.organizations
  add column if not exists status_pagamento text not null default 'ativo',
  add column if not exists mensalidade numeric(10, 2),
  add column if not exists vencimento_dia smallint,
  add column if not exists inicio_contrato date default current_date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_status_pagamento_valido') then
    alter table public.organizations add constraint organizations_status_pagamento_valido
      check (status_pagamento in ('ativo', 'atrasado', 'suspenso', 'cortesia', 'cancelado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_vencimento_valido') then
    alter table public.organizations add constraint organizations_vencimento_valido
      check (vencimento_dia is null or vencimento_dia between 1 and 28);
  end if;
end $$;

comment on column public.organizations.status_pagamento is
  'Situação comercial. Controle manual — não vem de gateway de pagamento.';
comment on column public.organizations.mensalidade is
  'Valor combinado em reais. Pode divergir da tabela: desconto e negociação existem.';
comment on column public.organizations.vencimento_dia is
  'Dia do mês do vencimento (1 a 28).';

notify pgrst, 'reload schema';
