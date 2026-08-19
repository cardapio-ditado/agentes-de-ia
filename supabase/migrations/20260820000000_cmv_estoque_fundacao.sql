-- Módulo CMV Inteligente: a fundação.
--
-- Estoque, compras, fichas técnicas e produção — com as regras que o Gorjeta
-- Pro (o ERP do Ditado) levou dois anos e vários prejuízos para descobrir,
-- cravadas no BANCO desde o primeiro dia. No Gorjeta elas viraram convenção
-- documentada num arquivo de contexto, e convenção é quebrada pelo próximo
-- que chega com pressa. Aqui elas são trigger, função e constraint.
--
-- As quatro que mais custaram lá:
--
-- 1. RÉGUA ÚNICA DE SALDO. Havia três funções calculando saldo de jeitos
--    diferentes; 73% dos saldos discordavam entre si. Aqui existe uma só
--    (`cmv_saldo`), e o saldo materializado é escrito EXCLUSIVAMENTE por
--    trigger a partir do razão de movimentações.
--
-- 2. O CLIENTE NUNCA ESCREVE SALDO. Toda mudança de estoque é uma linha nova
--    em `estoque_movimentos` — append-only. Escrever saldo direto foi a causa
--    raiz do bug histórico de contagem lá.
--
-- 3. PRODUÇÃO É TRANSACIONAL. Baixar insumo e dar entrada de produto em duas
--    chamadas separadas do front produziu 33 "produções fantasma": o INSERT
--    falhava, o erro era engolido, e a tela dizia que deu certo. Aqui é uma
--    função só, tudo ou nada.
--
-- 4. CONTAGEM É VERDADE ABSOLUTA. Sem tolerância. A tolerância de lá deixava
--    resíduo de ponto flutuante: "contei 5, aparece 4,99".
--
-- Tudo com venue_id: aqui é multi-cliente desde o começo, não uma adaptação.
-- RLS ligado sem policies, como nas demais tabelas do Brasa Food: acesso só
-- pelo backend com service_role.

-- `unaccent` é uma extensão que pode não estar instalada, e instalá-la exige
-- privilégio que nem todo projeto dá. Esta tradução cobre o português e não
-- depende de extensão nenhuma.
create or replace function public.unaccent_imutavel(texto text)
returns text
language sql
immutable
as $$
  select translate(
    coalesce(texto, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  );
$$;

-- ============================================================
-- Onde o estoque mora
-- ============================================================
-- Bar, cozinha, depósito. Um insumo tem saldo POR LOCAL: a garrafa que está
-- no bar não serve para a cozinha produzir, e somar os dois esconde a falta.

create table if not exists public.estoque_locais (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nome text not null,
  -- O local que recebe compra por padrão. Um por casa, garantido por índice.
  principal boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (venue_id, nome)
);

create unique index if not exists estoque_locais_um_principal
  on public.estoque_locais (venue_id) where principal;

-- ============================================================
-- Insumos
-- ============================================================
-- O que se compra e se consome. Diferente de `items`, que é o que se VENDE:
-- "Tilápia congelada (kg)" é insumo; "Isca de tilápia" é item do cardápio.

create table if not exists public.insumos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nome text not null,
  -- Sem acento, sem espaço duplo, minúsculo. É o que garante a unicidade.
  --
  -- No Gorjeta, "Tiras de frango " e "TIRAS DE FRANGO " viraram DOIS itens
  -- com saldos separados, e a fusão continua pendente lá até hoje. Um índice
  -- único sobre o nome cru não pegaria isso; sobre o normalizado, pega.
  nome_normalizado text not null,
  -- kg, L, un, cx... Livre de propósito: cada casa mede do seu jeito.
  unidade text not null default 'un',
  categoria text,
  -- Código do fornecedor ou do PDV. É por ele que a nota fiscal e o arquivo
  -- de vendas casam sem adivinhação.
  codigo text,
  -- Custo médio ponderado, atualizado a cada entrada de compra. É o número
  -- que valoriza o estoque e alimenta o CMV.
  custo_medio numeric(12,4) not null default 0 check (custo_medio >= 0),
  -- Abaixo disso, entra na sugestão de compra.
  estoque_minimo numeric(12,3),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, nome_normalizado)
);

