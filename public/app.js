"use strict";

// 界面版本号：手机上打开 ⚙ 设置能看到，用来确认是不是已经更新到最新代码
const APP_VERSION = "v2.1（实时画面）";
console.log("Claude Remote UI", APP_VERSION);

// ---------- 取出/保存连接信息 ----------
const params = new URLSearchParams(location.search);
if (params.get("token")) {
  // 浏览器扫码进来：当前页面源就是后端；rz 是云端中转地址（免扫码用）
  const b = { host: location.host, token: params.get("token"), secure: location.protocol === "https:", rz: params.get("rz") || "" };
  localStorage.setItem("backend", JSON.stringify(b));
  localStorage.setItem("token", params.get("token"));
  history.replaceState(null, "", location.pathname);
}
// 后端地址（host+token）独立于当前页面源，可由 App 内扫码设置
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
  const rz = u.searchParams.get("rz") || "";
  const b = { host: u.host, token, secure: u.protocol === "https:", rz };
  localStorage.setItem("backend", JSON.stringify(b));
  localStorage.setItem("token", token);
  return b;
}
function getToken() { const b = getBackend(); return b ? b.token : ""; }

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const inputEl = $("input");
const sendBtn = $("sendBtn");
const stopBtn = $("stopBtn");
const dot = $("dot");
const autoToggle = $("autoToggle");
const quickBar = $("quickBar");
const attachBar = $("attachBar");
const toBottomBtn = $("toBottom");
const emptyState = $("emptyState");

let ws = null;
let connected = false;
let busy = false;
let reconnectTimer = null;
let curAssistant = null;          // 当前正在累积的 assistant 气泡
let curThinking = null;           // 当前正在累积的思考气泡（流式用）
const toolEls = new Map();        // tool_use_id -> 卡片元素
let currentCwd = "";              // 当前工作目录
let browseCur = "";               // 浏览器当前所在路径
let browseParent = null;          // 浏览器上一级路径
let pendingImages = [];           // 待发送的图片（data URL）
let stickToBottom = true;         // 是否自动吸附到底部
let curConvId = null;             // 当前对话 ID
let convCache = [];               // 最近一次会话列表

// ---------- 渲染 ----------
function updateEmptyState() {
  // 除空状态占位本身外没有别的子节点时显示提示
  const hasMsg = Array.from(messagesEl.children).some((c) => c !== emptyState);
  if (emptyState) emptyState.classList.toggle("hidden", hasMsg);
}
function scrollToBottom(force) {
  if (!force && !stickToBottom) return;
  requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
}
function addMsg(cls, text) {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.textContent = text;
  messagesEl.appendChild(div);
  updateEmptyState();
  scrollToBottom();
  return div;
}

