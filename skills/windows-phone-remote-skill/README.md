# windows-phone-remote-skill

A reference skill for building **phone↔PC remote control, screen-share, and desktop-automation tools on
Windows** — and dodging the traps that cost real debugging time (DPI scaling cut-off & click offset,
Windows Defender/AMSI blocking PowerShell screen capture, PowerShell 5.1 UTF-8/GBK corruption, robust
mouse/keyboard injection, game anti-cheat conflicts, Cloudflare tunnel + Worker rendezvous, packaging a PWA
as an Android APK / HarmonyOS NEXT app, and safe open-sourcing).

Distilled from actually shipping such a tool. Once installed, invoke it with `/windows-phone-remote-skill`.

---

## What's inside

```
windows-phone-remote-skill/
├── SKILL.md            # the skill: the 8 traps, build order, verification, artifact index
├── references/
│   ├── windows-capture-and-control.md   # DPI, ffmpeg vs PowerShell, AMSI/Defender, PS encoding, input sim, anti-cheat
│   ├── remote-access-tunneling.md       # Cloudflare tunnel + Worker rendezvous, auto-reconnect, security
│   ├── cross-platform-clients.md        # PWA, Capacitor APK via GitHub Actions, HarmonyOS NEXT shell
│   └── open-source-checklist.md         # secret scrub, gitignore, git-history verification, repo layout
├── assets/             # battle-tested, copy-paste-ready templates
│   ├── control.ps1                 # DPI-aware mouse/keyboard (SetCursorPos + mouse_event + keybd_event)
│   ├── screenshot.ps1              # PowerShell capture fallback (param size, saves JPEG file, ASCII-only)
│   ├── getres.ps1                  # physical resolution via WMI (no capture → AV-safe)
│   ├── rendezvous.worker.js        # Cloudflare Worker: stores current tunnel URL (never the token)
│   ├── build-apk.workflow.yml      # GitHub Actions: Capacitor → Android APK artifact
│   ├── harmony-Index.ets           # HarmonyOS NEXT ArkTS WebView shell
│   └── stop-tool.bat               # kill all tool processes (anti-cheat games / clean shutdown)
├── install.sh          # cross-platform auto-detect installer
└── README.md           # this file
```

---

## Install

### Option A — one-liner per platform (recommended)

Clone straight into your agent's skills folder:

```bash
# Claude Code (user-level, all projects)
git clone <REPO_URL> ~/.claude/skills/windows-phone-remote-skill

# Claude Code (project-level, this repo only)
git clone <REPO_URL> .claude/skills/windows-phone-remote-skill

# VS Code / GitHub Copilot
git clone <REPO_URL> .github/skills/windows-phone-remote-skill

# Cursor
git clone <REPO_URL> .cursor/rules/windows-phone-remote-skill

# Universal (Codex CLI, Gemini CLI, Kiro, Antigravity, …)
git clone <REPO_URL> ~/.agents/skills/windows-phone-remote-skill
```

This skill ships as a folder, so you can also just **copy** the `windows-phone-remote-skill/` directory into
any of those paths — no git required:

```bash
cp -R windows-phone-remote-skill ~/.claude/skills/
```

On Windows (PowerShell):
```powershell
Copy-Item -Recurse -Force .\windows-phone-remote-skill "$env:USERPROFILE\.claude\skills\windows-phone-remote-skill"
```

### Option B — the installer (auto-detects your platform)

```bash
chmod +x ./windows-phone-remote-skill/install.sh
./windows-phone-remote-skill/install.sh            # auto-detect
./windows-phone-remote-skill/install.sh --all      # install to every detected platform
./windows-phone-remote-skill/install.sh --platform cursor
./windows-phone-remote-skill/install.sh --dry-run  # show what it would do
```

| Platform | Install path |
|----------|--------------|
| Claude Code | `~/.claude/skills/` or `.claude/skills/` |
| GitHub Copilot | `.github/skills/` |
| Cursor | `.cursor/rules/` |
| Windsurf | `.windsurf/rules/` |
| Cline | `.clinerules/` |
| Gemini CLI | `~/.gemini/skills/` |
| Universal | `~/.agents/skills/` or `.agents/skills/` |

---

## Use

Open a new session and type:

```
/windows-phone-remote-skill build a tool to see and control my PC screen from my phone
/windows-phone-remote-skill my screenshot is cut off and clicks land in the wrong place
/windows-phone-remote-skill PowerShell says ScriptContainedMaliciousContent when capturing the screen
/windows-phone-remote-skill let my phone reconnect from anywhere without re-scanning a QR
/windows-phone-remote-skill package my web UI as an Android APK and a HarmonyOS app
```

The skill loads the relevant reference and points you at the matching template in `assets/`.

---

## Notes

- The `assets/*.ps1` are **ASCII-only on purpose** (Windows PowerShell 5.1 corrupts BOM-less UTF-8). Keep them
  that way if you edit.
- `assets/rendezvous.worker.js` and `assets/harmony-Index.ets` contain **placeholders** (token / worker URL) —
  fill in your own; never commit real secrets.
- License: MIT.
