@echo off
chcp 65001 >nul
setlocal
rem 关闭主 dsh。还有鱼在跑时拒绝——推荐先关鱼再关 dsh。
set "S=%~dp0..\fish.ps1"
if not exist "%S%" set "S=%USERPROFILE%\dsh-lil-whale\scripts\fish.ps1"
if not exist "%S%" ( echo Cannot find fish.ps1. & pause & exit /b 1 )
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%S%" down-main
if errorlevel 1 pause
