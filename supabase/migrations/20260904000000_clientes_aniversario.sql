-- A base de clientes da casa, e o aniversário que faz ele voltar.
--
-- Até aqui o cliente existia espalhado: um telefone na resposta da pesquisa,
-- um nome na conversa do agente, um CPF na Zig, um nome numa reserva. Cada
-- pedaço servia à tela que o gerou e a nenhuma outra — e "quem são meus
-- clientes?" não tinha onde ser respondida.
--
-- Uma linha por PESSOA, por casa. A chave é o telefone: é o único dado que
-- todas as fontes têm, é o que o WhatsApp entende, e é por ele que a pessoa
-- é reconhecida quando volta.
--
-- Nada aqui depende do módulo de pesquisa nem do agente: uma casa que só
-- comprou o CMV pode cadastrar clientes na mão e mandar parabéns. A base é
-- da CASA, não de um módulo.

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,

  -- Só dígitos, com o 55 na frente. Guardado normalizado porque é isto que
  -- faz "(65) 99999-0000" e "5565999990000" serem a mesma pessoa — sem isso
  -- a mesma cliente vira três linhas e recebe três parabéns.
  telefone text not null,

  nome text,

  -- Data de nascimento. O ANO é opcional na prática: muita casa cadastra só
  -- dia e mês, e o parabéns só precisa desses dois. Guardado como date com
  -- ano fictício quando o ano é desconhecido seria mentira em relatório —
  -- então ficam separados, e quem tem o ano completo preenche os três.
  nascimento_dia smallint check (nascimento_dia between 1 and 31),
  nascimento_mes smallint check (nascimento_mes between 1 and 12),
  nascimento_ano smallint check (nascimento_ano between 1900 and 2100),

  email text,
  documento text,
  observacoes text,

  -- De onde este cliente veio, acumulado: {manual, zig, agente, pesquisa,
  -- planilha}. Array e não coluna única porque as fontes se somam — quem
  -- veio da Zig e depois conversou com o agente é o MESMO cliente, e saber
  -- que ele apareceu nas duas pontas vale mais que escolher uma.
  origens text[] not null default '{}',

  -- O que a casa sabe do movimento dele. Alimentado pela Zig; nulo em quem
  -- foi cadastrado à mão.
  visitas int not null default 0,
  gasto_total_centavos bigint not null default 0,
  ultima_visita date,

  -- Quem pediu para não receber mensagem. Vazio = pode receber.
  --
  -- Existe por dois motivos, e os dois importam: a LGPD dá à pessoa o
  -- direito de sair, e a lista que insiste com quem não quer é a lista que
  -- vira denúncia e derruba o número da casa.
  descadastrado_em timestamptz,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Uma pessoa, uma linha, por casa. É esta trava que faz a Zig, o agente e
  -- o cadastro manual convergirem em vez de multiplicarem.
  unique (venue_id, telefone)
);

alter table public.clientes enable row level security;

comment on table public.clientes is
  'Uma linha por pessoa, por casa. Telefone é a chave: é o que todas as fontes têm e o que o WhatsApp entende.';

-- Buscar por nome é o que o gerente faz na tela; sem índice isso varre a
-- tabela inteira a cada tecla digitada.
create index if not exists idx_clientes_casa_nome
  on public.clientes (venue_id, nome);

-- A varredura diária do aniversário pergunta "quem faz aniversário hoje
-- nesta casa?" — dia e mês juntos são exatamente essa pergunta.
create index if not exists idx_clientes_aniversario
  on public.clientes (venue_id, nascimento_mes, nascimento_dia)
  where nascimento_dia is not null and nascimento_mes is not null;

-- ============================================================
-- A configuração do parabéns
-- ============================================================
--
-- Separada da conexão com a Zig de propósito: mandar parabéns não exige
-- Zig nenhuma — a casa pode cadastrar aniversariantes na mão.

create table if not exists public.clientes_config (
  venue_id uuid primary key references public.venues(id) on delete cascade,

  -- Desligado até alguém ligar. Mensagem de marketing é diferente de aviso
  -- operacional: precisa de decisão explícita de quem responde pela casa.
  aniversario_ativo boolean not null default false,

  -- Hora local da casa em que a mensagem sai. Meio da manhã por padrão:
  -- parabéns às 7h acorda gente, e às 22h chega quando a festa já acabou.
  aniversario_hora int not null default 10 check (aniversario_hora between 0 and 23),

  -- Quantos dias ANTES avisar. Zero = no dia. Alguns donos preferem 2 ou 3
  -- dias para o cliente ter tempo de marcar a mesa — que é o objetivo real
  -- da mensagem.
  aniversario_antecedencia int not null default 0
    check (aniversario_antecedencia between 0 and 30),

  -- O texto. {nome} vira o primeiro nome do cliente. Vazio = usa o padrão
  -- do sistema, que já cita a casa.
  aniversario_texto text,

  -- O mesmo teto da pesquisa, pelo mesmo motivo: número comum que dispara
  -- muita mensagem de uma vez é número banido.
  aniversario_teto_por_dia int not null default 40
    check (aniversario_teto_por_dia between 1 and 500),

  atualizado_em timestamptz not null default now()
);

alter table public.clientes_config enable row level security;

comment on table public.clientes_config is
  'Parabéns de aniversário: se manda, a que horas, com quanta antecedência e com que texto.';

-- ============================================================
-- Um parabéns por ano
-- ============================================================
--
-- A varredura roda de hora em hora e pode repetir; a pessoa não pode receber
-- dois parabéns no mesmo aniversário. A trava é do banco, não da memória de
-- um processo que reinicia — mesma lição do CMV.

alter table public.notifications
  add column if not exists cliente_id uuid;

comment on column public.notifications.cliente_id is
  'O cliente que originou este aviso. Usado para travar um parabéns por ano.';

-- O ano vai no template: 'aniversario_2026'. Assim o índice único por
-- (cliente, template) permite o parabéns do ano que vem sem permitir dois
-- no mesmo ano.
create unique index if not exists idx_um_parabens_por_ano
  on public.notifications (cliente_id, template)
  where cliente_id is not null and template like 'aniversario_%';

notify pgrst, 'reload schema';
