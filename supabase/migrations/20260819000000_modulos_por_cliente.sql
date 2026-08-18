-- Quais módulos cada cliente contratou.
--
-- Até aqui a colmeia mostrava os mesmos favos para todo mundo: um cliente que
-- só comprou o Cardápio Digital via "Agentes de IA" aceso, clicava e entrava.
-- Isso não é só uma tela errada — é cobrar depois por algo que já foi usado, ou
-- entregar de graça o que é vendido.
--
-- `venues.plano` não resolve: ele diz o TAMANHO do contrato (essencial,
-- profissional...), não QUAIS módulos entram. São perguntas diferentes, e um
-- cliente do plano essencial pode ter comprado só o cardápio.
--
-- A linha carrega também o endereço, porque nem todo módulo mora dentro do
-- painel. O Cardápio Digital é um deploy separado, com domínio por cliente —
-- e é este o único lugar onde esse endereço existe.

create table if not exists public.venue_modulos (
  venue_id uuid not null references public.venues(id) on delete cascade,
  -- Combina com o `id` de MODULOS no painel (public/js/app.js). Texto livre de
  -- propósito: módulo novo nasce sem migração, e o painel ignora o que não
  -- conhece.
  modulo text not null,
  ativo boolean not null default true,
  -- Só para módulo que mora fora do painel. Nulo = tela interna.
  url text,
  -- Quando o cliente passou a ter o módulo. Serve para cobrança proporcional.
  contratado_em timestamptz not null default now(),
  primary key (venue_id, modulo)
);

comment on table public.venue_modulos is
  'Módulos do Brasa Food que cada estabelecimento contratou. Linha ausente = não tem.';
comment on column public.venue_modulos.url is
  'Endereço externo do módulo, quando ele não é uma tela do painel (ex.: Cardápio Digital).';

alter table public.venue_modulos enable row level security;
-- Sem policies, como nas demais: o acesso é pelo backend com service_role.

-- Ausência de linha significa "não tem o módulo". Isso é o certo daqui em
-- diante, mas aplicado sozinho apagaria a colmeia de todo cliente que já usa o
-- sistema hoje. Então os que já existem recebem o que já usavam.
insert into public.venue_modulos (venue_id, modulo)
select v.id, m.modulo
from public.venues v
cross join (values ('agentes-ia'), ('checklist'), ('avaliacoes')) as m(modulo)
on conflict (venue_id, modulo) do nothing;
