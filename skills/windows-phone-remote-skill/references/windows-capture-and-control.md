# Windows screen capture + remote control — gotchas & fixes

Everything here was learned by shipping a real tool. Symptoms are described so you can match them fast.

---

## 1. DPI / display scaling → cut-off screenshot + offset clicks

**Symptom:** On a scaled display (e.g. 2560×1440 at 125%), the phone shows only the top-left ~80% of the
desktop (right edge + taskbar cut off), AND taps land offset toward the bottom-right.

**Why:** A *DPI-unaware* process gets the **logical** size from `SystemInformation.VirtualScreen`
(2560/1.25 = 2048 × 1152), but `Graphics.CopyFromScreen` copies **physical** pixels. So a 2048×1152
bitmap grabs only the top-left 2048×1152 of the 2560×1440 physical screen → cut off. For clicks, a tap at
`rx=0.5` → `0.5*2048=1024` logical, which Windows then scales ×1.25 → physical 1280 → offset.

**Fixes (both sides must agree on PHYSICAL pixels):**
- **Capture at physical resolution.** Either make the capture process DPI-aware, *or* read the physical
  resolution another way and size the bitmap to it. (See ffmpeg below — `gdigrab` is physical natively.)
- **Make the control/input process DPI-aware** with `SetProcessDPIAware()` so `VirtualScreen` returns
  physical and `SetCursorPos` uses physical pixels. Then `x = rx * physicalWidth` lands exactly.

**Verify:** move the cursor to ratio (0.5,0.5) and read it back from a DPI-aware reader — it must be the
exact physical-screen center. We measured: `move(0.5,0.5)` → (1280,720), `move(0.99,0.99)` → (2534,1426)
on a 2560×1440 screen. Pixel-perfect.

**Coordinate mapping on the client:** compute desktop ratios from the *rendered image rectangle*, not the
element box. `getBoundingClientRect()` stays correct even under CSS `rotate(90deg)` + scale + translate
(all keep the box axis-aligned), so for a 90° rotate the inverse map is `rx = v, ry = 1 - u` (where u,v are
normalized within the rect). For 0°: `rx = u, ry = v`. Size the `<img>` to the exact aspect ratio (no
`object-fit` letterbox) or the ratios drift.

---

## 2. Antivirus / AMSI blocks PowerShell screen capture (the big one)

**Symptom:** `powershell -File screenshot.ps1` fails with
`FullyQualifiedErrorId : ScriptContainedMaliciousContent` / "This script contains malicious content and
has been blocked by your antivirus software." (That generic English message is **Windows Defender**'s AMSI
verdict — present even if the user has no third-party AV.)

