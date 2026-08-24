-- A logo e a cor da casa.
--
-- A pesquisa é a única tela do sistema que o CLIENTE vê. Ele escaneia um QR
-- code na mesa do bar e cai numa página com a logo de outra empresa — e quem
-- não esperava isso acha que caiu num golpe, ou no mínimo que a casa
-- terceirizou a opinião dele para um site qualquer.
--
-- Com a logo do bar e a cor do bar, a pesquisa é do bar. Isso muda a taxa de
-- resposta e muda o que a pessoa escreve: reclamar "com a casa" é diferente de
-- preencher formulário de fornecedor.
--
-- Fica em `venues` e não em `pesquisa_config` de propósito: a logo é da CASA,
-- não do módulo de pesquisa. O cardápio, o checklist e o convite por WhatsApp
-- vão querer a mesma imagem, e cada um guardando a sua produziria três logos
-- diferentes na mesma casa depois da primeira troca de identidade visual.

-- ============================================================
-- 1. Os campos da casa
-- ============================================================

alter table public.venues
  add column if not exists logo_url text;

comment on column public.venues.logo_url is
  'Endereço público da logo da casa. Vazio = a pesquisa usa a marca da Brasa Food.';

alter table public.venues
  add column if not exists cor_marca text;

-- Só hexadecimal de 6 dígitos. A validação existe porque esta string vai
-- DIRETO para o CSS da página pública: qualquer coisa fora do formato ou é
-- ignorada em silêncio pelo navegador (e a página aparece sem cor nenhuma) ou
-- é um jeito de injetar CSS na tela que o cliente vê.
alter table public.venues
  drop constraint if exists venues_cor_marca_hex;
alter table public.venues
  add constraint venues_cor_marca_hex
  check (cor_marca is null or cor_marca ~ '^#[0-9a-f]{6}$');

comment on column public.venues.cor_marca is
  'Cor da casa em hexadecimal (#rrggbb). Vazio = laranja Brasa. O contraste do texto por cima é calculado, não escolhido.';

-- ============================================================
-- 2. Onde a imagem mora
-- ============================================================
--
-- Bucket PÚBLICO, ao contrário do de checklists.
--
-- A logo aparece numa página que qualquer pessoa abre escaneando um QR code na
-- mesa, sem login e sem sessão. URL assinada não serve: ela vence, e uma logo
-- que some depois de uma hora é pior que logo nenhuma. Além disso, não há o
-- que proteger — é a marca que o bar já pendura na fachada.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marcas', 'marcas', true, 2097152,
  array['image/png','image/jpeg','image/webp','image/svg+xml']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/svg+xml'];

-- Leitura liberada para qualquer um: é o que faz a logo aparecer para o
-- cliente na mesa. Escrita, nenhuma política — só o service_role do servidor
-- grava, e é ele que confere de quem é a casa antes.
drop policy if exists "marcas sao publicas para leitura" on storage.objects;
create policy "marcas sao publicas para leitura"
  on storage.objects for select
  using (bucket_id = 'marcas');
