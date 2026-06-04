# Open-sourcing a personal tool safely + cleanly

Before flipping a repo public, make sure no secret leaks (now OR in history), and lay the repo out so it
reads like a real project.

---

## 1. Secrets: keep them out, scrub the rest

- **`.gitignore` the runtime secret file** and private data from day one:
  ```gitignore
  node_modules/
  config.json          # contains your token / connection secret
  conversations/       # private data
  cloudflared.exe      # large binaries — users download their own
  ffmpeg.exe
  qr*.png
  *.log
  ```
  Verify a file is ignored: `git check-ignore config.json` (prints the name if ignored).
- **Scrub hardcoded secrets to placeholders** in any *tracked* file: tokens, tunnel/worker URLs (a worker
  URL like `clauderz.u202443163.workers.dev` also reveals your account id), publish secrets. Replace with
  obvious placeholders: `PASTE_YOUR_TOKEN_HERE`, `https://your-worker.your-name.workers.dev`,
  `change-me-to-a-random-string`. Common leak spots: native-shell config (`Index.ets`), how-to docs, example
  `config` blocks.
- Find them all: `grep -rI --exclude-dir=node_modules --exclude-dir=.git -e "<token>" -e "<worker-host>" -e "<secret>" .`
  (Your real `config.json` will match — that's fine *because it's gitignored*; confirm it's NOT in the staged
  set: `git add -A --dry-run` should not list it.)

## 2. Verify git HISTORY is clean (not just the working tree)

A scrub of the working tree doesn't help if the secret was committed earlier.
```bash
git log --all -- config.json          # empty = the secret file was never committed
git log --all -S "4388b337..."        # empty = the token never appears in any diff in history
```
If a secret IS in history, you must rewrite history (`git filter-repo`) or rotate the secret before going
public. Easiest path: if the secret-bearing files were always untracked/gitignored, you're already clean.

## 3. Repo layout (organize without breaking runtime)

Moving files breaks code that references them by path. Reorganize carefully:
- Keep the **entry point** (`server.js`) and **double-click launchers** (`.bat`) at the root for UX.
- Group helper scripts into `scripts/` and **update every path reference** (e.g. `path.join(__dirname,
  "scripts", "x.ps1")`); then verify: `node --check server.js` + confirm each referenced file exists.
- Move guides into `docs/` and **fix relative links** inside them (a doc now one level deeper needs `../`).
- Move dead experiments into `legacy/` (don't delete if unsure). Confirm nothing active references them
  before moving (grep the launchers/code).
- Suggested shape:
  ```
  repo/
  ├── README.md  LICENSE  server.js  package.json
  ├── start.bat  stop-tool.bat  ...launchers
  ├── public/            web UI / PWA
  ├── scripts/           helper scripts (paths updated in code)
  ├── app-android/  app-harmony/   client wrappers
  ├── cloudflare-worker/ rendezvous worker
  ├── docs/              guides (links fixed)
  └── legacy/            retired experiments
  ```

## 4. Make it look like a project

- **README** (the GitHub homepage): one-line pitch, a short English summary near the top for reach, feature
  list, **project structure**, setup, the **3-platform install methods** (Android APK / iOS PWA / HarmonyOS),
  remote-access setup, the AV/ffmpeg note, security, FAQ. Link to the deeper docs.
- **LICENSE** (MIT is the common permissive default). Reference it from the README.
- Add a repo **Description + Topics** in the GitHub "About" panel for discoverability.
- Document external binaries (`ffmpeg.exe`, `cloudflared.exe`) the user must download themselves, with links.

## 5. After it's public

- Share the bare `https://github.com/<user>/<repo>` URL — public means anyone can view/clone.
- Build artifacts (APK) come from the Actions run's **Artifacts**, not committed binaries.
