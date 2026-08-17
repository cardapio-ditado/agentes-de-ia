-- ============================================================
-- Brasa Food — aplicar e conferir o módulo de pontos
--
-- Cole ISTO INTEIRO no SQL Editor do Supabase e rode uma vez.
-- É seguro rodar de novo: nada aqui apaga dado nem falha na segunda vez.
--
-- No fim ele imprime três conferências. Se as três vierem como esperado,
-- o medidor de pontos está pronto e o painel vai mostrar o saldo real.
-- ============================================================

-- ---------- 1. Estrutura ----------
alter table public.venues
  add column if not exists plano text not null default 'profissional',
  add column if not exists pontos_mensais integer not null default 2500,
  add column if not exists ciclo_dia smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'venues_plano_valido') then
    alter table public.venues add constraint venues_plano_valido
      check (plano in ('essencial', 'profissional', 'casa_cheia', 'cortesia'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'venues_pontos_positivos') then
    alter table public.venues add constraint venues_pontos_positivos
      check (pontos_mensais >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'venues_ciclo_dia_valido') then
    alter table public.venues add constraint venues_ciclo_dia_valido
      check (ciclo_dia between 1 and 28);
  end if;
end $$;

create index if not exists messages_conversa_papel_data_idx
  on public.messages (conversation_id, role, created_at desc)
  where role = 'assistant';

-- ---------- 2. Plano dos estabelecimentos existentes ----------
-- Sem `where slug = '...'`: chutar o identificador é como este arquivo falhou
-- em silêncio na primeira vez — o slug real era "ditado-popular", o update
-- casou com zero linhas e ninguém percebeu, porque UPDATE de 0 linhas não é
-- erro. Só toca em quem ainda está no padrão, então repetir não desfaz plano
-- que já foi ajustado à mão.
update public.venues
   set plano = 'profissional', pontos_mensais = 2500, ciclo_dia = 1
 where plano = 'profissional' and pontos_mensais = 2500 and ciclo_dia = 1;

-- ---------- 3. Recarregar o cache do PostgREST ----------
-- Sem isto a API jura que as colunas novas não existem ("erro interno").
notify pgrst, 'reload schema';

-- ============================================================
-- CONFERÊNCIA A — a estrutura ficou de pé?
-- Esperado: 3 linhas (ciclo_dia, plano, pontos_mensais).
-- ============================================================
select 'A. colunas' as conferencia, column_name, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'venues'
   and column_name in ('plano', 'pontos_mensais', 'ciclo_dia')
 order by column_name;

-- ============================================================
-- CONFERÊNCIA B — o plano foi gravado?
-- Esperado: 1 linha com Ditado Popular / profissional / 2500 / 1.
-- ============================================================
-- O slug aparece aqui de propósito: foi exatamente o que faltava saber
-- quando o script original assumiu "ditado" e o real era "ditado-popular".
select 'B. plano' as conferencia, name, slug, plano, pontos_mensais, ciclo_dia
  from public.venues
 order by name;

-- ============================================================
-- CONFERÊNCIA C — o consumo real do ciclo corrente.
--
-- Esta é a MESMA conta que o painel faz. Se o número aqui e o número do
-- cartão "Pontos do plano" divergirem, o problema está no código, não no
-- banco — e é isso que a conferência serve para separar.
-- ============================================================
with ciclo as (
  select v.id,
         -- O `at time zone` no fim não é enfeite: date_trunc devolve um
         -- horário SEM fuso, e o Postgres o compararia como se fosse UTC.
         -- Em Cuiabá (UTC-4) isso puxaria para dentro do ciclo as quatro
         -- últimas horas do mês anterior — erro que só aparece na virada,
         -- justamente quando ninguém está olhando.
         (
           date_trunc('month', (now() at time zone v.timezone))
             + ((v.ciclo_dia - 1) || ' days')::interval
             - case when extract(day from (now() at time zone v.timezone)) < v.ciclo_dia
                    then interval '1 month' else interval '0' end
         ) at time zone v.timezone as inicio,
         v.pontos_mensais,
         v.slug
    from public.venues v
),
consumo as (
  select k.slug as estabelecimento,
         case when m.model like 'claude-opus%'   then 'Opus'
              when m.model like 'claude-sonnet%' then 'Sonnet'
              when m.model like 'claude-haiku%'  then 'Haiku'
              else coalesce(m.model, 'desconhecido') end as motor,
         count(*) as respostas,
         count(*) * case when m.model like 'claude-opus%'   then 5
                         when m.model like 'claude-sonnet%' then 3
                         when m.model like 'claude-haiku%'  then 1
                         else 3 end as pontos
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join ciclo k on k.id = c.venue_id
   where m.role = 'assistant'
     and m.created_at >= k.inicio
   group by 1, 2, m.model
)
select 'C. consumo' as conferencia,
       estabelecimento,
       motor,
       respostas,
       pontos,
       (select max(pontos_mensais) from ciclo) as total_do_plano,
       (select max(pontos_mensais) from ciclo) - sum(pontos) over (partition by estabelecimento) as restantes
  from consumo
 order by pontos desc;
