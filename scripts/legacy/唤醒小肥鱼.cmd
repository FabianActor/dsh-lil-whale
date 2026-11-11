@echo off
rem ASCII wrapper: keep the Chinese-named entry working without putting Chinese in the cmd body
chcp 65001 >nul
pwsh -NoProfile -File "%~dp0wake-whale.ps1"
pause
