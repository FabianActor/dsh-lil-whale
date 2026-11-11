@echo off
chcp 65001 >nul
setlocal
rem Prefers the real layout (..\PS1), then this folder, then the ASCII project junction.
set "S=%~dp0..\launch.ps1"
if not exist "%S%" set "S=%~dp0launch.ps1"
if not exist "%S%" set "S=%USERPROFILE%\dsh-lil-whale\scripts\launch.ps1"
if not exist "%S%" ( echo Cannot find launch.ps1. Run this from scripts\bin, or check that %USERPROFILE%\dsh-lil-whale exists. & pause & exit /b 1 )
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%S%" -Target lee
set "RC=%ERRORLEVEL%"
endlocal & set "RC=%RC%"
if not "%RC%"=="0" pause
exit /b %RC%
