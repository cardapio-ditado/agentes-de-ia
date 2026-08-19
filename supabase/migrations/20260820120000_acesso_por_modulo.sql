-- Quem pode abrir qual módulo.
--
-- Até aqui o papel (`owner`, `admin`, `member`, `viewer`) era tudo ou nada:
-- quem podia escrever, escrevia em tudo. Isso funcionava enquanto o Brasa
-- Food era um módulo só e quem entrava era o dono.
--
-- O módulo CMV quebra essa premissa. Quem confere mercadoria na doca precisa
-- de conta — mas com papel `member` ele aprovaria reservas, leria o
-- financeiro e mexeria na personalidade do agente. A alternativa preguiçosa
-- (dar `viewer` e deixar o gerente lançar tudo depois) devolve o problema
-- para o gerente e faz o lançamento acontecer de memória, no fim da noite,
-- que é exatamente como o estoque começa a mentir.
--
-- São DUAS perguntas diferentes, e o sistema só respondia uma:
--
--   papel   O QUE a pessoa pode fazer (ler, escrever, administrar)
--   módulos ONDE ela pode fazer
--
-- Ortogonais de propósito: um conferente é `member` (escreve) restrito a
-- `{cmv}`; um contador é `viewer` (só lê) restrito a `{cmv}`; o dono é
-- `owner` sem restrição.

alter table public.org_members
  add column if not exists modulos text[];

comment on column public.org_members.modulos is
  'Módulos que esta pessoa pode abrir. NULO = todos os que o estabelecimento contratou — é o padrão, e mantém quem já usa o sistema sem mudança nenhuma. Lista vazia = nenhum, que é uma conta desligada sem apagar o histórico.';

-- Nulo e não um array com tudo dentro: assim, quando o cliente contratar um
-- módulo novo, quem tinha acesso amplo ganha o módulo junto. Uma lista fixa
-- teria que ser atualizada em cada membro, e o esquecimento apareceria como
-- "o dono não vê o módulo que acabou de comprar".

/**
 * Esta pessoa pode abrir este módulo?
 *
 * Duas condições, e as duas precisam valer: o ESTABELECIMENTO contratou o
 * módulo, e a PESSOA tem acesso a ele. Confundir as duas deixaria um
 * conferente entrando num módulo que a casa não assina.
 */
create or replace function public.pode_abrir_modulo(
  p_user_id uuid,
  p_venue_id uuid,
  p_modulo text
)
returns boolean
language sql
stable
as $$
  select
    -- o estabelecimento contratou?
    exists (
      select 1 from public.venue_modulos vm
      where vm.venue_id = p_venue_id and vm.modulo = p_modulo and vm.ativo
    )
    -- e a pessoa tem acesso?
    and exists (
      select 1
      from public.org_members m
      join public.venues v on v.org_id = m.org_id
      where m.user_id = p_user_id
        and v.id = p_venue_id
        and (m.modulos is null or p_modulo = any(m.modulos))
    );
$$;

notify pgrst, 'reload schema';
