# Agentes de IA — bares e restaurantes

Plataforma de agentes de IA (Agent-as-a-Service) adaptada para bares e restaurantes.
O agente atende o cliente por mensagem, responde sobre a programação da casa e coleta
pedidos de reserva — que **não** são confirmados na hora: entram numa fila de aprovação
humana.

Stack: **Node + TypeScript**, **Claude** (`claude-opus-5`) e **Supabase** (Postgres).

---

## O que já está implementado

| Módulo | Estado |
|---|---|
| Schema completo no Supabase (15 tabelas, RLS, triggers, índices) | ✅ aplicado |
| Runtime do agente: histórico, ferramentas, telemetria de tokens | ✅ |
| Ferramentas de domínio (programação, informações, reserva) | ✅ |
| Módulo de aprovação de reservas + trilha de auditoria | ✅ |
| API HTTP com autenticação por chave e streaming SSE | ✅ |
| Painel web: fila de aprovação, programação e chat de teste | ✅ |
| Notificação ao cliente (WhatsApp) + webhooks assinados | ✅ |
| Billing, embeddings/vector DB, editor visual de fluxo, SSO | ⬜ backlog do PRD |

---

## Como rodar

```bash
npm install
cp .env.example .env      # preencha ANTHROPIC_API_KEY e SUPABASE_SERVICE_ROLE_KEY
npm run seed              # cria org, estabelecimento e o agente recepcionista
npm run criar-chave       # gera a chave de API (aparece uma única vez)
npm run dev               # sobe API + painel em http://localhost:3000
```

Abra `http://localhost:3000`, cole a chave e o painel carrega.

Sem interface, pela linha de comando:

```bash
npm run chat -- --agent recepcionista --venue ditado-popular

npm run aprovar -- --venue ditado-popular              # lista pendentes
npm run aprovar -- --aprovar <protocolo>
npm run aprovar -- --recusar <protocolo> --motivo "casa lotada nesse horário"
```

---

## API

Toda rota sob `/v1` exige `Authorization: Bearer <chave>`. Respostas seguem
`{ success, data }` ou `{ success: false, error: { code, message } }`, e cada
requisição devolve um `x-trace-id` para correlacionar com o log.

| Rota | Escopo | O que faz |
|---|---|---|
| `POST /v1/runs` | `runs:write` | Executa o agente. Com `?stream=true` (ou `Accept: text/event-stream`) devolve SSE |
| `GET /v1/agents` | `runs:write` | Agentes da organização |
| `GET /v1/venues` | `reservations:read` | Estabelecimentos |
| `GET /v1/venues/:slug/reservations` | `reservations:read` | Fila de aprovação |
| `POST /v1/reservations/:id/approve` | `reservations:write` | Aprova |
| `POST /v1/reservations/:id/reject` | `reservations:write` | Recusa (exige `motivo`) |
| `GET \| POST /v1/venues/:slug/events` | leitura \| escrita | Programação |
| `DELETE /v1/events/:id?venue=<slug>` | `reservations:write` | Remove item |
| `GET /v1/venues/:slug/info` | `reservations:read` | Base de conhecimento |
| `GET /health` | público | Health check |

Eventos do stream: `text_delta`, `tool_use`, `tool_result`, `done`, `error`.

```bash
curl -N http://localhost:3000/v1/runs?stream=true \
  -H "Authorization: Bearer sk_ditado_..." \
  -H "content-type: application/json" \
  -d '{"agent":"recepcionista","venue":"ditado-popular","input":"tem show sexta?"}'
```

Chaves de API são guardadas **apenas como SHA-256** — a chave crua aparece uma
única vez, na criação. Todo acesso é escopado pela organização da chave: pedir
uma reserva de outra organização devolve `404`, não `403`, para não revelar
que ela existe.

---

## Fluxo da reserva

```
cliente  →  agente  →  registrar_reserva  →  reservations (status: pending)
                                                    │
                                          módulo de aprovação
                                                    │
                                   approved ────────┴──────── rejected
                                          (toda transição vira
                                       reservation_status_history)
```

O agente **nunca confirma** uma reserva. Ele registra, devolve um protocolo e diz ao
cliente que a confirmação vem depois. Isso está no prompt e é reforçado na descrição da
ferramenta — as duas camadas, porque só o prompt não segura.

Validações antes de gravar (configuráveis em `venues.settings`):

- `max_party_size` — grupos maiores vão para atendimento humano
- `min_advance_minutes` — antecedência mínima
- `max_advance_days` — janela máxima de agendamento

---

## Notificação ao cliente

Aprovar ou recusar dispara a mensagem para o cliente. A notificação é **gravada
antes de sair**, então uma falha do provedor não some com a mensagem — ela fica
como `failed` e pode ser reenviada:

```bash
npm run reenviar-notificacoes    # ideal em cron, a cada poucos minutos
```

O painel e a linha de comando dizem se o cliente foi realmente avisado. Aprovação
e aviso são etapas separadas de propósito: **a decisão nunca é desfeita porque a
mensagem falhou.**

**Canal.** Com `WHATSAPP_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` no `.env`, envia pela
WhatsApp Cloud API. Sem eles, cai no canal `console`: grava no banco e imprime no
log, em vez de sumir silenciosamente.

