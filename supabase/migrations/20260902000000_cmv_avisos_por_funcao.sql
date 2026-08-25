-- Dois números, duas funções — e o conserto da coluna que faltou.
--
-- "Quem recebe informações do estoque" e "quem faz a contagem" são pessoas
-- diferentes na mesma casa. O lembrete de contar vai para quem conta; preço,
-- divergência e "vai faltar" vão para quem gerencia. A divergência fica com o
-- gestor DE PROPÓSITO: contagem que audita a si mesma não audita nada.
--
-- Os `add column if not exists` abaixo também consertam bancos que criaram a
-- `cmv_config` numa versão anterior desta série de migrações (o `create table
-- if not exists` da 20260901 não acrescenta coluna em tabela que já existe —
-- foi exatamente assim que `lembrete_contagem_dias` ficou faltando em
-- produção e o salvar passou a falhar).

alter table public.cmv_config
  add column if not exists lembrete_contagem_dias int not null default 0;

alter table public.cmv_config
  drop constraint if exists cmv_config_lembrete_faixa;
alter table public.cmv_config
  add constraint cmv_config_lembrete_faixa
  check (lembrete_contagem_dias between 0 and 90);

alter table public.cmv_config
  add column if not exists contagem_whatsapp text;

comment on column public.cmv_config.contagem_whatsapp is
  'WhatsApp de quem faz a contagem: recebe o lembrete de contar. Vazio = o lembrete vai para avisar_whatsapp.';

-- O PostgREST guarda o esquema em cache; sem isto, a coluna nova continua
-- "inexistente" para a API até o cache renovar sozinho — que é a diferença
-- entre "rodei o SQL e funcionou" e "rodei e continuou dando erro".
notify pgrst, 'reload schema';