// ---------- 安全转义 + 轻量 Markdown ----------
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// 行内：`code` **粗** *斜* [文字](链接)
function mdInline(s) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}
// 块级：代码围栏、标题、列表、引用、段落
function mdToHtml(src) {
  const text = String(src ?? "");
  const out = [];
  const parts = text.split(/```/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      // 代码块
      const seg = parts[i].replace(/^[^\n]*\n?/, (m) => (/^[a-zA-Z0-9_+-]*\n?$/.test(m) ? "" : m));
      out.push(`<div class="code-wrap"><button class="code-copy" type="button">复制</button><pre class="code-block"><code>${escapeHtml(seg.replace(/\n$/, ""))}</code></pre></div>`);
      continue;
    }
    const lines = parts[i].split("\n");
    let list = null; // 'ul' | 'ol'
    const flush = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) { flush(); continue; }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flush(); out.push(`<h4 class="md-h">${mdInline(m[2])}</h4>`); }
      else if ((m = /^[-*]\s+(.*)$/.exec(line))) { if (list !== "ul") { flush(); out.push("<ul>"); list = "ul"; } out.push(`<li>${mdInline(m[1])}</li>`); }
      else if ((m = /^\d+\.\s+(.*)$/.exec(line))) { if (list !== "ol") { flush(); out.push("<ol>"); list = "ol"; } out.push(`<li>${mdInline(m[1])}</li>`); }
      else if ((m = /^>\s?(.*)$/.exec(line))) { flush(); out.push(`<blockquote>${mdInline(m[1])}</blockquote>`); }
      else { flush(); out.push(`<p>${mdInline(line)}</p>`); }
    }
    flush();
  }
  return out.join("");
}
function bindCodeCopy(container) {
  container.querySelectorAll(".code-copy").forEach((btn) => {
    if (btn._bound) return; btn._bound = true;
    btn.addEventListener("click", () => {
      const code = btn.parentElement.querySelector("code");
      const txt = code ? code.textContent : "";
      (navigator.clipboard?.writeText(txt) || Promise.reject()).then(
        () => { btn.textContent = "已复制"; setTimeout(() => (btn.textContent = "复制"), 1200); },
        () => { btn.textContent = "复制失败"; setTimeout(() => (btn.textContent = "复制"), 1200); }
      );
    });
  });
}
// 助手气泡：累积 raw 文本并按 Markdown 渲染
function addAssistant(text) {
  const div = document.createElement("div");
  div.className = "msg assistant md";
  div._raw = text || "";
  div.innerHTML = mdToHtml(div._raw);
  bindCodeCopy(div);
  messagesEl.appendChild(div);
  updateEmptyState();
  scrollToBottom();
  return div;
}
function appendAssistant(el, text) {
  el._raw = (el._raw || "") + "\n" + text;
  el.innerHTML = mdToHtml(el._raw);
  bindCodeCopy(el);
  scrollToBottom();
}
// 流式：逐字累积，用 rAF 合并渲染，避免每个字都重排
function appendStreamRaw(el, text) {
  el._raw = (el._raw || "") + text;
  if (!el._rs) {
    el._rs = true;
    requestAnimationFrame(() => { el._rs = false; el.innerHTML = mdToHtml(el._raw); bindCodeCopy(el); scrollToBottom(); });
  }
}
function appendThinkRaw(el, text) {
  el._raw = (el._raw || "") + text;
  if (!el._rs) {
    el._rs = true;
    requestAnimationFrame(() => { el._rs = false; el.textContent = "💭 " + el._raw; scrollToBottom(); });
  }
}
// 用户气泡：文字 + 图片缩略图
function addUser(text, images) {
  const div = document.createElement("div");
  div.className = "msg user";
  if (text) { const p = document.createElement("div"); p.className = "user-text"; p.textContent = text; div.appendChild(p); }
  if (images && images.length) {
    const grid = document.createElement("div");
    grid.className = "img-grid";
    for (const src of images) {
      const im = document.createElement("img");
      im.className = "thumb"; im.src = src; im.loading = "lazy";
      im.addEventListener("click", () => window.open(src, "_blank"));
      grid.appendChild(im);
    }
    div.appendChild(grid);
  }
  messagesEl.appendChild(div);
  updateEmptyState();
  scrollToBottom();
  return div;
}

function toolSummary(name, input) {
  if (!input) return "";
  const i = input;
  switch (name) {
    case "Bash": return i.command || i.description || "";
    case "Read": case "Write": return i.file_path || "";
    case "Edit": case "MultiEdit": return i.file_path || "";
    case "Glob": return i.pattern || "";
    case "Grep": return i.pattern || "";
    case "WebFetch": return i.url || "";
    case "WebSearch": return i.query || "";
    case "Task": return i.description || "";
    case "TodoWrite": return "更新任务列表";
    default:
      try { return JSON.stringify(i).slice(0, 120); } catch { return ""; }
  }
}
function toolIcon(name) {
  return ({ Bash: "▶", Read: "📄", Write: "✍", Edit: "✏", MultiEdit: "✏",
    Glob: "🔍", Grep: "🔎", WebFetch: "🌐", WebSearch: "🌐", Task: "🤖", TodoWrite: "✓" })[name] || "🔧";
}

function addToolCard(id, name, input) {
  curAssistant = null; curThinking = null;
  const card = document.createElement("div");
  card.className = "tool";
  const head = document.createElement("div");
  head.className = "tool-head";
  head.innerHTML =
    `<span class="tool-icon">${toolIcon(name)}</span>` +
    `<span class="tool-name"></span>` +
    `<span class="tool-summary"></span>` +
    `<span class="tool-chevron">▶</span>`;
  head.querySelector(".tool-name").textContent = name;
  head.querySelector(".tool-summary").textContent = toolSummary(name, input);
  head.addEventListener("click", () => card.classList.toggle("open"));

  const body = document.createElement("div");
  body.className = "tool-body";
  const inLabel = document.createElement("div");
  inLabel.className = "tool-label"; inLabel.textContent = "输入";
  const pre = document.createElement("pre");
  pre.textContent = prettyInput(name, input);
  body.appendChild(inLabel); body.appendChild(pre);

  card.appendChild(head); card.appendChild(body);
  messagesEl.appendChild(card);
  if (id) toolEls.set(id, card);
  scrollToBottom();
}

function prettyInput(name, input) {
  if (name === "Bash" && input?.command) return input.command;
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}

// TodoWrite 渲染成漂亮的勾选清单
const todoToolIds = new Set();
function addTodoCard(id, todos) {
  curAssistant = null; curThinking = null;
  if (id) todoToolIds.add(id);
  if (!Array.isArray(todos)) todos = [];
  const card = document.createElement("div");
  card.className = "todo-card";
  const done = todos.filter((t) => t.status === "completed").length;
  const head = document.createElement("div");
  head.className = "todo-head";
  head.textContent = `📋 任务清单 ${done}/${todos.length}`;
  card.appendChild(head);
  for (const t of todos) {
    const row = document.createElement("div");
    row.className = "todo-row " + (t.status || "pending");
    const ic = { completed: "✓", in_progress: "▸", pending: "○" }[t.status] || "○";
    const span1 = document.createElement("span"); span1.className = "todo-ic"; span1.textContent = ic;
    const span2 = document.createElement("span"); span2.className = "todo-txt";
    span2.textContent = (t.status === "in_progress" && t.activeForm) ? t.activeForm : (t.content || "");
    row.appendChild(span1); row.appendChild(span2);
    card.appendChild(row);
  }
  messagesEl.appendChild(card);
  updateEmptyState();
  scrollToBottom();
  return card;
}

function addToolResult(id, content, isError) {
  if (todoToolIds.has(id) && !isError) return; // TodoWrite 的结果是噪音，已用清单卡呈现
  const card = toolEls.get(id);
  const target = card ? card.querySelector(".tool-body") : null;
  if (target) {
    const label = document.createElement("div");
    label.className = "tool-label"; label.textContent = isError ? "错误" : "结果";
    const pre = document.createElement("pre");
    pre.className = "tool-result-pre" + (isError ? " err" : "");
    pre.textContent = content;
    target.appendChild(label); target.appendChild(pre);
    if (isError) card.classList.add("open");
  } else {
    addMsg(isError ? "error" : "system", content);
  }
  scrollToBottom();
}

// 重连/刷新后回放历史对话
function replayHistory(events) {
  messagesEl.innerHTML = ""; if (emptyState) messagesEl.appendChild(emptyState);
  curAssistant = null; curThinking = null; toolEls.clear();
  for (const m of events) {
    switch (m.type) {
      case "user_echo": addUser(m.text, m.images); curAssistant = null; break;
      case "assistant": curAssistant = addAssistant(m.text); break;
      case "thinking": addMsg("thinking", "💭 " + m.text); curAssistant = null; break;
      case "tool_use": if (m.name === "TodoWrite") addTodoCard(m.id, m.input && m.input.todos); else addToolCard(m.id, m.name, m.input); break;
      case "tool_result": addToolResult(m.toolUseId, m.content, m.isError); break;
      case "result": curAssistant = null; if (m.isError) addMsg("error", "✕ " + (m.result || "出错了")); break;
    }
  }
  updateEmptyState();
}

// ---------- 通知 ----------
function notifyEnabled() { return localStorage.getItem("notify") === "1"; }
function notify(title, body) {
  navigator.vibrate && navigator.vibrate([60, 40, 60]);
  if (!notifyEnabled()) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!document.hidden) return; // 前台就不打扰
  try {
    const n = new Notification(title, { body: body || "", icon: "icon.svg", tag: "claude-remote", renotify: true });
    n.onclick = () => { window.focus(); n.close(); };
  } catch {}
}

// ---------- 浮层提示 ----------
function toast(text, ms = 2000) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), ms);
}

// ---------- 连接状态 ----------
function setDot(state) { dot.className = "dot " + state; }
function setBusy(b) {
  busy = b;
  stopBtn.classList.toggle("hidden", !b);
  setDot(connected ? (b ? "busy" : "online") : "offline");
}

// ---------- WebSocket ----------
let lastPong = 0;
let connectLock = false;
// 有云端中转(rz)就先去问"当前网址"，再连过去；问不到就用上次存的
async function resolveHost(b) {
  if (!b.rz) return b;
  try {
    let rzUrl = b.rz;
    if (!/^https?:\/\//i.test(rzUrl)) rzUrl = "https://" + rzUrl; // 容错：补全 https://
    // 关键：加超时，否则国内网络一卡 fetch 永远挂着，会把重连锁死
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 6000);
    let r;
    try { r = await fetch(rzUrl, { cache: "no-store", signal: ctrl.signal }); }
    finally { clearTimeout(to); }
    const j = await r.json();
    if (j && j.url) {
      const u = new URL(j.url);
      const nb = { host: u.host, token: b.token, secure: u.protocol === "https:", rz: b.rz };
      localStorage.setItem("backend", JSON.stringify(nb)); // 记住，下次中转挂了也能用上次的
      return nb;
    }
  } catch {}
  return b;
}
async function connect(force) {
  let b = getBackend();
  if (!b) { addMsg("system", "还没连接。点右上角 ⛶ 扫一下电脑「控制台」上的二维码即可。"); return; }
  // 已经在连或已连上就不重复建连（除非强制）
  if (!force && ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  if (connectLock) return;
  connectLock = true;
  try {
    b = await resolveHost(b);
    if (ws) { try { ws.onclose = null; ws.close(); } catch {} ws = null; }
    const proto = b.secure ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${b.host}/ws?token=${encodeURIComponent(b.token)}`);
    ws.onopen = () => {
      const wasOffline = !connected;
      connected = true; lastPong = Date.now(); setDot(busy ? "busy" : "online"); clearTimeout(reconnectTimer);
      if (wasOffline && !document.hidden) toast("✓ 已连接电脑");
      if (typeof liveActive !== "undefined" && liveActive) requestScreenshot();  // 重连后接着抓
    };
    ws.onclose = (e) => {
      connected = false; setDot("offline");
      if (e.code === 4001) { addMsg("error", "Token 错误，连接被拒绝。点 ⚙ 检查 Token。"); return; }
      scheduleReconnect();
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      handle(m);
    };
  } catch (e) {
    addMsg("error", "连接失败: " + ((e && e.message) || e)); scheduleReconnect();
  } finally {
    connectLock = false;
  }
}
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect(true), 1800);
}
// 假死 / 后台冻结后回到前台：主动确保连接还活着
function ensureConnected() {
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) connect(true);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) ensureConnected(); });
window.addEventListener("online", ensureConnected);
window.addEventListener("focus", ensureConnected);
window.addEventListener("pageshow", ensureConnected);
function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ---------- 处理服务器消息 ----------
const HIDE_TYPING_ON = new Set(["assistant", "assistant_delta", "thinking", "thinking_delta", "tool_use", "tool_result", "result", "session_ended", "interrupted", "error", "cleared", "history"]);
function handle(m) {
  if (HIDE_TYPING_ON.has(m.type)) hideTyping();
  switch (m.type) {
    case "hello":
      autoToggle.checked = !!m.autoApprove;
      setBusy(!!m.busy);
      currentCwd = m.cwd || "";
      $("cwdInput").value = currentCwd;
      curConvId = m.convId || null;
      updateCwdBar();
      if (m.model) setSelect("modelSelect", m.model);
      if (m.effort) setSelect("effortSelect", m.effort);
      applyPlatform(m.platform);
      break;
    case "conversations":
      convCache = m.list || [];
      const cur = convCache.find((c) => c.current);
      if (cur) curConvId = cur.id;
      renderConvList();
      break;
    case "optionChanged":
      if (m.model) setSelect("modelSelect", m.model);
      if (m.effort) setSelect("effortSelect", m.effort);
      addMsg("system", "已切换 · 模型 " + (m.model || "默认") + " · 思考档位 " + (m.effort || "high") + (m.restarted ? "（已开新对话）" : ""));
      break;
    case "system_init":
      if (m.convId) curConvId = m.convId;
      addMsg("system", `已连接 · ${m.model || "Claude"} · ${m.cwd}`);
      break;
    case "history":
      replayHistory(m.events || []);
      break;
    case "cleared":
      messagesEl.innerHTML = ""; if (emptyState) messagesEl.appendChild(emptyState);
      curAssistant = null; curThinking = null; toolEls.clear(); updateEmptyState();
      break;
    case "user_echo":
      // 已在本地回显，忽略来自其它设备的也行；这里跳过避免重复
      break;
    case "assistant":
      if (!curAssistant) curAssistant = addAssistant(m.text);
      else appendAssistant(curAssistant, m.text);
      setBusy(true);
      break;
    case "assistant_delta":
      curThinking = null;
      if (!curAssistant) curAssistant = addAssistant("");
      appendStreamRaw(curAssistant, m.text);
      setBusy(true);
      break;
    case "thinking_delta":
      curAssistant = null;
      if (!curThinking) { curThinking = addMsg("thinking", "💭 "); curThinking._raw = ""; }
      appendThinkRaw(curThinking, m.text);
      setBusy(true);
      break;
    case "thinking":
      curAssistant = null; curThinking = null;
      addMsg("thinking", "💭 " + m.text);
      break;
    case "tool_use":
      if (m.name === "TodoWrite") addTodoCard(m.id, m.input && m.input.todos);
      else addToolCard(m.id, m.name, m.input);
      setBusy(true);
      break;
    case "tool_result":
      addToolResult(m.toolUseId, m.content, m.isError);
      break;
    case "permission_request":
      showPermission(m);
      notify("Claude 需要授权", (m.name || "操作") + " · 点开 App 处理");
      break;
    case "permission_closed":
      closePermission(m.id);
      break;
    case "result":
      curAssistant = null; curThinking = null;
      setBusy(false);
      if (m.isError) { addMsg("error", "✕ " + (m.result || "出错了")); notify("Claude 出错了", m.result || ""); }
      else {
        const bits = [];
        if (typeof m.cost === "number") bits.push("$" + m.cost.toFixed(3));
        if (m.numTurns) bits.push(m.numTurns + " 轮");
        if (m.durationMs) bits.push((m.durationMs / 1000).toFixed(1) + "s");
        if (bits.length) addMsg("meta", "✓ 完成 · " + bits.join(" · "));
        notify("Claude 已完成", "任务跑完了，点开看看");
      }
      break;
    case "auto":
      autoToggle.checked = !!m.value;
      break;
    case "status":
      if (m.cwd) { currentCwd = m.cwd; $("cwdInput").value = m.cwd; updateCwdBar(); }
      break;
    case "dirList":
      renderDirList(m);
      break;
    case "dirError":
      addMsg("error", m.message);
      break;
    case "session_ended":
      setBusy(false);
      break;
    case "interrupted":
      curAssistant = null; curThinking = null;
      addMsg("system", "⏹ 已停止");
      setBusy(false);
      break;
    case "pong":
      lastPong = Date.now();
      break;
    case "notice":
      addMsg("system", m.message || "");
      break;
    case "screenshot":
      lastShot = m.data;
      $("screenImg").src = m.data;
      $("screenImg").style.display = "block";
      $("screenHint").style.display = "none";
      if (!liveActive) $("screenShot").textContent = "📸 刷新";
      // 如果全屏控制正开着，也更新图片
      if (!$("ctrlOverlay").classList.contains("hidden")) $("ctrlImg").src = m.data;
      // 实时模式：这张到了就立刻请求下一张（视图还开着才继续）
      if (liveActive && screenViewOpen()) setTimeout(requestScreenshot, 110);
      else if (liveActive) liveActive = false; // 视图都关了，停
      break;
    case "screenshotError":
      $("screenHint").textContent = "截屏失败：" + (m.message || "");
      $("screenHint").style.display = "";
      $("screenShot").textContent = "📸 刷新";
      break;
    case "error":
      addMsg("error", m.message || "未知错误");
      break;
  }
}

