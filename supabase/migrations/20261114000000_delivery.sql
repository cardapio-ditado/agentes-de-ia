-- Delivery — o canal próprio de pedidos da casa.
--
-- Módulo à parte (`delivery` em venue_modulos). Reaproveita o que o Brasa já
-- tem: os itens e as variações são os do Cardápio Digital, o cliente é o da
-- base da casa, quem conversa é o atendente virtual e o aviso sai pela fila
-- de notificações. O que nasce aqui é só o que faltava para VENDER: a sacola,
-- o pedido, a cobrança, a taxa por bairro, o cupom e o cashback.
--
-- Dinheiro em CENTAVOS inteiros em tudo que é do delivery: desconto
-- percentual e cashback arredondam, e arredondar numeric(…, 2) em três
-- lugares diferentes é como o total deixa de fechar com a soma das linhas.
--
-- O pagamento é sempre antecipado (Pix ou cartão pelo Mercado Pago). Não há
-- "pagar na entrega": o pedido só chega à cozinha depois de pago.

-- ============================================================
-- 1. Como a casa entrega
-- ============================================================
create table if not exists public.delivery_config (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  -- A chave manual: "pausa o delivery" num dia de casa cheia, sem mexer no horário.
  aceitando boolean not null default true,
  -- { "0": ["18:00", "23:00"], … } por dia da semana (0 = domingo). Vazio =
  -- sem horário automático, vale só a chave acima. Não reaproveita
  -- venues.opening_hours: aquele é texto livre ("18h às 2h") para o cliente
  -- ler, e a casa costuma entregar num horário diferente do salão.
  horario jsonb not null default '{}'::jsonb,
  -- Vale quando não há bairro cadastrado.
  taxa_unica_centavos integer not null default 0 check (taxa_unica_centavos >= 0),
  previsao text not null default '40 a 60 minutos',
  endereco_retirada text,
  cashback_percentual smallint not null default 0 check (cashback_percentual between 0 and 50),
  lembrar_sacola boolean not null default true,
  -- O que o atendente precisa saber só do delivery (embalagem, pedido mínimo…).
  instrucoes text,
  -- A conta do Mercado Pago é DA CASA: o dinheiro cai direto nela.
  mp_access_token text,
  mp_webhook_secret text,
  mp_email_pagador text,
  atualizado_em timestamptz not null default now()
);
alter table public.delivery_config enable row level security;

