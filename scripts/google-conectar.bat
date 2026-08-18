@echo off
rem Conecta a conta gerente do Google — rodar UMA vez por maquina.
rem Abre o navegador para o login; quando o perfil aparecer, volte aqui e ENTER.
cd /d "%~dp0.."

echo === Atualizando o projeto...
git pull
if errorlevel 1 goto erro

echo === Conferindo dependencias (a primeira vez demora)...
call npm install --no-audit --no-fund
if errorlevel 1 goto erro
call npx playwright install chromium
if errorlevel 1 goto erro

echo === Abrindo o navegador para o login da conta GERENTE...
echo     (nunca a sua conta pessoal)
call npm run google:login
if errorlevel 1 goto erro

echo.
echo Tudo certo. Agora use google-sincronizar.bat quando quiser buscar avaliacoes.
pause
exit /b 0

:erro
echo.
echo Algo falhou — mande a mensagem acima para o suporte.
pause
exit /b 1
