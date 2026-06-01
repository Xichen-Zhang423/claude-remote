// 在 `npx cap add android` 生成原生工程后运行：
// 给 AndroidManifest 加上摄像头权限（扫码连接需要 getUserMedia）。
// 联网/明文已由 capacitor.config.json 的 server.cleartext 处理。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // app-android/
const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");

if (!fs.existsSync(manifestPath)) {
  console.error("找不到 AndroidManifest.xml，请确认已先运行 `npx cap add android`：", manifestPath);
  process.exit(1);
}

let xml = fs.readFileSync(manifestPath, "utf8");
const perms = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
];

let added = 0;
for (const p of perms) {
  const key = p.match(/android:name="([^"]+)"/)[1];
  if (!xml.includes(key)) {
    // 插入到 <manifest ...> 开标签之后
    xml = xml.replace(/(<manifest[^>]*>)/, `$1\n    ${p}`);
    added++;
  }
}

fs.writeFileSync(manifestPath, xml);
console.log(`AndroidManifest 已处理，新增 ${added} 条权限/特性声明。`);
