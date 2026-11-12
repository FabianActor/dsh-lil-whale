@echo off
chcp 65001 >nul
setlocal
rem 启动所有鱼（不含主 dsh，不开浏览器窗）。
set "S=%~dp0..\fish.ps1"
if not exist "%S%" set "S=%USERPROFILE%\dsh-lil-whale\scripts\fish.ps1"
if not exist "%S%" ( echo Cannot find fish.ps1. & pause & exit /b 1 )
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%S%" up all -NoBrowser
if errorlevel 1 pause
