@echo off
rem Busca avaliacoes novas e publica as respostas aprovadas.
rem Roda sozinho pelo Agendador de Tarefas (google-agendar.bat) ou a mao.
cd /d "%~dp0.."

rem Quem agendou leu o aviso: a automacao pela interface e por conta e risco.
set GOOGLE_ACEITO_RISCO=1
rem Com tela (o computador do bar), a janela aparece: parece menos robo.
if not defined GOOGLE_NAVEGADOR_VISIVEL set GOOGLE_NAVEGADOR_VISIVEL=1

if not exist logs mkdir logs
echo ===== %date% %time% ===== >> logs\google-sincronizar.log
call npm run google:sincronizar >> logs\google-sincronizar.log 2>&1
set RESULTADO=%errorlevel%
if %RESULTADO% neq 0 (
  echo.
  echo A sincronizacao teve problema. Veja logs\google-sincronizar.log
  if not defined GOOGLE_AGENDADO pause
  exit /b %RESULTADO%
)
exit /b 0
