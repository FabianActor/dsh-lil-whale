@echo off
chcp 65001 >nul
setlocal
rem 启动主 dsh（巡守那条）。已经在跑就直接打开它的 WebUI。
set "S=%~dp0..\fish.ps1"
if not exist "%S%" set "S=%USERPROFILE%\dsh-lil-whale\scripts\fish.ps1"
if not exist "%S%" ( echo Cannot find fish.ps1. & pause & exit /b 1 )
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%S%" up-main
if errorlevel 1 pause
