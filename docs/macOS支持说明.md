# 🍎 macOS 支持说明

本项目原为 Windows 设计，本次改动让电脑端在 macOS 上完整可用。
**所有改动均为增量的 `darwin` 分支，Windows 行为一行未动。**

---

## 一、改了什么（给合并者看）

| 文件 | 改动 |
|---|---|
| `server.js` | ① 防睡眠加 darwin 分支（`caffeinate -is`，屏幕可熄、合盖仍睡）<br>② 截屏加 darwin 分支（系统自带 `screencapture -x -C -m` 抓主屏 + `sips` 缩到 1280 宽）<br>③ 远程控制加 darwin 分支（`cliclick` 注入鼠标键盘；Windows 记法的 `^c`/`{ENTER}` 等自动翻译成 ⌘C / return；中文输入走剪贴板+⌘V）<br>④ 新增 3 个电源指令：`sleepComputer`（深度睡眠，Win/Mac 都支持）、`displaySleep`/`wakeDisplay`（熄屏锁定/唤醒屏幕，Mac 专属）<br>⑤ 手机 hello 消息新增 `platform` 字段 |
| `public/index.html` | 设置面板新增「电源」区（熄屏锁定 / 唤醒屏幕 / 深度睡眠）；按键标签保持 Windows 原版 |
| `public/app.js` | ① 三个电源按钮的逻辑（睡眠有二次确认）<br>② `applyPlatform()`：后端是 darwin 时把按键标签动态换成 Mac 习惯（⌘C、⌘Tab、Spotlight、调度中心），并显示 Mac 专属电源按钮；Windows 后端界面不变 |
| `public/sw.js` | 缓存版本 v18 → v19 |
| `start.sh` | 新增：macOS/Linux 一键启动（对应 `start.bat`），内置 `NODE_USE_ENV_PROXY=1` 让 Node fetch 跟随系统代理（国内上报 workers.dev 中转站需要；无代理时无副作用） |

坐标系说明：手机发来的 rx/ry（0–1 比例）在 Mac 上乘以主屏**逻辑分辨率**
（`NSScreen.mainScreen`，经 JXA 读取，与 cliclick 同一坐标系），与截屏图像比例一致，点击不偏移。

## 二、Mac 上怎么装（给使用者看）

前置：Node.js ≥ 24、已登录的 Claude Code、Homebrew。

```sh
git clone https://github.com/Xichen-Zhang423/claude-remote ~/claude-remote
cd ~/claude-remote
brew install cloudflared cliclick
ln -s "$(which cloudflared)" cloudflared.exe   # server.js 按此文件名找隧道程序
./start.sh
```

### 必要的系统授权（系统设置 → 隐私与安全性）

| 权限 | 给谁 | 干什么用 |
|---|---|---|
| **屏幕录制** | 启动本服务的应用（Terminal / VS Code 等） | 截屏。没给的话图里只有壁纸没有窗口 |
| **辅助功能** | 同上 | cliclick 注入鼠标键盘 |

> 权限跟随「启动服务的那个应用」：从 Terminal 启动就给 Terminal，从 VS Code 内置终端启动就给 VS Code。换启动方式要重新授权。屏幕录制授权后需重启该应用。

## 三、Mac 与 Windows 功能对照

| 功能 | Windows | macOS |
|---|---|---|
| 手机聊天 / 权限审批 / 文件浏览 / 切模型 | ✅ | ✅ |
| 防睡眠 | ✅ PowerShell | ✅ caffeinate（合盖仍会睡） |
| 截屏 | ✅ ffmpeg/PS | ✅ screencapture（仅主屏） |
| 远程鼠标键盘 | ✅ PS | ✅ cliclick |
| 深度睡眠（手机遥控） | ✅ | ✅（睡后无法远程唤醒，需到电脑前） |
| 熄屏锁定 / 远程唤醒屏幕 | — | ✅ Mac 专属 |
| 开机自启脚本 | ✅ .bat | 暂无 |

## 四、已知限制

- **深度睡眠后无法远程唤醒**：隧道进程随系统挂起。想远程「下班再继续」，请用「熄屏锁定」而不是「睡眠」。
- 多显示器：截屏/点击只作用于主屏。
- 中文「输入文字到电脑」走剪贴板粘贴，会覆盖电脑当前剪贴板内容。
- MacBook 合盖会睡眠（系统强制，caffeinate 拦不住）；远程使用时保持开盖、屏幕可熄。
