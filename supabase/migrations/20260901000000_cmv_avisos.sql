-- O CMV ganha voz.
--
-- O módulo já SABE as três coisas que mais custam dinheiro num bar: o
-- fornecedor que subiu o preço, o estoque que divergiu na contagem, e o
-- insumo que vai faltar no sábado. Mas só conta para quem abre o painel — e
-- dono de bar não abre tela de estoque na terça de manhã; lê WhatsApp.
--
-- É a mesma lição do aviso de nota baixa na pesquisa: o painel só fala com
-- quem abre o painel. A infraestrutura de entrega já existe (a fila de
-- notificações e o conector); aqui entram a configuração e as travas.

-- ============================================================
-- 1. A configuração da casa
-- ============================================================

create table if not exists public.cmv_config (
  venue_id uuid primary key references public.venues(id) on delete cascade,

  -- Quem recebe. Vazio = módulo mudo, como sempre foi. Desligado até alguém
  -- preencher: aviso é mensagem no celular de uma pessoa.
  avisar_whatsapp text,

  -- Aumento de preço que merece aviso, em %. Abaixo disso é flutuação de
  -- mercado; avisar de tudo ensina o dono a ignorar o aviso.
  aumento_preco_pct numeric(5,2) not null default 10 check (aumento_preco_pct between 1 and 100),

  -- Divergência de contagem que merece aviso, em reais. O valor é da CONTAGEM
  -- inteira, não do item: dez itens com R$ 15 de diferença cada são R$ 150
  -- sumidos, e item a item nenhum passaria do corte.
  divergencia_reais numeric(12,2) not null default 100 check (divergencia_reais >= 0),

  -- O aviso de "vai faltar" liga junto com o número; este desliga só ele,
  -- porque é o mais falador dos três.
  avisar_estoque boolean not null default true,

  -- Lembrete de contagem: a cada quantos dias a casa deveria contar. Zero
  -- desliga. O CMV só é honesto com contagem em cadência, e cadência que
  -- depende de memória morre na terceira semana — a mesma razão de existir o
  -- agendamento de checklist.
  lembrete_contagem_dias int not null default 0 check (lembrete_contagem_dias between 0 and 90),

  updated_at timestamptz not null default now()
);

alter table public.cmv_config enable row level security;

comment on table public.cmv_config is
  'Avisos do CMV por WhatsApp: quem recebe e a partir de quanto cada coisa vira mensagem.';

-- ============================================================
-- 2. Um aviso por evento
-- ============================================================
--
-- `cmv_origem_id` é o evento que originou o aviso: o id da compra (preço),
-- o id da contagem (divergência) ou um id determinístico do dia (estoque).
-- Sem FK de propósito: as origens são de tabelas diferentes, e o aviso não
-- pode impedir a limpeza delas.

alter table public.notifications
  add column if not exists cmv_origem_id uuid;

comment on column public.notifications.cmv_origem_id is
  'O evento do CMV que originou este aviso: compra, contagem, ou o dia (para o aviso de estoque).';

-- A varredura pode repetir e a rota pode ser chamada duas vezes; o dono não
-- pode receber o mesmo aviso duas vezes. A trava é do banco, não da memória
-- de um processo que reinicia.
create unique index if not exists idx_um_aviso_de_preco_por_compra
  on public.notifications (cmv_origem_id)
  where template = 'cmv_preco_subiu';

create unique index if not exists idx_um_aviso_de_divergencia_por_contagem
  on public.notifications (cmv_origem_id)
  where template = 'cmv_divergencia';

create unique index if not exists idx_um_aviso_de_estoque_por_dia
  on public.notifications (cmv_origem_id)
  where template = 'cmv_estoque_baixo';

create unique index if not exists idx_um_lembrete_de_contagem_por_dia
  on public.notifications (cmv_origem_id)
  where template = 'cmv_lembrete_contagem';
