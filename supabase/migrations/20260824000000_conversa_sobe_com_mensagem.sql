-- A conversa sobe na caixa de entrada quando chega mensagem.
--
-- `conversations` tem `updated_at` mantido por trigger, mas o trigger é
-- BEFORE UPDATE ON conversations: ele só dispara quando a própria linha da
-- conversa muda. Inserir em `messages` não a tocava.
--
-- Efeito: cliente que conversou terça e volta sexta continuava com a conversa
-- na posição de terça — enterrada sob quem falou depois. A inbox ordena por
-- `updated_at` e estava certa; o dado é que estava velho. Quem atende via a
-- mensagem nova só se rolasse a lista até achar, o que na prática significa
-- não ver.
--
-- Regra no banco e não no código: toda mensagem toca a conversa, tenha vindo
-- do WhatsApp, do Instagram, do painel ou da CLI. Um `update` espalhado por
-- quatro caminhos é um caminho novo esquecendo de chamá-lo.

create or replace function public.conversa_sobe_com_mensagem()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
     set updated_at = greatest(updated_at, new.created_at)
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_sobem_a_conversa on public.messages;
create trigger messages_sobem_a_conversa
  after insert on public.messages
  for each row execute function public.conversa_sobe_com_mensagem();

-- Conserta o que já está torto: conversas cuja última mensagem é mais nova
-- que o `updated_at` gravado. Sem isto, quem voltou a falar antes desta
-- migração continuaria enterrado até mandar a próxima mensagem.
update public.conversations c
   set updated_at = m.ultima
  from (
    select conversation_id, max(created_at) as ultima
      from public.messages
     group by conversation_id
  ) m
 where m.conversation_id = c.id
   and m.ultima > c.updated_at;

notify pgrst, 'reload schema';
