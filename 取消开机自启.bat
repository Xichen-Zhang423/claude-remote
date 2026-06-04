@echo off
chcp 65001 >nul
title 取消开机自启
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ClaudeRemote.lnk" 2>nul
echo.
echo 已取消开机自启（若原本没设置过，则无变化）。
echo.
pause
