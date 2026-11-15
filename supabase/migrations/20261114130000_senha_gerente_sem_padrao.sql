-- A senha do gerente do cardápio antigo não tem mais valor padrão.
--
-- `conferir_senha_gerente` e `escalar_mesas` são do cardápio que rodava como
-- site separado, e podem ser chamadas sem login pela API do banco. Enquanto a
-- casa não definia a senha, valia "gerente" — ou seja, qualquer pessoa trocava
-- o garçom das mesas de qualquer casa que nunca tivesse mexido nisso.
--
-- Não revogo as funções aqui: o site antigo pode ainda estar em uso em algum
-- QR code impresso, e revogar o derrubaria. Tirar o padrão fecha o buraco sem
-- quebrar ninguém: casa com senha definida continua igual; casa sem senha
-- deixa de aceitar "gerente".
create or replace function public.conferir_senha_gerente(p_venue_id uuid, p_senha text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_esperada text;
begin
  select value into v_esperada
    from cardapio_settings
   where venue_id = p_venue_id and key = 'senha_gerente';
  if v_esperada is null or btrim(v_esperada) = '' then
    return false;
  end if;
  return btrim(coalesce(p_senha, '')) = btrim(v_esperada);
end; $$;
