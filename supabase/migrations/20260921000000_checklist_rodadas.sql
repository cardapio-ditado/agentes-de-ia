-- RODADAS: o mesmo checklist, várias vezes na mesma noite.
--
-- O checklist comum é "um turno, um preenchimento". O de banheiro são as
-- mesmas seis perguntas doze vezes por noite — e encaixar isso no modelo
-- comum dava duas saídas ruins: doze checklists iguais no cadastro, ou doze
-- execuções por dia entupindo o histórico e mandando doze resumos.
--
-- Continua UMA execução por dia (o índice único por checklist e dia fica
-- como está). O que muda é que ela pode carregar, dentro de si, as rodadas:
-- cada uma com a hora prevista, a hora em que foi feita, quem fez, as
-- respostas e se a cutucada de atraso já saiu.
--
-- Lista vazia = checklist comum, exatamente como antes. Nada do que existe
-- muda de comportamento.

alter table public.checklist_runs
  add column if not exists rodadas jsonb not null default '[]'::jsonb;

comment on column public.checklist_runs.rodadas is
  'As rodadas da noite, quando o checklist se repete a cada N minutos. Vazio = checklist comum, uma vez por dia.';

notify pgrst, 'reload schema';
