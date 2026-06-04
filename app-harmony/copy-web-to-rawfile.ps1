# 把 public/ 里的网页资源复制到鸿蒙工程的 rawfile 目录（壳应用要把网页打进安装包里）。
# 用法（在本文件夹下开 PowerShell）：
#   .\copy-web-to-rawfile.ps1 -Project "C:\Users\你\DevEcoStudioProjects\ClaudeRemote"
# 每次改了网页(public/**)、想更新鸿蒙 App，就重新跑一次再在 DevEco 里重新编译。
param([Parameter(Mandatory = $true)][string]$Project)

$src = Join-Path $PSScriptRoot '..\public'
$dst = Join-Path $Project 'entry\src\main\resources\rawfile'

if (-not (Test-Path $src)) { Write-Error "找不到 public 目录：$src"; exit 1 }
if (-not (Test-Path $Project)) { Write-Error "找不到鸿蒙工程目录：$Project"; exit 1 }

New-Item -ItemType Directory -Force -Path $dst | Out-Null
# 清掉旧的再拷，避免残留
Get-ChildItem -Path $dst -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force

Write-Host "已复制 public/ -> $dst"
Write-Host "rawfile 里现在有：" -ForegroundColor Green
Get-ChildItem $dst -Recurse -File | ForEach-Object { "  " + $_.FullName.Substring($dst.Length + 1) }
