"use strict";

// ---------- 取出/保存连接信息 ----------
const params = new URLSearchParams(location.search);
if (params.get("token")) {
  // 浏览器扫码进来：当前页面源就是后端
  const b = { host: location.host, token: params.get("token"), secure: location.protocol === "https:" };
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
  const b = { host: u.host, token, secure: u.protocol === "https:" };
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
  curAssistant = null;
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

function addToolResult(id, content, isError) {
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
  curAssistant = null; toolEls.clear();
  for (const m of events) {
    switch (m.type) {
      case "user_echo": addUser(m.text, m.images); curAssistant = null; break;
      case "assistant": curAssistant = addAssistant(m.text); break;
      case "thinking": addMsg("thinking", "💭 " + m.text); curAssistant = null; break;
      case "tool_use": addToolCard(m.id, m.name, m.input); break;
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

// ---------- 连接状态 ----------
function setDot(state) { dot.className = "dot " + state; }
function setBusy(b) {
  busy = b;
  stopBtn.classList.toggle("hidden", !b);
  setDot(connected ? (b ? "busy" : "online") : "offline");
}

// ---------- WebSocket ----------
let lastPong = 0;
function connect(force) {
  const b = getBackend();
  if (!b) { addMsg("system", "还没连接。点右上角 ⛶ 扫一下电脑「控制台」上的二维码即可。"); return; }
  // 已经在连或已连上就不重复建连（除非强制）
  if (!force && ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  if (ws) { try { ws.onclose = null; ws.close(); } catch {} ws = null; }
  const proto = b.secure ? "wss" : "ws";
  try { ws = new WebSocket(`${proto}://${b.host}/ws?token=${encodeURIComponent(b.token)}`); }
  catch (e) { addMsg("error", "连接失败: " + e.message); scheduleReconnect(); return; }

  ws.onopen = () => { connected = true; lastPong = Date.now(); setDot(busy ? "busy" : "online"); clearTimeout(reconnectTimer); };
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
function handle(m) {
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
      curAssistant = null; toolEls.clear(); updateEmptyState();
      break;
    case "user_echo":
      // 已在本地回显，忽略来自其它设备的也行；这里跳过避免重复
      break;
    case "assistant":
      if (!curAssistant) curAssistant = addAssistant(m.text);
      else appendAssistant(curAssistant, m.text);
      setBusy(true);
      break;
    case "thinking":
      curAssistant = null;
      addMsg("thinking", "💭 " + m.text);
      break;
    case "tool_use":
      addToolCard(m.id, m.name, m.input);
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
      curAssistant = null;
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
      curAssistant = null;
      addMsg("system", "⏹ 已停止");
      setBusy(false);
      break;
    case "pong":
      lastPong = Date.now();
      break;
    case "notice":
      addMsg("system", m.message || "");
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
  curAssistant = null;
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
  if (scanRAF) { cancelAnimationFrame(scanRAF); scanRAF = null; }
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
  $("scanModal").classList.add("hidden");
}
function onScan(text) {
  try {
    setBackendFromText(text);
    stopScan();
    addMsg("system", "已扫码，正在连接…");
    if (ws) try { ws.close(); } catch {}
    connect();
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
  $("connInfo").textContent = `当前后端: ${b ? (b.secure ? "https" : "http") + "://" + b.host : "未连接"} ｜ ${navigator.onLine ? "网络正常" : "离线"}`;
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
$("folderBtn").onclick = openBrowser;
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
function renderConvList() {
  const list = $("convList");
  if (!list) return;
  list.innerHTML = "";
  if (!convCache.length) { list.innerHTML = '<div class="browser-empty">还没有历史对话</div>'; return; }
  for (const c of convCache) {
    const row = document.createElement("div");
    row.className = "conv-item" + (c.id === curConvId ? " active" : "");
    const main = document.createElement("div");
    main.className = "conv-main";
    main.innerHTML = `<div class="conv-title"></div><div class="conv-sub"></div>`;
    main.querySelector(".conv-title").textContent = c.title || "未命名对话";
    main.querySelector(".conv-sub").textContent = fmtTime(c.updatedAt) + (c.id === curConvId ? " · 当前" : "");
    main.addEventListener("click", () => {
      if (c.id === curConvId) { $("historyModal").classList.add("hidden"); return; }
      send({ type: "loadConversation", id: c.id });
      addMsg("system", "正在载入对话：" + (c.title || ""));
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
$("historyClose").onclick = () => $("historyModal").classList.add("hidden");
$("newConvBtn").onclick = () => {
  send({ type: "newConversation" });
  addMsg("system", "已开始新对话");
  $("historyModal").classList.add("hidden");
};

// ---------- 顶栏下方的工作目录条 ----------
function updateCwdBar() {
  const bar = $("cwdBar");
  if (!bar) return;
  const short = currentCwd ? currentCwd.replace(/^.*[\\/]/, "") || currentCwd : "";
  bar.textContent = short ? "📂 " + short : "";
  bar.classList.toggle("hidden", !short);
  bar.title = currentCwd;
}

// ---------- 点弹窗外的暗色区域即关闭 ----------
document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target !== modal) return; // 只在点到背景（而非卡片内部）时关闭
    if (modal.id === "scanModal") { stopScan(); return; }
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
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
