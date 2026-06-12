#!/bin/sh
# macOS / Linux 一键启动（对应 Windows 的 start.bat）
# 用法：双击不行就在终端运行 ./start.sh ；Ctrl+C 停止全部
cd "$(dirname "$0")" || exit 1

# 首次使用自动装依赖
[ -d node_modules ] || npm install

# 让 Node 的 fetch 跟随系统代理（http_proxy/https_proxy）。
# 国内网络上报 workers.dev 中转站需要走代理；没设代理时此变量无副作用。
export NODE_USE_ENV_PROXY=1

exec npm start
