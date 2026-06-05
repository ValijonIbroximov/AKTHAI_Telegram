@echo off
:: Skript joylashgan papkani avtomatik aniqlash
set "targetDir=%~dp0"

:: Natija fayli baribir Ish stoliga tushadi (qulay bo'lishi uchun)
set "outputFile=%userprofile%\Desktop\Folder_Structure_Log.txt"

echo Scanning Directory: %targetDir% > "%outputFile%"
echo Date: %date% %time% >> "%outputFile%"
echo. >> "%outputFile%"
echo ========================================== >> "%outputFile%"
echo Folder Tree Structure: >> "%outputFile%"
echo ========================================== >> "%outputFile%"

:: Tree buyrug'i joriy papka uchun
tree "%targetDir%" /f /a >> "%outputFile%"

echo. >> "%outputFile%"
echo ========================================== >> "%outputFile%"
echo Checking bin64 folder content... >> "%outputFile%"
echo ========================================== >> "%outputFile%"

:: bin64 papkasi borligini tekshirish (xatolik bermasligi uchun)
if exist "%targetDir%bin64" (
    dir "%targetDir%bin64" >> "%outputFile%"
) else (
    echo [OGOHLANTIRISH] "bin64" papkasi bu yerda topilmadi! >> "%outputFile%"
)

:: Faylni ochish
start notepad "%outputFile%"