comment on column public.insumos.nome_normalizado is
  'Nome sem acento/espaço/caixa. A unicidade vive aqui: no Gorjeta, duas grafias do mesmo insumo viraram dois saldos.';

/**
 * Normaliza nome para comparação.
 *
 * immutable porque é usada em índice e em geração de coluna: o Postgres
 * precisa saber que a mesma entrada dá sempre a mesma saída.
 */
create or replace function public.cmv_normalizar(texto text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           lower(trim(unaccent_imutavel(coalesce(texto, '')))),
           '\s+', ' ', 'g'
         );
$$;

create or replace function public.insumos_normalizar()
returns trigger
language plpgsql
as $$
begin
  new.nome_normalizado := public.cmv_normalizar(new.nome);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists insumos_antes_de_gravar on public.insumos;
create trigger insumos_antes_de_gravar
  before insert or update on public.insumos
  for each row execute function public.insumos_normalizar();

-- ============================================================
-- O razão: toda mudança de estoque é uma linha aqui
-- ============================================================
-- Append-only. Nada nesta tabela é editado ou apagado no curso normal — um
-- erro se corrige com movimento contrário, como em contabilidade. É o que
-- permite responder "por que o saldo é este?" seis meses depois.

create table if not exists public.estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  local_id uuid not null references public.estoque_locais(id) on delete cascade,
  -- Positivo entra, negativo sai. Um sinal só, em vez de tipo + valor
  -- absoluto: soma de saldo vira SUM(quantidade), sem CASE que alguém
  -- esquece de atualizar quando surge um tipo novo.
  quantidade numeric(12,3) not null check (quantidade <> 0),
  tipo text not null check (tipo in (
    'compra', 'venda', 'producao_entrada', 'producao_saida',
    'transferencia_entrada', 'transferencia_saida', 'perda', 'ajuste_contagem'
  )),
  -- Custo unitário no momento do movimento. Guardado na linha porque o custo
  -- médio do insumo muda com o tempo, e o valor histórico do estoque tem que
  -- continuar respondendo o que valia NAQUELE dia.
  custo_unitario numeric(12,4) not null default 0,
  -- De onde veio: id da compra, da produção, da contagem.
  origem_tipo text,
  origem_id uuid,
  observacao text,
  criado_por uuid,
  criado_em timestamptz not null default now()
);

create index if not exists estoque_movimentos_saldo
  on public.estoque_movimentos (venue_id, insumo_id, local_id);
create index if not exists estoque_movimentos_periodo
  on public.estoque_movimentos (venue_id, criado_em);
create index if not exists estoque_movimentos_origem
  on public.estoque_movimentos (origem_tipo, origem_id);

-- ============================================================
-- Saldo materializado — escrito SÓ por trigger
-- ============================================================

create table if not exists public.estoque_saldos (
  venue_id uuid not null references public.venues(id) on delete cascade,
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  local_id uuid not null references public.estoque_locais(id) on delete cascade,
  quantidade numeric(12,3) not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (insumo_id, local_id)
);

comment on table public.estoque_saldos is
  'Cache do saldo. NUNCA escrever aqui direto — só o trigger de estoque_movimentos escreve. A verdade é o razão.';

/**
 * A régua única: o saldo de um insumo num local.
 *
 * Esta é a ÚNICA fórmula de saldo do sistema. No Gorjeta existiam três, e
 * 73% dos saldos discordavam entre si — cada tela mostrava um número e
 * ninguém sabia qual acreditar. Qualquer soma paralela que apareça em código
 * novo é um bug, não uma otimização.
 */
create or replace function public.cmv_saldo(p_insumo_id uuid, p_local_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(quantidade), 0)
  from public.estoque_movimentos
  where insumo_id = p_insumo_id and local_id = p_local_id;
$$;

create or replace function public.estoque_atualizar_saldo()
returns trigger
language plpgsql
as $$
declare
  v_insumo uuid := coalesce(new.insumo_id, old.insumo_id);
  v_local  uuid := coalesce(new.local_id,  old.local_id);
  v_venue  uuid := coalesce(new.venue_id,  old.venue_id);
