// Tailscale 固定地址启动器：启动本地服务器 + 找到 Tailscale 固定 IP + 生成固定二维码
// 双击 start-tailscale.bat 即可。地址永远不变，手机装了 Tailscale 登录同一账号即可连。
import { spawn, exec, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const port = cfg.port || 8765;
const token = cfg.token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openFile(p) {
  if (process.platform === "win32") exec(`start "" "${p}"`);
  else if (process.platform === "darwin") exec(`open "${p}"`);
  else exec(`xdg-open "${p}"`);
}

// 找 Tailscale 分配的固定 IP（100.64.0.0/10 网段）
function getTailscaleIp() {
  const exes = [
    "tailscale",
    "C:\\Program Files\\Tailscale\\tailscale.exe",
    "C:\\Program Files (x86)\\Tailscale\\tailscale.exe",
  ];
  for (const e of exes) {
    try {
      const out = execSync(`"${e}" ip -4`, { encoding: "utf8", windowsHide: true }).trim();
      const ip = out.split(/\s+/).find((x) => /^100\./.test(x));
      if (ip) return ip;
    } catch {}
  }
  // 兜底：扫网卡，找名字含 tailscale 的，或 100.64–100.127 网段的地址
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family !== "IPv4" || i.internal) continue;
      if (/tailscale/i.test(name)) return i.address;
      const m = i.address.match(/^100\.(\d+)\./);
      if (m && +m[1] >= 64 && +m[1] <= 127) return i.address;
    }
  }
  return null;
}

function isPortListening(p) {
  if (process.platform !== "win32") return false;
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8", windowsHide: true });
    const re = new RegExp(":" + p + "\\b");
    return out.split("\n").some((l) => /LISTENING/i.test(l) && re.test(l));
  } catch { return false; }
}
function killPortListeners(p) {
  if (process.platform !== "win32") return;
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8", windowsHide: true });
    const re = new RegExp(":" + p + "\\b");
    const pids = new Set();
    for (const line of out.split("\n")) {
      if (/LISTENING/i.test(line) && re.test(line)) {
        const cols = line.trim().split(/\s+/);
        const pid = cols[cols.length - 1];
        if (pid && pid !== "0") pids.add(pid);
      }
    }
    for (const pid of pids) { try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore", windowsHide: true }); console.log(`（已关闭占用 ${p} 端口的旧进程 PID ${pid}）`); } catch {} }
  } catch {}
}
async function ensurePortFree(p) {
  if (!isPortListening(p)) return;
  console.log(`检测到 ${p} 端口被占用，正在清理旧实例…`);
  for (let i = 0; i < 20; i++) {
    killPortListeners(p);
    await sleep(250);
    if (!isPortListening(p)) { console.log("端口已清理干净。\n"); return; }
  }
  console.log("⚠ 端口仍被占用，继续启动（服务器会自动重试）。\n");
}

let server = null, keepAwake = null;
function startKeepAwake() {
  if (process.platform !== "win32") return;
  const ps = [
    "$s = '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint e);';",
    "$t = Add-Type -MemberDefinition $s -Name P -Namespace W -PassThru;",
    "while($true){ [void]$t::SetThreadExecutionState(2147483649); Start-Sleep -Seconds 50 }",
  ].join(" ");
  try {
    keepAwake = spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { stdio: "ignore", windowsHide: true });
    keepAwake.on("error", () => {});
    console.log("（已开启防睡眠：运行期间电脑不会睡，屏幕可正常熄灭）");
  } catch {}
}

function shutdown() {
  console.log("\n正在停止…");
  try { server && server.kill(); } catch {}
  try { keepAwake && keepAwake.kill(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);

async function main() {
  const tsIp = getTailscaleIp();
  if (!tsIp) {
    console.error("\n❌ 没找到 Tailscale 地址。请确认：");
    console.error("   1) 电脑已安装并登录 Tailscale（托盘里有图标、显示 Connected）；");
    console.error("   2) https://tailscale.com/download/windows 下载安装。");
    console.error("   装好登录后再双击本程序。\n");
    process.exit(1);
  }

  await ensurePortFree(port);
  startKeepAwake();

  console.log("启动本地服务器…\n");
  server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, NO_TUNNEL: "1", NO_PANEL: "1" }, // Tailscale 模式：不开 Cloudflare 隧道、不开面板
    stdio: ["ignore", "inherit", "inherit"],
  });
  server.on("error", (e) => console.error("服务器启动失败:", e.message));
  server.on("exit", (code) => { console.log("服务器已退出 (code " + code + ")"); try { keepAwake && keepAwake.kill(); } catch {} });

  await sleep(1500);
  const full = `http://${tsIp}:${port}/?token=${token}`;
  const qrPath = path.join(__dirname, "qr-tailscale.png");
  try { await QRCode.toFile(qrPath, full, { width: 600, margin: 2 }); openFile(qrPath); } catch {}

  console.log("\n========================================");
  console.log("  📌 Tailscale 固定地址已就绪（永不变）");
  console.log("========================================\n");
  console.log("手机要先装 Tailscale 并登录同一账号，然后扫 qr-tailscale.png，或打开：\n");
  console.log("   " + full + "\n");
  console.log("✅ 这个地址固定不变，手机「添加到主屏幕」后图标长期可用，不用再重扫。");
  console.log("⚠ 关掉这个窗口会停止服务器。按 Ctrl+C 停止。\n");
}

main();
