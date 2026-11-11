@echo off
chcp 65001 >nul
rem Manual fallback watchman. The door is normally pushed by the dsh-group plugin timer.
pwsh -NoLogo -NoProfile -File "%~dp0watchman.ps1"
pause
