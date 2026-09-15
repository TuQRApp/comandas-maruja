@echo off
setlocal
cd /d "%~dp0"

if not exist "openai-key.txt.txt" (
  echo No encontre openai-key.txt.txt en esta carpeta.
  echo Crea ese archivo con tu API key de OpenAI adentro y vuelve a intentar.
  pause
  exit /b 1
)

if not exist "armar-prompt-codex.js" (
  echo No encontre armar-prompt-codex.js en esta carpeta.
  pause
  exit /b 1
)

echo Armando el prompt con el codigo del proyecto...
node armar-prompt-codex.js
if errorlevel 1 (
  echo Fallo al armar el prompt. Revisa el mensaje de arriba.
  pause
  exit /b 1
)

set /p OPENAI_API_KEY=<openai-key.txt.txt

echo.
echo Ejecutando revision de codigo con Codex...
echo Esto puede tardar varios minutos. No cierres esta ventana.
echo.

codex exec --sandbox read-only -o review-codex.md - < prompt-codex-full.txt

echo.
echo ================================================
echo Listo. El resultado quedo guardado en review-codex.md
echo ================================================
pause