// ---------- 权限弹窗（支持排队）----------
const permQueue = [];
let curPerm = null;
function showPermission(m) {
  permQueue.push(m);
  if (!curPerm) nextPermission();
}
function nextPermission() {
  curPerm = permQueue.shift() || null;
  const modal = $("permModal");
  if (!curPerm) { modal.classList.add("hidden"); return; }
  $("permTitle").textContent = curPerm.title || "Claude 想要执行操作";
  $("permTool").textContent = curPerm.name;
  $("permBody").textContent = prettyInput(curPerm.name, curPerm.input);
  modal.classList.remove("hidden");
  navigator.vibrate && navigator.vibrate(60);
}
function closePermission(id) {
  if (curPerm && curPerm.id === id) nextPermission();
  else { const i = permQueue.findIndex((p) => p.id === id); if (i >= 0) permQueue.splice(i, 1); }
}
function decide(decision) {
  if (!curPerm) return;
  send({ type: "permission", id: curPerm.id, decision });
  nextPermission();
}
$("permAllow").onclick = () => decide("allow");
$("permDeny").onclick = () => decide("deny");
$("permAlways").onclick = () => decide("always");
$("permAuto").onclick = () => decide("auto");

// ---------- 发送 / 停止 ----------
function sendPrompt(presetText) {
  const text = (presetText != null ? presetText : inputEl.value).trim();
  const images = pendingImages.slice();
  if (!text && !images.length) return;
  if (!connected) { addMsg("error", "尚未连接，请稍候或检查设置。"); return; }
  stickToBottom = true;
  addUser(text, images);
  curAssistant = null; curThinking = null;
  showTyping();
  send({ type: "prompt", text, images });
  if (presetText == null) { inputEl.value = ""; autoResize(); }
  clearAttachments();
  setBusy(true);
}
sendBtn.onclick = () => sendPrompt();
stopBtn.onclick = () => send({ type: "interrupt" });

