-- Módulo Pesquisa de Satisfação: a opinião do cliente enquanto ele ainda está
-- na mesa.
--
-- O que existe hoje é a avaliação do Google — que chega DEPOIS, em público, e
-- só de quem se deu ao trabalho. A pesquisa na mesa pega o outro lado: o
-- cliente que não vai escrever no Google mas responde um QR code em vinte
-- segundos enquanto espera a conta, e o que teve um problema e vai embora
-- calado. Esse segundo é o mais caro de perder: ele não reclama, só não volta.
--
-- Três decisões que estão cravadas aqui e não no código da aplicação:
--
-- 1. UM PRÊMIO POR RESPOSTA. Sem isso, recarregar a página de agradecimento
--    ou uma retentativa de rede emitiria dois cupons pela mesma resposta — e
--    prêmio duplicado sai do bolso do dono.
-- 2. CÓDIGO DE CUPOM ÚNICO POR CASA. Dois cupons com o mesmo código deixam o
--    resgate ambíguo, e o balcão não tem como saber qual foi usado.
-- 3. CONVITE É DE USO ÚNICO. O link mandado no WhatsApp de um cliente não
--    pode virar formulário aberto repassado no grupo da rua.

-- ============================================================
-- 1. Ajustes da pesquisa, um por casa
-- ============================================================

create table if not exists public.pesquisa_config (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  ativa boolean not null default true,
  -- O que aparece no alto do celular do cliente. Vazio = a tela usa o nome da
  -- casa, para a pesquisa funcionar antes de alguém configurar qualquer coisa.
  saudacao text,
  agradecimento text,

  -- Premiação
  premio_ativo boolean not null default true,
  premio_titulo text not null default 'Um chopp por nossa conta na próxima visita',
  premio_regras text,
  premio_validade_dias int not null default 30
    check (premio_validade_dias between 1 and 365),

  -- Perguntas opcionais: cada uma a mais derruba a taxa de resposta, então
  -- quem decide é a casa.
  perguntar_atendente boolean not null default true,
  perguntar_comentario boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pesquisa_config enable row level security;

-- ============================================================
-- 2. Quem atende — a lista que vira ranking
-- ============================================================
--
-- Tabela própria, e não a equipe do painel: garçom não tem login. Quem aparece
-- para o cliente escolher é quem serve a mesa, não quem administra o sistema.

create table if not exists public.pesquisa_atendentes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nome text not null,
  nome_normalizado text not null,
  -- Como o cliente conhece a pessoa. "Zé do Bar" identifica melhor que
  -- "José Carlos da Silva" na hora de escolher no celular.
  apelido text,
  funcao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Dois "Ana" na lista deixam o cliente escolher no chute e estragam o
  -- ranking das duas. Grafia diferente do mesmo nome idem.
  unique (venue_id, nome_normalizado)
);

create or replace function public.pesquisa_normalizar(texto text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(coalesce(texto, ''))), '\s+', ' ', 'g');
$$;

create or replace function public.pesquisa_atendentes_antes()
returns trigger
language plpgsql
as $$
begin
  new.nome_normalizado := public.pesquisa_normalizar(new.nome);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pesquisa_atendentes_antes on public.pesquisa_atendentes;
create trigger pesquisa_atendentes_antes
  before insert or update on public.pesquisa_atendentes
  for each row execute function public.pesquisa_atendentes_antes();

create index if not exists idx_pesquisa_atendentes_casa
  on public.pesquisa_atendentes (venue_id, ativo);

alter table public.pesquisa_atendentes enable row level security;

-- ============================================================
-- 3. Convites: a pesquisa mandada para o cliente
-- ============================================================

