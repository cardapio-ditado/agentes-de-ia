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
| Schema completo no Supabase (16 tabelas, RLS, triggers, índices) | ✅ aplicado |
| Runtime do agente: histórico, ferramentas, telemetria de tokens | ✅ |
| Ferramentas de domínio (programação, informações, reserva) | ✅ |
| Módulo de aprovação de reservas + trilha de auditoria | ✅ (CLI) |
| Seed com estabelecimento e agente de exemplo | ✅ |
| API HTTP (`/runs`, `/agents`), streaming SSE, UI web | ⬜ próximo passo |
| Auth, API keys, billing, embeddings, editor visual | ⬜ backlog do PRD |

O que existe hoje é o **núcleo**: o modelo de dados e o motor de execução do agente.
As camadas de API e UI descritas no PRD se apoiam nele sem precisar remexer no schema.

---

## Como rodar

```bash
npm install
cp .env.example .env      # preencha ANTHROPIC_API_KEY e SUPABASE_SERVICE_ROLE_KEY
npm run seed              # cria org, estabelecimento e o agente recepcionista
npm run chat -- --agent recepcionista --venue ditado-popular
```

Fila de aprovação:

```bash
npm run aprovar -- --venue ditado-popular              # lista pendentes
npm run aprovar -- --aprovar <protocolo>
npm run aprovar -- --recusar <protocolo> --motivo "casa lotada nesse horário"
```

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
  agent.ts            loop de execução: modelo → ferramentas → persistência
  repository.ts       agentes, conversas, mensagens, eventos
  venues.ts           estabelecimentos, programação, reservas, aprovação
  supabase.ts         cliente service_role (nunca no navegador)
  config.ts           validação das variáveis de ambiente
  cli.ts              chat de teste
  database.types.ts   tipos gerados do schema
  tools/              ferramentas do agente
scripts/
  seed.ts             dados de exemplo
  aprovar.ts          módulo de aprovação
supabase/migrations/  SQL versionado
```

---

## Próximos passos sugeridos

1. **API HTTP** — `POST /runs` com streaming SSE, autenticação por `api_keys`
2. **Tela de aprovação** — a lógica já está em `src/venues.ts`; falta a UI
3. **Notificação ao cliente** — disparar WhatsApp na aprovação/recusa (o `webhooks` já existe)
4. **Canal WhatsApp** — webhook de entrada chamando `runAgent` com `channel: "whatsapp"`
5. **Painel de uso** — `messages` já grava tokens e latência por execução
