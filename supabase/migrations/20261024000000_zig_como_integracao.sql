-- A Zig é uma integração que a casa LIGA, e não uma premissa do sistema.
--
-- A conexão (token e loja) mora em pesquisa_zig desde a pesquisa, mas serve a
-- vários usos. Cada uso ganha a sua chave, para a casa escolher:
--
-- casa_ao_vivo      — os clientes na planta "A casa agora". Só leitura; ligado
--                     por padrão quando a Zig está conectada.
-- vendas_no_estoque — a noite de ontem entra sozinha em Vendas e, se tudo
--                     casar, baixa o estoque. Mexe em saldo: DESLIGADO por
--                     padrão; a casa liga quando o cadastro de fichas estiver
--                     pronto.
--
-- O convite da pesquisa continua sendo a coluna `ativo`, como sempre foi.
alter table public.pesquisa_zig
  add column if not exists casa_ao_vivo boolean not null default true,
  add column if not exists vendas_no_estoque boolean not null default false;

notify pgrst, 'reload schema';
