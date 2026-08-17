#!/usr/bin/env bash
#
# Brasa Food — instala o conector WhatsApp numa VPS Ubuntu/Debian limpa.
#
# O que este servidor faz: mantém a sessão do WhatsApp aberta e conversa com
# o Supabase. Só isso. O painel e a API continuam na Vercel.
#
# Por isso ele NÃO precisa de domínio, HTTPS, nginx nem porta aberta: a ponte
# funciona pelo banco — o conector busca comandos no Supabase e publica ali o
# QR e o status, que o painel lê. Uma máquina sem nada exposto para a
# internet é também uma máquina com muito menos superfície de ataque.
#
# Uso (como root):
#   bash instalar-vps.sh
#
set -euo pipefail

REPO="${REPO:-https://github.com/cardapio-ditado/cardapiodigital.git}"
URL_DESTE_SCRIPT="https://raw.githubusercontent.com/cardapio-ditado/cardapiodigital/claude/ia-agents-github-supabase-jpt5ok/scripts/instalar-vps.sh"
DESTINO="/opt/brasa-food"
USUARIO="brasa"
SERVICO="brasa-food"

vermelho() { printf '\033[31m%s\033[0m\n' "$1"; }
verde()    { printf '\033[32m%s\033[0m\n' "$1"; }
azul()     { printf '\033[36m%s\033[0m\n' "$1"; }

if [ "$(id -u)" -ne 0 ]; then
  vermelho "Rode como root:  sudo bash instalar-vps.sh"
  exit 1
fi

azul "== 1/6  Pacotes do sistema =="
apt-get update -qq
apt-get install -y -qq curl git ca-certificates >/dev/null

azul "== 2/6  Node.js 20 =="
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
verde "Node $(node -v)"

azul "== 3/6  Usuário e código =="
# Usuário de sistema sem senha: ninguém entra por ele, mas o npm precisa de
# um shell de verdade — com nologin ele falha com um "path ... Received null"
# que não diz nada sobre a causa. Sem senha e sem chave SSH, ter shell não
# abre porta nenhuma.
id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$USUARIO"
# Se o usuário já existia com nologin (instalação anterior), conserta.
usermod --shell /bin/bash "$USUARIO"

if [ -d "$DESTINO/.git" ]; then
  git -C "$DESTINO" pull --ff-only
else
  git clone --depth 1 "$REPO" "$DESTINO"
fi
chown -R "$USUARIO:$USUARIO" "$DESTINO"

azul "== 4/6  Chaves =="
ENV_FILE="$DESTINO/.env"
if [ -f "$ENV_FILE" ]; then
  verde "Já existe um .env — mantendo. Para trocar as chaves, edite $ENV_FILE."
else
  echo
  echo "Cole as três chaves. Elas NÃO aparecem na tela enquanto você digita."
  echo "Pegue em: Supabase > Settings > API  e  console.anthropic.com"
  echo
  # Lê do terminal, e não da entrada padrão: rodando por "curl | bash" a
  # entrada é o PRÓPRIO script, então um read comum recebe EOF na hora e
  # grava tudo em branco — sem erro nenhum, que é o pior tipo de falha.
  # Não basta testar se /dev/tty existe: em sessão sem terminal de controle
  # ele existe e mesmo assim não abre. O teste tem que ser a abertura.
  if ! (exec 3</dev/tty) 2>/dev/null; then
    vermelho "Sem terminal para perguntar as chaves."
    vermelho "Baixe primeiro e rode depois:"
    vermelho "  curl -fsSL $URL_DESTE_SCRIPT -o instalar.sh && bash instalar.sh"
    exit 1
  fi

  read -rp  "SUPABASE_URL (https://xxxx.supabase.co): " SUPA_URL < /dev/tty
  read -rsp "SUPABASE_SERVICE_ROLE_KEY (a secreta, não a anon): " SUPA_KEY < /dev/tty; echo
  read -rsp "ANTHROPIC_API_KEY: " ANTHROPIC_KEY < /dev/tty; echo

  # Chave vazia gera um servidor que sobe e não funciona, com erro só lá na
  # frente e sem relação aparente com a instalação.
  for par in "SUPABASE_URL:$SUPA_URL" "SUPABASE_SERVICE_ROLE_KEY:$SUPA_KEY" "ANTHROPIC_API_KEY:$ANTHROPIC_KEY"; do
    if [ -z "${par#*:}" ]; then
      vermelho "A chave ${par%%:*} veio vazia. Rode de novo e cole as três."
      exit 1
    fi
  done

  # Escreve com permissão restrita ANTES de colocar conteúdo: entre criar e
  # proteger existe uma janela em que o arquivo seria legível por todos.
  install -m 600 -o "$USUARIO" -g "$USUARIO" /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<ENVEOF