begin
  insert into public.estoque_saldos (venue_id, insumo_id, local_id, quantidade, atualizado_em)
  values (v_venue, v_insumo, v_local, public.cmv_saldo(v_insumo, v_local), now())
  on conflict (insumo_id, local_id) do update
    set quantidade = excluded.quantidade,
        atualizado_em = now();
  return null;
end;
$$;

-- Recalcula a partir do razão em vez de somar o delta: um delta perdido por
-- qualquer motivo desalinharia o cache para sempre, em silêncio.
drop trigger if exists estoque_movimentos_depois on public.estoque_movimentos;
create trigger estoque_movimentos_depois
  after insert or update or delete on public.estoque_movimentos
  for each row execute function public.estoque_atualizar_saldo();

-- ============================================================
-- Fichas técnicas
-- ============================================================
-- A ponte entre o que se vende e o que se consome.
--
-- A ficha tem NOME PRÓPRIO e o vínculo com o cardápio é OPCIONAL. Nem todo
-- cliente assina o módulo Cardápio Digital: amarrar a ficha em `items` faria
-- o CMV nascer inútil para quem só quer controlar estoque, que é justamente
-- quem mais precisa dele.
--
-- Quem TEM o cardápio ganha a ligação de graça: preço de venda para calcular
-- margem, nome já cadastrado, e o custo aparecendo ao lado do item na tela do
-- cardápio. Quem não tem, digita o nome do prato e segue igual.
--
-- Serve também para o que não se vende: molho, massa base, marinada. Esses
-- nunca teriam item de cardápio, e são metade do trabalho de uma cozinha.

create table if not exists public.fichas_tecnicas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  -- Sempre presente. É a identidade da ficha.
  nome text not null,
  nome_normalizado text not null,
  -- Só quando o cliente tem o Cardápio Digital E este prato está lá.
  item_id uuid references public.items(id) on delete set null,
  -- Preço de venda, para a margem. Vem do cardápio quando há vínculo; quem
  -- não tem o módulo digita. Nulo em ficha de preparo (molho, massa).
  preco_venda numeric(12,2),
  -- Quantas porções a receita rende. Ficha de molho rende 20; a de um prato,
  -- 1. Sem isso, o custo por porção sai multiplicado pelo rendimento.
  rendimento numeric(12,3) not null default 1 check (rendimento > 0),
  observacoes text,
  -- A ficha foi sugerida pela IA e ainda não passou por um humano.
  --
  -- Existe porque receita sugerida é chute plausível, e chute plausível
  -- entrando no CMV como verdade produz um custo errado com cara de certo —
  -- pior que não ter CMV nenhum.
  sugerida_por_ia boolean not null default false,
  confirmada_em timestamptz,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, nome_normalizado)
);

-- Um item do cardápio tem no máximo uma ficha. Índice parcial porque a
-- maioria das fichas não tem vínculo, e nulo não colide com nulo num unique
-- comum — mas é melhor dizer isso explicitamente do que depender da regra.
create unique index if not exists fichas_tecnicas_um_por_item
  on public.fichas_tecnicas (venue_id, item_id) where item_id is not null;

create or replace function public.fichas_normalizar()
returns trigger
language plpgsql
as $$
begin
  new.nome_normalizado := public.cmv_normalizar(new.nome);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists fichas_antes_de_gravar on public.fichas_tecnicas;
create trigger fichas_antes_de_gravar
  before insert or update on public.fichas_tecnicas
  for each row execute function public.fichas_normalizar();

create table if not exists public.ficha_insumos (
  id uuid primary key default gen_random_uuid(),
  ficha_id uuid not null references public.fichas_tecnicas(id) on delete cascade,
  insumo_id uuid not null references public.insumos(id) on delete restrict,
  -- Na unidade do insumo. 0.180 kg de tilápia, 0.05 L de óleo.
  quantidade numeric(12,4) not null check (quantidade > 0),
  observacao text,
  unique (ficha_id, insumo_id)
);

comment on column public.fichas_tecnicas.sugerida_por_ia is
  'Sugestão da IA ainda não conferida. Ficha não confirmada NÃO entra no custo: chute plausível vira custo errado com cara de certo.';

/**
 * Quanto custa uma porção desta ficha, hoje.
 *
 * Ficha não confirmada devolve NULL, e não zero: zero é um custo, e um custo
 * de zero no relatório vira "esse prato é lucro puro" — a IA sugeriu, ninguém
 * conferiu, e o dono decide preço em cima de um número inventado.
 */
