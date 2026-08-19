-- Destino por ITEM da compra.
--
-- Uma nota só raramente é de um lugar só: o engradado de cerveja vai para o
-- bar e a carne da mesma nota vai para a cozinha. Com destino único por
-- compra, ou a pessoa lançava duas compras para a mesma nota (e o valor
-- total deixava de bater com o papel), ou lançava tudo num lugar e
-- transferia depois — e "depois" é a etapa que nunca acontece.
--
-- O destino da linha é OPCIONAL: nulo herda o da compra. O caso comum (tudo
-- para o mesmo lugar) continua sem trabalho extra; a exceção ganha um campo.

alter table public.compra_itens
  add column if not exists local_id uuid references public.estoque_locais(id) on delete restrict;

comment on column public.compra_itens.local_id is
  'Destino DESTA linha. Nulo herda o local da compra — a exceção paga o campo, o caso comum não.';

-- O recebimento passa a respeitar o destino da linha.
create or replace function public.cmv_receber_compra(p_compra_id uuid, p_usuario uuid default null)
returns void
language plpgsql
as $$
declare
  v_compra public.compras%rowtype;
  v_item record;
  v_saldo numeric;
  v_custo_atual numeric;
  v_custo numeric;
begin
  select * into v_compra from public.compras where id = p_compra_id for update;
  if not found then raise exception 'compra_nao_encontrada'; end if;
  if v_compra.status = 'recebida' then raise exception 'compra_ja_recebida'; end if;
  if v_compra.status = 'cancelada' then raise exception 'compra_cancelada'; end if;

  if not exists (select 1 from public.compra_itens
                 where compra_id = p_compra_id and quantidade_recebida is not null) then
    raise exception 'nada_conferido';
  end if;

  for v_item in
    select * from public.compra_itens
     where compra_id = p_compra_id and insumo_id is not null
       and quantidade_recebida is not null and quantidade_recebida > 0
  loop
    v_custo := coalesce(v_item.custo_unitario_recebido, v_item.custo_unitario_pedido, 0);

    insert into public.estoque_movimentos
      (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario, origem_tipo, origem_id, criado_por)
    values
      (v_compra.venue_id, v_item.insumo_id,
       -- A linha manda; a compra é o padrão.
       coalesce(v_item.local_id, v_compra.local_id),
       v_item.quantidade_recebida, 'compra', v_custo, 'compra', p_compra_id, p_usuario);

    select coalesce(sum(quantidade), 0) into v_saldo
      from public.estoque_movimentos where insumo_id = v_item.insumo_id;
    select custo_medio into v_custo_atual from public.insumos where id = v_item.insumo_id;

    update public.insumos
       set custo_medio = case when v_saldo <= 0 then v_custo
             else round((greatest(v_saldo - v_item.quantidade_recebida, 0) * coalesce(v_custo_atual, 0)
                         + v_item.quantidade_recebida * v_custo) / v_saldo, 4) end
     where id = v_item.insumo_id;
  end loop;

  update public.compras
     set status = 'recebida', recebida_em = now(), recebida_por = p_usuario,
         valor_total = coalesce((select sum(quantidade_recebida * coalesce(custo_unitario_recebido, custo_unitario_pedido, 0))
                                   from public.compra_itens
                                  where compra_id = p_compra_id and quantidade_recebida is not null), 0)
   where id = p_compra_id;
end;
$$;

notify pgrst, 'reload schema';
