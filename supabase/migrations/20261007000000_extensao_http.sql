-- Extensão "http" (pgsql-http): deixa o banco chamar uma API de dentro de um
-- SELECT. Usada para sondar a API da Zig sem passar pelo servidor.
create extension if not exists http with schema extensions;
