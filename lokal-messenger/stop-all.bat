@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo  ========================================
echo   Lokal-Messenger — Hammasini to'xtatish
echo  ========================================
echo.

set "ANY=0"

for %%P in (8443 1420) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
    if !errorlevel!==0 (
      echo  [OK] Port %%P — PID %%a to'xtatildi
      set "ANY=1"
    )
  )
)

if "!ANY!"=="0" (
  echo  [i] Server (8443) va Client (1420) ishlamayapti.
)

echo.
pause
