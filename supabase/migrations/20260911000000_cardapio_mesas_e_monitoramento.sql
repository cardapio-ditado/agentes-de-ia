-- Mesas, garçom por mesa e o que o cliente está olhando.
--
-- As três regras do administrativo do cardápio antigo, trazidas para o
-- painel do Brasa. As tabelas já existiam (mesas, turno_mesas, mesa_sessoes,
-- mesa_eventos); aqui cada coluna é garantida uma a uma — o app antigo criou
-- essas tabelas antes da migração multi-cliente, e "create table if not
-- exists" pula a tabela inteira quando ela já existe.
--
-- O chat da mesa NÃO ganha tabela nova: como a migração de agosto já
-- prometia, ele passa a usar o agente do Brasa (conversations/messages), com
-- inbox, "assumir atendimento" e cobrança por pontos. `ai_chat_logs` fica
-- como histórico do app antigo.

-- ============================================================
-- 1. Mesas
-- ============================================================
alter table public.mesas add column if not exists numero integer;
alter table public.mesas add column if not exists ativa boolean not null default true;
alter table public.mesas add column if not exists criada_em timestamptz not null default now();
-- Um nome opcional: "Varanda 3", "Balcão". O número continua sendo a chave.
alter table public.mesas add column if not exists nome text default '';

create unique index if not exists idx_mesas_venue_numero on public.mesas (venue_id, numero);

-- ============================================================
-- 2. Garçom por mesa, por dia
-- ============================================================
alter table public.turno_mesas add column if not exists turno_data date not null default current_date;
alter table public.turno_mesas add column if not exists mesa_numero integer;
alter table public.turno_mesas add column if not exists garcom_nome text not null default '';
alter table public.turno_mesas add column if not exists criado_em timestamptz not null default now();

create unique index if not exists idx_turno_mesas_dia_mesa on public.turno_mesas (venue_id, turno_data, mesa_numero);

-- ============================================================
-- 3. A sessão do cliente na mesa
-- ============================================================
alter table public.mesa_sessoes add column if not exists mesa_numero integer not null default 0;
alter table public.mesa_sessoes add column if not exists sessao_id text;
alter table public.mesa_sessoes add column if not exists cliente_nome text;
alter table public.mesa_sessoes add column if not exists cliente_whatsapp text;
alter table public.mesa_sessoes add column if not exists iniciada_em timestamptz not null default now();
alter table public.mesa_sessoes add column if not exists ultimo_evento_em timestamptz;
alter table public.mesa_sessoes add column if not exists ativa boolean not null default true;
-- O que a pessoa está olhando AGORA: o painel "ao vivo" lê daqui, sem
-- varrer a tabela de eventos a cada atualização.
alter table public.mesa_sessoes add column if not exists ultimo_item text;
alter table public.mesa_sessoes add column if not exists eventos integer not null default 0;

create unique index if not exists idx_mesa_sessoes_token on public.mesa_sessoes (sessao_id);
create index if not exists idx_mesa_sessoes_ativas on public.mesa_sessoes (venue_id, ativa, ultimo_evento_em desc);

-- ============================================================
-- 4. O que aconteceu na mesa
-- ============================================================
alter table public.mesa_eventos add column if not exists mesa_numero int not null default 0;
alter table public.mesa_eventos add column if not exists sessao_id text;
alter table public.mesa_eventos add column if not exists cliente_nome text;
alter table public.mesa_eventos add column if not exists item_nome text;
alter table public.mesa_eventos add column if not exists item_categoria text;
alter table public.mesa_eventos add column if not exists tipo text not null default 'visualizacao';
alter table public.mesa_eventos add column if not exists segundos_visualizado int not null default 0;
alter table public.mesa_eventos add column if not exists criado_em timestamptz not null default now();

comment on column public.mesa_eventos.tipo is
  'visualizacao (abriu a ficha), curtida, busca, pedido (pediu ao garçom), chamou_garcom, chat.';

create index if not exists idx_mesa_eventos_dia on public.mesa_eventos (venue_id, criado_em desc);
create index if not exists idx_mesa_eventos_item on public.mesa_eventos (venue_id, tipo, item_nome);

notify pgrst, 'reload schema';
