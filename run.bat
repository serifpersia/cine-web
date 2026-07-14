@echo off
echo ========================
echo         cine-web
echo ========================
echo 1. Dev mode (localhost:5173)
echo 2. Production (localhost:3000)

echo.

set /p choice="Select (1 or 2): "

if "%choice%"=="1" (
  call npm install > nul 2>&1
  echo Starting in DEV mode at http://localhost:5173
  npm run dev
  exit /b
)

call npm install > nul 2>&1
call npm run build > nul 2>&1
echo Starting in PRODUCTION mode at http://localhost:3000
node server.js
