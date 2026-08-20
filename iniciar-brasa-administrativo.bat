@echo off
rem ============================================================
rem Brasa Food - conector do WHATSAPP DA CASA (numero administrativo).
rem
rem Este e o numero que ENVIA: link de checklist, confirmacao de reserva,
rem avisos. Ele NAO responde ninguem - quem mandar mensagem para ele fala
rem com o vazio, de proposito. O atendimento com IA e o outro conector
rem (iniciar-brasa.bat), com o chip do agente.
rem
rem Os dois podem rodar ao mesmo tempo, neste mesmo computador. Cada um em
rem sua janela. Fechar a janela desliga aquele numero.
rem ============================================================
title Brasa Food - WhatsApp da casa (administrativo)
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
  echo Rode primeiro o iniciar-brasa.bat, que configura tudo.
  echo.
  pause
  exit /b 1
)

where git >nul 2>nul
if not errorlevel 1 (
  echo Buscando atualizacoes...
  git pull --ff-only 2>nul || echo [aviso] Nao consegui atualizar agora; seguindo com a versao local.
)

echo Conferindo dependencias...
call npm install --no-audit --no-fund || (pause & exit /b 1)

rem O papel e a unica diferenca em relacao ao outro conector: com ele, a
rem mensagem que chega NAO vai para a IA. Sem ele, o funcionario que
rem responde "ok" ao checklist seria atendido como cliente novo.
set WHATSAPP_PAPEL=administrativo

rem Porta diferente do conector do agente: dois processos na mesma porta
rem brigam, e o segundo morre com "address in use". Este aqui nao precisa
rem servir painel - quem abre o painel e o outro (ou a Vercel).
set PORT=3001

echo.
echo ============================================================
echo  WhatsApp da CASA - so envia, nao responde.
echo.
echo  Para parear: abra o painel, va em Ajustes - WhatsApp da casa,
echo  clique em Conectar e leia o QR com o CHIP ADMINISTRATIVO
echo  (nao o chip do agente).
echo ============================================================
echo.
echo Esta janela precisa ficar aberta. Fechar = disparos desligados.
echo.
call npm run dev
pause