-- ============================================================
-- 2. Bairros atendidos e a taxa de cada um
-- ============================================================
-- Com bairro cadastrado, só eles são atendidos. Sem nenhum, vale a taxa única.
create table if not exists public.delivery_bairros (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nome text not null,
  taxa_centavos integer not null default 0 check (taxa_centavos >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists idx_delivery_bairros_nome on public.delivery_bairros (venue_id, lower(nome));
alter table public.delivery_bairros enable row level security;

-- ============================================================
-- 3. Cupons
-- ============================================================
create table if not exists public.delivery_cupons (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  codigo text not null check (codigo = upper(codigo) and codigo ~ '^[A-Z0-9]{3,20}$'),
  tipo text not null check (tipo in ('percentual', 'fixo')),
  -- Percentual: 1 a 100. Fixo: centavos.
  valor integer not null check (valor > 0),
  minimo_centavos integer not null default 0 check (minimo_centavos >= 0),
  -- 0 = sem limite.
  limite_usos integer not null default 0 check (limite_usos >= 0),
  usos integer not null default 0 check (usos >= 0),
  expira_em date,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  check (tipo <> 'percentual' or valor <= 100)
);
create unique index if not exists idx_delivery_cupons_codigo on public.delivery_cupons (venue_id, codigo);
alter table public.delivery_cupons enable row level security;

-- ============================================================
-- 4. A sacola
-- ============================================================
-- O id é o segredo: é ele que vai no link que o atendente manda no WhatsApp e
-- no navegador de quem abriu o cardápio. Por isso a sacola é a MESMA nos dois
-- lugares — o cliente monta no link e fecha na conversa, ou o contrário.
--
-- Os itens ficam num jsonb só: a sacola é lida e gravada inteira, nunca em
-- pedaços, e não tem relatório nenhum em cima dela.
create table if not exists public.delivery_sacolas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  -- Preenchido quando a sacola nasceu de uma conversa do atendente.
  conversation_id uuid references public.conversations(id) on delete set null,
  -- Telefone VERIFICADO pelo canal (WhatsApp). Sacola aberta direto no site
  -- não tem: o que a pessoa digita no checkout não prova de quem é o número,
  -- e é esta coluna que libera o uso do cashback.
  telefone text,
  nome text,
  endereco text,
  bairro text,
  itens jsonb not null default '[]'::jsonb,
  atualizada_em timestamptz not null default now(),
  -- Um lembrete por sacola parada, e não um por minuto.
  lembrada_em timestamptz,
  criada_em timestamptz not null default now()
);
create unique index if not exists idx_delivery_sacola_da_conversa
  on public.delivery_sacolas (conversation_id) where conversation_id is not null;
create index if not exists idx_delivery_sacolas_paradas
  on public.delivery_sacolas (atualizada_em) where telefone is not null;
alter table public.delivery_sacolas enable row level security;

-- ============================================================
-- 5. O pedido
-- ============================================================
create table if not exists public.delivery_pedidos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  -- O número que o cliente e a cozinha falam. Sequência única da plataforma:
  -- número por casa exigiria trava, e ninguém estranha o pedido #1532.
  numero bigint generated always as identity,
  -- O segredo do link de acompanhamento.
  token uuid not null default gen_random_uuid(),
  sacola_id uuid references public.delivery_sacolas(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  -- 'cardapio' = fechou pelo link; 'conversa' = fechou falando com o atendente.
  origem text not null check (origem in ('cardapio', 'conversa')),
  canal text not null default 'site',
  nome text not null,
  telefone text not null,
  -- O telefone veio do canal (WhatsApp), e não do que a pessoa digitou?
  telefone_verificado boolean not null default false,
  tipo text not null check (tipo in ('entrega', 'retirada')),
  endereco text,
  bairro text,
  pagamento text not null check (pagamento in ('pix', 'cartao')),
  subtotal_centavos integer not null check (subtotal_centavos >= 0),
  taxa_centavos integer not null default 0 check (taxa_centavos >= 0),
  desconto_centavos integer not null default 0 check (desconto_centavos >= 0),
  cupom text,
  cashback_usado_centavos integer not null default 0 check (cashback_usado_centavos >= 0),
  cashback_ganho_centavos integer not null default 0 check (cashback_ganho_centavos >= 0),
  total_centavos integer not null check (total_centavos >= 0),
  status text not null default 'aguardando_pagamento' check (status in (
    'aguardando_pagamento', 'recebido', 'em_preparo', 'saiu_para_entrega',
    'pronto_para_retirada', 'entregue', 'cancelado'
  )),
  mp_ref text,
  link_pagamento text,
  pix_codigo text,
  pix_qr text,
  observacoes text,
  criado_em timestamptz not null default now(),
  pago_em timestamptz,
  atualizado_em timestamptz not null default now()
);
create unique index if not exists idx_delivery_pedidos_token on public.delivery_pedidos (token);
create index if not exists idx_delivery_pedidos_casa on public.delivery_pedidos (venue_id, criado_em desc);
create index if not exists idx_delivery_pedidos_pendentes
  on public.delivery_pedidos (criado_em) where status = 'aguardando_pagamento';
-- Uma sacola não abre dois pedidos sem pagar: o segundo clique no botão, ou
-- o cliente que fecha no link e na conversa ao mesmo tempo, bate aqui.
create unique index if not exists idx_delivery_um_pendente_por_sacola
  on public.delivery_pedidos (sacola_id) where status = 'aguardando_pagamento';
alter table public.delivery_pedidos enable row level security;

create table if not exists public.delivery_pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.delivery_pedidos(id) on delete cascade,
  -- Sem FK de propósito no apagar: o item pode sair do cardápio, o pedido fica.
  item_id uuid references public.items(id) on delete set null,
  -- O nome e o preço DO DIA do pedido. O cardápio muda; o que foi vendido, não.
  nome text not null,
  opcoes text,
  preco_centavos integer not null check (preco_centavos >= 0),
  quantidade integer not null check (quantidade > 0),
  observacao text
);
create index if not exists idx_delivery_pedido_itens on public.delivery_pedido_itens (pedido_id);
alter table public.delivery_pedido_itens enable row level security;

