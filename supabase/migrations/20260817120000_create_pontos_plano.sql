-- Plano e pontos por estabelecimento.
--
-- O consumo NÃO é gravado aqui: ele já vive em `messages` (modelo + tokens de
-- cada resposta). Duplicar isso num contador seria criar duas verdades que
-- divergem no primeiro erro de rede. O saldo é sempre calculado a partir das
-- mensagens reais, o que também faz o medidor funcionar retroativamente, com
-- o histórico que já existe.

alter table public.venues
  add column if not exists plano text not null default 'profissional',
  add column if not exists pontos_mensais integer not null default 2500,
  -- Dia do mês em que o ciclo vira. Limitado a 28 de propósito: assinatura
  -- feita em 31 de janeiro não pode sumir em fevereiro.
  add column if not exists ciclo_dia smallint not null default 1;

alter table public.venues
  add constraint venues_plano_valido
    check (plano in ('essencial', 'profissional', 'casa_cheia', 'cortesia')),
  add constraint venues_pontos_positivos
    check (pontos_mensais >= 0),
  add constraint venues_ciclo_dia_valido
    check (ciclo_dia between 1 and 28);

comment on column public.venues.plano is
  'Plano comercial. Define quais motores de IA o cliente pode escolher.';
comment on column public.venues.pontos_mensais is
  'Pontos do ciclo. 1 ponto = 1 resposta no Haiku; Sonnet pesa 3, Opus pesa 5.';
comment on column public.venues.ciclo_dia is
  'Dia do mês em que o saldo renova (1 a 28).';

-- O medidor soma mensagens do agente por venue e por modelo dentro do ciclo.
-- Sem este índice isso vira varredura completa da tabela mais quente do banco.
create index if not exists messages_conversa_papel_data_idx
  on public.messages (conversation_id, role, created_at desc)
  where role = 'assistant';

notify pgrst, 'reload schema';
