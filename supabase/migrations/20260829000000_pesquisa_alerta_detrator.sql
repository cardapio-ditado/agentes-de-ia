-- Nota ruim tem que doer na hora, não no fim do mês.
--
-- A pesquisa já calcula o NPS e mostra os detratores no painel. O problema é
-- que o painel só fala com quem abre o painel. O cliente que deu 3 e escreveu
-- "esperei 40 minutos" vai embora achando que ninguém leu — e ele tem razão,
-- porque ninguém leu: o dono só vai ver aquilo na segunda, quando o cliente já
-- contou para os amigos e não volta mais.
--
-- Uma nota ruim é a única reclamação que chega ANTES do estrago. Quem recebe
-- na hora ainda consegue ligar no mesmo dia, pedir desculpa e recuperar o
-- cliente. Depois de 48 horas isso não é mais recuperação, é constrangimento.
--
-- Duas regras que precisam ser do banco:
--
-- 1. UM AVISO POR RESPOSTA. Sem trava, uma falha de rede no meio da gravação
--    faria a segunda tentativa avisar de novo — e o dono receberia a mesma
--    nota 3 três vezes, o que é a forma mais rápida de fazer ele silenciar a
--    conversa e nunca mais ver aviso nenhum.
-- 2. A FAIXA DA NOTA. O limite é configurável porque cada casa tem um padrão,
--    mas fora de 0 a 10 não é limite, é engano de digitação.

-- ============================================================
-- 1. Para onde vai o aviso
-- ============================================================

alter table public.pesquisa_config
  add column if not exists detrator_avisar_whatsapp text;

comment on column public.pesquisa_config.detrator_avisar_whatsapp is
  'WhatsApp que recebe aviso na hora quando entra uma nota baixa. Vazio = ninguém é avisado.';

-- 6 é a régua do NPS: 0 a 6 é detrator, e usar a régua do mercado é o que
-- permite a casa comparar o número dela com o de qualquer outra.
alter table public.pesquisa_config
  add column if not exists detrator_nota_maxima int not null default 6;

alter table public.pesquisa_config
  drop constraint if exists pesquisa_config_detrator_faixa;
alter table public.pesquisa_config
  add constraint pesquisa_config_detrator_faixa
  check (detrator_nota_maxima between 0 and 10);

comment on column public.pesquisa_config.detrator_nota_maxima is
  'Nota até a qual a resposta dispara aviso. 6 é a régua do NPS (0-6 = detrator).';

-- ============================================================
-- 2. Um aviso por resposta
-- ============================================================
--
-- A notificação já sabe apontar para uma reserva; agora sabe apontar para uma
-- resposta de pesquisa. `on delete cascade` porque um aviso órfão de resposta
-- não serve para nada — sem a resposta não há o que reler.

alter table public.notifications
  add column if not exists pesquisa_resposta_id uuid
    references public.pesquisa_respostas(id) on delete cascade;

comment on column public.notifications.pesquisa_resposta_id is
  'A resposta de pesquisa que originou este aviso, quando houver.';

create unique index if not exists idx_um_alerta_por_resposta
  on public.notifications (pesquisa_resposta_id)
  where template = 'pesquisa_detrator';

-- A fila do conector busca por status; o aviso de detrator entra nela como
-- qualquer outra mensagem e não precisa de índice próprio.
