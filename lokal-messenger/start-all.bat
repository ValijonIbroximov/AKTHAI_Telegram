@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"
set "SERVER_DIR=%ROOT%server"
set "REPO=%ROOT%.."
set "PORT_S=8443"
set "PORT_C=1420"

echo.
echo  ========================================
echo   Lokal-Messenger — Server + Client
echo  ========================================
echo.

where go >nul 2>&1
if errorlevel 1 (
  echo  [X] Go topilmadi.
  pause & exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo  [X] npm topilmadi.
  pause & exit /b 1
)

if not exist "%SERVER_DIR%\config.yaml" (
  echo  [!] %SERVER_DIR%\config.yaml yo'q
  echo      copy config.example.yaml config.yaml
  pause & exit /b 1
)

netstat -ano | findstr ":%PORT_S%" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  echo  [+] Server ishga tushmoqda (:8443)...
  start "Lokal-Messenger Server" cmd /k "cd /d "%SERVER_DIR%" && go run cmd/server/main.go"
) else (
  echo  [i] Server allaqachon ishlayapti (:8443)
)

netstat -ano | findstr ":%PORT_C%" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  if not exist "%ROOT%client\node_modules" (
    echo  [+] npm install...
    cd /d "%ROOT%client" && call npm install
  )
  echo  [+] Client ishga tushmoqda (:1420)...
  start "Lokal-Messenger Client" cmd /k "cd /d "%REPO%" && npm run dev"
) else (
  echo  [i] Client allaqachon ishlayapti (:1420)
)

echo.
echo  Brauzer: https://localhost:1420/
echo  Server oynasi va Client oynasi alohida ochiladi.
echo.
pause
