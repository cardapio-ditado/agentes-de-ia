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
| Módulo de aprovação de reservas + trilha de auditoria | ✅ |
| API HTTP com autenticação por chave e streaming SSE | ✅ |
| Painel web: fila de aprovação, programação e chat de teste | ✅ |
| Notificação ao cliente + webhooks assinados | ✅ |
| Canal WhatsApp de entrada e saída (Baileys, não oficial) | ✅ |
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
| `GET /v1/agents` | `runs:write` | Agentes habilitados (`?all=1` inclui os pausados) |
| `POST /v1/agents` | `runs:write` | Cria um agente |
| `GET /v1/agents/:slug` | `runs:write` | Detalhe, incluindo o system prompt |
| `PATCH /v1/agents/:slug` | `runs:write` | Edita nome, prompt, modelo, esforço, ativo. O slug não muda |
| `GET /v1/venues` | `reservations:read` | Estabelecimentos |
| `GET /v1/venues/:slug/reservations` | `reservations:read` | Fila de aprovação |
| `POST /v1/reservations/:id/approve` | `reservations:write` | Aprova |
| `POST /v1/reservations/:id/reject` | `reservations:write` | Recusa (exige `motivo`) |
| `GET \| POST /v1/venues/:slug/events` | leitura \| escrita | Programação |
| `DELETE /v1/events/:id?venue=<slug>` | `reservations:write` | Remove item |
| `GET /v1/venues/:slug/info` | `reservations:read` | Base de conhecimento |
| `GET /v1/venues/:slug/conversations` | `reservations:read` | Caixa de entrada. Filtros: `?canal=`, `?status=`, `?humanas=1` |
| `GET /v1/venues/:slug/metrics` | `reservations:read` | Números do painel |
| `GET /v1/conversations/:id` | `reservations:read` | Conversa com o histórico |
| `POST /v1/conversations/:id/takeover` | `reservations:write` | Assume o atendimento (`{"devolver":true}` devolve ao agente) |
| `POST /v1/conversations/:id/messages` | `reservations:write` | Resposta escrita por uma pessoa |
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

**Canal**, nesta ordem: Baileys conectado → Cloud API da Meta → `console`
(grava no banco e imprime no log, em vez de sumir silenciosamente).

> ⚠️ Na **Cloud API**, a Meta só aceita mensagem livre dentro de 24h desde a
> última mensagem do cliente; fora disso exige template aprovado, ainda não
> implementado. O Baileys não tem essa restrição.

---

## WhatsApp (Baileys)

O agente atende pelo WhatsApp do restaurante: cliente manda mensagem, o agente
responde, coleta a reserva e envia para aprovação. As confirmações saem pelo
mesmo número.

```bash
npm run whatsapp -- --agent recepcionista --venue ditado-popular
```

Ou pelo painel, aba **WhatsApp** → Conectar → leia o QR com o celular da casa
(Aparelhos conectados → Conectar aparelho). A sessão fica em `.whatsapp/`
(fora do git) e reconecta sozinha depois de quedas.

> ⚠️ **Baileys não é oficial.** Usa o protocolo do WhatsApp Web, fora dos termos
> de uso da Meta, e o número pode ser banido. **Use um chip separado do número
> principal da casa** — um ban derruba o canal de atendimento inteiro. A
> alternativa oficial é a Cloud API, com aprovação da Meta e a janela de 24h.

O conector ignora grupos, status e mensagens anteriores à conexão — sem esse
corte, ao parear o agente responderia conversas de dias atrás como se fossem
novas. Mensagens que não são texto recebem um pedido para escrever.

A pasta `.whatsapp/` contém **credenciais do número pareado**: quem a copia
assume a sessão. Trate como segredo.

---

## Webhooks

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

## Deploy

O projeto tem duas metades com necessidades diferentes de infraestrutura.

| Parte | Onde roda | Por quê |
|---|---|---|
| Painel + API | **Vercel** | Estático no CDN, API como função serverless |
| Conector WhatsApp | **Host sempre ligado** | Railway, Render, Fly.io ou VPS |
| Banco | **Supabase** | Já é externo |

### Por que o WhatsApp não vai para a Vercel

O Baileys mantém um WebSocket aberto com o WhatsApp e grava a sessão em disco.
Funções serverless são efêmeras, sem estado e morrem em segundos — não é questão
de configuração, é incompatível por natureza. Rode `npm run whatsapp` num host
que fica ligado, com volume persistente para `.whatsapp/`.

### Vercel

`api/index.ts` é o ponto de entrada; `vercel.json` manda `/v1/*` e `/health`
para lá, e o CDN serve `public/`.

