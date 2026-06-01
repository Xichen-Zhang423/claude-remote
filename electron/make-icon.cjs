// 无依赖生成 build/icon.png：品牌色圆角方块 + 白色 ">_" 终端提示符
const fs = require("node:fs");
const zlib = require("node:zlib");
const path = require("node:path");

const W = 256, H = 256, R = 56;
const accent = [217, 119, 87];
const white = [255, 255, 255];
const stride = W * 4 + 1;
const raw = Buffer.alloc(stride * H);

// ---- PNG 编码辅助（先定义，避免 TDZ）----
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function ihdr() {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(W, 0); b.writeUInt32BE(H, 4);
  b[8] = 8; b[9] = 6; b[10] = 0; b[11] = 0; b[12] = 0;
  return b;
}

function inRounded(x, y) {
  const rx = Math.min(x, W - 1 - x), ry = Math.min(y, H - 1 - y);
  if (rx >= R || ry >= R) return true;
  const dx = R - rx, dy = R - ry;
  return dx * dx + dy * dy <= R * R;
}
function setPx(x, y, c, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = y * stride + 1 + x * 4;
  raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = a;
}
function thickLine(x0, y0, x1, y1, wdt) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / steps);
    const y = Math.round(y0 + (y1 - y0) * i / steps);
    for (let dx = -wdt; dx <= wdt; dx++) for (let dy = -wdt; dy <= wdt; dy++)
      if (dx * dx + dy * dy <= wdt * wdt) setPx(x + dx, y + dy, white);
  }
}

// 背景圆角实心
for (let y = 0; y < H; y++) {
  raw[y * stride] = 0; // filter byte
  for (let x = 0; x < W; x++) {
    if (inRounded(x, y)) setPx(x, y, accent, 255);
    else setPx(x, y, [0, 0, 0], 0);
  }
}
// ">" + 下划线
thickLine(92, 90, 150, 128, 8);
thickLine(150, 128, 92, 166, 8);
for (let x = 150; x < 196; x++) for (let w = 0; w < 14; w++) setPx(x, 158 + w, white);

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr()),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.mkdirSync(path.join(__dirname, "..", "build"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "..", "build", "icon.png"), png);
console.log("wrote build/icon.png", png.length, "bytes");

// 同时输出 .ico（内嵌 PNG，Vista+ 支持），给桌面快捷方式用
const ico = Buffer.alloc(22 + png.length);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(0, 6); ico.writeUInt8(0, 7); ico.writeUInt8(0, 8); ico.writeUInt8(0, 9);
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
png.copy(ico, 22);
fs.writeFileSync(path.join(__dirname, "..", "build", "icon.ico"), ico);
console.log("wrote build/icon.ico", ico.length, "bytes");
