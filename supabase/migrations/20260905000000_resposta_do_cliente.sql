-- A resposta da pesquisa aponta para QUEM respondeu.
--
-- Os dois lados já existiam e não se falavam: a resposta guardava o contato
-- como a pessoa digitou ("(65) 99999-0000", "65999990000", "+55 65 9 9999
-- 0000"), e a base de clientes guarda normalizado. Eram a mesma pessoa em
-- dois lugares, e abrir a ficha da Maria não mostrava que ela deu nota 4 e
-- escreveu "demorou 40 minutos".
--
-- Ligar por telefone a cada consulta seria normalizar texto livre dentro de
-- um LIKE — lento e errado nas bordas. O vínculo é gravado uma vez, no
-- momento em que a resposta entra, e depois é só um id.
--
-- Nulo é normal e não é defeito: resposta de QR code na mesa não pede
-- contato, e ninguém deve ser obrigado a se identificar para reclamar.

alter table public.pesquisa_respostas
  add column if not exists cliente_id uuid;

comment on column public.pesquisa_respostas.cliente_id is
  'Quem respondeu, quando deixou contato. Nulo em resposta anônima — o QR da mesa não pede identificação.';

-- "O que este cliente já achou da casa?" é a pergunta da ficha dele, e sem
-- índice ela varre todas as respostas da casa a cada abertura de ficha.
create index if not exists idx_respostas_por_cliente
  on public.pesquisa_respostas (cliente_id, created_at desc)
  where cliente_id is not null;

notify pgrst, 'reload schema';