`vercel.json` fixa `"framework": null` de propósito. Sem isso a Vercel detecta
sozinha um preset de Node.js, elege `src/app.ts` como entrada da aplicação e
ignora `api/`. Como `src/app.ts` é um módulo de roteamento — exporta
`criarHandler`, não um handler pronto — a função sobe sem `export default`
válido e todas as rotas respondem `FUNCTION_INVOCATION_FAILED`. Com `null` o
projeto usa o preset "Other", que é o modelo que este repositório assume:
`public/` no CDN e `api/index.ts` como única função.

Variáveis a configurar no projeto:

```
ANTHROPIC_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

O mesmo roteamento (`src/app.ts`) serve os dois destinos: `src/server.ts` monta
um servidor Node de verdade para local, VPS e container.

> ⚠️ **`SUPABASE_SERVICE_ROLE_KEY` ignora RLS.** Configure só como variável de
> ambiente do servidor. Nunca em variável exposta ao navegador.

**Uma diferença de comportamento em serverless:** a função congela assim que a
resposta sai, então trabalho disparado sem `await` não termina. O código detecta
`VERCEL` e passa a aguardar a entrega dos webhooks; num servidor comum ele não
espera, para quem aprovou não ficar preso a um sistema de terceiros.

### Host do conector WhatsApp

```bash
npm run build
npm run whatsapp -- --agent recepcionista --venue ditado-popular
```

Precisa das mesmas variáveis, mais um volume persistente em `.whatsapp/` — sem
ele, cada reinício exige parear o QR de novo.

---

## Schema

**Plataforma**
`organizations`, `org_members` (RBAC), `api_keys` (só o hash da chave),
`webhooks`, `webhook_deliveries`, `notifications`

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
  app.ts                roteamento da API (compartilhado)
  server.ts             servidor Node: local, VPS, container
  agent.ts              loop de execução: modelo → ferramentas → persistência
  apikeys.ts            criação e validação de chaves (só o hash é guardado)
  reservationFlow.ts    decidir reserva: grava, avisa o cliente, publica evento
  notifications.ts      templates, provedores e fila de mensagens
  webhooks.ts           entrega assinada com retentativa
  repository.ts         agentes, conversas, mensagens, eventos
  inbox.ts              caixa de entrada, atendimento humano e números do painel
  venues.ts             estabelecimentos, programação, reservas, aprovação
  supabase.ts           cliente service_role (nunca no navegador)
  config.ts             validação das variáveis de ambiente
  cli.ts                chat de teste
  channels/whatsapp.ts  conector Baileys: pareamento, atendimento e envio
  database.types.ts     tipos gerados do schema
  tools/                ferramentas do agente
api/index.ts            ponto de entrada da Vercel
public/
  index.html            casca do painel: barra lateral e cabeçalho
  styles.css            tokens de tema (claro/escuro) e componentes
  js/app.js             roteamento por hash, estado e navegação
  js/api.js             cliente HTTP e leitura do SSE
  js/ui.js              helpers de elemento, ícones e formatação
  js/pages/             uma tela por arquivo
scripts/
  seed.ts               dados de exemplo
  aprovar.ts            aprovação pela linha de comando
  criar-chave.ts        gera chave de API
  whatsapp.ts           sobe o conector sozinho
  reenviar-notificacoes.ts
supabase/migrations/    SQL versionado
```

Testes com o runner nativo do Node (`node:test`), sem framework:

```bash
npm test
```

O painel é JS puro de propósito: módulos ES nativos, sem bundler e sem build
step. Cada tela é uma função `(raiz, ctx)` que desenha dentro do `<main>`; o
roteador troca de tela pelo hash da URL. Todo texto vindo do banco entra por
`textContent`, nunca por `innerHTML` — nome de cliente e mensagem de WhatsApp
são dados de fora e não podem injetar marcação.

Quando chegar a hora do designer visual de agentes e dos replays de conversa,
aí sim vale trocar por React.

---

## Próximos passos sugeridos

1. **Múltiplos números** — hoje o conector Baileys é um por processo; uma rede
   com várias casas precisa de uma sessão por estabelecimento
2. **Templates aprovados da Meta** — só importa se migrar para a Cloud API
3. **Reenvio automático de webhooks** — entregas com `delivered_at` nulo ainda
   não são reprocessadas por nenhum worker
4. **Rate limiting por chave** — os headers `X-RateLimit-*` do PRD ainda não são emitidos
5. **Painel de uso** — `messages` já grava tokens, latência e custo por execução
6. **Login de usuário** — hoje o painel autentica por chave de API; com Supabase Auth
   dá para usar `org_members` e criar policies de RLS por usuário
