-- Cada aviso diz QUAL número deve entregá-lo.
--
-- A casa tem dois números e eles servem a públicos diferentes: o
-- administrativo fala com a EQUIPE (link de checklist, resumo, aviso de
-- ruptura), o do agente fala com o CLIENTE e é atendido por IA.
--
-- Até aqui a fila não sabia disso. Ela era uma só, e a separação acontecia
-- por processo: o conector do agente cedia a fila INTEIRA quando via um
-- administrativo no ar. Isso errava dos dois lados:
--
--   - administrativo fora do ar por 40 segundos (um restart do systemd basta)
--     e o agente assumia tudo — inclusive um lote de convites de pesquisa, que
--     saíam pelo número que responde com IA. O cliente respondia "não gostei
--     do garçom" e era atendido como quem quer fazer reserva;
--   - administrativo no ar e o agente não entregava NADA — nem a confirmação
--     de reserva do cliente que estava conversando com ele, que chegava por um
--     número desconhecido.
--
-- Com o papel gravado no aviso, cada conector entrega o que é dele. Nulo
-- continua valendo "qualquer um entrega", que é como tudo se comportava antes
-- desta coluna existir.

alter table public.notifications
  add column if not exists papel text
  check (papel is null or papel in ('agente', 'administrativo'));

comment on column public.notifications.papel is
  'Qual número entrega: administrativo (fala com a equipe) ou agente (fala com o cliente). Nulo = qualquer um.';

-- A fila é lida a cada 15 segundos por conector; o índice é sobre exatamente
-- o que essa leitura pergunta.
create index if not exists idx_notifications_fila_por_papel
  on public.notifications (venue_id, status, papel, created_at);

notify pgrst, 'reload schema';
