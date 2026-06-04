# 把手机端打包成安卓 APK（云端构建）

你的电脑没装 Android 开发工具链（Java / Android SDK / Gradle），而且在国内下载这些很费劲。
所以这里用 **GitHub Actions 在云端编译**，你本地什么都不用装，最后下载一个 APK 装到手机即可。

APK 里**只打包了界面**（`public/` 那套网页），后端还是你电脑上的 `server.js`。
APK 第一次打开是「扫码连接」界面，扫一下电脑控制台的二维码（或手动填地址+Token）就连上了——
和现在网页版一模一样，但好处是：**隧道地址每次变也不影响 App 本身**，只要重新扫码即可。

---

## 一次性准备（5 步）

### 1. 装个 Git（如果没有）
去 https://git-scm.com/download/win 下载安装，一路默认即可。

### 2. 把项目变成 Git 仓库并提交
在项目文件夹 `d:\桌面\新建文件夹` 里打开 PowerShell/终端，依次运行：

```powershell
git init
git add .
git commit -m "手机遥控 Claude Code"
```

> `.gitignore` 已经帮你排除了含密钥的 `config.json`、私人聊天记录、54MB 的 cloudflared.exe，
> 这些**不会**被上传。

### 3. 在 GitHub 建一个仓库
- 登录 https://github.com → 右上角 + → New repository
- 名字随便（比如 `claude-remote`），**选 Private（私有）** 更稳妥
- 建好后别加任何文件，照着页面提示里 “…or push an existing repository” 那两行做：

```powershell
git remote add origin https://github.com/你的用户名/claude-remote.git
git branch -M main
git push -u origin main
```

（第一次 push 会让你登录 GitHub，按提示走即可。）

### 4. 触发构建
推上去后，GitHub 会**自动开始构建**（因为改动了 `public/` 和 `app-android/`）。
也可以手动触发：仓库页面 → 上方 **Actions** 标签 → 左侧 “构建安卓 APK” → 右侧 **Run workflow**。

第一次大约跑 5～10 分钟（云端要下载 Android SDK）。

### 5. 下载并安装 APK
- 构建完成后（绿色 ✓），点进那次运行
- 拉到底部 **Artifacts** → 下载 `claude-remote-apk`（是个 zip，里面是 `app-debug.apk`）
- 把 apk 传到手机，点开安装（鸿蒙/安卓会提示“未知来源”，允许即可）

---

## 之后每次改了界面想更新 APK
只要再 `git add . && git commit -m "更新" && git push`，
Actions 会自动重新构建，去 Actions 里下最新的 APK 重装即可。

---

## 说明 / 注意

- **能连什么后端**：App 用 `http://localhost` 加载，属于安全上下文，
  既能连隧道的 `wss://`（出门），也能连局域网的 `ws://`（在家）。摄像头扫码也因此可用。
- **摄像头扫码**：已在构建时自动加了摄像头权限。若个别机型在 App 里摄像头不弹，
  可改用「⚙ 设置 → 服务器地址 + Token」手动填（控制台网页上有明文地址）。
- **通知**：网页的本地通知在打包后的 WebView 里不一定触发；
  如果你确实需要后台通知，告诉我，我再接 Capacitor 的原生本地通知插件。
- **这是 Debug 包**（未签名/调试签名），自用足够。要做正式签名包以后可加。
- **APK 只是界面**：电脑端 `server.js` 该开还得开（start.bat），手机才有后端可连。
