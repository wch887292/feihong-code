@echo off
chcp 65001 >nul
cd /d "%~dp0"
title FHCode Web Console

echo.
echo ============================================================
echo   FHCode Web Console - One-Click Startup
echo   Feihong Code - Feihong Enterprise Tech Co., Ltd.
echo ============================================================
echo.

REM === 1. Check build artifacts ===
if not exist "dist\cli\index.js" (
  echo [Build] Compiling...
  call npm run build
  if errorlevel 1 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
  )
  echo [OK] Build complete
) else (
  echo [OK] Dist ready
)

REM === 2. Clean port ===
set PORT=8080
for /f "tokens=5" %%i in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  taskkill /PID %%i /F >nul 2>&1
  echo [Clean] Port %PORT% cleared (PID %%i)
)

REM === 3. Start server (run directly, only one window) ===
echo.
echo [Start] Starting web server...
node start-web.js --port %PORT%

REM === If node exits, show message ===
echo.
echo ============================================================
echo   Web console stopped.
echo ============================================================
echo.
pause
