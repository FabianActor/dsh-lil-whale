@echo off
chcp 65001 >nul
rem Launch fish. Window closes when it succeeds; stays open when it fails.
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -Target lee
if errorlevel 1 pause