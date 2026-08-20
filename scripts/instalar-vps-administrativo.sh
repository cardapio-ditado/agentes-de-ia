#!/usr/bin/env bash
#
# Brasa Food — sobe o SEGUNDO conector na VPS: o WhatsApp da casa.
#
# O primeiro conector (serviço brasa-food) atende o cliente com IA, no chip
# do agente. Este aqui é o número administrativo: ele SÓ ENVIA — link de
# checklist, confirmação de reserva, avisos — e não responde ninguém.
#
# Esse silêncio é o objetivo. Com uma conexão só, o funcionário que mandava
# "ok" depois de receber o link do checklist era atendido pela recepcionista
# virtual como se fosse um cliente novo querendo reserva.
#
# Roda ao lado do outro, na mesma máquina: mesma pasta de código, sessão e
# porta separadas. Não precisa de domínio, HTTPS nem porta aberta — a ponte
# com o painel é pelo Supabase, como no primeiro.
#
# Uso (como root, DEPOIS do instalar-vps.sh):
#   sudo bash scripts/instalar-vps-administrativo.sh
#
set -euo pipefail

DESTINO="${DESTINO:-/opt/brasa-food}"
USUARIO="${USUARIO:-brasa}"
SERVICO="brasa-food-admin"
PORTA="${PORTA:-3001}"

vermelho() { printf '\033[31m%s\033[0m\n' "$1"; }
verde()    { printf '\033[32m%s\033[0m\n' "$1"; }
azul()     { printf '\033[36m%s\033[0m\n' "$1"; }

# Roda um comando como o usuário do serviço.
#
# VPS enxuta costuma não ter `sudo` — você entra como root e pronto. Sem esta
# ponte, o instalador morre com "sudo: command not found" logo no primeiro
# passo, num erro que não tem nada a ver com o problema real.
como_usuario() {
  if command -v sudo >/dev/null 2>&1; then
    sudo -u "$USUARIO" -H "$@"
  else
    # `su` recebe uma STRING, não uma lista: cada argumento é citado para não
    # quebrar em espaços, e o cd preserva o diretório de trabalho.
    local cmd=""
    local arg
    for arg in "$@"; do cmd="$cmd $(printf '%q' "$arg")"; done
    su "$USUARIO" -s /bin/bash -c "cd $(printf '%q' "$PWD") &&$cmd"
  fi
}

if [ "$(id -u)" -ne 0 ]; then
  vermelho "Rode como root:  sudo bash scripts/instalar-vps-administrativo.sh"
  exit 1
fi

if [ ! -d "$DESTINO" ]; then
  vermelho "Não achei $DESTINO. Rode primeiro o scripts/instalar-vps.sh."
  exit 1
fi

if [ ! -f "$DESTINO/.env" ]; then
  vermelho "Não achei $DESTINO/.env. Rode primeiro o scripts/instalar-vps.sh."
  exit 1
fi

azul "== 1/3  Código na versão mais recente =="
git config --global --add safe.directory "$DESTINO" 2>/dev/null || true
como_usuario git -C "$DESTINO" pull --ff-only
cd "$DESTINO"
como_usuario npm install --no-audit --no-fund >/dev/null
como_usuario npx tsc -p tsconfig.build.json
verde "Código compilado."

azul "== 2/3  Serviço do conector administrativo =="
# As duas variáveis vêm DEPOIS do EnvironmentFile de propósito: o .env define
# PORT=3000 (a do agente), e aqui isso precisa ser sobrescrito. Dois processos
# na mesma porta brigam, e o segundo morre com "address in use" — um erro que
# não diz nada sobre a causa real.
cat > "/etc/systemd/system/$SERVICO.service" <<UNITEOF
[Unit]
Description=Brasa Food — WhatsApp da casa (administrativo, só envia)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USUARIO
WorkingDirectory=$DESTINO
EnvironmentFile=$DESTINO/.env
Environment=WHATSAPP_PAPEL=administrativo
Environment=PORT=$PORTA
ExecStart=/usr/bin/node dist/src/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
ProtectSystem=strict
ReadWritePaths=$DESTINO/.whatsapp /home/$USUARIO
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNITEOF

mkdir -p "$DESTINO/.whatsapp/administrativo"
chown -R "$USUARIO:$USUARIO" "$DESTINO/.whatsapp"

azul "== 3/3  Subindo os dois =="
systemctl daemon-reload
systemctl enable "$SERVICO" >/dev/null
# O do agente reinicia junto para pegar o código novo: sem isso ele continua
# rodando a versão antiga, que não entende os comandos por papel — e os
# botões Conectar/Desconectar do painel param de responder, em silêncio.
systemctl restart brasa-food
systemctl restart "$SERVICO"
sleep 4

echo
falhou=0
systemctl is-active --quiet brasa-food || { vermelho "brasa-food (agente) não subiu."; falhou=1; }
systemctl is-active --quiet "$SERVICO" || { vermelho "$SERVICO (administrativo) não subiu."; falhou=1; }

if [ "$falhou" -eq 1 ]; then
  vermelho "Veja o motivo:"
  echo "  journalctl -u brasa-food -n 30 --no-pager"
  echo "  journalctl -u $SERVICO -n 30 --no-pager"
  exit 1
fi

verde "================================================"
verde " Os dois conectores estão no ar."
verde "================================================"
echo
echo "O agente NÃO precisa parear de novo: a sessão antiga foi herdada."
echo
echo "Para ligar o número administrativo, no painel:"
echo "  1. Abra o painel e aperte Ctrl+Shift+R"
echo "  2. Ajustes (engrenagem) > WhatsApp da casa > Conectar"
echo "  3. Leia o QR com o CHIP ADMINISTRATIVO (não o do agente)"
echo
echo "Comandos úteis:"
echo "  systemctl status brasa-food $SERVICO"
echo "  journalctl -u $SERVICO -f          log ao vivo do administrativo"
echo "  systemctl restart $SERVICO"
