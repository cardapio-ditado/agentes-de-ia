-- Módulo de Avaliações do Google.
--
-- Desenho deliberadamente independente de COMO as avaliações chegam. Hoje
-- entram por navegação na interface (ponte provisória, com uma conta gerente
-- que o dono autoriza no próprio perfil); amanhã, aprovado o pedido de acesso,
-- entram pela API oficial. As duas escrevem nas mesmas tabelas — trocar o
-- motor não deve custar a fila de aprovação, o tom de voz nem o histórico.
--
-- RLS ligado sem policies, como nas demais tabelas: acesso só pelo backend.

create table google_perfis (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  -- Conta Google que o dono adicionou como Gerente do perfil dele. NUNCA a
  -- conta pessoal do dono: é o que separa "acesso ao perfil" de "acesso à
  -- vida digital inteira do cliente", e o que ele revoga em dois cliques.
  conta_gerente text not null,
  -- Identificador do local no Google. Na ponte é a URL do perfil; na API
  -- oficial é o resource name ("accounts/{id}/locations/{id}").
  local_id text,
  status text not null default 'pendente'
    check (status in ('pendente', 'conectado', 'sessao_expirada', 'erro')),
  -- Última mensagem de erro, para o painel dizer o que houve em vez de só
  -- mostrar um status vermelho.
  ultimo_erro text,
  ultima_sincronizacao timestamptz,
  -- {nota_automatica: 4, assinatura: "Equipe Ditado Popular", tom: "..."}
  configuracao jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table google_perfis is
  'Ligação de um estabelecimento ao Perfil da Empresa no Google, via conta gerente.';

-- Um perfil por estabelecimento: duas ligações para a mesma casa significaria
-- duas respostas na mesma avaliação.
create unique index google_perfis_venue on google_perfis (venue_id);

create table google_avaliacoes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  -- Id da avaliação no Google. É o que impede a mesma avaliação de virar duas
  -- respostas quando a sincronização roda de novo.
  avaliacao_id text not null,
  autor text,
  nota smallint not null check (nota between 1 and 5),
  comentario text,
  -- Quando a pessoa avaliou (no Google), não quando nós vimos.
  avaliada_em timestamptz,

  -- ---- Resposta ----
  resposta text,
  resposta_status text not null default 'pendente'
    check (resposta_status in (
      'pendente',      -- ainda não geramos nada
      'rascunho',      -- gerada, esperando aprovação humana
      'aprovada',      -- liberada, ainda não publicada
      'publicada',
      'descartada',    -- humano decidiu não responder
      'erro'
    )),
  -- Como a resposta foi liberada: 'automatica' ou 'humana'. Guardado por
  -- avaliação, e não deduzido da nota, porque a política pode mudar e o
  -- histórico precisa continuar dizendo a verdade sobre o que aconteceu.
  liberacao text check (liberacao in ('automatica', 'humana')),
  aprovada_por uuid references auth.users(id),
  publicada_em timestamptz,
  modelo text,
  ultimo_erro text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table google_avaliacoes is
  'Avaliações do Google e as respostas do agente, com fila de aprovação.';

create unique index google_avaliacoes_unica on google_avaliacoes (venue_id, avaliacao_id);
-- A fila de aprovação: nota baixa primeiro, mais antiga primeiro. É a ordem em
-- que alguém realmente quer resolver — avaliação ruim parada é a que dói.
create index google_avaliacoes_fila on google_avaliacoes (venue_id, resposta_status, nota, avaliada_em);

alter table google_perfis enable row level security;
alter table google_avaliacoes enable row level security;

notify pgrst, 'reload schema';
