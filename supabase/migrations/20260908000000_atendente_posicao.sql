-- Onde a pergunta "quem te atendeu?" entra na pesquisa.
--
-- 'fim' é como sempre foi. 'apos_nps' põe a pergunta logo depois da nota de
-- recomendação: o nome do garçom é mais fresco no começo — quem responde três
-- telas de nota e só então é perguntado "quem te atendeu?" já está com o dedo
-- no "pular".
alter table public.pesquisa_config
  add column if not exists atendente_posicao text not null default 'fim'
  check (atendente_posicao in ('fim', 'apos_nps'));
