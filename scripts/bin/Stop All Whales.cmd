@echo off
chcp 65001 >nul
setlocal
rem 关闭所有鱼，包括主 dsh（先关小鱼，最后关主 dsh）。
set "S=%~dp0..\fish.ps1"
if not exist "%S%" set "S=%USERPROFILE%\dsh-lil-whale\scripts\fish.ps1"
if not exist "%S%" ( echo Cannot find fish.ps1. & pause & exit /b 1 )
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%S%" down all -Yes
if errorlevel 1 pause
