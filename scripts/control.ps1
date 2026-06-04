# Remote control of this PC from the phone: mouse click/right/double + keyboard keys/combos/text.
# Coords are 0-1 ratios on the same VirtualScreen as screenshot.ps1 (both DPI-AWARE) so they match 1:1.
# Mouse uses SetCursorPos + mouse_event (rock solid; SendInput silently fails if the struct size is wrong).
# ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less UTF-8 as GBK and corrupts non-ASCII bytes.
param([string]$action="ping", [double]$rx=0, [double]$ry=0, [string]$text="")

Add-Type -AssemblyName System.Windows.Forms

$sig = @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@
$N = Add-Type -MemberDefinition $sig -Name CtrlN3 -Namespace WRC3 -PassThru
[void]$N::SetProcessDPIAware()   # physical pixels — must match screenshot.ps1 (also DPI-aware) or clicks land offset under display scaling

$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$x = [int][math]::Round($b.X + $rx * $b.Width)
$y = [int][math]::Round($b.Y + $ry * $b.Height)

$LEFTDOWN = 0x0002; $LEFTUP = 0x0004; $RIGHTDOWN = 0x0008; $RIGHTUP = 0x0010
$KEYUP = 0x0002
$z = [UIntPtr]::Zero

function MoveTo($px, $py) { [void]$N::SetCursorPos($px, $py); Start-Sleep -Milliseconds 18 }
function LClick { $N::mouse_event($LEFTDOWN, 0, 0, 0, $z); Start-Sleep -Milliseconds 24; $N::mouse_event($LEFTUP, 0, 0, 0, $z) }
function RClick { $N::mouse_event($RIGHTDOWN, 0, 0, 0, $z); Start-Sleep -Milliseconds 24; $N::mouse_event($RIGHTUP, 0, 0, 0, $z) }
function KD($vk) { $N::keybd_event([byte]$vk, 0, 0, $z) }
function KU($vk) { $N::keybd_event([byte]$vk, 0, $KEYUP, $z) }

# For 'type': escape SendKeys metachars + ^ % ~ ( ) [ ] { } by wrapping each in braces.
function EscapeSK($s) {
  $special = '+^%~(){}[]'
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    if ($special.IndexOf($ch) -ge 0) { [void]$sb.Append('{'); [void]$sb.Append($ch); [void]$sb.Append('}') }
    else { [void]$sb.Append($ch) }
  }
  $sb.ToString()
}

switch ($action) {
  'click'    { MoveTo $x $y; LClick }
  'dblclick' { MoveTo $x $y; LClick; Start-Sleep -Milliseconds 70; LClick }
  'rclick'   { MoveTo $x $y; RClick }
  'move'     { MoveTo $x $y }
  'key'      { [System.Windows.Forms.SendKeys]::SendWait($text) }
  'type'     { [System.Windows.Forms.SendKeys]::SendWait((EscapeSK $text)) }
  'combo'    {
    # System-level combos: SendKeys cannot do Alt+Tab / Win, so press them via keybd_event.
    switch ($text) {
      'alttab' { KD 0x12; Start-Sleep -Milliseconds 60; KD 0x09; KU 0x09; Start-Sleep -Milliseconds 250; KU 0x12 }
      'win'    { KD 0x5B; KU 0x5B }
      'wind'   { KD 0x5B; KD 0x44; KU 0x44; KU 0x5B }
      'wintab' { KD 0x5B; KD 0x09; KU 0x09; KU 0x5B }
      default  { }
    }
  }
  default    { Write-Output "OK" }
}
