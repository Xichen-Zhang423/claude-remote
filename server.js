// 用手机远程控制电脑上的 Claude Code —— 服务器端
// 启动: npm start
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { exec, spawn, execSync } from "node:child_process";
import express from "express";
import { WebSocketServer } from "ws";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import { query } from "@anthropic-ai/claude-agent-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");

// ---------- 配置 ----------
function loadConfig() {
  let cfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch {
      console.warn("config.json 解析失败，使用默认配置");
    }
  }
  cfg.port = Number(process.env.PORT || cfg.port || 8765);
  cfg.token = process.env.TOKEN || cfg.token || randomBytes(16).toString("hex");
  cfg.cwd = process.env.CLAUDE_CWD || cfg.cwd || process.cwd();
  cfg.autoApprove = cfg.autoApprove ?? false;
  cfg.model = process.env.CLAUDE_MODEL || cfg.model || undefined;
  cfg.effort = cfg.effort || "high"; // low | medium | high | xhigh | max
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}
const config = loadConfig();

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.warn("保存 config.json 失败:", e.message);
  }
}

// 运行时状态（所有连接的手机共享同一个 Claude 会话）
const runtime = {
  autoApprove: config.autoApprove,
  cwd: config.cwd,
  busy: false,
  model: config.model || null,
  effort: config.effort || "high",
};

// ---------- 向所有手机广播 ----------
const clients = new Set();

// 对话回放缓冲（当前会话）：手机断线/刷新重连后用 history 补回
const transcript = [];
const CONV_TYPES = new Set(["user_echo", "assistant", "thinking", "tool_use", "tool_result", "result"]);
function recordConv(obj) {
  if (!CONV_TYPES.has(obj.type)) return;
  transcript.push(obj);
  if (transcript.length > 250) transcript.shift();
  // 第一条用户指令作为对话标题（新对话、尚未拿到 sessionId 时）
  if (obj.type === "user_echo" && !currentConvId && !pendingTitle) {
    const t = (obj.text || "").trim();
    pendingTitle = t ? (t.length > 30 ? t.slice(0, 30) + "…" : t) : (obj.images && obj.images.length ? "[图片对话]" : "新对话");
  }
  scheduleConvSave();
}

// ---------- 多会话持久化（可在手机上选历史对话续接，靠 SDK 的 resume）----------
const CONV_DIR = path.join(__dirname, "conversations");
try { fs.mkdirSync(CONV_DIR, { recursive: true }); } catch {}
const CONV_INDEX = path.join(CONV_DIR, "index.json");
let convIndex = (() => { try { return JSON.parse(fs.readFileSync(CONV_INDEX, "utf8")) || []; } catch { return []; } })();
let currentConvId = null;   // 当前对话的 SDK sessionId（拿到 system_init 后才有）
let pendingTitle = null;    // 新对话在拿到 sessionId 前暂存的标题
let convSaveTimer = null;

