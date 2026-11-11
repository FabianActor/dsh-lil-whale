@echo off
chcp 65001 >nul
setlocal
rem Works from anywhere: prefers the copy of this script, falls back to the project junction.
set "S=%~dp0launch.ps1"
if not exist "%S%" set "S=%USERPROFILE%\dsh-lil-whale\scripts\launch.ps1"
if not exist "%S%" ( echo Cannot find launch.ps1, expected next to this file or in the project. & pause & exit /b 1 )
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%S%" -Target whale
set "RC=%ERRORLEVEL%"
endlocal & set "RC=%RC%"
echo.
pause
exit /b %RC%
