-- LIMITE DE RITMO QUE VALE ENTRE INSTÂNCIAS.
--
-- O limite das rotas públicas morava só na memória do processo. Na Vercel
-- cada instância tem a sua memória e elas nascem e morrem o tempo todo: o
-- "20 por dez minutos" virava "20 por instância", e quem tenta senha em
-- série nunca enche balde nenhum. Login, vaga, foto do checklist, documento
-- da ficha (que chama a IA) e o webhook do Mercado Pago nem limite tinham.
--
-- Aqui o balde é uma linha no banco: (chave, janela) → quantas batidas.
-- Janela fixa, de propósito — é uma linha por chave, um upsert por chamada,
-- e nada para varrer na leitura. O preço é conhecido: na virada da janela
-- cabem até duas cotas seguidas. Para o que isto protege (força bruta,
-- enxurrada), o dobro por um instante não muda nada.
--
-- A chave chega do servidor JÁ EMBARALHADA (SHA-256): nem IP nem e-mail de
-- ninguém ficam gravados aqui.
--
-- O servidor funciona SEM esta migração: enquanto a função não existe, ele
-- cai no limite em memória de antes (ver src/limiteDeRitmo.ts).

create table if not exists public.limite_de_ritmo (
  chave text not null,
  -- O começo da janela (o relógio arredondado para baixo no tamanho dela).
  janela timestamptz not null,
  batidas integer not null default 1,
  -- Quando a linha deixa de servir e pode ser varrida.
  expira_em timestamptz not null,
  primary key (chave, janela)
);

alter table public.limite_de_ritmo enable row level security;

comment on table public.limite_de_ritmo is
  'Baldes do limite de ritmo das rotas públicas: uma linha por (chave embaralhada, janela). Só o servidor (service_role) escreve, pela função limite_de_ritmo_bater.';

create index if not exists limite_de_ritmo_expira on public.limite_de_ritmo (expira_em);

-- Bate uma vez no balde e diz se ainda cabe. Atômica: o upsert soma e devolve
-- o total numa instrução só, então duas instâncias batendo juntas nunca leem
-- o mesmo número.
create or replace function public.limite_de_ritmo_bater(p_chave text, p_maximo integer, p_janela_segundos integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_tamanho integer := greatest(1, coalesce(p_janela_segundos, 60));
  v_janela timestamptz := to_timestamp(floor(extract(epoch from now()) / v_tamanho) * v_tamanho);
  v_batidas integer;
begin
  if p_chave is null or p_chave = '' then
    raise exception 'limite_de_ritmo_bater: chave vazia';
  end if;

  insert into public.limite_de_ritmo (chave, janela, batidas, expira_em)
  values (p_chave, v_janela, 1, v_janela + make_interval(secs => v_tamanho))
  on conflict (chave, janela)
  do update set batidas = public.limite_de_ritmo.batidas + 1
  returning batidas into v_batidas;

  -- A tabela não pode crescer para sempre. Limpeza de passagem: uma batida
  -- em cada cem varre o que já venceu (com folga de uma hora, para nunca
  -- brigar com uma janela ainda em uso).
  if random() < 0.01 then
    delete from public.limite_de_ritmo where expira_em < now() - interval '1 hour';
  end if;

  return v_batidas <= greatest(1, coalesce(p_maximo, 1));
end;
$$;

comment on function public.limite_de_ritmo_bater(text, integer, integer) is
  'Soma uma batida no balde (chave, janela atual) e devolve true se ainda está dentro do máximo.';

-- Só o servidor (service_role) chama: o navegador nunca fala com o banco.
revoke all on function public.limite_de_ritmo_bater(text, integer, integer) from public, anon, authenticated;
grant execute on function public.limite_de_ritmo_bater(text, integer, integer) to service_role;
revoke all on table public.limite_de_ritmo from anon, authenticated;
-- No Supabase o service_role já recebe isto por padrão; fica escrito para não
-- depender do padrão.
grant all on table public.limite_de_ritmo to service_role;

notify pgrst, 'reload schema';