function saveConvIndex() { try { fs.writeFileSync(CONV_INDEX, JSON.stringify(convIndex, null, 2)); } catch {} }
function convFile(id) { return path.join(CONV_DIR, id.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json"); }
function loadConvEvents(id) { try { return JSON.parse(fs.readFileSync(convFile(id), "utf8")).events || []; } catch { return []; } }
function convListPayload() {
  return convIndex.slice().sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, cwd: c.cwd, current: c.id === currentConvId }));
}
function broadcastConvList() {
  const list = convListPayload();
  broadcast({ type: "conversations", list });
  broadcastControl({ type: "conversations", list });
}
function scheduleConvSave() {
  if (!currentConvId) return;
  clearTimeout(convSaveTimer);
  convSaveTimer = setTimeout(persistCurrentConv, 700);
}
function persistCurrentConv() {
  if (!currentConvId) return;
  let meta = convIndex.find((c) => c.id === currentConvId);
  const title = (meta && meta.title) || pendingTitle || "新对话";
  const createdAt = (meta && meta.createdAt) || Date.now();
  const updatedAt = Date.now();
  try { fs.writeFileSync(convFile(currentConvId), JSON.stringify({ id: currentConvId, title, createdAt, updatedAt, cwd: runtime.cwd, events: transcript.slice() })); } catch {}
  if (meta) { meta.updatedAt = updatedAt; meta.cwd = runtime.cwd; if (!meta.title) meta.title = title; }
  else { convIndex.unshift({ id: currentConvId, title, createdAt, updatedAt, cwd: runtime.cwd }); }
  saveConvIndex();
}
// SDK 会话记录是否还在磁盘上（~/.claude/projects/*/<id>.jsonl），用于判断能否真正续接上下文
function sdkSessionExists(id) {
  try {
    const base = path.join(os.homedir(), ".claude", "projects");
    if (!fs.existsSync(base)) return false;
    for (const d of fs.readdirSync(base)) {
      try { if (fs.existsSync(path.join(base, d, id + ".jsonl"))) return true; } catch {}
    }
  } catch {}
  return false;
}
function deleteConv(id) {
  convIndex = convIndex.filter((c) => c.id !== id);
  saveConvIndex();
  try { fs.unlinkSync(convFile(id)); } catch {}
  panelLog("已删除一个历史对话");
  if (currentConvId === id) { currentConvId = null; startSession(runtime.cwd, {}); }
  broadcastConvList();
}
function renameConv(id, title) {
  const t = (title || "").trim(); if (!t) return;
  const meta = convIndex.find((c) => c.id === id);
  if (meta) { meta.title = t; saveConvIndex(); }
  try { const f = convFile(id); const d = JSON.parse(fs.readFileSync(f, "utf8")); d.title = t; fs.writeFileSync(f, JSON.stringify(d)); } catch {}
  broadcastConvList();
}

