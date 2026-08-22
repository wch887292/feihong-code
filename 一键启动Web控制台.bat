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

REM === 3. Start server ===
echo.
echo [Start] Starting web server...
start "" node start-web.js --port %PORT%

REM === 4. Wait for ready ===
echo [Wait] Waiting for service ready...
timeout /t 6 /nobreak >nul

REM === 5. Open browser ===
echo [Open] Opening browser...
start http://127.0.0.1:%PORT%/

echo.
echo ============================================================
echo   OK - Web console started!
echo   URL: http://127.0.0.1:%PORT%/
echo ============================================================
echo.
echo Hint: Close this window will NOT stop the service.
echo Hint: To stop, run: taskkill /F /IM node.exe
echo.
pause >nul
