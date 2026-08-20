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
# Um `git pull` rodado como root deixa arquivos com dono root, e aí o npm do
# usuário do serviço morre com EACCES em package-lock.json — um erro que fala
# de permissão sem dizer que a causa foi um comando inocente de atualização.
# Devolver a pasta ao dono certo antes de começar torna o passo indiferente a
# quem rodou o quê antes.
chown -R "$USUARIO:$USUARIO" "$DESTINO"
como_usuario git -C "$DESTINO" pull --ff-only
cd "$DESTINO"
como_usuario npm install --no-audit --no-fund >/dev/null
como_usuario npx tsc -p tsconfig.build.json
verde "Código compilado."

azul "== 2/3  Serviço do conector administrativo =="
# O papel e a porta vão no ExecStart, via `env`, e NÃO em Environment=.
#
# Parece a mesma coisa e não é: no systemd, as variáveis lidas de
# EnvironmentFile sobrescrevem as de Environment=, seja qual for a ordem das
# linhas. Como o .env define PORT=3000 (a porta do agente), um Environment=
# aqui era silenciosamente ignorado e este serviço subia na 3000 — brigando
# com o conector do agente e morrendo em laço com "EADDRINUSE", um erro que
# fala de porta ocupada sem dizer que a porta pedida nem chegou a ser lida.
#
# Variável na linha de comando vence tudo, e não depende de precedência.
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
ExecStart=/usr/bin/env WHATSAPP_PAPEL=administrativo PORT=$PORTA /usr/bin/node dist/src/server.js
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

# Espera até 30s em vez de um sleep fixo: node com Baileys leva alguns
# segundos para subir, e um sleep curto declara falha num serviço que só
# estava demorando — mandando a pessoa depurar um problema que não existe.
azul "Aguardando os dois responderem…"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet brasa-food && systemctl is-active --quiet "$SERVICO"; then
    break
  fi
  sleep 1
done

echo
falhou=0
systemctl is-active --quiet brasa-food || { vermelho "brasa-food (agente) não subiu."; falhou=1; }
systemctl is-active --quiet "$SERVICO" || { vermelho "$SERVICO (administrativo) não subiu."; falhou=1; }

if [ "$falhou" -eq 1 ]; then
  echo
  vermelho "---------- últimas linhas do log ----------"
  # Mostra o motivo aqui mesmo: pedir para a pessoa rodar outro comando é uma
  # ida e volta a mais entre ela e a resposta, e o erro real fica a um passo
  # de distância de quem está tentando resolver.
  journalctl -u brasa-food-admin -n 25 --no-pager || true
  vermelho "------------------------------------------"
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
