@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PS1=%ROOT%\deploy\setup_dev.ps1"

title Lokal-Messenger — Windows sozlash

echo.
echo  ============================================================
echo   Lokal-Messenger — Windows dev muhiti sozlash
echo  ============================================================
echo.
echo  Bu skript quyidagilarni o'rnatadi / tayyorlaydi:
echo    - Git, Go, Node.js  (avtomatik o'rnatiladi)
echo    - PostgreSQL 16, Redis
echo    - TLS sertifikat, JWT kalit, config.yaml
echo    - npm install, go build
echo    - Ma'lumotlar bazasi va admin foydalanuvchi
echo.
echo  Mavjud komponentlar o'tkazib yuboriladi, yo'qlar avtomatik o'rnatiladi.
echo  Vaqt: taxminan 5-15 daqiqa (birinchi marta).
echo.

:: Administrator tekshiruvi
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo  [!] Administrator huquqi kerak.
  echo      Oyna qayta ochiladi — "Ha" ni bosing.
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

if not exist "%PS1%" (
  echo  [X] setup_dev.ps1 topilmadi: %PS1%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -ProjectRoot "%ROOT%"
if errorlevel 1 (
  echo.
  echo  [X] Sozlash xato bilan tugadi. Log: C:\lokal-msg\tmp\
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo   SOZLASH MUVAFFAQIYATLI!  start-all.bat ni ishga tushiring
echo  ============================================================
echo.
pause
