-- A pesquisa deixa de ser um formulário fixo e passa a ser montada pela casa,
-- como o checklist.
--
-- A versão anterior perguntava sempre a mesma coisa: nota de 0 a 10 e umas
-- etiquetas. Serve para saber SE está bom; não serve para saber O QUE está
-- bom. Um bar que quer descobrir se o problema é a cozinha ou o salão precisa
-- de nota separada por assunto, e cada casa tem os seus assuntos — quem tem
-- estacionamento pergunta do estacionamento, quem tem palco pergunta do som.
--
-- Três coisas mudam:
--
-- 1. `pesquisas` guarda o MODELO (as perguntas), igual a `checklists`. Uma
--    ativa por casa: é ela que o QR code da mesa abre.
-- 2. Cada resposta vira LINHAS em `pesquisa_resposta_itens`, com a nota já
--    normalizada de 0 a 10. Guardar só o JSON da resposta faria "média de
--    Comida no mês" virar varredura de texto — a conta que o dono mais vai
--    pedir seria a mais cara de fazer.
-- 3. O prêmio ganha `liberado_em`: um cupom que vale "na próxima visita" não
--    pode ser resgatado na mesa em que foi ganho.

-- ============================================================
-- 1. O modelo da pesquisa
-- ============================================================

create table if not exists public.pesquisas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nome text not null,
  descricao text,

  -- [{id, categoria, pergunta, tipo: "nota"|"estrelas"|"sim_nao"|"texto",
  --   obrigatorio}] — mesma forma dos itens do checklist.
  itens jsonb not null default '[]'::jsonb,

  ativa boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma ativa por casa. O QR code impresso na mesa não tem como escolher entre
-- duas: com mais de uma ativa, qual pesquisa o cliente responde passaria a
-- depender da ordem que o banco devolvesse — e mudaria sozinho.
create unique index if not exists idx_pesquisa_uma_ativa
  on public.pesquisas (venue_id) where ativa;

create index if not exists idx_pesquisas_casa
  on public.pesquisas (venue_id, created_at desc);

alter table public.pesquisas enable row level security;

-- ============================================================
-- 2. A resposta aponta para o modelo que a gerou
-- ============================================================
--
-- `on delete set null` e não cascade: apagar a pesquisa de agosto não pode
-- apagar as duzentas respostas de agosto. As perguntas ficam copiadas em
-- cada linha de resposta justamente para o histórico sobreviver ao modelo.

alter table public.pesquisa_respostas
  add column if not exists pesquisa_id uuid
    references public.pesquisas(id) on delete set null;

-- ============================================================
-- 3. As notas, uma linha por pergunta respondida
-- ============================================================

create table if not exists public.pesquisa_resposta_itens (
  id uuid primary key default gen_random_uuid(),
  resposta_id uuid not null
    references public.pesquisa_respostas(id) on delete cascade,
  -- Repetido de propósito: a média por categoria da casa é a consulta mais
  -- pedida da tela, e sem esta coluna ela pagaria um join a mais toda vez.
  venue_id uuid not null references public.venues(id) on delete cascade,

  item_id text not null,
  -- Pergunta e categoria COPIADAS no momento da resposta. Renomear a
  -- categoria em setembro não pode reescrever o que foi perguntado em agosto:
  -- a série histórica passaria a mentir sobre o que o cliente respondeu.
  categoria text not null,
  pergunta text not null,
  tipo text not null,

  -- Tudo normalizado de 0 a 10: estrela vira nota, sim/não vira 10 ou 0. É o
  -- que permite somar "Comida" quando uma pergunta é em estrelas e a outra em
  -- nota. Null em pergunta de texto, que não pontua.
  nota numeric(4,2) check (nota is null or nota between 0 and 10),
  -- O que o cliente marcou, como ele marcou ("4", "sim"). A tela mostra isto;
  -- a conta usa a coluna acima.
  valor text,
  texto text,

  created_at timestamptz not null default now(),

  -- Uma resposta por pergunta. Sem isto, um envio repetido por falha de rede
  -- contaria a mesma nota duas vezes e puxaria a média da casa.
  unique (resposta_id, item_id)
);

create index if not exists idx_resposta_itens_categoria
  on public.pesquisa_resposta_itens (venue_id, categoria, created_at desc);
create index if not exists idx_resposta_itens_resposta
  on public.pesquisa_resposta_itens (resposta_id);

alter table public.pesquisa_resposta_itens enable row level security;

-- ============================================================
-- 4. O prêmio só vale na PRÓXIMA visita
-- ============================================================
--
-- Cupom ganho na mesa e usado na mesma conta não premia a volta do cliente:
-- vira desconto no que ele já ia pagar. A carência é a diferença entre um
-- programa de fidelidade e um cupom de desconto.

alter table public.pesquisa_premios
  add column if not exists liberado_em timestamptz;

-- Os cupons que já existem: liberados desde sempre. Aplicar a regra nova
-- retroativamente travaria um cupom que a casa já prometeu que valia.
update public.pesquisa_premios
   set liberado_em = created_at
 where liberado_em is null;

alter table public.pesquisa_premios
  alter column liberado_em set default now();

comment on column public.pesquisa_premios.liberado_em is
  'A partir de quando o cupom pode ser resgatado. Calculado como o início do dia seguinte no fuso da casa: o prêmio é pela PRÓXIMA visita.';

-- A emissão passa a receber a liberação já calculada. Quem sabe o fuso da
-- casa é a aplicação; o banco só guarda o instante e cobra a regra.
create or replace function public.pesquisa_emitir_premio(
  p_resposta_id uuid,
  p_titulo text,
  p_validade_dias int,
  p_liberado_em timestamptz default null
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

  select * into v_premio
    from public.pesquisa_premios where resposta_id = p_resposta_id;
  if found then
    return v_premio;
  end if;

  loop
    v_tentativa := v_tentativa + 1;
    v_codigo := (
      select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
                               (random() * 31)::int + 1, 1), '')
        from generate_series(1, 6)
    );
    begin
      insert into public.pesquisa_premios
        (venue_id, resposta_id, codigo, titulo, expira_em, liberado_em)
      values (
        v_casa,
        p_resposta_id,
        v_codigo,
        p_titulo,
        now() + make_interval(days => greatest(p_validade_dias, 1)),
        coalesce(p_liberado_em, now())
      )
      returning * into v_premio;
      return v_premio;
    exception when unique_violation then
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
  -- A carência vem antes do vencimento na ordem das conferências porque é a
  -- recusa mais provável no balcão: o cliente tenta usar na hora que ganhou.
  if v_premio.liberado_em is not null and v_premio.liberado_em > now() then
    raise exception 'Cupom % vale a partir de %. É um prêmio pela próxima visita.',
      v_premio.codigo, to_char(v_premio.liberado_em, 'DD/MM/YYYY')
      using errcode = 'restrict_violation';
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

comment on table public.pesquisas is
  'Modelo da pesquisa: as perguntas que a casa faz, agrupadas por categoria.';
comment on table public.pesquisa_resposta_itens is
  'Uma linha por pergunta respondida, com a nota normalizada de 0 a 10.';
