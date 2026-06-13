#!/bin/sh
# 双击停止手机遥控：服务、隧道、防睡眠一起停，公网入口随之关闭（省电、更安全）。
PIDS=$(lsof -ti tcp:8765 -sTCP:LISTEN 2>/dev/null)
if [ -n "$PIDS" ]; then
  kill $PIDS 2>/dev/null
  sleep 1
  echo "✅ 遥控已停止，公网入口已关闭"
else
  echo "遥控本来就没在运行"
fi

# 兜底清理（正常情况下服务收到信号会自己清干净）
pkill -f "claude-remote/cloudflared.exe" 2>/dev/null
pkill -f "caffeinate -is" 2>/dev/null
sleep 2
exit 0
