@echo off
rem FHCode web service restart (ASCII-only; unicode-safe via %%~dp0 relative navigation)
rem Feiyang Qiyuan R&D Center
cd /d "%~dp0.."
for /f "tokens=5" %%i in ('netstat -ano ^| findstr :8082 ^| findstr LISTENING') do taskkill /PID %%i /F >nul 2>&1
timeout /t 2 /nobreak >nul
set "FH_WEB_TOKEN=30587308defe825b6c59526355d6f7c3ba5e9323f787e074c9d962646c68f77a"
set "FH_CLOUD_KEEPALIVE=1"
start "fhweb" /min "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" "start-web.js" --port 8082
exit /b 0
