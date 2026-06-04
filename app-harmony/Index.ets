// 纯血鸿蒙 NEXT 原生壳 —— 把手机遥控网页用鸿蒙 Web 组件加载，开 App 即自动连电脑。
// 用法：在 DevEco Studio 新建工程后，用本文件内容替换 entry/src/main/ets/pages/Index.ets。
// 详见同目录《使用教程-鸿蒙NEXT.md》。
import { webview } from '@kit.ArkWeb';

// ============ 改成你电脑 config.json 里的值 ============
const TOKEN: string = 'PASTE_YOUR_TOKEN_HERE';                  // 你电脑 config.json 里的 token
const RZ: string = 'https://your-worker.your-name.workers.dev'; // 你的 Cloudflare Worker 中转地址
// =====================================================

// 在网页自己的脚本之前注入：① 标记为本地壳（跳过 Service Worker，资源本就在包里）
// ② 预置连接信息到 localStorage —— 开 App 就走云端中转自动找当前公网地址并连上，无需扫码。
const SEED_JS: string =
  "window.Capacitor = window.Capacitor || { platform: 'harmony' };" +
  "try {" +
  "  var rz = '" + RZ + "';" +
  "  var token = '" + TOKEN + "';" +
  "  if (!localStorage.getItem('backend')) {" +
  "    localStorage.setItem('backend', JSON.stringify({ host: rz.replace(/^https?:\\/\\//, ''), token: token, secure: true, rz: rz }));" +
  "    localStorage.setItem('token', token);" +
  "  }" +
  "} catch (e) {}";

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();

  build() {
    Column() {
      Web({ src: $rawfile('index.html'), controller: this.controller })
        .javaScriptAccess(true)        // 允许网页 JS
        .domStorageAccess(true)        // 允许 localStorage（记住连接信息）
        .databaseAccess(true)
        .mixedMode(MixedMode.All)      // 允许 wss/https 混合，连隧道用
        .cacheMode(CacheMode.Default)
        .darkMode(WebDarkMode.On)
        .javaScriptOnDocumentStart([{ script: SEED_JS, scriptRules: ['*'] }])
        // 下面这段是给「App 内扫码」用的摄像头授权；用云端中转免扫码时其实用不到，可删。
        .onPermissionRequest((event) => {
          if (event) {
            event.request.grant(event.request.getAccessibleResource());
          }
        })
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