-- ============================================================
-- 6. Cashback
-- ============================================================
-- Fora de `clientes` de propósito: aquela tabela tem dezenas de milhares de
-- linhas e várias rotinas escrevendo nela; saldo de dinheiro não divide linha
-- com sincronização de nome.
create table if not exists public.delivery_cashback (
  venue_id uuid not null references public.venues(id) on delete cascade,
  telefone text not null,
  saldo_centavos integer not null default 0 check (saldo_centavos >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (venue_id, telefone)
);
alter table public.delivery_cashback enable row level security;

-- ============================================================
-- 7. Fechar, cancelar e entregar — cada um numa transação só
-- ============================================================
-- O servidor calcula tudo (preço, taxa, desconto) e entrega o pedido pronto;
-- estas funções existem para o que NÃO pode acontecer pela metade: gastar o
-- uso do cupom sem criar o pedido, debitar o cashback duas vezes, esvaziar a
-- sacola de um pedido que não nasceu.
--
-- Erro de regra sai com o prefixo DELIVERY: — é o que o servidor mostra ao
-- cliente; qualquer outro erro é defeito e vira 500.

create or replace function public.delivery_fechar_pedido(p jsonb)
returns public.delivery_pedidos
language plpgsql
set search_path = public
as $$
declare
  v_pedido public.delivery_pedidos;
  v_casa uuid := (p->>'venue_id')::uuid;
  v_sacola uuid := (p->>'sacola_id')::uuid;
  v_cupom text := nullif(p->>'cupom', '');
  v_cashback integer := coalesce((p->>'cashback_usado_centavos')::integer, 0);
  v_total integer := (p->>'total_centavos')::integer;
  v_linhas integer;
begin
  -- A sacola travada segura dois fechamentos simultâneos da mesma sacola.
  perform 1 from public.delivery_sacolas where id = v_sacola and venue_id = v_casa for update;
  if not found then
    raise exception 'DELIVERY: Sacola não encontrada.';
  end if;

  if jsonb_array_length(coalesce(p->'itens', '[]'::jsonb)) = 0 then
    raise exception 'DELIVERY: A sacola está vazia.';
  end if;

  if exists (select 1 from public.delivery_pedidos where sacola_id = v_sacola and status = 'aguardando_pagamento') then
    raise exception 'DELIVERY: Já existe um pedido desta sacola aguardando pagamento. Pague ou cancele antes de abrir outro.';
  end if;

  if v_cupom is not null then
    update public.delivery_cupons
       set usos = usos + 1
     where venue_id = v_casa and codigo = v_cupom and ativo
       and (limite_usos = 0 or usos < limite_usos)
       and (expira_em is null or expira_em >= current_date);
    if not found then
      raise exception 'DELIVERY: O cupom % não está mais disponível.', v_cupom;
    end if;
  end if;

  if v_cashback > 0 then
    update public.delivery_cashback
       set saldo_centavos = saldo_centavos - v_cashback, atualizado_em = now()
     where venue_id = v_casa and telefone = p->>'telefone' and saldo_centavos >= v_cashback;
    if not found then
      raise exception 'DELIVERY: O saldo de cashback mudou. Confira o total e tente de novo.';
    end if;
  end if;

  insert into public.delivery_pedidos (
    venue_id, sacola_id, conversation_id, origem, canal, nome, telefone, telefone_verificado,
    tipo, endereco, bairro, pagamento, subtotal_centavos, taxa_centavos, desconto_centavos, cupom,
    cashback_usado_centavos, total_centavos, status, pago_em, observacoes
  ) values (
    v_casa, v_sacola, nullif(p->>'conversation_id', '')::uuid, p->>'origem', coalesce(p->>'canal', 'site'),
    p->>'nome', p->>'telefone', coalesce((p->>'telefone_verificado')::boolean, false),
    p->>'tipo', nullif(p->>'endereco', ''), nullif(p->>'bairro', ''), p->>'pagamento',
    (p->>'subtotal_centavos')::integer, coalesce((p->>'taxa_centavos')::integer, 0),
    coalesce((p->>'desconto_centavos')::integer, 0), v_cupom, v_cashback, v_total,
    -- Total zerado por cupom ou cashback não tem o que cobrar: já entra pago.
    case when v_total = 0 then 'recebido' else 'aguardando_pagamento' end,
    case when v_total = 0 then now() else null end,
    nullif(p->>'observacoes', '')
  ) returning * into v_pedido;

  insert into public.delivery_pedido_itens (pedido_id, item_id, nome, opcoes, preco_centavos, quantidade, observacao)
  select v_pedido.id, nullif(l->>'item_id', '')::uuid, l->>'nome', nullif(l->>'opcoes', ''),
         (l->>'preco_centavos')::integer, (l->>'quantidade')::integer, nullif(l->>'observacao', '')
    from jsonb_array_elements(p->'itens') as l;
  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    raise exception 'DELIVERY: A sacola está vazia.';
  end if;

  update public.delivery_sacolas
     set itens = '[]'::jsonb, atualizada_em = now(), nome = p->>'nome',
         endereco = coalesce(nullif(p->>'endereco', ''), endereco),
         bairro = coalesce(nullif(p->>'bairro', ''), bairro)
   where id = v_sacola;

  return v_pedido;
end;
$$;

-- Cancela e devolve o que o pedido tinha consumido. Idempotente: cancelar de
-- novo não devolve em dobro. `p_so_pendente` é o cancelamento do próprio
-- cliente e da rotina de expiração — que não podem derrubar pedido já pago.
create or replace function public.delivery_cancelar_pedido(p_pedido uuid, p_so_pendente boolean default false)
returns public.delivery_pedidos
language plpgsql
set search_path = public
as $$
declare
  v_pedido public.delivery_pedidos;
begin
  update public.delivery_pedidos
     set status = 'cancelado', atualizado_em = now()
   where id = p_pedido
     and status not in ('cancelado', 'entregue')
     and (not p_so_pendente or status = 'aguardando_pagamento')
  returning * into v_pedido;
  if not found then
    return null;
  end if;

  if v_pedido.cupom is not null then
    update public.delivery_cupons set usos = greatest(usos - 1, 0)
     where venue_id = v_pedido.venue_id and codigo = v_pedido.cupom;
  end if;
  if v_pedido.cashback_usado_centavos > 0 then
    insert into public.delivery_cashback (venue_id, telefone, saldo_centavos)
    values (v_pedido.venue_id, v_pedido.telefone, v_pedido.cashback_usado_centavos)
    on conflict (venue_id, telefone)
    do update set saldo_centavos = public.delivery_cashback.saldo_centavos + excluded.saldo_centavos, atualizado_em = now();
  end if;
  return v_pedido;
end;
$$;

-- Marca como entregue e credita o cashback — uma vez só, mesmo com dois
-- cliques no painel. Só credita para telefone verificado pelo canal: é o
-- mesmo critério de quem pode gastar.
create or replace function public.delivery_entregar_pedido(p_pedido uuid, p_ganho_centavos integer)
returns public.delivery_pedidos
language plpgsql
set search_path = public
as $$
declare
  v_pedido public.delivery_pedidos;
  v_ganho integer := greatest(coalesce(p_ganho_centavos, 0), 0);
begin
  update public.delivery_pedidos
     set status = 'entregue', atualizado_em = now(),
         cashback_ganho_centavos = v_ganho
   where id = p_pedido and status not in ('entregue', 'cancelado', 'aguardando_pagamento')
  returning * into v_pedido;
  if not found then
    return null;
  end if;

  if v_ganho > 0 then
    insert into public.delivery_cashback (venue_id, telefone, saldo_centavos)
    values (v_pedido.venue_id, v_pedido.telefone, v_ganho)
    on conflict (venue_id, telefone)
    do update set saldo_centavos = public.delivery_cashback.saldo_centavos + excluded.saldo_centavos, atualizado_em = now();
  end if;
  return v_pedido;
end;
$$;

-- Só o servidor (service_role) chama: o navegador nunca fala com o banco.
revoke all on function public.delivery_fechar_pedido(jsonb) from public, anon, authenticated;
revoke all on function public.delivery_cancelar_pedido(uuid, boolean) from public, anon, authenticated;
revoke all on function public.delivery_entregar_pedido(uuid, integer) from public, anon, authenticated;
