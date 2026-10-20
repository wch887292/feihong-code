@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
REM ============================================================
REM  飞虹 Code · 桌面端一键启动（Electron，Windows）
REM  用法：双击本文件。自动检查依赖 -> 构建(如缺) -> 启动桌面窗口
REM  说明：桌面端内嵌 Web 服务(127.0.0.1:8089)，与 Web 控制台共用 dist/web 资源
REM ============================================================
title 飞虹 Code 桌面端

cd /d "%~dp0"

echo [1/4] 检查 Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 22+ : https://nodejs.org
    pause & exit /b 1
)

echo [2/4] 检查构建产物...
if not exist "dist\cli\index.js" (
    echo        dist 缺失，正在构建 npm run build ...
    call npm run build
    if errorlevel 1 ( echo [错误] 构建失败 & pause & exit /b 1 )
)

echo [3/4] 检查 Electron 二进制...
if not exist "node_modules\electron\dist\electron.exe" (
    echo        electron.exe 缺失，正在经 npmmirror 补下...
    cd node_modules\electron
    set "ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/"
    call node install.js
    cd /d "%~dp0"
    if not exist "node_modules\electron\dist\electron.exe" (
        echo [错误] Electron 二进制下载失败，请检查网络后重试
        pause & exit /b 1
    )
)

echo [4/4] 启动桌面端...
echo.
echo ------------------------------------------------------------
echo   桌面窗口将自动打开（内嵌服务 127.0.0.1:8089）
echo   手机/外网访问请使用「一键启动Web控制台.bat」+「隧道保活.cmd」
echo ------------------------------------------------------------
echo.

set "NODE_OPTIONS="
call npx electron .

echo.
echo [桌面端已退出] 按任意键关闭窗口
pause >nul
