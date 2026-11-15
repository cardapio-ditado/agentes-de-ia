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

## Tokens

- **Marca:** `--carvao-900 #1a1a1a`, `--carvao-800 #242424`, `--terracota-600 #b94f2b`, `--terracota-700 #9c4122`, `--ambar-500 #e8a03c`, `--musgo-700 #46543d`.
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
| Tabela de dados | `tabelaDeDados({ colunas, linhas, grupos, rodape, estreita, larguraMinima })` | `<table>` real; vira ficha no celular; grupos que abrem e fecham |
| Campo de busca | `campoDeBusca({ rotulo, placeholder, valor, aoMudar, espera })` | lupa, limpar e rótulo acessível |
| Ação em ícone | `acaoIcone({ iconePath, rotulo, aoClicar, variante })` | `aria-label` + dica; variantes `principal`, `perigo` |
| Botão com ícone | `comIcone(iconePath, texto)` | conteúdo de um `.btn` |
| Etiqueta de situação | `etiqueta(texto, variante)` | ponto/visto + texto; nunca só a cor |
| Vazio | `vazio(titulo, detalhe, acao)` | diz o que falta e oferece o próximo passo |
| Erro | `estadoDeErro(titulo, detalhe, aoTentar)` | com "Tentar novamente" |
| Carregando | `esqueleto({ cartoes, linhas })` | ocupa o lugar do que vem |
| Ações da tela | `ctx.definirAcoes(...botoes)` | ações principais no cabeçalho, ao lado do título |

Classes de apoio: `.btn`, `.btn-primario`, `.btn-peq`, `.abas`/`.aba`, `.abas-com-acoes`, `.chip`, `.barra-filtros`, `.cartao`, `.painel-analise`.

## Regras

1. Uma ação principal por tela (terracota). As demais são neutras.
2. Cor é semântica: âmbar pede atenção, vermelho é problema, verde é concluído.
3. Dado inventado não entra. Gráfico só com base completa (ver `comprasAnalise.js`).
4. Todo botão de ícone tem nome acessível; foco sempre visível.
5. Valor à direita, data em DD/MM/AAAA, traço para o que não existe.

## Ordem sugerida para os outros módulos

1. Estoque, Contagem, Produção e Vendas (mesmo módulo do piloto, mesmas tabelas).
2. Itens e fornecedores; Receitas e custo do prato.
3. Financeiro (já usa a tabela e os indicadores; falta o Painel e o Fluxo).
4. RH e Checklist.
5. Clientes, Cardápio, Atendente e Ajustes.
