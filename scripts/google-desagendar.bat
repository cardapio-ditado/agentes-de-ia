@echo off
rem Desfaz o agendamento de google-agendar.bat.
schtasks /Delete /F /TN "Brasa Food - Avaliacoes Google 11h" >nul 2>&1
schtasks /Delete /F /TN "Brasa Food - Avaliacoes Google 18h" >nul 2>&1
echo Agendamento removido.
pause
