---
name: windows-phone-remote-skill
activation: /windows-phone-remote-skill
description: >-
  Build phone-to-PC remote control, screen-share, and Windows desktop-automation tools, and dodge the
  costly traps. Use when building a remote desktop, screen capture, mouse/keyboard automation, or
  "control my PC from my phone" tool, or when hitting Windows gotchas:
  DPI display-scaling screenshot cut-off and click offset; Windows Defender / AMSI flagging a
  PowerShell screen grab as ScriptContainedMaliciousContent; PowerShell 5.1 reading BOM-less UTF-8 as
  GBK and corrupting scripts; SendInput dropping clicks (use SetCursorPos + mouse_event); SendKeys
  can't do Alt+Tab/Win (use keybd_event); ffmpeg gdigrab capture; Cloudflare tunnel + Worker
  rendezvous for no-rescan remote access; packaging a PWA as an Android APK via Capacitor + GitHub
  Actions; HarmonyOS NEXT ArkTS WebView shell; game anti-cheat (Vanguard/VAC) crashing from input
  injection; safely open-sourcing a repo. Keywords: windows remote control, screen capture, gdigrab,
  ffmpeg, DPI aware, mouse_event, keybd_event, AMSI, Capacitor, HarmonyOS, PWA.
license: MIT
metadata:
  author: Xichen-Zhang423
  version: 1.0.0
  created: 2026-06-04
  last_reviewed: 2026-06-04
  review_interval_days: 180
provenance:
  maintainer: Xichen-Zhang423
  version: 1.0.0
  created: 2026-06-04
  source_references:
    - "Distilled from the claude-remote project: phone-remote-control of Claude Code on Windows (Node + PWA + PowerShell + Cloudflare + Capacitor + HarmonyOS ArkTS)."
---
# /windows-phone-remote-skill — Build phone↔PC remote control & automation on Windows

You are an expert in Windows desktop automation, screen capture, remote access, and cross-platform
app packaging. This skill encodes hard-won gotchas from shipping a real "control my PC's Claude Code
from my phone" tool (Node server + PWA + PowerShell + Cloudflare). Pull it whenever you build similar
Windows remote/automation tooling so you don't re-discover the same traps the slow way.

## Trigger

User invokes `/windows-phone-remote-skill` followed by their goal:

```
/windows-phone-remote-skill build a tool to see and control my PC screen from my phone
/windows-phone-remote-skill my screenshot is cut off on the right and clicks land in the wrong spot
/windows-phone-remote-skill PowerShell says ScriptContainedMaliciousContent when I capture the screen
/windows-phone-remote-skill let users connect from outside my home network without re-scanning a QR
/windows-phone-remote-skill package my web UI as an Android APK and a HarmonyOS app
/windows-phone-remote-skill help me open-source this repo without leaking my token
```

## When this applies

Building anything that **captures the Windows screen**, **simulates mouse/keyboard**, **exposes a
local service to a phone / the internet**, or **ships a web UI to Android / iOS / HarmonyOS**. Also
any time a Windows automation script "works when I run it but not from my app", or an antivirus or
display-scaling issue appears.

## The 8 traps that WILL bite you (read before coding)

Each links to a reference with copy-paste-ready fixes. Working templates are in `assets/`.

1. **DPI / display scaling → screenshot cut-off + click offset.** A DPI-*unaware* process reports the
   *logical* (scaled-down) screen size, but `CopyFromScreen` reads *physical* pixels — so you capture
   only the top-left chunk (right/bottom cut off) and taps land offset by the scale factor (e.g. 125%).
   Fix: capture at *physical* resolution and make the input/control side *DPI-aware*. See
   `references/windows-capture-and-control.md`.

2. **Antivirus/AMSI blocks PowerShell screen capture.** Windows **Defender** (and others) flag a script
   that does screen-capture + base64 (and worse: hardware-recon or P/Invoke + capture) as
   `ScriptContainedMaliciousContent`. **You cannot reliably evade this by restructuring code**, and
   re-running capture scripts escalates the AV. Fix: capture with a **signed binary — `ffmpeg` gdigrab**
   (AV-friendly, native physical res), or have the user add a Defender exclusion. See
   `references/windows-capture-and-control.md`.

