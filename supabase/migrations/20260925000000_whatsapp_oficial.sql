-- ============================================================
-- A conexão oficial do WhatsApp (Cloud API da Meta), POR CASA.
--
-- Até aqui o canal oficial era um só para o sistema inteiro, preso às
-- variáveis de ambiente da Vercel. Uma casa. Para o cliente conectar o
-- número dele, a conexão passa a morar aqui: cada casa com o seu token, o
-- seu telefone, a sua conta — e o agente que responde por ele.
--
-- O webhook da Meta é um só para todos os números do app; ele descobre a
-- casa pelo `phone_number_id` que vem em cada mensagem. Daí o índice único.
-- ============================================================

create table if not exists public.whatsapp_oficial (
  venue_id uuid primary key references public.venues(id) on delete cascade,

  -- Token de acesso da Meta (permanente do usuário do sistema, ou o
  -- estendido de ~60 dias enquanto o permanente não sai).
  token text,

  -- Os dois IDs que a Meta dá, e que não se pode trocar um pelo outro:
  -- o do TELEFONE (WhatsApp Manager > Números > "Identificação do número")
  -- e o da CONTA (Contas do WhatsApp > "Identificação"). O envio usa o do
  -- telefone; a inscrição no app usa o da conta.
  phone_number_id text,
  waba_id text,

  -- Quem responde por este número. Vazio = o número só envia.
  agent_slug text,

  -- O que a Meta disse ao testar: o número formatado e o nome verificado.
  telefone text,
  nome_verificado text,

  -- Quando a conta foi inscrita no app (POST {waba}/subscribed_apps). Sem
  -- isto, a Meta não entrega mensagem nenhuma — foi o que calou o Ditado.
  inscrita_em timestamptz,
  testada_em timestamptz,

  updated_at timestamptz not null default now()
);

create unique index if not exists whatsapp_oficial_phone_number_id
  on public.whatsapp_oficial (phone_number_id)
  where phone_number_id is not null;

alter table public.whatsapp_oficial enable row level security;

comment on table public.whatsapp_oficial is
  'Conexão oficial do WhatsApp (Cloud API da Meta) de cada casa: token, IDs e o agente que atende.';
