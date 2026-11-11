@echo off
chcp 65001 >nul
wt -w 0 new-tab --title "lee" -d "C:\Users\Fabian\Desktop" pwsh -NoLogo -NoProfile -File "%~dp0tab-lee.ps1" ; new-tab --title "whale" -d "D:\文档\WorkSpace\lil-whale" pwsh -NoLogo -NoProfile -File "%~dp0tab-whale.ps1"
