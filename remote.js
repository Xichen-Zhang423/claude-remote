// 一键远程：同时启动本地服务器 + Cloudflare 隧道，自动抓公网地址并弹出二维码
// 双击 start-remote.bat 即可
import { spawn, exec, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const port = cfg.port || 8765;
const token = cfg.token;
const cfExe = path.join(__dirname, "cloudflared.exe");

if (!fs.existsSync(cfExe)) {
  console.error("\n❌ 找不到 cloudflared.exe");
  console.error("   请到 https://github.com/cloudflare/cloudflared/releases/latest 下载");
  console.error("   Windows 选 cloudflared-windows-amd64.exe，改名为 cloudflared.exe 放到本文件夹。\n");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openFile(p) {
  if (process.platform === "win32") exec(`start "" "${p}"`);
  else if (process.platform === "darwin") exec(`open "${p}"`);
  else exec(`xdg-open "${p}"`);
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
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore", windowsHide: true }); console.log(`（已关闭占用 ${p} 端口的旧进程 PID ${pid}）`); } catch {}
    }
  } catch {}
}

function killStrayCloudflared() {
  if (process.platform !== "win32") return;
  try { execSync("taskkill /F /IM cloudflared.exe", { stdio: "ignore", windowsHide: true }); } catch {}
}

// 启动前确保端口真正空出来（应对旧进程刚关、端口还没释放）
async function ensurePortFree(p) {
  if (!isPortListening(p)) return;
  console.log(`检测到 ${p} 端口被占用，正在清理旧实例…`);
  for (let i = 0; i < 20; i++) {        // 最多等 ~5 秒
    killPortListeners(p);
    await sleep(250);
    if (!isPortListening(p)) { console.log("端口已清理干净。\n"); return; }
  }
  console.log("⚠ 端口仍被占用，继续启动（服务器会自动重试绑定）。\n");
}

let server = null, tunnel = null, keepAwake = null, urlFound = false;

// 运行期间阻止电脑睡眠（屏幕仍可熄灭）；关掉本程序后自动恢复
function startKeepAwake() {
  if (process.platform !== "win32") return;
  const ps = [
    "$s = '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint e);';",
    "$t = Add-Type -MemberDefinition $s -Name P -Namespace W -PassThru;",
    // ES_CONTINUOUS(0x80000000) | ES_SYSTEM_REQUIRED(0x1)
    "while($true){ [void]$t::SetThreadExecutionState(2147483649); Start-Sleep -Seconds 50 }",
  ].join(" ");
  try {
    keepAwake = spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { stdio: "ignore", windowsHide: true });
    keepAwake.on("error", () => {});
    console.log("（已开启防睡眠：运行期间电脑不会睡，屏幕可正常熄灭）");
  } catch {}
}

function scan(buf) {
  if (urlFound) return;
  const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (m) { urlFound = true; onUrl(m[0]); }
}

async function onUrl(base) {
  const full = `${base}/?token=${token}`;
  const qrPath = path.join(__dirname, "qr-remote.png");
  try { await QRCode.toFile(qrPath, full, { width: 600, margin: 2 }); openFile(qrPath); } catch {}
  console.log("\n========================================");
  console.log("  🌍 公网远程地址已就绪（在家/出门都能用）");
  console.log("========================================\n");
  console.log("手机扫刚弹出的二维码 qr-remote.png，或在浏览器打开：\n");
  console.log("   " + full + "\n");
  console.log("⚠ 这个网址每次重启会变（临时隧道）。");
  console.log("⚠ 关掉这个窗口，服务器和隧道都会一起停止。\n");
  console.log("按 Ctrl+C 停止（或直接关窗口）。");
}

function shutdown() {
  console.log("\n正在停止服务器和隧道…");
  try { server && server.kill(); } catch {}
  try { tunnel && tunnel.kill(); } catch {}
  try { keepAwake && keepAwake.kill(); } catch {}
  killStrayCloudflared();
  process.exit(0);
}
process.on("SIGINT", shutdown);

async function main() {
  await ensurePortFree(port);
  killStrayCloudflared(); // 清掉可能残留的旧隧道
  startKeepAwake();

  console.log("① 启动本地服务器…");
  server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, REMOTE: "1" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  server.on("error", (e) => console.error("服务器启动失败:", e.message));
  server.on("exit", (code) => {
    console.log("服务器已退出 (code " + code + ")");
    try { tunnel && tunnel.kill(); } catch {}
    try { keepAwake && keepAwake.kill(); } catch {}
  });

  console.log("② 启动 Cloudflare 隧道（首次可能要十几秒）…\n");
  tunnel = spawn(cfExe, ["tunnel", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  tunnel.on("error", (e) => console.error("隧道启动失败:", e.message));
  tunnel.stdout.on("data", scan);
  tunnel.stderr.on("data", scan);
  tunnel.on("exit", () => {
    console.log("隧道已退出");
    try { server && server.kill(); } catch {}
    try { keepAwake && keepAwake.kill(); } catch {}
  });
}

main();