create or replace function public.cmv_custo_da_ficha(p_ficha_id uuid)
returns numeric
language sql
stable
as $$
  select case
    when f.confirmada_em is null then null
    else coalesce(sum(fi.quantidade * i.custo_medio), 0) / f.rendimento
  end
  from public.fichas_tecnicas f
  left join public.ficha_insumos fi on fi.ficha_id = f.id
  left join public.insumos i on i.id = fi.insumo_id
  where f.id = p_ficha_id and f.ativa
  group by f.id, f.confirmada_em, f.rendimento;
$$;

/**
 * Custo do prato pelo item do cardápio.
 *
 * Atalho para quem TEM o módulo Cardápio Digital — a tela do cardápio mostra
 * o custo ao lado do preço. Quem não tem simplesmente não chama esta.
 */
create or replace function public.cmv_custo_do_item(p_item_id uuid)
returns numeric
language sql
stable
as $$
  select public.cmv_custo_da_ficha(f.id)
  from public.fichas_tecnicas f
  where f.item_id = p_item_id and f.ativa
  limit 1;
$$;

-- ============================================================
-- Compras
-- ============================================================

create table if not exists public.compras (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  local_id uuid not null references public.estoque_locais(id) on delete restrict,
  fornecedor text,
  documento text,
  data_compra date not null default current_date,
  valor_total numeric(12,2) not null default 0,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'recebida', 'cancelada')),
  -- Extração da nota por IA: o JSON cru, para conferir depois o que a IA leu
  -- contra o que a pessoa corrigiu. Sem isso não há como melhorar o prompt.
  extracao_ia jsonb,
  criado_por uuid,
  created_at timestamptz not null default now(),
  recebida_em timestamptz
);

create table if not exists public.compra_itens (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras(id) on delete cascade,
  insumo_id uuid references public.insumos(id) on delete restrict,
  -- O que estava escrito na nota, antes de casar com um insumo. Fica gravado
  -- mesmo depois do vínculo: é a memória de como aquele fornecedor escreve,
  -- e é o que faz o casamento da próxima nota ser automático.
  descricao_nota text,
  quantidade numeric(12,3) not null check (quantidade > 0),
  custo_unitario numeric(12,4) not null check (custo_unitario >= 0)
);

-- Como cada fornecedor escreve cada insumo. Aprendido uma vez, usado sempre.
create table if not exists public.insumo_apelidos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  apelido_normalizado text not null,
  origem text not null default 'nota' check (origem in ('nota', 'pdv', 'manual')),
  created_at timestamptz not null default now(),
  unique (venue_id, apelido_normalizado, origem)
);

comment on table public.insumo_apelidos is
  'Como fornecedor e PDV escrevem cada insumo. É o que faz a segunda nota do mesmo fornecedor casar sozinha.';

/**
 * Recebe a compra: lança as entradas e recalcula o custo médio. Tudo ou nada.
 *
 * O custo médio é PONDERADO pelo saldo existente. A conta ingênua (média
 * simples dos preços pagos) faz uma compra de 2 unidades a preço alto pesar
 * igual a uma de 200 a preço normal, e o valor do estoque descola do real.
 */
create or replace function public.cmv_receber_compra(p_compra_id uuid, p_usuario uuid default null)
returns void
language plpgsql
as $$
declare
  v_compra public.compras%rowtype;
  v_item record;
  v_saldo numeric;
  v_custo_atual numeric;
