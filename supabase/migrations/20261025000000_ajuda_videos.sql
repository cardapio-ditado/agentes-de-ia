-- Ajuda do mentor: o link do vídeo de cada tela do painel.
--
-- Um vídeo por tela, igual para todas as casas: é o mentor explicando a
-- tela uma vez, e o mentorado revendo quando quiser depois do desmame.
-- A equipe Brasa Food cadastra pelo próprio botão "?" do painel.
create table if not exists public.ajuda_videos (
  pagina text primary key,
  url text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

-- Só o servidor (chave de serviço) lê e escreve; nenhum acesso direto.
alter table public.ajuda_videos enable row level security;

notify pgrst, 'reload schema';
