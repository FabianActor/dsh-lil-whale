@echo off
chcp 65001 >nul
rem Stop fish.
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" -Target whale
if errorlevel 1 pause