begin
  select * into v_compra from public.compras where id = p_compra_id for update;
  if not found then
    raise exception 'compra_nao_encontrada';
  end if;
  -- Idempotência: retentativa de rede não pode dobrar o estoque.
  if v_compra.status = 'recebida' then
    raise exception 'compra_ja_recebida';
  end if;
  if v_compra.status = 'cancelada' then
    raise exception 'compra_cancelada';
  end if;

  for v_item in
    select * from public.compra_itens where compra_id = p_compra_id and insumo_id is not null
  loop
    insert into public.estoque_movimentos
      (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario, origem_tipo, origem_id, criado_por)
    values
      (v_compra.venue_id, v_item.insumo_id, v_compra.local_id, v_item.quantidade,
       'compra', v_item.custo_unitario, 'compra', p_compra_id, p_usuario);

    -- Média ponderada: (saldo_antigo * custo_antigo + entrada * custo_novo)
    -- dividido pelo total. O saldo é lido DEPOIS do movimento, então o que
    -- entrou já está incluído — daí a subtração.
    select coalesce(sum(quantidade), 0) into v_saldo
      from public.estoque_movimentos where insumo_id = v_item.insumo_id;
    select custo_medio into v_custo_atual from public.insumos where id = v_item.insumo_id;

    update public.insumos
       set custo_medio = case
             when v_saldo <= 0 then v_item.custo_unitario
             else round(
               (greatest(v_saldo - v_item.quantidade, 0) * coalesce(v_custo_atual, 0)
                + v_item.quantidade * v_item.custo_unitario)
               / v_saldo, 4)
           end
     where id = v_item.insumo_id;
  end loop;

  update public.compras
     set status = 'recebida',
         recebida_em = now(),
         valor_total = coalesce((
           select sum(quantidade * custo_unitario) from public.compra_itens where compra_id = p_compra_id
         ), 0)
   where id = p_compra_id;
end;
$$;

-- ============================================================
-- Produção
-- ============================================================

create table if not exists public.producoes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  ficha_id uuid not null references public.fichas_tecnicas(id) on delete restrict,
  local_id uuid not null references public.estoque_locais(id) on delete restrict,
  -- Quantas vezes a receita foi feita.
  lotes numeric(12,3) not null check (lotes > 0),
  status text not null default 'concluida' check (status in ('concluida', 'cancelada')),
  criado_por uuid,
  created_at timestamptz not null default now()
);

/**
 * Registra a produção: baixa os insumos, numa transação só.
 *
 * No Gorjeta, baixar insumo pelo front em chamadas separadas gerou 33
 * "produções fantasma" — o INSERT falhava, o erro era engolido por try/catch,
 * e a tela dizia que deu certo. A correção custou um backfill de 89
 * movimentações e o ressync de 172 saldos.
 *
 * Aqui é uma função só: ou tudo entra, ou nada entra e o erro sobe.
 */
