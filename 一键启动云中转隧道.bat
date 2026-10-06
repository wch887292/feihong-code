@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 飞虹云中转隧道 home-pc

echo.
echo ============================================================
echo   飞虹云中转隧道 - One-Click Startup
echo   晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹
echo   手机 → api.klai.top/fhrelay → 本机 fhcode(8082)
echo ============================================================
echo.

REM === 1. 清理旧实例（同脚本/旧 ssh 转发） ===
for /f "tokens=5" %%i in ('netstat -ano ^| findstr :18081 ^| findstr LISTENING') do (
  taskkill /PID %%i /F >nul 2>&1
  echo [Clean] 端口 18081 旧进程已清理 (PID %%i)
)

REM === 2. 检查 fhcode 服务是否在线 ===
curl -s -o nul -w "" http://127.0.0.1:8082/ --max-time 3
if errorlevel 1 (
  echo [WARN] 本机 fhcode(8082) 未在线！隧道会建立但请求会 502。
  echo        请先运行「一键启动Web控制台.bat」或桌面版 fhcode。
)

REM === 3. 启动隧道客户端（常驻 + 自动重连） ===
echo [Start] 启动隧道客户端...
node "%~dp0cloud-agent\fh-relay-client.js"

echo.
echo 隧道客户端已退出。
pause
