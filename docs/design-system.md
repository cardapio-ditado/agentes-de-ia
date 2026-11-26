# Brasa Food — Design System 2.0

Padrão visual do painel (`public/app.html`). Tela piloto: **Compras e recebimento**.
O hub (colmeia) e a tela de acesso mantêm a identidade própria e não usam estas regras.

## Onde está

| O quê | Arquivo |
|---|---|
| Tokens e componentes (CSS) | `public/styles.css`, bloco "BRASA FOOD — DESIGN SYSTEM 2.0" no fim do arquivo |
| Componentes (JS) | `public/js/ui.js` |
| Casca: barra lateral, topo, cabeçalho da tela | `public/app.html` e `public/js/app.js` |
| Tela piloto | `public/js/pages/compras.js`, `public/js/pages/comprasAnalise.js` |

O painel é JavaScript puro com módulos ES e CSS com variáveis. Não há React nem biblioteca de componentes: nada foi instalado.

## Kit de marca (fonte das cores)

Gerado com a skill `brandkit` (plugin87/ux-ui-agent-skills): três camadas, em OKLCH, claro e escuro.

| Camada | Onde | O que é |
|---|---|---|
| Primitiva | `design/tokens/colors.json` → `primitive` e variáveis `--terracota-50…950`, `--neutro-…`, `--musgo-…`, `--ambar-…`, `--verde-…`, `--vermelho-…` | As rampas (11 tons por família). Tela nunca usa direto. |
| Papel | `semantic` (e `dark`) → `--fundo`, `--superficie`, `--texto`, `--borda`, `--borda-controle`, `--cta`, `--marca`, `--ok`, `--alerta`, `--perigo`… | O que as telas usam. |
| Componente | `component` e as seções do CSS | Só enxergam papéis. |

O bloco `brandkit` no fim de `public/styles.css` é a versão em CSS do mesmo arquivo. `src/designTokens.test.ts` roda em `npm test` e falha se:
- algum par de texto e fundo ficar abaixo da WCAG 2.2 AA (4,5:1 para texto, 3:1 para borda de campo), no claro ou no escuro;
- um valor mudar no JSON sem mudar no CSS, ou o contrário.

Para trocar uma cor: mude o tom na rampa ou o papel em `colors.json`, repita no bloco `brandkit` e rode `npm test`.

## Tokens

