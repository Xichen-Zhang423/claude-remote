# Phase A: 手机扫码 App + 对话不丢 实现计划

> **For agentic workers:** 本计划逐任务执行。项目无测试框架、非 git 仓库，故每个任务以「验证命令/真机检查」代替单测与提交（沿用本项目既有做法）。步骤用 `- [ ]` 跟踪。

**Goal:** 让手机端变成"点图标即开、App 内扫码连接、断线不丢对话"的独立 PWA。

**Architecture:** ① 服务器对当前会话维护内存 transcript 环形缓冲，手机连接后用 `history` 回放；新会话清空。② 手机端把 WS 后端地址改为 localStorage 可配置；Service Worker 外壳改 cache-first 以离线打开；内置 jsQR 扫码设置后端。

**Tech Stack:** Node ESM, Express 5, ws, Claude Agent SDK；前端原生 JS + Service Worker + getUserMedia + jsQR。

---

## File Structure

- Modify `server.js` — 加 transcript 缓冲、记录、`history` 回放、新会话清空。
- Modify `public/app.js` — 可配置后端、`history` 回放、扫码连接逻辑。
- Modify `public/index.html` — 加「扫码连接」按钮 + 摄像头扫码弹窗。
- Modify `public/styles.css` — 扫码弹窗样式。
- Modify `public/sw.js` — 外壳 cache-first + 加入 jsqr.min.js + 升版本。
- Create `public/jsqr.min.js` — 本地内置二维码识别库（不走 CDN）。

---

## Task 1: 服务器端对话缓冲 + 回放

**Files:** Modify `server.js`

- [ ] **Step 1: 加 transcript 缓冲与记录**（在 `broadcast` 定义附近）

```js
// 对话回放缓冲（当前会话）
const transcript = [];
const CONV_TYPES = new Set(["user_echo", "assistant", "thinking", "tool_use", "tool_result", "result"]);
function recordConv(obj) {
  if (!CONV_TYPES.has(obj.type)) return;
  transcript.push(obj);
  if (transcript.length > 250) transcript.shift();
}
```

在 `broadcast(obj)` 函数体最前面加一行 `recordConv(obj);`：

```js
function broadcast(obj) {
  recordConv(obj);
  const data = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}
```

- [ ] **Step 2: 新会话时清空缓冲**

在 `startSession(cwd)` 函数体开头（`stopSession()` 之后）加：

```js
  transcript.length = 0;
  broadcast({ type: "cleared" });
```

- [ ] **Step 3: 手机连接时回放**

在 `wssPhone.on("connection")` 里，发送 `hello` 之后、补发权限请求之前，加：

```js
  if (transcript.length) ws.send(JSON.stringify({ type: "history", events: transcript.slice() }));
```

- [ ] **Step 4: 验证**

```
启动: NO_PANEL=1 NO_TUNNEL=1 node server.js
脚本: 连 ws，发一条 prompt "say hi"，等 result；断开；重连；应收到 history 含 user_echo+assistant+result。
```
预期：第二次连接收到 `{type:"history", events:[...]}`，含刚才的对话。

---

## Task 2: 手机端回放 history

**Files:** Modify `public/app.js`

- [ ] **Step 1: 加 replayHistory，并在 handle() 里处理 history/cleared**

在 `handle(m)` 的 switch 里加两个 case：

```js
    case "history":
      replayHistory(m.events || []);
      break;
    case "cleared":
      messagesEl.innerHTML = ""; curAssistant = null; toolEls.clear();
      break;
```

在文件靠近渲染函数处新增：

```js
function replayHistory(events) {
  messagesEl.innerHTML = ""; curAssistant = null; toolEls.clear();
  for (const m of events) {
    switch (m.type) {
      case "user_echo": addMsg("user", m.text); curAssistant = null; break;
      case "assistant": curAssistant = addMsg("assistant", m.text); break;
      case "thinking": addMsg("thinking", "💭 " + m.text); curAssistant = null; break;
      case "tool_use": addToolCard(m.id, m.name, m.input); break;
      case "tool_result": addToolResult(m.toolUseId, m.content, m.isError); break;
      case "result": curAssistant = null; if (m.isError) addMsg("error", "✕ " + (m.result || "出错了")); break;
    }
  }
}
```

- [ ] **Step 2: 验证（真机/浏览器）**：发几条指令 → 刷新页面 → 应自动恢复之前的对话气泡与工具卡。

---

## Task 3: 本地内置 jsQR + 后端地址可配置

**Files:** Create `public/jsqr.min.js`；Modify `public/app.js`

- [ ] **Step 1: 下载 jsQR 到本地**

```powershell
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js" -OutFile "public\jsqr.min.js"
```
预期：文件存在、约 40–60KB，含 `function jsQR`。

- [ ] **Step 2: app.js 顶部改为可配置后端**

把现有 `params.get("token")` 处理块替换为（浏览器扫码进来时，把当前源记为后端）：

```js
const params = new URLSearchParams(location.search);
if (params.get("token")) {
  const b = { host: location.host, token: params.get("token"), secure: location.protocol === "https:" };
  localStorage.setItem("backend", JSON.stringify(b));
  localStorage.setItem("token", params.get("token"));
  history.replaceState(null, "", location.pathname);
}
function getBackend() {
  try { const b = JSON.parse(localStorage.getItem("backend")); if (b && b.host && b.token) return b; } catch {}
  const token = localStorage.getItem("token");
  if (token) return { host: localStorage.getItem("server") || location.host, token, secure: location.protocol === "https:" };
  return null;
}
function setBackendFromText(str) {
  const u = new URL(str.trim());
  const token = u.searchParams.get("token");
  if (!token) throw new Error("二维码里没有 token");
  const b = { host: u.host, token, secure: u.protocol === "https:" };
  localStorage.setItem("backend", JSON.stringify(b));
  localStorage.setItem("token", token);
  return b;
}
```

