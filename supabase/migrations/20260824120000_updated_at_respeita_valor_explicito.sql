-- `set_updated_at` passa a respeitar o valor que o UPDATE já trouxe.
--
-- O gatilho carimbava `now()` em TODO update, sem exceção. Isso está certo
-- para o caso comum — alguém edita a linha e o campo se atualiza sozinho —
-- mas atropela quem grava uma data de propósito:
--
--   * o gatilho que sobe a conversa quando chega mensagem pedia
--     greatest(updated_at, new.created_at) e recebia now() no lugar. Passa
--     despercebido com mensagem nova (now() ≈ agora), mas importar histórico
--     antigo jogaria a conversa para o topo;
--   * o conserto das conversas atrasadas gravou a data da última mensagem de
--     cada uma e todas saíram com o MESMO instante — o do próprio UPDATE.
--     Cinco conversas empatadas em 19:51:34, e a ordem entre elas virou
--     arbitrária: exatamente o sintoma que a correção deveria eliminar.
--
-- Agora: se o UPDATE não mexeu em `updated_at`, o gatilho carimba `now()`
-- como sempre. Se mexeu, o valor escrito vale. É o comportamento esperado de
-- um "toque automático" — automático até alguém dizer o contrário.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- `is not distinct from` e não `=`: com NULL de um lado, `=` devolve NULL,
  -- o `if` não entra, e o campo ficaria sem carimbo nenhum.
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

-- Refaz o conserto, agora que ele não é mais atropelado: cada conversa recebe
-- a data da sua última mensagem, e a caixa de entrada volta a ter ordem de
-- verdade em vez de um bloco de empates.
update public.conversations c
   set updated_at = m.ultima
  from (
    select conversation_id, max(created_at) as ultima
      from public.messages
     group by conversation_id
  ) m
 where m.conversation_id = c.id
   and m.ultima <> c.updated_at;

notify pgrst, 'reload schema';