// ---------- 图片附件 ----------
const attachBtn = $("attachBtn");
const imageInput = $("imageInput");
attachBtn.onclick = () => imageInput.click();
imageInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    if (pendingImages.length >= 4) { addMsg("system", "一次最多发 4 张图片"); break; }
    try { pendingImages.push(await compressImage(f)); } catch { addMsg("error", "图片读取失败"); }
  }
  imageInput.value = "";
  renderAttachments();
});
// 用 canvas 压缩到最长边 1280，JPEG 0.72，控制传输体积
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1280;
      let { width: w, height: h } = img;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}
function renderAttachments() {
  attachBar.innerHTML = "";
  attachBar.classList.toggle("hidden", !pendingImages.length);
  pendingImages.forEach((src, i) => {
    const cell = document.createElement("div");
    cell.className = "attach-cell";
    const im = document.createElement("img"); im.src = src;
    const x = document.createElement("button"); x.className = "attach-x"; x.textContent = "×";
    x.onclick = () => { pendingImages.splice(i, 1); renderAttachments(); };
    cell.appendChild(im); cell.appendChild(x);
    attachBar.appendChild(cell);
  });
}
function clearAttachments() { pendingImages = []; renderAttachments(); }

// ---------- 语音输入（浏览器自带语音识别）----------
const micBtn = $("micBtn");
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null, recognizing = false;
if (!SpeechRec) { if (micBtn) micBtn.style.display = "none"; }
else if (micBtn) {
  micBtn.onclick = () => {
    if (recognizing) { try { recog && recog.stop(); } catch {} return; }
    recog = new SpeechRec();
    recog.lang = "zh-CN"; recog.interimResults = true; recog.continuous = false;
    const base = inputEl.value;
    recog.onstart = () => { recognizing = true; micBtn.classList.add("listening"); };
    recog.onend = () => { recognizing = false; micBtn.classList.remove("listening"); };
    recog.onerror = (e) => { recognizing = false; micBtn.classList.remove("listening"); if (e.error === "not-allowed") addMsg("system", "麦克风没授权，无法语音输入"); };
    recog.onresult = (e) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      inputEl.value = (base ? base + " " : "") + txt;
      autoResize();
    };
    try { recog.start(); } catch {}
  };
}

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendPrompt(); }
});
function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
}
inputEl.addEventListener("input", autoResize);

// ---------- App 内扫码连接 ----------
let scanStream = null, scanRAF = null;
function showScan() { $("scanModal").classList.remove("hidden"); startScan(); }
async function startScan() {
  const video = $("scanVideo"), canvas = $("scanCanvas"), ctx = canvas.getContext("2d");
  $("scanHint").textContent = "把电脑「控制台」网页上的二维码对准取景框…";
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = scanStream; await video.play();
  } catch (e) {
    $("scanHint").textContent = "打不开摄像头：" + e.message + "。也可以在浏览器里重新扫码打开。";
    return;
  }
  const tick = () => {
    if (video.readyState === video.HAVE_ENOUGH_DATA && typeof jsQR === "function") {
      const vw = video.videoWidth, vh = video.videoHeight;
      const scale = Math.min(1, 640 / Math.max(vw, vh)); // 缩到最长边 640，识别快很多
      const w = Math.max(1, Math.round(vw * scale)), h = Math.max(1, Math.round(vh * scale));
      canvas.width = w; canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
      if (code && code.data) { onScan(code.data); return; }
    }
    scanRAF = requestAnimationFrame(tick);
  };
  scanRAF = requestAnimationFrame(tick);
}
function stopScan() {
  if (scanRAF) { cancelAnimationFrame(scanRAF); scanRAF = null; }
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
  $("scanModal").classList.add("hidden");
}
function onScan(text) {
  try {
    setBackendFromText(text);
    stopScan();
    $("settingsModal").classList.add("hidden");
    addMsg("system", "已扫码，正在连接…");
    if (ws) try { ws.onclose = null; ws.close(); } catch {}
    ws = null; connected = false;
    connect(true);
  } catch (e) { $("scanHint").textContent = "二维码无效：" + e.message; }
}
$("scanBtn").onclick = showScan;
$("scanClose").onclick = stopScan;

// ---------- 顶栏开关 ----------
autoToggle.addEventListener("change", () => send({ type: "setAuto", value: autoToggle.checked }));

// ---------- 模型 / 思考档位 ----------
function setSelect(id, value) {
  const el = $(id);
  if (!el) return;
  const has = Array.from(el.options).some((o) => o.value === value);
  if (!has) { const o = document.createElement("option"); o.value = value; o.textContent = value; el.appendChild(o); }
  el.value = value;
}
$("modelSelect").addEventListener("change", (e) => send({ type: "setModel", model: e.target.value }));
$("effortSelect").addEventListener("change", (e) => send({ type: "setEffort", effort: e.target.value }));

