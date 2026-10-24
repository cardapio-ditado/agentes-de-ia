-- RH — metas semanais na comissão.
--
-- "Vendeu acima de tanto, ganha mais 1%." A meta é da SEMANA (segunda a
-- domingo, a mesma semana do acerto da gorjeta), e não do dia: um sábado
-- bom não pode valer mais que a semana inteira.
--
-- Faixas em lista: [{"a_partir_de": 10000, "bonus": 1}, ...]. Vale a maior
-- faixa atingida; as faixas não se somam. O bônus sai do caixa da casa, não
-- do serviço — a gorjeta da equipe não diminui para pagar a meta de um.
alter table public.rh_gorjeta_regras
  add column if not exists metas jsonb not null default '[]'::jsonb;

-- Sobre o que o bônus incide: a venda inteira da semana, ou só o que passou
-- da faixa atingida.
alter table public.rh_gorjeta_regras
  add column if not exists meta_sobre text not null default 'tudo';

do $$
begin
  alter table public.rh_gorjeta_regras add constraint rh_gorjeta_regras_meta_sobre
    check (meta_sobre in ('tudo', 'excedente'));
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
