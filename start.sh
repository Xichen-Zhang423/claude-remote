#!/bin/sh
# macOS / Linux 一键启动（对应 Windows 的 start.bat）
# 用法：双击不行就在终端运行 ./start.sh ；Ctrl+C 停止全部
cd "$(dirname "$0")" || exit 1

# 首次使用自动装依赖
[ -d node_modules ] || npm install

# 让 Node 的 fetch 跟随系统代理（http_proxy/https_proxy）。
# 国内网络上报 workers.dev 中转站需要走代理；没设代理时此变量无副作用。
export NODE_USE_ENV_PROXY=1

# shell 里没有代理变量时，自动读 macOS 系统代理（Clash/V2Ray 等设置的那个），
# 这样无论从终端还是双击启动，上报中转站都能走代理
if [ -z "$https_proxy" ] && [ -z "$HTTPS_PROXY" ] && command -v scutil >/dev/null 2>&1; then
  proxy_url=$(scutil --proxy | awk '
    /HTTPSEnable : 1/ {e=1}
    /HTTPSProxy :/ {h=$3}
    /HTTPSPort :/ {p=$3}
    END { if (e==1 && h != "") printf "http://%s:%s", h, p }')
  if [ -n "$proxy_url" ]; then
    export https_proxy="$proxy_url" http_proxy="$proxy_url"
    echo "（已自动跟随系统代理 $proxy_url）"
  fi
fi

exec npm start
