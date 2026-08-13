@echo off
rem ============================================================
rem Brasa - inicia o painel + conector WhatsApp neste computador.
rem Duplo clique e pronto. Feche a janela para parar o agente.
rem ============================================================
title Brasa - Agentes de IA
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [erro] Node.js nao encontrado.
  echo Instale a versao LTS em https://nodejs.org e rode de novo.
  echo.
  pause
  exit /b 1
)

if not exist .env (
  echo.
  echo [erro] Falta o arquivo .env com as chaves.
  echo Copie .env.example para .env e preencha:
  echo   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Primeira execucao: instalando dependencias...
  call npm install || (pause & exit /b 1)
)

echo.
echo Painel local: http://localhost:3000  (abrindo no navegador)
echo Para conectar o WhatsApp: aba Canais - Conectar - leia o QR
echo com o WhatsApp do CHIP DO AGENTE (nao o numero principal da casa).
echo.
echo Esta janela precisa ficar aberta. Fechar = agente desligado.
echo.
start "" http://localhost:3000/#canais
call npm run dev
pause
