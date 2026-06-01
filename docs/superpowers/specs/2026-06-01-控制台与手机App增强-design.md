# 设计方案：手机遥控 Claude Code —— 桌面软件化 + 手机 App 化 + 实用功能

日期：2026-06-01
状态：已与用户确认，进入实现

## 背景（现状）

`server.js` 是单一入口：HTTP + 手机 WS(`/ws`，token) + 本机控制 WS(`/control`) + Claude Agent SDK 会话 + 自动起 Cloudflare 隧道 + 防睡眠 + 控制台页 `public/panel.html`。手机端是 `public/` 里的 PWA。痛点：隧道地址每次重启会变；手机要走浏览器；断线丢聊天；电脑端是黑窗口不像软件。

设备约束：用户手机为华为 EMUI/HarmonyOS 4.3（安卓底子，**支持完整 PWA / 摄像头 / Service Worker**，无 GMS）。中国网络，单人自用。

## 目标（本批 7 项）

1. 手机「扫码 App」：装一次、点图标即开、App 内扫码连接，不用浏览器。
2. 对话不丢：断线/重开/重连后自动补回最近对话。
3. 桌面 Electron 托盘软件：真·图标 + 托盘常驻，主窗口即控制台。
4. 来消息推送：需要权限 / 任务完成时推到手机（锁屏可收）。
5. 发图片给 Claude：手机拍照/选图随指令发送。
6. 快捷指令按钮：可点的常用指令，支持自定义。
7. UI 美化：手机端 + 控制台视觉升级。

## 各组件设计

### 1. 手机「扫码 App」（核心，免原生免 Tailscale）
- **离线壳**：Service Worker 把界面外壳改为 **cache-first**，点桌面图标即使安装来源（旧隧道地址）已失效，也能离线打开外壳。
- **后端地址可配置**：WS 连接目标从写死的 `location.host` 改为 **localStorage 里存的 backend(host+token)**；首次为空时引导扫码。
- **App 内扫码**：用 `getUserMedia` + `jsQR`（小型纯 JS 库，本地内置不走 CDN）扫控制台二维码，解析出 host+token，存下并连接。跨源 WSS（页面源=旧隧道，后端=新隧道）允许、且都是 https/wss 无混合内容。
- **流程**：点图标 → 点「扫码连接」→ 扫控制台二维码 → 连上。仅首次安装用一次浏览器「添加到主屏幕」。
- 控制台二维码内容沿用 `https://<隧道>/?token=<token>`，App 扫到后自行解析为后端地址。

### 2. 对话不丢
- 服务器对当前会话维护一个 **transcript 环形缓冲**（最近 N 条：user_echo/assistant/tool_use/tool_result/result），可落盘到 `session-log.json` 以跨重启。
- 手机连接时，`hello` 后补发 `history` 批量回放；前端按类型重建气泡/工具卡。
- 新建会话（切目录/换 effort）时清空并广播 `cleared`。

### 3. 桌面 Electron 托盘软件
- 新增 `electron/`（main.js + preload + 图标）。Electron 主进程 **spawn 现有 `node server.js`** 作为子进程（复用全部逻辑），并用 `BrowserWindow` 加载 `http://localhost:<port>/panel`。
- 关闭窗口 = 最小化到托盘（不退出）；托盘右键菜单：显示控制台 / 重新生成地址 / 开机自启开关 / 退出。
- 退出时确保 server + 隧道 + 防睡眠子进程一并结束。
- 打包用 `electron-builder` 出免安装 exe（portable）或安装包；图标用现有 `icon.svg` 转 ico。
- 兼容：`start.bat`（纯 Node 控制台）继续保留，Electron 是更好看的外壳。

### 4. 来消息推送
- 服务器在 **需要权限审批** 和 **任务完成(result)** 时，按配置 POST 到推送渠道。
- 渠道：通用 webhook，内置适配 **Bark / PushDeer / Server酱**（填一个 key/URL 即可），控制台里配置，存 `config.json`。
- 节流：同一事件合并，避免刷屏。可在控制台开关「仅在我离开时推」（无手机在线时才推）。

### 5. 发图片给 Claude
- 手机输入框旁加「＋」：拍照/选图 → 压缩为 base64 → 随该条指令作为 SDK 图片 content block 发送（`{type:'image',source:{type:'base64',media_type,data}}`）。
- 服务器把 prompt 改为支持 `content` 数组（文本 + 图片）。
- 控制台日志记录「📷 收到图片」。

### 6. 快捷指令按钮
- 输入框上方一排 chip，点了即填入/直接发送。
- 默认：继续 / 跑测试 / 提交代码 / 解释一下 / 修复报错。可在设置里增删，存 localStorage（手机端）。

### 7. UI 美化
- 手机端 + 控制台：配色层次、间距、圆角、过渡动效、图标统一；保持深色风格，提升精致度与可读性。不改变信息架构。

## 关键决定
- 推送：做**通用 webhook + 内置 Bark/PushDeer/Server酱 适配**，用户填一个即可（不锁死单一渠道）。
- 快捷指令：内置上面 5 个默认，且可自定义。
- 手机 App 不做原生、不依赖 Tailscale；用「离线壳 + App 内扫码」达成。

## 建议实现顺序（分步交付，每步可测）
A. 手机扫码 App（SW 离线壳 + 可配置后端 + 内置扫码）+ 对话不丢
B. Electron 托盘桌面软件
C. 来消息推送 + 发图片 + 快捷指令
D. 统一 UI 美化

## 不在本批范围
- 原生 HarmonyOS App；云服务器常驻 agent；Tailscale 固定地址（手机端暂不可装，搁置）；多并发会话。

## 测试方式
逐项本地起服务 + WebSocket 脚本验证；图片/扫码/推送在真机过一遍；Electron 单独验证托盘与子进程生命周期。
