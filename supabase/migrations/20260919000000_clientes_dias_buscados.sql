-- O DIA BUSCADO, mesmo quando não veio ninguém.
--
-- A varredura usava o próprio dado como marcador: "dia com visita gravada é
-- dia já buscado". Funciona enquanto todo dia tem movimento, e é exatamente
-- aí que a ideia falha — a segunda-feira em que o bar fechou não grava
-- visita nenhuma, então ela continua parecendo um buraco, e a varredura
-- busca o mesmo dia vazio para sempre.
--
-- Na carga histórica do Ditado isso foi de desperdício a paralisia: o
-- comando ficou refazendo as mesmas dez datas em laço, sem nunca andar para
-- trás, porque nenhuma delas gravava a linha que as tiraria da lista.
--
-- Aqui o marcador passa a ser o ATO de buscar, e não o resultado dele.
-- "Procurei em 12/08 e não havia ninguém" é uma resposta, e agora tem onde
-- ser guardada.

create table if not exists public.clientes_dias_zig (
  venue_id uuid not null references public.venues(id) on delete cascade,

  -- O dia no calendário DA CASA, igual ao de clientes_visitas.
  dia date not null,

  -- Quantos vieram. Zero é informação: significa "buscado, e estava vazio".
  visitantes integer not null default 0,

  buscado_em timestamptz not null default now(),

  primary key (venue_id, dia)
);

alter table public.clientes_dias_zig enable row level security;

comment on table public.clientes_dias_zig is
  'Um registro por dia buscado na Zig, inclusive os dias sem ninguém. É o marcador que impede a varredura de refazer eternamente um dia vazio.';

comment on column public.clientes_dias_zig.visitantes is
  'Quantos visitantes a Zig devolveu. Zero é resposta válida: dia fechado, ou dia sem movimento.';

-- Os dias que JÁ TÊM visita gravada entram como buscados, para a carga não
-- recomeçar do zero por causa desta mudança.
insert into public.clientes_dias_zig (venue_id, dia, visitantes)
select venue_id, dia, count(*)
from public.clientes_visitas
group by venue_id, dia
on conflict (venue_id, dia) do nothing;

notify pgrst, 'reload schema';
