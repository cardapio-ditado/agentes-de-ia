-- Comentário que não é pergunta (elogio, "🔥", "saudade") ganha uma resposta
-- curta e pública da casa. A API da Meta não deixa curtir comentário; a
-- resposta curta é o "curtir" que existe. Desligável por casa.
alter table public.instagram_oficial
  add column if not exists comentarios_agradecer boolean not null default true;
