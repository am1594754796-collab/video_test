@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-countdown.ps1" -Public
set "START_RESULT=%ERRORLEVEL%"
if not "%START_RESULT%"=="0" pause
exit /b %START_RESULT%
