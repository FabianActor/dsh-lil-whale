@echo off
chcp 65001 >nul
rem Stop fish.
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" -Target all
if errorlevel 1 pause