// ---------- 设置面板 ----------
$("settingsBtn").onclick = () => {
  const b = getBackend();
  $("serverInput").value = b ? b.host : "";
  $("tokenInput").value = b ? b.token : "";
  $("connInfo").textContent = `当前后端: ${b ? (b.secure ? "https" : "http") + "://" + b.host : "未连接"} ｜ ${navigator.onLine ? "网络正常" : "离线"} ｜ 界面 ${APP_VERSION}`;
  $("quickEdit").value = quickToText(loadQuick());
  notifyToggle.checked = notifyEnabled();
  refreshNotifyStatus();
  $("settingsModal").classList.remove("hidden");
};
$("settingsClose").onclick = () => $("settingsModal").classList.add("hidden");
$("cwdApply").onclick = () => {
  const p = $("cwdInput").value.trim();
  if (p) { send({ type: "setCwd", path: p }); addMsg("system", "切换工作目录: " + p); $("settingsModal").classList.add("hidden"); }
};
// 电脑端是 Mac 时：按键标签换成 Mac 习惯（发送的指令不变，由服务端翻译成 ⌘ 组合键），
// 并显示 Mac 专属的「熄屏锁定 / 唤醒屏幕」按钮；Windows 后端保持原有界面
const MAC_KEY_LABELS = { "^c": "⌘C 复制", "^v": "⌘V 粘贴", "^x": "⌘X 剪切", "^z": "⌘Z 撤销", "^a": "⌘A 全选", "^s": "⌘S 保存", "^f": "⌘F 查找" };
const MAC_COMBO_LABELS = { alttab: "⌘Tab 切窗口", win: "🔍 Spotlight", wind: "显示桌面", wintab: "调度中心" };
function applyPlatform(platform) {
  const mac = platform === "darwin";
  if (mac) {
    document.querySelectorAll(".kbtn[data-key]").forEach((b) => { if (MAC_KEY_LABELS[b.dataset.key]) b.textContent = MAC_KEY_LABELS[b.dataset.key]; });
    document.querySelectorAll(".kbtn[data-combo]").forEach((b) => { if (MAC_COMBO_LABELS[b.dataset.combo]) b.textContent = MAC_COMBO_LABELS[b.dataset.combo]; });
  }
  $("displaySleepBtn").style.display = mac ? "" : "none";
  $("wakeDisplayBtn").style.display = mac ? "" : "none";
}
// 电源：熄屏锁定（可远程恢复）/ 唤醒屏幕 / 深度睡眠（断连，需到电脑前唤醒）
$("displaySleepBtn").onclick = () => {
  send({ type: "displaySleep" });
  addMsg("system", "🌙 已让电脑熄屏（仍在运行，可随时继续遥控）");
  $("settingsModal").classList.add("hidden");
};
$("wakeDisplayBtn").onclick = () => {
  send({ type: "wakeDisplay" });
  $("settingsModal").classList.add("hidden");
};
$("sleepBtn").onclick = () => {
  if (!confirm("确定让电脑进入睡眠？\n\n连接会立刻断开，且手机无法远程唤醒，需到电脑前按键唤醒。")) return;
  send({ type: "sleepComputer" });
  addMsg("system", "💤 已让电脑睡眠（连接将断开）");
  $("settingsModal").classList.add("hidden");
};
$("connApply").onclick = () => {
  const s = $("serverInput").value.trim();
  const t = $("tokenInput").value.trim();
  if (s && t) {
    const secure = !/^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(s) && location.protocol === "https:"; // IP 默认 http
    localStorage.setItem("backend", JSON.stringify({ host: s.replace(/^https?:\/\//, ""), token: t, secure }));
    localStorage.setItem("token", t);
  }
  $("settingsModal").classList.add("hidden");
  if (ws) try { ws.close(); } catch {}
  connect();
};

// ---------- 文件夹浏览器 ----------
function openBrowser() {
  $("browserModal").classList.remove("hidden");
  const start = currentCwd && currentCwd.trim() ? currentCwd : "drives";
  requestDir(start);
}
function requestDir(p) {
  if (!connected) { addMsg("error", "未连接，无法浏览文件夹"); return; }
  $("browserList").innerHTML = '<div class="browser-empty">加载中…</div>';
  send({ type: "listDir", path: p });
}
function renderDirList(m) {
  browseCur = m.path;
  browseParent = m.parent;
  $("browserPath").textContent = m.isDrives ? "选择磁盘" : m.path;
  $("browserUp").style.visibility = m.parent ? "visible" : "hidden";
  $("browserPick").style.display = m.isDrives ? "none" : "";
  $("browserMkdir").style.display = m.isDrives ? "none" : "";
  const list = $("browserList");
  list.innerHTML = "";
  if (!m.entries || !m.entries.length) {
    list.innerHTML = '<div class="browser-empty">（空文件夹）</div>';
    return;
  }
  for (const e of m.entries) {
    const row = document.createElement("div");
    row.className = "browser-item " + (e.isDir ? "dir" : "is-file");
    const icon = document.createElement("span");
    icon.className = "b-icon";
    icon.textContent = e.isDir ? "📁" : "📄";
    const name = document.createElement("span");
    name.className = "b-name";
    name.textContent = e.name;
    row.appendChild(icon); row.appendChild(name);
    if (e.isDir) row.addEventListener("click", () => requestDir(e.path));
    list.appendChild(row);
  }
}
const _folderBtn = $("folderBtn"); if (_folderBtn) _folderBtn.onclick = openBrowser;
$("cwdBar").onclick = openBrowser;
$("browserClose").onclick = () => $("browserModal").classList.add("hidden");
$("browserUp").onclick = () => { if (browseParent) requestDir(browseParent); };
$("browserPick").onclick = () => {
  if (!browseCur || browseCur === "drives") return;
  send({ type: "setCwd", path: browseCur });
  currentCwd = browseCur;
  $("cwdInput").value = browseCur;
  addMsg("system", "工作目录已切换到: " + browseCur);
  $("browserModal").classList.add("hidden");
};
$("browserMkdir").onclick = () => {
  if (!browseCur || browseCur === "drives") return;
  const name = prompt("新文件夹名字：");
  if (name && name.trim()) send({ type: "mkdir", path: browseCur, name: name.trim() });
};

// ---------- 快捷命令 ----------
const DEFAULT_QUICK = [
  { label: "继续", text: "继续" },
  { label: "git 状态", text: "运行 git status，简要说明当前改动" },
  { label: "提交", text: "把当前改动提交，写一个清晰的中文 commit message" },
  { label: "跑测试", text: "运行项目的测试，把失败的修好" },
  { label: "解释改动", text: "解释一下你刚才做的改动，以及为什么这么改" },
  { label: "项目结构", text: "总结一下当前项目的结构和主要文件的职责" },
];
function loadQuick() {
  try { const q = JSON.parse(localStorage.getItem("quickCmds")); if (Array.isArray(q) && q.length) return q; } catch {}
  return DEFAULT_QUICK;
}
function renderQuick() {
  const items = loadQuick();
  quickBar.innerHTML = "";
  for (const it of items) {
    const chip = document.createElement("button");
    chip.className = "chip"; chip.type = "button";
    chip.textContent = it.label || it.text;
    chip.title = it.text;
    chip.onclick = () => {
      if (!connected) { addMsg("error", "尚未连接，请稍候或检查设置。"); return; }
      sendPrompt(it.text);
    };
    quickBar.appendChild(chip);
  }
  quickBar.classList.toggle("hidden", !items.length);
}
function quickToText(items) { return items.map((it) => (it.label && it.label !== it.text ? `${it.label} | ${it.text}` : it.text)).join("\n"); }
function parseQuick(str) {
  return str.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf("|");
    if (i > 0) return { label: l.slice(0, i).trim(), text: l.slice(i + 1).trim() };
    return { label: l, text: l };
  }).filter((x) => x.text);
}
$("quickSave").onclick = () => {
  const items = parseQuick($("quickEdit").value);
  localStorage.setItem("quickCmds", JSON.stringify(items));
  renderQuick();
  addMsg("system", "快捷命令已保存");
  $("settingsModal").classList.add("hidden");
};
$("quickReset").onclick = () => {
  localStorage.removeItem("quickCmds");
  $("quickEdit").value = quickToText(DEFAULT_QUICK);
  renderQuick();
};

// ---------- 通知开关 ----------
const notifyToggle = $("notifyToggle");
function refreshNotifyStatus() {
  const el = $("notifyStatus");
  if (!("Notification" in window)) { el.textContent = "此设备不支持通知"; notifyToggle.disabled = true; return; }
  if (!notifyEnabled()) { el.textContent = "App 在后台时震动并弹通知（已关闭）"; return; }
  el.textContent = Notification.permission === "granted" ? "已开启：后台会震动并弹通知" : "已开启，但系统未授权通知权限";
}
notifyToggle.addEventListener("change", async () => {
  if (notifyToggle.checked) {
    let perm = ("Notification" in window) ? Notification.permission : "denied";
    if (perm === "default") { try { perm = await Notification.requestPermission(); } catch {} }
    localStorage.setItem("notify", "1");
    if (perm !== "granted") addMsg("system", "已开启提醒（震动）。系统通知权限未授予，只有震动。可在系统设置里允许本网页/PWA 通知。");
  } else {
    localStorage.setItem("notify", "0");
  }
  refreshNotifyStatus();
});

// ---------- 回到底部 ----------
messagesEl.addEventListener("scroll", () => {
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
  stickToBottom = nearBottom;
  toBottomBtn.classList.toggle("hidden", nearBottom);
});
toBottomBtn.onclick = () => { stickToBottom = true; scrollToBottom(true); };

// ---------- 聊天记录抽屉 ----------
function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return "今天 " + hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "昨天 " + hm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
let convFilter = "";
function renderConvList() {
  const list = $("convList");
  if (!list) return;
  list.innerHTML = "";
  const f = convFilter.trim().toLowerCase();
  const items = f ? convCache.filter((c) => (c.title || "").toLowerCase().includes(f) || (c.cwd || "").toLowerCase().includes(f)) : convCache;
  if (!convCache.length) { list.innerHTML = '<div class="browser-empty">还没有历史对话</div>'; return; }
  if (!items.length) { list.innerHTML = '<div class="browser-empty">没有匹配的对话</div>'; return; }
  for (const c of items) {
    const row = document.createElement("div");
    row.className = "conv-item" + (c.id === curConvId ? " active" : "");
    const main = document.createElement("div");
    main.className = "conv-main";
    main.innerHTML = `<div class="conv-title"></div><div class="conv-sub"></div><div class="conv-path"></div>`;
    main.querySelector(".conv-title").textContent = c.title || "未命名对话";
    main.querySelector(".conv-sub").textContent = fmtTime(c.updatedAt) + (c.id === curConvId ? " · 当前" : "");
    main.querySelector(".conv-path").textContent = c.cwd ? "📂 " + c.cwd : "";
    main.addEventListener("click", () => {
      if (c.id === curConvId) { $("historyModal").classList.add("hidden"); return; }
      send({ type: "loadConversation", id: c.id });
      addMsg("system", "正在载入：" + (c.title || "") + (c.cwd ? "\n📂 " + c.cwd : ""));
      $("historyModal").classList.add("hidden");
    });
    const ren = document.createElement("button");
    ren.className = "conv-act"; ren.textContent = "✎"; ren.title = "重命名";
    ren.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = prompt("新的对话名字：", c.title || "");
      if (t && t.trim()) send({ type: "renameConversation", id: c.id, title: t.trim() });
    });
    const del = document.createElement("button");
    del.className = "conv-act"; del.textContent = "🗑"; del.title = "删除";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("删除这个对话记录？不可恢复。")) send({ type: "deleteConversation", id: c.id });
    });
    row.appendChild(main); row.appendChild(ren); row.appendChild(del);
    list.appendChild(row);
  }
}
$("historyBtn").onclick = () => {
  send({ type: "listConversations" });
  renderConvList();
  $("historyModal").classList.remove("hidden");
};
$("convSearch").addEventListener("input", (e) => { convFilter = e.target.value || ""; renderConvList(); });
$("historyClose").onclick = () => $("historyModal").classList.add("hidden");
$("newConvBtn").onclick = () => {
  send({ type: "newConversation" });
  addMsg("system", "已开始新对话");
  $("historyModal").classList.add("hidden");
};

