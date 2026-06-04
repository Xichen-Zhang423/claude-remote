# Remote access: Cloudflare tunnel + Worker rendezvous (no re-scanning)

Goal: phone connects to a PC behind NAT/firewall, from anywhere, **scanning a QR only once** — even though
the public URL changes every restart.

---

## Why not the obvious options

- **Port-forward / LAN IP:** blocked by firewall on "Public" Wi-Fi profiles; not reachable off-network;
  picking the right LAN adapter is unreliable when proxy/VPN virtual adapters exist (score adapters: prefer
  `wlan/wifi/ethernet`, skip `vethernet/wsl/docker/vmware/hyper-v/tailscale/xray/clash/loopback/169.254.*`).
- **Cloudflare quick tunnel** (`cloudflared tunnel --url http://localhost:PORT`): zero-config, gives an
  `https://<random>.trycloudflare.com` URL with TLS — great, **but the URL changes every restart**, so a
  home-screen PWA / saved bookmark dies.

## The rendezvous pattern

A tiny **Cloudflare Worker** + KV acts as a "current address" board:

- **PC**, each time it gets a new tunnel URL, `POST /publish { url }` to the Worker (Bearer-auth with a
  shared secret). The Worker stores `{ url, at }` in KV.
- **Phone**, on connect, `GET /` the Worker → gets the live URL → connects there. It caches the last URL as
  a fallback.
- The **token is never sent to the Worker** — only the URL. Someone seeing the rendezvous URL still can't
  connect without the token. The token rides in the QR (`?token=...`) and lives only in the phone's
  localStorage.

So the QR encodes `https://<tunnel>/?token=<token>&rz=<worker-url>`. Scan once; thereafter the phone reads
`rz` and always resolves the current tunnel URL itself. Worker template: `assets/rendezvous.worker.js`.

### Worker setup (Cloudflare dashboard, free tier)
1. Workers & Pages → Create → "Hello World" → Deploy.
2. Edit code → paste `assets/rendezvous.worker.js` → Deploy.
3. Storage → KV → create a namespace; bind it to the Worker as variable **`RZ`**.
4. Settings → Variables → add a **Secret** `PUBLISH_SECRET` (any random string).
5. PC config: `rendezvous.url = https://<worker>.workers.dev`, `rendezvous.secret = <PUBLISH_SECRET>`.

---

## Robustness (learned the hard way)

- **Publish over a flaky network (e.g. China → Cloudflare):** the single startup POST often fails. Add
  **retries with backoff** (e.g. 4× at 3/6/9/12s) AND a periodic **self-heal** (every ~120s re-publish
  while `!published`). Auto-prepend `https://` if the user omitted it (common config mistake → "Failed to
  parse URL").
- **Tunnel dies on idle / network blip:** `cloudflared` exits. Track an `intentional` flag; on *unexpected*
  exit, **auto-restart after a few seconds** and re-publish the new URL. Mark intentional before a manual
  stop/restart so you don't fight yourself.
- **Phone reconnection:** mobile OSes freeze/half-kill the WebSocket in the background. On the client:
  reconnect on `visibilitychange`(→visible)/`online`/`focus`/`pageshow`; heartbeat (ping/pong) every ~22s
  and force-rebuild if no pong for ~70s. Dedupe with a connect lock.
- **Resolve-URL fetch MUST have a timeout.** On a flaky network a no-timeout `fetch` to the rendezvous hangs
  forever, holding the connect lock and deadlocking all reconnects. Use a 6s `AbortController`.
- **Service Worker shell cache** lets the installed PWA open even if the old tunnel origin is dead (then it
  resolves the new URL and connects).

---

## Security model

- Token-auth every WebSocket (`?token=`); reject mismatches with a clear close code.
- Bind the localhost control channel to `127.0.0.1`/`::1` only.
- This grants "run commands on my PC" over the network — document: keep the token secret, prefer the tunnel
  over raw port-forward, don't enable any "full-auto / skip-permissions" mode on untrusted networks, and
  stop the service when unused.
