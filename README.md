# 📱 手机遥控 Claude Code · Phone Remote for Claude Code

> 在电脑上跑一个小服务，手机就能远程指挥电脑里的 **Claude Code**：下指令、看流式输出、
> 一键同意 / 拒绝权限、看电脑实时屏幕，甚至把手机当触屏直接操控电脑。
> 再也不用守在电脑前一直点 yes。

用你 Claude Code 现有的登录驱动，**不需要单独的 API key**。电脑端一个 `node` 服务搞定 HTTP + WebSocket +
公网隧道 + 截屏 + 远程控制，**Windows 和 macOS 都支持**；手机端是一个网页（PWA），也可打包成安卓 APK / 鸿蒙原生应用。

---

### 🌍 English

Run a tiny server on your PC and drive **Claude Code** from your phone — anywhere.

- 📝 **Send prompts on the go** and watch live streaming output (incl. thinking).
- ✅ **Approve / deny permission requests with one tap** (or flip on full-auto).
- 🗂️ **Browse & resume** your desktop Claude Code conversations (saves tokens).
- 🖥️ **See your computer's live screen**, and 🖱️ **use your phone as a touchscreen** to control the PC (tap = click, long-press = right-click, pinch to zoom, full on-screen keyboard).
- 🌐 **Works from outside your network** via a built-in Cloudflare tunnel + a one-time-scan auto-reconnect rendezvous.

Uses your existing Claude Code login — **no separate API key needed**. The host runs on **Windows or macOS**. The phone client is a **PWA** (works on Android / iOS / HarmonyOS); it can also be packaged as an **Android APK** or a **native HarmonyOS (ArkTS) app**. On Windows, drop an `ffmpeg.exe` into the folder for signed, antivirus-friendly, DPI-correct screen capture.

> Detailed docs below are in Chinese — feel free to open an issue if you'd like an English walkthrough.

---

## ✨ 能干嘛

- 📝 **手机下指令**：在外面、在床上，用手机给电脑上的 Claude Code 派活，看它实时流式输出（含 thinking）。
- ✅ **远程批权限**：Claude 要执行命令 / 改文件时，权限弹到手机，一键 允许 / 拒绝 / 总是允许 / 全自动。
- 🗂️ **历史对话**：手机上能看到并续接电脑端 Claude Code 的所有历史会话（省 token），可重命名 / 删除 / 搜索。
- 🖥️ **看电脑屏幕**：手机上实时（连环抓帧）看电脑当前画面。
- 🖱️ **全屏远程控制**：手机变成电脑触屏——轻点单击、长按右键、双指缩放、侧边抽屉里有完整功能键（Alt+Tab 等）。
- 🎙️ **语音输入**、📎 **发图片**、⚡ **快捷命令**、🔍 **对话内搜索**、🌙 暗色 Markdown 界面。
- 💤 **远程电源管理**：手机上一键让电脑睡眠（收工用）；Mac 还支持「熄屏锁定」（屏幕关了电脑继续干活，随时远程唤醒屏幕继续）。
- 🌐 **出门也能连**：内置 Cloudflare 隧道 + 云端中转，扫一次码以后自动连，地址变了也不用重扫。
- 🍎 **Windows / macOS 双平台**：界面按平台自适应（Mac 后端时按键自动变成 ⌘ 组合、Spotlight、调度中心）。

---

## 🧩 项目结构

```
claude-remote/
├── server.js              # ★ 电脑端主程序（HTTP + WebSocket + 隧道 + 截屏 + 控制，一个文件全包，Win/Mac 通用）
├── package.json
├── start.bat              # ★ Windows 一键启动（在家 + 出门都用这个）
├── start-remote.bat       #   同上（保留别名）
├── 停止遥控.bat            #   Windows：彻底关掉本工具的所有后台进程（打游戏前用）
├── 设置开机自启.bat / 取消开机自启.bat   # 开 / 关 随 Windows 自启
├── 创建桌面图标.bat        #   Windows：生成桌面快捷方式
├── start.sh               # ★ macOS / Linux 一键启动（自动跟随系统代理）
├── 启动遥控.command        #   macOS：双击后台启动 + 自动弹出二维码控制台
├── 停止遥控.command        #   macOS：双击停止（服务 / 隧道 / 防睡眠一起清干净）
├── public/                # 手机网页端（PWA：index.html / app.js / styles.css / sw.js …）
├── scripts/               # 电脑端 PowerShell 小工具
│   ├── screenshot.ps1     #   截屏（兜底；优先用 ffmpeg）
│   ├── control.ps1        #   远程鼠标 / 键盘（DPI 感知，点对点精准）
│   └── getres.ps1         #   读物理分辨率
├── app-android/           # 安卓 APK 工程（Capacitor，云端 GitHub Actions 打包）
├── app-harmony/           # 纯血鸿蒙 NEXT 原生壳应用（ArkTS / DevEco）
├── cloudflare-worker/     # 免扫码「网址中转站」Worker 源码
├── docs/                  # 详细文档（使用教程 / APK 构建 / 免扫码连接）
├── legacy/                # 已弃用的早期实验（Tailscale 方案等，可忽略）
└── .github/workflows/     # 安卓 APK 云端自动构建
```

