@echo off
chcp 65001 >nul
rem 守夜：一直开着（最小化即可）。关掉它 = 今晚没人推门。
pwsh -NoLogo -NoProfile -File "%~dp0watchman.ps1"
pause
