-- Avaliações do Google pela API oficial, via Make.
--
-- O Make tem o acesso à API do Perfil da Empresa já aprovado pelo Google:
-- o dono só faz login com a conta que gerencia o perfil. O cenário do Make
-- carrega e descarrega; quem escreve a resposta continua sendo o Brasa Food.
--
-- webhook_segredo  — o que o Make manda no cabeçalho para provar que é ele.
-- make_webhook_url — o webhook do Make que publica uma resposta aprovada
--                    no painel (o Make só sabe publicar o que ele dispara).
-- local_nome       — "accounts/*/locations/*", como a API nomeia o perfil.
alter table public.google_perfis
  add column if not exists webhook_segredo text,
  add column if not exists make_webhook_url text,
  add column if not exists local_nome text;