function broadcast(obj) {
  recordConv(obj);
  const data = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

// ---------- 电脑控制面板 ----------
const controlClients = new Set();
function broadcastControl(obj) {
  const data = JSON.stringify(obj);
  for (const ws of controlClients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}
const logBuf = []; // 最近日志，给面板回放
function panelLog(msg) {
  const line = `[${new Date().toLocaleTimeString("zh-CN")}] ${msg}`;
  logBuf.push(line);
  if (logBuf.length > 200) logBuf.shift();
  broadcastControl({ type: "log", line });
}

// ---------- Cloudflare 隧道管理（供面板启停 / 换地址）----------
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const CF_EXE = path.join(__dirname2, "cloudflared.exe");
const tunnel = { proc: null, url: null, qr: null, status: "stopped" }; // status: stopped|starting|up

async function makeQrDataUrl(text) {
  try { return await QRCode.toDataURL(text, { width: 600, margin: 2 }); } catch { return null; }
}

async function setTunnelUrl(url) {
  tunnel.url = url;
  tunnel.status = "up";
  const full = `${url}/?token=${config.token}`;
  tunnel.qr = await makeQrDataUrl(full);
  panelLog("公网地址已就绪: " + url);
  broadcastControl({ type: "tunnel", status: "up", url, full, qr: tunnel.qr });
}

function startTunnel() {
  if (!fs.existsSync(CF_EXE)) { panelLog("未找到 cloudflared.exe，无法开隧道"); broadcastControl({ type: "tunnel", status: "stopped", error: "缺少 cloudflared.exe" }); return; }
  if (tunnel.proc) return;
  tunnel.status = "starting";
  tunnel.url = null;
  broadcastControl({ type: "tunnel", status: "starting" });
  panelLog("正在启动 Cloudflare 隧道…");
  const p = spawn(CF_EXE, ["tunnel", "--url", `http://localhost:${config.port}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  tunnel.proc = p;
  const scan = (buf) => {
    const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (m && tunnel.url !== m[0]) setTunnelUrl(m[0]);
  };
  p.stdout.on("data", scan);
  p.stderr.on("data", scan);
  p.on("error", (e) => panelLog("隧道启动失败: " + e.message));
  p.on("exit", () => {
    tunnel.proc = null;
    if (tunnel.status !== "stopped") { tunnel.status = "stopped"; tunnel.url = null; broadcastControl({ type: "tunnel", status: "stopped" }); panelLog("隧道已退出"); }
  });
}

function stopTunnel() {
  tunnel.status = "stopped";
  tunnel.url = null;
  tunnel.qr = null;
  if (tunnel.proc) { try { tunnel.proc.kill(); } catch {} tunnel.proc = null; }
  try { execSync("taskkill /F /IM cloudflared.exe", { stdio: "ignore", windowsHide: true }); } catch {}
  broadcastControl({ type: "tunnel", status: "stopped" });
  panelLog("隧道已停止");
}

function restartTunnel() {
  panelLog("重新生成公网地址…");
  if (tunnel.proc) { try { tunnel.proc.kill(); } catch {} tunnel.proc = null; }
  try { execSync("taskkill /F /IM cloudflared.exe", { stdio: "ignore", windowsHide: true }); } catch {}
  setTimeout(startTunnel, 800);
}

// 防睡眠（运行期间电脑不睡，屏幕可熄）
let keepAwakeProc = null;
function startKeepAwake() {
  if (process.platform !== "win32" || keepAwakeProc) return;
  const ps = [
    "$s = '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint e);';",
    "$t = Add-Type -MemberDefinition $s -Name P -Namespace W -PassThru;",
    "while($true){ [void]$t::SetThreadExecutionState(2147483649); Start-Sleep -Seconds 50 }",
  ].join(" ");
  try {
    keepAwakeProc = spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { stdio: "ignore", windowsHide: true });
    keepAwakeProc.on("error", () => {});
  } catch {}
}

function controlSnapshot() {
  return {
    type: "controlHello",
    port: config.port,
    token: config.token,
    cwd: runtime.cwd,
    model: runtime.model,
    effort: runtime.effort,
    autoApprove: runtime.autoApprove,
    phones: clients.size,
    tunnel: { status: tunnel.status, url: tunnel.url, full: tunnel.url ? `${tunnel.url}/?token=${config.token}` : null, qr: tunnel.qr },
    busy: runtime.busy,
    log: logBuf.slice(-100),
  };
}
function notifyPhones() { broadcastControl({ type: "phones", phones: clients.size }); }

// ---------- 待处理的权限请求 ----------
const pendingPermissions = new Map(); // id -> { resolve, name, input }

// 最近一次会话初始化信息（连接时补发给手机）
let lastInit = null;

// ---------- 输入队列（把手机发来的指令喂给 Claude）----------
class AsyncQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }
  push(item) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }
  close() {
    this.closed = true;
    let w;
    while ((w = this.waiters.shift())) w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: () => Promise.resolve({ value: undefined, done: true }),
    };
  }
}

// ---------- 权限回调：路由到手机，或全自动放行 ----------
async function canUseTool(toolName, input, opts) {
  const { signal, suggestions, title, description } = opts || {};
  if (runtime.autoApprove) {
    return { behavior: "allow", updatedInput: input };
  }
  const id = randomBytes(8).toString("hex");
  broadcast({
    type: "permission_request",
    id,
    name: toolName,
    input,
    title: title || `Claude 想要使用 ${toolName}`,
    description: description || "",
  });
  return await new Promise((resolve) => {
    const finish = (result) => {
      pendingPermissions.delete(id);
      resolve(result);
    };
    pendingPermissions.set(id, {
      name: toolName,
      input,
      resolve: (decision) => {
        if (decision === "allow") {
          finish({ behavior: "allow", updatedInput: input });
        } else if (decision === "always") {
          // 总是允许这个工具（本次会话内不再询问）
          finish({
            behavior: "allow",
            updatedInput: input,
            updatedPermissions: suggestions && suggestions.length ? suggestions : undefined,
          });
        } else if (decision === "auto") {
          // 从现在起全自动
          runtime.autoApprove = true;
          config.autoApprove = true;
          saveConfig();
          broadcast({ type: "auto", value: true });
          finish({ behavior: "allow", updatedInput: input });
        } else {
          finish({ behavior: "deny", message: "你在手机上拒绝了这个操作。" });
        }
      },
    });
    if (signal) {
      signal.addEventListener("abort", () => {
        if (pendingPermissions.has(id)) {
          pendingPermissions.delete(id);
          broadcast({ type: "permission_closed", id });
          resolve({ behavior: "deny", message: "已中断。" });
        }
      });
    }
  });
}

// ---------- Claude 会话 ----------
let session = null;

function startSession(cwd, opts = {}) {
  const resumeId = opts.resume || null;
  stopSession();
  if (!cwd || !fs.existsSync(cwd)) {
    const fallback = __dirname;
    broadcast({ type: "error", message: `工作目录不存在: ${cwd}，已临时切到 ${fallback}（可在设置里重新选）` });
    panelLog(`工作目录 ${cwd} 不存在，回退到 ${fallback}`);
    cwd = fallback;
  }
  runtime.cwd = cwd;
  config.cwd = cwd;
  saveConfig();

  // 续接已有对话：把保存的事件回放给手机；否则开新对话清空
  if (resumeId) {
    currentConvId = resumeId;
    pendingTitle = null;
    transcript.length = 0;
    for (const e of loadConvEvents(resumeId)) transcript.push(e);
    lastInit = null;
    broadcast({ type: "cleared" });
    if (transcript.length) broadcast({ type: "history", events: transcript.slice() });
  } else {
    currentConvId = null;
    pendingTitle = null;
    transcript.length = 0;
    lastInit = null;
    broadcast({ type: "cleared" });
  }

  const queue = new AsyncQueue();
  const abort = new AbortController();

  const options = {
    cwd,
    permissionMode: "default",
    canUseTool,
    abortController: abort,
    includePartialMessages: false,
    stderr: (data) => process.stderr.write(data),
  };
  if (runtime.model) options.model = runtime.model;
  if (runtime.effort) options.effort = runtime.effort;
  if (resumeId) {
    if (sdkSessionExists(resumeId)) {
      options.resume = resumeId; // 原始记录还在，带上完整上下文续接
    } else {
      options.sessionId = resumeId; // 原始上下文已被清理，复用同一 ID 开新会话，保持记录连续
      broadcast({ type: "notice", message: "这段对话的原始上下文已不在，继续将从当前内容开始" });
    }
  }

  const q = query({ prompt: queue, options });
  session = { queue, q, abort, cwd, restart: true, sawInit: false, resumeId };

  (async () => {
    try {
      for await (const msg of q) {
        handleSdkMessage(msg);
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("会话出错:", err);
        broadcast({ type: "error", message: "Claude 会话出错: " + (err?.message || String(err)) });
      }
    } finally {
      runtime.busy = false;
      const ended = session;
      const wasIntentional = !ended?.restart;
      if (session && session.q === q) session = null;
      broadcast({ type: "session_ended" });
      // 非主动停止时自动重启，保证手机随时能用；续接当前对话保留上下文
      if (!wasIntentional && !abort.signal.aborted) {
        // 续接失败（没拿到 init 就崩了）时退回新对话，避免一直崩溃重连
        const next = ended && ended.resumeId && !ended.sawInit ? {} : (currentConvId ? { resume: currentConvId } : {});
        setTimeout(() => { if (!session) startSession(runtime.cwd, next); }, 1500);
      }
    }
  })();

  broadcast({ type: "status", cwd, autoApprove: runtime.autoApprove, model: runtime.model });
  broadcastConvList();
  console.log("Claude 会话已启动，工作目录:", cwd, resumeId ? "（续接历史对话）" : "");
}

function stopSession() {
  if (session) {
    session.restart = false;
    try { session.abort.abort(); } catch {}
    try { session.queue.close(); } catch {}
    session = null;
  }
}

function truncate(str, n = 4000) {
  if (typeof str !== "string") str = String(str ?? "");
  return str.length > n ? str.slice(0, n) + `\n…(省略 ${str.length - n} 字)` : str;
}

function handleSdkMessage(msg) {
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        runtime.model = msg.model;
        if (session) session.sawInit = true;
        // 绑定/登记当前对话
        const sid = msg.session_id;
        if (sid) {
          if (currentConvId !== sid) {
            currentConvId = sid;
            if (!convIndex.find((c) => c.id === sid)) {
              convIndex.unshift({ id: sid, title: pendingTitle || "新对话", createdAt: Date.now(), updatedAt: Date.now(), cwd: runtime.cwd });
              saveConvIndex();
            }
          }
          pendingTitle = null;
          persistCurrentConv();
          broadcastConvList();
        }
        lastInit = {
          type: "system_init",
          model: msg.model,
          cwd: msg.cwd,
          tools: msg.tools,
          version: msg.claude_code_version,
          apiKeySource: msg.apiKeySource,
          sessionId: msg.session_id,
          convId: currentConvId,
        };
        broadcast(lastInit);
      }
      break;

    case "assistant": {
      runtime.busy = true;
      const blocks = msg.message?.content || [];
      for (const b of blocks) {
        if (b.type === "text" && b.text?.trim()) {
          broadcast({ type: "assistant", text: b.text });
        } else if (b.type === "tool_use") {
          broadcast({ type: "tool_use", id: b.id, name: b.name, input: b.input });
          panelLog("🔧 工具 " + b.name);
        } else if (b.type === "thinking" && b.thinking?.trim()) {
          broadcast({ type: "thinking", text: b.thinking });
        }
      }
      break;
    }

    case "user": {
      const blocks = msg.message?.content || [];
      for (const b of blocks) {
        if (b && b.type === "tool_result") {
          let content = b.content;
          if (Array.isArray(content)) {
            content = content
              .map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
              .join("\n");
          }
          broadcast({
            type: "tool_result",
            toolUseId: b.tool_use_id,
            content: truncate(content),
            isError: !!b.is_error,
          });
        }
      }
      break;
    }

    case "result": {
      runtime.busy = false;
      broadcast({
        type: "result",
        subtype: msg.subtype,
        isError: !!msg.is_error,
        result: msg.subtype === "success" ? msg.result : (msg.errors?.join("\n") || msg.subtype),
        cost: msg.total_cost_usd,
        durationMs: msg.duration_ms,
        numTurns: msg.num_turns,
      });
      panelLog("✅ 完成" + (msg.total_cost_usd ? ` ($${msg.total_cost_usd.toFixed(3)})` : ""));
      break;
    }
  }
}

// ---------- 手机发来指令 ----------
function sendPrompt(text, images) {
  if (!session) startSession(runtime.cwd);
  if (!session) return;
  const imgs = Array.isArray(images) ? images : [];
  let content;
  if (imgs.length) {
    content = [];
    if (text) content.push({ type: "text", text });
    for (const img of imgs) {
      const m = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(img);
      if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    }
    if (!content.length) content = text || "";
  } else {
    content = text;
  }
  session.queue.push({
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
  });
  broadcast({ type: "user_echo", text, images: imgs.length ? imgs : undefined });
  const label = text ? (text.length > 36 ? text.slice(0, 36) + "…" : text) : `[图片 ${imgs.length} 张]`;
  panelLog("💬 指令: " + label);
}

async function interrupt() {
  if (session?.q?.interrupt) {
    try {
      await session.q.interrupt();
      broadcast({ type: "interrupted" });
    } catch (e) {
      broadcast({ type: "error", message: "中断失败: " + e.message });
    }
  }
}

// ---------- 手机端文件夹浏览 / 新建 ----------
function listDrives() {
  const drives = [];
  if (process.platform === "win32") {
    for (let c = 65; c <= 90; c++) {
      const d = String.fromCharCode(c) + ":\\";
      try { if (fs.existsSync(d)) drives.push({ name: d, path: d, isDir: true }); } catch {}
    }
  } else {
    drives.push({ name: "/", path: "/", isDir: true });
  }
  return drives;
}

function sendDirList(ws, p) {
  try {
    if (!p || p === "drives") {
      ws.send(JSON.stringify({ type: "dirList", path: "drives", parent: null, isDrives: true, entries: listDrives() }));
      return;
    }
    const abs = path.resolve(p);
    const dirents = fs.readdirSync(abs, { withFileTypes: true });
    const entries = [];
    for (const de of dirents) {
      let isDir = de.isDirectory();
      if (de.isSymbolicLink()) {
        try { isDir = fs.statSync(path.join(abs, de.name)).isDirectory(); } catch { isDir = false; }
      }
      entries.push({ name: de.name, path: path.join(abs, de.name), isDir });
      if (entries.length >= 800) break;
    }
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    const parent = path.dirname(abs);
    const atDriveRoot = parent === abs; // 例如 D:\ 的上一级还是 D:\
    ws.send(JSON.stringify({ type: "dirList", path: abs, parent: atDriveRoot ? "drives" : parent, isDrives: false, entries }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "dirError", message: "打不开: " + e.message, path: p }));
  }
}

function doMkdir(ws, p, name) {
  try {
    if (!p || p === "drives") throw new Error("请先进入某个盘或文件夹");
    if (!name || /[\\/:*?"<>|]/.test(name)) throw new Error("文件夹名不能含 \\ / : * ? \" < > |");
    fs.mkdirSync(path.join(path.resolve(p), name));
    sendDirList(ws, p);
  } catch (e) {
    ws.send(JSON.stringify({ type: "dirError", message: "新建失败: " + e.message, path: p }));
  }
}

// ---------- HTTP + WebSocket ----------
const app = express();
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);

// 控制面板页面
app.get("/panel", (req, res) => res.sendFile(path.join(__dirname, "public", "panel.html")));

// /ws 给手机（token 鉴权）；/control 给本机控制面板（仅 localhost，免 token）
const wssPhone = new WebSocketServer({ noServer: true });
const wssControl = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  let pathname = "/";
  try { pathname = new URL(req.url, "http://localhost").pathname; } catch {}
  if (pathname === "/ws") {
    wssPhone.handleUpgrade(req, socket, head, (ws) => wssPhone.emit("connection", ws, req));
  } else if (pathname === "/control") {
    const addr = req.socket.remoteAddress || "";
    if (addr === "::1" || addr === "127.0.0.1" || addr.startsWith("::ffff:127.")) {
      wssControl.handleUpgrade(req, socket, head, (ws) => wssControl.emit("connection", ws, req));
    } else { socket.destroy(); }
  } else {
    socket.destroy();
  }
});

// 手机 / 面板通用的设置类指令
function handleCommon(m, ws) {
  switch (m.type) {
    case "setAuto":
      runtime.autoApprove = !!m.value;
      config.autoApprove = runtime.autoApprove;
      saveConfig();
      broadcast({ type: "auto", value: runtime.autoApprove });
      broadcastControl({ type: "auto", value: runtime.autoApprove });
      panelLog("全自动: " + (runtime.autoApprove ? "开" : "关"));
      return true;
    case "setCwd":
      if (typeof m.path === "string" && m.path.trim()) { startSession(m.path.trim()); panelLog("工作目录切换: " + m.path.trim()); }
      return true;
    case "setModel":
      if (typeof m.model === "string" && m.model) {
        runtime.model = m.model;
        config.model = m.model;
        saveConfig();
        if (session?.q?.setModel) session.q.setModel(m.model).catch((e) => broadcast({ type: "error", message: "切换模型失败: " + e.message }));
        broadcast({ type: "optionChanged", model: runtime.model, effort: runtime.effort });
        broadcastControl({ type: "optionChanged", model: runtime.model, effort: runtime.effort });
        panelLog("模型切换: " + m.model);
      }
      return true;
    case "setEffort":
      if (typeof m.effort === "string" && ["low", "medium", "high", "xhigh", "max"].includes(m.effort)) {
        runtime.effort = m.effort;
        config.effort = m.effort;
        saveConfig();
        startSession(runtime.cwd, currentConvId ? { resume: currentConvId } : {}); // 重开但保留当前对话上下文
        broadcast({ type: "optionChanged", model: runtime.model, effort: runtime.effort, restarted: true });
        broadcastControl({ type: "optionChanged", model: runtime.model, effort: runtime.effort, restarted: true });
        panelLog("思考档位: " + m.effort + "（已重开会话·保留上下文）");
      }
      return true;
    case "listDir":
      sendDirList(ws, m.path);
      return true;
    case "mkdir":
      doMkdir(ws, m.path, m.name);
      return true;
    case "listConversations":
      ws.send(JSON.stringify({ type: "conversations", list: convListPayload() }));
      return true;
    case "loadConversation":
      if (m.id) {
        const meta = convIndex.find((c) => c.id === m.id);
        const cwd = meta && meta.cwd && fs.existsSync(meta.cwd) ? meta.cwd : runtime.cwd;
        startSession(cwd, { resume: m.id });
        panelLog("载入历史对话: " + (meta ? meta.title : m.id));
      }
      return true;
    case "newConversation":
      startSession(runtime.cwd, {});
      panelLog("开始新对话");
      return true;
    case "deleteConversation":
      if (m.id) deleteConv(m.id);
      return true;
    case "renameConversation":
      if (m.id) renameConv(m.id, m.title);
      return true;
  }
  return false;
}

wssPhone.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");
  if (token !== config.token) {
    try { ws.send(JSON.stringify({ type: "error", message: "Token 错误，拒绝连接" })); } catch {}
    ws.close(4001, "unauthorized");
    return;
  }
  clients.add(ws);
  notifyPhones();
  panelLog(`一台手机已连接（共 ${clients.size} 台）`);
  ws.send(JSON.stringify({
    type: "hello",
    cwd: runtime.cwd,
    autoApprove: runtime.autoApprove,
    busy: runtime.busy,
    model: runtime.model,
    effort: runtime.effort,
    convId: currentConvId,
  }));
  if (lastInit) ws.send(JSON.stringify(lastInit));
  if (transcript.length) ws.send(JSON.stringify({ type: "history", events: transcript.slice() }));
  ws.send(JSON.stringify({ type: "conversations", list: convListPayload() }));
  for (const [id, p] of pendingPermissions) {
    ws.send(JSON.stringify({ type: "permission_request", id, name: p.name, input: p.input, title: `Claude 想要使用 ${p.name}` }));
  }

  ws.on("message", (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (handleCommon(m, ws)) return;
    switch (m.type) {
      case "prompt": {
        const t = typeof m.text === "string" ? m.text.trim() : "";
        const imgs = Array.isArray(m.images)
          ? m.images.filter((x) => typeof x === "string" && x.startsWith("data:image/")).slice(0, 4)
          : [];
        if (t || imgs.length) sendPrompt(t, imgs);
        break;
      }
      case "permission": {
        const p = pendingPermissions.get(m.id);
        if (p) { p.resolve(m.decision); broadcast({ type: "permission_closed", id: m.id }); }
        break;
      }
      case "interrupt":
        interrupt();
        break;
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;
    }
  });

  ws.on("close", () => { clients.delete(ws); notifyPhones(); panelLog(`一台手机断开（剩 ${clients.size} 台）`); });
  ws.on("error", () => { clients.delete(ws); notifyPhones(); });
});

wssControl.on("connection", (ws) => {
  controlClients.add(ws);
  ws.send(JSON.stringify(controlSnapshot()));
  ws.on("message", (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (handleCommon(m, ws)) return;
    switch (m.type) {
      case "restartTunnel": restartTunnel(); break;
      case "startTunnel": startTunnel(); break;
      case "stopTunnel": stopTunnel(); break;
      case "interrupt": interrupt(); break;
      case "shutdown": broadcastControl({ type: "bye" }); setTimeout(shutdownAll, 200); break;
      case "ping": ws.send(JSON.stringify({ type: "pong" })); break;
    }
  });
  ws.on("close", () => controlClients.delete(ws));
  ws.on("error", () => controlClients.delete(ws));
});

// ---------- 启动 ----------
// 选出真正能让手机访问的局域网 IP：跳过代理/虚拟网卡和无效地址，按可达性排序
function getLanCandidates() {
  const bad = /(vethernet|wsl|docker|vmware|virtualbox|hyper-?v|loopback|tailscale|zerotier|tap|tun|蓝牙|bluetooth|xray|clash|v2ray|proxy|virtual)/i;
  const good = /(wlan|wi-?fi|wireless|无线|以太网|ethernet)/i;
  const list = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family !== "IPv4" || i.internal) continue;
      if (i.address.startsWith("169.254.")) continue; // APIPA 自分配地址，无效
      let score = 0;
      if (good.test(name)) score += 10;
      if (bad.test(name)) score -= 20;
      if (i.address.startsWith("192.168.")) score += 6;
      else if (i.address.startsWith("10.")) score += 4;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(i.address)) score += 1;
      list.push({ ip: i.address, name, score });
    }
  }
  list.sort((a, b) => b.score - a.score);
  return list;
}

function openFile(p) {
  try {
    if (process.platform === "win32") exec(`start "" "${p}"`);
    else if (process.platform === "darwin") exec(`open "${p}"`);
    else exec(`xdg-open "${p}"`);
  } catch {}
}
function openUrl(u) {
  try {
    if (process.platform === "win32") exec(`start "" "${u}"`);
    else if (process.platform === "darwin") exec(`open "${u}"`);
    else exec(`xdg-open "${u}"`);
  } catch {}
}
// 用 Edge/Chrome 的「应用模式」把控制台开成独立窗口（无浏览器边框，像个 App）；找不到就退回默认浏览器
function openPanelApp(u) {
  if (process.platform !== "win32") return openUrl(u);
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const la = process.env["LOCALAPPDATA"] || "";
  const exes = [
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
    `${la}\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  for (const exe of exes) {
    try {
      if (exe && fs.existsSync(exe)) {
        const p = spawn(exe, [`--app=${u}`, "--window-size=1040,780"], { detached: true, stdio: "ignore" });
        p.on("error", () => {});
        p.unref();
        return;
      }
    } catch {}
  }
  openUrl(u);
}

// 启动前自清理：杀掉残留旧隧道 + 顶掉占用本端口的旧实例（孤儿进程）
function freePortAndStrayTunnels() {
  if (process.platform !== "win32") return;
  try { execSync("taskkill /F /IM cloudflared.exe", { stdio: "ignore", windowsHide: true }); } catch {}
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8", windowsHide: true });
    const re = new RegExp(":" + config.port + "\\b");
    const pids = new Set();
    for (const line of out.split("\n")) {
      if (/LISTENING/i.test(line) && re.test(line)) {
        const cols = line.trim().split(/\s+/);
        const pid = cols[cols.length - 1];
        if (pid && pid !== "0" && pid !== String(process.pid)) pids.add(pid);
      }
    }
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore", windowsHide: true }); console.log(`（已顶替占用 ${config.port} 端口的旧实例 PID ${pid}）`); } catch {}
    }
  } catch {}
}

let fatalHandled = false;
function onFatalListenError(err) {
  if (fatalHandled) return;
  fatalHandled = true;
  if (err && err.code === "EADDRINUSE") {
    console.error(`\n❌ 端口 ${config.port} 已被占用，启动失败。`);
    console.error("   多半是已经开着一个本程序（另一个黑窗口）。");
    console.error("   解决：关掉那个旧窗口再启动；或用「一键远程」start-remote.bat（会自动顶替旧的）；");
    console.error(`   也可以在 config.json 里把 "port" 改成别的（比如 8766）。\n`);
  } else {
    console.error("\n服务器启动失败:", err);
  }
  process.exit(1);
}
// 端口被占时自动重试几次（应对旧进程刚关、端口还没释放的竞态），多次失败才友好报错
let listenAttempts = 0;
const MAX_LISTEN_ATTEMPTS = 8;
function onListenError(err) {
  if (err && err.code === "EADDRINUSE" && listenAttempts < MAX_LISTEN_ATTEMPTS) {
    listenAttempts++;
    console.log(`端口 ${config.port} 暂时被占用，1 秒后重试 (${listenAttempts}/${MAX_LISTEN_ATTEMPTS})…`);
    setTimeout(() => { try { server.listen(config.port, "0.0.0.0"); } catch {} }, 1000);
    return;
  }
  onFatalListenError(err);
}
server.on("error", onListenError);
wssPhone.on("error", () => {});
wssControl.on("error", () => {});

freePortAndStrayTunnels();
server.on("listening", onListening);
server.listen(config.port, "0.0.0.0");

async function onListening() {
  const cands = getLanCandidates();
  const panelUrl = `http://localhost:${config.port}/panel`;

  // 启动时自动续接最近一次对话，避免每次都从零开始
  const recent = convListPayload()[0];
  if (recent) {
    const cwd = recent.cwd && fs.existsSync(recent.cwd) ? recent.cwd : runtime.cwd;
    startSession(cwd, { resume: recent.id });
  } else {
    startSession(runtime.cwd, {});
  }
  startKeepAwake();
  if (!process.env.NO_TUNNEL) startTunnel();

  console.log("\n========================================");
  console.log("  📱 手机控制 Claude Code 控制台已启动");
  console.log("========================================\n");
  console.log("工作目录 :", runtime.cwd);
  console.log("控制台   :", panelUrl, "（已自动在浏览器打开）");
  if (cands.length) console.log("局域网   :", `http://${cands[0].ip}:${config.port}/?token=${config.token}`);
  panelLog("服务已启动，工作目录 " + runtime.cwd);

  if (!process.env.NO_PANEL) openPanelApp(panelUrl);

  console.log("\n出门用公网地址：等控制台里的二维码出现后用手机扫。");
  console.log("关掉本窗口或按 Ctrl+C 即停止全部。\n");
}

function shutdownAll() {
  console.log("\n正在停止…");
  try { stopSession(); } catch {}
  try { stopTunnel(); } catch {}
  try { keepAwakeProc && keepAwakeProc.kill(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdownAll);
