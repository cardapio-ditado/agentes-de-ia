# O que o Gorjeta Pro tem que vale trazer para o Brasa Food — estoque

Leitura do repositório `cardapio-ditado/gorjetapro2` (Gestão Ditado), feita
em 24/10/2026, comparada com o módulo CMV do Brasa Food. O Gorjeta é o
sistema interno do Ditado, construído no Bolt, com React e Supabase; o que
interessa não é o código (outra stack, acoplado a uma casa só), são as
REGRAS de operação que o Ditado aprendeu na prática.

## O que o Brasa já tem (não duplicar)

Locais de estoque, insumos e categorias, compras com pedido e recebimento
(com divergência), leitura de nota por IA, fichas técnicas, fornecedores,
transferência, perda, contagem com ajuste, conciliação de saldos, kardex,
posição, sugestão de compra por consumo (`cmv_sugestao_compra`, com
previsão por dia da semana e ciclo do fornecedor), snapshots diários,
painel de CMV, importação de vendas de qualquer PDV por arquivo ou foto
(IA), casamento de produto com ficha ou insumo, apelidos, baixa pela
função do banco, teórico versus real, avisos no WhatsApp (aumento de
preço, divergência de contagem, estoque baixo).

A régua de saldo do Gorjeta (saldo só por movimento, trigger, uma função
canônica) é a mesma do Brasa — essa lição já estava incorporada.

## O que vale trazer, por ordem

1. **Vendas da Zig entram sozinhas, todo dia.** FEITO (`src/cmv/vendasZig.ts`).
   O Gorjeta sincroniza a Zig às 06:00 e baixa o estoque. No Brasa, a
   partir das 6h da casa, o servidor importa a noite de ontem pela API
   (`saida-produtos`), casa com o vocabulário da casa e baixa sozinho
   quando não sobra nada para decidir. O que não casou espera na tela de
   Vendas. O faturamento do dia vai junto (só produtos; couvert, entrada
   e gorjeta ficam de fora e registrados).

2. **Setores com nível de reposição ("Repor os setores").** Cada setor
   (bar, cozinha) tem, por item, um nível ideal; a lista do dia é
   nível − saldo do setor, já descontadas as vendas da Zig. O estoquista
   ajusta e manda; a transferência Central → setor sai num toque.
   Funções do Gorjeta: `fn_reposicao_balcao_calcular`, `_gerar`,
   `fn_balcao_detectar_baixa` (o item do setor baixa por venda direta,
   por ficha, ou só por contagem). No Brasa: tabela `estoque_niveis`
   (local, insumo, nível, controle), tela "Repor" no CMV, transferência
   em lote. É a maior ganho operacional para um bar.

3. **Pedido e retirada do setor, com conferência.** O setor pede ao
   Central (o estoquista entrega o que tem); fora de hora, registra a
   retirada e OUTRA pessoa confere de manhã. Link público por QR para a
   equipe pedir sem login (`REQUISICAO_PUBLICA_ESTOQUE.md`). No Brasa:
   `estoque_requisicoes` (pedido/retirada, itens, quem, conferido_por),
   rota pública `/requisicao/<token>`, e o agente administrativo avisa o
   estoquista no WhatsApp.

4. **Contagem por blocos e por zona, com agenda.** Em vez de uma contagem
   geral que ninguém termina, o Central é contado por categoria (zona),
   uma por dia, com ciclo; o setor conta a lista diária. Funções
   `fn_contagem_bloco_*`, `fn_contagem_agenda_*`. No Brasa: `contagens`
   ganham `bloco` e a agenda; a tela mostra "zonas vencidas hoje".

5. **Contagem pelo WhatsApp (agente de estoque).** A pessoa manda "contei
   12 long neck e 3 kg de picanha no bar" e o agente anota na contagem
   aberta, com permissão por papel e estoques do setor
   (`fn_agente_contagem`, `agente_permissoes`). No Brasa isso é uma
   ferramenta do agente administrativo, reusando o conector.

6. **Saldo negativo com alerta e auditoria.** O Gorjeta permite saldo
   negativo (a venda não pode travar porque a contagem atrasou) e marca o
   item para regularizar na próxima contagem aprovada. Conferir no Brasa
   se a baixa trava em saldo zero; se trava, adotar a mesma regra.

7. **Hoje (painel do estoquista).** Uma tela com cartões clicáveis: repor
   setores, pedidos a entregar, notas para receber, contagens do dia,
   diferenças a aprovar, Zig de hoje, saldos negativos, Central abaixo do
   ponto. No Brasa, vira a primeira tela do CMV.

8. **Empréstimos com vizinhos** (pegamos / emprestamos, devolução,
   quem deve a quem) e **kits** (kit de limpeza, kit de evento, com
   checagem do que falta). Pequenos, úteis, baixa prioridade.

## O que NÃO vale trazer

- A conferência de recebimento com IA por foto: o Brasa já lê a nota por
  IA e aponta divergência contra o pedido.
- O mapeamento assistido de vendas por Excel: o Brasa casa por apelido e
  por IA no próprio relatório.
- Qualquer coisa do financeiro, RH, músicos, clube: fora do escopo do
  estoque, e o Brasa tem o seu próprio desenho.

## Lições do Gorjeta a respeitar

- Saldo nunca é escrito pelo front; só por movimento. (Já é assim.)
- Dia operacional vira às 05:00; a madrugada é da noite anterior. (A
  importação da Zig usa o `eventDate`; sem ele, recua 5 horas.)
- Contagem é verdade absoluta: sem tolerância, sem resíduo de ponto
  flutuante.
- Itens duplicados por grafia são o bug mais comum: índice único por nome
  normalizado antes de abrir para outras casas.