- **Marca:** terracota (`--terracota-500 #b64f25` é a ação principal), neutro quente, musgo, âmbar, verde e vermelho — ver o kit acima.
- **Papéis:** `--fundo`, `--superficie`, `--superficie-2`, `--borda`, `--borda-forte`, `--texto`, `--texto-2`, `--texto-3`, `--marca`, `--cta`, `--foco`, e os pares `--ok/-suave`, `--alerta/-suave`, `--perigo/-suave`, `--info/-suave`. Componente usa o papel, nunca a cor crua.
- **Tipografia:** Inter. `--texto-titulo 24px` (26 no título da tela), `--texto-secao 17px`, `--texto-indicador 28px`, `--texto-corpo 14px`, `--texto-tabela 13.5px`, `--texto-rotulo 12.5px`, `--texto-apoio 12px`. Números de tabela e indicador com `tabular-nums`.
- **Espaço (escala de 4):** `--esp-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 20 · `-6` 24 · `-8` 32 · `-10` 40.
- **Forma:** `--raio-p 6px`, `--raio 8px`, `--raio-g 10px`, `--raio-modal 12px`; `--altura-controle 38px`, `--altura-nav 40px`, `--altura-linha 54px`.
- **Elevação:** borda primeiro; `--sombra` só no que flutua (aviso, dica).
- **Movimento:** `--mov-rapido 140ms`, `--mov-lateral 200ms`; tudo desliga com `prefers-reduced-motion`.

## Temas

`data-tema="escuro"` (padrão, o desenho de referência: carvão quente e terracota) e `data-tema="claro"` (barra lateral escura, área de trabalho clara). A troca é o botão **Tema**; a escolha fica em `localStorage` na chave `brasa.tema.v2`. O escuro tem superfícies, textos, bordas e etiquetas próprios, não é o claro invertido.

## Componentes (`public/js/ui.js`)

| Componente | Função | Uso |
|---|---|---|
| Indicador | `indicador({ rotulo, valor, nota, iconePath, tom, cor })` | `tom` = situação (`alerta`, `perigo`); `cor` = tom do cartão (`areia`, `musgo`, `marca`, `pinho`) |
| Tabela de dados | `tabelaDeDados({ colunas, linhas, grupos, rodape, estreita, larguraMinima })` | `<table>` real; vira ficha no celular; grupos que abrem e fecham; coluna com `ordem: { ativa, desc, aoClicar }` ganha título que ordena (`aria-sort`) |
| Navegador de período | `navegadorDePeriodo({ titulo, detalhe, aoVoltar, aoAvancar, rotuloAtual, aoIrParaAtual })` | semana ou mês com setas e "Esta semana"; fica numa `.barra-periodo` |
| Nome com iniciais | `comSigla(nome, detalhe)` | célula principal de pessoa ou fornecedor (as iniciais somem em tela estreita) |
| Plural | `plural(n, um, varios)` | "1 dia", "30 dias" — nada de "dia(s)" na tela |
| Campo de busca | `campoDeBusca({ rotulo, placeholder, valor, aoMudar, espera })` | lupa, limpar e rótulo acessível |
| Ação em ícone | `acaoIcone({ iconePath, rotulo, aoClicar, variante })` | `aria-label` + dica; variantes `principal`, `perigo` |
| Botão com ícone | `comIcone(iconePath, texto)` | conteúdo de um `.btn` |
| Voltar de etapa | `botaoVoltar(aoClicar)` | detalhe, formulário e conferência; fica à esquerda do título |
| Etiqueta de situação | `etiqueta(texto, variante)` | ponto/visto + texto; nunca só a cor |
| Vazio | `vazio(titulo, detalhe, acao)` | diz o que falta e oferece o próximo passo |
| Erro | `estadoDeErro(titulo, detalhe, aoTentar)` | com "Tentar novamente" |
| Faixa de aviso | `faixaDeAviso({ tom, titulo, detalhe, acao })` | o que a pessoa precisa saber antes do resto da tela (caixa negativo, por exemplo) |
| Carregando | `esqueleto({ cartoes, linhas })` | ocupa o lugar do que vem |
| Ações da tela | `ctx.definirAcoes(...botoes)` | ações principais no cabeçalho, ao lado do título |

Classes de apoio: `.btn`, `.btn-primario`, `.btn-peq`, `.abas`/`.aba`, `.abas-com-acoes`, `.chip`, `.barra-filtros`, `.barra-periodo`, `.seletor-de-visao` (duas ou três visões do mesmo dado, com `aria-pressed`), `.cel-etiquetas`, `.regra-em-linha`, `.cartao`, `.painel-analise`.

Aviso em cartão (`.cartao.alerta`, `.cartao.linha-perigo`): fio de cor à esquerda e véu de 7%, nunca bloco de fundo carregado. Cores de gráfico de situação (férias) saem dos tokens `--ferias-*`, que apontam para as rampas do kit.

## Acabamento

Seção 10 do bloco de CSS. Vem de "Details that make interfaces feel better" (Jakub Krehel) e do vocabulário visual do shadcn/ui, escritos em CSS puro:

- **Contorno em sombra** (`--contorno`, `--contorno-hover`, `--contorno-controle`) no lugar de borda sólida em cartão, tabela, botão e campo. Borda sólida fica para o que é estrutura: divisor de linha, seleção, foco.
- **Raio concêntrico**: cartão em 14 px, o que mora dentro em 8–10 px; botão dentro de campo em 6 px.
- **Rótulo em caixa normal**: grupo do menu, cabeçalho de tabela e módulo acima do título sem caixa alta espaçada.
- **Resposta ao toque**: `scale: 0.96` ao pressionar botão; transições de 120–150 ms, sempre com a propriedade declarada (nunca `transition: all`).
- **Número tabular** em indicador, tabela e total.
- **Etiqueta de situação** em tinta suave com ponto (ou visto, quando concluído), nunca bloco cheio.
- **Ação de linha** sem moldura até a linha ganhar atenção; alvo de 40 px.
- **Sem animação de entrada** a cada troca de tela.

## Dados da tela de Compras

`GET /v1/venues/:slug/compras/resumo?hoje=AAAA-MM-DD&mes=AAAA-MM` (`src/cmv/comprasResumo.ts`) devolve os indicadores e as séries dos gráficos contados no período inteiro. A lista (`/compras`) tem teto de 60 registros e serve só à tabela. Se o resumo não responder, a tela conta pela lista e só mostra os gráficos quando o teto não corta o período.

## Regras

1. Uma ação principal por tela (terracota). As demais são neutras.
2. Cor é semântica: âmbar pede atenção, vermelho é problema, verde é concluído.
3. Dado inventado não entra. Gráfico só com base completa (ver `comprasAnalise.js`).
4. Todo botão de ícone tem nome acessível; foco sempre visível.
5. Valor à direita, data em DD/MM/AAAA, traço para o que não existe.

## Ordem sugerida para os outros módulos

1. ~~Estoque, Contagem, Produção e Vendas~~ (feito).
2. ~~Itens e fornecedores; Receitas e custo do prato~~ (feito: visão principal). Etapas internas do módulo usam `botaoVoltar()`, `acaoIcone()` e limpam as ações do cabeçalho ao entrar; os formulários ainda têm a estrutura antiga.
3. ~~Financeiro~~ (feito: Painel, Fluxo de caixa agrupado por semana, Contas a pagar e a receber, Cadastros).
4. ~~RH e Checklist~~ (feito: Equipe, Escala, Férias, Gorjeta, Treinamentos, Indicadores, Contratação, Modelos de checklist e Checklists feitos). Em telas com abas, cada aba põe as próprias ações no cabeçalho e a troca de aba limpa as anteriores. Ainda com a estrutura antiga: a ficha da pessoa, os formulários (admissão, lançar venda, regras da gorjeta, lançar férias, editor de checklist e de treinamento) e as visões "Prazos" e "Alertas" das férias.
5. ~~Clientes, Cardápio, Atendente e Ajustes~~ (feito: base de clientes, pesquisa, respostas, avaliações do Google, cardápio, painel, conversas, reservas, programação, jogos, atendentes virtuais, implantação, pessoas e acessos, integrações e estabelecimentos). Avaliações do Google deixou de ser uma página só: são quatro abas (fila, histórico, responder à mão, tom). Ainda com a estrutura antiga: os formulários e editores (ficha do cliente, novo disparo, parabéns, item do cardápio, banner, promoção, editor do atendente, "O que ele sabe", "A casa"), as telas de WhatsApp e Instagram e os Ajustes da pesquisa (só ganharam abas acessíveis e estados de carregando e erro), e o módulo Delivery, que não entrou nesta rodada.

## Formulários

O padrão vale para qualquer formulário, de qualquer módulo:

- **Largura de leitura:** no máximo 960 px. Campo não estica pela tela.
- **Grade de duas colunas:** cada campo solto ocupa uma coluna; título, linha de campos, texto longo e ações ocupam a linha inteira. No celular, uma coluna.
- **Campo:** rótulo em cima (13 px), controle de 40 px de altura, ajuda embaixo (12,5 px). Use `campoDeFormulario(rotulo, controle, { ajuda, obrigatorio, tamanho })`, que liga o rótulo ao controle (`for`/`id`) e a ajuda ao campo (`aria-describedby`).
- **Caixa de marcar:** `caixaDeMarcar(controle, titulo, descricao)` — caixa à esquerda, título e explicação à direita.
- **Ações:** `acoesDoFormulario(principal, ...outras)` no pé, com fio acima; a ação principal tem sempre 40 px.
- **Como um cartão vira formulário:** com a classe `formulario` (`cartao formulario`), ou sozinho, quando é uma etapa interna com `botaoVoltar()` e só tem campos. Etapa com tabela, lista ou gráfico (um detalhe, uma conferência) continua larga.
- **Nome acessível garantido:** o painel roda `ligarRotulos()` a cada mudança da tela (ver `app.js`): rótulo solto é ligado ao controle dele, e campo só com texto de exemplo ganha esse texto como nome. Tela nova não precisa lembrar.
- **Ícone no lugar de emoji:** botão antigo de lixeira usa `html: SVG_LIXEIRA`; botão novo usa `acaoIcone()`.

Ainda fora do padrão, de propósito: os campos pequenos dentro de linhas de tabela e as telas de WhatsApp e Instagram, que são painéis de conexão e não formulários de cadastro.

## Cuidados ao converter uma tela

- Estado e funções que o primeiro desenho usa ficam declarados ANTES do primeiro `await` (ou como `function`), senão a tela abre em branco.
- Ao trocar um bloco inteiro por outro, confira as funções removidas no `git diff`: é fácil levar junto uma vizinha que não era do bloco.
- O lint do projeto não acusa nome indefinido nos arquivos do painel; o que acusa é abrir a tela e clicar. Toda tela convertida passa por foto e clique antes de publicar.

## Menu único

A lateral é a mesma em todas as telas (`montarNavUnico` em `public/js/app.js`):

- **Hoje** em cima, com o número do que pede atenção.
- **Uma seção por módulo**, com o nome dele e na ordem da colmeia
  (`secoesDoMenu`), uma aberta por vez. Dentro, as telas do módulo como
  sempre foram: as do dia a dia primeiro, depois "Análise" e "Configurar" —
  cada cadastro no seu módulo. Módulo de uma tela só é uma linha direta.
- **Ajustes da casa** por último, como seção.
- **Busca** no topo (Ctrl+K), que acha telas e abas pelo nome ou pela
  explicação, palavra por palavra e sem depender de acento.
- **No celular**, a barra de baixo é Hoje, as duas telas mais usadas da casa e
  "Mais", que abre o menu inteiro.

Os números do menu vêm das pendências da tela Hoje (`ctx.definirPendencias`).
Seção fechada mostra a soma do que tem dentro.

O menu por módulo continua existindo: "Menu antigo", no rodapé da lateral,
troca na hora, e a escolha fica guardada no navegador (`brasa.menu`). A mesa
da equipe Brasa Food (módulo `plataforma`) usa sempre o menu por módulo.

## Visual novo

Seções 21 a 23 de `public/styles.css`, valendo onde a raiz tem
`data-visual="novo"` — hoje, o sistema inteiro, incluindo o login e a colmeia
(`aplicarVisual` em `public/js/app.js` liga ao abrir a página).

- **Cores:** fundo areia (`#f4ece0`), cartão quase branco (`#fffbf5`), texto
  marrom (`#2b1e16`). Terracota-laranja (`#c8491a`) só no que pede ação; verde
  (`#1f6b40` / `#2e6b4e`) só para "está funcionando" e para a fala do atendente.
- **Fontes:** Bricolage Grotesque nos títulos, Figtree no texto.
- **Formas:** cartão com canto de 20 px, botão e busca em pílula, campo com
  12 px. Elevação é sombra OU borda, nunca as duas.
- **Vidro** só no menu lateral e na barra de baixo do celular, que flutuam.
- **Fora:** etiqueta em cima do título, barra colorida na lateral de cartão,
  cor de fundo diferente em cada cartão de número.
- **Claro é o padrão**; o botão Tema troca para o escuro e guarda a escolha em
  `brasa.tema.novo`. No escuro, o login e a colmeia voltam à foto do braseiro.
- **Nada de barra colorida na lateral** (seção 23): o que pede atenção ganha
  o fundo tingido inteiro.
