@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 飞虹 Code 控制台

echo ============================================================
echo   飞虹 Code 桌面端
echo   运行时: %~dp0runtime\飞虹 Code.exe
echo ============================================================
echo.

REM === 清理 8081 端口 ===
set PORT=8081
for /f "tokens=5" %%i in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  taskkill /PID %%i /F >nul 2>&1
  echo [Clean] 端口 %PORT% 已清理 (PID %%i)
)

set FH_WEB_PORT=%PORT%
echo [Start] 启动中...
start "" "%~dp0runtime\飞虹 Code.exe"

echo.
echo 飞虹 Code 已在后台启动。本窗口可以关闭。
timeout /t 3 >nul
