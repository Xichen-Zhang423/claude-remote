@echo off
chcp 65001 >nul
echo ============================================
echo   停止「手机遥控 Claude Code」的全部后台进程
echo   （打 CSGO / 瓦洛兰特前先点这个）
echo ============================================
echo.
echo 正在关闭 Cloudflare 隧道...
taskkill /F /IM cloudflared.exe >nul 2>&1

echo 正在关闭本工具的 node 服务 + 截屏/控制/保活脚本...
REM 按命令行特征精确匹配，只杀本工具的进程，不会误杀你别的 node 程序
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'server\.js|SetThreadExecutionState|screenshot\.ps1|control\.ps1' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }"

echo.
echo [完成] 遥控相关进程已全部停止。
echo.
echo 重要：瓦洛兰特的 Vanguard 反作弊在「开机时」就检查系统，
echo       所以这一次请先「重启电脑」再进游戏，之后就正常了。
echo       （只要遥控工具没在运行，游戏就不会再闪退。）
echo.
echo 想彻底不受影响：双击「取消开机自启.bat」，让遥控不再随开机自动启动，
echo 需要远程时再手动开 start.bat。
echo.
pause
