param([int]$pw = 0, [int]$ph = 0, [string]$out = "")
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$lg = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ($pw -le 0 -or $ph -le 0) { $pw = $lg.Width; $ph = $lg.Height }
if (-not $out) { $out = Join-Path $env:TEMP "_crshot.jpg" }
$bmp = New-Object System.Drawing.Bitmap $pw, $ph
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($lg.X, $lg.Y, 0, 0, $bmp.Size)
$tw = 1280.0
$scale = [Math]::Min(1, $tw / $pw)
$nw = [int]($pw * $scale)
$nh = [int]($ph * $scale)
$thumb = New-Object System.Drawing.Bitmap $nw, $nh
$g2 = [System.Drawing.Graphics]::FromImage($thumb)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($bmp, 0, 0, $nw, $nh)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]72)
$thumb.Save($out, $codec, $ep)
$g.Dispose(); $bmp.Dispose(); $g2.Dispose(); $thumb.Dispose()
