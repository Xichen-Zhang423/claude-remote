# Print the PHYSICAL desktop resolution as "WIDTH HEIGHT". WMI only, NO screen capture, so it
# doesn't trip the antivirus screenshot heuristic. The server runs this once at startup and
# passes the result to screenshot.ps1, keeping "read hardware" and "capture screen" in separate
# scripts (火绒 flags the two together). ASCII-only (PS 5.1 mangles BOM-less UTF-8).
$vc = Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution } | Select-Object -First 1
if ($vc -and $vc.CurrentHorizontalResolution) {
  "$([int]$vc.CurrentHorizontalResolution) $([int]$vc.CurrentVerticalResolution)"
} else {
  "0 0"
}