> ⚠️ `ffmpeg.exe`、`cloudflared.exe`、`config.json`、`conversations/` 不入库（见 `.gitignore`）——
> 二进制自行下载、`config.json` 含你的连接密钥不能公开。
> macOS 端的实现细节（截屏 / 控制 / 电源 / 权限）见 [docs/macOS支持说明.md](docs/macOS支持说明.md)。

---

## 🖥️ 电脑端（服务器）

### 跑起来

前提：电脑装了 [Node.js](https://nodejs.org) 和 Claude Code，并且 `claude` 已登录（平时用 VSCode 插件就说明已登录）。

#### 🪟 Windows

双击 **`start.bat`**，或在本文件夹打开终端：

```powershell
npm install   # 第一次才需要
npm start
```

#### 🍎 macOS

首次准备（终端里执行一次）：

```sh
brew install cloudflared cliclick          # 隧道工具 + 鼠标键盘注入工具
ln -s "$(which cloudflared)" cloudflared.exe   # server.js 按此文件名找隧道程序
```

日常使用：在 Finder 双击 **`启动遥控.command`**（后台运行，弹出的终端窗口可以关），
用完双击 **`停止遥控.command`**。也可在终端跑 `./start.sh`（Ctrl+C 停止）。

还需在 **系统设置 → 隐私与安全性** 给「启动服务的那个应用」（终端 / VS Code）授两个权限：
**屏幕录制**（截屏用，授权后要重启该应用）和 **辅助功能**（远程鼠标键盘用）。
注意权限跟着启动方式走：平时从终端双击启动，就给「终端」授权。

两个平台启动后都会自动：弹出控制台网页、生成二维码（同 WiFi 扫码直连）、起 Cloudflare 公网隧道（出门用）、防止电脑睡眠（Mac 上屏幕可正常熄灭、合盖仍会睡）。

### 电脑端都包含什么

| 模块 | 作用 |
|---|---|
| **`server.js`** | 唯一主程序。用 `@anthropic-ai/claude-agent-sdk` 驱动 Claude Code；提供给手机的 WebSocket（token 鉴权）；本机控制台（`/panel`）；多会话持久化 + 续接；自动起 / 重连 Cloudflare 隧道；截屏与远程控制的调度。 |
| **`scripts/screenshot.ps1`** | PowerShell 截屏兜底（**优先用 ffmpeg**，见下）。 |
| **`scripts/control.ps1`** | 把手机的点击 / 按键变成真实鼠标键盘动作（`SetCursorPos` + `mouse_event` + `keybd_event`，DPI 感知）。 |
| **`scripts/getres.ps1`** | 读屏幕物理分辨率，供截屏按真实尺寸抓全屏（修正高分屏缩放）。 |
| **`ffmpeg.exe`**（自行放入） | 抓屏首选。有数字签名、杀毒不拦、原生物理分辨率。没有它就退回 PowerShell 截屏。 |
| **`cloudflared.exe`**（自带） | Cloudflare 临时隧道，给手机一个公网 https 地址。 |
| **控制台网页 `public/panel.html`** | 电脑上自动打开的小窗：看二维码 / 公网地址 / 在线手机数 / 日志，可重开隧道、退出。 |

> 🍎 macOS 上不用 PowerShell / ffmpeg：截屏走系统自带 `screencapture`（缩到 1280 宽省流量）、
> 远程控制走 `cliclick`（手机发的 Ctrl+C / Alt+Tab 等自动翻译成 ⌘C / ⌘Tab）、防睡眠走 `caffeinate`。
> 详见 [docs/macOS支持说明.md](docs/macOS支持说明.md)。

---

## 📲 手机端：三种系统怎么装

> 三种系统都能用「网页版（PWA）」——手机浏览器打开电脑给的地址即可，能添加到主屏幕像个 App。
> 想要更原生的体验再按下面装。**首次连接**：用手机扫电脑控制台上的二维码（里面带了 token 和中转地址，扫一次以后自动连）。

### 🤖 安卓（Android）

- **网页版（最简单）**：Chrome 打开地址 → 菜单 →「**添加到主屏幕 / 安装应用**」。
- **APK（独立 App）**：把本仓库 `git push` 到 GitHub → 仓库 **Actions →「构建安卓 APK」** 自动打包（约 5–10 分钟）→
  在 **Artifacts** 下载 `claude-remote-apk` → 解压得到 `app-debug.apk` → 传手机安装。详见 [docs/APK构建说明.md](docs/APK构建说明.md)。

### 🍎 iPhone / iPad（iOS）

- iOS 只能用 **网页版（PWA）**（苹果不让装第三方安装包）：**Safari** 打开地址 → 分享 →「**添加到主屏幕**」。
- 注意：iOS 装 PWA 通常需要 **HTTPS**。家里局域网是 http，网页功能正常但装图标建议用自带的 **Cloudflare 隧道**（带 https）。

### 🟢 华为鸿蒙（HarmonyOS）

- **HarmonyOS 4 及更早**（能装安卓应用）：直接用上面的**安卓 APK**。
- **纯血鸿蒙 NEXT（5.x，装不了 APK）**：用 `app-harmony/` 里的**原生壳应用**——在 **DevEco Studio** 里编译安装，
  开 App 即走中转自动连电脑。完整步骤见 [app-harmony/使用教程-鸿蒙NEXT.md](app-harmony/使用教程-鸿蒙NEXT.md)。
- 嫌麻烦也可直接用**网页版**。

---

## 🌐 出门在外远程连接

电脑留在家，手机用流量也能连：

- **最简单**：启动脚本已内置 Cloudflare 隧道，启动即自动生成带 token 的二维码，手机扫一下就用。
- **免重扫（可选配一次）**：临时隧道地址每次重启会变。配一个 **Cloudflare Worker「中转站」**，电脑每次把新地址上报、
  手机打开先问中转站要当前地址——**扫一次以后永久自动连**。中转站只存网址、不存 token，安全。
  配置见 [docs/免扫码连接说明.md](docs/免扫码连接说明.md)。

### 💡 推荐工作流（按需开关，简单可靠）

服务不必常开。把它当成「出门才开的电闸」：

1. **出门前**：双击启动（Windows `start.bat` / Mac `启动遥控.command`）→ 控制台弹出二维码 → 手机扫一下 → 走人。
2. **在外面**：手机上指挥 Claude、批权限。页面被划掉了？重新打开浏览器即可——连接信息存在手机本地，
   只要电脑端还开着，**会自动重连，不用重新扫码**。
3. **干完活**：手机 ⚙ 设置 → 电源区：
   - Mac 推荐 **🌙 熄屏锁定**——屏幕关掉省电，电脑继续干活，之后随时 **☀️ 唤醒屏幕** 接着远程用；
   - 真收工就 **💤 让电脑睡眠**——注意睡眠后**无法远程唤醒**（隧道随系统挂起），要到电脑前才能弄醒。
4. **回家后**：双击停止（`停止遥控.bat` / `停止遥控.command`），公网入口关闭，干净省电。

> 每次重启服务隧道地址都会变，出门前重扫一次码即可——链路最短、最不容易出幺蛾子。

---

## 👀 看屏幕 + 远程控制

手机顶栏 🖥️ 看电脑屏幕；点 **🖱 全屏控制**，手机就变成电脑触屏：轻点=单击、长按=右键、双指缩放/拖动、
侧边 ⌨ 抽屉里有完整功能键（回车/Esc/方向/Ctrl 组合/Alt+Tab/Win 等）。

**截屏强烈建议放一个 `ffmpeg.exe` 到本文件夹**：
- 抓屏这个动作会被 **Windows Defender** 等杀毒的启发式当可疑行为拦掉（正经远程桌面软件也常被误报）；
- **ffmpeg 有数字签名、杀毒不拦**，且原生按物理分辨率抓全屏，高分屏缩放（如 125%）下也不会裁切、点击不偏。

下载（解压后取 `bin\ffmpeg.exe` 放进本文件夹）：<https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip>
（程序「有 ffmpeg.exe 就自动用、没有就退回 PowerShell 截屏」。）

不想下 ffmpeg，也可把本文件夹加进 Defender 排除项：设置 → 隐私和安全性 → Windows 安全中心 →
病毒和威胁防护 → 管理设置 → 排除项 → 文件夹。

> 🍎 **macOS 不需要 ffmpeg**：截屏用系统自带 `screencapture`，控制用 `cliclick`（`brew install cliclick`）。
> 只要给启动服务的应用授过「屏幕录制」和「辅助功能」两个权限即可（见上「跑起来」一节）。
> 限制：截屏 / 点击只作用于**主显示器**；中文输入走剪贴板粘贴（会覆盖电脑剪贴板）。

---

## 🎮 打游戏（CSGO / 瓦洛兰特）会闪退？

本工具会**模拟鼠标键盘 + 抓屏**——这正是游戏反作弊（瓦洛兰特 **Vanguard** 内核驱动、CS 的 **VAC**）严防的行为，
所以**工具运行时这类游戏会闪退**。解决：

1. 双击 **`停止遥控.bat`** 关掉本工具全部后台进程；
2. 玩之前若开过自启，先 `取消开机自启.bat`；
3. 这次先**重启一次电脑**再进游戏（Vanguard 开机时检查）。之后只要工具没在跑，游戏就正常。

---

## 🔒 安全须知

这等于把「在你电脑上执行命令」的能力开放到网络，请务必：

1. **保管好 `config.json` 里的 token**，别发到公开聊天 / 截图 / 仓库里（已在 `.gitignore`）。
2. 走 Cloudflare 隧道，别把 `8765` 端口裸奔转发到公网。
3. 不信任的网络别开「全自动」（全自动 = `--dangerously-skip-permissions`，Claude 会自动跑任意命令）。
4. 不用时关掉服务（控制台「退出」、`停止遥控.bat` 或 Mac 的 `停止遥控.command`）。

---

## ⚙️ 配置 `config.json`（首次启动自动生成，已 gitignore）

```json
{
  "port": 8765,
  "token": "自动生成的密钥",
  "cwd": "默认工作目录",
  "autoApprove": false,
  "model": null,
  "effort": "high",
  "rendezvous": { "url": "", "secret": "" }
}
```

- `token`：连接密钥，改了手机要用新 token 重连。
- `cwd`：Claude 默认操作的项目文件夹（手机里也能随时切）。
- `model` / `effort`：模型与思考档位（手机 ⚙ 里可改）。
- `rendezvous`：免扫码中转，见 [docs/免扫码连接说明.md](docs/免扫码连接说明.md)。
- 也支持环境变量覆盖：`PORT` / `TOKEN` / `CLAUDE_CWD` / `CLAUDE_MODEL`。

---

## ❓ 常见问题

- **手机连不上**：确认电脑端在跑；同 WiFi 走局域网地址；出门走隧道地址；Token 对不对（⚙ 里可重填或重扫）。
- **没反应 / 会话出错**：看电脑终端报错，多半是 `claude` 没登录——终端跑一次 `claude` 登录后再启动。
- **（Mac）截图里只有壁纸没有窗口**：没给「屏幕录制」权限。系统设置 → 隐私与安全性 → 屏幕录制 →
  勾选启动服务的应用（终端 / VS Code），然后重启该应用。
- **（Mac）远程点击没反应**：没装 cliclick（`brew install cliclick`）或没给「辅助功能」权限。
- **（Mac）控制台日志提示「上报云端中转失败」**：国内网络直连 workers.dev 不通。`start.sh` 会自动跟随
  系统代理（Clash 等），确认代理在跑、且用 `start.sh` / `启动遥控.command` 启动即可。
- **看屏幕用不了 / 提示 `ScriptContainedMaliciousContent`**：是 **Windows Defender** 拦了 PowerShell 抓屏。
  放个 `ffmpeg.exe` 进文件夹（推荐），或把文件夹加进 Defender 排除项。见上「看屏幕」一节。
- **手机上屏幕右 / 下被裁、点击偏右下**：高分屏缩放导致的 DPI 不一致，已自动按物理分辨率修正；放了 ffmpeg 更彻底。
- **想换端口**：改 `config.json` 的 `port`，或设环境变量 `PORT`。

---

## 📜 开源协议

MIT。随意使用 / 修改 / 分发，自负风险。详见 [LICENSE](LICENSE)。

---

> 技术栈：Node.js · Express · ws · @anthropic-ai/claude-agent-sdk · Cloudflare Tunnel/Workers · Capacitor · HarmonyOS ArkTS · PowerShell · ffmpeg · screencapture/cliclick/caffeinate (macOS)。
> 手把手图文教程见 [docs/使用教程.md](docs/使用教程.md)；macOS 细节见 [docs/macOS支持说明.md](docs/macOS支持说明.md)。
