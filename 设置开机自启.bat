@echo off
chcp 65001 >nul
title 设置开机自启
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut('%STARTUP%\ClaudeRemote.lnk'); $s.TargetPath='%~dp0start.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Description='Claude Code 手机遥控'; $s.Save()"
if exist "%STARTUP%\ClaudeRemote.lnk" (
  echo.
  echo [成功] 已设置开机自启。
  echo 以后这台电脑开机并登录后，会自动启动服务和通道，
  echo 配合云端中转，手机直接打开 App 就能连上，不用再手动开。
) else (
  echo.
  echo [失败] 可能被杀毒软件拦截了。可手动设置：
  echo   按 Win+R 输入 shell:startup 回车，
  echo   再把本文件夹里 start.bat 的「快捷方式」拖进去即可。
)
echo.
pause