3. **PowerShell 5.1 corrupts non-ASCII `.ps1` files.** `powershell.exe` reads BOM-less UTF-8 as GBK;
   3-byte CJK chars desync and eat newlines → bogus parse errors ("Unexpected token", "missing
   terminator") far from the real spot. Fix: keep `.ps1` **ASCII-only**, or save **UTF-8 with BOM**.
   Verify with `[Parser]::ParseFile`. See `references/windows-capture-and-control.md`.

4. **Clicks silently dropped / keys don't work.** `SendInput` fails silently if its struct-size arg is
   wrong. Use **`SetCursorPos` + `mouse_event`** (clicks) and **`keybd_event`** (system combos). `SendKeys`
   **cannot** do Alt+Tab / Win. Always run scripts from a **`-File`** (not inline `-Command`, which AMSI
   scans harder). Template: `assets/control.ps1`. See `references/windows-capture-and-control.md`.

5. **Game anti-cheat crashes the games.** Input injection + screen capture are exactly what **Vanguard**
   (Valorant, kernel driver, checks at boot) and **VAC** block — the games crash while your tool runs.
   Ship a "stop everything" script and tell users to disable boot-autostart + reboot before gaming.
   Template: `assets/stop-tool.bat`. See `references/windows-capture-and-control.md`.

6. **Remote access without re-scanning.** A Cloudflare **quick tunnel** URL changes every restart. Add a
   tiny Cloudflare **Worker "rendezvous"** that stores the current URL (never the token); the phone scans
   once and always asks the worker for the live URL. Add publish retries + tunnel auto-restart. Templates:
   `assets/rendezvous.worker.js`. See `references/remote-access-tunneling.md`.

7. **One web UI, three phone platforms.** Build a **PWA** (service worker, installable). Package it as an
   **Android APK** with Capacitor built in **GitHub Actions** (no local Android toolchain). For pure
   **HarmonyOS NEXT** (can't run APKs), ship a native **ArkTS `Web` component** loading bundled `rawfile`
   + `javaScriptOnDocumentStart` to seed the connection. iOS = PWA only. Templates:
   `assets/build-apk.workflow.yml`, `assets/harmony-Index.ets`. See `references/cross-platform-clients.md`.

8. **Open-sourcing safely.** Gitignore `config.json`/secrets/large binaries; scrub any hardcoded
   token / tunnel URL / worker secret to placeholders; **verify history is clean** with
   `git log --all -S "<secret>"` and `git log --all -- config.json`; add README + MIT LICENSE; organize
   into folders. See `references/open-source-checklist.md`.

## Recommended build order

1. **Local loop first:** Node (or any) server + a browser page on `localhost`; prove prompt/echo over
   WebSocket with a shared token.
2. **Screen capture:** wire `ffmpeg gdigrab` (preferred) with a PowerShell fallback; handle the AV reality
   up front (trap #2). Get a full, non-cut-off frame (trap #1).
3. **Input control:** `assets/control.ps1` via `-File`; verify clicks land *pixel-perfect* by moving the
   cursor to known ratios and reading back its position (trap #1, #4).
4. **Phone UX:** map taps→physical coordinates with `getBoundingClientRect` (works under CSS rotate/zoom);
   add long-press=right-click, pinch-zoom, an on-screen keyboard.
5. **Remote access:** Cloudflare tunnel + rendezvous worker (trap #6).
6. **Package:** PWA → APK (Actions) → HarmonyOS shell (trap #7).
7. **Ship:** open-source checklist (trap #8).

## Verify, don't assume

- **Clicks:** move to `rx=0.5,ry=0.5`, read cursor — must equal physical-screen center. Repeat at corners.
- **Capture not cut off:** sample the bottom-right pixel of the captured bitmap; it must be real content,
  not black padding.
- **PowerShell parses:** `[System.Management.Automation.Language.Parser]::ParseFile(path,[ref]$t,[ref]$e)`.
- **No secret in git history:** `git log --all -S "<token>"` returns empty.

## Reference artifacts (`assets/`)

| File | What it is |
|------|------------|
| `control.ps1` | DPI-aware mouse/keyboard: `SetCursorPos`+`mouse_event`+`keybd_event`, ASCII-only, combos (Alt+Tab/Win). |
| `screenshot.ps1` | PowerShell capture fallback: param `-pw/-ph/-out`, saves JPEG to file (no base64 in-script), ASCII-only. |
| `getres.ps1` | Reads physical resolution via WMI (no capture) so the fallback capture can grab the full screen. |
| `rendezvous.worker.js` | Cloudflare Worker: `POST /publish` stores current URL (Bearer auth), `GET /` returns it. Token never stored. |
| `build-apk.workflow.yml` | GitHub Actions: Capacitor → Android SDK → `assembleDebug` → upload APK artifact. No local toolchain. |
| `harmony-Index.ets` | HarmonyOS NEXT ArkTS shell: `Web` component loads bundled `index.html`, seeds connection at document-start. |
| `stop-tool.bat` | Kill all of the tool's processes (for anti-cheat games / clean shutdown) by command-line match. |

## References

- `references/windows-capture-and-control.md` — DPI, ffmpeg vs PowerShell, AMSI/Defender, PS encoding, input simulation, anti-cheat.
- `references/remote-access-tunneling.md` — Cloudflare tunnel lifecycle, Worker rendezvous, auto-reconnect, security model.
- `references/cross-platform-clients.md` — PWA, Capacitor APK via Actions, HarmonyOS NEXT shell, iOS notes.
- `references/open-source-checklist.md` — secret scrub, gitignore, history verification, repo layout.
