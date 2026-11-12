@echo off
chcp 65001 >nul
setlocal
rem 关闭所有鱼（主 dsh 不动）。
set "S=%~dp0..\fish.ps1"
if not exist "%S%" set "S=%USERPROFILE%\dsh-lil-whale\scripts\fish.ps1"
if not exist "%S%" ( echo Cannot find fish.ps1. & pause & exit /b 1 )
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%S%" down all -Yes
if errorlevel 1 pause