// ---------- 对话内消息搜索 ----------
let searchHits = [], searchIdx = -1;
function clearSearchHits() {
  for (const el of searchHits) el.classList.remove("search-hit", "search-current");
  searchHits = []; searchIdx = -1;
}
function markCurrent() {
  searchHits.forEach((el, i) => el.classList.toggle("search-current", i === searchIdx));
  const el = searchHits[searchIdx];
  if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  $("searchCount").textContent = (searchHits.length ? searchIdx + 1 : 0) + "/" + searchHits.length;
}
function runSearch() {
  clearSearchHits();
  const q = $("msgSearch").value.trim().toLowerCase();
  if (!q) { $("searchCount").textContent = "0/0"; return; }
  searchHits = Array.from(messagesEl.children).filter((c) => c !== emptyState && (c.textContent || "").toLowerCase().includes(q));
  searchHits.forEach((el) => el.classList.add("search-hit"));
  searchIdx = searchHits.length ? 0 : -1;
  markCurrent();
}
function gotoHit(d) {
  if (!searchHits.length) return;
  searchIdx = (searchIdx + d + searchHits.length) % searchHits.length;
  markCurrent();
}
function openSearch() { $("searchBar").classList.remove("hidden"); const i = $("msgSearch"); i.value = ""; i.focus(); }
function closeSearch() { $("searchBar").classList.add("hidden"); clearSearchHits(); }
$("searchBtn").onclick = () => { if ($("searchBar").classList.contains("hidden")) openSearch(); else closeSearch(); };
$("msgSearch").addEventListener("input", runSearch);
$("msgSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); gotoHit(e.shiftKey ? -1 : 1); } });
$("searchPrev").onclick = () => gotoHit(-1);
$("searchNext").onclick = () => gotoHit(1);
$("searchClose").onclick = closeSearch;

// ---------- 顶栏下方的工作目录条（显示完整路径，点开可换目录）----------
function updateCwdBar() {
  const bar = $("cwdBar");
  if (!bar) return;
  bar.textContent = currentCwd ? "📂 " + currentCwd : "";
  bar.classList.toggle("hidden", !currentCwd);
  bar.title = currentCwd;
}

// ---------- “正在思考”指示器 ----------
function showTyping() {
  if (document.getElementById("typingMsg")) return;
  const d = document.createElement("div");
  d.id = "typingMsg"; d.className = "msg assistant typing";
  d.innerHTML = '<span class="ti-label">Claude 正在思考</span><span class="ti-dots"><i></i><i></i><i></i></span>';
  messagesEl.appendChild(d); updateEmptyState(); scrollToBottom();
}
function hideTyping() { const d = document.getElementById("typingMsg"); if (d) d.remove(); }

// ---------- 刷新：已连接则刷新聊天内容，断开则强制重连 ----------
$("refreshBtn").onclick = () => {
  if (connected && ws && ws.readyState === WebSocket.OPEN) {
    send({ type: "refreshHistory" });
    toast("已刷新聊天");
  } else {
    toast("正在重新连接…");
    if (ws) { try { ws.onclose = null; ws.close(); } catch {} ws = null; }
    connected = false; setDot("offline");
    connect(true);
  }
};

// ---------- 看电脑屏幕 + 远程控制 ----------
let screenTimer = null;
let lastShot = "";
// 实时画面：抓完一张立刻抓下一张（连环单张）。用的是杀软不拦的 screenshot.ps1，
// 不开持续抓屏的长驻进程（那个会被火绒判恶意、还会触发游戏反作弊）。
let liveActive = false;
function requestScreenshot() {
  if (!connected) { $("screenHint").textContent = "未连接，无法获取屏幕"; $("screenHint").style.display = ""; return; }
  if (!liveActive) $("screenShot").textContent = "获取中…";
  send({ type: "screenshot" });
}
function screenViewOpen() {
  return !$("ctrlOverlay").classList.contains("hidden") || !$("screenModal").classList.contains("hidden");
}
function liveOn() { if (!liveActive) { liveActive = true; requestScreenshot(); } }
function liveOff() { liveActive = false; }
function stopScreenAuto() { if (screenTimer) { clearInterval(screenTimer); screenTimer = null; } }
$("screenBtn").onclick = () => { $("screenModal").classList.remove("hidden"); requestScreenshot(); };
$("screenClose").onclick = () => { $("screenModal").classList.add("hidden"); stopScreenAuto(); liveOff(); $("screenAuto").checked = false; };
$("screenShot").onclick = requestScreenshot;
$("screenAuto").addEventListener("change", (e) => {
  if (e.target.checked) liveOn();   // 勾「自动」= 实时画面（连环抓单张）
  else liveOff();
});

// ===== 全屏控制模式：手机屏幕＝电脑屏幕 =====
const ctrlStage = $("ctrlStage");
let ctrlRot = 0;            // 0=正放（横屏手机）/ 90=旋转铺满（竖屏手机）
let ctrlZoom = 1, ctrlTx = 0, ctrlTy = 0;
let ctrlNatW = 16, ctrlNatH = 9;   // 桌面截图原始尺寸
let lastCtrlPt = null;             // 最近一次点击的桌面坐标（双击/右键按钮用）

function applyCtrlPan() { $("ctrlPan").style.transform = `translate(${ctrlTx}px, ${ctrlTy}px) scale(${ctrlZoom})`; }

// 按手机方向把桌面图旋转/缩放到“铺满”，且让图片元素尺寸 = 实际可见尺寸（无留白），坐标才点对点
function layoutCtrlImg() {
  if (!ctrlStage) return;
  const img = $("ctrlImg");
  if (img.naturalWidth) { ctrlNatW = img.naturalWidth; ctrlNatH = img.naturalHeight; }
  const VW = ctrlStage.clientWidth, VH = ctrlStage.clientHeight;
  const W = ctrlNatW, H = ctrlNatH;
  ctrlRot = (VW >= VH) ? 0 : 90;   // 横屏正放，竖屏旋转铺满
  let cssW, cssH;
  if (ctrlRot === 0) {
    const s = Math.min(VW / W, VH / H); cssW = W * s; cssH = H * s;
  } else {
    const onW = Math.min(VW, VH * H / W); const onH = onW * W / H; cssW = onH; cssH = onW;
  }
  img.style.width = cssW + "px";
  img.style.height = cssH + "px";
  img.style.transform = `rotate(${ctrlRot}deg)`;
}
// 实时画面下每帧都会换 src，只在画面尺寸真的变了时才重新布局，避免每帧重排
let ctrlLaidW = 0, ctrlLaidH = 0;
$("ctrlImg").addEventListener("load", () => {
  const img = $("ctrlImg");
  if (img.naturalWidth && (img.naturalWidth !== ctrlLaidW || img.naturalHeight !== ctrlLaidH)) {
    ctrlLaidW = img.naturalWidth; ctrlLaidH = img.naturalHeight;
    layoutCtrlImg();
  }
});
window.addEventListener("resize", () => { if (!$("ctrlOverlay").classList.contains("hidden")) layoutCtrlImg(); });
window.addEventListener("orientationchange", () => { if (!$("ctrlOverlay").classList.contains("hidden")) setTimeout(layoutCtrlImg, 250); });

// 屏幕坐标 → 桌面 0-1 坐标。getBoundingClientRect 在 90°旋转+缩放+平移下仍是“可见图实际矩形”，所以始终准确
function ctrlMap(px, py) {
  const r = $("ctrlImg").getBoundingClientRect();
  let u = (px - r.left) / r.width, v = (py - r.top) / r.height;
  u = Math.max(0, Math.min(1, u)); v = Math.max(0, Math.min(1, v));
  return ctrlRot === 90 ? { rx: v, ry: 1 - u } : { rx: u, ry: v };  // rotate(90deg) 的逆映射
}
function ctrlDo(px, py, action) {
  const c = ctrlMap(px, py);
  lastCtrlPt = c;
  send({ type: "control", action, rx: c.rx, ry: c.ry });
  const rip = $("ctrlRipple");
  rip.style.left = px + "px"; rip.style.top = py + "px";
  rip.classList.remove("pop"); void rip.offsetWidth; rip.classList.add("pop");
  if (!liveActive) setTimeout(requestScreenshot, 450);  // 实时模式下结果会自动刷出来
}

// 手势：单指轻点=单击，长按=右键，单指拖动(放大后)=平移，双指=缩放
let gStart = null, gMode = null, gMoved = false, lpTimer = null, pinchD0 = 0, z0 = 1, tx0 = 0, ty0 = 0;
function tp(t) { return { x: t.clientX, y: t.clientY }; }
function tdist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
if (ctrlStage) {
  ctrlStage.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      gStart = tp(e.touches[0]); gStart.t = Date.now(); gMoved = false; gMode = "tap";
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => { if (gMode === "tap" && !gMoved) { gMode = "done"; ctrlDo(gStart.x, gStart.y, "rclick"); } }, 500);
    } else if (e.touches.length === 2) {
      clearTimeout(lpTimer); gMode = "pinch";
      pinchD0 = tdist(tp(e.touches[0]), tp(e.touches[1])); z0 = ctrlZoom; tx0 = ctrlTx; ty0 = ctrlTy;
    }
    e.preventDefault();
  }, { passive: false });
  ctrlStage.addEventListener("touchmove", (e) => {
    if (gMode === "pinch" && e.touches.length === 2) {
      const d = tdist(tp(e.touches[0]), tp(e.touches[1]));
      ctrlZoom = Math.max(1, Math.min(5, z0 * d / (pinchD0 || 1)));
      applyCtrlPan();
    } else if (e.touches.length === 1 && (gMode === "tap" || gMode === "pan")) {
      const p = tp(e.touches[0]);
      if (!gMoved && Math.hypot(p.x - gStart.x, p.y - gStart.y) > 12) {
        gMoved = true; clearTimeout(lpTimer);
        if (ctrlZoom > 1) { gMode = "pan"; tx0 = ctrlTx; ty0 = ctrlTy; gStart = p; }
      }
      if (gMode === "pan") { ctrlTx = tx0 + (p.x - gStart.x); ctrlTy = ty0 + (p.y - gStart.y); applyCtrlPan(); }
    }
    e.preventDefault();
  }, { passive: false });
  ctrlStage.addEventListener("touchend", (e) => {
    clearTimeout(lpTimer);
    if (gMode === "tap" && !gMoved && Date.now() - gStart.t < 500) ctrlDo(gStart.x, gStart.y, "click");
    if (e.touches.length === 0) {
      gMode = null;
      if (ctrlZoom <= 1.02) { ctrlZoom = 1; ctrlTx = 0; ctrlTy = 0; applyCtrlPan(); }  // 缩回原大小就归位
    }
  }, { passive: false });
}

