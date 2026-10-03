@echo off
rem Agenda a sincronizacao das avaliacoes do Google duas vezes por dia
rem (11h e 18h) neste computador. Rodar UMA vez, como o usuario que fez o
rem login em google-conectar.bat. O computador precisa estar ligado e com
rem esse usuario logado nesses horarios.
cd /d "%~dp0.."
set ALVO=%~dp0google-sincronizar.bat

schtasks /Create /F /TN "Brasa Food - Avaliacoes Google 11h" /SC DAILY /ST 11:00 /TR "cmd /c set GOOGLE_AGENDADO=1&& \"%ALVO%\"" >nul
if errorlevel 1 goto erro
schtasks /Create /F /TN "Brasa Food - Avaliacoes Google 18h" /SC DAILY /ST 18:00 /TR "cmd /c set GOOGLE_AGENDADO=1&& \"%ALVO%\"" >nul
if errorlevel 1 goto erro

echo Agendado: 11h e 18h, todo dia. Para conferir: Agendador de Tarefas do Windows.
echo Para desfazer: google-desagendar.bat
echo Rodando a primeira vez agora...
set GOOGLE_AGENDADO=1
call "%ALVO%"
pause
exit /b 0

:erro
echo.
echo Nao consegui agendar. Clique com o botao direito e "Executar como administrador".
pause
exit /b 1
