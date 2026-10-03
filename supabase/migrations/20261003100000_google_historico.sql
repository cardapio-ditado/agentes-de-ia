-- O histórico inteiro do Google no painel, igual ao Google.
--
-- Até aqui só entrava avaliação nova (o Make vigia a partir da ligação).
-- Agora o Make também traz o histórico completo, página a página, e cada
-- avaliação antiga entra como está no Google: respondida (com o texto que
-- está lá) ou sem resposta.
--
-- 'sem_resposta' é diferente de 'descartada': ninguém decidiu nada — ela só
-- está lá, sem resposta, e o dono pode mandar a IA redigir quando quiser.
alter table public.google_avaliacoes
  drop constraint if exists google_avaliacoes_resposta_status_check;
alter table public.google_avaliacoes
  add constraint google_avaliacoes_resposta_status_check
  check (resposta_status in (
    'pendente', 'rascunho', 'aprovada', 'publicada', 'descartada', 'erro',
    'sem_resposta'
  ));

-- O que o Google mostra no topo do perfil, para o painel mostrar igual.
alter table public.google_perfis
  add column if not exists nota_media numeric(3,2),
  add column if not exists total_avaliacoes integer,
  add column if not exists importado_em timestamptz;

notify pgrst, 'reload schema';
