@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "PORT=8443"
set "KILLED=0"

echo.
echo  Server to'xtatilmoqda (port %PORT%)...
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
  if !errorlevel!==0 (
    echo  [OK] PID %%a to'xtatildi
    set "KILLED=1"
  )
)

if "!KILLED!"=="0" (
  echo  [i] Port %PORT% da server topilmadi.
)

echo.
pause
