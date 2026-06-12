#!/bin/sh
# 双击启动手机遥控：后台运行（关掉本窗口不影响），几秒后自动弹出控制台和二维码。
# 已经在跑的话，再次双击 = 直接打开控制台看二维码。
cd "$(dirname "$0")" || exit 1

if lsof -ti tcp:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "遥控已经在运行，为你打开控制台…"
  open "http://localhost:8765/panel"
  exit 0
fi

nohup ./start.sh > remote.log 2>&1 &

echo "✅ 遥控已在后台启动（本窗口可以关闭）"
echo "   稍等几秒，浏览器会自动弹出控制台，拿手机扫上面的二维码即可"
echo "   日志：$(pwd)/remote.log"
sleep 3
