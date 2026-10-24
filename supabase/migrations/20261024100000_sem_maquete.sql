-- A maquete ("A casa agora") saiu do produto: o MVP da consultoria não
-- precisa dela. Sai a tabela do retrato ao vivo e a chave que ligava os
-- clientes na planta. A conexão da Zig e o uso "vendas no estoque" ficam.
drop table if exists public.casa_ao_vivo;
alter table public.pesquisa_zig drop column if exists casa_ao_vivo;

notify pgrst, 'reload schema';