- [ ] **Step 3: connect() 用 getBackend() 拼地址**

把 `connect()` 开头取 token/proto/server 的逻辑替换为：

```js
function connect() {
  const b = getBackend();
  if (!b) { showScan(); addMsg("system", "请点「扫码连接」扫电脑控制台上的二维码"); return; }
  const proto = b.secure ? "wss" : "ws";
  try { ws = new WebSocket(`${proto}://${b.host}/ws?token=${encodeURIComponent(b.token)}`); }
  catch (e) { addMsg("error", "连接失败: " + e.message); scheduleReconnect(); return; }
  // ...（其余 onopen/onclose/onmessage 不变）
}
```

- [ ] **Step 4: 验证**：清掉 localStorage 后打开应提示扫码；带 `?token=` 打开应正常连上并把 backend 存进 localStorage（DevTools 查看）。

---

## Task 4: App 内摄像头扫码

**Files:** Modify `public/index.html`、`public/app.js`、`public/styles.css`

- [ ] **Step 1: index.html 引入 jsQR 并加扫码按钮 + 弹窗**

`<script src="app.js">` 前加：`<script src="jsqr.min.js"></script>`

在顶栏 `top-actions` 第一个位置加按钮：`<button id="scanBtn" class="icon-btn" aria-label="扫码连接">⛶</button>`

在 `</body>` 前加扫码弹窗：

```html
<div id="scanModal" class="modal hidden">
  <div class="modal-card">
    <div class="modal-title">扫码连接电脑</div>
    <video id="scanVideo" playsinline style="width:100%;border-radius:12px;background:#000"></video>
    <canvas id="scanCanvas" style="display:none"></canvas>
    <div class="hint" id="scanHint">把电脑控制台上的二维码对准取景框…</div>
    <button id="scanClose" class="btn-link">取消</button>
  </div>
</div>
```

- [ ] **Step 2: app.js 扫码逻辑**

```js
let scanStream = null, scanRAF = null;
function showScan() { $("scanModal").classList.remove("hidden"); startScan(); }
async function startScan() {
  const video = $("scanVideo"), canvas = $("scanCanvas"), ctx = canvas.getContext("2d");
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = scanStream; await video.play();
  } catch (e) { $("scanHint").textContent = "打不开摄像头: " + e.message + "（也可在浏览器里重新扫码打开）"; return; }
  const tick = () => {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height);
      if (code && code.data) { onScan(code.data); return; }
    }
    scanRAF = requestAnimationFrame(tick);
  };
  scanRAF = requestAnimationFrame(tick);
}
function stopScan() {
  if (scanRAF) cancelAnimationFrame(scanRAF), scanRAF = null;
  if (scanStream) scanStream.getTracks().forEach(t => t.stop()), scanStream = null;
  $("scanModal").classList.add("hidden");
}
function onScan(text) {
  try {
    setBackendFromText(text);
    stopScan();
    addMsg("system", "已扫码，正在连接…");
    if (ws) try { ws.close(); } catch {}
    connect();
  } catch (e) { $("scanHint").textContent = "二维码无效: " + e.message; }
}
$("scanBtn").onclick = showScan;
$("scanClose").onclick = stopScan;
```

- [ ] **Step 3: styles.css 加视频弹窗样式**（如需）：复用现有 `.modal`/`.modal-card`，无需额外样式即可；如视频过高加 `#scanVideo{max-height:60vh;object-fit:cover}`。

- [ ] **Step 4: 验证（真机 https）**：装到主屏幕→点图标→点 ⛶ →扫控制台二维码→连上。摄像头需 https（隧道源即 https，满足）。

---

## Task 5: Service Worker 外壳 cache-first（离线可开）

**Files:** Modify `public/sw.js`

- [ ] **Step 1: 升级缓存版本 + 加 jsqr + 外壳 cache-first**

```js
const CACHE = "claude-remote-v4";
const ASSETS = ["./", "./index.html", "./app.js", "./styles.css", "./manifest.webmanifest", "./icon.svg", "./jsqr.min.js"];
```

把 `fetch` 处理改为：导航/外壳走 cache-first（命中即用，后台顺带更新），其它 GET 维持网络优先：

```js
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/ws") || url.pathname.startsWith("/control")) return;
  const isShell = e.request.mode === "navigate" || ASSETS.some(a => url.pathname.endsWith(a.replace("./", "/")) || url.pathname === "/");
  if (isShell) {
    e.respondWith(
      caches.match(e.request).then(c => {
        const net = fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(k => k.put(e.request, cp)).catch(() => {}); return r; }).catch(() => c || caches.match("./index.html"));
        return c || net;
      })
    );
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
```

- [ ] **Step 2: 验证**：安装后断开服务器，点桌面图标——外壳应能离线打开并显示「扫码连接」提示，再扫码即可连上新地址。

---

## Self-Review

- **Spec 覆盖**：手机扫码 App（Task 3/4/5）、对话不丢（Task 1/2）均有任务。✓
- **占位符**：无 TODO/TBD；代码均完整给出。✓
- **类型一致**：`getBackend()/setBackendFromText()` 返回 `{host,token,secure}`，connect() 用同字段；`history` 事件类型与 `broadcast` 记录的 `CONV_TYPES` 一致。✓
- **范围**：仅 Phase A（不含 Electron/推送/发图/快捷指令/美化）。✓