create or replace function public.cmv_registrar_producao(
  p_venue_id uuid,
  p_ficha_id uuid,
  p_local_id uuid,
  p_lotes numeric,
  p_usuario uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_producao_id uuid;
  v_ing record;
  v_confirmada timestamptz;
begin
  if p_lotes is null or p_lotes <= 0 then
    raise exception 'lotes_invalidos';
  end if;

  select confirmada_em into v_confirmada
    from public.fichas_tecnicas
   where id = p_ficha_id and venue_id = p_venue_id and ativa;
  if not found then
    raise exception 'ficha_nao_encontrada';
  end if;
  -- Produzir por uma ficha que a IA sugeriu e ninguém conferiu baixaria do
  -- estoque uma quantidade inventada.
  if v_confirmada is null then
    raise exception 'ficha_nao_confirmada';
  end if;

  insert into public.producoes (venue_id, ficha_id, local_id, lotes, criado_por)
  values (p_venue_id, p_ficha_id, p_local_id, p_lotes, p_usuario)
  returning id into v_producao_id;

  for v_ing in
    select fi.insumo_id, fi.quantidade, i.custo_medio
      from public.ficha_insumos fi
      join public.insumos i on i.id = fi.insumo_id
     where fi.ficha_id = p_ficha_id
  loop
    insert into public.estoque_movimentos
      (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario, origem_tipo, origem_id, criado_por)
    values
      (p_venue_id, v_ing.insumo_id, p_local_id, -(v_ing.quantidade * p_lotes),
       'producao_saida', v_ing.custo_medio, 'producao', v_producao_id, p_usuario);
  end loop;

  return v_producao_id;
end;
$$;

-- ============================================================
-- Contagem
-- ============================================================

create table if not exists public.contagens (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  local_id uuid not null references public.estoque_locais(id) on delete restrict,
  status text not null default 'aberta' check (status in ('aberta', 'processada', 'cancelada')),
  observacoes text,
  criado_por uuid,
  created_at timestamptz not null default now(),
  processada_em timestamptz
);

create table if not exists public.contagem_itens (
  id uuid primary key default gen_random_uuid(),
  contagem_id uuid not null references public.contagens(id) on delete cascade,
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  quantidade_contada numeric(12,3) not null check (quantidade_contada >= 0),
  -- O saldo do sistema no instante do processamento. Guardado para o
  -- histórico responder "quanto sumiu naquela contagem".
  saldo_sistema numeric(12,3),
  unique (contagem_id, insumo_id)
);

/**
 * Processa a contagem: o que foi contado VIRA o saldo.
 *
 * Sem tolerância, de propósito. No Gorjeta havia uma margem que "ignorava
 * diferenças pequenas", e ela deixava resíduo de ponto flutuante: a pessoa
 * contava 5, o sistema mostrava 4,99, e a confiança na tela ia junto. Foram
 * 58 resíduos para limpar.
 *
 * O ajuste é um movimento como qualquer outro — a diferença fica no razão,
 * visível, e não uma sobrescrita silenciosa do saldo.
 */
create or replace function public.cmv_processar_contagem(p_contagem_id uuid, p_usuario uuid default null)
returns integer
language plpgsql
as $$
declare
  v_contagem public.contagens%rowtype;
  v_item record;
  v_saldo numeric;
  v_diferenca numeric;
  v_ajustes integer := 0;
begin
  select * into v_contagem from public.contagens where id = p_contagem_id for update;
  if not found then
    raise exception 'contagem_nao_encontrada';
  end if;
  if v_contagem.status <> 'aberta' then
    raise exception 'contagem_ja_processada';
  end if;

  for v_item in
    select ci.*, i.custo_medio
      from public.contagem_itens ci
      join public.insumos i on i.id = ci.insumo_id
     where ci.contagem_id = p_contagem_id
  loop
    v_saldo := public.cmv_saldo(v_item.insumo_id, v_contagem.local_id);
    v_diferenca := v_item.quantidade_contada - v_saldo;

    update public.contagem_itens set saldo_sistema = v_saldo where id = v_item.id;

    if v_diferenca <> 0 then
      insert into public.estoque_movimentos
        (venue_id, insumo_id, local_id, quantidade, tipo, custo_unitario,
         origem_tipo, origem_id, observacao, criado_por)
      values
        (v_contagem.venue_id, v_item.insumo_id, v_contagem.local_id, v_diferenca,
         'ajuste_contagem', v_item.custo_medio, 'contagem', p_contagem_id,
         format('Contado %s, sistema %s', v_item.quantidade_contada, v_saldo), p_usuario);
      v_ajustes := v_ajustes + 1;
    end if;
  end loop;

  update public.contagens
     set status = 'processada', processada_em = now()
   where id = p_contagem_id;

  return v_ajustes;
end;
$$;

-- ============================================================
-- Valor do estoque e CMV
-- ============================================================

create table if not exists public.estoque_snapshots (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  data_referencia date not null,
  valor_total numeric(14,2) not null,
  criado_em timestamptz not null default now(),
  unique (venue_id, data_referencia)
);

comment on table public.estoque_snapshots is
  'Valor do estoque por dia. O CMV precisa do estoque inicial do período, e esse número não existe retroativamente — ou foi fotografado no dia, ou está perdido.';

-- ============================================================
-- Faturamento
-- ============================================================
-- O CMV que o dono olha é PERCENTUAL. "CMV de R$ 8.400" não diz nada; "CMV
-- de 32%" diz se a casa está saudável, e é o número que ele compara com o
-- mês passado e com o vizinho. Sem faturamento não há denominador, e o
-- módulo entrega meia resposta.
--
-- Tabela própria e não uma coluna em algum lugar porque a origem varia: hoje
-- o gerente digita o fechamento do dia; amanhã vem de arquivo do PDV; um dia
-- vem do próprio Cardápio Digital. Todas escrevem aqui, e o CMV não muda.

create table if not exists public.faturamento_diario (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  data_referencia date not null,
  -- Líquido, sem gorjeta e sem taxa de serviço. Incluir a gorjeta infla o
  -- denominador e faz o CMV parecer melhor do que é — o erro mais comum de
  -- quem calcula isso na planilha.
  valor numeric(14,2) not null check (valor >= 0),
  origem text not null default 'manual' check (origem in ('manual', 'pdv', 'cardapio')),
  observacao text,
  criado_por uuid,
  created_at timestamptz not null default now(),
  unique (venue_id, data_referencia)
);

comment on column public.faturamento_diario.valor is
  'Faturamento LÍQUIDO do dia, sem gorjeta nem taxa de serviço: incluí-las infla o denominador e faz o CMV parecer melhor do que é.';

create or replace function public.cmv_valor_do_estoque(p_venue_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(s.quantidade * i.custo_medio), 0)
  from public.estoque_saldos s
  join public.insumos i on i.id = s.insumo_id
  where s.venue_id = p_venue_id and s.quantidade > 0;
$$;

/**
 * CMV do período: (Estoque Inicial + Compras − Estoque Final) ÷ Faturamento.
 *
 * A fórmula contábil, e não "soma do que as fichas dizem que foi consumido".
 * A diferença entre as duas é justamente o que o dono precisa enxergar:
 * quebra, perda, desvio e ficha desatualizada. O consumo teórico é bom para
 * comparar; o CMV real é o que sai do caixa.
 *
 * O PERCENTUAL é o número que se olha. "CMV de R$ 8.400" não diz nada; "CMV
 * de 32%" diz se a casa está saudável e serve para comparar com o mês
 * passado. O valor absoluto vem junto porque é ele que se confere contra o
 * extrato quando o percentual assusta.
 *
 * Sem faturamento lançado no período, o percentual é NULL — não zero. Zero
 * seria "CMV de 0%", a melhor notícia possível, dada justamente a quem não
 * lançou o faturamento ainda.
 */
create or replace function public.cmv_do_periodo(
  p_venue_id uuid,
  p_inicio date,
  p_fim date
)
returns table (
  estoque_inicial numeric,
  compras numeric,
  estoque_final numeric,
  cmv numeric,
  faturamento numeric,
  cmv_percentual numeric
)
language sql
stable
as $$
  with inicial as (
    select coalesce((
      select valor_total from public.estoque_snapshots
      where venue_id = p_venue_id and data_referencia < p_inicio
      order by data_referencia desc limit 1
    ), 0) as valor
  ),
  final as (
    select coalesce((
      select valor_total from public.estoque_snapshots
      where venue_id = p_venue_id and data_referencia <= p_fim
      order by data_referencia desc limit 1
    ), public.cmv_valor_do_estoque(p_venue_id)) as valor
  ),
  compradas as (
    select coalesce(sum(m.quantidade * m.custo_unitario), 0) as valor
    from public.estoque_movimentos m
    where m.venue_id = p_venue_id
      and m.tipo = 'compra'
      and m.criado_em >= p_inicio
      and m.criado_em < (p_fim + 1)
  ),
  faturado as (
    select sum(valor) as valor
    from public.faturamento_diario
    where venue_id = p_venue_id
      and data_referencia between p_inicio and p_fim
  )
  select
    i.valor,
    c.valor,
    f.valor,
    i.valor + c.valor - f.valor,
    coalesce(fat.valor, 0),
    case
      when coalesce(fat.valor, 0) > 0
        then round((i.valor + c.valor - f.valor) / fat.valor * 100, 2)
      else null
    end
  from inicial i, compradas c, final f, faturado fat;
$$;

-- ============================================================
-- Acesso
-- ============================================================
-- RLS ligado sem policies, como nas demais tabelas do Brasa Food: quem lê e
-- escreve é o backend com service_role, que já confere a organização em cada
-- rota.

alter table public.estoque_locais    enable row level security;
alter table public.insumos           enable row level security;
alter table public.estoque_movimentos enable row level security;
alter table public.estoque_saldos    enable row level security;
alter table public.fichas_tecnicas   enable row level security;
alter table public.ficha_insumos     enable row level security;
alter table public.compras           enable row level security;
alter table public.compra_itens      enable row level security;
alter table public.insumo_apelidos   enable row level security;
alter table public.producoes         enable row level security;
alter table public.contagens         enable row level security;
alter table public.contagem_itens    enable row level security;
alter table public.estoque_snapshots enable row level security;
alter table public.faturamento_diario enable row level security;

notify pgrst, 'reload schema';
