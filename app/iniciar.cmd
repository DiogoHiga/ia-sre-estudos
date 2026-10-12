@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
if not exist server\.env (
  copy server\.env.example server\.env >nul
  echo.
  echo [!] Criei server\.env - coloque sua GEMINI_API_KEY nele e rode de novo.
  notepad server\.env
  exit /b 1
)
call npm run dev
