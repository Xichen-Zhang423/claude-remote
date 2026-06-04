# 把「手机遥控 Claude Code」做成纯血鸿蒙 NEXT 原生 App

纯血鸿蒙（HarmonyOS NEXT / 5.x）装不了安卓 APK，所以要做一个**原生鸿蒙壳应用**：
用鸿蒙的 `Web` 组件原生加载你的网页 UI，**资源打进安装包**（离线秒开），开 App 就**走云端中转自动连电脑、免扫码**。

整套需要你在电脑上用 **DevEco Studio** 编译、签名、装到手机——这是鸿蒙的硬性要求（.hap 必须用你华为账号的证书签名，没有像安卓那样的免费云打包）。我已经把你需要的代码都写好了，你照下面做就行，约 20 分钟。

---

## 0. 准备
1. 装 **DevEco Studio**（华为官网 developer.huawei.com，选 HarmonyOS NEXT 版本，自带 SDK）。
2. 一个**华为账号**（用于自动签名，免费）。
3. 手机：设置→关于手机→连点「版本号」开开发者模式，再到 系统→开发者选项 打开「USB 调试」，用线连电脑。

---

## 1. 新建工程（让 DevEco 生成正确骨架）
DevEco → **Create Project** → **Application** → **Empty Ability** → Next，填：
- **Project name**：`ClaudeRemote`
- **Bundle name**：`com.claude.remote`
- **Compile SDK / Model**：选最新（API 12 / 5.0.0），**Stage 模型**
- 其余默认 → Finish。

> 为什么用向导建：鸿蒙工程的签名、SDK 路径、hvigor 版本等都由向导按你机器生成，比手写可靠。我们只替换/新增几个文件。

等它首次同步（Sync）完成、底部没报错。

---

## 2. 放入我写好的页面代码
把本文件夹里的 **`Index.ets`** 内容，整体**覆盖**到工程的：
```
entry/src/main/ets/pages/Index.ets
```
> 把里面顶部的 `TOKEN` 和 `RZ` 两行，改成你电脑 `config.json` 里的 `token` 和云端中转（Worker）地址。就这两行。

---

## 3. 加联网权限
打开工程的 `entry/src/main/module.json5`，参照本文件夹 **`module-permissions.json5`**，
把 `requestPermissions` 字段加进 `"module": { ... }` 里。最少要有：
```json5
"requestPermissions": [
  { "name": "ohos.permission.INTERNET" }
]
```
（不联网就连不上电脑。摄像头那条只有想用 App 内扫码才加。）

---

## 4. 把网页打进安装包（关键）
壳应用要把 `public/` 里的网页资源放进工程的 `rawfile` 目录。在**本文件夹**下开 PowerShell 跑：
```powershell
.\copy-web-to-rawfile.ps1 -Project "C:\Users\你的用户名\DevEcoStudioProjects\ClaudeRemote"
```
（`-Project` 换成你工程实际路径。）跑完它会列出 `rawfile` 里有 `index.html / app.js / styles.css / jsqr.min.js …` 就对了。

> 以后每次改了网页（`public/**`）想更新 App，重跑这条命令，再回 DevEco 重新编译即可。

---

## 5. 自动签名
DevEco → **File → Project Structure → Signing Configs** → 勾 **Automatically generate signature** → 用华为账号登录 → 等它生成证书（绿勾）。

---

## 6. 装到手机
手机连电脑（USB 调试已开）→ DevEco 右上角设备选你的手机 → 点 **▶ Run**。
它会编译 → 装到手机 → 自动打开。第一次会弹安装确认，手机上点允许。

> 想要安装包文件：**Build → Build Hap(s)/APP(s) → Build APP(s)**，产物 `.app` 在 `build/outputs/`。

---

## 7. 用起来
- 电脑端先开着（`start.bat`，隧道已就绪、二维码出现 = 公网地址已上报云端中转）。
- 手机开 App → 顶部小圆点变绿 = 自动连上了（免扫码，靠云端中转找当前地址）。
- 看屏幕 🖥️ → 🖱 全屏控制 → 手机就是电脑触屏：轻点单击、长按右键、双指缩放、右侧 ⌨ 抽屉是完整功能键。

---

## 排错
| 现象 | 原因 / 解决 |
|---|---|
| 白屏 | 第 4 步没拷或拷错目录。确认 `entry/src/main/resources/rawfile/index.html` 存在，重编译。|
| 圆点一直灰 / 连不上 | 电脑端没开，或隧道没上报云端中转。看电脑控制台日志有没有「已把当前网址上报到云端中转」。也可进 App 设置里手动扫码。|
| 连上但点击没反应 | 电脑端要用**新版** `control.ps1`（已修好），重开 `start.bat`。|
| 编译报 `onPermissionRequest` 类型错 | 把 `Index.ets` 里 `.onPermissionRequest((event)=>{...})` 整段删掉即可（免扫码用不到摄像头）。|
| 想换 token / 中转地址 | 改 `Index.ets` 顶部两行，重跑第 4 步、重编译。|

---

## 安卓鸿蒙那台（能装 APK 的）
不用做原生，直接用现成的 Capacitor APK：
1. 把本项目 `git push` 到 GitHub（我改的网页代码已在 `public/`）。
2. GitHub → 仓库 **Actions** → 「构建安卓 APK」会自动跑（约 5–10 分钟）。
3. 跑完点进去，**Artifacts** 里下载 `claude-remote-apk` → 解压得到 `app-debug.apk` → 传手机安装。
4. 之后每次改网页 push 一下，重新下载安装即可。