create table if not exists public.pesquisa_convites (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  telefone text not null,
  nome text,
  -- O endereço secreto do link. Único no banco inteiro: dois convites com o
  -- mesmo token abririam a pesquisa um do outro.
  token text not null unique,
  enviado_em timestamptz,
  respondido_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_pesquisa_convites_casa
  on public.pesquisa_convites (venue_id, created_at desc);

alter table public.pesquisa_convites enable row level security;

-- ============================================================
-- 4. As respostas
-- ============================================================

create table if not exists public.pesquisa_respostas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,

  -- 0 a 10, a escala do NPS. Promotor 9-10, neutro 7-8, detrator 0-6.
  nota int not null check (nota between 0 and 10),

  -- O que foi bem e o que não foi, em toques: o cliente marca etiquetas em vez
  -- de escrever. É o que garante dado estruturado mesmo de quem não digita.
  elogios text[] not null default '{}',
  criticas text[] not null default '{}',

  comentario text,

  -- Quem atendeu, e a nota DELE em estrelas (1 a 5).
  --
  -- Nota separada da nota da casa de propósito: a comida pode ter demorado
  -- numa noite em que o garçom foi impecável, e misturar as duas coisas põe na
  -- conta da pessoa um problema da cozinha.
  atendente_id uuid references public.pesquisa_atendentes(id) on delete set null,
  atendente_nota int check (atendente_nota between 1 and 5),

  mesa text,
  origem text not null default 'qrcode'
    check (origem in ('qrcode', 'whatsapp', 'link')),
  convite_id uuid references public.pesquisa_convites(id) on delete set null,

  -- Só de quem quis concorrer ao prêmio.
  cliente_nome text,
  cliente_contato text,

  created_at timestamptz not null default now(),

  -- Atendente sem nota (ou o contrário) deixa o ranking pela metade e a tela
  -- sem saber o que mostrar. Ou vêm os dois, ou não vem nenhum.
  constraint pesquisa_atendente_com_nota check (
    (atendente_id is null and atendente_nota is null)
    or (atendente_id is not null and atendente_nota is not null)
  ),
  -- Um convite responde uma vez. Sem isto, o link repassado no grupo da rua
  -- viraria dez respostas em nome de um cliente só.
  unique (convite_id)
);

create index if not exists idx_pesquisa_respostas_casa
  on public.pesquisa_respostas (venue_id, created_at desc);
create index if not exists idx_pesquisa_respostas_atendente
  on public.pesquisa_respostas (atendente_id)
  where atendente_id is not null;

alter table public.pesquisa_respostas enable row level security;

-- Marca o convite como respondido no mesmo instante em que a resposta entra.
-- Fazer isso na aplicação deixaria a porta aberta: qualquer falha entre os
-- dois comandos devolveria um link já usado ao mundo.
create or replace function public.pesquisa_convite_respondido()
returns trigger
language plpgsql
as $$
begin
  if new.convite_id is not null then
    update public.pesquisa_convites
       set respondido_em = now()
     where id = new.convite_id;
  end if;
  return new;
end;
$$;

drop trigger if exists pesquisa_respostas_depois on public.pesquisa_respostas;
create trigger pesquisa_respostas_depois
  after insert on public.pesquisa_respostas
  for each row execute function public.pesquisa_convite_respondido();

-- ============================================================
-- 5. Os cupons
-- ============================================================

create table if not exists public.pesquisa_premios (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  -- Um por resposta. É esta linha que impede o cupom duplicado quando o
  -- cliente recarrega a tela de agradecimento.
  resposta_id uuid not null unique
    references public.pesquisa_respostas(id) on delete cascade,

  codigo text not null,
  -- Copiado da configuração no momento da emissão, e não lido dela na hora do
  -- resgate: o dono muda o prêmio no mês seguinte e o cupom antigo tem que
  -- continuar valendo o que prometeu a quem respondeu.
  titulo text not null,
  expira_em timestamptz not null,

  resgatado_em timestamptz,
  resgatado_por uuid references auth.users(id) on delete set null,
  observacao text,

  created_at timestamptz not null default now(),

  -- Dois cupons com o mesmo código deixam o balcão sem saber qual foi usado.
  unique (venue_id, codigo)
);

create index if not exists idx_pesquisa_premios_casa
  on public.pesquisa_premios (venue_id, created_at desc);

