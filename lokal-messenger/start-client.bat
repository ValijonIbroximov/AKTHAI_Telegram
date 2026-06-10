@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"
set "REPO=%ROOT%.."
set "PORT=1420"

title Lokal-Messenger — Client (Vite)

echo.
echo  ========================================
echo   Lokal-Messenger — Vite dev (:1420)
echo  ========================================
echo.

netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo  [!] Port %PORT% band — client allaqachon ishlayapti.
  echo      Brauzer: https://localhost:1420/
  echo      To'xtatish: stop-client.bat
  echo.
  pause
  exit /b 0
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
  echo  [X] npm topilmadi. Node.js o'rnating: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "%ROOT%client\node_modules" (
  echo  node_modules yo'q — npm install bajarilmoqda...
  cd /d "%ROOT%client"
  call npm install
  if errorlevel 1 (
    echo  [X] npm install xato
    pause
    exit /b 1
  )
)

echo  Client yangi oynada ishga tushmoqda...
echo  Brauzer: https://localhost:1420/  yoki  https://192.168.x.x:1420/
echo.

start "Lokal-Messenger Client" cmd /k "cd /d "%REPO%" && npm run dev"

timeout /t 3 /nobreak >nul
echo  Tayyor.
echo.
pause
