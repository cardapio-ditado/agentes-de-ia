#!/usr/bin/env bash
# ============================================================
# Conector do WHATSAPP DA CASA (número administrativo) — Linux/VPS.
#
# Este é o número que ENVIA: link de checklist, confirmação de reserva,
# avisos. Ele NÃO responde ninguém, de propósito — quem atende com IA é o
# outro conector, com o chip do agente.
#
# Os dois rodam ao mesmo tempo, na mesma máquina. Cada um com sua pasta de
# sessão e sua porta.
#
# Uso solto (a sessão morre ao fechar o terminal):
#   ./iniciar-administrativo.sh
#
# Uso de verdade, com pm2 (sobrevive a logout e a reboot):
#   pm2 start ./iniciar-administrativo.sh --name brasa-admin
#   pm2 save
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "[erro] Falta o arquivo .env com as chaves (ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)."
  exit 1
fi

# O papel é a única diferença real em relação ao conector do agente: com ele,
# a mensagem que chega NÃO vai para a IA. Sem ele, o funcionário que responde
# "ok" ao checklist seria atendido como cliente novo.
export WHATSAPP_PAPEL=administrativo

# Porta diferente da do agente: dois processos na mesma porta brigam, e o
# segundo morre com "address in use" sem explicar por quê.
export PORT="${PORT:-3001}"

echo "Conferindo dependências…"
npm install --no-audit --no-fund

# Em VPS roda o código compilado, não o tsx watch: watch reinicia sozinho a
# cada arquivo tocado, e reiniciar derruba a sessão do WhatsApp.
echo "Compilando…"
npm run build

echo
echo "============================================================"
echo " WhatsApp da CASA — só envia, não responde."
echo " Porta: $PORT"
echo
echo " Para parear: painel → Ajustes → WhatsApp da casa → Conectar"
echo " e leia o QR com o CHIP ADMINISTRATIVO (não o do agente)."
echo "============================================================"
echo

exec node dist/src/server.js
