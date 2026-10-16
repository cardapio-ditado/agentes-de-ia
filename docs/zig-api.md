# API da Zig (Zigcore) — o que sabemos

Compilado da documentação que o Ditado recebeu da Zig e do que a API
respondeu de verdade. **Somente leitura (GET).** Não há POST: não dá para
lançar pedido, abrir comanda nem mexer no ZigCard por aqui.

## Conexão

| Item | Valor |
|---|---|
| Base | `https://api.zigcore.com.br/integration` |
| Autenticação | header `authorization: {token}` — **sem** "Bearer" |
| Token e loja | por casa, na tabela `pesquisa_zig` (nunca em arquivo nem em chat) |
| Datas | `YYYY-MM-DD` |
| Valores | inteiros em **centavos** |
| Horários | `YYYY-MM-DDTHH:MM:SS.mmm`, **em UTC**, sem o "Z" |

## Ao vivo: confirmado em 06/10/2026

Com a casa aberta (evento começado às 17:29 de Cuiabá), consultando às
23:31, a API devolveu o dia de hoje **antes de o evento fechar**:

- `saida-produtos`: a venda mais nova tinha **44 segundos**.
- `checkins`: o checkout mais novo tinha 1 minuto e meio; 23 dos 50 da
  primeira página ainda sem `checkoutTime`.
- `compradores`: 116 transações de 35 pessoas, com `date` e `isPaid`.

Ou seja: dá para mostrar quem está na casa e o que está consumindo, com
atraso de segundos. A sondagem fica em `npm run zig:agora` (no servidor).

## Endpoints

### `GET /erp/events?loja=&dtinicio=&dtfim=`
`id`, `name`, `beginAt`, `peopleCapacity`. Aceita qualquer janela; é o que
`testarZig` usa para validar token e loja.

### `GET /erp/saida-produtos?dtinicio=&dtfim=&loja=`
Cada item vendido. Campos: `transactionId`, `transactionDate`, `productId`,
`productSku`, `productName`, `productCategory`, `unitValue`, `count`,
`fractionalAmount?`, `fractionUnit?`, `discountValue`, `employeeName`
(garçom que lançou), `type` (`Normal | Couvert | ZigCard | Entrance | Tip`),
`eventId`, `eventDate`, `invoiceId?`, `additions[]`.

Usos: baixa de estoque, venda por garçom, consumo ao vivo, receita por
tipo (couvert, entrada, gorjeta).

### `GET /erp/compradores?dtinicio=&dtfim=&loja=`
Uma linha por transação: `transactionId`, `date`, `userDocument`,
`userDocumentType`, `userPhone`, `userName`, `userEmail?`, `userBirthdate`,
`userGender`, `productsValue`, `tipValue`, `terminal`, `isPaid`,
`paymentType`, `chipNfc`.

**Janela máxima de 5 dias por chamada** (blocos de 3 são o seguro).
Liga a pessoa à venda por `transactionId` com `saida-produtos`.

### `GET /erp/checkins?desde=&dtfim=&loja=&page=`
Paginado, 50 por página; o início é **`desde`** (não `dtinicio`).
Campos: `id`, `checkinTime`, `checkoutTime?`, `name`, `phone`, `document`,
`documentType`, `birthDate`, `isForeign`, `lastTransactionId`,
`lastTransactionTime`.

Quem tem `checkinTime` e não tem `checkoutTime` ainda está na casa;
`lastTransactionTime` diz se ainda está consumindo.

### `GET /erp/gorjeta?dtinicio=&dtfim=&loja=`
`transactionId`, `value`.

### `GET /erp/faturamento?dtinicio=&dtfim=&loja=`
Bruto por forma de pagamento, por evento: `paymentId`, `paymentName`,
`value`, `eventId`, `eventDate`.

### `GET /erp/faturamento/detalhesMaquinaIntegrada?dtinicio=&dtfim=&loja=`
Bruto por bandeira (`values[]: cardBrand, totalValue`). Sem taxa, sem
líquido: não bate com o extrato bancário.

### `GET /erp/invoice?dtinicio=&dtfim=&loja=&page=`
Notas fiscais, paginado: `mode` (`nfce | nfse | sat | ivaVendus`),
`isCanceled`, `xml`, `canceledXml?`.

### `GET /erp/recharges?dtinicio=&dtfim=&loja=`
Recargas de cartão: `date`, `author`, `totalValue`, dados da pessoa.

### `GET /erp/lojas?rede=`
`id`, `name`.

## Limites

1. Só leitura.
2. Sem valor líquido (taxas de cartão não aparecem).
3. `compradores`: 5 dias por chamada.
4. `invoice` e `checkins`: paginados.
