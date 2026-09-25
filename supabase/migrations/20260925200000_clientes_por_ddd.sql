-- ============================================================
-- Quantas pessoas a casa tem em cada DDD.
--
-- É o filtro que o dono mais pede: "só quem é daqui" (65, Cuiabá) para a
-- promoção de quinta, "só quem é de fora" para o pacote de temporada.
-- Uma função porque o PostgREST não agrupa, e contar 46 mil telefones no
-- servidor a cada abertura da tela seria pagar a base inteira por um
-- seletor.
-- ============================================================

create or replace function public.clientes_por_ddd(casa uuid)
returns table (ddd text, pessoas bigint)
language sql
stable
as $$
  select substr(telefone, 3, 2) as ddd, count(*) as pessoas
  from public.clientes
  where venue_id = casa
    and telefone like '55%'
    and length(telefone) between 12 and 13
  group by 1
  order by 2 desc, 1;
$$;