SUPABASE_URL=$SUPA_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPA_KEY
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
# Só o conector roda aqui; escuta apenas em localhost porque nada de fora
# precisa alcançar esta porta.
HOST=127.0.0.1
PORT=3000
ENVEOF
  chmod 600 "$ENV_FILE"
  chown "$USUARIO:$USUARIO" "$ENV_FILE"
  verde "Chaves gravadas em $ENV_FILE (só o usuário $USUARIO lê)."
fi

azul "== 5/6  Dependências e build =="
cd "$DESTINO"
sudo -u "$USUARIO" -H npm ci --omit=dev --no-audit --no-fund 2>/dev/null \
  || sudo -u "$USUARIO" -H npm install --no-audit --no-fund
sudo -u "$USUARIO" -H npm install --no-save typescript >/dev/null 2>&1 || true
sudo -u "$USUARIO" -H npx tsc -p tsconfig.build.json

azul "== 6/6  Serviço =="
cat > "/etc/systemd/system/$SERVICO.service" <<UNITEOF
[Unit]
Description=Brasa Food — conector WhatsApp
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USUARIO
WorkingDirectory=$DESTINO
EnvironmentFile=$DESTINO/.env
ExecStart=/usr/bin/node dist/src/server.js
# Reinicia sempre: queda de rede e reinício da máquina não podem exigir que
# alguém lembre de ligar o agente de novo.
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
# O resto do sistema fica somente-leitura para o serviço. A sessão do
# WhatsApp vive em .whatsapp/; o home entra junto porque o Node escreve cache
# lá em algumas situações, e um serviço que não sobe por causa disso vira uma
# hora de depuração de systemd numa máquina remota.
ProtectSystem=strict
ReadWritePaths=$DESTINO/.whatsapp /home/$USUARIO
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNITEOF

mkdir -p "$DESTINO/.whatsapp"
chown -R "$USUARIO:$USUARIO" "$DESTINO/.whatsapp"

systemctl daemon-reload
systemctl enable "$SERVICO" >/dev/null
systemctl restart "$SERVICO"
sleep 3

echo
if systemctl is-active --quiet "$SERVICO"; then
  verde "================================================"
  verde " Conector no ar."
  verde "================================================"
  echo
  echo "Agora, no painel do Brasa Food:"
  echo "  1. Entre em /app e abra o módulo Agentes de IA"
  echo "  2. Vá em Canais > Conectar"
  echo "  3. Leia o QR com o WhatsApp do CHIP DO AGENTE"
  echo
  echo "Comandos úteis:"
  echo "  systemctl status $SERVICO      situação"
  echo "  journalctl -u $SERVICO -f      log ao vivo"
  echo "  systemctl restart $SERVICO     reiniciar"
  echo "  cd $DESTINO && git pull && npx tsc -p tsconfig.build.json && systemctl restart $SERVICO"
else
  vermelho "O serviço não subiu. Veja o motivo:"
  echo "  journalctl -u $SERVICO -n 40 --no-pager"
  exit 1
fi
