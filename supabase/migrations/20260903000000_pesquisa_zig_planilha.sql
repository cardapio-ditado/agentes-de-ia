-- A pesquisa aprende a se convidar sozinha.
--
-- Hoje o convite sai um a um, digitado no painel. Duas portas novas:
--   1. A Zig: quem esteve na casa ontem (comprou ou fez check-in) recebe o
--      convite no dia seguinte, sem ninguém digitar nada.
--   2. A planilha: casa sem Zig exporta a lista de clientes de onde tiver e
--      importa no painel — o resto do caminho é o mesmo.
--
-- O token da Zig é DE CADA CASA e mora aqui, no banco — como o WhatsApp de
-- avisos. Não é segredo da plataforma; é credencial do cliente, que ele
-- mesmo cola no painel e apaga quando quiser.

-- ============================================================
-- 1. A conexão com a Zig, por casa
-- ============================================================

create table if not exists public.pesquisa_zig (
  venue_id uuid primary key references public.venues(id) on delete cascade,

  -- O token de integração e o id da loja, copiados do painel da Zig.
  -- Vazios = sem conexão. O envio automático só liga com os dois + ativo.
  token text,
  loja text,

  ativo boolean not null default false,

  -- A que hora (da casa) o convite de ontem sai. Meio da manhã seguinte:
  -- cedo demais incomoda, tarde demais a noite já virou memória fraca.
  hora_envio int not null default 11 check (hora_envio between 0 and 23),

  -- Teto de convites por dia. WhatsApp comum que dispara centenas de
  -- mensagens de uma vez é WhatsApp banido — o teto protege o número da casa.
  teto_por_dia int not null default 80 check (teto_por_dia between 1 and 500),

  -- Quem respondeu (ou foi convidado) há pouco não é convidado de novo:
  -- pesquisa que chega toda semana ensina o cliente a ignorar a pesquisa.
  nao_repetir_dias int not null default 30 check (nao_repetir_dias between 0 and 365),

  -- O último dia já buscado e convidado. É o que impede a varredura de hora
  -- em hora de convidar o mesmo ontem duas vezes.
  ultimo_dia date,

  updated_at timestamptz not null default now()
);

alter table public.pesquisa_zig enable row level security;

comment on table public.pesquisa_zig is
  'Conexão da pesquisa com a Zig: quem esteve na casa ontem recebe o convite hoje.';

-- ============================================================
-- 2. De onde veio cada convite
-- ============================================================

alter table public.pesquisa_convites
  add column if not exists origem text not null default 'painel';

alter table public.pesquisa_convites
  drop constraint if exists pesquisa_convites_origem_valida;
alter table public.pesquisa_convites
  add constraint pesquisa_convites_origem_valida
  check (origem in ('painel', 'zig', 'planilha'));

-- O dia da visita que motivou o convite (origem zig). É a chave da trava:
-- a mesma pessoa, no mesmo dia de visita, recebe UM convite — mesmo que a
-- varredura rode de novo ou o servidor reinicie no meio.
alter table public.pesquisa_convites
  add column if not exists dia_visita date;

create unique index if not exists idx_um_convite_zig_por_visita
  on public.pesquisa_convites (venue_id, telefone, dia_visita)
  where origem = 'zig';

comment on column public.pesquisa_convites.origem is
  'painel = digitado à mão; zig = buscado na API da Zig; planilha = importado de arquivo.';

-- O PostgREST guarda o esquema em cache; sem isto as colunas novas ficam
-- "inexistentes" para a API até o cache renovar sozinho.
notify pgrst, 'reload schema';
