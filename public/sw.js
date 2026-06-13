const CACHE = "claude-remote-v18";
const ASSETS = ["./", "./index.html", "./app.js", "./styles.css", "./manifest.webmanifest", "./icon.svg", "./jsqr.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// 外壳 cache-first（点图标即使旧隧道源已失效也能离线打开）；其它 GET 网络优先；WS 不拦
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/ws") || url.pathname.startsWith("/control")) return;

  const isShell =
    e.request.mode === "navigate" ||
    ASSETS.some((a) => url.pathname === "/" || url.pathname.endsWith(a.replace("./", "/")));

  if (isShell) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const net = fetch(e.request)
          .then((r) => {
            const cp = r.clone();
            caches.open(CACHE).then((k) => k.put(e.request, cp)).catch(() => {});
            return r;
          })
          .catch(() => cached || caches.match("./index.html"));
        return cached || net;
      })
    );
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// 点通知回到 App
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
