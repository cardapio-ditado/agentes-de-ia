@echo off
rem Busca avaliacoes novas e publica as respostas aprovadas.
rem Pode agendar no Agendador de Tarefas do Windows (2x ao dia resolve).
cd /d "%~dp0.."

call npm run google:sincronizar
if errorlevel 1 (
  echo.
  echo A sincronizacao teve problema — mande a mensagem acima para o suporte.
  pause
  exit /b 1
)
exit /b 0
