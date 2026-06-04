// ============================================================
//  手机遥控 Claude —— 云端「网址中转站」（Cloudflare Worker）
// ============================================================
// 作用：电脑每次拿到新的隧道网址后，发到这里存着；手机打开时先来这里
// 读「当前网址」，再连过去。这样隧道网址再怎么变，手机都能自动找到，
// 不用再扫码。
//
// 安全：这里只存「网址」，不存 token（token 一直在你手机本地）。
//       光有网址没 token 连不上，所以即使这个地址被别人看到也没用。
//
// 部署见同目录 ../免扫码连接说明.md
// ------------------------------------------------------------
// 需要：① 绑定一个 KV 命名空间，变量名填 RZ
//       ② 加一个机密变量 PUBLISH_SECRET（电脑发布时校验用，自己随便设一串）
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    // 电脑上报当前网址：POST /publish  { "url": "https://xxx.trycloudflare.com" }
    if (url.pathname === "/publish" && req.method === "POST") {
      const auth = req.headers.get("authorization") || "";
      if (!env.PUBLISH_SECRET || auth !== "Bearer " + env.PUBLISH_SECRET) {
        return new Response("unauthorized", { status: 401, headers: CORS });
      }
      let body;
      try { body = await req.json(); } catch { return new Response("bad json", { status: 400, headers: CORS }); }
      if (!body || typeof body.url !== "string" || !/^https?:\/\//.test(body.url)) {
        return new Response("need url", { status: 400, headers: CORS });
      }
      await env.RZ.put("current", JSON.stringify({ url: body.url, at: Date.now() }));
      return new Response("ok", { headers: CORS });
    }

    // 手机读取当前网址：GET /  或  GET /current
    const v = await env.RZ.get("current");
    return new Response(v || JSON.stringify({ url: null }), {
      headers: { "content-type": "application/json", ...CORS },
    });
  },
};
