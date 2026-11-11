@echo off
chcp 65001 >nul
rem Same as the quiet one, but the window always stays open (for troubleshooting).
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -Target all
echo.
pause