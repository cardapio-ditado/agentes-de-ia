# Reservas pelo site da casa

A casa pode ter o próprio formulário de reserva, no próprio site e no próprio
banco. Este documento é o contrato para esse sistema **avisar a Brasa Food** a
cada pré-reserva, de modo que ela entre na mesma fila das reservas anotadas
pelo atendente virtual: quem analisa recebe o aviso no WhatsApp, o cliente
recebe a confirmação quando a casa aprova, e o lembrete sai antes do horário.

Nada é enviado enquanto a casa não gerar a chave no painel
(**Reservas → Reservas pelo site da casa → Ajustar → Gerar chave**).

## Chamada

```
POST https://brasafood.app/v1/integracoes/reservas/<slug-da-casa>
Content-Type: application/json
x-brasa-segredo: <chave gerada no painel>
```

- A chave aparece **uma vez**, na hora em que é gerada. A Brasa Food guarda só
  o resumo dela (SHA-256). Quem perde gera outra; a anterior para de valer.
- Guarde a chave como segredo do lado de quem chama (cofre do banco, variável
  de ambiente). Ela não deve aparecer em código, em log nem em conversa.
- Limite: 60 chamadas por minuto por origem e 240 por minuto por casa.
- Corpo de até 20 KB.

## Corpo

| Campo        | Obrigatório       | Formato                                              |
| ------------ | ----------------- | ---------------------------------------------------- |
| `evento`     | não               | `criada` (padrão), `confirmada` ou `cancelada`       |
| `id`         | sim               | identificador do registro no sistema de origem (texto ou número, até 120 caracteres) |
| `nome`       | só em `criada`    | 2 a 120 letras                                       |
| `telefone`   | só em `criada`    | com DDD — `(65) 99999-9999` ou só os dígitos         |
| `dia`        | só em `criada`    | `AAAA-MM-DD`                                         |
| `horario`    | só em `criada`    | `HH:MM` (aceita `HH:MM:SS`), **no horário da casa**  |
| `pessoas`    | só em `criada`    | inteiro de 1 a 500                                   |
| `ambiente`   | não               | até 80 letras; "sem preferência" é ignorado          |
| `observacao` | não               | até 500 letras                                       |

Exemplo:

```json
{
  "evento": "criada",
  "id": "9f1c2d3e-0000-4000-8000-000000000000",
  "nome": "Mariana Costa",
  "telefone": "(65) 99812-3344",
  "dia": "2026-11-28",
  "horario": "20:00",
  "pessoas": 8,
  "ambiente": "varanda",
  "observacao": "Aniversário, vai levar bolo"
}
```

## Os três eventos

- **`criada`** — cria a reserva como *para aprovar* e avisa quem analisa
  (o número cadastrado em "Avisos automáticos"). O cliente **não** recebe
  mensagem neste momento: o formulário já disse a ele que é uma pré-reserva.
- **`confirmada`** — para quando a equipe confirma **no sistema de origem**.
  Aprova a reserva aqui e manda a confirmação ao cliente pelo WhatsApp.
  Só precisa de `id`.
- **`cancelada`** — cancela a reserva aqui, para o lembrete não sair para quem
  não vem. Não manda mensagem ao cliente. Só precisa de `id`.

Repetir o mesmo aviso não repete o efeito: o `id` identifica a reserva.

## Resposta

| Código | Quando                                                      |
| ------ | ----------------------------------------------------------- |
| 201    | reserva criada                                              |
| 200    | qualquer outro resultado aceito (ver `situacao`)            |
| 400    | corpo inválido — `error.message` diz qual campo             |
| 403    | chave ausente, errada ou casa sem chave gerada              |
| 429    | chamadas demais em um minuto                                |

```json
{ "situacao": "criada", "reservation_id": "…", "status": "pending" }
```

`situacao` é uma de: `criada`, `ja_existia`, `confirmada`, `ja_confirmada`,
`cancelada`, `ja_cancelada`, `desconhecida` (nenhuma reserva chegou com esse
`id`) ou `nao_cabe` (a reserva está num estado que não aceita o evento; vem com
`detalhe`).

## O caminho de volta: evitar reserva em dobro

A Brasa Food já avisa os sistemas da casa quando uma reserva é aprovada
(webhook de saída `reservation.approved`). O corpo desse aviso agora traz:

- `source_channel: "link"` — a reserva nasceu no formulário do site;
- `external_id` — o mesmo `id` que o formulário mandou em `criada`
  (nulo nas reservas que nasceram na Brasa Food).

Quem recebe esse aviso deve, quando `external_id` vier preenchido,
**atualizar o registro que já tem** (marcar a pré-reserva como confirmada) em
vez de criar outro. Sem esse cuidado, toda reserva do site aprovada pela Brasa
Food apareceria duas vezes no sistema de origem.

O mesmo vale quando a confirmação partiu do sistema de origem (evento
`confirmada`): o aviso de saída volta com o `external_id`, e deve ser tratado
como "já está confirmada".

## Onde isso mora no código

- `src/reservasDoLink.ts` — leitura do pedido, chave, e a aplicação do aviso.
- `src/app.ts` — `POST /v1/integracoes/reservas/:slug` (a porta) e
  `/v1/venues/:slug/reservas-link` (painel: situação, gerar e revogar chave).
- `public/js/pages/reservas.js` — o cartão "Reservas pelo site da casa".
