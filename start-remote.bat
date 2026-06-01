@echo off
chcp 65001 >nul
title Claude Code 手机遥控（远程/出门可用）
cd /d "%~dp0"
if not exist node_modules (
  echo 第一次运行，正在安装依赖...
  call npm install
)
node server.js
pause
