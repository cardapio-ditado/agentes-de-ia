#!/usr/bin/env bash
#
# Brasa Food — sobe os DOIS conectores de UMA casa nova na VPS.
#
# A jornada do cliente novo é: criar o cliente na Administração (o painel
# faz organização, estabelecimento, agente, login do dono e chave sozinho),
# ligar os módulos, e rodar ESTE script uma vez. O que sobra é o único passo
# que máquina nenhuma faz: ler os QR com os chips do cliente.
#
# Cada casa ganha o seu par de serviços — agente (atende com IA) e
# administrativo (só envia) — amarrados a ela pelo WHATSAPP_VENUE. As
# sessões moram em .whatsapp/casas/<slug>/, e a fila de mensagens é filtrada
# por casa no banco: nada de uma casa passa pelo número da outra.
#
# Uso (como root, na VPS que já tem o instalar-vps.sh rodado):
#   sudo bash scripts/instalar-casa.sh <slug-da-casa>
#
# O slug é o mesmo que aparece na Administração ao criar o cliente
# (ex.: the-20). Rodar de novo para a mesma casa só atualiza — não quebra a
# sessão pareada.
#
set -euo pipefail

DESTINO="${DESTINO:-/opt/brasa-food}"
USUARIO="${USUARIO:-brasa}"

vermelho() { printf '\033[31m%s\033[0m\n' "$1"; }
verde()    { printf '\033[32m%s\033[0m\n' "$1"; }
azul()     { printf '\033[36m%s\033[0m\n' "$1"; }

como_usuario() {
  if command -v sudo >/dev/null 2>&1; then
    sudo -u "$USUARIO" -H "$@"
  else
    local cmd=""
    local arg
    for arg in "$@"; do cmd="$cmd $(printf '%q' "$arg")"; done
    su "$USUARIO" -s /bin/bash -c "cd $(printf '%q' "$PWD") &&$cmd"
  fi
}

if [ "$(id -u)" -ne 0 ]; then
  vermelho "Rode como root:  sudo bash scripts/instalar-casa.sh <slug-da-casa>"
  exit 1
fi

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  vermelho "Diga a casa:  sudo bash scripts/instalar-casa.sh <slug-da-casa>"
  vermelho "O slug é o identificador criado na Administração (ex.: the-20)."
  exit 1
fi
if ! printf '%s' "$SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
  vermelho "Slug inválido: \"$SLUG\". Use só letras minúsculas, números e hífen."
  exit 1
fi

if [ ! -d "$DESTINO" ] || [ ! -f "$DESTINO/.env" ]; then
  vermelho "Não achei a instalação em $DESTINO. Rode primeiro o scripts/instalar-vps.sh."
  exit 1
fi

SERVICO_AGENTE="brasa-food-$SLUG"
SERVICO_ADMIN="brasa-food-$SLUG-admin"

# Portas: cada serviço Node precisa da sua. As casas extras começam na 3010,
# em pares — a base usa 3000/3001. A porta aqui não serve painel para
# ninguém (o painel é a Vercel); só precisa não colidir.
PORTA_AGENTE="${PORTA_AGENTE:-}"
if [ -z "$PORTA_AGENTE" ]; then
  PORTA_AGENTE=3010
  while ss -ltn 2>/dev/null | grep -q ":$PORTA_AGENTE " ||
        grep -rlq "PORT=$PORTA_AGENTE " /etc/systemd/system/brasa-food-*.service 2>/dev/null; do
    PORTA_AGENTE=$((PORTA_AGENTE + 2))
  done
fi
PORTA_ADMIN=$((PORTA_AGENTE + 1))

azul "== 1/4  Código na versão mais recente =="
git config --global --add safe.directory "$DESTINO" 2>/dev/null || true
chown -R "$USUARIO:$USUARIO" "$DESTINO"
como_usuario git -C "$DESTINO" checkout -- package-lock.json 2>/dev/null || true
como_usuario git -C "$DESTINO" pull --ff-only
cd "$DESTINO"
como_usuario npm install --no-audit --no-fund >/dev/null
como_usuario npx tsc -p tsconfig.build.json
verde "Código compilado."

azul "== 2/4  Serviços da casa \"$SLUG\" (portas $PORTA_AGENTE/$PORTA_ADMIN) =="
# WHATSAPP_VENUE, papel e porta vão no ExecStart via `env`, nunca em
# Environment=: EnvironmentFile sobrescreve Environment= no systemd, e o
# PORT=3000 do .env engoliria a porta pedida — a lição do EADDRINUSE do
# instalador do administrativo vale aqui em dobro.
escrever_unit() {
  local servico="$1" papel="$2" porta="$3" descricao="$4"
  cat > "/etc/systemd/system/$servico.service" <<UNITEOF
[Unit]
Description=Brasa Food — $descricao
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USUARIO
WorkingDirectory=$DESTINO
EnvironmentFile=$DESTINO/.env
ExecStart=/usr/bin/env WHATSAPP_VENUE=$SLUG WHATSAPP_PAPEL=$papel PORT=$porta /usr/bin/node dist/src/server.js
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
}

escrever_unit "$SERVICO_AGENTE" "agente" "$PORTA_AGENTE" "$SLUG: agente (atende com IA)"
escrever_unit "$SERVICO_ADMIN" "administrativo" "$PORTA_ADMIN" "$SLUG: WhatsApp da casa (só envia)"

mkdir -p "$DESTINO/.whatsapp/casas/$SLUG/agente" "$DESTINO/.whatsapp/casas/$SLUG/administrativo"
chown -R "$USUARIO:$USUARIO" "$DESTINO/.whatsapp"

azul "== 3/4  Subindo =="
systemctl daemon-reload
systemctl enable "$SERVICO_AGENTE" "$SERVICO_ADMIN" >/dev/null
systemctl restart "$SERVICO_AGENTE" "$SERVICO_ADMIN"

azul "== 4/4  Conferindo =="
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICO_AGENTE" && systemctl is-active --quiet "$SERVICO_ADMIN"; then
    break
  fi
  sleep 1
done

falhou=0
systemctl is-active --quiet "$SERVICO_AGENTE" || { vermelho "$SERVICO_AGENTE não subiu."; falhou=1; }
systemctl is-active --quiet "$SERVICO_ADMIN" || { vermelho "$SERVICO_ADMIN não subiu."; falhou=1; }

if [ "$falhou" -eq 1 ]; then
  echo
  vermelho "---------- últimas linhas do log ----------"
  journalctl -u "$SERVICO_AGENTE" -u "$SERVICO_ADMIN" -n 30 --no-pager || true
  vermelho "------------------------------------------"
  exit 1
fi

verde "================================================"
verde " Os dois conectores de \"$SLUG\" estão no ar."
verde "================================================"
echo
echo "Falta só o que máquina não faz — parear os chips DA CASA NOVA:"
echo "  1. No painel, escolha \"$SLUG\" no seletor de estabelecimento"
echo "  2. Ajustes (engrenagem) > WhatsApp da casa > Conectar"
echo "     Leia o QR com o chip ADMINISTRATIVO da casa"
echo "  3. Módulo Agentes de IA > Canais do agente > Conectar"
echo "     Leia o QR com o chip do ATENDIMENTO da casa"
echo
echo "Comandos úteis:"
echo "  systemctl status $SERVICO_AGENTE $SERVICO_ADMIN"
echo "  journalctl -u $SERVICO_AGENTE -f"
echo "  journalctl -u $SERVICO_ADMIN -f"
