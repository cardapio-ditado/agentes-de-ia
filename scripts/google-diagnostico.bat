@echo off
rem Tira uma "foto" da pagina de avaliacoes (imagem + HTML) para o suporte
rem ajustar a leitura. Usa o link que ja esta salvo no painel — nada a digitar.
cd /d "%~dp0.."

echo === Atualizando o projeto...
git pull

call npm run google:diagnostico
if errorlevel 1 (
  echo.
  echo Algo falhou — mande a mensagem acima para o suporte.
  pause
  exit /b 1
)

echo.
echo Pronto. Os arquivos "diagnostico-..." estao na pasta que vai abrir agora.
echo Envie o arquivo .html para o suporte.
start .
pause
