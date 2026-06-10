@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"
set "SERVER_DIR=%ROOT%server"
set "PORT=8443"

title Lokal-Messenger — Server ishga tushirish

echo.
echo  ========================================
echo   Lokal-Messenger — Go server (:8443)
echo  ========================================
echo.

netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo  [!] Port %PORT% band — server allaqachon ishlayapti.
  echo      To'xtatish: stop-server.bat
  echo.
  pause
  exit /b 0
)

if not exist "%SERVER_DIR%\config.yaml" (
  echo  [!] config.yaml topilmadi: %SERVER_DIR%
  echo      Namuna: copy config.example.yaml config.yaml
  echo.
  pause
  exit /b 1
)

where go >nul 2>&1
if %errorlevel% neq 0 (
  echo  [X] Go topilmadi. PATH ga go qo'shing: https://go.dev/dl/
  pause
  exit /b 1
)

echo  Server yangi oynada ishga tushmoqda...
echo  Bu oynani yopmang — loglar shu yerda ko'rinadi.
echo.

start "Lokal-Messenger Server" cmd /k "cd /d "%SERVER_DIR%" && go run cmd/server/main.go"

timeout /t 2 /nobreak >nul
echo  Tayyor. Brauzer uchun: start-client.bat yoki start-all.bat
echo.
pause