// 侧边功能键抽屉
$("ctrlHandle").onclick = () => $("ctrlDrawer").classList.add("open");
$("ctrlDrawerClose").onclick = () => $("ctrlDrawer").classList.remove("open");
$("ctrlDrawer").querySelectorAll(".kbtn").forEach((b) => {
  b.addEventListener("click", () => {
    if (b.dataset.combo) send({ type: "control", action: "combo", text: b.dataset.combo });
    else if (b.dataset.act) {
      if (!lastCtrlPt) { toast("先在屏幕上点一下确定位置"); return; }
      send({ type: "control", action: b.dataset.act, rx: lastCtrlPt.rx, ry: lastCtrlPt.ry });
    } else if (b.dataset.key != null) {
      send({ type: "control", action: "key", text: b.dataset.key });
    }
    if (!liveActive) setTimeout(requestScreenshot, 450);
  });
});
$("ctrlSend").onclick = () => {
  const t = $("ctrlText").value;
  if (!t) return;
  send({ type: "control", action: "type", text: t });
  $("ctrlText").value = ""; toast("已输入"); if (!liveActive) setTimeout(requestScreenshot, 500);
};

$("screenCtrlBtn").onclick = openControlOverlay;
$("ctrlExit").onclick = exitControlOverlay;
$("ctrlRefresh").onclick = () => { requestScreenshot(); toast("刷新中…"); };