alter table public.pesquisa_premios enable row level security;

-- ============================================================
-- 6. Emitir o cupom — uma operação só
-- ============================================================
--
-- Gerar código, conferir se já existe e gravar são três passos que, feitos da
-- aplicação, abrem espaço para dois clientes ganharem o mesmo código no mesmo
-- segundo. Aqui é uma transação, e a unicidade é do banco.

create or replace function public.pesquisa_emitir_premio(
  p_resposta_id uuid,
  p_titulo text,
  p_validade_dias int
)
returns public.pesquisa_premios
language plpgsql
as $$
declare
  v_casa uuid;
  v_premio public.pesquisa_premios;
  v_codigo text;
  v_tentativa int := 0;
begin
  select venue_id into v_casa
    from public.pesquisa_respostas where id = p_resposta_id;
  if v_casa is null then
    raise exception 'Resposta % não existe.', p_resposta_id;
  end if;

  -- Já tem cupom? Devolve o mesmo. Recarregar a tela de agradecimento não
  -- pode custar um chopp a mais ao dono.
  select * into v_premio
    from public.pesquisa_premios where resposta_id = p_resposta_id;
  if found then
    return v_premio;
  end if;

  loop
    v_tentativa := v_tentativa + 1;
    -- Sem 0/O e 1/I: o código é lido em voz alta para o garçom, e essas
    -- quatro letras são a origem de metade dos "não achei esse cupom".
    v_codigo := (
      select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
                               (random() * 31)::int + 1, 1), '')
        from generate_series(1, 6)
    );
    begin
      insert into public.pesquisa_premios (venue_id, resposta_id, codigo, titulo, expira_em)
      values (
        v_casa,
        p_resposta_id,
        v_codigo,
        p_titulo,
        now() + make_interval(days => greatest(p_validade_dias, 1))
      )
      returning * into v_premio;
      return v_premio;
    exception when unique_violation then
      -- Colisão de código (ou corrida com outra emissão da mesma resposta).
      select * into v_premio
        from public.pesquisa_premios where resposta_id = p_resposta_id;
      if found then
        return v_premio;
      end if;
      if v_tentativa >= 12 then
        raise exception 'Não consegui gerar um código de cupom livre.';
      end if;
    end;
  end loop;
end;
$$;

-- ============================================================
-- 7. Resgatar — a regra que o balcão não pode furar
-- ============================================================

create or replace function public.pesquisa_resgatar_premio(
  p_venue_id uuid,
  p_codigo text,
  p_usuario uuid default null
)
returns public.pesquisa_premios
language plpgsql
as $$
declare
  v_premio public.pesquisa_premios;
begin
  -- `for update`: dois garçons batendo o mesmo código ao mesmo tempo
  -- resgatariam duas vezes se a leitura não travasse a linha.
  select * into v_premio
    from public.pesquisa_premios
   where venue_id = p_venue_id
     and upper(replace(codigo, '-', '')) = upper(replace(trim(p_codigo), '-', ''))
   for update;

  if not found then
    raise exception 'Cupom % não encontrado nesta casa.', p_codigo
      using errcode = 'no_data_found';
  end if;
  if v_premio.resgatado_em is not null then
    raise exception 'Cupom % já foi resgatado em %.',
      v_premio.codigo, to_char(v_premio.resgatado_em, 'DD/MM/YYYY HH24:MI')
      using errcode = 'unique_violation';
  end if;
  if v_premio.expira_em < now() then
    raise exception 'Cupom % venceu em %.',
      v_premio.codigo, to_char(v_premio.expira_em, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  update public.pesquisa_premios
     set resgatado_em = now(),
         resgatado_por = p_usuario
   where id = v_premio.id
  returning * into v_premio;

  return v_premio;
end;
$$;

-- ============================================================
-- 8. O módulo existe na colmeia
-- ============================================================

comment on table public.pesquisa_respostas is
  'Pesquisa de satisfação respondida na mesa (QR code) ou por link enviado ao cliente.';
