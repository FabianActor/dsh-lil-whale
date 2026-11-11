@echo off
chcp 65001 >nul
rem Stop fish.
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" -Target lee
if errorlevel 1 pause
