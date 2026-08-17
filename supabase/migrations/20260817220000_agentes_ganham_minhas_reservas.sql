-- Dá a ferramenta minhas_reservas aos agentes que têm lista fixa de ferramentas.
--
-- Agente sem o campo `tools` recebe o conjunto padrão em tempo de execução e
-- não precisa de nada aqui. Já quem tem lista explícita é respeitado à risca
-- pelo código — o que é proposital, mas significa que uma ferramenta nova
-- nunca chega até ele. Sem isso o agente continua sem conseguir consultar as
-- reservas do cliente, e volta a responder pelo histórico da conversa, onde
-- uma reserva vencida segue escrita como se fosse futura.
--
-- Sem slug fixo de propósito: vale para todo agente de todo cliente, agora e
-- em qualquer banco onde esta migração rodar.
update agents
   set config = jsonb_set(
         config,
         '{tools}',
         (config -> 'tools') || '["minhas_reservas"]'::jsonb
       )
 where jsonb_typeof(config -> 'tools') = 'array'
   and not (config -> 'tools' @> '["minhas_reservas"]'::jsonb);

-- O PostgREST guarda o formato das tabelas em cache; sem isto ele pode
-- continuar respondendo com o desenho antigo.
notify pgrst, 'reload schema';
