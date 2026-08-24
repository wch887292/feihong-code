@echo off
chcp 65001 >nul
title 飞虹 Code 桌面版启动器

echo.
echo ================================================
echo   飞虹 Code 桌面版 (Electron)
echo   晋江市飞虹智科技企业管理有限公司
echo ================================================
echo.

:: 设置端口
set FH_WEB_PORT=8081
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

echo [端口] %FH_WEB_PORT%
echo.

:: 检查是否已构建
if not exist "dist\cli\index.js" (
    echo [构建] 首次运行，正在编译...
    call npm run build
    if errorlevel 1 (
        echo.
        echo [错误] 编译失败，请检查错误信息
        pause
        exit /b 1
    )
    echo [完成] 编译成功
    echo.
) else (
    echo [检查] 产物已就绪
    echo.
)

:: 清理端口
echo [清理] 检测端口 %FH_WEB_PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%FH_WEB_PORT% " ^| findstr "LISTENING"') do (
    echo [清理] 终止进程 PID %%a
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: 启动 Electron
echo [启动] 正在启动飞虹 Code 桌面版...
echo.
call npx electron .

:: 如果 Electron 退出，显示提示
echo.
echo ================================================
echo   飞虹 Code 桌面版已退出
echo ================================================
echo.
pause