function openControlOverlay() {
  if (lastShot) $("ctrlImg").src = lastShot; else toast("正在获取屏幕…");
  ctrlZoom = 1; ctrlTx = 0; ctrlTy = 0; applyCtrlPan();
  $("ctrlDrawer").classList.remove("open");
  $("ctrlOverlay").classList.remove("hidden");
  $("screenModal").classList.add("hidden");
  // 尽量全屏 + 锁横屏（成功则桌面正放铺满；失败就用竖屏旋转铺满兜底）
  const ov = $("ctrlOverlay");
  try { (ov.requestFullscreen || ov.webkitRequestFullscreen || function () {}).call(ov); } catch {}
  try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {}); } catch {}
  ctrlLaidW = 0; ctrlLaidH = 0;        // 进入后强制重新布局一次
  requestAnimationFrame(layoutCtrlImg);
  stopScreenAuto();
  requestScreenshot();                  // 先来一张垫着
  liveOn();                             // 然后开实时画面
}
function exitControlOverlay() {
  $("ctrlOverlay").classList.add("hidden");
  $("ctrlDrawer").classList.remove("open");
  stopScreenAuto();
  if (!$("screenAuto").checked) liveOff();   // 小窗没勾自动就停掉实时画面
  try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch {}
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
  $("screenModal").classList.remove("hidden");
  requestScreenshot();
}

// ---------- 点弹窗外的暗色区域即关闭 ----------
document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target !== modal) return; // 只在点到背景（而非卡片内部）时关闭
    if (modal.id === "scanModal") { stopScan(); return; }
    if (modal.id === "screenModal") { stopScreenAuto(); }
    if (modal.id === "permModal") return; // 权限弹窗必须明确选择，不许点背景误关
    modal.classList.add("hidden");
  });
});

// ---------- 启动 ----------
renderQuick();
connect();
setBusy(false);
updateEmptyState();

// 保活 + 假死检测：超过约 3 个周期没收到 pong 就判定连接死了，强制重建
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (lastPong && Date.now() - lastPong > 70000) {
      try { ws.onclose = null; ws.close(); } catch {}
      ws = null; connected = false; setDot("offline"); connect(true); return;
    }
    send({ type: "ping" });
  } else {
    ensureConnected();
  }
}, 22000);

// Service Worker（用于网页版安装到主屏幕）；APK(Capacitor) 里资源本就在本地，跳过避免缓存旧界面
if (!window.Capacitor && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then((reg) => { try { reg.update(); } catch {} }).catch(() => {});
  // 新版本就绪后自动整页刷新一次，确保手机拿到最新代码（不用手动清缓存）
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swRefreshing) return; swRefreshing = true; location.reload();
  });
}