**What we proved (so you don't waste time):**
- Capture (`CopyFromScreen`) **+ base64 output** = the textbook screenshot-exfiltration signature → flagged.
- Adding **WMI hardware recon** (`Get-CimInstance Win32_VideoController`) or **P/Invoke** (`Add-Type` +
  `DllImport`) on top of capture makes it worse.
- Removing base64 (save to a file instead) and stripping suspicious comments **did not** reliably help once
  the AV escalated. **Re-running flagged capture scripts ESCALATES the AV** for the whole folder/session.
- AMSI even scans the **command text you type**, so authoring capture code inline in a shell command gets
  *that command* blocked too.

**Conclusion: you cannot reliably evade a heuristic AV with code structure — and you shouldn't try.**

**The fix that works: use a signed binary — `ffmpeg` `gdigrab`.**
```
ffmpeg -loglevel error -f gdigrab -framerate 1 -i desktop -frames:v 1 -vf "scale=1280:-1" -q:v 5 -y out.jpg
```
- `ffmpeg.exe` is digitally signed → Defender does not flag it.
- `gdigrab -i desktop` grabs the **full physical-resolution** desktop → also fixes trap #1 for free.
- Read the saved `out.jpg` in your server (Node etc.) and base64 it there if you need a data URL.
- Architecture: **try ffmpeg first, fall back to PowerShell** if `ffmpeg.exe` isn't present; cache which works.

**Fallback PowerShell capture (when ffmpeg absent), made as benign as possible:**
- Get physical size in a **separate** script (`getres.ps1`, WMI only, NO capture → not flagged).
- Capture in `screenshot.ps1` with the size passed as a parameter (NO WMI, NO P/Invoke), and **save a JPEG
  file** rather than emitting base64. The server reads the file. (This passes *some* AVs; Defender may still
  block once escalated — then the user must add a Defender exclusion: Settings → Privacy & security →
  Windows Security → Virus & threat protection → Manage settings → Exclusions → Folder.)

See `assets/screenshot.ps1` and `assets/getres.ps1`.

---

## 3. PowerShell 5.1 corrupts non-ASCII `.ps1` (encoding trap)

**Symptom:** A `.ps1` with Chinese/other non-ASCII comments throws nonsense parse errors
("Unexpected token '}'", "The string is missing the terminator") at lines that look fine — and the *same
content* parses fine elsewhere.

**Why:** `powershell.exe` (Windows PowerShell 5.1) reads a BOM-less UTF-8 file as the system ANSI code page
(GBK on zh-CN). A 3-byte UTF-8 CJK char is mis-grouped, the byte stream desyncs, and a `0x0A` newline gets
swallowed → structure breaks.

**Fix:** keep `.ps1` **ASCII-only**, OR write it **UTF-8 with BOM**:
```powershell
$txt = Get-Content -LiteralPath $p -Raw -Encoding UTF8
[System.IO.File]::WriteAllText($p, $txt, (New-Object System.Text.UTF8Encoding($true)))  # $true = BOM
```
**Verify parse without executing** (also avoids AMSI on capture scripts):
```powershell
$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$t,[ref]$e)|Out-Null;$e
```
Tools that write UTF-8 without BOM (many editors/agents) trigger this constantly. PowerShell 7+ (`pwsh`)
defaults to UTF-8 and is immune, but you usually can't assume the user has it.

---

## 4. Input simulation: clicks dropped, Alt+Tab won't fire

- **`SendInput` is fragile from PowerShell:** its 3rd arg is `sizeof(INPUT)`; getting it wrong (e.g.
  `Marshal.SizeOf([Object[]])`) makes the OS **silently drop** the input — no error, no click. The explicit
  union struct layout is also easy to misalign on 64-bit.
- **Use `SetCursorPos` + `mouse_event` instead.** `SetCursorPos(x,y)` positions the cursor in (physical, if
  DPI-aware) pixels; `mouse_event(LEFTDOWN); mouse_event(LEFTUP)` clicks at the current spot. Rock-solid.
- **System combos need `keybd_event`.** `SendKeys` **cannot** produce **Alt+Tab** or the **Win** key (they're
  intercepted). Press them physically: hold `VK_MENU 0x12`, tap `VK_TAB 0x09`, release Alt; Win = `VK_LWIN 0x5B`.
- **`SendKeys` for text/simple keys** is fine, but **escape** its metachars `+ ^ % ~ ( ) [ ] { }` by wrapping
  each in `{}` or they're interpreted as modifiers.
- **Run from a `-File`**, not inline `-Command` (inline is scanned harder by AMSI and has quoting pain).
- Keep both capture and control on the **same coordinate system** (both DPI-aware, or both using the same
  physical size) or clicks won't match what the phone sees.

Template: `assets/control.ps1` (actions: click/dblclick/rclick/move, key, type, combo=alttab/win/wind/wintab).

---

## 5. Game anti-cheat conflict (Vanguard / VAC)

**Symptom:** Valorant / CS / other anti-cheat games crash a few seconds after launch whenever the tool is
running — even when the user thinks it's "closed" (boot-autostart keeps the server + a hidden keep-awake
PowerShell alive).

**Why:** **input injection + screen capture** are exactly what kernel anti-cheats detect. Valorant's
**Vanguard** checks at boot; CS's **VAC** at runtime. A remote-control tool *is*, behaviorally, what they
block. You cannot (and must not) evade anti-cheat.

**Mitigation to ship:**
- A **stop-everything** script (`assets/stop-tool.bat`) that kills the tool's node/PowerShell/tunnel by
  command-line match (precise — don't kill unrelated `node`).
- Advise: disable boot-autostart before gaming, and **reboot once** (Vanguard wants a clean boot state).
- Make it explicit in docs that the tool must be OFF to play those games.

---

## Quick reference: useful Win32 bits (P/Invoke is fine in a control script that does NOT capture)

| API | Use |
|-----|-----|
| `SetProcessDPIAware()` | physical-pixel coordinates (call before reading VirtualScreen) |
| `SetCursorPos(x,y)` | move cursor (physical px if DPI-aware) |
| `mouse_event(flags,...)` | LEFTDOWN 0x02 / LEFTUP 0x04 / RIGHTDOWN 0x08 / RIGHTUP 0x10 |
| `keybd_event(vk,0,flags,0)` | flags: down=0, up=KEYEVENTF_KEYUP 0x02; Alt 0x12, Tab 0x09, LWin 0x5B, D 0x44 |
| `Get-CimInstance Win32_VideoController` | physical resolution via WMI (no capture, AV-safe) — `.CurrentHorizontalResolution` / `.CurrentVerticalResolution` |

A control script with P/Invoke but **no screen capture** is generally NOT flagged — it's the *capture +
encode* combination that trips the heuristic.
