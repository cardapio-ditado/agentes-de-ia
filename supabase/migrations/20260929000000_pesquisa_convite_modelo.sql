-- O convite da pesquisa pelo número oficial: o modelo aprovado da Meta e o
-- que vai em cada lacuna dele (o link da pesquisa é uma das lacunas). Sem
-- modelo, o convite segue pelo conector, como sempre foi.
alter table public.pesquisa_config add column if not exists convite_modelo text;
alter table public.pesquisa_config add column if not exists convite_modelo_variaveis jsonb not null default '[]'::jsonb;
