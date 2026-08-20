# Rodar o agente no computador do bar (Windows)

O conector do WhatsApp precisa de um processo que fique ligado — por isso ele
não roda na Vercel. Para testes, qualquer PC ligado serve. Este guia deixa tudo
funcionando com um duplo clique.

> ⚠️ **Use um chip separado.** O Baileys é um cliente não oficial (protocolo do
> WhatsApp Web, fora dos termos da Meta) e o número pode ser banido. Nunca
> pareie o número principal da casa.

## Instalação (uma vez só)

**1. Node.js** — baixe a versão **LTS** em <https://nodejs.org> e instale
   (avançar, avançar, concluir).

**2. Git** — baixe em <https://git-scm.com/download/win> e instale com as
   opções padrão.

**3. Baixar o projeto** — abra o **Prompt de Comando** (menu Iniciar → digite
   `cmd`) e rode:

```
cd %USERPROFILE%\Documents
git clone https://github.com/cardapio-ditado/agentes-de-ia.git
```

Vai pedir login do GitHub no navegador na primeira vez (necessário quando o
repositório for privado).

**4. Criar o `.env`** — na pasta `Documents\agentes-de-ia`, copie o arquivo
`.env.example`, renomeie a cópia para `.env` (só isso, sem outra extensão) e
abra no Bloco de Notas. Preencha três linhas:

```
ANTHROPIC_API_KEY=      ← console.anthropic.com → API Keys
SUPABASE_URL=https://tittvjdrtuzsresheore.supabase.co
SUPABASE_SERVICE_ROLE_KEY=   ← supabase.com → Project Settings → API Keys → secret
```

São as mesmas três que estão na Vercel. **Este arquivo não sai do computador.**

## Uso no dia a dia

Duplo clique em **`iniciar-brasa.bat`**. Ele confere tudo, instala o que
faltar na primeira vez, abre o painel em `http://localhost:3000` e deixa o
processo rodando.

No painel: **Canais do agente → Conectar** → aparece o QR → no celular do chip
do agente, WhatsApp → **Aparelhos conectados → Conectar aparelho** → aponte a
câmera.

Pronto: mande uma mensagem de outro número para o chip e o agente responde.
As conversas aparecem na aba **Conversas** — tanto no painel local quanto no
painel da Vercel, porque os dois leem o mesmo banco.

- A janela preta precisa ficar aberta. Fechou = agente desligado.
- Reiniciou o PC? Duplo clique de novo. **Não precisa ler o QR outra vez** — a
  sessão fica salva na pasta `.whatsapp/`.
- Desconectar o número: painel → Canais do agente → Desconectar (ou apague a
  pasta `.whatsapp/agente/` com o processo parado).

## O segundo número: o WhatsApp da casa

São **dois números, dois conectores**, e cada um faz uma coisa:

| Conector | Chip | O que faz |
|---|---|---|
| `iniciar-brasa.bat` | do agente | atende o cliente com IA |
| `iniciar-brasa-administrativo.bat` | administrativo | **só envia**: checklist, confirmação, avisos |

O número administrativo **não responde ninguém**. É de propósito: com uma
conexão só, o funcionário que mandava "ok" depois de receber o link do
checklist era atendido pela recepcionista virtual como se fosse cliente novo
querendo reserva.

Duplo clique em **`iniciar-brasa-administrativo.bat`** (janela separada, pode
rodar junto com o outro) e, no painel, **⚙️ Ajustes → WhatsApp da casa →
Conectar** → leia o QR com o **chip administrativo**.

- Use um chip **diferente** do agente. Se parear o mesmo nos dois, o agente
  volta a responder a equipe — o painel avisa quando isso acontece.
- Cada conector tem a sua pasta de sessão (`.whatsapp/agente/` e
  `.whatsapp/administrativo/`) e a sua janela. Um cair não derruba o outro.
- Quem comprou Checklist e **não** comprou Agentes de IA usa só este.

> **Se você já usava a versão anterior:** o número que está conectado hoje
> continua sendo o do agente, sem precisar parear de novo. Mas **atualize o
> computador do bar** (feche e abra o `iniciar-brasa.bat`, que baixa a versão
> nova sozinho) — com o código antigo rodando ali, os botões Conectar e
> Desconectar do painel deixam de funcionar.

## Atualizar quando tem coisa nova

O `iniciar-brasa.bat` **se atualiza sozinho**: toda vez que abre, ele baixa a
versão mais recente antes de ligar. Fechou e abriu = atualizado.

Se quiser atualizar na mão (ou se o automático avisar que não conseguiu):

```
cd %USERPROFILE%\Documents\agentes-de-ia
git pull
```

## Se algo der errado

| Sintoma | Causa provável |
|---|---|
| Janela abre e fecha na hora | Node não instalado — passo 1 |
| "Falta o arquivo .env" | Passo 4 — confira o nome: `.env`, sem `.txt` no final |
| Painel abre mas dá "Erro interno" | Alguma chave errada no `.env` |
| QR não aparece em ~15 s | Feche a janela, abra de novo; persiste? Apague `.whatsapp/` e reconecte |
| Conectou mas caiu sozinho | Normal em rede instável — ele reconecta; se banir o chip, é o risco do não oficial |

O plano definitivo (sem PC ligado e 100% oficial) é a Cloud API da Meta, que
roda na própria Vercel — está no roteiro.
