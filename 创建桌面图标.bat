@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist build\icon.ico ( node electron\make-icon.cjs )
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path $d 'Claude 遥控.lnk')); $s.TargetPath='%~dp0start.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0build\icon.ico'; $s.WindowStyle=7; $s.Description='手机遥控 Claude Code'; $s.Save()"
echo.
echo 桌面图标「Claude 遥控」已创建/更新。双击它即可启动。
pause