> ⚠️ A Meta só aceita mensagem livre dentro de **24h** desde a última mensagem do
> cliente. Fora dessa janela é preciso um template aprovado — ainda não
> implementado. Aprovações demoradas vão falhar por esse motivo e ficar
> registradas para contato manual.

### Webhooks

Eventos publicados: `reservation.created`, `reservation.approved`,
`reservation.rejected`. Cada entrega é assinada:

```
x-webhook-signature: t=<timestamp>,v1=<hmac-sha256 de "timestamp.corpo">
```

O timestamp entra no conteúdo assinado para que uma entrega capturada não possa
ser reenviada depois. Retentativas: até 5, com backoff exponencial (1s, 2s, 4s,
8s). **`4xx` não é repetido** — erro de payload ou configuração não melhora
sozinho. Tudo fica em `webhook_deliveries`.

---

## Schema

**Plataforma**
`organizations`, `org_members` (RBAC), `api_keys` (só o hash da chave),
`webhooks`, `webhook_deliveries`

**Agentes**
`agents` (prompt, modelo, effort, ferramentas), `conversations`, `messages`
(com tokens, latência e `stop_reason`), `tool_calls` (auditoria), `agent_events` (log)

**Domínio**
`venues` (o estabelecimento), `venue_events` (programação: música, jogos, promoções),
`venue_info` (base de conhecimento), `reservations`, `reservation_status_history`

### Segurança do banco

RLS está **habilitado em todas as tabelas, sem nenhuma policy permissiva**. Efeito
prático: as chaves `anon`/publishable não leem nem escrevem nada. Todo acesso passa
pelo backend com a `service_role`, que ignora RLS.

Quando existir front-end com login de usuário, o caminho é criar policies baseadas em
`org_members` — não afrouxar o padrão atual.

Migrações versionadas em `supabase/migrations/`. Após qualquer mudança:

```bash
npx supabase gen types typescript --project-id tittvjdrtuzsresheore > src/database.types.ts
```

---

## Ferramentas do agente

| Ferramenta | Para quê |
|---|---|
| `hora_atual` | Data/hora e offset UTC do estabelecimento. Obrigatória antes de interpretar "amanhã" ou registrar reserva |
| `informacoes_do_restaurante` | Endereço, horários, capacidade, base de conhecimento |
| `consultar_programacao` | Shows, jogos, promoções — com filtro por tipo e janela em dias |
| `registrar_reserva` | Grava o pedido como `pending` e devolve o protocolo |
| `consultar_reserva` | Situação da reserva pelo protocolo |

As descrições dizem **quando** chamar cada uma, não só o que fazem — é o que mais
influencia o modelo a acionar a ferramenta certa na hora certa.

Para adicionar uma ferramenta: implemente `AgentTool` em `src/tools/`, registre em
`src/tools/index.ts` e habilite no `config.tools` do agente. Uma ferramenta só existe
para o agente se estiver listada lá — habilitar é sempre explícito.

Datas usam ISO 8601 **com offset** (`2026-08-15T20:00:00-04:00`). Sem offset a
ferramenta recusa, em vez de gravar silenciosamente no fuso errado.

---

## Estrutura

```
src/
  server.ts             API HTTP + painel estático (zero dependências)
  agent.ts              loop de execução: modelo → ferramentas → persistência
  apikeys.ts            criação e validação de chaves (só o hash é guardado)
  reservationFlow.ts    decidir reserva: grava, avisa o cliente, publica evento
  notifications.ts      templates, provedores e fila de mensagens
  webhooks.ts           entrega assinada com retentativa
  repository.ts         agentes, conversas, mensagens, eventos
  venues.ts             estabelecimentos, programação, reservas, aprovação
  supabase.ts           cliente service_role (nunca no navegador)
  config.ts             validação das variáveis de ambiente
  cli.ts                chat de teste
  database.types.ts     tipos gerados do schema
  tools/                ferramentas do agente
public/                 painel web (HTML/CSS/JS, sem build step)
scripts/
  seed.ts               dados de exemplo
  aprovar.ts            aprovação pela linha de comando
  criar-chave.ts        gera chave de API
  reenviar-notificacoes.ts
supabase/migrations/    SQL versionado
```

Testes com o runner nativo do Node (`node:test`), sem framework:

```bash
npm test
```

O painel é JS puro de propósito: nada de build step para uma tela operacional de
três abas. Quando a interface crescer para o que o PRD descreve — designer visual
de agentes, métricas, replays — aí sim vale trocar por React.

---

## Próximos passos sugeridos

1. **Canal WhatsApp de entrada** — webhook da Meta chamando `runAgent` com
   `channel: "whatsapp"`. Fecha o ciclo: hoje o agente responde, mas só por API
2. **Templates aprovados da Meta** — para avisar fora da janela de 24h
3. **Reenvio automático de webhooks** — entregas com `delivered_at` nulo ainda
   não são reprocessadas por nenhum worker
4. **Rate limiting por chave** — os headers `X-RateLimit-*` do PRD ainda não são emitidos
5. **Painel de uso** — `messages` já grava tokens, latência e custo por execução
6. **Login de usuário** — hoje o painel autentica por chave de API; com Supabase Auth
   dá para usar `org_members` e criar policies de RLS por usuário
