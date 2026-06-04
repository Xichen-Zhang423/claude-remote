@echo off
chcp 65001 >nul
title Claude Code 手机遥控（Tailscale 固定地址）
cd /d "%~dp0"
if not exist node_modules (
  echo 第一次运行，正在安装依赖...
  call npm install
)
node tailscale.js
pause
