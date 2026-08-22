-- Duas coisas que a reserva ainda não fazia: lembrar o cliente antes da hora,
-- e avisar quem analisa que entrou uma reserva nova.
--
-- O LEMBRETE existe por causa do no-show. Quem reservou na terça para o
-- sábado esquece, e a mesa fica vazia numa noite de casa cheia — prejuízo que
-- não aparece em relatório nenhum, porque a mesa vazia não gera registro. Uma
-- mensagem uma hora antes recupera parte disso, e ainda dá ao cliente a chance
-- de avisar que não vem, o que libera a mesa.
--
-- O AVISO AO GESTOR existe porque a fila de aprovação só é vista por quem
-- abre o painel. Reserva que entra às 23h de sexta fica esperando até alguém
-- lembrar de olhar — e o cliente esperando resposta.
--
-- As duas regras que precisam ser do banco, e não da aplicação:
--
-- 1. UM LEMBRETE POR RESERVA. A varredura roda a cada minuto; sem trava, uma
--    demora na gravação faria a volta seguinte mandar de novo, e o cliente
--    receberia a mesma mensagem cinco vezes.
-- 2. UM AVISO POR RESERVA. Mesmo motivo, com o agravante de que o gestor é
--    sempre o mesmo número: dez avisos repetidos viram silenciar a casa.

-- ============================================================
-- 1. Os ajustes da casa
-- ============================================================

alter table public.venues
  add column if not exists reservas_avisar_whatsapp text;

comment on column public.venues.reservas_avisar_whatsapp is
  'WhatsApp de quem analisa as reservas. Recebe um aviso quando o agente registra uma reserva nova. Vazio = ninguém é avisado.';

alter table public.venues
  add column if not exists reserva_lembrete_minutos int not null default 60;

-- Zero desliga. O teto de 1440 (um dia) não é capricho: lembrete mandado com
-- dois dias de antecedência não é lembrete, é outra conversa — e a varredura
-- teria de olhar uma janela grande o bastante para pesar.
alter table public.venues
  drop constraint if exists venues_lembrete_faixa;
alter table public.venues
  add constraint venues_lembrete_faixa
  check (reserva_lembrete_minutos between 0 and 1440);

comment on column public.venues.reserva_lembrete_minutos is
  'Quantos minutos antes da reserva o cliente recebe o lembrete. 0 desliga.';

-- ============================================================
-- 2. Uma mensagem por reserva, por tipo
-- ============================================================
--
-- Índice parcial e não constraint: só vale para estes dois templates. As
-- outras mensagens (aprovada, recusada) podem repetir de propósito — uma
-- reserva pode ser recusada, reaberta e aprovada.

create unique index if not exists idx_um_lembrete_por_reserva
  on public.notifications (reservation_id)
  where template = 'reserva_lembrete';

create unique index if not exists idx_um_aviso_de_reserva_por_gestor
  on public.notifications (reservation_id)
  where template = 'reserva_nova_gestor';

-- ============================================================
-- 3. A varredura precisa ser barata
-- ============================================================
--
-- Roda a cada minuto, para sempre. Sem índice, cada volta é uma varredura na
-- tabela inteira de reservas — que cresce todo dia e nunca encolhe.

create index if not exists idx_reservas_aprovadas_por_horario
  on public.reservations (venue_id, reserved_for)
  where status = 'approved';
