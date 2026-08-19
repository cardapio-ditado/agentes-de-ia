-- Snapshot diário do valor do estoque.
--
-- O CMV do período precisa do estoque inicial, e esse número não existe
-- retroativamente: ou foi fotografado no dia, ou está perdido. A foto é
-- tirada quando o painel abre — idempotente por dia, então abrir dez vezes
-- não cria dez fotos, e um dia sem ninguém abrir o painel usa a foto mais
-- recente anterior (a função do período já procura a última antes da data).

create or replace function public.cmv_registrar_snapshot(p_venue_id uuid)
returns void
language plpgsql
as $$
begin
  insert into public.estoque_snapshots (venue_id, data_referencia, valor_total)
  values (p_venue_id, current_date, public.cmv_valor_do_estoque(p_venue_id))
  on conflict (venue_id, data_referencia) do update
    set valor_total = excluded.valor_total,
        criado_em = now();
end;
$$;

notify pgrst, 'reload schema';
