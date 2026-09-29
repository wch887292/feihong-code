@echo off
chcp 65001 >nul
cd /d "%~dp0"
title FHCode Desktop Launcher

echo.
echo ============================================================
echo   Feihong Code Desktop (Electron) - One-Click Launch
echo   Includes Cline Integration
echo ============================================================
echo.

REM === 1. Build latest code ===
if not exist "dist\cli\index.js" (
  echo [Build] Compiling...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] Build failed!
    pause
    exit /b 1
  )
  echo [OK] Build complete
) else (
  echo [OK] Dist ready
)

REM === 2. Clean port 8081 ===
set PORT=8081
for /f "tokens=5" %%i in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  taskkill /PID %%i /F >nul 2>&1
  echo [Clean] Port %PORT% cleared ^(PID %%i^)
)

REM === 3. Launch Electron desktop ===
echo.
echo [Start] Launching Feihong Code Desktop...
echo         Server port: %PORT%
echo         Cline: available in Web Console / TUI panel
echo.
set FH_WEB_PORT=%PORT%
call npx electron .

echo.
echo ============================================================
echo   Feihong Code Desktop closed.
echo ============================================================
echo.
pause
