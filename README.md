# 📱 手机遥控 Claude Code

在电脑上跑一个小服务器，用 **Claude Agent SDK** 驱动你已经登录的 Claude Code，
手机打开网页（可装到主屏幕，像个 App）就能下指令、看输出、**远程一键同意/拒绝**权限——
再也不用守在电脑前一直点 yes。

- ✅ 用你 Claude Code 现有的登录，**不需要**单独的 API key
- ✅ 手机端是 PWA，可“添加到主屏幕”，iOS / 安卓通用
- ✅ 权限请求弹到手机上，一键允许 / 拒绝 / 总是允许 / 全自动
- ✅ Token 鉴权
- ✅ 局域网直连 + 出门在外（Cloudflare Tunnel / Tailscale）

---

## 1. 启动（电脑端）

确保电脑装了 [Node.js](https://nodejs.org) 和 Claude Code，并且 `claude` 已登录
（你平时用 VSCode 插件就说明已经登录了）。

双击 **`start.bat`**，或在本文件夹打开终端运行：

```powershell
npm install   # 第一次才需要
npm start
```

启动后终端会显示：
- 一个**二维码** + 链接（同一 WiFi 下手机扫码直接打开）
- 你的 **Token**

> 服务器默认监听 `8765` 端口，工作目录默认是本文件夹。

---

## 2. 手机连接

### 在家（同一个 WiFi）
手机扫终端里的二维码，或在手机浏览器输入终端显示的“同一WiFi”链接
（形如 `http://192.168.x.x:8765/?token=xxxx`）。打开后即连上。

### 装成 App（推荐）
打开网页后：
- **安卓 Chrome**：菜单 →「添加到主屏幕 / 安装应用」
- **iPhone Safari**：分享 →「添加到主屏幕」

> 注：iOS 要安装成 PWA，页面通常需要 **HTTPS**。家里走局域网是 http，
> 网页功能完全正常，但要装成图标 App 建议用下面的 Cloudflare 隧道（自带 https）。

---

## 3. 出门在外远程控制

> **最简单：双击 [`start-remote.bat`](start-remote.bat)**（本项目已自带 `cloudflared.exe`）。
> 它会自动起服务器+隧道、抓公网 https 地址、弹出二维码 `qr-remote.png`，扫码即用。
> 在家、出门（手机流量）都能连，不用动防火墙。注意：临时隧道网址每次重启会变；那个黑窗口别关。
> 下面是手动方式和原理。

电脑留在家，手机用流量/外网也能连。二选一：

### 方案 A：Cloudflare Tunnel（最简单，自带 HTTPS）
1. 下载 `cloudflared`：<https://github.com/cloudflare/cloudflared/releases>
   （Windows 下载 `cloudflared-windows-amd64.exe`，可改名 `cloudflared.exe`）
2. 先 `npm start` 把本服务跑起来，再另开一个终端：
   ```powershell
   cloudflared tunnel --url http://localhost:8765
   ```
3. 它会给你一个 `https://xxxx.trycloudflare.com` 公网地址。
   - **扫二维码的话，token 和 xxxx 都不用管**——二维码里已经把完整网址（含 token）打包好了，扫了直接能用。
   - 只有「手动输网址」时才需要拼完整：把 `xxxx` 换成它实际给你的那串、把 `你的Token` 换成 `config.json` 里的 token，
     即 `https://实际地址.trycloudflare.com/?token=实际token`。Token 必须带上，否则连不上——这就是你的安全锁。

> 用 `start-remote.bat` 全自动跑这一套，省得手动开两个终端。
> 这种临时隧道每次地址会变。要**永久固定网址**见下方「进阶：固定网址」。

### 方案 B：Tailscale（组私有网络，更稳更安全）
1. 电脑和手机都装 [Tailscale](https://tailscale.com) 并登录同一账号。
2. 看电脑的 Tailscale IP（形如 `100.x.x.x`）。
3. 手机访问 `http://100.x.x.x:8765/?token=你的Token`。

---

## 4. 权限：解决“老是点 yes”

右上角有个 **「全自动」** 开关，以及每次权限请求弹窗里的四个选择：

| 选项 | 含义 |
|---|---|
| **允许** | 放行这一次 |
| **拒绝** | 不执行 |
| **总是允许此工具** | 本次会话内这个工具不再问 |
| **从现在起全自动** | 打开全自动，之后都不问（= `--dangerously-skip-permissions`）|

- **全自动关**（默认）：危险操作（执行命令、改文件）会弹到手机让你点。只读操作不打扰你。
- **全自动开**：Claude 自动执行一切。最省事，但它能在你电脑上跑任意命令，**确认环境可信再开**。

可随时在顶栏开关切换。设置会记到 `config.json`。

---

## 5. 切换工作目录

点右上角 ⚙ → 填「工作目录」→「切换工作目录」。
Claude 之后就在那个文件夹里干活（读写文件、跑命令都在该目录）。

---

## 6. 配置 `config.json`

第一次启动会自动生成：

```json
{
  "port": 8765,
  "token": "自动生成的密钥",
  "cwd": "默认工作目录",
  "autoApprove": false,
  "model": null
}
```

- `token`：改成你喜欢的字符串也行，改完手机要重新用新 token 连。
- `cwd`：默认工作目录。
- `model`：留 `null` 用默认；想指定可填 `"claude-opus-4-8"` 等。
- 也支持环境变量覆盖：`PORT` / `TOKEN` / `CLAUDE_CWD` / `CLAUDE_MODEL`。

---

## 7. 安全须知 ⚠️

这等于把“在你电脑上执行命令”的能力开放到网络上，请务必：

1. **保管好 Token**，不要发到公开聊天/截图里。
2. 用 Cloudflare/Tailscale，不要直接把 `8765` 端口转发到公网裸奔。
3. 不信任的网络环境下，别开「全自动」。
4. 不用时把服务器关掉（终端 Ctrl+C）。

---

## 常见问题

- **手机打开是空白/连不上**：确认手机和电脑同一 WiFi；电脑防火墙可能拦了 8765 端口，
  允许 Node.js 通过专用网络；或改用 Cloudflare 隧道。
- **提示 Token 错误**：点 ⚙ 重新填 Token，或重新扫码（链接里带最新 token）。
- **没反应/会话出错**：看电脑终端的报错。多半是 `claude` 没登录——
  在终端运行一次 `claude` 登录后再启动。
- **想换端口**：改 `config.json` 的 `port`，或设环境变量 `PORT`。
